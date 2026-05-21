import { spawn, type ChildProcess } from 'child_process';
import type { JsonRpcRequest, JsonRpcResponse, ToolListItem, ToolCallResult } from './protocol.js';

let requestId = 0;
let cliProcess: ChildProcess | null = null;
let messageBuffer = '';
let pendingRequests = new Map<number | string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function generateId(): number {
  return ++requestId;
}

function parseResponse(data: string): JsonRpcResponse[] {
  const responses: JsonRpcResponse[] = [];
  const lines = data.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      responses.push(JSON.parse(line) as JsonRpcResponse);
    } catch {}
  }
  return responses;
}

export function startCli(): void {
  if (cliProcess) return;

  cliProcess = spawn('node', ['apps/cli/src/server.ts'], {
    cwd: '/home/ayande/Project/freecode',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  cliProcess.stdout?.setEncoding('utf-8');
  cliProcess.stderr?.on('data', (data) => {
    console.error('[CLI stderr]', data.toString());
  });

  cliProcess.stdout?.on('data', (data: string) => {
    messageBuffer += data;
    const responses = parseResponse(messageBuffer);
    messageBuffer = '';

    for (const response of responses) {
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  });

  cliProcess.on('error', (err) => {
    console.error('[CLI process error]', err);
    cliProcess = null;
  });

  cliProcess.on('exit', () => {
    cliProcess = null;
  });
}

function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error('CLI not running'));
      return;
    }

    const id = generateId();
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

    cliProcess.stdin.write(JSON.stringify(request) + '\n');
  });
}

export async function listTools(): Promise<ToolListItem[]> {
  return (await sendRequest('tools.list')) as ToolListItem[];
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return (await sendRequest('tools.call', { name, args })) as ToolCallResult;
}

export function stopCli(): void {
  if (cliProcess) {
    cliProcess.kill();
    cliProcess = null;
  }
}