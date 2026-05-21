export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface StreamResponse {
  type: 'text' | 'code' | 'tool' | 'done' | 'error';
  content: string;
}

export interface ToolListItem {
  name: string;
  description?: string;
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
}