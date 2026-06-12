# Multi-Provider API Support Design

## Status: Approved (pending implementation)

---

## Overview

Add direct API support for Anthropic, OpenAI, Gemini, and MiniMax using provider SDKs. Browser automation (Playwright) remains as a future TODO in `apps/core/src/browser/`.

## Architecture

### Directory Structure

```
apps/core/src/providers/
├── index.ts              # Public exports: listProviders(), getProvider(), createProvider()
├── types.ts              # Shared types: ProviderInfo, ExecuteOptions, ExecuteResult
├── config.ts             # API key resolution: config file → env var → error
├── anthropic.ts          # @ai-sdk/anthropic wrapper
├── openai.ts             # @ai-sdk/openai wrapper
├── gemini.ts             # @ai-sdk/google (Google AI / Vertex AI)
├── minimax.ts            # Custom fetch-based (OpenAI-compatible API)
└── registry.ts           # Provider registry Map<string, ProviderDefinition>
```

`apps/core/src/browser/` remains unchanged — Playwright automation is TODO.

---

## Core Types

### `types.ts`

```typescript
export interface ProviderInfo {
  id: string; // "anthropic" | "openai" | "gemini" | "minimax"
  name: string; // "Anthropic" | "OpenAI" | "Gemini" | "MiniMax"
  defaultModel: string; // "claude-sonnet-4-5" | "gpt-4o" | "gemini-2.0-flash" | "MiniMax-text-01"
  supportsStreaming: boolean;
  supportsTools: boolean;
}

export interface ExecuteOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
  stream?: boolean; // default false
}

export interface ExecuteResult {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
  stopReason: "stop" | "tool_use" | "max_tokens" | "unknown";
  provider: string;
  model: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
```

---

## Config Key Resolution

### `config.ts`

API keys resolved in priority order:

1. `providers[id].apiKey` in `~/.freecode/config.json`
2. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `MINIMAX_API_KEY` env vars
3. Error with clear message listing both sources

**Config file location** uses `os.homedir()` for cross-platform:

```typescript
import * as os from "os";
import * as path from "path";

export const CONFIG_DIR = path.join(os.homedir(), ".freecode");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
```

**`config.json` schema:**

```json
{
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." },
    "gemini": { "apiKey": "AIza..." },
    "minimax": { "apiKey": "..." }
  }
}
```

### Platform-Independent File Operations

All file I/O uses Node.js `fs` with `path.join()` and `os.homedir()`:

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Config directory: ~/.freecode (Linux/Mac) or %USERPROFILE%\.freecode (Windows)
const configDir = path.join(os.homedir(), ".freecode");
const configFile = path.join(configDir, "config.json");

// Ensure directory exists (mkdirSync with recursive: true works on all platforms)
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Read config
function readConfig(): Record<string, unknown> {
  if (!fs.existsSync(configFile)) return {};
  return JSON.parse(fs.readFileSync(configFile, "utf-8"));
}
```

---

## Provider Implementations

### Provider Interface

```typescript
export interface AIProvider {
  info: ProviderInfo;
  execute(opts: ExecuteOptions): Promise<ExecuteResult>;
  executeStream?(
    opts: ExecuteOptions,
  ): AsyncGenerator<ExecuteResult, void, void>;
}
```

### `anthropic.ts`

- Package: `@ai-sdk/anthropic`
- Creates anthropic LLM via `createAnthropic({ apiKey })`
- Uses `generateText()` for non-streaming
- Maps `tools` to Vercel's `tool` format
- Default model: `claude-sonnet-4-5`
- `stopReason` mapping: `end_turn` → `stop`, `tool_use` → `tool_use`, `max_tokens` → `max_tokens`

### `openai.ts`

- Package: `@ai-sdk/openai`
- Uses `createOpenAI({ apiKey })`
- Uses `.responses()` API for structured outputs
- Default model: `gpt-4o`

### `gemini.ts`

- Package: `@ai-sdk/google`
- Uses `createGoogle({ apiKey })` for Google AI (gemini-2.0-flash)
- Supports `GOOGLE_GENERATIVE_API_KEY` env var
- Default model: `gemini-2.0-flash`
- Note: Vertex AI integration is TODO (requires Google Cloud auth)

### `minimax.ts`

- No Vercel SDK — uses custom fetch
- MiniMax OpenAI-compatible endpoint: `POST https://api.minimax.chat/v1/chat/completions`
- Header: `Authorization: Bearer <apiKey>`
- Default model: `MiniMax-text-01`
- Maps OpenAI-style response to `ExecuteResult`

---

## Registry

### `registry.ts`

```typescript
interface ProviderDefinition {
  info: ProviderInfo;
  create(config: ProviderConfig): AIProvider;
}

const registry = new Map<string, ProviderDefinition>();

export function registerProvider(def: ProviderDefinition): void;
export function getProvider(id: string): AIProvider;
export function listProviders(): ProviderInfo[];
export function initProviders(): void; // registers all built-in providers
```

Providers self-register via `initProviders()` called from `index.ts` on module load.

---

## Integration with AgentLoop

### `loop.ts` change

`sendToProvider()` changes from mock to real:

```typescript
private async sendToProvider(
  prompt: string,
  context: { system?: string; tools?: ToolDef[]; model?: string }
): Promise<ModelTurn> {
  const provider = getProvider(this.config.provider)
  const result = await provider.execute({
    prompt,
    system: context.system,
    tools: context.tools,
    model: context.model,
  })
  return normalizeToModelTurn(result)
}
```

`normalizeToModelTurn()` maps `ExecuteResult` → existing `ModelTurn` type. AgentLoop's internal types remain unchanged.

---

## Error Handling

| Error                                | Behavior                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Missing API key                      | Clear error: "ANTHROPIC_API_KEY not set. Set in ~/.freecode/config.json or ANTHROPIC_API_KEY environment variable." |
| API error (rate limit, auth failure) | Propagate as `AgentLoop` error with provider context                                                                |
| Network error                        | Retry once, then fail                                                                                               |
| Invalid response format              | Log warning, attempt partial parse, fallback to text content                                                        |

---

## TODO

- Browser automation (Playwright) — separate providers under `apps/core/src/browser/providers/`
- Streaming responses — add when TUI needs them
- Model catalog (models.dev) — dynamic model listing per provider
- Vertex AI for Gemini — Google Cloud authentication
- MiniMax tool support — MiniMax API has limited tool calling

---

## Dependencies

```json
{
  "@ai-sdk/anthropic": "latest",
  "@ai-sdk/openai": "latest",
  "@ai-sdk/google": "latest"
}
```

MiniMax requires no extra package (custom fetch).
