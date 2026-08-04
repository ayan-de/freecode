// =============================================================================
// `freecode mobile` — one command from nothing to a paired phone.
//
// Wraps everything the mobile remote path needs: check/install/start/sign in
// to Tailscale, resolve the MagicDNS host, bind the daemon there, print a QR,
// and confirm when the phone actually connects.
//
// `freecode web --host <ts-name>` still exists and does the server half; this
// is the guided path that doesn't require knowing any of that.
// =============================================================================

import type { CommandModule } from "yargs";
import { loadOrCreateToken } from "../../web/auth.js";
import { renderPairQr } from "../../web/pair-qr.js";
import { prepareTailscale, reportPeers, ok, note } from "../../mobile/wizard.js";

interface MobileArgs {
  port: number;
}

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const reset = "\x1b[0m";

export const mobileCommand: CommandModule<object, MobileArgs> = {
  command: "mobile",
  describe: "Pair your phone and serve FreeCode over your tailnet",
  builder: (yargs) =>
    yargs.option("port", {
      type: "number",
      default: 4096,
      describe: "Port to serve on",
    }),
  handler: async (argv) => {
    const { port } = argv;

    console.log(`\n  ${bold}FreeCode Mobile${reset}\n`);

    const prepared = await prepareTailscale();
    if (!prepared) {
      console.log(`\n  Setup incomplete — nothing was started.\n`);
      process.exitCode = 1;
      return;
    }
    reportPeers(prepared.peers);

    // Lazy: web-server pulls in the whole backend, which the setup steps
    // above shouldn't pay for if they bail early.
    const { startWebServer, pairUrl } = await import("../../web-server.js");
    const token = loadOrCreateToken();
    const url = pairUrl(prepared.host, port, token);

    startWebServer(port, prepared.host, {
      quiet: true,
      onFirstAuth: (info) => {
        const device = /Android/i.test(info.userAgent)
          ? "Android device"
          : "device";
        console.log(
          `\n  ${green}✓${reset} ${bold}Paired${reset} — ${device} connected from ${info.remote}\n`,
        );
        console.log(`  ${dim}Leave this running. Ctrl-C stops it.${reset}\n`);
      },
    });
    ok(`Serving on http://${prepared.host}:${port}`);

    const art = await renderPairQr(url);
    console.log(`\n  ${bold}On your phone:${reset}`);
    console.log(`    1. Install ${bold}Tailscale${reset}, sign in with the same account`);
    console.log(`    2. Install ${bold}FreeCode Remote${reset}`);
    console.log(`    3. Scan this code\n`);
    if (art) {
      console.log(art);
    } else {
      note("(QR unavailable — enter these by hand)");
      console.log(`    Host:  ${prepared.host}`);
      console.log(`    Port:  ${port}`);
      console.log(`    Token: ${token}`);
    }
    if (!prepared.magicDns) {
      note("MagicDNS is off — the app will reject this address (see above).");
      note(`Browser fallback: http://${prepared.host}:${port}/?token=${token}`);
    }
    console.log(`\n  ${dim}Waiting for your phone…${reset}`);

    // Hold the process open; onFirstAuth reports the pairing.
    await new Promise(() => {});
  },
};
