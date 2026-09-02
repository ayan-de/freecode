import assert from "node:assert/strict";
import test from "node:test";
import type { DailyUsage } from "../ipc/client.js";
import {
  lastNDays,
  localDay,
  renderCostReport,
  sumUsage,
} from "./cost-report.js";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
}

const full = (date: string, over: Partial<DailyUsage> = {}): DailyUsage => ({
  date,
  tokencount: 110,
  // Inclusive prompt total: 90 read + 5 write + 5 fresh.
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 90,
  cacheWriteTokens: 5,
  ...over,
});

test("sumUsage adds the breakdown across days", () => {
  const { totals, withBreakdown } = sumUsage([
    full(daysAgo(0)),
    full(daysAgo(1)),
  ]);

  assert.equal(withBreakdown, 2);
  assert.deepEqual(totals, {
    inputTokens: 200,
    outputTokens: 20,
    cacheReadTokens: 180,
    cacheWriteTokens: 10,
  });
});

test("legacy days without a breakdown are excluded, not counted as zero", () => {
  // Folding a real 5M-token day in as 0 read / 0 input would drag the rate
  // toward 0% and make a working setup look broken.
  const { totals, withBreakdown, withoutBreakdown } = sumUsage([
    full(daysAgo(0)),
    { date: daysAgo(1), tokencount: 5_000_000 },
  ]);

  assert.equal(withBreakdown, 1);
  assert.equal(withoutBreakdown, 1);
  assert.equal(totals.cacheReadTokens, 90);
  assert.equal(totals.inputTokens, 100);
});

test("an empty legacy day is not reported as missing data", () => {
  const { withoutBreakdown } = sumUsage([{ date: daysAgo(1), tokencount: 0 }]);
  assert.equal(withoutBreakdown, 0);
});

test("lastNDays includes today and excludes the day before the window", () => {
  const entries = [full(daysAgo(0)), full(daysAgo(6)), full(daysAgo(7))];
  const within = lastNDays(entries, 7).map((e) => e.date);

  assert.equal(within.length, 2);
  assert.ok(within.includes(daysAgo(0)));
  assert.ok(within.includes(daysAgo(6)));
  assert.ok(!within.includes(daysAgo(7)));
});

test("the report leads with the session row and shows the rate", () => {
  const out = renderCostReport([full(daysAgo(0))], {
    inputTokens: 1000,
    outputTokens: 20,
    cacheReadTokens: 900,
    cacheWriteTokens: 50,
  });

  const rows = out.split("\n").filter((l) => l.includes("cache "));
  assert.match(rows[0], /^Session/);
  assert.match(rows[0], /cache\s+90%/);
  assert.match(out, /Today/);
  assert.match(out, /All time/);
});

test("the session row is omitted when there is no session yet", () => {
  const out = renderCostReport([full(daysAgo(0))]);
  assert.equal(out.includes("Session"), false);
  assert.match(out, /Today/);
});

test("excluded legacy days are called out in the footnote", () => {
  const out = renderCostReport([
    full(daysAgo(0)),
    { date: daysAgo(3), tokencount: 999 },
  ]);
  assert.match(out, /1 older day without a breakdown \(excluded\)/);
});

test("no data at all reports that, rather than a 0% rate", () => {
  assert.match(renderCostReport([]), /No usage recorded yet/);
  assert.equal(renderCostReport([]).includes("0%"), false);
});

test("write is always shown, including zero", () => {
  const out = renderCostReport([
    full(daysAgo(0), { cacheWriteTokens: 0 }),
  ]);
  assert.match(out, /0 write/);
});

test("a non-zero write still appears", () => {
  const out = renderCostReport([full(daysAgo(0))]);
  assert.match(out, /5 write/);
});
