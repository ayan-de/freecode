// =============================================================================
// Drift guard for the wire mirrors in packages/shared.
//
// `packages/shared` cannot import from `apps/core`, so several IPC result
// types are mirrored there by hand (the same pattern `SessionMeta` and
// `SerializedMessage` already use). A hand mirror rots silently: a field added
// in core just stops being visible to frontends, which is exactly the gap
// `METHODS` exists to close.
//
// Every declaration below is a compile-time assertion that the core type still
// satisfies its mirror. `pnpm check-types` is the real test; the runtime case
// only keeps this a valid test module.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import type {
  MemoryEntry as WireMemoryEntry,
  MemoryType as WireMemoryType,
  MemoryGraphStats as WireMemoryGraphStats,
  RedactedConfig as WireRedactedConfig,
  TurnResult as WireTurnResult,
  ExportedSession as WireExportedSession,
  ModelInfo as WireModelInfo,
} from "@thisisayande/freecode-shared";
import type { MemoryEntry, MemoryType } from "../memory/mem-types.js";
import type { RedactedConfig } from "../providers/config.js";
import type { LoopResult } from "../agent/types.js";
import type { ExportedSession } from "../store/remote.js";
import type { ProviderModel } from "../models-dev.js";
import type { MemoryGraphService } from "../memory/graph/index.js";

/** Fails to compile unless `T` satisfies the wire mirror `U`. */
type Mirrors<T extends U, U> = T;

// Core → wire. A widened, renamed or dropped core field fails here. These are
// type-level only: no value is constructed, so nothing runs at import time.
type _MemoryEntry = Mirrors<MemoryEntry, WireMemoryEntry>;
type _MemoryType = Mirrors<MemoryType, WireMemoryType>;
type _GraphStats = Mirrors<
  ReturnType<MemoryGraphService["stats"]>,
  WireMemoryGraphStats
>;
type _RedactedConfig = Mirrors<RedactedConfig, WireRedactedConfig>;
type _TurnResult = Mirrors<LoopResult, WireTurnResult>;
type _ExportedSession = Mirrors<ExportedSession, WireExportedSession>;
type _ModelInfo = Mirrors<ProviderModel, WireModelInfo>;

export type {
  _MemoryEntry,
  _MemoryType,
  _GraphStats,
  _RedactedConfig,
  _TurnResult,
  _ExportedSession,
  _ModelInfo,
};

test("wire mirrors stay assignable from their core types", () => {
  // The real assertions are the declarations above, checked by tsc.
  assert.ok(true);
});
