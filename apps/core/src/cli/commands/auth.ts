// =============================================================================
// `freecode auth login|status|logout` — Phase 1 of the Anthropic OAuth spec
// (`docs/superpowers/specs/2026-09-05-anthropic-oauth-provider.md`).
//
// Presentation only: the protocol lives in `providers/anthropic-oauth*.ts`.
// Login prints the §0.1 disclosure once, per that spec — this feature
// impersonates Claude Code against the user's own account and says so.
// =============================================================================

import type { CommandModule } from "yargs";
import * as readline from "readline";
import { spawn } from "child_process";
import {
  anthropicAuthMode,
  setAnthropicAuthMode,
} from "../../providers/config.js";
import {
  deleteAnthropicOAuth,
  hasImportableClaudeCodeLogin,
  readAnthropicOAuth,
} from "../../providers/auth-store.js";
import {
  buildAuthorizeUrl,
  exchangeAnthropicCode,
  generatePkce,
  redirectUriForInput,
  startCallbackServer,
  ANTHROPIC_OAUTH_LOGIN,
} from "../../providers/anthropic-oauth-login.js";

const CALLBACK_TIMEOUT_MS = 120_000;

const DISCLOSURE = `
This logs in with your Claude Pro/Max subscription instead of an API key.

To reach subscription inference, freecode sends Claude Code's OAuth client id,
its User-Agent and beta headers, and its identity line as the first system
block — it presents itself to Anthropic as Claude Code. Anthropic reserves
subscription inference for its official surfaces, so this is against the spirit
(and arguably the letter) of the terms, and they have blocked tools doing it.
The account at risk is yours.

Your API-key setup is untouched: run \`freecode auth logout anthropic\` to go back.
`;

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Best-effort; a machine with no browser just uses the printed URL. */
function openBrowser(url: string): boolean {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function assertAnthropic(provider: string): void {
  if (provider !== "anthropic") {
    throw new Error(
      `Only "anthropic" supports OAuth login today (got "${provider}").`,
    );
  }
}

interface LoginArgs {
  provider: string;
  browser: boolean;
}

const loginCommand: CommandModule<object, LoginArgs> = {
  command: "login [provider]",
  describe: "log in to a provider with your subscription (OAuth)",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        type: "string",
        default: "anthropic",
        describe: "provider to log in to",
      })
      .option("browser", {
        type: "boolean",
        default: true,
        describe: "open the authorize URL in a browser (--no-browser to skip)",
      }) as never,
  handler: async (argv) => {
    assertAnthropic(argv.provider);
    console.error(DISCLOSURE);

    const { verifier, challenge } = generatePkce();

    const server = await startCallbackServer();
    const redirectUri = server?.redirectUri ?? ANTHROPIC_OAUTH_LOGIN.manualRedirectUri;
    const authUrl = buildAuthorizeUrl(redirectUri, challenge, verifier);
    const manualUrl = buildAuthorizeUrl(
      ANTHROPIC_OAUTH_LOGIN.manualRedirectUri,
      challenge,
      verifier,
    );

    console.error("Open this URL to authorize freecode:\n");
    console.error(`  ${authUrl}\n`);
    if (server && argv.browser) openBrowser(authUrl);

    try {
      if (server && argv.browser) {
        console.error(
          `Waiting up to ${CALLBACK_TIMEOUT_MS / 1000}s for the callback on ${redirectUri} ...`,
        );
        try {
          const code = await server.waitForCode(verifier, CALLBACK_TIMEOUT_MS);
          const tokens = await exchangeAnthropicCode({
            verifier,
            input: code,
            redirectUri,
          });
          finishLogin(tokens.expires_at);
          return;
        } catch (e) {
          console.error(
            `${e instanceof Error ? e.message : String(e)} Falling back to pasting the code.\n`,
          );
        }
      }

      if (!server || !argv.browser) {
        console.error(
          "No local callback listener — finish in a browser (this or another " +
            "device) using the URL above, then paste the result here.\n",
        );
        if (!server) console.error(`  (manual URL: ${manualUrl})\n`);
      }

      const input = (
        await prompt("Paste the callback URL or authorization code: ")
      ).trim();
      if (!input) throw new Error("No authorization code entered.");
      const tokens = await exchangeAnthropicCode({
        verifier,
        input,
        redirectUri: redirectUriForInput(input, redirectUri),
      });
      finishLogin(tokens.expires_at);
    } finally {
      server?.close();
    }
  },
};

function finishLogin(expiresAt: number): void {
  // An explicit login is an explicit opt-in (spec §0.1), so pin the mode
  // rather than leaving it to the "no API key configured" fallback.
  setAnthropicAuthMode("oauth");
  console.error(
    `\nLogged in. anthropic now uses your subscription; the token expires ${new Date(
      expiresAt,
    ).toLocaleString()} and refreshes automatically.`,
  );
}

const statusCommand: CommandModule = {
  command: "status",
  describe: "show how each provider authenticates",
  handler: () => {
    const mode = anthropicAuthMode();
    const stored = readAnthropicOAuth();
    console.log(`anthropic  auth mode: ${mode}`);
    if (stored) {
      const expires = new Date(stored.expires_at);
      const state = stored.expires_at > Date.now() ? "valid until" : "expired";
      console.log(`           oauth token: ${state} ${expires.toLocaleString()}`);
      console.log(
        `           scopes: ${stored.scopes.length ? stored.scopes.join(" ") : "(none reported)"}`,
      );
    } else {
      console.log("           oauth token: none stored");
      if (hasImportableClaudeCodeLogin()) {
        console.log(
          "           an official Claude Code login is importable on this machine",
        );
      }
    }
    if (mode === "oauth" && !stored) {
      console.log("           run `freecode auth login anthropic`");
    }
  },
};

const logoutCommand: CommandModule<object, { provider: string }> = {
  command: "logout [provider]",
  describe: "forget stored OAuth credentials and revert to API-key auth",
  builder: (yargs) =>
    yargs.positional("provider", {
      type: "string",
      default: "anthropic",
      describe: "provider to log out of",
    }) as never,
  handler: (argv) => {
    assertAnthropic(argv.provider);
    const removed = deleteAnthropicOAuth();
    setAnthropicAuthMode(undefined);
    console.log(
      removed
        ? "Logged out of anthropic; auth mode reverts to your API key."
        : "No stored anthropic OAuth credentials.",
    );
  },
};

export const authCommand: CommandModule = {
  command: "auth",
  describe: "manage provider authentication",
  builder: (yargs) =>
    yargs
      .command(loginCommand as CommandModule)
      .command(statusCommand)
      .command(logoutCommand as CommandModule)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
