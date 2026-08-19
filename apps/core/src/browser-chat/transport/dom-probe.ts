// =============================================================================
// Browser Chat — DOM reconnaissance
//
// When the composer is not found, "not found" is the least useful thing we can
// say: a sign-in wall and a renamed attribute produce the identical symptom and
// need opposite fixes. This reports what the page actually contains, so the
// next step is reading a list rather than guessing selectors.
// =============================================================================

import type { Page } from "playwright";

export interface ElementReport {
  tag: string;
  attrs: string;
  text: string;
}

export interface DomProbe {
  url: string;
  title: string;
  /** Anything a human could type into. */
  editables: ElementReport[];
  /** Buttons, for locating the send control (and sign-in walls). */
  buttons: ElementReport[];
  looksLoggedOut: boolean;
  /**
   * The site is showing an anti-bot interstitial. Reported plainly because it
   * is a different KIND of failure from a stale selector: no adapter change
   * fixes it, and it means this transport is being detected as automated.
   */
  looksChallenged: boolean;
}

const SIGN_IN = /sign\s?in|log\s?in|continue with|get started|create account/i;

// Passed to the page as a string: this project's tsconfig has no DOM lib, so
// an inline callback would not typecheck. The return shape is asserted below.
const PROBE_SCRIPT = `(() => {
  var clip = function (value, max) {
    max = max || 120;
    return value.length > max ? value.slice(0, max) + "\\u2026" : value;
  };
  var describe = function (el) {
    return {
      tag: el.tagName.toLowerCase(),
      attrs: clip(Array.prototype.slice.call(el.attributes)
        .filter(function (a) { return a.name !== "style"; })
        .map(function (a) { return a.name + '="' + a.value + '"'; })
        .join(" ")),
      text: clip((el.textContent || "").trim(), 60)
    };
  };
  var editables = Array.prototype.slice.call(document.querySelectorAll(
    'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], input[type="text"]'
  )).slice(0, 12).map(describe);
  var buttons = Array.prototype.slice.call(document.querySelectorAll(
    'button, [role="button"], a[href*="login"]'
  )).slice(0, 25).map(describe);
  var bodyText = ((document.body && document.body.innerText) || "").slice(0, 4000);
  var challenged =
    /just a moment|checking your browser|performing security verification|verify you are (a )?human|needs to review the security/i.test(
      document.title + " " + bodyText
    ) ||
    !!document.querySelector('#challenge-form, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]');
  return {
    url: location.href,
    title: document.title,
    editables: editables,
    buttons: buttons,
    looksLoggedOut: !challenged && editables.length === 0 &&
      /sign\\s?in|log\\s?in|continue with|get started|create account/i.test(bodyText),
    looksChallenged: challenged
  };
})()`;

export async function probeDom(page: Page): Promise<DomProbe> {
  return (await page.evaluate(PROBE_SCRIPT)) as DomProbe;
}

export function formatDomProbe(probe: DomProbe): string {
  const lines: string[] = [];
  lines.push(`    url:   ${probe.url}`);
  lines.push(`    title: ${probe.title}`);

  lines.push(`\n    editable elements (${probe.editables.length}):`);
  if (probe.editables.length === 0) {
    lines.push("      (none — the page has nothing to type into)");
  }
  for (const el of probe.editables) {
    lines.push(`      <${el.tag} ${el.attrs}>`);
  }

  lines.push(`\n    buttons (${probe.buttons.length}):`);
  for (const button of probe.buttons.slice(0, 15)) {
    const label = button.text || "(no text)";
    lines.push(`      <${button.tag} ${button.attrs}> ${label}`);
  }
  return lines.join("\n");
}

export { SIGN_IN };
