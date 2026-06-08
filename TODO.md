# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)
- [x] Provider-specific prompts (session/prompt/*.txt files)
- [x] Subagent Lifecycle (agent tool with hooks + Bus events)
- [x] Thread Store (SQLite + JSON persistence)
- [x] Permission Profiles (sandbox levels for tool permissions)

## Pending

### Effect/Layer DI (Complex - Skipped for now)

**Status:** Skipped - requires significant architectural change using Effect framework

**Reference:** opencode's `packages/opencode/src/effect/` directory for `makeRuntime<I, S, E>()` pattern

## Input suggestion
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ push                                         
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────