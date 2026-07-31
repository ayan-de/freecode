# Hooks Configuration from Settings — Design Specification

> **Status**: Draft  
> **Created**: 2026-07-31  
> **Author**: FreeCode Team  
> **Spec**: Based on TODO.md — "Hooks from settings.json"  
> **Reference**: `permission/settings.ts` loader pattern, Claude Code hooks system

---

## 1. Overview

### Purpose

Enable users to define **hooks** in their `.freecode/settings.json` file without editing FreeCode's source code. Hooks allow users to intercept and modify agent behavior at various lifecycle points (e.g., run a linter before file edits, log tool calls, auto-format code after writes).

### Background

FreeCode already has a complete hooks system:

- **14 event types** (e.g., `PreToolUse`, `PostToolUse`, `SessionStart`, etc.)
- **Execution runtime** in `hooks/executors/command.ts` that can shell out to run commands
- **Registry** in `hooks/registry.ts` with `registerHook()` function

However, `registerHook()` is **only called from TypeScript source** — specifically from `hooks/builtin/rtk-rewrite.ts`. There is no code that reads a `hooks` key from `.freecode/settings.json`, so users cannot add custom hooks without editing the source.

### Goal

Add a configuration loader (similar to `permission/settings.ts`) that:

1. Reads `hooks` from `.freecode/settings.json` (project scope) and `~/.freecode/settings.json` (user scope)
2. Parses and validates hook definitions
3. Calls `registerHook()` for each valid hook
4. Watches for file changes and reloads automatically
5. Fails closed on parse errors (gracefully degrades, doesn't crash)

---

## 2. Design Principles

### 2.1 Claude Code Compatibility

> **⚠️ Limitations**: The FreeCode implementation only supports **command hooks** from settings. Prompt and HTTP hook types are not yet functional.

The design is *inspired* by Claude Code's hooks system, which offers:

- **Multiple hook types**: command, prompt, HTTP
- **Matcher filtering**: hooks apply only to matching tools
- **Environment variable interpolation**: `{{env.VAR_NAME}}` syntax
- **Multiple hooks per event**: all matching hooks execute in order
- **Graceful degradation**: invalid hooks are skipped with warnings

**FreeCode Status**:
| Feature | Status |
|---------|--------|
| Command hooks | ✅ Implemented |
| Prompt hooks | ⚠️ Stub only (returns `{ success: true }`) - no LLM evaluation |
| HTTP hooks | ❌ Not implemented |

### 2.2 Key Principles

| Principle | Description |
|-----------|-------------|
| **Fail Closed** | Invalid hook definitions are skipped with warnings; the system continues working |
| **Project → User Merge** | Project settings take precedence over user settings for the same hook name |
| **Hot Reload** | Changes to settings.json are picked up without restarting the CLI |
| **Minimal Footprint** | Only add what's necessary; avoid speculative features |
| **Type Safety** | Full TypeScript types for hook configuration |

---

## 3. Configuration Schema

### 3.1 Settings File Structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "name": "my-linter",
        "matcher": "Write",
        "command": "eslint {{path}}",
        "shell": "bash",
        "timeout": 30,
        "if": "Write(*.ts)"
      }
    ],
    "PostToolUse": [
      {
        "name": "auto-format",
        "matcher": "Write",
        "command": "prettier --write {{path}}",
        "timeout": 10
      }
    ],
    "SessionStart": [
      {
        "name": "git-info",
        "command": "git branch --show-current"
      }
    ]
  }
}
```

> **Note**: Timeout values are in **seconds** (not milliseconds). The loader passes them through unchanged; `executors/index.ts` multiplies by 1000 to get milliseconds. Default: 300 seconds (5 minutes).

### 3.2 Hook Definition Schema

> **⚠️ CRITICAL**: The loader injects `type: "command"` automatically. Settings-defined hooks are command-only; other hook types (`prompt`, `callback`) are not supported from config and require source code registration.

```typescript
interface HookDefinition {
  /** Unique name for this hook within the event */
  name: string;

  /** Tool name pattern to match (e.g., "Write", "Bash", "*", "Write|Edit") */
  matcher?: string;

  /** Shell command to execute */
  command: string;

  /** Shell to use: "bash" (default) or "powershell" */
  shell?: "bash" | "powershell";

