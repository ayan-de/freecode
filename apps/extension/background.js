// =============================================================================
// FreeCode Browser Bridge — service worker
//
// The content script cannot talk to 127.0.0.1 directly: MV3 subjects content
// script fetches to the page's origin/CORS rules. The service worker can,
// using host_permissions. So every byte between the page and FreeCode passes
// through here.
//
// The bridge port is DISCOVERED, not fixed. FreeCode's core is a daemon that
// outlives its TUI, so a crashed run can leave the preferred port bound and
// the next core lands on the one after it. Probing a small range means that
// costs nobody a manual `pkill`.
// =============================================================================

const BASE_PORT = 8765;
const PORT_RANGE = 10;

let activePort = null;

async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(600),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return { port, startedAt: body.startedAt || 0 };
  } catch (e) {
    return null;
  }
}

/**
 * Probes the WHOLE range and takes the newest bridge, rather than the first
 * that answers. A core left over from a crashed run is still perfectly
 * healthy; attaching to it means the session the user just started never sees
 * a browser, which is a genuinely baffling failure to debug.
 */
async function resolveBase() {
  if (activePort !== null) return `http://127.0.0.1:${activePort}`;

  const found = (
    await Promise.all(
      Array.from({ length: PORT_RANGE }, (_, i) => probe(BASE_PORT + i)),
    )
  ).filter(Boolean);
  if (found.length === 0) return null;

  found.sort((a, b) => b.startedAt - a.startedAt);
  activePort = found[0].port;
  if (found.length > 1) {
    console.log(
      `[freecode] ${found.length} bridges answered; using the newest ` +
        `(port ${activePort}). Older ones are probably orphaned cores.`,
    );
  } else {
    console.log(`[freecode] bridge found on port ${activePort}`);
  }
  return `http://127.0.0.1:${activePort}`;
}

/** A failed request means the core we found is gone; re-probe next time. */
function forget() {
  activePort = null;
}

async function post(path, body) {
  const base = await resolveBase();
  if (!base) return false;
  try {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) forget();
    return response.ok;
  } catch (e) {
    forget();
    return false;
  }
}

async function pollForCommand() {
  const base = await resolveBase();
  if (!base) return null;
  try {
    const response = await fetch(base + "/commands", {
      method: "GET",
      // Long-poll: the server holds this open until it has work or times out.
      signal: AbortSignal.timeout(35000),
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      forget();
      return null;
    }
    return await response.json();
  } catch (e) {
    // A timeout here is the normal idle case, not a lost server.
    if (e && e.name !== "TimeoutError") forget();
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "events") {
    post("/events", { messages: message.messages }).then((ok) =>
      sendResponse({ ok }),
    );
    return true; // async response
  }
  if (message.type === "poll") {
    pollForCommand().then((command) => sendResponse({ command }));
    return true;
  }
  if (message.type === "result") {
    post("/results", message.result).then((ok) => sendResponse({ ok }));
    return true;
  }
  if (message.type === "health") {
    resolveBase().then((base) => sendResponse({ ok: !!base, port: activePort }));
    return true;
  }
  return false;
});
