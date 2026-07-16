import type { CommandModule } from "yargs";

// Headless backend: JSON-RPC 2.0 over stdin/stdout. This is what the TUI
// spawns internally, and what any other frontend can attach to.
export const serveCommand: CommandModule = {
  command: "serve",
  describe: "start the headless JSON-RPC backend (stdio)",
  handler: async () => {
    // Lazy import: loading the server pulls in tools/providers/sessions,
    // which no other command should pay for.
    const { startServer } = await import("../../server.js");
    await startServer();
  },
};
