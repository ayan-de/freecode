// =============================================================================
// Connection resolution — where the daemon is, and how to authenticate.
//
// The SPA is served by the daemon itself (web-server.ts serves
// apps/web-app/dist), so the page origin *is* the daemon in every
// deployment that matters:
//
//   - desktop browser  → http://127.0.0.1:4096
//   - phone over the tailnet → http://100.x.y.z:4096
//   - Android WebView  → whatever host the app paired with
//
// Hard-coding loopback here would make the phone fetch its *own*
// loopback, so the base URL is derived from the origin instead. In dev
// the Vite server runs on :3000 and proxies /api + /events to the
// daemon (see vite.config.ts), so origin-relative works there too.
//
// The token (spec §4.1) is required on non-loopback binds. Three
// carriers, in precedence order — the native bridge wins because it is
// the only one that keeps the token out of the URL and out of history.
// =============================================================================

/** Where the daemon lives, and the bearer token to reach it (if any). */
export interface Connection {
  /** Absolute origin, no trailing slash. e.g. `http://100.64.0.5:4096`. */
  baseUrl: string;
  /** Bearer token, or null on an unauthenticated loopback bind. */
  token: string | null;
}

/**
 * Used when there is no usable page origin — a non-http context such as
 * a test environment. The daemon's own default bind.
 */
const FALLBACK_BASE_URL = "http://127.0.0.1:4096";

/** Shape the Android shell exposes via `addJavascriptInterface`. */
interface NativeBridge {
  getCredentials(): string;
  setTurnState?(state: string): void;
}

interface FreecodeWindow {
  FreecodeBridge?: NativeBridge;
  __freecodeAuth?: { baseUrl?: string; token?: string };
}

function freecodeWindow(): FreecodeWindow | null {
  return typeof window === "undefined"
    ? null
    : (window as unknown as FreecodeWindow);
}

/**
 * Read `{baseUrl, token}` from the Android bridge. Returns null off
 * Android, or if the bridge throws / returns something unparseable —
 * a broken bridge must degrade to the browser path, not break the SPA.
 */
function readNativeCredentials(): Partial<Connection> | null {
  const bridge = freecodeWindow()?.FreecodeBridge;
  if (!bridge?.getCredentials) return null;
  try {
    const parsed = JSON.parse(bridge.getCredentials()) as {
      baseUrl?: unknown;
      token?: unknown;
    };
    const baseUrl =
      typeof parsed.baseUrl === "string" && parsed.baseUrl
        ? parsed.baseUrl
        : undefined;
    const token =
      typeof parsed.token === "string" && parsed.token
        ? parsed.token
        : undefined;
    if (!baseUrl && !token) return null;
    return { baseUrl, token: token ?? null };
  } catch (err) {
    console.warn("[connection] native bridge returned bad credentials", err);
    return null;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function originBaseUrl(): string | null {
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, origin } = window.location;
  // A `tauri://`, `file://` or `about:` origin is not something we can
  // POST to — fall through to the loopback default.
  if (protocol !== "http:" && protocol !== "https:") return null;
  return origin ? stripTrailingSlash(origin) : null;
}

function tokenFromQuery(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URL(window.location.href).searchParams.get("token");
  } catch {
    // window.location may be unusable in some environments.
    return null;
  }
}

let cached: Connection | null = null;

/**
 * Resolve the daemon connection. Memoized — credentials are fixed for
 * the lifetime of the page (the Android shell rebuilds the WebView on
 * re-pair), and `getCredentials()` is a synchronous JNI hop we would
 * otherwise pay on every RPC.
 */
export function getConnection(): Connection {
  if (cached) return cached;

  const native = readNativeCredentials();
  const injected = freecodeWindow()?.__freecodeAuth;

  const baseUrl =
    native?.baseUrl ??
    (injected?.baseUrl ? stripTrailingSlash(injected.baseUrl) : undefined) ??
    originBaseUrl() ??
    FALLBACK_BASE_URL;

  const token =
    native?.token ?? injected?.token ?? tokenFromQuery() ?? null;

  cached = { baseUrl, token };
  return cached;
}
