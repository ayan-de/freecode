import type { Tool } from "../tools/tool.types.js";
import type { JsonSchema, JsonSchemaProperty } from "../tools/tool.types.js";
import { getClient, getClientTimeout } from "./client-registry.js";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
  /**
   * Optional MCP tool annotations. `readOnlyHint` is the only one we act on:
   * it drives both the permission classification (see `permission/
   * mode-policy.ts`) and `isDestructive` below.
   */
  annotations?: { readOnlyHint?: boolean };
}

interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export function convertMcpTool(mcpTool: McpToolDef, serverName: string): Tool {
  // Use mcp__server__tool format for permission rule matching
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`;
  // Only an explicit `true` counts — an absent annotation says nothing about
  // the tool, and guessing "harmless" is how a create_issue call gets retried.
  const isReadOnly = mcpTool.annotations?.readOnlyHint === true;

  return {
    id: prefixedName,
    description: mcpTool.description ?? "",
    schemas: {
      parameters: convertJsonSchema(mcpTool.inputSchema),
    },
    behavior: {
      isConcurrencySafe: true,
      // Both retry paths (tools/orchestrator.ts, agent/recovery/manager.ts)
      // read this as "safe to silently re-run". It was hardcoded false, so a
      // transient failure could re-issue a mutation — running create_issue
      // twice. Anything not declared read-only is now single-attempt.
      isDestructive: !isReadOnly,
      interruptBehavior: "await",
      maxResultSizeChars: 50000,
      userFacingName: `${serverName}/${mcpTool.name}`,
    },
    permissions: {
      operations: ["mcp"],
      requiresApproval: false,
    },
    execute: async (params, _ctx) => {
      const client = getClient(serverName);
      if (!client) {
        return {
          success: false,
          error: `MCP server '${serverName}' not connected`,
        };
      }

      try {
        const args = params as Record<string, unknown>;
        const timeout = getClientTimeout(serverName);
        const result = (await client.callTool(
          { name: mcpTool.name, arguments: args },
          undefined,
          { timeout },
        )) as CallToolResult;
        // MCP returns { content: [{ type: 'text', text: '...' }] }
        const output = result.content
          .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");
        return { success: true, result: { title: prefixedName, output } };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  };
}

function convertJsonSchema(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== "object") {
    return { type: "object" };
  }

  const s = schema as Record<string, unknown>;

  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    const props = s.properties as Record<string, unknown>;
    const converted: Record<string, JsonSchemaProperty> = {};
    for (const [key, value] of Object.entries(props)) {
      converted[key] = convertProperty(value);
    }
    return {
      type: "object",
      properties: converted,
    };
  }

  return { type: "object" };
}

function convertProperty(value: unknown): JsonSchemaProperty {
  if (!value || typeof value !== "object") {
    return { type: "string" };
  }
  const v = value as Record<string, unknown>;
  return {
    description: v.description as string | undefined,
    type: v.type as string | undefined,
    enum: v.enum as string[] | undefined,
  };
}
