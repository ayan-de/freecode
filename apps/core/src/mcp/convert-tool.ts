import type { Tool } from '../tools/tool.types.js';
import type { JsonSchema, JsonSchemaProperty } from '../tools/tool.types.js';
import { getClient } from './client-registry.js';

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
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
    execute: async (params, _ctx) => {
      const client = getClient(serverName);
      if (!client) {
        return { success: false, error: `MCP server '${serverName}' not connected` };
      }

      try {
        const args = params as Record<string, unknown>;
        const result = await client.callTool(
          { name: mcpTool.name, arguments: args }
        ) as CallToolResult;
        // MCP returns { content: [{ type: 'text', text: '...' }] }
        const output = result.content
          .map((c) => c.type === 'text' ? c.text : JSON.stringify(c))
          .join('\n');
        return { success: true, result: { title: prefixedName, output } };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  };
}

function convertJsonSchema(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object' };
  }

  const s = schema as Record<string, unknown>;

  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, unknown>;
    const converted: Record<string, JsonSchemaProperty> = {};
    for (const [key, value] of Object.entries(props)) {
      converted[key] = convertProperty(value);
    }
    return {
      type: 'object',
      properties: converted,
    };
  }

  return { type: 'object' };
}

function convertProperty(value: unknown): JsonSchemaProperty {
  if (!value || typeof value !== 'object') {
    return { type: 'string' };
  }
  const v = value as Record<string, unknown>;
  return {
    description: v.description as string | undefined,
    type: v.type as string | undefined,
    enum: v.enum as string[] | undefined,
  };
}
