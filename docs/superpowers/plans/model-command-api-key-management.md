# Plan: Scalable `/model` Command with Provider API Key Management

## Context

The existing `/model` command in the TUI just shows a hardcoded list of models (claude-opus-4-7, claude-sonnet-4-6, etc.) using a `SelectList` overlay. It doesn't actually connect to the core provider system, doesn't check for API keys, and doesn't support provider switching. The goal is to build a proper model selection flow that:

1. Shows real providers from core (via `providers.list`)
2. Checks if the provider has an API key configured
3. Prompts for API key if missing (secure input)
4. Persists the selection across sessions

## Architecture

```
TUI (Presentation)  <--JSON-RPC-->  Core (Config Ownership)
     │                           │
     │  providers.list()         │  readConfig(), writeConfig()
     │  config.has()             │  getApiKey(), ProviderId
     │  config.write()           │
     └───────────────────────────┘
```

## Implementation Steps

### Step 1: Add `config.has` and `config.write` to Core

**File:** `apps/core/src/server.ts`

Add two new JSON-RPC handlers after `providers.list`:

```typescript
"config.has": async (params: Record<string, unknown>): Promise<boolean> => {
  const { provider } = params as { provider: string };
  const config = readConfig();
  const hasKey = Boolean(config.providers?.[provider as ProviderId]?.apiKey);
  const envKey = ENV_KEYS[provider as ProviderId];
  return hasKey || Boolean(process.env[envKey]);
},

"config.write": async (params: Record<string, unknown>): Promise<void> => {
  const { provider, apiKey } = params as { provider: string; apiKey: string };
  const config = readConfig();
  if (!config.providers) config.providers = {};
  config.providers[provider as ProviderId] = { apiKey };
  writeConfig(config);
},
```

Import `readConfig`, `writeConfig`, `ENV_KEYS`, `ProviderId` from `./providers/index.js`.

---

### Step 2: Add IPC Client Methods

**File:** `apps/tui/src/ipc/client.ts`

Add after `listProviders`:

```typescript
export async function hasApiKey(provider: string): Promise<boolean> {
  return (await sendRequest("config.has", { provider })) as boolean;
}

export async function writeApiKey(
  provider: string,
  apiKey: string,
): Promise<void> {
  await sendRequest("config.write", { provider, apiKey });
}
```

---

### Step 3: Extend CommandContext Interface

**File:** `apps/tui/src/commands/index.ts`

Add secure API key input method:

```typescript
export interface CommandContext {
  showMessage(content: string): void;
  showModelSelector?(): void;
  showApiKeyInput?(providerId: string): Promise<string | null>; // NEW
}
```

---

### Step 4: Implement `showApiKeyInput` in TUI

**File:** `apps/tui/src/index.ts`

Add Input component for secure API key entry:

```typescript
import { Input } from "@earendil-works/pi-tui";

let apiKeyInput: Input | null = null;

function showApiKeyInput(providerId: string): Promise<string | null> {
  return new Promise((resolve) => {
    hideApiKeyInput();

    const inputTheme = { ... };
    apiKeyInput = new Input(tui, inputTheme);
    apiKeyInput.onSubmit = (value: string) => {
      resolve(value);
      hideApiKeyInput();
    };
    apiKeyInput.onEscape = () => {
      resolve(null);
      hideApiKeyInput();
    };

    const editorIdx = tui.children.indexOf(editor);
    tui.children.splice(editorIdx + 1, 0, apiKeyInput);
    tui.setFocus(apiKeyInput);
    tui.requestRender();
  });
}

function hideApiKeyInput(): void {
  if (apiKeyInput) {
    const idx = tui.children.indexOf(apiKeyInput);
    if (idx !== -1) tui.children.splice(idx, 1);
    apiKeyInput = null;
    tui.requestRender();
  }
}
```

---

### Step 5: Bind `showApiKeyInput` to CommandContext

**File:** `apps/tui/src/index.ts` - editor.onSubmit

Pass `showApiKeyInput` when executing commands:

```typescript
command.execute(args, {
  showMessage,
  showModelSelector,
  showApiKeyInput,
});
```

---

### Step 6: Rewrite `/model` Command for Provider-First Flow

**File:** `apps/tui/src/commands/built-in.ts`

The new `/model` command flow:

1. Call `listProviders()` via IPC → get available providers
2. Show provider `SelectList` (name, description from ProviderInfo)
3. On provider select → call `hasApiKey(provider)` to check if configured
4. If no API key → call `showApiKeyInput(provider)` → get key → `writeApiKey(provider, key)`
5. If API key exists → show success message
6. After provider configured → show model selector (existing `AVAILABLE_MODELS` filtered by provider or unified list)

```typescript
const modelCommand: Command = {
  name: "model",
  description: "Select AI provider and model",
  execute: async (_args, ctx) => {
    const providers = await listProviders();
    // Show provider SelectList
    // On select: check hasApiKey → prompt for key if missing → writeApiKey
    // Then show model selector
    showProviderSelector(providers, ctx);
  },
};
```

---

### Step 7: Persist Provider/Model Selection (Optional)

Add to `apps/core/src/providers/config.ts` Config interface:

```typescript
interface Config {
  providers?: Record<ProviderId, ProviderCredentials>;
  selectedProvider?: ProviderId; // NEW
  selectedModel?: string; // NEW
}
```

On TUI startup, read `selectedProvider` from config and use as default for `session.start`.

---

## Files to Modify

1. **`apps/core/src/server.ts`** - Add `config.has`, `config.write` handlers
2. **`apps/tui/src/ipc/client.ts`** - Add `hasApiKey()`, `writeApiKey()`
3. **`apps/tui/src/commands/index.ts`** - Add `showApiKeyInput` to CommandContext
4. **`apps/tui/src/index.ts`** - Implement `showApiKeyInput()`, bind to CommandContext
5. **`apps/tui/src/commands/built-in.ts`** - Rewrite `/model` with provider-first flow
6. **`apps/tui/src/models.ts`** - Update AVAILABLE_MODELS to reflect actual provider models

---

## Verification

1. Run `pnpm dev` in apps/tui
2. Type `/model` → should see provider list from core (minimax, anthropic, openai, gemini)
3. Select a provider without API key → should prompt for API key
4. Enter API key → should be saved to `~/.freecode/config.json`
5. Select provider with API key → should show "configured" message
6. On restart, previously selected provider should be used for sessions
