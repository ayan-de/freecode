// Browser-compatible stub for IPC client
// The actual child_process-based client runs in the extension host, not the webview

export interface ToolListItem {
  name: string;
  description?: string;
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
}

export function startCli(): void {
  console.log('[IPC Stub] startCli called - extension host handles CLI');
}

export async function listTools(): Promise<ToolListItem[]> {
  console.log('[IPC Stub] listTools called');
  return [
    { name: 'read_file', description: 'Read a file' },
    { name: 'write_file', description: 'Write a file' },
  ];
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  console.log('[IPC Stub] callTool called:', name, args);
  return { success: true, output: 'Tool called (stub)' };
}

export function stopCli(): void {
  console.log('[IPC Stub] stopCli called');
}