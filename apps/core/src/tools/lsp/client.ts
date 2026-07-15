// =============================================================================
// Minimal LSP client — JSON-RPC over a server's stdio with Content-Length
// framing. Supports the subset freecode needs: diagnostics, hover, definition,
// references. Servers are spawned lazily and reused per (command, root).
// =============================================================================

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  serverForExtension,
  languageIdForExtension,
  type ServerSpec,
} from "./registry.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface Diagnostic {
  range: { start: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

class ServerConnection {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private openDocs = new Set<string>();
  private initialized: Promise<void>;

  constructor(spec: ServerSpec, private root: string) {
    this.proc = spawn(spec.command, spec.args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", () => {
      /* swallow server logs */
    });
    this.initialized = this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.root).href,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: {},
          references: {},
        },
      },
      workspaceFolders: [
        { uri: pathToFileURL(this.root).href, name: path.basename(this.root) },
      ],
    });
    this.notify("initialized", {});
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf-8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.handleMessage(JSON.parse(body));
      } catch {
        /* ignore malformed message */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === "number" && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = msg.error as { message?: string };
        p.reject(new Error(err.message ?? "LSP error"));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri: string; diagnostics: Diagnostic[] };
      this.diagnostics.set(params.uri, params.diagnostics ?? []);
    }
  }

  private send(payload: Record<string, unknown>): void {
    const json = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n${json}`;
    this.proc.stdin.write(message);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request '${method}' timed out`));
        }
      }, 15_000);
    });
  }

  async openDocument(file: string): Promise<void> {
    await this.initialized;
    const uri = pathToFileURL(file).href;
    if (this.openDocs.has(uri)) return;
    const text = fs.readFileSync(file, "utf-8");
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: languageIdForExtension(path.extname(file)),
        version: 1,
        text,
      },
    });
    this.openDocs.add(uri);
  }

  async diagnosticsFor(file: string): Promise<Diagnostic[]> {
    const uri = pathToFileURL(file).href;
    await this.openDocument(file);
    // Diagnostics arrive asynchronously after didOpen; poll briefly.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (this.diagnostics.has(uri)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return this.diagnostics.get(uri) ?? [];
  }

  async requestAt(
    method: string,
    file: string,
    line: number,
    character: number,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    await this.openDocument(file);
    return this.request(method, {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line, character },
      ...extra,
    });
  }

  dispose(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

// Pool of live servers keyed by command + root.
const pool = new Map<string, ServerConnection>();

function getConnection(file: string, root: string): ServerConnection | undefined {
  const spec = serverForExtension(path.extname(file));
  if (!spec) return undefined;
  const key = `${spec.command}::${root}`;
  let conn = pool.get(key);
  if (!conn) {
    try {
      conn = new ServerConnection(spec, root);
    } catch {
      return undefined;
    }
    pool.set(key, conn);
  }
  return conn;
}

export function hasServerFor(file: string): boolean {
  return serverForExtension(path.extname(file)) !== undefined;
}

export async function getDiagnostics(
  file: string,
  root: string,
): Promise<Diagnostic[]> {
  const conn = getConnection(file, root);
  if (!conn) throw new Error("No LSP server available for this file type");
  return conn.diagnosticsFor(file);
}

export async function lspRequest(
  operation: "hover" | "definition" | "references",
  file: string,
  root: string,
  line: number,
  character: number,
): Promise<unknown> {
  const conn = getConnection(file, root);
  if (!conn) throw new Error("No LSP server available for this file type");
  const method =
    operation === "hover"
      ? "textDocument/hover"
      : operation === "definition"
        ? "textDocument/definition"
        : "textDocument/references";
  const extra =
    operation === "references" ? { context: { includeDeclaration: false } } : {};
  return conn.requestAt(method, file, line, character, extra);
}

export function disposeAll(): void {
  for (const conn of pool.values()) conn.dispose();
  pool.clear();
}

export type { Diagnostic };
