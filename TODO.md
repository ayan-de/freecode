# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)
- [x] Provider-specific prompts (session/prompt/*.txt files)
- [x] Subagent Lifecycle (agent tool with hooks + Bus events)

## Pending

### Thread Store (Medium Priority)

SQLite + JSON persistence for session data.

**Files to create:**
- `store/thread-store.ts` - Main store interface
- `store/sqlite-store.ts` - SQLite implementation
- `store/json-store.ts` - JSON file fallback
- `store/migrations/` - Schema migrations

### Effect/Layer DI (Low Priority - Complex)

Opencode-style runtime with Effect framework.

**Patterns to follow from opencode:**
- `effect/context.ts` - Effect context definitions
- `effect/runtime.ts` - `makeRuntime<I, S, E>()` factory
- Layer composition for services

### Permission Profiles (Low Priority)

Sandbox levels for tool permissions.

**Spec mentions:**
- `PermissionProfile` type
- Profile definitions (minimal, standard, elevated)
- Tool-level permission checks