import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpTransportConfig {
  url: string;
  headers?: Record<string, string>;
}

export function createStdioTransport(
  config: StdioTransportConfig,
): StdioClientTransport {
  // Merge command and args: command[0] + args + server.args
  const allArgs = [
    ...(config.args || []),
  ];

  return new StdioClientTransport({
    command: config.command,
    args: allArgs,
    env: config.env,
  });
}

export function createHttpTransport(
  config: HttpTransportConfig,
): StreamableHTTPClientTransport {
  // Note: timeout is not directly supported by StreamableHTTPClientTransport
  // The underlying fetch request timeout should be handled by the transport internally
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers
      ? { headers: config.headers }
      : undefined,
  });
}
