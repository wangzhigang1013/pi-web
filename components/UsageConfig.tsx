"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function SummaryCard({ label, totals }: { label: string; totals: UsageTotals }) {
  const { t } = useI18n();
  const netTokens = totals.input + totals.output;
  const hitRate = totals.totalTokens > 0 ? Math.round(((totals.cacheRead + totals.cacheWrite) / totals.totalTokens) * 100) : 0;

  return (
    <div className="settings-usage-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="settings-usage-card-label">{label}</div>
        {hitRate > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "#10b981",
              background: "rgba(16, 185, 129, 0.1)",
              padding: "1px 6px",
              borderRadius: 4,
              fontWeight: 500,
            }}
            title="多轮长会话上下文命中服务端 KV 缓存的比例"
          >
            缓存命中 {hitRate}%
          </span>
        )}
      </div>
      <div className="settings-usage-card-value">
        {formatTokenCount(netTokens)}
        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)", marginLeft: 6 }}>
          净用量
        </span>
      </div>
      <div className="settings-usage-card-sub" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
        <span>{t("usage.cardSub", { cost: formatCost(totals.cost), requests: formatNumber(totals.requests) })}</span>
        <span style={{ color: "var(--text-dim)" }} title="含多轮交互中服务端重复读取的 KV 缓存总上下文">
          含缓存: {formatTokenCount(totals.totalTokens)}
        </span>
      </div>
    </div>
  );
}

