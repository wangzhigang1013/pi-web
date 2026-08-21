"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import type { DotPiStatus } from "@/lib/dotpi/sync-service";

export function CloudSyncButton({ iconButtonSize = 36 }: { iconButtonSize?: number }) {
  const [status, setStatus] = useState<DotPiStatus | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dotpi/status");
      if (res.ok) {
        const data = (await res.json()) as DotPiStatus;
        setStatus(data);
      }
    } catch {
      // ignore network errors
    }
  }, []);

  // Poll status on mount and every 60 seconds + on tab focus
  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(fetchStatus, 60000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStatus]);

  // Click outside to close popover
  useEffect(() => {
    if (!popoverOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popoverOpen]);

  const handleSync = async (mode: "pull" | "push" | "auto") => {
    setIsSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/dotpi/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setFeedback({ type: "success", text: result.message || "同步成功" });
        if (result.status) setStatus(result.status);
      } else {
        setFeedback({ type: "error", text: result.error || "同步失败" });
      }
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "网络错误" });
    } finally {
      setIsSyncing(false);
    }
  };

  const hasCloudUpdates = Boolean(status && status.behind > 0);
  const hasLocalChanges = Boolean(status && (status.isDirty || status.ahead > 0));

  let badgeColor = "#22c55e"; // green
  let tooltipText = "配置已与 GitHub 同步";
  if (hasCloudUpdates) {
    badgeColor = "#38bdf8"; // sky blue
    tooltipText = `发现云端有 ${status?.behind} 个新配置更新，点击同步`;
  } else if (hasLocalChanges) {
    badgeColor = "#f59e0b"; // amber/orange
    tooltipText = "本地有未同步配置改动，点击备份";
  }

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        title={tooltipText}
        aria-label="配置云端同步"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: iconButtonSize,
          height: iconButtonSize,
          padding: 0,
          background: popoverOpen ? "var(--bg-selected)" : "none",
          border: "none",
          borderLeft: "1px solid var(--border)",
          color: popoverOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          flexShrink: 0,
          position: "relative",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = popoverOpen ? "var(--text)" : "var(--text-muted)"; }}
      >
        {/* Cloud icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>

        {/* Status indicator dot */}
        {status?.isGitRepo && (
          <span
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: badgeColor,
              boxShadow: hasCloudUpdates ? "0 0 6px #38bdf8" : "none",
              animation: hasCloudUpdates ? "pulse 1.8s infinite" : "none",
            }}
          />
        )}
      </button>

      {/* Popover Dropdown */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 320,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
            padding: 12,
            zIndex: 100,
            fontSize: 12,
            color: "var(--text)",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span>配置云端同步 (~/.pi)</span>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                background: hasCloudUpdates ? "rgba(56, 189, 248, 0.15)" : hasLocalChanges ? "rgba(245, 158, 11, 0.15)" : "rgba(34, 197, 94, 0.15)",
                color: badgeColor,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: badgeColor }} />
              {hasCloudUpdates ? `云端领先 ${status?.behind} 个提交` : hasLocalChanges ? "本地有改动" : "已同步"}
            </span>
          </div>

          {/* Sync Status Description */}
          <div style={{ marginBottom: 10, color: "var(--text-muted)", lineHeight: 1.4, fontSize: 11.5 }}>
            {hasCloudUpdates && (
              <p style={{ color: "#38bdf8", margin: 0, fontWeight: 500 }}>
                ☁️ 发现云端有新配置（如公司修改的 Prompt 或技能），建议立即拉取更新。
              </p>
            )}
            {!hasCloudUpdates && hasLocalChanges && (
              <div>
                <p style={{ color: "#f59e0b", margin: 0, fontWeight: 500 }}>
                  ✏️ 本地有修改未推送到 GitHub：
                </p>
                {status?.dirtyFiles && status.dirtyFiles.length > 0 && (
                  <div style={{ marginTop: 4, maxHeight: 80, overflowY: "auto", background: "var(--bg)", padding: "4px 6px", borderRadius: 4, fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
                    {status.dirtyFiles.slice(0, 5).map((f) => (
                      <div key={f} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {f}</div>
                    ))}
                    {status.dirtyFiles.length > 5 && <div>...等共 {status.dirtyFiles.length} 个文件</div>}
                  </div>
                )}
              </div>
            )}
            {!hasCloudUpdates && !hasLocalChanges && (
              <p style={{ margin: 0 }}>
                本地配置、自写扩展与技能库已与云端仓库保持最新。
                {status?.lastCommit && <span style={{ display: "block", marginTop: 3, opacity: 0.8 }}>最新提交: {status.lastCommit}</span>}
              </p>
            )}
          </div>

          {/* Feedback Message */}
          {feedback && (
            <div
              style={{
                padding: "6px 8px",
                borderRadius: 4,
                marginBottom: 8,
                fontSize: 11,
                background: feedback.type === "success" ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: feedback.type === "success" ? "#22c55e" : "#ef4444",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>{feedback.type === "success" ? "✔" : "✖"}</span>
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {hasCloudUpdates ? (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void handleSync("pull")}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 28,
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 11.5,
                  cursor: isSyncing ? "not-allowed" : "pointer",
                  opacity: isSyncing ? 0.7 : 1,
                }}
              >
                {isSyncing ? "正在拉取..." : "⬇️ 一键拉取云端配置"}
              </button>
            ) : hasLocalChanges ? (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void handleSync("push")}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 28,
                  background: "#f59e0b",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 11.5,
                  cursor: isSyncing ? "not-allowed" : "pointer",
                  opacity: isSyncing ? 0.7 : 1,
                }}
              >
                {isSyncing ? "正在推送..." : "⬆️ 一键备份到 GitHub"}
              </button>
            ) : (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void handleSync("auto")}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 28,
                  background: "var(--bg-selected)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontWeight: 500,
                  fontSize: 11.5,
                  cursor: isSyncing ? "not-allowed" : "pointer",
                  opacity: isSyncing ? 0.7 : 1,
                }}
              >
                {isSyncing ? "检查中..." : "🔄 检查并刷新同步"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
