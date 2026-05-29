# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)

## Pending

### Subagent Lifecycle

**Status:** Hooks are wired at the hook level (`runSubagentStart`, `runSubagentStop`) but there's no subagent spawning in the current code.

**What needs to be implemented:**
1. Subagent spawning via the `agent` tool in `apps/core/src/tools/`
2. Session forking to create subagent sessions
3. Bus event emission for `subagent.started` / `subagent.completed`
4. Integration of `runSubagentStart` hook when spawning
5. Integration of `runSubagentStop` hook when subagent completes

**When the agent tool is enhanced with proper subagent spawning, these hooks will automatically work.**

### Other Pending (Lower Priority)

- [ ] Thread Store (SQLite + JSON persistence)
- [ ] Effect/Layer DI (full implementation per opencode pattern)
- [ ] Provider-specific prompts (`session/prompt/*.txt`)
- [ ] MCP Server integration
