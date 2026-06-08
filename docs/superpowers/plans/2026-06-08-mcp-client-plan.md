# MCP Client Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP client integration to FreeCode, enabling the agent to use tools from external MCP servers configured in `~/.freecode/config.json`.

**Architecture:** A CLI entry point (`cli.ts`) parses command-line arguments and routes to either MCP management commands (`freecode mcp`) or starts the JSON-RPC server. MCP tools are auto-discovered from configured MCP servers and integrated into the agent's tool system via a new `MCPService` using Effect/Layer DI.

**Tech Stack:** TypeScript, Effect/Layer, `@modelcontextprotocol/sdk`, yargs

---

## File Structure

```
apps/core/src/
├── cli.ts                    # NEW: CLI entry point - parses args, routes to MCP or server
├── server.ts                 # MODIFIED: Remove bin entry, keep JSON-RPC server
├── mcp/
│   ├── index.ts             # MODIFIED: Export MCPService + Layer
│   ├── types.ts             # NEW: McpServer, McpTool, McpClient interfaces + Zod schemas
│   ├── service.ts           # NEW: MCPService implementation (Effect/Layer)
│   ├── transport.ts         # NEW: StdioClientTransport, HttpClientTransport
│   ├── convert-tool.ts      # NEW: convertMcpTool() - MCP Tool → FreeCode Tool
│   └── config.ts            # NEW: MCP config loading from ~/.freecode/config.json
└── tools/
    └── index.ts             # MODIFIED: Add MCP tools to registry

apps/core/package.json        # MODIFIED: bin points to cli.js, add @modelcontextprotocol/sdk
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

#### Task 1: Add dependency and configure package.json

**Files:**
- Modify: `apps/core/package.json`
- Test: `pnpm install && pnpm build`

- [ ] **Step 1: Add @modelcontextprotocol/sdk dependency**

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

Run: `pnpm install`
Expected: Package installed

- [ ] **Step 2: Change bin entry from server.js to cli.js**

```json
{
  "bin": {
    "freecode": "./dist/cli.js"
  }
}
```

---

#### Task 2: Create MCP types and Zod schemas

**Files:**
- Create: `apps/core/src/mcp/types.ts`
- Test: `apps/core/src/mcp/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { McpServerSchema, McpConfigSchema } from './types.js';

