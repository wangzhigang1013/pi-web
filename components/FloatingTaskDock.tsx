"use client";

import { useState, useMemo } from "react";
import type { ExtensionWidgetItem, ExtensionStatusItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { stripAnsi } from "@/lib/ansi";

interface FloatingTaskDockProps {
  widgets: ExtensionWidgetItem[];
  statuses?: ExtensionStatusItem[];
}

export function FloatingTaskDock({ widgets, statuses = [] }: FloatingTaskDockProps) {
  const [collapsed, setCollapsed] = useState(false);

  // 匹配 rpiv-todos 或任何包含 todo / task 的组件
  const todoWidget = useMemo(() => {
    return widgets.find(
      (w) =>
        w.key === "rpiv-todos" ||
        w.key.toLowerCase().includes("todo") ||
        w.key.toLowerCase().includes("task"),
    );
  }, [widgets]);

  const todoStatus = useMemo(() => {
    return statuses.find(
      (s) =>
        s.key === "rpiv-todos" ||
        s.key.toLowerCase().includes("todo") ||
        s.key.toLowerCase().includes("task"),
    );
  }, [statuses]);

  // 解析当前任务的统计数据与活跃项
  const taskStats = useMemo(() => {
    if (!todoWidget && !todoStatus) return null;
    const lines = todoWidget?.lines ?? (todoStatus ? [todoStatus.text] : []);
    if (lines.length === 0) return null;

    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    let total = 0;
    let activeTitle: string | null = null;

    // 优先从标题行正则抓取例如 (2/5) 或 2 of 5
    const fullText = lines.map((l) => stripAnsi(l)).join("\n");
    const countMatch = fullText.match(/\((\d+)\s*[/／]\s*(\d+)\)/);
    if (countMatch) {
      completed = parseInt(countMatch[1], 10);
      total = parseInt(countMatch[2], 10);
    }

    // 逐行解析任务状态与活跃项
    for (const raw of lines) {
      const plain = stripAnsi(raw).trim();
      if (!plain) continue;

      // 匹配 [x] 或 ✔ 已完成
      if (/^\[x\]/i.test(plain) || /^✔/i.test(plain) || /已完成/.test(plain)) {
        if (!countMatch) completed++;
      }
      // 匹配 [>] 或 [●] 或 ⏳ 或 进行中
      else if (/^\[>\]/i.test(plain) || /^\[●\]/i.test(plain) || /^⏳/.test(plain) || /进行中/.test(plain) || /in_progress/i.test(plain)) {
        inProgress++;
        if (!activeTitle) {
          activeTitle = plain.replace(/^(\[>\]|\[●\]|⏳)\s*/, "").slice(0, 24);
        }
      }
      // 匹配 [ ] 待办
      else if (/^\[\s*\]/i.test(plain) || /^○/i.test(plain)) {
        pending++;
      }
    }

    const calculatedTotal = countMatch ? total : (completed + inProgress + pending);
    const percent = calculatedTotal > 0 ? Math.round((completed / calculatedTotal) * 100) : 0;
    return {
      lines,
      completed,
      total: calculatedTotal,
      inProgress,
      percent,
      activeTitle: activeTitle || (inProgress > 0 ? "任务推进中…" : null),
    };
  }, [todoWidget, todoStatus]);

  if (!taskStats || taskStats.lines.length === 0) {
    return null;
  }

  const { completed, total, inProgress, percent, activeTitle, lines } = taskStats;
  const isAllDone = total > 0 && completed === total;

  return (
    <aside
      aria-label="任务进度看板"
      style={{
        position: "fixed",
        top: 76,
        right: 20,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        pointerEvents: "auto",
        maxWidth: "calc(100vw - 40px)",
      }}
    >
      {/* 紧凑状态：悬浮胶囊 */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="点击展开任务看板详情"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 34,
            padding: "0 12px 0 10px",
            borderRadius: 9999,
            background: "color-mix(in srgb, var(--bg) 88%, transparent)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: isAllDone
              ? "1px solid rgba(16, 185, 129, 0.35)"
              : inProgress > 0
                ? "1px solid rgba(56, 189, 248, 0.4)"
                : "1px solid var(--border)",
            boxShadow: isAllDone
              ? "0 4px 16px -2px rgba(16, 185, 129, 0.2)"
              : inProgress > 0
                ? "0 4px 18px -2px rgba(56, 189, 248, 0.25)"
                : "0 4px 16px -2px rgba(0, 0, 0, 0.12)",
            color: "var(--text)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            transition: "all 0.18s ease",
            animation: "fadeIn 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
          }}
        >
          {isAllDone ? (
            <span style={{ color: "#10b981", display: "flex", alignItems: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          ) : inProgress > 0 ? (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 8px var(--accent)",
                display: "inline-block",
                animation: "pulse 1.6s infinite",
              }}
            />
          ) : (
            <span style={{ color: "var(--text-dim)", display: "flex", alignItems: "center" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <polyline points="9 11 12 14 22 4" />
              </svg>
            </span>
          )}

          <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            任务 {total > 0 ? `${completed}/${total}` : "执行中"}
          </span>

          {activeTitle && !isAllDone && (
            <span style={{ color: "var(--text-dim)", fontSize: 11.5, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              · {activeTitle}
            </span>
          )}

          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, marginLeft: 2 }}>
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>
      ) : (
        /* 展开状态：精致毛玻璃任务看板卡片 */
        <div
          style={{
            width: 320,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--bg) 90%, transparent)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid var(--border)",
            boxShadow: "0 12px 36px -4px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0,0,0,0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeIn 0.15s ease",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "color-mix(in srgb, var(--bg-panel) 60%, transparent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: isAllDone
                    ? "rgba(16, 185, 129, 0.15)"
                    : "color-mix(in srgb, var(--accent) 15%, transparent)",
                  color: isAllDone ? "#10b981" : "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isAllDone ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                任务进度看板
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  padding: "1px 6px",
                  borderRadius: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  background: isAllDone ? "rgba(16, 185, 129, 0.12)" : "var(--bg-hover)",
                  color: isAllDone ? "#10b981" : "var(--accent)",
                  border: isAllDone ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid var(--border)",
                }}
              >
                {completed}/{total} ({percent}%)
              </span>
            </div>

            {/* 收起按钮 */}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="收起到右侧胶囊"
              style={{
                background: "none",
                border: "none",
                padding: "2px 5px",
                borderRadius: 4,
                cursor: "pointer",
                color: "var(--text-dim)",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* 进度条细线 */}
          <div
            style={{
              width: "100%",
              height: 3,
              background: "var(--bg-hover)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: "100%",
                background: isAllDone ? "#10b981" : "linear-gradient(90deg, var(--accent) 0%, #38bdf8 100%)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          {/* 任务列表体 */}
          <div
            style={{
              maxHeight: 280,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              lineHeight: 1.45,
            }}
          >
            {lines.map((line, idx) => {
              const plain = stripAnsi(line).trim();
              if (!plain) return null;

              // 判断状态
              const isTaskDone = /^\[x\]/i.test(plain) || /^✔/.test(plain);
              const isTaskActive = /^\[>\]/i.test(plain) || /^\[●\]/i.test(plain) || /^⏳/.test(plain);
              const isHeading = idx === 0 && (plain.includes("Todos") || plain.includes("Task") || plain.includes("任务"));

              // 忽略纯英文 heading
              if (isHeading) return null;

              return (
                <div
                  key={idx}
                  style={{
                    padding: "4px 7px",
                    borderRadius: 6,
                    background: isTaskActive
                      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : "transparent",
                    border: isTaskActive
                      ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)"
                      : "1px solid transparent",
                    color: isTaskDone
                      ? "var(--text-dim)"
                      : isTaskActive
                        ? "var(--text)"
                        : "var(--text-muted)",
                    fontWeight: isTaskActive ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <AnsiText text={line} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
