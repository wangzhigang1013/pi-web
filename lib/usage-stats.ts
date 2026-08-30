import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Token usage statistics aggregated from pi session files
 * (~/.pi/agent/sessions/<project>/*.jsonl).
 *
 * Every assistant message carries a `usage` block (input/output/cacheRead/
 * cacheWrite/reasoning tokens plus an optional `cost` block). Entries are
 * bucketed by the session entry timestamp in the server's local timezone —
 * pi-web serves 127.0.0.1, so server-local and user-local days coincide.
 *
 * Usage is deletion-proof: a persistent ledger (~/.pi/agent/usage-stats.json)
 * tracks per-file day aggregates. While a session file exists its numbers are
 * authoritative (the ledger mirrors the file); when the file is deleted its
 * last-known aggregates are merged into a sealed bucket so historical totals
 * never decrease. Restoring a deleted session file from backup would count it
 * twice — the sealed copy cannot be un-merged — and that trade-off is chosen
 * deliberately in favor of preserving history.
 */

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  requests: number;
  cost: number;
}

export interface UsageDay extends UsageTotals {
  date: string;
  models: Record<string, UsageTotals>;
}

export interface UsageMonth extends UsageTotals {
  month: string;
}

export interface UsageModelUsage extends UsageTotals {
  key: string;
}

export interface UsageReport {
  generatedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  sessionFiles: number;
  totals: UsageTotals;
  days: UsageDay[];
  months: UsageMonth[];
  models: UsageModelUsage[];
}

interface UsageAccum {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  requests: number;
  cost: number;
}

/** Per-day aggregate as stored in the ledger (JSON-serializable). */
interface LedgerDay {
  totals: UsageAccum;
  models: Record<string, UsageAccum>;
}

/** Last-known state of one live session file. */
interface LedgerFile {
  mtimeMs: number;
  size: number;
  days: Record<string, LedgerDay>;
}

interface UsageLedger {
  version: 1;
  live: Record<string, LedgerFile>;
  sealed: Record<string, LedgerDay>;
}

declare global {
  var __piUsageLedger: UsageLedger | undefined;
}

function emptyAccum(): UsageAccum {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, requests: 0, cost: 0 };
}

function addInto(target: UsageAccum, source: UsageAccum): UsageAccum {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.reasoning += source.reasoning;
  target.totalTokens += source.totalTokens;
  target.requests += source.requests;
  target.cost += source.cost;
  return target;
}

function copyDay(day: LedgerDay): LedgerDay {
  return {
    totals: { ...day.totals },
    models: Object.fromEntries(Object.entries(day.models).map(([key, value]) => [key, { ...value }])),
  };
}

function addDayInto(target: LedgerDay, source: LedgerDay): LedgerDay {
  addInto(target.totals, source.totals);
  for (const [key, value] of Object.entries(source.models)) {
    const existing = target.models[key];
    if (existing) addInto(existing, value);
    else target.models[key] = { ...value };
  }
  return target;
}

