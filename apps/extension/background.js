// =============================================================================
// FreeCode Browser Bridge — service worker
//
// The content script cannot talk to 127.0.0.1 directly: MV3 subjects content
// script fetches to the page's origin/CORS rules. The service worker can,
// using host_permissions. So every byte between the page and FreeCode passes
// through here.
// =============================================================================

const BASE = "http://127.0.0.1:8765";

async function post(path, body) {
  try {
    const response = await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

async function pollForCommand() {
  try {
    const response = await fetch(BASE + "/commands", {
      method: "GET",
      // Long-poll: the server holds this open until it has work or times out.
      signal: AbortSignal.timeout(35000),
    });
    if (response.status === 204) return null;
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
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
    fetch(BASE + "/health", { signal: AbortSignal.timeout(2000) })
      .then((r) => sendResponse({ ok: r.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
