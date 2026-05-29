# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)
- [x] Provider-specific prompts (session/prompt/*.txt files)
- [x] Subagent Lifecycle (agent tool with hooks + Bus events)
- [x] Thread Store (SQLite + JSON persistence)

## Pending

### Effect/Layer DI (Complex - Skipped for now)

**Status:** Skipped - significant architectural change requiring Effect framework rewrite

**What it would involve:**
- Create `effect/context.ts` - Service descriptors using Effect.Context.Service pattern
- Create `effect/runtime.ts` - `makeRuntime<I, S, E>()` factory (see opencode's bootstrap-runtime.ts)
- Rewrite AgentLoop to use Effect.gen + Layer composition
- Convert providers, bus, hooks to Effect service pattern
- Create AppLayer composition (Layer.mergeAll of 50+ services)

**Reference:** opencode's `packages/opencode/src/effect/` directory

**Pattern to follow:**
```typescript
// Service definition
export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

// Layer creation
export const layer = Layer.effect(Service, Effect.gen(function* () {
  return Service.of({ /* methods */ })
}))

// Runtime factory
export function makeRuntime<I, S, E>(service, layer) {
  return {
    runSync: (fn) => runtime.runSync(service.use(fn)),
    runPromise: (fn) => runtime.runPromise(service.use(fn)),
    // ...
  }
}
```

### Permission Profiles (Low Priority)

Sandbox levels for tool permissions.

**Spec mentions:**
- `PermissionProfile` type
- Profile definitions (minimal, standard, elevated)
- Tool-level permission checks