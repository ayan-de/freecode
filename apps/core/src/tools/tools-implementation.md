# Tool System Implementation

> **Date:** 2026-05-31
> **Status:** Implemented
> **Inspired by:** Claude Code's tool system + opencode's architecture

---

## Abstract

FreeCode implements a rich, extensible tool system that enables an AI coding assistant to interact with filesystems, execute shell commands, spawn sub-agents, and invoke specialized skills. The system is designed to be scalable, maintainable, and introspectable — with per-tool UI rendering, input validation, permission hooks, and proper result formatting via discriminated unions.

---

## 1. Introduction

###1.1 Problem Statement

Early implementations of FreeCode used a simple `ToolDef` interface with basic properties (id, description, parameters, execute). This approach lacked:

- **Rich UI rendering** — No way to render tool use/progress/results differently per tool
- **Per-tool validation** — No hooks for validating inputs before execution
- **Per-tool permission checks** — No way to enforce tool-specific permissions
- **Proper result typing** — No discriminated unions for success/error states
- **Schema wiring** — Tools couldn't specify their input schemas properly
- **Agent loop integration** — Schemas weren't passed to the LLM provider

### 1.2 Design Goals

1. **Rich Interface** — Tools should declare their UI rendering, behavior, and permissions
2. **Factory Pattern** — Consistent tool creation via `buildTool()` with sensible defaults
3. **Discriminated Unions** — `ToolExecutionResult` with explicit success/error states
4. **Extensible** — Easy to add new tools with consistent patterns
5. **Type-safe** — Full TypeScript typing throughout
6. **Inspiration** — Claude Code's tool system for UI rendering, opencode's architecture for composability

---

## 2. Architecture

### 2.1 Core Type System

The tool system is built around several key type definitions:

**ToolUseMessage** — A discriminated union for UI rendering states:

- `tool_use` — Tool invocation with status (pending/running)
- `tool_result` — Tool completion with result data
- `tool_progress` — Progress updates during execution
- `tool_error` — Error states
- `tool_rejected` — Permission rejections

**ToolExecutionResult** — Discriminated union for execution outcomes:

- `success: true; result: R` — Successful execution with typed result
- `success: false; error: string; code?: string` — Failed execution with error message

**Tool** — The rich tool interface combining:

- `id` — Unique identifier
- `description` — Human-readable description
- `schemas.parameters` — JSON Schema for input validation
- `ui` — UI rendering functions
- `behavior` — Concurrency, destructiveness, interrupt behavior
- `permissions` — Required operations and approval flags
- `execute` — The actual tool implementation
- `validateInput` — Optional pre-execution validation
- `checkPermissions` — Optional permission verification
- `getPath` — Optional file path extraction for context
- `isSearchOrReadCommand` — Optional classification

### 2.2 ToolUI Interface

Each tool can provide custom UI rendering:

```typescript
interface ToolUI {
  renderToolUseMessage(
    toolId: string,
    args: Record<string, unknown>,
  ): ToolUseMessage;
  renderToolResultMessage(toolId: string, result: ToolResult): ToolUseMessage;
  renderToolUseTag(toolId: string): { label: string; color: string };
  renderToolUseProgressMessage(
    toolId: string,
    message: string,
    percent?: number,
  ): ToolUseMessage;
  renderToolUseErrorMessage(toolId: string, error: string): ToolUseMessage;
  renderToolUseRejectedMessage(toolId: string, reason: string): ToolUseMessage;
}
```

### 2.3 ToolBehavior Interface

Behavioral characteristics:

```typescript
interface ToolBehavior {
  isConcurrencySafe: boolean; // Can run concurrently with other tools
  isDestructive: boolean; // Modifies filesystem or system state
  interruptBehavior: "await" | "ignore" | "error"; // How to handle interrupts
  maxResultSizeChars: number; // Maximum result size for display
  userFacingName: string; // Display name in UI
}
```

### 2.4 ToolPermissions Interface

Permission requirements:

```typescript
interface ToolPermissions {
  operations: PermissionOperation[]; // e.g., ["file.read", "file.write", "shell.exec"]
  requiresApproval: boolean; // User must approve before execution
}
```

---

## 3. Factory Pattern

### 3.1 buildTool() Function

The `buildTool()` factory creates tools with sensible defaults:

