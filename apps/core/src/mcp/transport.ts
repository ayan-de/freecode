import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function createStdioTransport(
  config: StdioTransportConfig,
): StdioClientTransport {
  return new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: config.env,
  });
}
