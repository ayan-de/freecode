import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import {
  AtMentionAutocompleteProvider,
  extractAtPrefix,
} from "./at-mention-provider.js";
import { clearFileSearchCache } from "./file-search.js";

test("extractAtPrefix finds the @ token under the cursor", () => {
  assert.equal(extractAtPrefix("@app"), "@app");
  assert.equal(extractAtPrefix("look at @apps/docs/"), "@apps/docs/");
  assert.equal(extractAtPrefix("@"), "@");
  assert.equal(extractAtPrefix('@"my dir/pa'), '@"my dir/pa');
});

test("extractAtPrefix ignores text that is not an @ token", () => {
  assert.equal(extractAtPrefix(""), null);
  assert.equal(extractAtPrefix("/model"), null);
  assert.equal(extractAtPrefix("apps/docs"), null);
  // An email address is not a mention: the @ is mid-token.
  assert.equal(extractAtPrefix("mail me@example.com"), null);
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-at-mention-"));
  fs.mkdirSync(path.join(root, "apps", "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "my dir"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "docs", "page.mdx"), "");
  fs.writeFileSync(path.join(root, "my dir", "notes.md"), "");
  return root;
}

/** A provider whose fd path is null — the state this fallback exists for. */
function provider(root: string) {
  clearFileSearchCache();
  const inner = new CombinedAutocompleteProvider([], root, null);
  return new AtMentionAutocompleteProvider(inner, root);
}

function suggest(root: string, text: string) {
  return provider(root).getSuggestions([text], 0, text.length, {
    signal: new AbortController().signal,
  });
}

test("suggests files for a bare @ where pi-tui alone returns nothing", async () => {
  const root = fixture();
  const inner = new CombinedAutocompleteProvider([], root, null);
  const withoutFd = await inner.getSuggestions(["@"], 0, 1, {
    signal: new AbortController().signal,
  });
  assert.equal(withoutFd, null);

  const result = await suggest(root, "@");
  assert.ok(result);
  assert.equal(result.prefix, "@");
  assert.ok(result.items.some((item) => item.value === "@apps/"));
});

test("scopes the search to a typed directory", async () => {
  const result = await suggest(fixture(), "@apps/docs/pa");
  assert.ok(result);
  assert.equal(result.prefix, "@apps/docs/pa");
  assert.deepEqual(result.items, [
    {
      value: "@apps/docs/page.mdx",
      label: "page.mdx",
      description: "apps/docs/page.mdx",
    },
  ]);
});

test("marks directories with a trailing slash so no space is appended", async () => {
  const result = await suggest(fixture(), "@apps/do");
  const dir = result?.items.find((item) => item.value === "@apps/docs/");
  assert.ok(dir);
  assert.equal(dir.label, "docs/");
});

test("quotes paths containing spaces", async () => {
  const result = await suggest(fixture(), "@my");
  assert.ok(result);
  assert.equal(result.items[0]?.value, '@"my dir/"');
});

test("keeps quoting inside an already-quoted mention", async () => {
  const result = await suggest(fixture(), '@"my dir/no');
  assert.ok(result);
  assert.equal(result.items[0]?.value, '@"my dir/notes.md"');
  assert.equal(result.prefix, '@"my dir/no');
});

test("applying a completion is left to pi-tui", async () => {
  const root = fixture();
  const applied = provider(root).applyCompletion(
    ["see @apps/do"],
    0,
    12,
    { value: "@apps/docs/", label: "docs/" },
    "@apps/do",
  );
  assert.deepEqual(applied.lines, ["see @apps/docs/"]);
});

test("non-mention text is delegated, leaving slash commands alone", async () => {
  const root = fixture();
  const inner = new CombinedAutocompleteProvider(
    [{ name: "model", description: "pick a model" }],
    root,
    null,
  );
  const wrapped = new AtMentionAutocompleteProvider(inner, root);
  const result = await wrapped.getSuggestions(["/mod"], 0, 4, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(
    result?.items.map((item) => item.value),
    ["model"],
  );
});
