import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { aggregateUsageLines, localDateKey, sealMissingLiveFiles, buildReportFromLedger } = await jiti.import("./usage-stats.ts");

function ledgerDay(totalTokens, cost = 0, model = "p/m") {
  return {
    totals: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens, requests: 1, cost },
    models: { [model]: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens, requests: 1, cost } },
  };
}

// Build a timestamp whose local calendar date is guaranteed: construct the
// Date in local time, then serialize. Keeps the test timezone-agnostic.
function localIso(year, monthIndex, day, hour = 12) {
  return new Date(year, monthIndex, day, hour, 0, 0).toISOString();
}

function assistantUsageLine({ iso, provider, model, input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost }) {
  return JSON.stringify({
    type: "message",
    id: "a1b2c3d4",
    parentId: null,
    timestamp: iso,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      provider,
      model,
      usage: {
        input, output, cacheRead, cacheWrite, reasoning, totalTokens,
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: cost },
      },
    },
  });
}

test("localDateKey formats local calendar date from an ISO timestamp", () => {
  const iso = localIso(2026, 7, 15, 23); // 2026-08-15 23:00 local
  assert.equal(localDateKey(iso), "2026-08-15");
});

test("localDateKey returns null for unparsable input", () => {
  assert.equal(localDateKey("not-a-date"), null);
});

test("aggregateUsageLines sums assistant usage per local day and model", () => {
  const day1 = localIso(2026, 7, 15, 9);
  const day2 = localIso(2026, 7, 16, 23);
  const lines = [
    assistantUsageLine({ iso: day1, provider: "p1", model: "m1", input: 100, output: 10, cacheRead: 0, cacheWrite: 5, reasoning: 3, totalTokens: 115, cost: 0.01 }),
    assistantUsageLine({ iso: day1, provider: "p1", model: "m1", input: 200, output: 20, cacheRead: 300, cacheWrite: 0, reasoning: 0, totalTokens: 520, cost: 0.02 }),
    assistantUsageLine({ iso: day2, provider: "p2", model: "m2", input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 3, cost: 0.5 }),
  ];

  const days = aggregateUsageLines(lines);
  assert.equal(days.size, 2);

  const d1 = days.get("2026-08-15");
  assert.ok(d1);
  assert.equal(d1.totals.input, 300);
  assert.equal(d1.totals.output, 30);
  assert.equal(d1.totals.cacheRead, 300);
  assert.equal(d1.totals.cacheWrite, 5);
  assert.equal(d1.totals.reasoning, 3);
  assert.equal(d1.totals.totalTokens, 635);
  assert.equal(d1.totals.requests, 2);
  assert.ok(Math.abs(d1.totals.cost - 0.03) < 1e-9);
  assert.equal(d1.models["p1/m1"].requests, 2);

  const d2 = days.get("2026-08-16");
  assert.ok(d2);
  assert.equal(d2.totals.cost, 0.5);
  assert.equal(Object.keys(d2.models).length, 1);
  assert.ok(d2.models["p2/m2"]);
});

test("aggregateUsageLines skips non-usage entries, user text mentioning usage, and malformed lines", () => {
  const iso = localIso(2026, 7, 15, 9);
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: "x", timestamp: iso, cwd: "/tmp" }),
    JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: iso, message: { role: "user", content: [{ type: "text", text: 'what does "usage" mean?' }] } }),
    JSON.stringify({ type: "message", id: "t1", parentId: "u1", timestamp: iso, message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: '"usage":{}' }] } }),
    '{"type":"message","id":"b1",',
    assistantUsageLine({ iso, provider: "p", model: "m", input: 7, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 7, cost: 0 }),
  ];

  const days = aggregateUsageLines(lines);
  assert.equal(days.size, 1);
  const day = days.get("2026-08-15");
  assert.ok(day);
  assert.equal(day.totals.requests, 1);
  assert.equal(day.totals.input, 7);
  assert.equal(Object.keys(day.models).length, 1);
});

