// apps/core/src/providers/catalogue-types.ts
//
// Split from catalogue.ts so the generated snapshot can be typed without
// importing the resolver (which imports the snapshot — a cycle otherwise).

/** One provider as models.dev describes it: identity, nothing freecode-owned. */
export interface SnapshotEntry {
  id: string;
  name: string;
  npm: string;
  /** models.dev's `api`. Absent means the SDK's own default endpoint. */
  baseURL?: string;
  /** models.dev's `env`, in its own precedence order. May be empty. */
  envKeys: string[];
}
