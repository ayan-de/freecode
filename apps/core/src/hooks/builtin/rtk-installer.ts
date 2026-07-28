// =============================================================================
// rtk installer — optional companion binary that compresses bash output.
//
// Resolves a usable `rtk` command: an existing one on PATH, a previous managed
// install under ~/.freecode/bin, or (once, with consent) a fresh download of a
// pinned release verified against that release's own checksums.txt. Every
// failure path fails OPEN (returns null → the command runs unmodified).
// =============================================================================

import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { askQuestion } from "../../bus/index.js";

// Pinned stable release. Bump this ONE line to upgrade — per-asset hashes are
// fetched from the release's checksums.txt at install time, never hardcoded.
export const RTK_VERSION = "v0.44.0";
const RELEASE_BASE = `https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}`;
const MIN_RTK_MINOR = 23; // `rtk rewrite` (the contract we use) landed in 0.23.0
const CONSENT_TIMEOUT_MS = 90_000;

const BIN_DIR = path.join(os.homedir(), ".freecode", "bin");
const STATE_FILE = path.join(os.homedir(), ".freecode", "rtk-state.json");

// =============================================================================
// One-time-offer state (~/.freecode/rtk-state.json)
// =============================================================================

interface RtkState {
  asked?: boolean; // have we prompted the user at least once?
  installed?: boolean;
  declined?: boolean;
  version?: string;
}

function readState(): RtkState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as RtkState;
  } catch {
    return {};
  }
}

function writeState(patch: RtkState): void {
  try {
    const next = { ...readState(), ...patch };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch {
    // best-effort: a missing state file just means we may re-offer next run
  }
}

// =============================================================================
// Platform → release asset
// =============================================================================

function managedBinary(): string {
  return path.join(BIN_DIR, process.platform === "win32" ? "rtk.exe" : "rtk");
}

// process.platform/arch → release asset name. null = unsupported target.
export function assetName(): string | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") return "rtk-aarch64-apple-darwin.tar.gz";
  if (p === "darwin" && a === "x64") return "rtk-x86_64-apple-darwin.tar.gz";
  if (p === "linux" && a === "arm64") return "rtk-aarch64-unknown-linux-gnu.tar.gz";
  if (p === "linux" && a === "x64") return "rtk-x86_64-unknown-linux-musl.tar.gz";
  if (p === "win32" && a === "x64") return "rtk-x86_64-pc-windows-msvc.zip";
  return null;
}

// =============================================================================
// Process + probe helpers (shared with rtk-rewrite.ts)
// =============================================================================

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

// Spawn a command, capture stdout/stderr, enforce an optional timeout. Never
// rejects — a spawn error resolves with code null so callers fail open.
export function runCapture(
  cmd: string,
  args: string[],
  opts: { timeout?: number; cwd?: string } = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, stdio: "pipe" });
    } catch {
      resolve({ code: null, stdout: "", stderr: "", killed: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = opts.timeout
      ? setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, opts.timeout)
      : null;
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => {
      if (timer) clearTimeout(timer);
      resolve({ code: null, stdout, stderr, killed });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, killed });
    });
  });
}

// True if `<cmd> --version` reports rtk >= 0.23.0.
export async function probeRtk(cmd: string): Promise<boolean> {
  const r = await runCapture(cmd, ["--version"], { timeout: 2000 });
  if (r.code !== 0) return false;
  const m = r.stdout.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 0 || minor >= MIN_RTK_MINOR;
}

// =============================================================================
// Download + verify + extract
// =============================================================================

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Parse a `<sha256>  <name>` manifest; return the hash for `asset` (or null).
export function expectedHash(checksums: string, asset: string): string | null {
  for (const line of checksums.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (m && m[2].trim() === asset) return m[1].toLowerCase();
  }
  return null;
}

