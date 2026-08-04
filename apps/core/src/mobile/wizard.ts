// =============================================================================
// The `freecode mobile` setup wizard.
//
// Walks Tailscale from "not installed" to "ready to pair", asking before it
// runs anything privileged. Every step re-detects rather than assuming the
// previous one worked, because the common failure is `tailscale up` being
// abandoned at the browser login — which leaves the daemon running and the
// machine logged out, a state that looks fine unless you check.
//
// Nothing here runs sudo without an explicit y/N. Silently escalating on a
// user's machine is not a thing this should ever do, however convenient.
// =============================================================================

import * as readline from "readline";
import {
  daemonStartCommand,
  detectTailscale,
  installCommand,
  runInteractive,
  type TailscaleState,
} from "./tailscale.js";

const dim = "\x1b[2m";
const bold = "\x1b[1m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const reset = "\x1b[0m";

export const ok = (msg: string) => console.log(`  ${green}✓${reset} ${msg}`);
export const warn = (msg: string) => console.log(`  ${yellow}!${reset} ${msg}`);
export const fail = (msg: string) => console.log(`  ${red}✗${reset} ${msg}`);
export const note = (msg: string) => console.log(`    ${dim}${msg}${reset}`);

/** Ask a yes/no question. Defaults to no — the safe answer for `sudo`. */
export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`  ${bold}${question}${reset} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Run a shell string with the terminal attached (sudo prompts, auth URLs). */
function shell(command: string): Promise<number> {
  return process.platform === "win32"
    ? runInteractive("cmd", ["/c", command])
    : runInteractive("sh", ["-c", command]);
}

/**
 * The host the daemon should bind to, or null when the user backed out or
 * something needs manual intervention.
 */
export interface Prepared {
  host: string;
  /** True when `host` is a MagicDNS name; false when it's a bare tailnet IP. */
  magicDns: boolean;
  peers: { name: string; os: string; online: boolean }[];
}

export async function prepareTailscale(): Promise<Prepared | null> {
  let state = await detectTailscale();

  // --- 1. Installed? -------------------------------------------------------
  if (state.kind === "missing") {
    const install = installCommand();
    fail("Tailscale isn't installed.");
    if (!install) {
      note(`Install it from https://tailscale.com/download and re-run.`);
      return null;
    }
    note(`Install via ${install.label}:  ${install.command}`);
    if (!(await confirm("Run that now?"))) {
      note("Skipped. Install it yourself, then re-run `freecode mobile`.");
      return null;
    }
    if ((await shell(install.command)) !== 0) {
      fail("Install failed. Run the command above manually and re-run.");
      return null;
    }
    state = await detectTailscale();
  }

  // --- 2. Daemon running? --------------------------------------------------
  if (state.kind === "stopped") {
    const start = daemonStartCommand();
    fail("The Tailscale daemon isn't running.");
    if (!start) {
      note("Start the Tailscale app, then re-run `freecode mobile`.");
      return null;
    }
    note(`Start it with:  ${start}`);
    if (!(await confirm("Run that now?"))) return null;
    if ((await shell(start)) !== 0) {
      fail("Couldn't start the daemon. Run the command above manually.");
      return null;
    }
    state = await detectTailscale();
  }

  // --- 3. Logged in? -------------------------------------------------------
  if (state.kind === "logged-out") {
    fail("This machine isn't signed in to a tailnet.");
    note("`tailscale up` opens a browser to sign in. This can't be automated.");
    note("Use the SAME account you'll sign into on your phone.");
    if (!(await confirm("Run `sudo tailscale up` now?"))) return null;
    await shell("sudo tailscale up");
    state = await detectTailscale();
    if (state.kind !== "ready") {
      // Overwhelmingly the common failure: the command exits 0 but the
      // browser login was never completed.
      fail("Still not signed in — the browser login didn't complete.");
      note("Re-run `freecode mobile` once `tailscale status` shows a tailnet.");
      return null;
    }
  }

  if (state.kind !== "ready") {
    fail("Tailscale isn't ready. Check `tailscale status`.");
    return null;
  }

  return resolveHost(state);
}

/**
 * Pick the address to bind and pair on.
 *
 * Strongly prefers the MagicDNS name: the Android client's network security
 * config permits cleartext only to `*.ts.net`, and Android cannot express
 * Tailscale's CGNAT range, so a bare tailnet IP is blocked in the WebView —
 * after pairing appears to succeed, because pairing uses HttpURLConnection
 * which isn't subject to that policy.
 */
function resolveHost(
  state: Extract<TailscaleState, { kind: "ready" }>,
): Prepared {
  ok(`Tailscale is up (${state.ip})`);
  if (state.dnsName && state.magicDns) {
    ok(`MagicDNS: ${state.dnsName}`);
    return { host: state.dnsName, magicDns: true, peers: state.peers };
  }
  warn("MagicDNS is off, so pairing has to use a raw tailnet IP.");
  note("The Android app blocks that: it only permits cleartext to *.ts.net.");
  note("Enable MagicDNS at https://login.tailscale.com/admin/dns");
  note("A phone browser will still work against the URL below.");
  return { host: state.ip, magicDns: false, peers: state.peers };
}

/** Phones already visible on the tailnet, for the "is my phone here?" check. */
export function reportPeers(peers: Prepared["peers"]): void {
  const phones = peers.filter((p) => p.os === "android" || p.os === "iOS");
  if (phones.length === 0) {
    warn("No phone on your tailnet yet.");
    note("Install Tailscale on the phone and sign in with the same account.");
    return;
  }
  for (const p of phones) {
    ok(`Phone on tailnet: ${p.name}${p.online ? "" : " (offline)"}`);
  }
}
