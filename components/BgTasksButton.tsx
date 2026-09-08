"use client";

import React, { useEffect, useState, useCallback } from "react";
import { BgTasksModal } from "./BgTasksModal";

export function BgTasksButton({ iconButtonSize = 36 }: { iconButtonSize?: number }) {
  const [taskCount, setTaskCount] = useState<number>(0);
  const [modalOpen, setModalOpen] = useState(false);

  const checkTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/background-tasks", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { servers: Array<{ port: number }> };
        setTaskCount(data.servers?.length || 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void checkTasks();
    const interval = setInterval(checkTasks, 10000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkTasks();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkTasks]);

  const hasTasks = taskCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={hasTasks ? `检测到 ${taskCount} 个 AI 启动的后台服务正在运行` : "后台任务与端口守护"}
        aria-label="后台任务"
        style={{
          height: iconButtonSize,
          minWidth: iconButtonSize,
          padding: hasTasks ? "0 8px" : 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          background: hasTasks ? "rgba(16, 185, 129, 0.12)" : "none",
          border: hasTasks ? "1px solid rgba(16, 185, 129, 0.28)" : "none",
          borderRadius: 7,
          cursor: "pointer",
          color: hasTasks ? "#10b981" : "var(--text-muted)",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (!hasTasks) e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          if (!hasTasks) e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>

        {hasTasks && (
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {taskCount}
          </span>
        )}
      </button>

      {modalOpen && (
        <BgTasksModal
          onClose={() => setModalOpen(false)}
          onCountChange={(cnt) => setTaskCount(cnt)}
        />
      )}
    </>
  );
}
