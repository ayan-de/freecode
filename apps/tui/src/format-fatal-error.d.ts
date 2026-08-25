// apps/core has no `declaration: true` (enabling it package-wide breaks the
// build — private tool-param types leak through inferred exports in
// tools/index.ts), so this subpath ships with no .d.ts. Ambient shape for the
// two functions crash-handler.ts and entry.ts import from it.
declare module "@thisisayande/freecode-core/cli/format-fatal-error" {
  export function formatFatalError(err: unknown): string;
  export function isProviderError(err: unknown): boolean;
}