  /** Timeout in seconds (default: 300 = 5 minutes)
   * The loader passes this value through unchanged; executors/index.ts multiplies by 1000 internally. */
  timeout?: number;

  /** Condition pattern like "Write(*.ts)" or "Bash(git *)" */
  if?: string;

  /** Run only once per session (default: false) */
  once?: boolean;
}
```

> **Implementation Note**: The loader transforms each `HookDefinition` into a `CommandHook`:
> ```typescript
> // Loader injection (pseudo-code)
> function transformToCommandHook(def: HookDefinition): CommandHook {
>   return {
>     type: "command",           // ← INJECTED: required by HookCommand union
>     command: def.command,
>     shell: def.shell ?? "bash",
>     timeout: def.timeout, // ← passed through; executors/index.ts does timeout * 1000
>     if: def.if,
>     once: def.once,
>   };
> }
> ```

### 3.3 Supported Events

All 14 hook events from `hooks/types.ts`:

| Event | Description | Supports Blocking | Supports Modification |
|-------|-------------|-------------------|----------------------|
| `PreToolUse` | Before tool execution | Yes | Yes (input) |
| `PostToolUse` | After tool execution | No | Yes (output) |
| `PostToolUseFailure` | After tool fails | No | No |
| `PermissionRequest` | Before permission prompt | Yes | Yes (input) |
| `PreCompact` | Before memory compaction | Yes | No |
| `PostCompact` | After memory compaction | No | No |
| `SessionStart` | When session starts | No | No |
| `UserPromptSubmit` | Before prompt goes to model | No | Yes (prompt) |
| `SubagentStart` | When subagent starts | No | No |
| `SubagentStop` | When subagent stops | No | No |
| `Stop` | When agent terminates | Yes | No |
| `TurnStart` | Before each turn | No | No |
| `TurnEnd` | After each turn | No | No |
| `Notification` | When agent needs attention | No | No |

### 3.4 Claude Code Shape Compatibility

Claude Code's hook config nests hook-configs under `matcher`, each holding a `hooks[]` array with no `name` and no `type` requirement:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          { "type": "command", "command": "eslint {{path}}" }
        ]
      }
    ]
  }
}
```

This is a different shape from §3.1 (flat, one hook per entry, `name` required). Pasting a Claude Code config verbatim into `.freecode/settings.json` must not crash the loader. The normalizer in `readHooksFromFile` handles this per-entry, before validation:

1. **Entry has `hooks: []`** → Claude Code shape. Unwrap: emit one flat `HookDefinition` per inner hook, each inheriting the outer `matcher`. Assign a generated `name` (e.g. `` `${event}-${index}` ``) since Claude Code entries don't have one.
2. **Entry has no `hooks[]` but has `command` directly** → already flat (§3.1 shape). Use as-is.
3. **`name` missing after normalization** (shouldn't happen post-unwrap, but guards hand-edited configs) → warn and skip that entry rather than throwing.

> **Note**: The FreeCode loader always injects `type: "command"` — prompt/callback hooks cannot be defined from JSON (no way to supply a JS function or LLM prompt), so there's no handling needed for foreign types.

Shape detection is structural (`Array.isArray(entry.hooks)`), not a version flag — no config-format field is introduced.

---

## 4. Architecture

### 4.1 Components

```
hooks/
├── settings.ts           ← NEW: Hook settings loader (like permission/settings.ts)
├── registry.ts           ← EXISTING: Hook registration
├── runtime.ts            ← EXISTING: Hook execution
├── executors/
│   ├── index.ts          ← EXISTING: Execution coordinator
│   ├── command.ts        ← EXISTING: Shell command execution
│   └── callback.ts       ← EXISTING: Callback hooks
│                         ← NOTE: prompt.ts does NOT exist; prompt hooks are a hardcoded 
│                         ← stub in index.ts:78-83 (returns { success: true } - no LLM eval)
└── builtin/
    └── rtk-rewrite.ts    ← EXISTING: Built-in hook (remains)
```

### 4.2 HookSettingsManager Class

```typescript
export class HookSettingsManager {
  constructor(private projectRoot: string);

  /** Load and register all hooks from project + user settings */
  load(): void;

  /** Reload hooks (called on file change) */
  reload(): void;

  /** Start watching settings files for changes */
  watch(): void;

  /** Clean up watchers */
  dispose(): void;
}
```

### 4.3 Loading Order

1. **Load user settings** (`~/.freecode/settings.json`)
2. **Load project settings** (`.freecode/settings.json`)
3. **Merge hooks**: Project hooks override user hooks with the same name
4. **Validate each hook**: Skip invalid hooks with warnings
5. **Register valid hooks**: Call `registerHook()` for each

---

## 5. Environment Variable Interpolation

### 5.1 Syntax

Use `{{env.VAR_NAME}}` syntax in commands:

```json
{
  "command": "eslint {{env.PROJECT_ROOT}}/src"
}
```

### 5.2 Built-in Variables

| Variable | Description |
|----------|-------------|
| `{{path}}` | Tool input path (for Read/Write/Edit tools) |
| `{{toolName}}` | Name of the tool being executed |
| `{{toolInput}}` | Full tool input as JSON |
| `{{sessionId}}` | Current session ID |
| `{{cwd}}` | Current working directory |
| `{{env.VAR}}` | Environment variable |

### 5.3 Implementation

```typescript
function interpolateVariables(
  command: string,
  input: ToolCallInput,
  context: HookContext
): string {
  return command
    .replace(/\{\{path\}\}/g, String(input.toolInput.path || ""))
    .replace(/\{\{toolName\}\}/g, input.toolName)
    .replace(/\{\{toolInput\}\}/g, JSON.stringify(input.toolInput))
    .replace(/\{\{sessionId\}\}/g, context.sessionId)
    .replace(/\{\{cwd\}\}/g, context.cwd || "")
    .replace(/\{\{env\.(\w+)\}\}/g, (_, name) => process.env[name] || "");
}
```

---

## 6. Error Handling

### 6.1 Fail Closed Behavior

| Error Type | Handling |
|------------|----------|
| Missing settings file | Silently continue with no hooks |
| Invalid JSON | Warn, skip file, continue |
| Unknown event name | Warn, skip that hook |
| Invalid hook definition | Warn, skip that hook |
| Command execution fails | Log error, continue to next hook |
| Timeout | Kill process, log warning |

### 6.2 Warning Messages

```console
[Hooks] Skipping invalid hook "my-hook" in PostToolUse: missing "command" field
[Hooks] Unknown hook event "PreExecute" - valid events are: PreToolUse, PostToolUse, ...
[Hooks] Failed to execute hook "my-linter": command not found
[Hooks] Reloading hooks from settings.json
```

---

## 7. File Watching

### 7.1 Watch Strategy

- Watch both project and user settings directories
- Debounce rapid changes (300ms)
- Only reload on `settings.json` changes
- Log reload events

### 7.2 Implementation

```typescript
import * as fs from "fs";

export class HookSettingsManager {
  private watchers: fs.FSWatcher[] = [];
  private reloadTimeout: NodeJS.Timeout | null = null;

  watch(): void {
    const dirs = [
      path.dirname(this.projectSettingsPath),
      path.dirname(this.userSettingsPath),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === "settings.json") {
          this.debouncedReload();
        }
      });
      this.watchers.push(watcher);
    }
  }

  private debouncedReload(): void {
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = setTimeout(() => this.reload(), 300);
  }
}
```

---

## 8. Integration Points

### 8.1 Server Initialization

In `apps/core/src/server.ts`, initialize hooks settings after permission settings:

```typescript
import { HookSettingsManager } from "./hooks/settings.js";

// After permission settings manager initialization
const hookSettings = new HookSettingsManager(projectRoot);
hookSettings.load();
hookSettings.watch();

// Clean up on shutdown
process.on("exit", () => hookSettings.dispose());
```

### 8.2 Existing Hook Registration

The built-in `rtk-rewrite` hook remains unchanged:

```typescript
// Still works as before
registerRtkHook();
```

### 8.3 Settings Loader Pattern

Follow the same pattern as `permission/settings.ts`:

```typescript
// Normalizes both the flat §3.1 shape and Claude Code's nested matcher/hooks[]
// shape (§3.4) into a flat list of HookDefinition per event.
function normalizeEntry(
  entry: unknown,
  event: HookEventName,
  index: number,
): HookDefinition[] {
  const e = entry as Record<string, unknown>;
  if (Array.isArray(e.hooks)) {
    // Claude Code shape: unwrap hooks[], each inherits the outer matcher
    return e.hooks.map((h: Record<string, unknown>, i: number) => ({
      name: `${event}-${index}-${i}`,
      matcher: e.matcher as string | undefined,
      command: h.command as string,
      shell: h.shell as "bash" | "powershell" | undefined,
      timeout: h.timeout as number | undefined,
      if: h.if as string | undefined,
      once: h.once as boolean | undefined,
    }));
  }
  // Already flat (§3.1 shape)
  return [entry as HookDefinition];
}

function readHooksFromFile(filePath: string): Record<HookEventName, HookDefinition[]> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const rawHooks = (parsed.hooks ?? {}) as Record<string, unknown[]>;
    const normalized: Record<string, HookDefinition[]> = {};
    for (const [event, entries] of Object.entries(rawHooks)) {
      normalized[event] = (entries ?? []).flatMap((entry, i) =>
        normalizeEntry(entry, event as HookEventName, i),
      );
    }
    return normalized as Record<HookEventName, HookDefinition[]>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[Hooks] Ignoring unreadable settings at ${filePath}: ${error}`);
    }
    return {};
  }
}
```

---

## 9. Migration Path

### 9.1 Backward Compatibility

- Existing code that calls `registerHook()` directly continues to work
- Settings-defined hooks are additive
- No breaking changes to the public API

### 9.2 Future Extensibility (Not Yet Implemented)

| Feature | Future | Rationale |
|---------|--------|------------|
| HTTP hooks | V2 | Requires async HTTP client |
| Prompt hooks | V2 | Currently a stub in executors/index.ts:78-83 — returns `{ success: true }` unconditionally, no LLM evaluation |
| Plugin hooks | V2 | Plugin system not yet implemented |
| Hook chaining | V2 | Current system runs all matching hooks |

---

## 10. Testing Strategy

### 10.1 Unit Tests

- `hooks/settings.test.ts`: Settings loading and merging
- `hooks/settings.interpolation.test.ts`: Variable interpolation

### 10.2 Integration Tests

- Settings file with valid hooks loads correctly
- Invalid settings file doesn't crash
- File watching triggers reload
- Project settings override user settings

### 10.3 Manual Testing

```bash
# Test hook execution
echo '{"hooks": {"PostToolUse": [{"name": "test", "command": "echo hello"}]}}' \
  > .freecode/settings.json