function ModelRows({ models }: { models: Record<string, UsageTotals> }) {
  const { t } = useI18n();
  const entries = useMemo(() => {
    return Object.entries(models).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  }, [models]);

  if (entries.length === 0) return null;

  const grandTotalTokens = entries.reduce((acc, curr) => acc + curr[1].totalTokens, 0);

  return (
    <table className="settings-usage-table">
      <thead>
        <tr>
          <th>{t("usage.model")}</th>
          <th className="is-num">{t("usage.requests")}</th>
          <th className="is-num">{t("usage.input")}</th>
          <th className="is-num">{t("usage.output")}</th>
          <th className="is-num">{t("usage.cache")}</th>
          <th className="is-num">总 Tokens</th>
          <th className="is-num">{t("usage.cost")}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => {
          const pct = grandTotalTokens > 0 ? ((value.totalTokens / grandTotalTokens) * 100).toFixed(1) : "0";
          return (
            <tr key={key}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>{key}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>({pct}%)</span>
                </div>
              </td>
              <td className="is-num">{formatNumber(value.requests)}</td>
              <td className="is-num">{formatTokenCount(value.input)}</td>
              <td className="is-num">{formatTokenCount(value.output)}</td>
              <td className="is-num">{formatTokenCount(value.cacheRead + value.cacheWrite)}</td>
              <td className="is-num" style={{ fontWeight: 600 }}>{formatTokenCount(value.totalTokens)}</td>
              <td className="is-num">{formatCost(value.cost)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(thisMonthKey);

  // 提取历史上有数据的所有月份（倒序）
  const availableMonths = useMemo(() => {
    if (!report) return [];
    const months = new Set<string>();
    for (const day of report.days) {
      if (day.date) months.add(day.date.slice(0, 7));
    }
    months.add(thisMonthKey);
    return Array.from(months).sort().reverse();
  }, [report, thisMonthKey]);

  // 根据选定月份（默认且优先为本月）聚合模型数据
  const currentMonthModels = useMemo(() => {
    if (!report) return {};
    if (selectedMonthKey === "all") {
      return Object.fromEntries(report.models.map((model) => [model.key, model]));
    }
    const map: Record<string, UsageTotals> = {};
    for (const day of report.days) {
      if (day.date.startsWith(selectedMonthKey)) {
        for (const [key, totals] of Object.entries(day.models || {})) {
          if (!map[key]) {
            map[key] = {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: 0,
              totalTokens: 0,
              requests: 0,
              cost: 0,
            };
          }
          map[key].input += totals.input || 0;
          map[key].output += totals.output || 0;
          map[key].cacheRead += totals.cacheRead || 0;
          map[key].cacheWrite += totals.cacheWrite || 0;
          map[key].reasoning += totals.reasoning || 0;
          map[key].totalTokens += totals.totalTokens || 0;
          map[key].requests += totals.requests || 0;
          map[key].cost += totals.cost || 0;
        }
      }
    }
    return map;
  }, [report, selectedMonthKey]);

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
      <div className="settings-usage-header">
        <div>
          <h2 className="settings-usage-title">{t("usage.title")}</h2>
          <p className="settings-usage-description">{t("usage.description")}</p>
        </div>
        <button
          type="button"
          className="settings-usage-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
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
          <div className="settings-usage-cards">
            <SummaryCard label={t("usage.today")} totals={totalsFor(dayByDate.get(todayKey))} />
            <SummaryCard label={t("usage.thisMonth")} totals={monthBykey.get(thisMonthKey) ?? EMPTY_TOTALS} />
            <SummaryCard label={t("usage.allTime")} totals={report.totals} />
          </div>

          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(125, 125, 125, 0.05)",
              border: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--text-dim)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontSize: 13 }}>💡</span>
            <span>
              <strong>指标口径说明：</strong>「净用量」为实际未缓存的新输入与模型生成总量（入+出），直接反映真实的有效消费；「含缓存」反映长会话多轮交互中的全量上下文深度（大模型厂商对缓存读取通常免费或给予 1~2.5 折深度优惠，不消耗常规生成额度）。
            </span>
          </div>

          <section className="settings-usage-section">
            <h3 className="settings-usage-heading">{t("usage.dailyActivity")}</h3>
            <p className="settings-usage-section-description">{t("usage.dailyActivityDescription")}</p>
            <div className="settings-usage-heatmap" role="img" aria-label={t("usage.dailyActivity")}>
              <div className="settings-usage-heatmap-days" aria-hidden>
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
            <div className="settings-usage-legend">
              <span>{t("usage.legendLess")}</span>
              {Array.from({ length: HEAT_LEVELS + 1 }, (_, level) => (
                <span key={level} className="settings-usage-heat is-static" data-level={level} />
              ))}
              <span>{t("usage.legendMore")}</span>
            </div>

            {selectedDate && (
              <div className="settings-usage-day-detail">
                <div className="settings-usage-day-head">
                  <strong>{longDateFormatter.format(new Date(`${selectedDate}T00:00:00`))}</strong>
                  <button type="button" className="settings-usage-day-close" onClick={() => setSelectedDate(null)} aria-label={t("i18n.close")}>×</button>
                </div>
                <p className="settings-usage-day-summary" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span>净消耗: <strong style={{ color: "var(--text)" }}>{formatTokenCount((selectedDay?.input ?? 0) + (selectedDay?.output ?? 0))}</strong></span>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <span>含缓存总计: {formatTokenCount(selectedDay?.totalTokens ?? 0)}</span>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <span>{formatCost(selectedDay?.cost ?? 0)}</span>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <span>{formatNumber(selectedDay?.requests ?? 0)} 次请求</span>
                </p>
                <ModelRows models={selectedDay?.models ?? {}} />
              </div>
            )}
          </section>

          <section className="settings-usage-section">
            <h3 className="settings-usage-heading">{t("usage.monthly")}</h3>
            <div className="settings-usage-months">
              {monthBars.map((bar) => (
                <div key={bar.month} className="settings-usage-month-row">
                  <span className="settings-usage-month-name">{monthBarLabel(bar.month)}</span>
                  <span className="settings-usage-month-track">
                    <span
                      className="settings-usage-month-bar"
                      style={{ width: `${Math.max(bar.totals.totalTokens > 0 ? 2 : 0, (bar.totals.totalTokens / maxMonthTokens) * 100)}%` }}
                    />
                  </span>
                  <span className="settings-usage-month-value">
                    {formatTokenCount(bar.totals.totalTokens)}
                    {bar.totals.cost > 0 && ` · ${formatCost(bar.totals.cost)}`}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-usage-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 className="settings-usage-heading" style={{ margin: 0 }}>
                  {selectedMonthKey === "all"
                    ? t("usage.byModel")
                    : `${selectedMonthKey === thisMonthKey ? "本月" : selectedMonthKey}模型统计`}
                </h3>
                <p className="settings-usage-section-description" style={{ margin: "4px 0 0" }}>
                  {selectedMonthKey === "all"
                    ? "历史累计所有模型统计"
                    : `仅统计 ${selectedMonthKey} 各模型的 Token 消耗与费用，过滤无关历史数据`}
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>统计周期:</span>
                <select
                  value={selectedMonthKey}
                  onChange={(e) => setSelectedMonthKey(e.target.value)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  <option value={thisMonthKey}>本月 ({thisMonthKey})</option>
                  {availableMonths
                    .filter((m) => m !== thisMonthKey)
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  <option value="all">全部历史累计</option>
                </select>
              </div>
            </div>

            {Object.keys(currentMonthModels).length === 0 ? (
              <p className="settings-usage-empty" style={{ padding: "20px 0" }}>
                {selectedMonthKey === thisMonthKey ? "本月暂无模型用量记录" : `${selectedMonthKey} 暂无模型用量记录`}
              </p>
            ) : (
              <ModelRows models={currentMonthModels} />
            )}

            <p className="settings-usage-footnote">
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