```typescript
function buildTool<P, R>(config: {
  id: string;
  description: string;
  schemas: { parameters: JsonSchema; result?: JsonSchema };
  permissions?: Partial<ToolPermissions>;
  behavior?: Partial<ToolBehavior>;
  ui?: Partial<ToolUI>;
  execute: (params: P, ctx: ToolContext) => Promise<ToolExecutionResult<R>>;
  validateInput?: (
    params: unknown,
  ) => { valid: true } | { valid: false; error: string };
  checkPermissions?: (
    params: P,
    ctx: ToolContext,
  ) => Promise<{ allowed: boolean; reason?: string }>;
  getPath?: (params: P) => string | string[];
  isSearchOrReadCommand?: () => boolean;
}): Tool<P, R>;
```

### 3.2 Default Values

The factory provides defaults for:

- `defaultToolUI` — Basic rendering with type-based coloring
- `defaultBehavior` — Safe defaults (not concurrent, not destructive, interruptBehavior: "await")
- `defaultPermissions` — Empty operations, no approval required

### 3.3 Benefits

1. **Consistency** — All tools follow the same creation pattern
2. **Less boilerplate** — Tools only specify what's different from defaults
3. **Discoverability** — Easy to see what any tool provides by reading its config
4. **Extensibility** — New tools can copy existing tool configs as templates

---

## 4. Tool Orchestrator

### 4.1 Purpose

The orchestrator mediates between the agent loop and tool execution:

1. **Input Validation** — Calls `validateInput()` before execution
2. **Permission Checks** — Verifies `checkPermissions()` passes
3. **Execution** — Runs the tool's `execute()` function
4. **Result Mapping** — Transforms results into the `ToolExecutionResult` format
5. **Error Handling** — Catches and formats errors consistently

### 4.2 Execution Flow

```
Agent Loop
 │
    ▼
Orchestrator.execute(toolCall, context)
    │
    ├── validateInput(params) ──► ValidationResult
    │ │
    │       ▼ (if invalid)
    │       Return error result
    │
    ├── checkPermissions(params, context) ──► PermissionResult
    │       │
    │       ▼ (if denied)
    │       Return rejected result
    │
    └── tool.execute(params, context) ──► ToolExecutionResult
 │
            ▼
 Return result to agent
```

---

## 5. Implemented Tools

### 5.1 File Tools

| Tool    | Description                | Destructive | Permissions |
| ------- | -------------------------- | ----------- | ----------- |
| `read`  | Read file contents         | No          | file.read   |
| `write` | Create/overwrite files     | Yes         | file.write  |
| `edit`  | In-place text replacement  | Yes         | file.write  |
| `glob`  | Pattern-based file finding | No          | file.read   |
| `grep`  | Content search in files    | No          | file.read   |

#### read Tool

Reads files or directories with:

- Binary file detection
- Line offset and limit support
- Directory listing with pagination
- Maximum file size enforcement (50KB default)

#### write Tool

Creates new files or overwrites existing:

- Automatic directory creation
- Conflict detection
- Atomic write operations

#### edit Tool

Advanced in-place editing with multiple strategies:

1. **simpleReplacer** — Exact string match
2. **lineTrimmedReplacer** — Trimmed line comparison
3. **blockAnchorReplacer** — First/last line anchoring with similarity
4. **whitespaceNormalizedReplacer** — Whitespace-agnostic matching
5. **indentationFlexibleReplacer** — Indentation-agnostic matching
6. **escapedNormalizedReplacer** — Escape sequence handling
7. **trimmedBoundaryReplacer** — Trimmed boundary matching
8. **contextAwareReplacer** — 50%+ line similarity requirement
9. **multiOccurrenceReplacer** — All occurrences (when replaceAll=true)

### 5.2 Shell Tool

| Tool   | Description             | Destructive | Permissions |
| ------ | ----------------------- | ----------- | ----------- |
| `bash` | Shell command execution | Yes         | shell.exec  |

Executes shell commands with:

- Configurable shell (default: /bin/bash)
- Timeout enforcement
- Environment variable control
- Working directory specification
- Streaming output support

### 5.3 Agent Tool

| Tool    | Description     | Destructive | Permissions |
| ------- | --------------- | ----------- | ----------- |
| `agent` | Spawn sub-agent | No          | agent.spawn |

Spawns independent agent loops:

- Independent session management
- Max iterations control
- Provider specification
- Hook integration for lifecycle events
- Result aggregation

### 5.4 Skill Tool

| Tool    | Description            | Destructive | Permissions |
| ------- | ---------------------- | ----------- | ----------- |
| `skill` | Load specialized skill | No          | file.read   |

