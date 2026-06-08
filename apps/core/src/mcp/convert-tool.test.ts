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
