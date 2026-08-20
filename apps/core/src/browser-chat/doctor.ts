// =============================================================================
// Browser Chat — `freecode browser doctor`
//
// The piece that makes a site redesign a five-second diagnosis instead of a
// hang. Every capability is probed and reported separately, so the answer to
// "it stopped working" is a line number in a site adapter, not a bisect.
// =============================================================================

import { getSiteAdapter } from "./sites/index.js";
import { readBrowserChatConfig } from "./config.js";
import { collectResponse, openBrowserThread } from "./runtime.js";
import { formatDomProbe, probeDom } from "./transport/dom-probe.js";
import type { SiteId } from "./types.js";

const PROBE = "Reply with exactly: OK";

type Status = "pass" | "fail" | "warn";

function line(status: Status, label: string, detail = ""): void {
  const mark = status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

export interface DoctorOptions {
  site: SiteId;
  raw?: boolean;
  keepOpen?: boolean;
}

/** Returns a process exit code: 0 healthy, 1 something is broken. */
export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const config = readBrowserChatConfig();
  const adapter = getSiteAdapter(opts.site);

  console.log(`\nbrowser doctor — ${adapter.label}`);
  console.log(`  adapter ${adapter.adapterVersion}, cdp ${config.cdpUrl}\n`);

  let opened: Awaited<ReturnType<typeof openBrowserThread>> | undefined;
  try {
    opened = await openBrowserThread(opts.site);
    line(
      "pass",
      opened.transport.launchedBrowser
        ? "launched a browser and attached"
        : "attached to the running browser",
    );
  } catch (error) {
    line("fail", "attach a browser", String(error));
    return 1;
  }

  const { transport, handle } = opened;
  const rawFrames: string[] = [];
  if (opts.raw) {
    transport.onRawFrame = (frame) => {
      if (rawFrames.length < 20) rawFrames.push(frame);
    };
  }

  let healthy = true;
  try {
    line("pass", "opened a new thread", adapter.newChatUrl());

    try {
      await transport.send(handle, PROBE);
      const matched = transport.matchedSelectors(handle);
      line(
        matched.composer?.rank === 0 ? "pass" : "warn",
        "composer",
        matched.composer
          ? `${matched.composer.selector} (candidate ${matched.composer.rank})`
          : "not found",
      );
      line(
        matched.submit?.rank === 0 ? "pass" : "warn",
        "send button",
        matched.submit
          ? `${matched.submit.selector} (candidate ${matched.submit.rank})`
          : "not found",
      );
    } catch (error) {
      // Distinguish "you need to log in" from "the selectors moved". They
      // produce the identical symptom and need opposite fixes, so guessing
      // between them is exactly what this must not do — report the page.
      const page = transport.page(handle);
      const probe = await probeDom(page).catch(() => null);
      if (probe?.looksChallenged) {
        line(
          "fail",
          "site reachable",
          "the site is showing an anti-bot verification page",
        );
        console.log(
          "\n  This is not a stale selector, and no adapter change fixes it:\n" +
            "  the site is detecting this browser as automated. A CDP-attached\n" +
            "  page is instrumented in ways bot protection can see, and solving\n" +
            "  the challenge by hand does not persist because the detection is\n" +
            "  continuous.\n\n" +
            "  FreeCode does not implement anti-detection measures. The\n" +
            "  supported path when a site does this is the extension transport,\n" +
            "  which runs in your normal browser with no automation attached.\n",
        );
        if (probe) console.log(formatDomProbe(probe));
        return 1;
      }

      const loggedOut =
        probe?.looksLoggedOut || /login|signin|sign-in|auth/i.test(page.url());

      if (loggedOut) {
        line("fail", "logged in", "the browser is showing a sign-in page");
        console.log(
          "\n  → Log in to the site in the browser window that is already open,\n" +
            "    then run this command again. Only needed once — the session is\n" +
            `    kept in ${config.profileDir}\n`,
        );
        if (probe) console.log(formatDomProbe(probe));
        return 1;
      }

      line("fail", "composer", String(error));
      if (probe) {
        console.log(
          "\n  Logged in, but no known composer selector matched. What is on " +
            "the page:\n",
        );
        console.log(formatDomProbe(probe));
        console.log(
          "\n  → Update composerSelectors / submitSelectors in " +
            `sites/${adapter.id}.ts from the list above.\n`,
        );
      }
      return 1;
    }

    const result = await collectResponse(transport, handle);

    if (!result.sawCompletionRequest) {
      line(
        "fail",
        "completion request matched",
        `no request matched ${JSON.stringify(adapter.completionUrlPatterns)} — ` +
          `the site's streaming endpoint likely moved (adapter is stale)`,
      );
      healthy = false;
      // Without this the most likely failure produces silence. These URLs are
      // where the endpoint actually is.
      const seen = transport.seenUrls(handle);
      console.log(`\n--- ${seen.length} request URLs the page issued ---`);
      for (const url of seen) console.log(`    ${url}`);
      console.log(
        "\n  Look for a POST that streams (completion / chat / message) and put a\n" +
          `  distinctive substring of it in completionUrlPatterns in sites/${adapter.id}.ts.\n`,
      );
    } else {
      line("pass", "completion request matched");
    }

    if (result.limit) {
      line("warn", "site reported a limit", result.limit.detail);
    }
    if (result.error) {
      line("fail", "stream error", result.error);
      healthy = false;
    }

    if (result.text.trim().length > 0) {
      line("pass", "frames decoded", `${result.text.trim().slice(0, 60)}`);
    } else if (result.timedOut) {
      line("fail", "frames decoded", "timed out waiting for the first chunk");
      healthy = false;
    } else {
      line(
        "fail",
        "frames decoded",
        "the request was seen but no frame decoded — the payload shape " +
          "changed; re-run with --raw and update the adapter",
      );
      healthy = false;
    }

    if (opts.raw) {
      console.log(`\n--- first ${rawFrames.length} raw frames ---`);
      for (const frame of rawFrames) console.log(frame + "\n");
    }
  } finally {
    if (!opts.keepOpen) {
      await transport.closeThread(handle).catch(() => {});
      await transport.disconnect().catch(() => {});
    }
  }

  console.log(healthy ? "\nhealthy\n" : "\nunhealthy — see failures above\n");
  return healthy ? 0 : 1;
}
