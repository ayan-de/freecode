import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface RegisteredClient {
  client: Client;
  timeout: number;
}

// Registry of connected MCP clients, keyed by server name
const clients = new Map<string, RegisteredClient>();

export function registerClient(
  name: string,
  client: Client,
  timeout: number = 30000,
): void {
  clients.set(name, { client, timeout });
}

export function getClient(name: string): Client | undefined {
  return clients.get(name)?.client;
}

export function getClientTimeout(name: string): number {
  return clients.get(name)?.timeout ?? 30000;
}

export function removeClient(name: string): void {
  clients.delete(name);
}

export function listClients(): string[] {
  return Array.from(clients.keys());
}