test("aggregateUsageLines falls back to the provided date when the timestamp is missing", () => {
  const line = assistantUsageLine({ iso: null, provider: "p", model: "m", input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 5, cost: 0 })
    .replace('"timestamp":null,', "");
  const days = aggregateUsageLines([line], "2026-08-01");
  assert.equal(days.size, 1);
  assert.ok(days.has("2026-08-01"));
});

test("aggregateUsageLines computes totalTokens from components when absent", () => {
  const iso = localIso(2026, 7, 15, 9);
  const line = assistantUsageLine({ iso, provider: "p", model: "m", input: 10, output: 4, cacheRead: 6, cacheWrite: 1, reasoning: 2, totalTokens: 0, cost: 0 })
    .replace('"totalTokens":0,', "");
  const days = aggregateUsageLines([line]);
  assert.equal(days.get("2026-08-15").totals.totalTokens, 21);
});

test("sealMissingLiveFiles freezes deleted sessions into the sealed bucket", () => {
  const ledger = {
    version: 1,
    live: {
      "C:/sessions/a.jsonl": { mtimeMs: 1, size: 10, days: { "2026-08-15": ledgerDay(100) } },
      "C:/sessions/b.jsonl": { mtimeMs: 2, size: 20, days: { "2026-08-16": ledgerDay(200) } },
    },
    sealed: {},
  };

  const firstPass = sealMissingLiveFiles(ledger, new Set(["C:/sessions/b.jsonl"]));
  assert.equal(firstPass, true);
  assert.equal(ledger.live["C:/sessions/a.jsonl"], undefined);
  assert.equal(ledger.sealed["2026-08-15"].totals.totalTokens, 100);
  assert.equal(ledger.live["C:/sessions/b.jsonl"].days["2026-08-16"].totals.totalTokens, 200);

  // Idempotent: sealing again changes nothing.
  const secondPass = sealMissingLiveFiles(ledger, new Set(["C:/sessions/b.jsonl"]));
  assert.equal(secondPass, false);
  assert.equal(ledger.sealed["2026-08-15"].totals.totalTokens, 100);
});

test("buildReportFromLedger merges sealed and live days for the same date", () => {
  const ledger = {
    version: 1,
    live: {
      "C:/sessions/b.jsonl": {
        mtimeMs: 2,
        size: 20,
        days: { "2026-08-15": ledgerDay(50, 0.2, "p/m2") },
        },
    },
    sealed: { "2026-08-15": ledgerDay(100, 0.1) },
  };

  const report = buildReportFromLedger(ledger, 1, "2026-08-30T00:00:00Z");
  assert.equal(report.days.length, 1);
  assert.equal(report.days[0].date, "2026-08-15");
  assert.equal(report.days[0].totalTokens, 150);
  assert.equal(report.days[0].requests, 2);
  assert.ok(Math.abs(report.days[0].cost - 0.3) < 1e-9);
  assert.equal(report.totals.totalTokens, 150);
  assert.deepEqual(report.months.map((m) => m.month), ["2026-08"]);
  assert.equal(report.months[0].totalTokens, 150);
  assert.equal(report.firstDate, "2026-08-15");
  assert.equal(report.lastDate, "2026-08-15");
  assert.deepEqual(report.models.map((m) => m.key), ["p/m2", "p/m"]); // sorted by cost desc
  // The ledger itself must be untouched by report building.
  assert.equal(ledger.sealed["2026-08-15"].totals.totalTokens, 100);
});

test("aggregateUsageLines output converts into ledger day shape", () => {
  const iso = localIso(2026, 7, 15, 9);
  const lines = [assistantUsageLine({ iso, provider: "p", model: "m", input: 10, output: 4, cacheRead: 6, cacheWrite: 1, reasoning: 2, totalTokens: 21, cost: 0.5 })];
  const days = aggregateUsageLines(lines);
  const ledgerDays = Object.fromEntries([...days].map(([date, day]) => [date, day]));
  const report = buildReportFromLedger(
    { version: 1, live: { "f.jsonl": { mtimeMs: 0, size: 0, days: ledgerDays } }, sealed: {} },
    1,
    "2026-08-30T00:00:00Z",
  );
  assert.equal(report.totals.totalTokens, 21);
  assert.equal(report.totals.cost, 0.5);
  assert.equal(report.models[0].key, "p/m");
});
