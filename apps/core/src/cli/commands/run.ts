import type { CommandModule } from "yargs";

// Headless single-turn run: `freecode run [message..]`.
// Boots the same backend the JSON-RPC server uses (providers, MCP, Effect
// runtime), drives one agent turn, streams assistant text to stdout and tool
// activity to stderr, then exits. No TUI, no stdin JSON-RPC — designed for
// scripting and piping (`freecode run "..." | cat`).

interface RunArgs {
  message: string[];
  model?: string;
  agent: string;
  continue: boolean;
  session?: string;
  maxTurns?: number;
  yes: boolean;
  allow: string[];
}

type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

// Passed to yargs `choices`, which rejects anything else at parse time. That
// runtime check is what makes the cast at the read site safe: `--agent buld`
// now exits with a usage error instead of silently running as `build`.
const AGENT_MODES: AgentMode[] = [
  "plan",
  "build",
  "review",
  "explore",
  "danger",
];

// Read piped stdin when no message positional was given (e.g. `echo ... | freecode run`).
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

export const runCommand: CommandModule<object, RunArgs> = {
  command: "run [message..]",
  describe: "Run freecode headlessly with a single message",
  builder: (yargs) =>
    yargs
      .positional("message", {
        type: "string",
        array: true,
        default: [],
        describe: "the message to send",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use, in provider/model format",
      })
      .option("agent", {
        type: "string",
        default: "build",
        choices: AGENT_MODES,
        describe: "agent mode",
      })
      .option("continue", {
        alias: "c",
        type: "boolean",
        default: false,
        describe: "continue the last session in this project",
      })
      .option("session", {
        alias: "s",
        type: "string",
        describe: "session id to continue",
      })
      .option("max-turns", {
        type: "number",
        describe:
          "cap on agent iterations; unbounded (loop-health + gates only) if omitted",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        describe:
          "approve permission prompts automatically; deny rules and read-only modes still refuse",
      })
      .option("allow", {
        type: "string",
        array: true,
        default: [] as string[],
        describe:
          "grant a permission rule for this run only, e.g. --allow 'Bash(npm test:*)' (repeatable)",
      }),
  handler: async (argv) => {
    // Lazy imports: `run` pulls in the full backend, which no other command
    // (or the --help path) should pay for.
    const { initProviders } = await import("../../providers/index.js");
    const { initMcpServers } = await import("../../mcp/index.js");
    const { readConfig, fallbackProviderFromCredentials } = await import(
      "../../providers/config.js"
    );
    const { getAppRuntime } = await import("../../effect/runtime.js");
    const { createAgentLoopEffect } = await import("../../agent/loop.js");
    const { getSessionManager } = await import("../../session/index.js");
    const { bus } = await import("../../bus/index.js");
    const { initHooks } = await import("../../hooks/bootstrap.js");

    let prompt = argv.message.join(" ").trim();
    if (!prompt && !process.stdin.isTTY) {
      prompt = await readStdin();
    }
    if (!prompt) {
      console.error("Error: no message provided");
      process.exit(1);
    }

    await initProviders();
    await initMcpServers();
    // Same hooks a served session gets. Not watched: this process runs one turn
    // and exits, so a settings.json edit mid-run could not take effect anyway.
    const hookSettings = initHooks(process.cwd(), { watch: false });

    const config = readConfig();
    // --model provider/model overrides the configured current model.
    let provider = config.current?.provider;
    let model = config.current?.model;
    if (argv.model) {
      const slash = argv.model.indexOf("/");
      if (slash > 0) {
        provider = argv.model.slice(0, slash);
        model = argv.model.slice(slash + 1);
      } else {
        model = argv.model;
      }
    }

    if (!provider) {
      // A sole configured credential (e.g. only ANTHROPIC_API_KEY exported)
      // selects the provider; several throw naming them, none falls through
      // to the setup error below.
      try {
        provider = fallbackProviderFromCredentials();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
    if (!provider) {
      console.error(
        "No provider configured. Set current.provider in ~/.freecode/config.json, " +
          "export a provider API key (e.g. ANTHROPIC_API_KEY), " +
          "or pass --model <provider>/<model>.",
      );
      process.exit(1);
    }

    const projectPath = process.cwd();
    const manager = await getSessionManager();

    // Resolve the session: explicit id > continue last > fresh.
    let sessionId: string;
    if (argv.session) {
      sessionId = (await manager.resume(argv.session)).id;
    } else if (argv.continue) {
      const [latest] = await manager.list({ projectPath, status: "active" });
      sessionId = latest
        ? (await manager.resume(latest.id)).id
        : await manager.start(projectPath, provider);
    } else {
      sessionId = await manager.start(projectPath, provider);
    }

    // Stream relay → console. Assistant text goes to stdout (pipeable); tool
    // activity and thinking go to stderr so they never pollute the payload.
    const unsubscribe = bus.subscribe("stream", (e) => {
      if (e.sessionId !== sessionId) return;
      const ev = e.event;
      switch (ev.type) {
        case "text_delta":
          process.stdout.write(ev.delta);
          break;
        case "tool_start":
          process.stderr.write(`\n\x1b[2m• ${ev.toolName}\x1b[0m\n`);
          break;
        case "error":
          process.stderr.write(`\n\x1b[31m${ev.content}\x1b[0m\n`);
          break;
      }
    });

    // Safe: yargs `choices` rejected anything outside AGENT_MODES already.
    const agentMode = argv.agent as AgentMode;
    try {
      const loop = await getAppRuntime().runPromise(
        // Unbounded unless --max-turns is passed, matching Claude Code's
        // headless mode (maxTurns is opt-in there too, not a default cap).
        createAgentLoopEffect(sessionId, {
          ...(argv.maxTurns ? { maxIterations: argv.maxTurns } : {}),
          // Without one of these, `build` denies every mutating tool here:
          // there is no frontend to answer an `ask`, and an unanswered ask is
          // a denial by design (permission/prompt.ts).
          autoApproveAsks: argv.yes,
          sessionGrants: argv.allow,
        }),
      );
      const result = await getAppRuntime().runPromise(
        loop.runEffect({
          prompt,
          sessionId,
          provider,
          model,
          projectPath,
          agentMode,
        }),
      );
      process.stdout.write("\n");
      unsubscribe();
      hookSettings.dispose();
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      unsubscribe();
      hookSettings.dispose();
      console.error(`\nError: ${(err as Error).message}`);
      process.exit(1);
    }
  },
};
