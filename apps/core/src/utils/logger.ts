// =============================================================================
// Logger
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  private prefix: string;

  constructor(prefix = "") {
    this.prefix = prefix ? `[${prefix}] ` : "";
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    // Core speaks JSON-RPC over stdout (`freecode serve`). Logging there
    // is indistinguishable from a protocol frame and will either be skipped
    // or (in strict clients) tear down the reader. stderr is the channel
    // frontends already surface as chatter.
    process.stderr.write(
      `${this.prefix}${level.toUpperCase()}: ${message}${metaStr}\n`,
    );
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (!process.env.FREECODE_DEBUG) return;
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}

export const logger = new ConsoleLogger("freecode");
