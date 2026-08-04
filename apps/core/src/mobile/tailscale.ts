// =============================================================================
// Tailscale detection and control.
//
// The mobile pairing flow needs four things to be true before it can print a
// QR: the binary exists, the daemon runs, the machine is logged in, and
// MagicDNS gives us a hostname. Each can fail independently and each has a
// different remedy, so detection returns a discriminated state rather than a
// boolean — the wizard renders one instruction per state.
//
// MagicDNS matters more than it looks. The Android client's network security
// config permits cleartext only to `*.ts.net`, and Android has no way to
// express Tailscale's 100.64.0.0/10 CIDR, so pairing against a raw tailnet IP
// is blocked in the WebView. The hostname is not a nicety here; it is the
// only address that works.
// =============================================================================

import { spawn } from "child_process";
import * as fs from "fs";

export type TailscaleState =
  /** Binary not on PATH. */
  | { kind: "missing" }
  /** Installed, but the daemon isn't running (or we can't reach its socket). */
  | { kind: "stopped" }
  /** Daemon up, machine not authenticated to a tailnet. */
  | { kind: "logged-out" }
  /** Everything up. `dnsName` is the MagicDNS name, without the trailing dot. */
  | {
      kind: "ready";
      dnsName: string | null;
      ip: string;
      magicDns: boolean;
      peers: { name: string; os: string; online: boolean }[];
    };

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnFailed: boolean;
}

/**
 * Where the `tailscale` CLI lives.
 *
 * On Linux and Homebrew macOS it's on PATH. The Mac App Store build ships the
 * CLI *inside the bundle* and does not add it to PATH, so a plain PATH lookup
 * reports "not installed" on a machine where Tailscale is running fine.
 */
export function tailscaleBinary(): string {
  if (process.platform === "darwin") {
    const bundled = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (fs.existsSync(bundled)) return bundled;
  }
  return "tailscale";
}

/**
 * `tailscale up` needs root on Linux, where the daemon runs as a system
 * service. The macOS and Windows builds talk to a user-level service and
 * neither has (or needs) sudo — prefixing it there just fails.
 */
export function tailscaleUpCommand(): string {
  const bin = tailscaleBinary();
  const quoted = bin.includes(" ") ? `"${bin}"` : bin;
  return process.platform === "linux" ? `sudo ${quoted} up` : `${quoted} up`;
}

/** Run a command, capturing output. Never throws — callers inspect the result. */
function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", () =>
      resolve({ code: null, stdout, stderr, spawnFailed: true }),
    );
    child.on("close", (code) =>
      resolve({ code, stdout, stderr, spawnFailed: false }),
    );
  });
}

/**
 * Run a command with the terminal attached, so sudo can prompt for a password
 * and `tailscale up` can print its auth URL. Resolves to the exit code.
 */
export function runInteractive(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Where the machine currently stands. */
export async function detectTailscale(): Promise<TailscaleState> {
  const status = await run("tailscale", ["status", "--json"]);
  if (status.spawnFailed) return { kind: "missing" };

  // The daemon being down surfaces as a socket error on stderr rather than a
  // parseable payload, so check that before attempting JSON.
  const err = status.stderr.toLowerCase();
  if (
    err.includes("failed to connect") ||
    err.includes("is not running") ||
    err.includes("no such file or directory")
  ) {
    return { kind: "stopped" };
  }

  let parsed: {
    BackendState?: string;
    Self?: { DNSName?: string; TailscaleIPs?: string[] };
    CurrentTailnet?: { MagicDNSEnabled?: boolean };
    Peer?: Record<string, { HostName?: string; OS?: string; Online?: boolean }>;
  };
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    // Unparseable output with a live binary — treat as stopped so the wizard
    // offers to start the daemon rather than dying on a stack trace.
    return { kind: "stopped" };
  }

  const backend = parsed.BackendState ?? "";
  if (backend === "NeedsLogin" || backend === "NoState") {
    return { kind: "logged-out" };
  }
  if (backend === "Stopped") return { kind: "stopped" };

  const ip = parsed.Self?.TailscaleIPs?.find((a) => a.includes(".")) ?? "";
  if (!ip) return { kind: "logged-out" };

  return {
    kind: "ready",
    // Trailing dot is present in the API and invalid in a URL.
    dnsName: parsed.Self?.DNSName?.replace(/\.$/, "") || null,
    ip,
    magicDns: parsed.CurrentTailnet?.MagicDNSEnabled ?? false,
    peers: Object.values(parsed.Peer ?? {}).map((p) => ({
      name: p.HostName ?? "unknown",
      os: p.OS ?? "",
      online: p.Online ?? false,
    })),
  };
}

/** The install command for this platform, or null when we don't know one. */
export function installCommand(): { label: string; command: string } | null {
  if (process.platform === "darwin") {
    return { label: "Homebrew", command: "brew install tailscale" };
  }
  if (process.platform === "win32") {
    return { label: "winget", command: "winget install tailscale.tailscale" };
  }
  if (process.platform !== "linux") return null;
  // Distro detection stays deliberately shallow: os-release ID covers the
  // common cases and the upstream script covers everything else.
  const id = readOsReleaseId();
  if (id === "arch" || id === "manjaro" || id === "endeavouros") {
    return { label: "pacman", command: "sudo pacman -S --needed tailscale" };
  }
  if (id === "fedora" || id === "rhel" || id === "centos") {
    return { label: "dnf", command: "sudo dnf install -y tailscale" };
  }
  return {
    label: "official installer",
    command: "curl -fsSL https://tailscale.com/install.sh | sh",
  };
}

function readOsReleaseId(): string | null {
  try {
    const text = fs.readFileSync("/etc/os-release", "utf8");
    const m = /^ID=("?)([^"\n]+)\1/m.exec(text);
    return m ? m[2].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Command that starts the daemon on this platform, or null if not applicable. */
export function daemonStartCommand(): string | null {
  if (process.platform === "linux") {
    return "sudo systemctl enable --now tailscaled";
  }
  if (process.platform === "darwin") {
    return "sudo tailscaled install-system-daemon";
  }
  return null;
}