Loads skills from filesystem:

- Scope-based discovery (user, repo, system)
- Skill content rendering
- File listing for skill directories
- Available skills listing

### 5.5 Question Tool

| Tool       | Description                   | Destructive | Permissions |
| ---------- | ----------------------------- | ----------- | ----------- |
| `question` | Ask user clarifying questions | No          | (none)      |

Elicits user input during execution:

- Multiple question support
- Option descriptions
- Custom input handling
- Answer formatting for prompts

---

## 6. Agent Loop Integration

### 6.1 Schema Wiring

The agent loop now properly wires tool schemas to the LLM provider:

```typescript
// Before (broken)
const tools = listTools().map((t) => ({
  name: t.id,
  description: t.description,
  parameters: { type: "object", properties: {} }, // Empty!
}));

// After (fixed)
const tools = listTools().map((t) => {
  const toolDef = getTool(t.id);
  return {
    name: t.id,
    description: t.description,
    parameters: toolDef?.schemas.parameters ?? {
      type: "object",
      properties: {},
    },
  };
});
```

###6.2 Bug Fix: postResult.stdout

A critical bug was fixed where `postResult.stdout` was used instead of `result.stdout` in the PostToolUse hook handling. The `postResult` from `runPostToolUse` doesn't contain the stdout property — it comes from the original `result`.

### 6.3 Result Recording

Tool results are recorded via the rollout system:

- `recordFunctionCall()` — Tool invocation with arguments
- `recordFunctionOutput()` — Tool result with duration

---

## 7. UI Rendering

### 7.1 ToolRenderer

The `ToolRenderer` transforms `ToolUseMessage` objects into displayable strings for the TUI:

```typescript
interface ToolRenderer {
  render(message: ToolUseMessage): string;
  renderBatch(messages: ToolUseMessage[]): string;
}
```

### 7.2 Per-Tool UI Files

Each tool has a corresponding `ui.ts` file for custom rendering:

```
tools/
├── read/
│   ├── index.ts    # buildTool() call
│   └── ui.ts       # UI rendering
├── write/
│   ├── index.ts
│   └── ui.ts
└── ...
```

### 7.3 Default Rendering

Tools without custom UI fall back to `defaultToolUI` which provides:

- Generic tool use rendering
- Basic success/error coloring
- Standard tag formatting

---

## 8. Input Validation

### 8.1 Pattern

Each tool implements `validateInput()`:

```typescript
function validateToolInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;

  // Type checks
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required" };
  }

  // ... more validation

  return { valid: true };
}
```

### 8.2 Validation Flow

1. Orchestrator calls `validateInput()` before execution
2. If validation fails, return error result immediately
3. No tool execution occurs on invalid input

---

## 9. IPC Server Integration

### 9.1 tools.call Handler

The JSON-RPC server's `tools.call` handler:

1. Looks up tool by name
2. Validates input
3. Executes with `ToolContext`
4. Checks `result.success`
5. Returns `result.result` or throws error

### 9.2 Error Handling

```typescript
"tools.call": async (params) => {
  const result = await tool.execute(args, ctx)
  if (!result.success) {
    throw new Error(result.error)  // Becomes JSON-RPC error
  }
  return result.result
}
```

---

## 10. File Structure

```
apps/core/src/tools/
├── index.ts              # Exports + tool registry
├── types.ts              # ToolContext (enhanced)
├── tool.types.ts         # Rich type definitions (NEW)
├── factory.ts            # buildTool() factory (NEW)
├── renderer.ts           # ToolRenderer (NEW)
├── orchestrator.ts       # Tool execution mediator
├── read.ts              # Read tool
├── read/ui.ts           # Read tool UI (NEW)
├── write.ts             # Write tool
├── write/ui.ts         # Write tool UI (NEW)
├── edit.ts              # Edit tool
├── edit/ui.ts           # Edit tool UI (NEW)
├── bash.ts              # Bash tool
├── bash/ui.ts           # Bash tool UI (NEW)
├── glob.ts              # Glob tool
├── glob/ui.ts           # Glob tool UI (NEW)
├── grep.ts              # Grep tool
├── grep/ui.ts           # Grep tool UI (NEW)
├── skill.ts             # Skill tool
├── skill/ui.ts          # Skill tool UI (NEW)
├── agent.ts             # Agent tool
├── agent/ui.ts          # Agent tool UI (NEW)
├── question.ts          # Question tool
└── question/ui.ts       # Question tool UI (NEW)
```

