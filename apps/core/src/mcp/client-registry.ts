import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Registry of connected MCP clients, keyed by server name
const clients = new Map<string, Client>();

export function registerClient(name: string, client: Client): void {
  clients.set(name, client);
}

export function getClient(name: string): Client | undefined {
  return clients.get(name);
}

export function removeClient(name: string): void {
  clients.delete(name);
}

export function listClients(): string[] {
  return Array.from(clients.keys());
}