/** Local-timezone `YYYY-MM-DD` key for an ISO timestamp, or null when unparsable. */
export function localDateKey(timestamp: string | number | Date): string | null {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Aggregate usage from raw JSONL lines. Only assistant message entries with a
 * `usage` block contribute; malformed lines and non-usage messages are skipped.
 * Lines without a parsable timestamp fall back to `fallbackDateKey`.
 */
export function aggregateUsageLines(
  lines: readonly string[],
  fallbackDateKey: string | null = null,
): Map<string, LedgerDay> {
  const days = new Map<string, LedgerDay>();

  for (const line of lines) {
    // Cheap pre-filter: usage-bearing lines are a small fraction of a session
    // file, and tool results can be megabytes of base64 — skip the JSON.parse.
    if (!line.includes('"usage"')) continue;

    let entry: {
      type?: unknown;
      timestamp?: unknown;
      message?: { role?: unknown; usage?: unknown; provider?: unknown; model?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message" || !entry.message || entry.message.role !== "assistant") continue;
    const usage = entry.message.usage;
    if (!usage || typeof usage !== "object") continue;
    const u = usage as Record<string, unknown>;

    const input = finiteNumber(u.input);
    const output = finiteNumber(u.output);
    const cacheRead = finiteNumber(u.cacheRead);
    const cacheWrite = finiteNumber(u.cacheWrite);
    const reasoning = finiteNumber(u.reasoning);
    const total = typeof u.totalTokens === "number" && Number.isFinite(u.totalTokens)
      ? u.totalTokens
      : input + output + cacheRead + cacheWrite;
    const cost = (u.cost && typeof u.cost === "object")
      ? finiteNumber((u.cost as Record<string, unknown>).total)
      : 0;

    const dateKey = typeof entry.timestamp === "string" ? localDateKey(entry.timestamp) : null;
    if (!dateKey && !fallbackDateKey) continue;

    const day = days.get(dateKey ?? fallbackDateKey!) ?? { totals: emptyAccum(), models: {} as Record<string, UsageAccum> };
    if (!days.has(dateKey ?? fallbackDateKey!)) days.set(dateKey ?? fallbackDateKey!, day);

    const provider = typeof entry.message.provider === "string" ? entry.message.provider : "unknown";
    const model = typeof entry.message.model === "string" ? entry.message.model : "unknown";
    const modelKey = `${provider}/${model}`;

    const request: UsageAccum = {
      input, output, cacheRead, cacheWrite, reasoning, totalTokens: total, requests: 1, cost,
    };
    addInto(day.totals, request);
    const modelAccum = day.models[modelKey] ?? emptyAccum();
    if (!day.models[modelKey]) day.models[modelKey] = modelAccum;
    addInto(modelAccum, request);
  }

  return days;
}

function daysMapToLedgerDays(days: Map<string, LedgerDay>): Record<string, LedgerDay> {
  return Object.fromEntries([...days].map(([date, day]) => [date, copyDay(day)]));
}

function listSessionFiles(sessionsDir: string): string[] {
  const files: string[] = [];
  let projectEntries: { name: string; isDirectory: boolean }[];
  try {
    projectEntries = readdirSync(sessionsDir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return files;
  }
  for (const project of projectEntries) {
    if (!project.isDirectory) continue;
    const projectDir = join(sessionsDir, project.name);
    let names: string[];
    try {
      names = readdirSync(projectDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".jsonl")) files.push(join(projectDir, name));
    }
  }
  return files;
}

/**
 * Merge ledger entries whose session files no longer exist into the sealed
 * bucket and drop them from `live`. Returns true when the ledger changed.
 */
export function sealMissingLiveFiles(ledger: UsageLedger, livePaths: ReadonlySet<string>): boolean {
  let changed = false;
  for (const [filePath, entry] of Object.entries(ledger.live)) {
    if (livePaths.has(filePath)) continue;
    for (const [dateKey, day] of Object.entries(entry.days)) {
      const target = ledger.sealed[dateKey] ?? { totals: emptyAccum(), models: {} as Record<string, UsageAccum> };
      if (!ledger.sealed[dateKey]) ledger.sealed[dateKey] = target;
      addDayInto(target, day);
    }
    delete ledger.live[filePath];
    changed = true;
  }
  return changed;
}

function isValidLedger(value: unknown): value is UsageLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as UsageLedger;
  return ledger.version === 1
    && !!ledger.live && typeof ledger.live === "object"
    && !!ledger.sealed && typeof ledger.sealed === "object";
}

function ledgerFilePath(): string {
  return join(getAgentDir(), "usage-stats.json");
}

function loadLedger(): UsageLedger {
  if (globalThis.__piUsageLedger) return globalThis.__piUsageLedger;
  let ledger: UsageLedger = { version: 1, live: {}, sealed: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(ledgerFilePath(), "utf8"));
    if (isValidLedger(parsed)) ledger = parsed;
  } catch {
    // Missing or corrupt ledger: start fresh. Live files re-derive from disk;
    // only sealed history of already-deleted files is lost.
  }
  globalThis.__piUsageLedger = ledger;
  return ledger;
}

function persistLedger(ledger: UsageLedger): void {
  try {
    writePrivateFileAtomicSync(ledgerFilePath(), JSON.stringify(ledger));
  } catch {
    // Best-effort persistence: the report is still served from memory and
    // retried on the next collect.
  }
}

/**
 * Build the usage report from ledger state. Days merge the sealed bucket
 * (deleted sessions) with every live file's current aggregates.
 */
export function buildReportFromLedger(
  ledger: UsageLedger,
  sessionFiles: number,
  generatedAt: string,
): UsageReport {
  // Deep-copy into the merge map: ledger objects are shared with globalThis
  // state and addDayInto mutates its target in place.
  const dayByDate = new Map<string, LedgerDay>();
  const mergeDay = (dateKey: string, day: LedgerDay) => {
    const target = dayByDate.get(dateKey);
    if (target) addDayInto(target, day);
    else dayByDate.set(dateKey, copyDay(day));
  };
  for (const [dateKey, day] of Object.entries(ledger.sealed)) mergeDay(dateKey, day);
  for (const file of Object.values(ledger.live)) {
    for (const [dateKey, day] of Object.entries(file.days)) mergeDay(dateKey, day);
  }

  const totals = emptyAccum();
  const modelsTotal = new Map<string, UsageAccum>();
  const days: UsageDay[] = [];

  for (const [dateKey, day] of [...dayByDate].sort(([a], [b]) => a.localeCompare(b))) {
    addInto(totals, day.totals);
    for (const [key, modelAccum] of Object.entries(day.models)) {
      modelsTotal.set(key, addInto(modelsTotal.get(key) ?? emptyAccum(), modelAccum));
    }
    days.push({
      date: dateKey,
      ...day.totals,
      models: Object.fromEntries(Object.entries(day.models).sort(([a], [b]) => a.localeCompare(b))),
    });
  }

  const months = new Map<string, UsageAccum>();
  for (const day of days) {
    const monthKey = day.date.slice(0, 7);
    months.set(monthKey, addInto(months.get(monthKey) ?? emptyAccum(), {
      input: day.input,
      output: day.output,
      cacheRead: day.cacheRead,
      cacheWrite: day.cacheWrite,
      reasoning: day.reasoning,
      totalTokens: day.totalTokens,
      requests: day.requests,
      cost: day.cost,
    }));
  }

  return {
    generatedAt,
    firstDate: days[0]?.date ?? null,
    lastDate: days[days.length - 1]?.date ?? null,
    sessionFiles,
    totals,
    days,
    months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, accum]) => ({ month, ...accum })),
    models: [...modelsTotal]
      .map(([key, accum]) => ({ key, ...accum }))
      .sort((a, b) => (b.cost - a.cost) || (b.totalTokens - a.totalTokens) || a.key.localeCompare(b.key)),
  };
}

/** Scan all session files and produce a deletion-proof usage report. */
export function collectUsageReport(options: { force?: boolean } = {}): UsageReport {
  const ledger = loadLedger();
  const sessionsDir = join(getAgentDir(), "sessions");
  const files = listSessionFiles(sessionsDir);
  const livePaths = new Set(files);

  let dirty = sealMissingLiveFiles(ledger, livePaths);

  for (const filePath of files) {
    let stat: { mtimeMs: number; size: number };
    try {
      const s = statSync(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      continue;
    }
    const cached = ledger.live[filePath];
    if (!options.force && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const statDate = localDateKey(new Date(stat.mtimeMs));
    ledger.live[filePath] = {
      ...stat,
      days: daysMapToLedgerDays(aggregateUsageLines(content.split("\n"), statDate)),
    };
    dirty = true;
  }

  if (dirty) persistLedger(ledger);

  return buildReportFromLedger(ledger, files.length, new Date().toISOString());
}
