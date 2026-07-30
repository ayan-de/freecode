# MCP Integration Guide

This guide explains how to integrate MCP (Model Context Protocol) servers with FreeCode to extend the agent's capabilities with external tools.

## What is MCP?

MCP (Model Context Protocol) is an open protocol that allows AI applications to connect to external tools and services. By integrating MCP servers with FreeCode, you can give your AI assistant access to a wide range of capabilities including:

- File system operations
- GitHub integration
- Database access
- Custom API integrations
- And much more through community-built MCP servers

## Architecture Overview

FreeCode acts as an MCP **client** that connects to external MCP servers. When a server is connected, its tools automatically become available to the agent.

```
┌─────────────────────────────────────────────────────────────────┐
│                         FreeCode CLI                            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │ Built-in    │  │ MCP Tools   │  │ Agent Loop              │ │
│  │ Tools       │  │ (from       │  │ - Receives user prompt │ │
│  │ read,write, │  │ external    │  │ - Selects appropriate  │ │
│  │ edit,bash   │  │ servers)    │  │   tools to use          │ │
│  └─────────────┘  └─────────────┘  └────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ Stdio (local) or HTTP (remote)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Servers (External)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ filesystem   │  │ github       │  │ contextcarry        │ │
│  │ server       │  │ server       │  │ server              │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- FreeCode installed
- Node.js (for local MCP servers that use npx)
- Access to MCP servers you want to connect

### Step 1: Add an MCP Server

Use the `freecode mcp add` command to add a new MCP server:

```bash
# Add a local (stdio) MCP server
freecode mcp add <name> local "<command>"

# Example: Add contextcarry MCP server
freecode mcp add contextcarry local "npx -y @thisisayande/contextcarry-mcp"
```

### Step 2: List Configured Servers

Verify your server was added:

```bash
freecode mcp list
```

Output:
```
MCP Servers:
┌────────────────┬─────────┬──────────────┐
│ Name           │ Type    │ Enabled      │
├────────────────┼─────────┼──────────────┤
│ contextcarry   │ local   │ yes          │
└────────────────┴─────────┴──────────────┘
```

### Step 3: Start the Server

MCP servers are automatically started when you run FreeCode. If you need to start them manually:

```bash
freecode mcp start <server-name>
```

### Step 4: Use MCP Tools

When the agent runs, it will automatically discover and use MCP tools from connected servers. Tools are prefixed with the server name (e.g., `contextcarry_save`, `github_create_issue`).

## CLI Commands Reference

### `freecode mcp list`

Lists all configured MCP servers.

```bash
freecode mcp list
```

### `freecode mcp add`

Adds a new MCP server configuration.

```bash
freecode mcp add <name> <type> <command>
```

**Arguments:**

- `<name>` - Unique name for this server
- `<type>` - Server type: `local` or `remote`
- `<command>` - Command to run (for local servers)

**Example:**

```bash
# Add a filesystem MCP server
freecode mcp add filesystem local "npx -y @modelcontextprotocol/server-filesystem /path/to/directory"

# Add GitHub MCP server
freecode mcp add github local "npx -y @modelcontextprotocol/server-github"
```

### `freecode mcp remove`

Removes an MCP server configuration.

```bash
freecode mcp remove <server-name>
```

### `freecode mcp start`

Manually starts a specific MCP server.

```bash
freecode mcp start <server-name>
```

### `freecode mcp stop`

Manually stops a specific MCP server.

```bash
freecode mcp stop <server-name>
```

## Configuration File

MCP server configurations are stored in `~/.freecode/config.json` under the `mcp` key.

### Manual Configuration

You can also edit the config file directly:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "your-api-key"
    }
  },
  "mcp": {
    "servers": [
      {
        "name": "contextcarry",
        "type": "local",
        "command": ["npx", "-y", "@thisisayande/contextcarry-mcp"],
        "enabled": true,
        "timeout": 5000
      },
      {
        "name": "filesystem",
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
        "enabled": true,
        "timeout": 5000,
        "env": {
          "DEBUG": "true"
        }
      }
    ],
    "pollInterval": 5000
  }
}
```

### Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the server |
| `type` | string | Yes | `local` (stdio) or `remote` (HTTP) |
| `command` | array | No* | Command and arguments to run (local only) |
| `args` | array | No | Additional arguments |
| `env` | object | No | Environment variables |
| `url` | string | No* | HTTP URL (remote only) |
| `headers` | object | No | HTTP headers (remote only) |
| `enabled` | boolean | No | Whether to auto-connect (default: true) |
| `timeout` | number | No | Timeout in ms (default: 5000) |

*Required based on server type

## Popular MCP Servers

Here are some popular MCP servers you can integrate with FreeCode:

### File System

```bash
freecode mcp add filesystem local "npx -y @modelcontextprotocol/server-filesystem /your/project/path"
```

Provides file operations: read, write, list, glob.

### GitHub

```bash
freecode mcp add github local "npx -y @modelcontextprotocol/server-github"
```

Provides GitHub operations: create issues, PRs, search repositories.

