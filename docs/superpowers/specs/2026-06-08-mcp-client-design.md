# FreeCode — MCP Client Integration Design

**Date:** 2026-06-08
**Status:** Draft
**Supersedes:** N/A
**Reference:** opencode's MCP implementation, architecture-v3.md spec

---

## Overview

MCP (Model Context Protocol) integration allows FreeCode to connect to external MCP servers and expose their tools to the agent. This document covers the **MCP Client** implementation only — FreeCode acting as an MCP client that connects to external servers.

Future work (separate spec) will cover MCP Server implementation (FreeCode exposing its own tools via MCP protocol).

---

## Goals

1. FreeCode CLI can manage MCP server connections via `freecode mcp` command
2. MCP tools from external servers automatically appear in the agent's tool list
3. Config stored in `~/.freecode/config.json` with `mcp.servers` array
4. Bus events published when MCP tools change
5. Graceful handling of MCP server startup, shutdown, and tool changes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           freecode mcp CLI                                  │
│                                                                             │
│  freecode mcp list                    # List configured servers              │
│  freecode mcp add <name> <command>   # Add new MCP server                  │
│  freecode mcp remove <name>          # Remove MCP server                    │
│  freecode mcp start <name>           # Start MCP server                     │
│  freecode mcp stop <name>            # Stop MCP server                       │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             │ Reads/Writes
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ~/.freecode/config.json                                  │
│                                                                             │
│  {                                                                       │
│    "providers": { ... },                                                 │
│    "mcp": {                                                               │
│      "servers": [                                                        │
│        {                                                                 │
│          "name": "contextcarry",                                        │
│          "type": "local",                                               │
│          "command": ["npx", "-y", "@thisisayande/contextcarry-mcp"],    │
│          "enabled": true                                                │
│        }                                                                 │
│      ]                                                                   │
│    }                                                                     │
│  }                                                                       │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             │ Effect/Layer DI
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MCP Service (apps/core/src/mcp/)                         │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ MCP.Service     │  │ Transport       │  │ Tool Converter              │  │
│  │ - status()      │  │ - StdioClient   │  │ - convertMcpTool()          │  │
│  │ - clients()     │  │ - HTTPClient    │  │ - prefix with server name   │  │
│  │ - tools()       │  │ - SSEClient     │  │                             │  │
│  │ - connect()     │  │                 │  │                             │  │
│  │ - disconnect()  │  │                 │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Bus Events                                                           │   │
│  │ - MCPToolsChanged (when server tools change)                        │   │
│  │ - MCPServerStarted / MCPServerStopped                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             │ Tools exposed
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Agent Tool System                                   │
│                                                                             │
│  Built-in tools: read, write, edit, glob, grep, bash, skill, agent, etc.    │
│  MCP tools:      contextcarry_save, contextcarry_load, etc. (prefixed)     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Config Schema

```typescript
// apps/core/src/mcp/types.ts

export const McpServerSchema = z.object({
  name: z.string(),
  type: z.enum(["local", "remote"]),
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
})

export const ConfigSchema = z.object({
  // ... existing fields
  mcp: z.object({
    servers: z.array(McpServerSchema).default([]),
    pollInterval: z.number().default(5000),
  }).optional(),
})
```

---

## File Structure

```
apps/core/src/mcp/
├── index.ts              # MCP.Service + Layer export
├── types.ts             # McpServer, McpTool, McpClient interfaces
├── service.ts           # MCP.Service implementation (Effect/Layer)
├── transport.ts         # StdioClientTransport, HttpClientTransport
├── convert-tool.ts      # convertMcpTool() - MCP Tool → FreeCode Tool
├── config.ts            # MCP config loading from ~/.freecode/config.json
└── types.ts
```

---

## CLI Interface

### `freecode mcp`

```
▄▄▄▄▄▄▄▄▄▄▄▄▄▄
█ MCP Server █  FreeCode MCP Client Management
▀▀▀▀▀▀▀▀▀▀▀▀▀▀

Commands:
  freecode mcp list                    List configured MCP servers
  freecode mcp add <name> <command>    Add new MCP server
  freecode mcp remove <name>           Remove MCP server
  freecode mcp start <name>            Start MCP server
  freecode mcp stop <name>             Stop MCP server

Options:
  -h, --help                           Show help
```

### `freecode mcp list`

```
MCP Servers:
┌────────────────┬─────────┬──────────────┬───────────────────────────┐
│ Name           │ Type    │ Status       │ Tools                      │
├────────────────┼─────────┼──────────────┼───────────────────────────┤
│ contextcarry   │ local   │ connected    │ save, load, query          │
│ filesystem     │ local   │ connected    │ read, write, ls, glob     │
│ github         │ remote  │ disconnected │ create_issue, get_pr      │
└────────────────┴─────────┴──────────────┴───────────────────────────┘
```

### `freecode mcp add`

Interactive wizard using `@clack/prompts`:

```
freecode mcp add

? Server name: contextcarry
? Server type: (Use arrow keys)
  ❯ local (stdio)
  ○ remote (HTTP)
? Command: npx -y @thisisayande/contextcarry-mcp
? Enable server? Yes

✓ Server "contextcarry" added to ~/.freecode/config.json
✓ Run `freecode mcp start contextcarry` to connect
```

---

## MCP Service Interface

