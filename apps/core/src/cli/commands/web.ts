import type { CommandModule } from "yargs";
import { exec } from "child_process";

interface WebArgs {
  port: number;
  host: string;
  open: boolean;
}

function openBrowser(url: string) {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${start} ${url}`, (err) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
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
      }),
  handler: async (argv) => {
    const { port, host, open } = argv;

    try {
      console.log(`\n  Starting FreeCode Web Interface...`);
      // Lazy import: web-server pulls in the full backend (server.js), which
      // other commands and the TUI boot path shouldn't pay for.
      const { startWebServer } = await import("../../web-server.js");
      startWebServer(port, host);

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