describe('McpServerSchema', () => {
  it('should parse valid local server config', () => {
    const config = {
      name: 'contextcarry',
      type: 'local',
      command: ['npx', '-y', '@thisisayande/contextcarry-mcp'],
      enabled: true,
    };
    const result = McpServerSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject remote server without url', () => {
    const config = {
      name: 'github',
      type: 'remote',
    };
    const result = McpServerSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
```

Run: `pnpm test apps/core/src/mcp/types.test.ts`
Expected: FAIL with "Cannot find module './types.js'"

- [ ] **Step 2: Write minimal types implementation**

```typescript
// apps/core/src/mcp/types.ts
import { z } from 'zod';

export const McpServerSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote']),
  // Local (stdio) config
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  // Remote (HTTP) config
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  // Common config
  enabled: z.boolean().default(true),
  timeout: z.number().default(5000),
});

export const McpConfigSchema = z.object({
  servers: z.array(McpServerSchema).default([]),
  pollInterval: z.number().default(5000),
});

export const ConfigSchema = z.object({
  providers: z.record(z.object({
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
```

Run: `pnpm test apps/core/src/mcp/types.test.ts`
Expected: PASS

---

#### Task 3: Create MCP config loader

**Files:**
- Create: `apps/core/src/mcp/config.ts`
- Modify: `apps/core/src/providers/config.ts` (add MCP config support)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { loadMcpConfig, saveMcpServer, removeMcpServer } from './config.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('loadMcpConfig', () => {
  const testDir = join(process.cwd(), '.freecode-test');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return empty config when no config exists', async () => {
    const config = await loadMcpConfig(testDir);
    expect(config.servers).toEqual([]);
  });
});
```

Run: `pnpm test apps/core/src/mcp/config.test.ts`
Expected: FAIL with "Cannot find module './config.js'"

- [ ] **Step 2: Write minimal config implementation**

```typescript
// apps/core/src/mcp/config.ts
import * as fs from 'fs';
import * as path from 'path';
import { McpConfigSchema, type McpConfig, type McpServer, ConfigSchema } from './types.js';

const CONFIG_FILE = 'config.json';

export async function loadMcpConfig(configDir: string): Promise<McpConfig> {
  const configPath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    return { servers: [], pollInterval: 5000 };
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content);

  if (!config.mcp) {
    return { servers: [], pollInterval: 5000 };
  }

  return McpConfigSchema.parse(config.mcp);
}

export async function saveMcpServer(configDir: string, server: McpServer): Promise<void> {
  const configPath = path.join(configDir, CONFIG_FILE);
  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(content);
  }

  if (!config.mcp) {
    config.mcp = { servers: [], pollInterval: 5000 };
  }

  const mcpConfig = config.mcp as { servers: McpServer[] };
  const existingIndex = mcpConfig.servers.findIndex(s => s.name === server.name);

  if (existingIndex >= 0) {
    mcpConfig.servers[existingIndex] = server;
  } else {
    mcpConfig.servers.push(server);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function removeMcpServer(configDir: string, name: string): Promise<void> {
  const configPath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(configPath)) return;

  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content);

  if (!config.mcp) return;

  const mcpConfig = config.mcp as { servers: McpServer[] };
  mcpConfig.servers = mcpConfig.servers.filter(s => s.name !== name);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
```

Run: `pnpm test apps/core/src/mcp/config.test.ts`
Expected: PASS

---

#### Task 4: Create MCP transport implementation

**Files:**
- Create: `apps/core/src/mcp/transport.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createStdioTransport } from './transport.js';

describe('createStdioTransport', () => {
  it('should create transport with command and args', () => {
    const transport = createStdioTransport({
      command: 'npx',
      args: ['-y', '@thisisayande/contextcarry-mcp'],
    });
    expect(transport).toBeDefined();
  });
});
```

Run: `pnpm test apps/core/src/mcp/transport.test.ts`
Expected: FAIL with "Cannot find module './transport.js'"

- [ ] **Step 2: Write transport implementation**

```typescript
// apps/core/src/mcp/transport.ts
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function createStdioTransport(config: StdioTransportConfig): StdioClientTransport {
  return new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: config.env,
  });
}
```

Run: `pnpm test apps/core/src/mcp/transport.test.ts`
Expected: PASS

---

#### Task 5: Create MCP service with Effect/Layer

**Files:**
- Create: `apps/core/src/mcp/service.ts`
- Create: `apps/core/src/mcp/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { McpService, MCPService } from './service.js';
import { Effect } from 'effect';

describe('MCPService', () => {
  it('should have correct interface', async () => {
    const service = yield* Effect.runPromise(
      Effect.provideService(MCPService, McpService.Default)
    );
    expect(service.status).toBeDefined();
    expect(service.connect).toBeDefined();
    expect(service.disconnect).toBeDefined();
  });
});
```

Run: `pnpm test apps/core/src/mcp/service.test.ts`
Expected: FAIL with "Cannot find module './service.js'"

- [ ] **Step 2: Write service implementation**

```typescript
// apps/core/src/mcp/service.ts
import { Context, Effect, Layer } from 'effect';
import { loadMcpConfig } from './config.js';
import { createStdioTransport } from './transport.js';
import type { McpServer, McpClient } from './types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface MCPService {
  readonly status: () => Effect.Effect<Map<string, { status: string; toolCount: number }>>;
  readonly connect: (name: string) => Effect.Effect<void>;
  readonly disconnect: (name: string) => Effect.Effect<void>;
}

export const MCPService = Context.GenericTag<MCPService>('MCPService');

export const MCPLive = Layer.effect(
  MCPService,
  Effect.gen(function* () {
    const clients = new Map<string, McpClient>();
    let config = yield* Effect.promise(() => loadMcpConfig(getConfigDir()));

    const status = () => Effect.succeed(
      new Map(
        config.servers.map(s => [
          s.name,
          {
            status: clients.get(s.name)?.status || 'disconnected',
            toolCount: clients.get(s.name)?.tools.size || 0,
          },
        ])
      )
    );

    const connect = (name: string) => Effect.gen(function* () {
      const server = config.servers.find(s => s.name === name);
      if (!server) {
        yield* Effect.fail(new Error(`MCP server not found: ${name}`));
      }

      if (server.type !== 'local') {
        yield* Effect.fail(new Error('Remote MCP servers not yet supported'));
      }

      const transport = createStdioTransport({
        command: server.command?.[0] || '',
        args: server.command?.slice(1) || [],
        env: server.env,
      });

      const client = new Client({
        name: server.name,
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      yield* Effect.promise(() => client.connect(transport));

      const mcpClient: McpClient = {
        name: server.name,
        status: 'connected',
        tools: new Map(),
        start: async () => {},
        stop: async () => { yield* Effect.promise(() => client.close()); },
      };

      clients.set(name, mcpClient);
    });

    const disconnect = (name: string) => Effect.gen(function* () {
      const client = clients.get(name);
      if (client) {
        yield* Effect.promise(() => client.stop());
        clients.delete(name);
      }
    });

    return { status, connect, disconnect } as MCPService;
  })
);

function getConfigDir(): string {
  const { homedir } = require('os');
  return require('path').join(homedir(), '.freecode');
}
```

- [ ] **Step 3: Export from index.ts**

```typescript
// apps/core/src/mcp/index.ts
export { MCPService, MCPLive, type MCPService } from './service.js';
export type { McpServer, McpConfig, McpClient } from './types.js';
export { loadMcpConfig, saveMcpServer, removeMcpServer } from './config.js';
```

Run: `pnpm test apps/core/src/mcp/service.test.ts`
Expected: PASS (or skip if Effect testing is complex)

---

### Phase 2: CLI Integration

#### Task 6: Create CLI entry point with yargs

**Files:**
- Create: `apps/core/src/cli.ts`
- Modify: `apps/core/package.json` (bin entry)

- [ ] **Step 1: Install yargs**

Run: `pnpm add yargs && pnpm add -D @types/yargs`
Expected: yargs added to dependencies

- [ ] **Step 2: Write cli.ts with MCP subcommands**

```typescript
// apps/core/src/cli.ts
#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { loadMcpConfig, saveMcpServer, removeMcpServer } from './mcp/config.js';
import { getConfigDir } from './providers/config.js';
import { startServer } from './server.js';

interface McpServer {
  name: string;
  type: 'local' | 'remote';
  command?: string[];
  enabled?: boolean;
}

async function listMcpServers() {
  const config = await loadMcpConfig(getConfigDir());
  console.log('\nMCP Servers:');
  console.log('┌────────────────┬─────────┬──────────────┐');
  console.log('│ Name           │ Type    │ Enabled      │');
  console.log('├────────────────┼─────────┼──────────────┤');

  for (const server of config.servers) {
    const name = server.name.padEnd(14);
    const type = server.type.padEnd(7);
    const enabled = server.enabled ? 'yes' : 'no';
    console.log(`│ ${name} │ ${type} │ ${enabled.padEnd(12)} │`);
  }
  console.log('└────────────────┴─────────┴──────────────┘\n');
}

async function addMcpServer(name: string, type: 'local' | 'remote', command: string) {
  const server: McpServer = {
    name,
    type,
    command: command.split(' '),
    enabled: true,
  };
  await saveMcpServer(getConfigDir(), server);
  console.log(`✓ Server "${name}" added to ${getConfigDir()}/config.json`);
}

async function removeMcpServerByName(name: string) {
  await removeMcpServer(getConfigDir(), name);
  console.log(`✓ Server "${name}" removed`);
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command('mcp', 'Manage MCP servers', (yargs) =>
      yargs
        .command('list', 'List configured MCP servers', {}, async () => {
          await listMcpServers();
        })
        .command('add', 'Add new MCP server', (yargs) =>
          yargs
            .positional('name', { type: 'string', demandOption: true })
            .positional('type', { type: 'string', demandOption: true })
            .positional('command', { type: 'string', demandOption: true })
        , async (argv) => {
          await addMcpServer(argv.name, argv.type as 'local' | 'remote', argv.command);
        })
        .command('remove', 'Remove MCP server', (yargs) =>
          yargs.positional('name', { type: 'string', demandOption: true })
        , async (argv) => {
          await removeMcpServerByName(argv.name);
        })
        .demandCommand(1, 'Specify a command')
    )
    .demandCommand(1, 'Specify a command')
    .parseAsync();

  // If no MCP command, start the JSON-RPC server
  if (!argv._.includes('mcp')) {
    startServer();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add startServer export to server.ts**

Modify `server.ts` to export `startServer`:

```typescript
export async function startServer() {
  // existing main() code
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
```

Run: `pnpm build && node dist/cli.js mcp list`
Expected: Lists MCP servers (empty initially)

---

### Phase 3: Tool Integration

#### Task 7: Implement convertMcpTool function

**Files:**
- Create: `apps/core/src/mcp/convert-tool.ts`
- Test: `apps/core/src/mcp/convert-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { convertMcpTool } from './convert-tool.js';

describe('convertMcpTool', () => {
  it('should prefix tool name with server name', () => {
    const mcpTool = {
      name: 'save',
      description: 'Save context',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
    };

    const tool = convertMcpTool(mcpTool, 'contextcarry');
    expect(tool.id).toBe('contextcarry_save');
  });

  it('should use server/toolname as userFacingName', () => {
    const mcpTool = {
      name: 'load',
      description: 'Load context',
      inputSchema: { type: 'object' },
    };

    const tool = convertMcpTool(mcpTool, 'contextcarry');
    expect(tool.behavior.userFacingName).toBe('contextcarry/load');
  });
});
```

Run: `pnpm test apps/core/src/mcp/convert-tool.test.ts`
Expected: FAIL with "Cannot find module './convert-tool.js'"

- [ ] **Step 2: Write convertMcpTool implementation**

```typescript
// apps/core/src/mcp/convert-tool.ts
import type { Tool, ToolContext, ToolResult } from '../tools/tool.types.js';

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export function convertMcpTool(
  mcpTool: McpToolDef,
  serverName: string
): Tool {
  const prefixedName = `${serverName}_${mcpTool.name}`;

  return {
    id: prefixedName,
    description: mcpTool.description ?? '',
    schemas: {
      parameters: convertJsonSchema(mcpTool.inputSchema),
    },
    ui: {
      renderToolUseMessage: () => ({ type: 'tool_use', toolId: prefixedName, args: {}, status: 'pending' }),
      renderToolResultMessage: () => ({ type: 'tool_result', toolId: prefixedName, result: { title: '', output: '' }, status: 'success' }),
      renderToolUseTag: () => ({ label: serverName, color: 'cyan' }),
      renderToolUseProgressMessage: () => ({ type: 'tool_progress', toolId: prefixedName, message: '' }),
      renderToolUseErrorMessage: () => ({ type: 'tool_error', toolId: prefixedName, error: '' }),
      renderToolUseRejectedMessage: () => ({ type: 'tool_rejected', toolId: prefixedName, reason: '' }),
    },
    behavior: {
      isConcurrencySafe: true,
      isDestructive: false,
      interruptBehavior: 'await',
      maxResultSizeChars: 50000,
      userFacingName: `${serverName}/${mcpTool.name}`,
    },
    permissions: {
      operations: ['mcp'],
      requiresApproval: false,
    },
    execute: async (params, ctx) => {
      // This will be connected to MCP client in Phase 3
      return { success: true, result: { title: prefixedName, output: 'MCP tool called' } };
    },
  };
}

function convertJsonSchema(schema: unknown): { type: string; properties?: Record<string, unknown> } {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object' };
  }

  const s = schema as Record<string, unknown>;

  if (s.type === 'object' && s.properties) {
    return {
      type: 'object',
      properties: s.properties as Record<string, unknown>,
    };
  }

  return { type: 'object' };
}
```

Run: `pnpm test apps/core/src/mcp/convert-tool.test.ts`
Expected: PASS

---

#### Task 8: Integrate MCP tools into agent tool system

**Files:**
- Modify: `apps/core/src/tools/index.ts`
- Modify: `apps/core/src/mcp/service.ts`

- [ ] **Step 1: Modify tools/index.ts to accept dynamic tools**

```typescript
// Add at top of tools definition
const mcpTools: Record<string, Tool> = {};

export function registerMcpTool(serverName: string, tool: Tool): void {
  mcpTools[tool.id] = tool;
}

export function unregisterMcpTools(serverName: string): void {
  const prefix = `${serverName}_`;
  for (const key of Object.keys(mcpTools)) {
    if (key.startsWith(prefix)) {
      delete mcpTools[key];
    }
  }
}

export function getMcpTools(): Record<string, Tool> {
  return { ...mcpTools };
}

// Modify getTool to check mcpTools
export function getTool(id: string): Tool | undefined {
  if (tools[id as ToolId]) return tools[id as ToolId] as Tool;
  return mcpTools[id];
}

// Modify listTools to include mcpTools
export function listTools(): { id: string; description: string; parameters: JsonSchema }[] {
  const builtIn = Object.values(tools).map((t) => ({
    id: t.id,
    description: t.description,
    parameters: t.schemas.parameters,
  }));

  const mcp = Object.values(mcpTools).map((t) => ({
    id: t.id,
    description: t.description,
    parameters: t.schemas.parameters,
  }));

  return [...builtIn, ...mcp];
}
```

Run: `pnpm build`
Expected: Build succeeds

---

### Phase 4: Events and Polish

#### Task 9: Add Bus events for MCP

**Files:**
- Modify: `apps/core/src/bus/index.ts`

- [ ] **Step 1: Add new MCP event types and helpers**

```typescript
// Add new event interfaces
export interface MCPServerStartedEvent {
  type: 'mcp.server.started';
  server: string;
  toolCount: number;
}

export interface MCPServerStoppedEvent {
  type: 'mcp.server.stopped';
  server: string;
  reason?: string;
}

export interface MCPServerErrorEvent {
  type: 'mcp.server.error';
  server: string;
  error: string;
}

// Add to BusEvent union
export type BusEvent =
  // ... existing events
  | MCPServerStartedEvent
  | MCPServerStoppedEvent
  | MCPServerErrorEvent

// Add to BusEvents helper
export const BusEvents = {
  // ... existing
  mcpServerStarted: (server: string, toolCount: number) =>
    bus.publish({ type: 'mcp.server.started', server, toolCount } as MCPServerStartedEvent),

  mcpServerStopped: (server: string, reason?: string) =>
    bus.publish({ type: 'mcp.server.stopped', server, reason } as MCPServerStoppedEvent),

  mcpServerError: (server: string, error: string) =>
    bus.publish({ type: 'mcp.server.error', server, error } as MCPServerErrorEvent),
}
```

Run: `pnpm build && pnpm test`
Expected: Build and tests pass

---

### Phase 5: Integration Testing

#### Task 10: End-to-end test with contextcarry MCP

**Files:**
- Test: Manual test

- [ ] **Step 1: Add contextcarry server to config**

Run: `node dist/cli.js mcp add contextcarry local "npx -y @thisisayande/contextcarry-mcp"`
Expected: Server added to config

- [ ] **Step 2: List servers**

Run: `node dist/cli.js mcp list`
Expected: Shows contextcarry as enabled

- [ ] **Step 3: Start server and verify tools available**

This step requires the MCP server to be running and tools to be integrated into the agent loop. This is a Phase 5 integration task.

---

## Dependencies Summary

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "yargs": "^17.x"
}
```

---

## Error Handling

| Error | Handling |
|-------|----------|
| MCP server not found | Show error: `Server "${name}" not found in config` |
| Server process exits | Mark server as disconnected, emit `MCPServerStopped` event |
| Tool call timeout | Return error with timeout message after configured timeout |
| Invalid tool schema | Log warning, skip tool registration |
| Config parse error | Show Zod validation errors |

---

## Testing Commands

```bash
# Run all MCP tests
pnpm test apps/core/src/mcp/

# Run specific test
pnpm test apps/core/src/mcp/convert-tool.test.ts

# Build
pnpm build

# Test CLI
node dist/cli.js mcp list
node dist/cli.js mcp add test local "npx -y some-mcp-server"
node dist/cli.js mcp remove test
```