```typescript
// apps/core/src/mcp/service.ts

import { Context, Effect, Layer } from "effect"

export interface MCPClient {
  readonly name: string
  readonly status: "connected" | "disconnected" | "starting" | "failed"
  readonly tools: Map<string, Tool>
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
}

export interface MCPService {
  readonly status: () => Effect.Effect<Map<string, { status: string; toolCount: number }>>
  readonly clients: () => Effect.Effect<Map<string, MCPClient>>
  readonly tools: () => Effect.Effect<Map<string, Tool>>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
}

export const MCPService = Context.GenericTag<MCPService>("MCPService")

export const MCPLive = Layer.effect(
  MCPService,
  Effect.gen(function* () {
    // Implementation
  })
)
```

---

## Tool Conversion

MCP tools are converted to FreeCode tools with server-name prefix:

```typescript
// apps/core/src/mcp/convert-tool.ts

import type { Tool } from "../tools/tool.types"

export function convertMcpTool(
  mcpTool: { name: string; description?: string; inputSchema: unknown },
  serverName: string
): Tool {
  const prefixedName = `${serverName}_${mcpTool.name}`

  return {
    id: prefixedName,
    description: mcpTool.description ?? "",
    schemas: {
      parameters: convertJsonSchema(mcpTool.inputSchema),
    },
    ui: defaultToolUI,
    behavior: {
      isConcurrencySafe: true,
      isDestructive: false,
      interruptBehavior: "await",
      maxResultSizeChars: 50000,
      userFacingName: `${serverName}/${mcpTool.name}`,
    },
    permissions: {
      operations: ["mcp"],
      requiresApproval: false,
    },
    execute: async (params, ctx) => {
      const client = yield* getMcpClient(serverName)
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: params,
      })
      return formatToolResult(result)
    },
  }
}
```

---

## Bus Events

```typescript
// apps/core/src/bus/events.ts

export const BusEvents = {
  // ... existing events

  MCPToolsChanged: BusEvent.define(
    "mcp.tools.changed",
    Schema.Struct({
      server: Schema.String,
      added: Schema.Array(ToolDef),
      removed: Schema.Array(Schema.String),
    })
  ),

  MCPServerStarted: BusEvent.define(
    "mcp.server.started",
    Schema.Struct({
      server: Schema.String,
      toolCount: Schema.Number,
    })
  ),

  MCPServerStopped: BusEvent.define(
    "mcp.server.stoped",
    Schema.Struct({
      server: Schema.String,
      reason: Schema.String.optional(),
    })
  ),

  MCPServerError: BusEvent.define(
    "mcp.server.error",
    Schema.Struct({
      server: Schema.String,
      error: Schema.String,
    })
  ),
}
```

---

## Transport Implementation

### Stdio Transport (Local MCP Servers)

```typescript
// apps/core/src/mcp/transport.ts

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

export const createStdioTransport = (config: {
  command: string
  args: string[]
  env?: Record<string, string>
}) => {
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  })
}
```

### HTTP Transport (Remote MCP Servers)

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamable-http.js"

export const createHttpTransport = (config: {
  url: string
  headers?: Record<string, string>
}) => {
  return new StreamableHTTPClientTransport(config.url, {
    headers: config.headers,
  })
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `apps/core/src/mcp/` directory structure
- [ ] Define MCP types and schemas (Zod validation)
- [ ] Implement `MCPService` with Effect/Layer DI
- [ ] Implement StdioClientTransport for local servers

### Phase 2: CLI Integration
- [ ] Add `freecode mcp` command with yargs
- [ ] Implement `mcp list`, `mcp add`, `mcp remove` subcommands
- [ ] Implement `mcp start`, `mcp stop` subcommands
- [ ] Update config loading to include MCP servers

### Phase 3: Tool Integration
- [ ] Implement `convertMcpTool()` function
- [ ] Integrate MCP tools into agent tool system
- [ ] Add tool prefixing (`servername_toolname`)
- [ ] Handle tool result formatting

### Phase 4: Events and Polish
- [ ] Implement Bus events (MCPToolsChanged, etc.)
- [ ] Handle ToolListChanged notifications from servers
- [ ] Add connection status tracking
- [ ] Implement graceful shutdown

### Phase 5: Remote Support (Future)
- [ ] HTTP transport for remote MCP servers
- [ ] OAuth support for authenticated servers
- [ ] SSE fallback transport

---

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

Added to `apps/core/package.json`.

---

## Error Handling

| Error | Handling |
|-------|----------|
| MCP server not found | Show error with install suggestion |
| Server process exits | Mark server as disconnected, emit event |
| Tool call timeout | Return error with timeout message |
| Invalid tool schema | Log warning, skip tool registration |
| Config parse error | Show Zod validation errors |

---

## Testing Strategy

1. **Unit tests** — `convertMcpTool()`, config parsing, tool prefixing
2. **Integration tests** — Start real MCP server, verify tools exposed
3. **E2E tests** — Full flow: config → connect → call tool → verify result

---

## Reference Implementation

opencode's MCP implementation was used as reference:
- `packages/opencode/src/mcp/index.ts` — Service pattern
- `packages/opencode/src/cli/cmd/mcp.ts` — CLI structure
- `packages/core/src/v1/config/mcp.ts` — Config schema