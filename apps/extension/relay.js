// =============================================================================
// FreeCode Browser Bridge — relay (ISOLATED world)
//
// Two jobs:
//   1. forward captured stream messages from the MAIN-world bridge to FreeCode
//   2. execute commands from FreeCode against the page's DOM
//
// It shares the DOM with the page but not its JS context, which is exactly
// right: typing needs the DOM, capturing needs the page's own fetch (which is
// why capture lives in the MAIN world instead).
//
// Site knowledge is NOT here. Selectors arrive with each command, so the
// extension stays a dumb executor and sites/ stays the single source of truth.
// =============================================================================

(() => {
  const TAG = "[freecode]";
  const FLUSH_MS = 120;

  let outbox = [];
  let flushTimer = null;
  let polling = false;

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          void chrome.runtime.lastError;
          resolve(response || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  // Batched: a stream produces many small chunks, and one message per chunk
  // would mean one HTTP request per token.
  function queueForFreecode(message) {
    outbox.push(message);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      const messages = outbox;
      outbox = [];
      flushTimer = null;
      if (messages.length > 0) void send("events", { messages });
    }, FLUSH_MS);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__freecodeBridge !== true || !data.msg) return;

    const msg = data.msg;
    if (msg.kind === "start") console.log(`${TAG} capturing stream`);
    if (msg.kind === "end") console.log(`${TAG} stream complete`);
    queueForFreecode(msg);
  });

  // ---------------------------------------------------------------------------
  // Command execution
  // ---------------------------------------------------------------------------

  function firstVisible(selectors) {
    for (const selector of selectors || []) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        // offsetParent is null for display:none and detached nodes.
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          return el;
        }
      }
    }
    return null;
  }

  // The relay checks in at document_start, long before the site's app has
  // rendered anything. Querying once would fail on every fresh navigation, so
  // wait for the element the way the CDP transport's resolveFirst does.
  function waitForVisible(selectors, timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const el = firstVisible(selectors);
        if (el) return resolve(el);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // Included in failures so a wrong selector is diagnosable from one run,
  // rather than needing a separate probe.
  function describeEditables() {
    const found = Array.from(
      document.querySelectorAll(
        'textarea, [contenteditable="true"], [role="textbox"]',
      ),
    ).slice(0, 6);
    if (found.length === 0) return "none";
    return found
      .map(
        (el) =>
          "<" +
          el.tagName.toLowerCase() +
          " " +
          Array.from(el.attributes)
            .filter((a) => a.name !== "style")
            .map((a) => a.name + '="' + a.value.slice(0, 40) + '"')
            .join(" ") +
          ">",
      )
      .join(" | ");
  }

  async function typeAndSend(command) {
    const composer = await waitForVisible(command.composerSelectors, 25000);
    if (!composer) {
      throw new Error(
        "composer not found after 25s. Editable elements present: " +
          describeEditables(),
      );
    }

    composer.focus();
    if (composer.tagName === "TEXTAREA" || composer.tagName === "INPUT") {
      // Native value setter + input event, so React notices the change.
      const setter = Object.getOwnPropertyDescriptor(
        composer.constructor.prototype,
        "value",
      ).set;
      setter.call(composer, command.text);
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable (ProseMirror etc). execCommand is deprecated but is
      // still the only reliable way to insert text so the editor's own input
      // handling runs — setting textContent leaves the editor's model stale.
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, command.text);
    }

    await new Promise((r) => setTimeout(r, 150));

    const submit = await waitForVisible(command.submitSelectors, 10000);
    if (!submit) throw new Error("send button not found on the page");
    // The button is disabled until the editor registers the text, and a large
    // bootstrap takes a moment to process.
    const deadline = Date.now() + 5000;
    while (submit.disabled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (submit.disabled) {
      throw new Error("send button stayed disabled — the text may not have registered");
    }
    submit.click();
  }

  async function pollLoop() {
    if (polling) return;
    polling = true;
    while (polling) {
      const { command } = await send("poll", {});
      if (!command) continue;
      let result = { id: command.id, ok: true };
      try {
        if (command.kind === "send") {
          await typeAndSend(command);
        } else if (command.kind === "navigate") {
          // Acknowledge BEFORE navigating: navigation destroys this content
          // script, so a result sent afterwards would never arrive.
          await send("result", { result });
          console.log(`${TAG} navigating to ${command.url}`);
          location.href = command.url;
          return;
        } else {
          throw new Error(`unknown command: ${command.kind}`);
        }
        console.log(`${TAG} executed ${command.kind}`);
      } catch (error) {
        result = { id: command.id, ok: false, error: String(error.message || error) };
        console.warn(`${TAG} command failed:`, result.error);
      }
      await send("result", { result });
    }
  }

  // NOTE: __freecodeStats / __freecodeDump are defined in the MAIN world by
  // capture.generated.js. The DevTools console evaluates there, so defining
  // them here would make them invisible to anyone typing into it.
  console.log(
    `${TAG} bridge active on ${location.host}. Capture is on; run ` +
      `__freecodeStats() after sending a message.`,
  );

  // Check in immediately. FreeCode uses this to know the tab is live — and,
  // after a navigation, that the new page's relay is up again.
  queueForFreecode({ kind: "hello", url: location.href });

  pollLoop();
})();