// Download the pinned asset, verify its sha256 against the release manifest,
// extract the rtk binary into ~/.freecode/bin. Returns the binary path or null.
async function downloadAndInstall(): Promise<string | null> {
  const asset = assetName();
  if (!asset) return null; // unsupported platform/arch

  let archiveBytes: Buffer;
  let checksums: string;
  try {
    [archiveBytes, checksums] = await Promise.all([
      fetchBuffer(`${RELEASE_BASE}/${asset}`),
      fetchBuffer(`${RELEASE_BASE}/checksums.txt`).then((b) => b.toString("utf-8")),
    ]);
  } catch (e) {
    console.warn(`[rtk] download failed: ${(e as Error).message}`);
    return null;
  }

  const expect = expectedHash(checksums, asset);
  const actual = createHash("sha256").update(archiveBytes).digest("hex");
  if (!expect || expect !== actual) {
    console.warn(`[rtk] checksum verification failed for ${asset} — aborting install`);
    return null;
  }

  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const archivePath = path.join(BIN_DIR, asset);
    fs.writeFileSync(archivePath, archiveBytes);
    // `tar -xf` handles both .tar.gz and .zip on modern macOS/Linux/Windows (bsdtar).
    const ex = await runCapture("tar", ["-xf", archivePath, "-C", BIN_DIR], {
      timeout: 30_000,
    });
    fs.rmSync(archivePath, { force: true });
    if (ex.code !== 0) {
      console.warn(`[rtk] extraction failed: ${ex.stderr.trim()}`);
      return null;
    }
    const bin = managedBinary();
    if (!fs.existsSync(bin)) {
      console.warn("[rtk] archive did not contain the expected rtk binary");
      return null;
    }
    if (process.platform !== "win32") fs.chmodSync(bin, 0o755);
    return bin;
  } catch (e) {
    console.warn(`[rtk] install failed: ${(e as Error).message}`);
    return null;
  }
}

// =============================================================================
// Consent (one-time interactive prompt via the question bus)
// =============================================================================

async function askConsent(sessionId?: string): Promise<boolean> {
  const ask = askQuestion(
    randomUUID(),
    [
      {
        question:
          "Install rtk to compress bash command output and save tokens? " +
          "One-time ~4 MB download into ~/.freecode/bin.",
        header: "rtk",
        options: [
          {
            label: "Install",
            description: `Download rtk ${RTK_VERSION} and use it for bash output`,
          },
          { label: "Not now", description: "Run commands normally; don't ask again" },
        ],
      },
    ],
    sessionId,
  );
  // Bound the wait so a headless/unattended run can't hang the first bash call.
  const timeout = new Promise<string[]>((resolve) =>
    setTimeout(() => resolve([]), CONSENT_TIMEOUT_MS),
  );
  try {
    const answers = await Promise.race([ask, timeout]);
    return answers[0] === "Install";
  } catch {
    return false; // question rejected / no frontend → treat as decline
  }
}

// =============================================================================
// Orchestrator (memoized for the process lifetime)
// =============================================================================

let resolved: Promise<string | null> | undefined;

// Resolve a usable rtk command, offering a one-time consented install if none
// is present. Memoized so concurrent bash calls share a single setup.
export function ensureRtk(sessionId?: string): Promise<string | null> {
  if (!resolved) resolved = resolveRtk(sessionId);
  return resolved;
}

// The rewritten command uses a bare `rtk` (e.g. `rtk git status`), so the
// managed bin dir must be on PATH for bash-spawned children to find it. Adding
// it to the core process env covers compound rewrites (`rtk a && rtk b`) too.
function ensureBinOnPath(): void {
  const sep = process.platform === "win32" ? ";" : ":";
  const current = process.env.PATH ?? "";
  if (!current.split(sep).includes(BIN_DIR)) {
    process.env.PATH = BIN_DIR + sep + current;
  }
}

async function resolveRtk(sessionId?: string): Promise<string | null> {
  // 1. A managed install from a previous run.
  const managed = managedBinary();
  if (fs.existsSync(managed) && (await probeRtk(managed))) {
    ensureBinOnPath();
    return managed;
  }

  // 2. An rtk the user installed themselves (PATH).
  if (await probeRtk("rtk")) return "rtk";

  // 3. Nothing usable — offer to install, but only ever once.
  if (readState().asked) return null;
  if (assetName() === null) {
    writeState({ asked: true, declined: true }); // unsupported target
    return null;
  }

  const consent = await askConsent(sessionId);
  writeState({ asked: true });
  if (!consent) {
    writeState({ declined: true });
    return null;
  }

  const bin = await downloadAndInstall();
  if (bin) {
    writeState({ installed: true, version: RTK_VERSION });
    ensureBinOnPath();
    return bin;
  }
  writeState({ declined: true }); // failed install → don't retry every session
  return null;
}

// Test-only: clear the memoized resolution.
export function __resetRtkResolution(): void {
  resolved = undefined;
}
