"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { UsageDay, UsageReport, UsageTotals } from "@/lib/usage-stats";

const EMPTY_TOTALS: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  requests: 0,
  cost: 0,
};

const HEATMAP_WEEKS = 53;
const MONTHLY_BAR_MONTHS = 12;
const HEAT_LEVELS = 4;

const MODEL_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#8b5cf6", // purple
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
];

function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatCost(value: number): string {
  if (value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function localMonthKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function totalsFor(day: UsageDay | undefined): UsageTotals {
  return day ?? EMPTY_TOTALS;
}

interface HeatCell {
  date: string;
  tokens: number;
  cost: number;
  requests: number;
  level: number;
}

interface HeatWeek {
  cells: HeatCell[];
  monthLabel: string | null;
}

function heatLevel(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0;
  // Square-root scaling keeps moderate days visible next to outlier days.
  const ratio = Math.sqrt(tokens / maxTokens);
  return Math.min(HEAT_LEVELS, 1 + Math.floor(ratio * HEAT_LEVELS));
}

function buildHeatmapWeeks(
  dayByDate: Map<string, UsageDay>,
  today: Date,
  monthLabelFormatter: Intl.DateTimeFormat,
): HeatWeek[] {
  const end = startOfDay(today);
  // Align the window to whole Sunday-started weeks so the grid is rectangular.
  const start = addDays(end, -((end.getDay() + (HEATMAP_WEEKS - 1) * 7)));

  const maxTokens = Math.max(0, ...[...dayByDate.values()].map((day) => day.totalTokens));
  const weeks: HeatWeek[] = [];
  let previousMonth = -1;
  let lastLabelWeek = -Infinity;

  for (let index = 0; index < HEATMAP_WEEKS; index += 1) {
    const cells: HeatCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(start, index * 7 + weekday);
      if (date > end) break;
      const day = dayByDate.get(localDayKey(date));
      cells.push({
        date: localDayKey(date),
        tokens: day?.totalTokens ?? 0,
        cost: day?.cost ?? 0,
        requests: day?.requests ?? 0,
        level: heatLevel(day?.totalTokens ?? 0, maxTokens),
      });
    }
    if (cells.length === 0) {
      weeks.push({ cells, monthLabel: null });
      continue;
    }
    const firstMonth = cells[0] ? new Date(cells[0].date + "T00:00:00").getMonth() : -1;
    const label = firstMonth !== previousMonth && index - lastLabelWeek >= 3
      ? monthLabelFormatter.format(new Date(cells[0].date + "T00:00:00"))
      : null;
    if (label) {
      previousMonth = firstMonth;
      lastLabelWeek = index;
    }
    weeks.push({ cells, monthLabel: label });
  }
  return weeks;
}

interface MonthBar {
  month: string;
  totals: UsageTotals;
}

function buildMonthBars(report: UsageReport | null, today: Date): MonthBar[] {
  const monthsBykey = new Map(report?.months.map((month) => [month.month, month]));
  const bars: MonthBar[] = [];
  const cursor = new Date(today.getFullYear(), today.getMonth() - MONTHLY_BAR_MONTHS + 1, 1);
  for (let index = 0; index < MONTHLY_BAR_MONTHS; index += 1) {
    const key = localMonthKey(cursor);
    const month = monthsBykey.get(key);
    bars.push({ month: key, totals: month ?? EMPTY_TOTALS });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Oldest first; drop leading empty months before any recorded data so the
  // chart starts at the first month that actually has usage.
  const firstDataIndex = bars.findIndex((bar) => bar.totals.requests > 0);
  return firstDataIndex > 0 ? bars.slice(firstDataIndex) : bars;
}

function SummaryCard({
  label,
  totals,
  icon,
}: {
  label: string;
  totals: UsageTotals;
  icon?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-usage-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span className="settings-usage-card-label" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {icon}
          {label}
        </span>
        {totals.cost > 0 && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 5,
              background: "color-mix(in srgb, var(--accent) 12%, var(--bg))",
              color: "var(--accent)",
              border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
            }}
          >
            {formatCost(totals.cost)}
          </span>
        )}
      </div>

      <div className="settings-usage-card-value">
        {formatTokenCount(totals.totalTokens)}
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)", marginLeft: 5 }}>tokens</span>
      </div>

      <div className="settings-usage-card-sub" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
        <span>{formatNumber(totals.requests)} 次请求</span>
        {(totals.input > 0 || totals.output > 0) && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>
            入 {formatTokenCount(totals.input)} · 出 {formatTokenCount(totals.output)}
          </span>
        )}
      </div>
    </div>
  );
}

