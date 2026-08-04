import type { CommandModule } from "yargs";
import { openBrowser } from "../../utils/open-browser.js";

interface WebArgs {
  port: number;
  host: string;
  open: boolean;
  // yargs' typed builder does not retain the camelCase alias for keys that
  // contain a dash, so the typed handler reads via the dash form below.
  "require-auth"?: boolean;
}

export const webCommand: CommandModule<object, WebArgs> = {
  command: "web",
  describe: "Start the web interface and server",
  builder: (yargs) =>
    yargs
      .option("port", {
        type: "number",
        default: 4096,
        describe: "Port to run the web server on",
      })
      .option("host", {
        type: "string",
        default: "127.0.0.1",
        describe: "Host interface to bind to",
      })
      .option("open", {
        type: "boolean",
        default: true,
        describe: "Automatically open the browser",
      })
      .option("require-auth", {
        type: "boolean",
        default: false,
        describe:
          "Require the bearer token even on loopback (default: only on non-loopback binds)",
      }),
  // Cast argv through unknown — yargs' typed builder collapses the camelCase
  // alias of multi-word options, so reading the typed dashed key directly is
  // the documented escape hatch.
  handler: async (argv: unknown) => {
    const args = argv as WebArgs;
    const { port, host, open } = args;
    const requireAuth = Boolean(args["require-auth"]);

    try {
      console.log(`\n  Starting FreeCode Web Interface...`);
      // Lazy import: web-server pulls in the full backend (server.js), which
      // other commands and the TUI boot path shouldn't pay for.
      const { startWebServer } = await import("../../web-server.js");
      startWebServer(port, host, { requireAuth });

      const url = `http://${host}:${port}/`;
      if (open) {
        console.log(`  Opening ${url} in your browser...`);
        openBrowser(url);
      }

      // Prevent CLI exit
      await new Promise(() => {});
    } catch (err: any) {
      console.error(`Error starting web server: ${err.message}`);
      process.exit(1);
    }
  },
};
