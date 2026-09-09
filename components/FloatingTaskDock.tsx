"use client";

import { useState, useMemo } from "react";
import type { ExtensionWidgetItem, ExtensionStatusItem } from "@/lib/types";
import { stripAnsi } from "@/lib/ansi";

interface FloatingTaskDockProps {
  widgets: ExtensionWidgetItem[];
  statuses?: ExtensionStatusItem[];
}

export interface StructuredTask {
  id: number | string;
  status: "completed" | "in_progress" | "pending";
  title: string;
  activeForm?: string;
  originalIndex: number;
}

function parseTaskLine(rawLine: string, index: number): StructuredTask | null {
  const plain = stripAnsi(rawLine).trim();
  if (!plain) return null;
  // 过滤 rpiv-todos 标题行（如 "● Todos (2/4)"）
  if (plain.includes("Todos") || plain.includes("任务看板")) return null;

  let status: "completed" | "in_progress" | "pending" = "pending";
  let content = plain;

  if (/^\[x\]/i.test(plain) || /^✔/.test(plain) || /已完成/.test(plain)) {
    status = "completed";
    content = plain.replace(/^(\[x\]|✔)\s*/i, "");
  } else if (/^\[>\]/i.test(plain) || /^\[●\]/i.test(plain) || /^⏳/.test(plain) || /进行中/.test(plain)) {
    status = "in_progress";
    content = plain.replace(/^(\[>\]|\[●\]|⏳)\s*/i, "");
  } else if (/^\[\s*\]/i.test(plain) || /^○/.test(plain)) {
    status = "pending";
    content = plain.replace(/^(\[\s*\]|○)\s*/, "");
  } else {
    if (!/^\d+[\.\)]/.test(plain)) return null;
  }

  // 提取序号（如 "1. Initial research"）
  const numMatch = content.match(/^(\d+)[\.\)]\s*(.*)/);
  let id: number | string = index;
  if (numMatch) {
    id = numMatch[1];
    content = numMatch[2];
  }

  // 提取 activeForm（如 "(writing tests...)"）
  let activeForm: string | undefined;
  const activeMatch = content.match(/\(([^)]+)\)$/);
  if (activeMatch && status === "in_progress") {
    activeForm = activeMatch[1];
    content = content.replace(/\s*\([^)]+\)$/, "");
  }

  return {
    id,
    status,
    title: content.trim(),
    activeForm,
    originalIndex: index,
  };
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

  // 解析任务列表与统计
  const taskData = useMemo(() => {
    if (!todoWidget && !todoStatus) return null;
    const lines = todoWidget?.lines ?? (todoStatus ? [todoStatus.text] : []);
    if (lines.length === 0) return null;

    const fullText = lines.map((l) => stripAnsi(l)).join("\n");
    const countMatch = fullText.match(/\((\d+)\s*[/／]\s*(\d+)\)/);

    const parsedTasks: StructuredTask[] = [];
    lines.forEach((line, idx) => {
      const task = parseTaskLine(line, idx);
      if (task) parsedTasks.push(task);
    });

    if (parsedTasks.length === 0) return null;

    const completed = countMatch
      ? parseInt(countMatch[1], 10)
      : parsedTasks.filter((t) => t.status === "completed").length;
    const inProgress = parsedTasks.filter((t) => t.status === "in_progress").length;
    const total = countMatch ? parseInt(countMatch[2], 10) : parsedTasks.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const activeTask = parsedTasks.find((t) => t.status === "in_progress");

    // 按照任务执行生命周期顺序展开：
    // 已完成的任务（按完成流水从上到下）-> 当前进行中的任务 -> 待办任务
    // 这样向下展开时，视线清晰顺畅，清楚看到推进到了哪一步
    const sortedTasks = [...parsedTasks].sort((a, b) => {
      const order = { in_progress: 0, pending: 1, completed: 2 };
      // 保持同状态下的原有顺序
      if (order[a.status] !== order[b.status]) {
        return order[a.status] - order[b.status];
      }
      return a.originalIndex - b.originalIndex;
    });

    return {
      tasks: sortedTasks,
      completed,
      total,
      inProgress,
      percent,
      activeTitle: activeTask?.activeForm || activeTask?.title || null,
    };
  }, [todoWidget, todoStatus]);

  if (!taskData || taskData.tasks.length === 0) {
    return null;
  }

  const { tasks, completed, total, inProgress, percent, activeTitle } = taskData;
  const isAllDone = total > 0 && completed === total;

  return (
    <aside
      aria-label="任务进度看板"
      style={{
        position: "absolute",
        top: 16,
        left: 20,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        pointerEvents: "auto",
        maxWidth: "calc(100vw - 40px)",
      }}
    >
      {/* 紧凑状态：悬浮药丸胶囊（吸附在左侧会话区边缘） */}
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
            background: "color-mix(in srgb, var(--bg) 90%, transparent)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
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
        /* 展开状态：位于左侧的精致任务看板卡片，绝不遮挡右侧文件查看器 */
        <div
          style={{
            width: 320,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--bg) 92%, transparent)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--border)",
            boxShadow: "0 14px 38px -4px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0,0,0,0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeIn 0.15s ease",
          }}
        >
          {/* 头部标题与进度 */}
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
              title="收起为胶囊"
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

          {/* 顶部细进度条 */}
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

          {/* 结构化任务列表体：按完成流从上到下展开 */}
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {tasks.map((task) => {
              const isDone = task.status === "completed";
              const isActive = task.status === "in_progress";

              return (
                <div
                  key={`${task.id}-${task.originalIndex}`}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 7,
                    background: isActive
                      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : isDone
                        ? "color-mix(in srgb, var(--bg-hover) 40%, transparent)"
                        : "transparent",
                    border: isActive
                      ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)"
                      : "1px solid transparent",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    transition: "all 0.12s",
                  }}
                >
                  {/* 状态指示图标 */}
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    {isDone ? (
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          background: "rgba(16, 185, 129, 0.15)",
                          color: "#10b981",
                          border: "1px solid rgba(16, 185, 129, 0.35)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9.5,
                        }}
                      >
                        ✔
                      </span>
                    ) : isActive ? (
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          background: "rgba(56, 189, 248, 0.18)",
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--accent)",
                            display: "inline-block",
                            animation: "pulse 1.4s infinite",
                          }}
                        />
                      </span>
                    ) : (
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          border: "1.5px solid var(--border)",
                          display: "inline-block",
                        }}
                      />
                    )}
                  </div>

                  {/* 任务内容 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 400,
                        color: isDone
                          ? "var(--text-dim)"
                          : isActive
                            ? "var(--text)"
                            : "var(--text-muted)",
                        textDecoration: isDone ? "line-through" : "none",
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                      }}
                    >
                      {task.title}
                    </div>

                    {isActive && task.activeForm && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--accent)",
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 500,
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>正在:</span>
                        <span>{task.activeForm}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