---

## 11. Key Design Decisions

### 11.1 Why Discriminated Unions?

TypeScript's discriminated unions enable exhaustive pattern matching:

```typescript
function handleResult(result: ToolExecutionResult) {
  if (result.success) {
    // TypeScript knows result.result is valid here
    console.log(result.result);
  } else {
    // TypeScript knows result.error is valid here
    console.error(result.error);
  }
}
```

### 11.2 Why Factory Pattern?

Without a factory, each tool would need to explicitly declare all properties:

```typescript
// Without factory (verbose)
const ReadTool: Tool<ReadParams> = {
  id: "read",
  description: "Read file contents",
  schemas: { parameters: readSchema },
  ui: {
    /* all6 methods */
  },
  behavior: {
    /* all 5 fields */
  },
  permissions: {
    /* all2 fields */
  },
  execute: executeRead,
  validateInput: validateReadInput,
  isSearchOrReadCommand: () => true,
  getPath: (params) => params.filePath,
};

// With factory (concise)
const ReadTool = buildTool({
  id: "read",
  description: "Read file contents",
  schemas: { parameters: readSchema },
  execute: executeRead,
  validateInput: validateReadInput,
  isSearchOrReadCommand: () => true,
  getPath: (params) => params.filePath,
});
```

### 11.3 Why Separate UI Files?

Separating UI into `ui.ts` files:

1. **Separation of concerns** — Tool logic vs. rendering
2. **Easier updates** — Modify UI without touching tool logic
3. **Consistency** — Same pattern for all tools
4. **Testability** — UI can be tested in isolation

---

## 12. Comparison

### 12.1 Before/After

| Aspect           | Before                                | After                                      |
| ---------------- | ------------------------------------- | ------------------------------------------ |
| Tool interface   | Simple `{ id, description, execute }` | Rich `Tool` with UI, behavior, permissions |
| Result typing    | `{ title, output }`                   | Discriminated union `ToolExecutionResult`  |
| UI rendering     | None                                  | Per-tool `ToolUI` with6 methods            |
| Input validation | Manual in execute                     | Dedicated `validateInput()` hook           |
| Schema wiring    | Empty objects to provider             | Actual tool schemas                        |
| Error handling   | Mixed success/error                   | Explicit `success: false` branch           |

### 12.2 Comparison with Claude Code

| Feature         | Claude Code            | FreeCode                  |
| --------------- | ---------------------- | ------------------------- |
| Tool interface  | Rich with UI rendering | Rich with UI rendering    |
| Factory pattern | Not applicable         | `buildTool()` factory     |
| Result typing   | Discriminated union    | Discriminated union       |
| Validation      | Per-tool hooks         | `validateInput()` hook    |
| Permissions     | Permission profiles    | `checkPermissions()` hook |
| Schema format   | JSON Schema            | JSON Schema               |

### 12.3 Comparison with opencode

| Feature        | opencode              | FreeCode                 |
| -------------- | --------------------- | ------------------------ |
| Tool interface | Effect-based services | Class-based with factory |
| Result typing  | Tagged unions         | Discriminated unions     |
| UI rendering   | Not centralized       | Per-tool `ToolUI`        |
| Orchestration  | Effect layers         | Orchestrator class       |

---

## 13. Future Work

###13.1 Planned Enhancements

1. **Zod schemas** — Replace JSON Schema with Zod for richer validation
2. **Tool categories** — Group tools by domain (file, shell, agent, etc.)
3. **Tool discovery** — Auto-discover tools via glob patterns
4. **Tool versioning** — Schema evolution support
5. **Streaming results** — Progressive result rendering for long operations

### 13.2 Deferred Features

- MCP tool integration (tools from MCP servers)
- Plugin-provided tools (dynamic tool loading)
- Tool marketplace (shareable tool configurations)

---

## 14. Conclusion

The tool system refactoring brings FreeCode's implementation closer to industry leaders like Claude Code and opencode. Key improvements:

1. **Consistency** — Factory pattern ensures all tools follow the same structure
2. **Type safety** — Discriminated unions and proper typing catch errors at compile time
3. **Extensibility** — Easy to add new tools with consistent patterns
4. **UX** — Rich UI rendering provides better feedback to users
5. **Debugging** — Proper result formatting aids in troubleshooting

The system is now ready for scale — additional tools can be added by implementing the `buildTool()` pattern with appropriate UI, validation, and execution logic.
