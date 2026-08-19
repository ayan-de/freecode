import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createSseSplitter, parseSseFrame } from "./sse.js";
import { getSiteAdapter } from "./index.js";
import type { SiteId } from "../types.js";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const fixtures = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(".txt"))
  : [];

// Deliberately not a failure: fixtures are captured from a live account, so a
// fresh clone legitimately has none. The point is that ADDING one requires no
// test changes.
test("fixture harness is wired", () => {
  assert.ok(Array.isArray(fixtures));
  if (fixtures.length === 0) {
    console.log(
      "  (no fixtures yet — capture one with `freecode browser capture`)",
    );
  }
});

for (const file of fixtures) {
  const site = file.split("-")[0] as SiteId;

  test(`${file}: decodes to assistant text`, () => {
    const adapter = getSiteAdapter(site);
    const body = fs.readFileSync(path.join(dir, file), "utf-8");

    // Feed it in awkward slices: real network chunks split mid-frame, and a
    // splitter that only works on whole bodies would pass here and fail live.
    const feed = createSseSplitter();
    const frames: string[] = [];
    for (let i = 0; i < body.length; i += 7) {
      frames.push(...feed(body.slice(i, i + 7)));
    }

    let text = "";
    let decoded = 0;
    for (const frame of frames) {
      const chunk = adapter.decodeFrame(parseSseFrame(frame));
      if (!chunk) continue;
      decoded++;
      if (chunk.type === "delta") text += chunk.text;
    }

    assert.ok(frames.length > 0, "no SSE frames were split out of the body");
    assert.ok(decoded > 0, "no frame was recognised by the adapter");
    assert.ok(
      text.trim().length > 0,
      "frames decoded but produced no assistant text",
    );
  });
}
