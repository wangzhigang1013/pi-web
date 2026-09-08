"use client";

import { useState, useEffect, useCallback } from "react";
import type { BackgroundServerItem } from "@/lib/background-tasks";

interface BgTasksModalProps {
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

function formatSince(since: number): string {
  const diffMs = Math.max(0, Date.now() - since);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚启动";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function BgTasksModal({ onClose, onCountChange }: BgTasksModalProps) {
  const [servers, setServers] = useState<BackgroundServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [killingPort, setKillingPort] = useState<number | null>(null);
  const [killingAll, setKillingAll] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/background-tasks", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { servers: BackgroundServerItem[] };
        setServers(data.servers || []);
        onCountChange?.(data.servers?.length || 0);
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void fetchServers();
    const interval = setInterval(() => void fetchServers(), 8000);
    return () => clearInterval(interval);
  }, [fetchServers]);

  const handleKillOne = async (port: number) => {
    setKillingPort(port);
    try {
      const res = await fetch("/api/background-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", port }),
      });
      if (res.ok) {
        const data = (await res.json()) as { servers: BackgroundServerItem[] };
        setServers(data.servers || []);
        onCountChange?.(data.servers?.length || 0);
      }
    } catch {
      // best-effort
    } finally {
      setKillingPort(null);
    }
  };

  const handleKillAll = async () => {
    if (!confirm("确定要终止所有由 AI 启动的后台服务并释放其端口吗？")) return;
    setKillingAll(true);
    try {
      const res = await fetch("/api/background-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "killAll" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { servers: BackgroundServerItem[] };
        setServers(data.servers || []);
        onCountChange?.(0);
      }
    } catch {
      // best-effort
    } finally {
      setKillingAll(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1050,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 620,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px -12px rgba(0, 0, 0, 0.35)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-panel)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
                border: "1px solid color-mix(in srgb, var(--accent) 26%, transparent)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 14.5, color: "var(--text)" }}>后台任务与端口守护</strong>
                {servers.length > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "1px 7px",
                      borderRadius: 10,
                      background: "rgba(16, 185, 129, 0.14)",
                      color: "#10b981",
                      border: "1px solid rgba(16, 185, 129, 0.28)",
                      fontWeight: 600,
                    }}
                  >
                    {servers.length} 运行中
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--text-muted)" }}>
                实时追踪 AI 启动的常驻服务与监听端口 · 支持一键直达或终止进程树
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "var(--text-dim)",
              padding: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
              正在扫描系统端口快照…
            </div>
          ) : servers.length === 0 ? (
            <div
              style={{
                padding: "48px 20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                color: "var(--text-dim)",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "var(--bg-panel)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                暂无运行中的后台任务
              </span>
              <span style={{ fontSize: 11.5, maxWidth: 360, lineHeight: 1.5 }}>
                当 AI 运行 <code>npm run dev</code>、<code>python app.py</code> 等命令拉起常驻监听端口时，系统会自动在此列出，方便随时管理。
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {servers.map((server) => {
                const isStopping = killingPort === server.port || killingAll;
                return (
                  <div
                    key={server.port}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      transition: "all 0.12s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            fontFamily: "var(--font-mono)",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "rgba(16, 185, 129, 0.12)",
                            color: "#10b981",
                            border: "1px solid rgba(16, 185, 129, 0.3)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                          :{server.port}
                        </span>

                        {server.name && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: "var(--text)",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {server.name}
                          </span>
                        )}

                        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                          PID {server.pid}
                        </span>

                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                          · {formatSince(server.since)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <a
                          href={`http://localhost:${server.port}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            padding: "4px 9px",
                            borderRadius: 6,
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            textDecoration: "none",
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          浏览
                        </a>
                        <button
                          type="button"
                          disabled={isStopping}
                          onClick={() => void handleKillOne(server.port)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            padding: "4px 9px",
                            borderRadius: 6,
                            background: "rgba(239, 68, 68, 0.08)",
                            border: "1px solid rgba(239, 68, 68, 0.25)",
                            color: "#ef4444",
                            cursor: isStopping ? "default" : "pointer",
                            fontWeight: 500,
                          }}
                          onMouseEnter={(e) => { if (!isStopping) e.currentTarget.style.background = "rgba(239, 68, 68, 0.16)"; }}
                          onMouseLeave={(e) => { if (!isStopping) e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)"; }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                          </svg>
                          {isStopping ? "终止中…" : "停止"}
                        </button>
                      </div>
                    </div>

                    {server.command && (
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-muted)",
                          background: "var(--bg)",
                          padding: "5px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={server.command}
                      >
                        <code>$ {server.command}</code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-panel)",
          }}
        >
          <button
            type="button"
            onClick={() => void fetchServers()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              padding: "5px 10px",
              borderRadius: 6,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            刷新端口
          </button>

          <button
            type="button"
            disabled={servers.length === 0 || killingAll}
            onClick={() => void handleKillAll()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              padding: "5px 12px",
              borderRadius: 6,
              background: servers.length === 0 ? "var(--bg-disabled)" : "#ef4444",
              border: "none",
              color: "#ffffff",
              cursor: servers.length === 0 || killingAll ? "default" : "pointer",
              fontWeight: 600,
              opacity: servers.length === 0 || killingAll ? 0.6 : 1,
            }}
          >
            {killingAll ? "正在终止…" : "全部终止 (Kill All)"}
          </button>
        </div>
      </div>
    </div>
  );
}
