"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import type { UnifiedSyncStatus, RepoStatus } from "@/lib/dotpi/sync-service";

export function CloudSyncButton({ iconButtonSize = 36 }: { iconButtonSize?: number }) {
  const [status, setStatus] = useState<UnifiedSyncStatus | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [syncingTarget, setSyncingTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dotpi/status");
      if (res.ok) {
        const data = (await res.json()) as UnifiedSyncStatus;
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

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const targetWidth = 360;
    const maxWidth = Math.min(targetWidth, window.innerWidth - 24);

    let left = rect.right - maxWidth;
    if (left < 12) left = 12;
    if (left + maxWidth > window.innerWidth - 12) {
      left = window.innerWidth - 12 - maxWidth;
    }

    setDropdownPos({
      top: rect.bottom + 6,
      left,
      width: maxWidth,
    });
  }, []);

  const togglePopover = () => {
    if (!popoverOpen) {
      updatePosition();
    }
    setPopoverOpen((v) => !v);
  };

  useEffect(() => {
    if (!popoverOpen) return;
    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [popoverOpen, updatePosition]);

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

  const handleSync = async (target: "dot-pi" | "pi-web" | "all", mode: "pull" | "push" | "auto") => {
    setSyncingTarget(target);
    setFeedback(null);
    try {
      const res = await fetch("/api/dotpi/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mode }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        const msg = result.results
          ?.map((r: { repo: string; message: string }) => `${r.repo}: ${r.message}`)
          .join("； ") || "同步成功";
        setFeedback({ type: "success", text: msg });
        if (result.status) setStatus(result.status);
      } else {
        setFeedback({ type: "error", text: result.error || "同步失败" });
      }
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "网络错误" });
    } finally {
      setSyncingTarget(null);
    }
  };

  const hasCloudUpdates = Boolean(status?.hasCloudUpdates);
  const hasLocalChanges = Boolean(status?.hasLocalChanges);

  let badgeColor = "#22c55e"; // green
  let tooltipText = "全部仓库已与 GitHub 同步";
  if (hasCloudUpdates) {
    badgeColor = "#38bdf8"; // sky blue
    tooltipText = `发现云端有 ${status?.totalBehind} 个新提交，点击同步`;
  } else if (hasLocalChanges) {
    badgeColor = "#f59e0b"; // amber/orange
    tooltipText = "本地有未同步代码/配置改动，点击备份";
  }

  const renderRepoCard = (repo: RepoStatus) => {
    const isTargetSyncing = syncingTarget === repo.id || syncingTarget === "all";
    const repoBehind = repo.behind > 0;
    const repoDirty = repo.isDirty || repo.ahead > 0;

    let repoBadgeColor = "#22c55e";
    let repoBadgeText = "已同步";
    if (repoBehind) {
      repoBadgeColor = "#38bdf8";
      repoBadgeText = `云端领先 ${repo.behind}`;
    } else if (repoDirty) {
      repoBadgeColor = "#f59e0b";
      repoBadgeText = repo.isDirty ? "本地有改动" : `领先 ${repo.ahead} 提交`;
    }

    return (
      <div
        key={repo.id}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
            <span>{repo.id === "dot-pi" ? "🪐" : "🌐"}</span>
            <span>{repo.id}</span>
          </span>
          <span
            style={{
              fontSize: 10.5,
              padding: "1px 5px",
              borderRadius: 4,
              background: repoBehind
                ? "rgba(56, 189, 248, 0.15)"
                : repoDirty
                ? "rgba(245, 158, 11, 0.15)"
                : "rgba(34, 197, 94, 0.15)",
              color: repoBadgeColor,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: repoBadgeColor }} />
            {repoBadgeText}
          </span>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, lineHeight: 1.3 }}>
          {repo.lastCommit ? (
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              最新提交: {repo.lastCommit}
            </div>
          ) : (
            <div>就绪</div>
          )}
          {repo.dirtyFiles.length > 0 && (
            <div style={{ color: "#f59e0b", marginTop: 2, fontSize: 10.5 }}>
              未提交文件 ({repo.dirtyFiles.length}): {repo.dirtyFiles.slice(0, 2).join(", ")}
              {repo.dirtyFiles.length > 2 && "..."}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {repoBehind ? (
            <button
              type="button"
              disabled={Boolean(syncingTarget)}
              onClick={() => void handleSync(repo.id, "pull")}
              style={{
                flex: 1,
                height: 24,
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: isTargetSyncing ? "not-allowed" : "pointer",
                opacity: isTargetSyncing ? 0.7 : 1,
              }}
            >
              {isTargetSyncing ? "拉取中..." : "⬇️ 拉取云端更新"}
            </button>
          ) : repoDirty ? (
            <button
              type="button"
              disabled={Boolean(syncingTarget)}
              onClick={() => void handleSync(repo.id, "push")}
              style={{
                flex: 1,
                height: 24,
                background: "#f59e0b",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: isTargetSyncing ? "not-allowed" : "pointer",
                opacity: isTargetSyncing ? 0.7 : 1,
              }}
            >
              {isTargetSyncing ? "推送中..." : "⬆️ 推送备份到 GitHub"}
            </button>
          ) : (
            <button
              type="button"
              disabled={Boolean(syncingTarget)}
              onClick={() => void handleSync(repo.id, "auto")}
              style={{
                flex: 1,
                height: 24,
                background: "var(--bg-selected)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 11,
                cursor: isTargetSyncing ? "not-allowed" : "pointer",
              }}
            >
              {isTargetSyncing ? "检查中..." : "🔄 检查"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={togglePopover}
          title={tooltipText}
          aria-label="云端仓库双向同步"
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
        </button>
      </div>

      {/* Popover Dropdown */}
      {popoverOpen && dropdownPos && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
            padding: 12,
            zIndex: 1000,
            fontSize: 12,
            color: "var(--text)",
            userSelect: "none",
            maxHeight: "calc(100dvh - 80px)",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span>云端仓库双向同步</span>
            </div>
            <button
              type="button"
              disabled={Boolean(syncingTarget)}
              onClick={() => void fetchStatus()}
              title="刷新检测"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: 11,
              }}
            >
              🔄
            </button>
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

          {/* Repositories */}
          {status?.dotPi && renderRepoCard(status.dotPi)}
          {status?.piWeb && renderRepoCard(status.piWeb)}

          {/* Master One-click Sync All Button */}
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              disabled={Boolean(syncingTarget)}
              onClick={() => void handleSync("all", "auto")}
              style={{
                width: "100%",
                height: 28,
                background: hasCloudUpdates ? "var(--accent)" : hasLocalChanges ? "#f59e0b" : "var(--bg-selected)",
                color: hasCloudUpdates || hasLocalChanges ? "#fff" : "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                fontWeight: 600,
                fontSize: 11.5,
                cursor: syncingTarget ? "not-allowed" : "pointer",
                opacity: syncingTarget ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {syncingTarget === "all" ? "正在全量同步..." : "🚀 一键同步全部仓库 (dot-pi + pi-web)"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
