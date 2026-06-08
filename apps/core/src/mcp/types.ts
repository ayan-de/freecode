import { z } from 'zod';

export const McpServerSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote']),
  // Local (stdio) config
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // Remote (HTTP) config
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  // Common config
  enabled: z.boolean().default(true),
  timeout: z.number().default(5000),
}).refine(
  (data) => data.type !== 'remote' || (data.url !== undefined && data.url !== ''),
  { message: 'URL is required for remote MCP servers', path: ['url'] }
);

export const McpConfigSchema = z.object({
  servers: z.array(McpServerSchema).default([]),
  pollInterval: z.number().default(5000),
});

export const ConfigSchema = z.object({
  providers: z.record(z.string(), z.object({
    apiKey: z.string(),
    model: z.string().optional(),
  })).optional(),
  current: z.object({
    provider: z.string(),
    model: z.string(),
  }).optional(),
  mcp: McpConfigSchema.optional(),
});

export type McpServer = z.infer<typeof McpServerSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface McpClient {
  readonly name: string;
  readonly status: 'connected' | 'disconnected' | 'starting' | 'failed';
  readonly tools: Map<string, unknown>; // Tool
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}