### PostgreSQL

```bash
freecode mcp add postgres local "npx -y @modelcontextprotocol/server-postgres"
```

Provides database operations: query, execute, list tables.

### Memory/Context

```bash
freecode mcp add contextcarry local "npx -y @thisisayande/contextcarry-mcp"
```

Provides persistent context across conversations.

### Puppeteer (Browser Automation)

```bash
freecode mcp add puppeteer local "npx -y @modelcontextprotocol/server-puppeteer"
```

Provides browser automation capabilities.

## How MCP Tools Work

### Tool Naming

MCP tools are automatically prefixed with the server name to avoid conflicts:

```
servername_toolname
```

For example, if you have a server named `github`:
- `github_create_issue`
- `github_get_pull_request`
- `github_search_repositories`

### Tool Execution

When you use an MCP tool:

1. FreeCode forwards the request to the connected MCP server
2. The MCP server executes the tool
3. Results are returned to FreeCode and displayed in the conversation

### Permissions

MCP tools have the `mcp` operation permission and by default don't require approval. This can be adjusted in the tool conversion code if needed.

## Troubleshooting

### Server Not Starting

**Problem:** MCP server fails to start

**Solutions:**

1. Check the command is correct:
   ```bash
   # Test the command directly in terminal
   npx -y @modelcontextprotocol/server-filesystem /path
   ```

2. Verify the server package exists:
   ```bash
   npm search @modelcontextprotocol/server-filesystem
   ```

3. Check for missing dependencies - some servers require additional setup

### Tools Not Appearing

**Problem:** Server connects but tools don't appear

**Solutions:**

1. Verify the server is connected:
   ```bash
   freecode mcp list
   ```

2. Check server logs in the FreeCode output

3. Restart FreeCode to reinitialize connections:
   ```bash
   freecode mcp stop <server-name>
   freecode mcp start <server-name>
   ```

### Connection Timeout

**Problem:** Tool calls timeout

**Solutions:**

1. Increase timeout in config:
   ```json
   {
     "name": "myserver",
     "timeout": 30000
   }
   ```

2. Check if the server process is still running

### Permission Denied

**Problem:** Getting permission errors when calling tools

**Solutions:**

1. Check that the server process has necessary permissions
2. For file operations, verify the directory is accessible
3. For API operations, ensure required tokens are configured in environment

## Advanced Configuration

### Environment Variables

Pass environment variables to local servers:

```json
{
  "name": "custom",
  "type": "local",
  "command": ["node", "/path/to/server.js"],
  "env": {
    "API_KEY": "your-key-here",
    "DEBUG": "true"
  }
}
```

### Multiple Server Instances

Run multiple instances of the same server type with different configurations:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "projects-files",
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
      },
      {
        "name": "docs-files",
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
      }
    ]
  }
}
```

### Remote MCP Servers

Remote servers connect via HTTP (note: remote support is in development):

```json
{
  "name": "remote-api",
  "type": "remote",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

## Developer Guide

If you're developing an MCP server to integrate with FreeCode:

### Server Requirements

1. Implement the MCP protocol (use `@modelcontextprotocol/sdk`)
2. Expose tools via the standard `tools/list` and `tools/call` methods
3. Use JSON Schema for tool input validation

### Example MCP Server Structure

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  {
    name: "my-custom-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "my_tool",
        description: "Does something useful",
        inputSchema: {
          type: "object",
          properties: {
            param1: { type: "string", description: "First parameter" },
          },
          required: ["param1"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "my_tool") {
    // Execute tool logic
    return {
      content: [
        { type: "text", text: "Tool executed successfully" },
      ],
    };
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Security Considerations

1. **Trust MCP servers** - Only connect to servers you trust, as they can execute code on your system
2. **Environment variables** - Don't store sensitive values in config.json; use environment variables
3. **File access** - Be careful with filesystem servers, they can read/write to configured directories
4. **API tokens** - Store API tokens securely, not in plain text config files

## Frequently Asked Questions

**Q: Can I use multiple MCP servers at once?**
A: Yes, FreeCode can connect to multiple MCP servers simultaneously. All tools will be available to the agent.

**Q: Do MCP tools require approval before execution?**
A: By default, MCP tools don't require approval. You can modify this in the tool permissions if needed.

**Q: Can I create my own MCP server?**
A: Yes, you can create any server that implements the MCP protocol. See the Developer Guide section.

**Q: What's the difference between local and remote servers?**
A: Local servers run as subprocesses on your machine (stdio). Remote servers connect over HTTP. Local is more common for development tools.

**Q: How do MCP tools appear in the agent?**
A: MCP tools are prefixed with the server name (e.g., `github_create_issue`) and appear alongside built-in tools when the agent decides which tools to use.

## See Also

- [MCP Client Design Spec](./superpowers/specs/2026-06-08-mcp-client-design.md)
- [MCP Client Implementation Plan](./superpowers/plans/2026-06-08-mcp-client-plan.md)
- [Official MCP Documentation](https://modelcontextprotocol.io)