function ModelProportionBar({ models }: { models: { key: string; totalTokens: number }[] }) {
  const sumTokens = useMemo(() => models.reduce((acc, m) => acc + m.totalTokens, 0), [models]);
  if (sumTokens <= 0 || models.length === 0) return null;

  const segments = models
    .filter((m) => m.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
      <div
        style={{
          width: "100%",
          height: 10,
          borderRadius: 9999,
          display: "flex",
          overflow: "hidden",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
        }}
      >
        {segments.map((item, idx) => {
          const ratio = (item.totalTokens / sumTokens) * 100;
          const color = MODEL_PALETTE[idx % MODEL_PALETTE.length];
          return (
            <div
              key={item.key}
              title={`${item.key}: ${formatTokenCount(item.totalTokens)} (${ratio.toFixed(1)}%)`}
              style={{
                width: `${ratio}%`,
                height: "100%",
                background: color,
                transition: "width 0.3s ease",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11 }}>
        {segments.slice(0, 6).map((item, idx) => {
          const ratio = (item.totalTokens / sumTokens) * 100;
          const color = MODEL_PALETTE[idx % MODEL_PALETTE.length];
          return (
            <div key={item.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ color: "var(--text)", fontWeight: 500 }}>{item.key}</span>
              <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{ratio.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelRows({ models }: { models: Record<string, UsageTotals> }) {
  const { t } = useI18n();
  const entries = Object.entries(models).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        width: "100%",
        overflowX: "auto",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg)",
      }}
    >
      <table className="settings-usage-table" style={{ margin: 0 }}>
        <thead>
          <tr style={{ background: "var(--bg-hover)" }}>
            <th style={{ padding: "8px 12px" }}>{t("usage.model")}</th>
            <th className="is-num" style={{ padding: "8px 12px" }}>{t("usage.requests")}</th>
            <th className="is-num" style={{ padding: "8px 12px" }}>{t("usage.input")}</th>
            <th className="is-num" style={{ padding: "8px 12px" }}>{t("usage.output")}</th>
            <th className="is-num" style={{ padding: "8px 12px" }}>{t("usage.cache")}</th>
            <th className="is-num" style={{ padding: "8px 12px" }}>{t("usage.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value], idx) => (
            <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: MODEL_PALETTE[idx % MODEL_PALETTE.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 500 }}>{key}</span>
              </td>
              <td className="is-num" style={{ padding: "8px 12px" }}>{formatNumber(value.requests)}</td>
              <td className="is-num" style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{formatTokenCount(value.input)}</td>
              <td className="is-num" style={{ padding: "8px 12px", color: "var(--text)" }}>{formatTokenCount(value.output)}</td>
              <td className="is-num" style={{ padding: "8px 12px", color: "var(--text-dim)" }}>
                {formatTokenCount(value.cacheRead + value.cacheWrite)}
              </td>
              <td className="is-num" style={{ padding: "8px 12px", fontWeight: 600, color: value.cost > 0 ? "var(--text)" : "var(--text-dim)" }}>
                {formatCost(value.cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageConfig() {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json() as UsageReport);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dayByDate = useMemo(
    () => new Map(report?.days.map((day) => [day.date, day]) ?? []),
    [report],
  );
  const monthBykey = useMemo(
    () => new Map(report?.months.map((month) => [month.month, month]) ?? []),
    [report],
  );

  const monthLabelFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short" }),
    [locale],
  );
  const longDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "full" }),
    [locale],
  );
  const monthYearFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    [locale],
  );

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = useMemo(() => localDayKey(today), [today]);
  const thisMonthKey = useMemo(() => localMonthKey(today), [today]);

  const weeks = useMemo(
    () => buildHeatmapWeeks(dayByDate, today, monthLabelFormatter),
    [dayByDate, today, monthLabelFormatter],
  );
  const monthBars = useMemo(
    () => buildMonthBars(report, today),
    [report, today],
  );
  const maxMonthTokens = Math.max(1, ...monthBars.map((bar) => bar.totals.totalTokens));

  // 2024-09-01 is a Sunday, so 1/3/5 are Monday/Wednesday/Friday rows.
  const weekdayLabels = useMemo(() => (
    Array.from({ length: 7 }, (_, weekday) => (
      weekdayFormatter.format(new Date(2024, 8, 1 + weekday))
    ))
  ), [weekdayFormatter]);

  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;
  const monthBarLabel = (month: string) => monthYearFormatter.format(new Date(`${month}-01T00:00:00`));

  return (
    <div className="settings-usage">
      {/* Header */}
      <div
        className="settings-usage-header"
        style={{
          padding: "16px 18px",
          borderRadius: 12,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "color-mix(in srgb, var(--accent) 12%, var(--bg))",
              border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
          </div>
          <div>
            <h2 className="settings-usage-title" style={{ fontSize: 16, fontWeight: 600 }}>
              {t("usage.title")}
            </h2>
            <p className="settings-usage-description" style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              {t("usage.description")}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="settings-usage-refresh"
          onClick={() => void load()}
          disabled={loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {loading ? t("usage.refreshing") : t("usage.refresh")}
        </button>
      </div>

      {error && (
        <p role="alert" className="settings-usage-error">
          {t("usage.loadError", { error })}
        </p>
      )}

      {report && (
        <>
          {/* Summary Cards */}
          <div className="settings-usage-cards">
            <SummaryCard
              label={t("usage.today")}
              totals={totalsFor(dayByDate.get(todayKey))}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              }
            />
            <SummaryCard
              label={t("usage.thisMonth")}
              totals={monthBykey.get(thisMonthKey) ?? EMPTY_TOTALS}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
            />
            <SummaryCard
              label={t("usage.allTime")}
              totals={report.totals}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
            />
          </div>

          {/* Daily Activity Section */}
          <section
            className="settings-usage-section"
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <div>
                <h3 className="settings-usage-heading" style={{ fontSize: 14 }}>
                  {t("usage.dailyActivity")}
                </h3>
                <p className="settings-usage-section-description" style={{ margin: "2px 0 0" }}>
                  {t("usage.dailyActivityDescription")}
                </p>
              </div>

              <div className="settings-usage-legend" style={{ margin: 0 }}>
                <span>{t("usage.legendLess")}</span>
                {Array.from({ length: HEAT_LEVELS + 1 }, (_, level) => (
                  <span key={level} className="settings-usage-heat is-static" data-level={level} />
                ))}
                <span>{t("usage.legendMore")}</span>
              </div>
            </div>

            <div className="settings-usage-heatmap" role="img" aria-label={t("usage.dailyActivity")} style={{ background: "var(--bg)", borderRadius: 8, padding: "18px 10px 10px", border: "1px solid var(--border)" }}>
              <div className="settings-usage-heatmap-days" aria-hidden style={{ background: "var(--bg)" }}>
                {weekdayLabels.map((label, weekday) => (
                  <span key={weekday} className="settings-usage-heatmap-day">
                    {(weekday === 1 || weekday === 3 || weekday === 5) ? label : ""}
                  </span>
                ))}
              </div>
              <div className="settings-usage-heatmap-weeks">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="settings-usage-heatmap-week">
                    {week.monthLabel && (
                      <span className="settings-usage-heatmap-month">{week.monthLabel}</span>
                    )}
                    {week.cells.map((cell) => (
                      <button
                        key={cell.date}
                        type="button"
                        className="settings-usage-heat"
                        data-level={cell.level}
                        data-selected={selectedDate === cell.date || undefined}
                        aria-pressed={selectedDate === cell.date}
                        title={`${cell.date} · ${formatTokenCount(cell.tokens)} ${t("usage.tokens")} · ${formatCost(cell.cost)}`}
                        onClick={() => setSelectedDate((current) => (current === cell.date ? null : cell.date))}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {selectedDate && (
              <div className="settings-usage-day-detail" style={{ background: "var(--bg)", borderRadius: 8, marginTop: 12 }}>
                <div className="settings-usage-day-head">
                  <strong style={{ fontSize: 13 }}>{longDateFormatter.format(new Date(`${selectedDate}T00:00:00`))}</strong>
                  <button type="button" className="settings-usage-day-close" onClick={() => setSelectedDate(null)} aria-label={t("i18n.close")}>×</button>
                </div>
                <p className="settings-usage-day-summary" style={{ fontSize: 12, marginTop: 4 }}>
                  {t("usage.daySummary", {
                    tokens: formatTokenCount(selectedDay?.totalTokens ?? 0),
                    cost: formatCost(selectedDay?.cost ?? 0),
                    requests: formatNumber(selectedDay?.requests ?? 0),
                  })}
                </p>
                <div style={{ marginTop: 10 }}>
                  <ModelRows models={selectedDay?.models ?? {}} />
                </div>
              </div>
            )}
          </section>

          {/* Monthly Section */}
          <section
            className="settings-usage-section"
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="settings-usage-heading" style={{ fontSize: 14 }}>
              {t("usage.monthly")}
            </h3>
            <div className="settings-usage-months" style={{ marginTop: 12 }}>
              {monthBars.map((bar) => (
                <div key={bar.month} className="settings-usage-month-row" style={{ padding: "4px 6px", borderRadius: 6, transition: "background 0.12s" }}>
                  <span className="settings-usage-month-name" style={{ fontWeight: 500 }}>
                    {monthBarLabel(bar.month)}
                  </span>
                  <span className="settings-usage-month-track" style={{ height: 10, borderRadius: 9999, background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                    <span
                      className="settings-usage-month-bar"
                      style={{
                        width: `${Math.max(bar.totals.totalTokens > 0 ? 2 : 0, (bar.totals.totalTokens / maxMonthTokens) * 100)}%`,
                        borderRadius: 9999,
                        background: "linear-gradient(90deg, var(--accent) 0%, #38bdf8 100%)",
                      }}
                    />
                  </span>
                  <span className="settings-usage-month-value" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                    <strong style={{ fontWeight: 600 }}>{formatTokenCount(bar.totals.totalTokens)}</strong>
                    {bar.totals.cost > 0 && (
                      <span style={{ color: "var(--text-dim)", marginLeft: 5 }}>
                        ({formatCost(bar.totals.cost)})
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Model Breakdown Section */}
          <section
            className="settings-usage-section"
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="settings-usage-heading" style={{ fontSize: 14, marginBottom: 8 }}>
              {t("usage.byModel")}
            </h3>
            <ModelProportionBar models={report.models} />
            <ModelRows
              models={Object.fromEntries(report.models.map((model) => [model.key, model]))}
            />
            <p className="settings-usage-footnote" style={{ marginTop: 10, fontSize: 11 }}>
              {t("usage.footnote", { sessions: formatNumber(report.sessionFiles) })}
            </p>
          </section>
        </>
      )}

      {!report && !loading && !error && (
        <p className="settings-usage-empty">{t("usage.noData")}</p>
      )}
    </div>
  );
}