freecode "write test.txt"
# Should see "hello" in output
```

---

## 11. Security Considerations

### 11.1 Command Injection

- User-defined commands run with user privileges
- No shell injection protection beyond normal OS permissions
- Document that hooks have full shell access

### 11.2 Sensitive Data

- Environment variables passed to hooks include API keys
- Users should not define hooks in shared config files
- Consider a `FREECODE_HOOKS_DISABLE` environment variable

---

## 12. CLI Commands (Future)

```bash
# List registered hooks
freecode hooks list

# Validate settings.json
freecode hooks validate

# Add a hook interactively
freecode hooks add PostToolUse --matcher Write --command "prettier --write {{path}}"
```

---

## 13. Summary

This design enables users to define hooks in `.freecode/settings.json` without modifying source code. The implementation:

1. **Reuses existing infrastructure**: Hook runtime, registry, and executors are already in place
2. **Follows established patterns**: Matches `permission/settings.ts` for loading and watching
3. **Supports command hooks only**: Prompt/HTTP hooks are stubs; settings only supports `type: "command"` (loader injects automatically)
4. **Handles units correctly**: Timeout values are in seconds (converted internally to ms)
5. **Fails gracefully**: Invalid configurations are skipped with warnings
6. **Supports hot reload**: File changes trigger automatic reloading

---

## 14. Open Questions

1. **Should hooks run asynchronously?** — Current command executor is async; consider non-blocking for performance
2. **Hook ordering?** — Currently all matching hooks run; should users be able to specify priority?
3. **Disable built-in hooks?** — Should users be able to disable the RTK hook via settings?
4. **Hook result passthrough?** — Should PostToolUse hooks receive the output of previous hooks?
