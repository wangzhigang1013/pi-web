"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "./SettingsUi";

interface Bucket {
  displayName: string;
  remainingFraction: number;
  resetTime?: string;
  disabled?: boolean;
  description?: string;
}

interface QuotaGroup {
  displayName: string;
  buckets: Bucket[];
}

interface AccountItem {
  email: string;
  projectId: string;
  tier?: string;
  isActive: boolean;
  isCooldown: boolean;
  cooldownUntil?: number;
  error?: string;
  usage?: {
    planLabel?: string;
    groups: QuotaGroup[];
  };
}

interface ApiResponse {
  activeEmail: string;
  autoFailover: boolean;
  accounts: AccountItem[];
}

function formatReset(resetTime?: string | number): string {
  if (!resetTime) return "随时重置";
  const ts = typeof resetTime === "number" ? resetTime : Date.parse(resetTime);
  if (!Number.isFinite(ts)) return String(resetTime);
  const delta = ts - Date.now();
  if (delta <= 0) return "已重置";
  const totalMin = Math.round(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}天${hours > 0 ? ` ${hours}小时` : ""}后重置`;
  if (hours > 0) return `${hours}小时${mins > 0 ? ` ${mins}分` : ""}后重置`;
  return `${mins}分钟后重置`;
}

function QuotaItem({
  fraction,
  label,
  resetTime,
  disabled,
  description,
}: {
  fraction: number;
  label: string;
  resetTime?: string;
  disabled?: boolean;
  description?: string;
}) {
  const percent = disabled ? 0 : Math.round(fraction * 100);
  const isHealthy = percent > 50;
  const isWarning = percent > 20 && percent <= 50;
  const color = disabled || percent === 0 ? "#ef4444" : isHealthy ? "#10b981" : "#f59e0b";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 8 }}>
        <span style={{ fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
          <span style={{ fontWeight: 600, color }}>
            {disabled ? "已锁定" : percent === 0 ? "已用尽" : `${percent}%`}
          </span>
          {resetTime && (
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              ({formatReset(resetTime)})
            </span>
          )}
        </div>
      </div>

      {/* Progress Track */}
      <div
        style={{
          width: "100%",
          height: 6,
          borderRadius: 9999,
          backgroundColor: "color-mix(in srgb, var(--border) 80%, transparent)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: 9999,
            backgroundColor: color,
            transition: "width 0.4s ease, background-color 0.4s ease",
          }}
        />
      </div>

      {disabled && description && (
        <span style={{ fontSize: 10.5, color: "#ef4444", lineHeight: 1.3 }}>
          ⚠️ {description}
        </span>
      )}
    </div>
  );
}

export function AntigravityDetail({ onRefreshParent }: { onRefreshParent?: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add account modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [rawText, setRawText] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/antigravity/accounts");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleSwitch = async (email: string) => {
    try {
      const res = await fetch("/api/antigravity/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "switch", email }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await fetchAccounts();
      onRefreshParent?.();
    } catch (e: any) {
      alert(`切换失败: ${e?.message || String(e)}`);
    }
  };

  const handleDelete = async (email: string) => {
    if (!confirm(`确定要移除账号 ${email} 吗？`)) return;
    try {
      const res = await fetch("/api/antigravity/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", email }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await fetchAccounts();
      onRefreshParent?.();
    } catch (e: any) {
      alert(`删除失败: ${e?.message || String(e)}`);
    }
  };

  const handleAddAccount = async () => {
    if (!rawText.trim()) {
      setAddError("请粘贴账号凭据内容");
      return;
    }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch("/api/antigravity/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", rawText }),
      });
      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || `HTTP ${res.status}`);
      }
      setShowAddModal(false);
      setRawText("");
      await fetchAccounts();
      onRefreshParent?.();
    } catch (e: any) {
      setAddError(e?.message || String(e));
    } finally {
      setAddLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span style={{ fontSize: 13 }}>正在读取 Antigravity 账号与配额池信息…</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 900, margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
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
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
                Google Antigravity 账号管理中心
              </h3>
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  borderRadius: 10,
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  fontWeight: 500,
                }}
              >
                已连接 {data?.accounts.length || 0} 个账号
              </span>
            </div>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
              多账号实时负载均衡与配额池监控 · 遇到配额用尽或 429 时支持无缝切换与自动容灾
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ConfigButton
            variant="secondary"
            size="small"
            onClick={() => void fetchAccounts(true)}
            disabled={refreshing}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {refreshing ? "刷新中…" : "刷新配额"}
          </ConfigButton>
          <ConfigButton
            variant="primary"
            size="small"
            onClick={() => setShowAddModal(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            导入新凭据
          </ConfigButton>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "#ef4444",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Accounts List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {data?.accounts.map((acc) => {
          const isPrimary = acc.isActive;
          return (
            <div
              key={acc.email}
              style={{
                borderRadius: 10,
                background: isPrimary ? "color-mix(in srgb, var(--accent) 3.5%, var(--bg))" : "var(--bg)",
                border: isPrimary ? "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" : "1px solid var(--border)",
                borderLeft: isPrimary ? "3.5px solid var(--accent)" : "1px solid var(--border)",
                padding: "14px 16px",
                boxShadow: isPrimary ? "0 2px 10px -2px rgba(37, 99, 235, 0.10)" : "0 1px 3px rgba(0,0,0,0.02)",
                transition: "all 0.15s ease",
              }}
            >
              {/* Top Header of Account Card */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: isPrimary ? "var(--accent)" : "var(--bg-hover)",
                      color: isPrimary ? "#ffffff" : "var(--text-muted)",
                      border: isPrimary ? "none" : "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {acc.email.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                        {acc.email}
                      </span>
                      {isPrimary && (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 7px",
                            borderRadius: 6,
                            background: "rgba(37, 99, 235, 0.12)",
                            color: "var(--accent)",
                            border: "1px solid rgba(37, 99, 235, 0.25)",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span style={{ width: 4.5, height: 4.5, borderRadius: "50%", background: "var(--accent)" }} />
                          当前主用
                        </span>
                      )}
                      {!isPrimary && (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "var(--bg-panel)",
                            color: "var(--text-dim)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          备用容灾
                        </span>
                      )}
                      {acc.isCooldown && (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "rgba(245, 158, 11, 0.12)",
                            color: "#f59e0b",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            fontWeight: 500,
                          }}
                        >
                          ⚠️ 429 冷却中 ({formatReset(acc.cooldownUntil)})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-mono)" }}>
                      <span>项目: {acc.projectId}</span>
                      {acc.tier && <span>等级: {acc.tier}</span>}
                    </div>
                  </div>
                </div>

                {/* Account Action Buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {!isPrimary && (
                    <ConfigButton
                      variant="secondary"
                      size="small"
                      onClick={() => void handleSwitch(acc.email)}
                    >
                      设为主用
                    </ConfigButton>
                  )}
                  {data.accounts.length > 1 && (
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      onClick={() => void handleDelete(acc.email)}
                      style={{ color: "var(--text-dim)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                    >
                      移除
                    </ConfigButton>
                  )}
                </div>
              </div>

              {/* Quota Section */}
              {acc.error ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-panel)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)" }}>
                  ⚠️ 配额查询异常: {acc.error}
                </div>
              ) : acc.usage?.groups && acc.usage.groups.length > 0 ? (
                <div
                  style={{
                    background: "var(--bg-panel)",
                    borderRadius: 8,
                    padding: 12,
                    border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {acc.usage.groups.map((group) => (
                    <div key={group.displayName}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: "var(--text-dim)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        {group.displayName}
                      </span>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.buckets.map((b) => (
                          <QuotaItem
                            key={b.displayName}
                            fraction={b.remainingFraction}
                            label={b.displayName}
                            resetTime={b.resetTime}
                            disabled={b.disabled}
                            description={b.description}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 0" }}>
                  暂无配额详细分组
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Import Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              width: "100%",
              maxWidth: 560,
              padding: "20px 22px",
              boxShadow: "0 20px 48px -10px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
                导入 Google Antigravity 账号
              </strong>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 18,
                  color: "var(--text-dim)",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              支持直接粘贴整段购买的账号字符串或 JSON 凭据（包含 client_id, refresh_token, token, project_id 等），系统将自动识别提取并安全落盘。
            </p>

            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={'例如直接粘贴整段凭据：\ndanijames255@gmail.com|password|... {"client_id": "...", "refresh_token": "...", "project_id": "..."}'}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                boxSizing: "border-box",
                resize: "vertical",
                outline: "none",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />

            {addError && (
              <div style={{ fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 6 }}>
                <span>❌</span>
                <span>{addError}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <ConfigButton
                variant="secondary"
                size="small"
                onClick={() => setShowAddModal(false)}
                disabled={addLoading}
              >
                取消
              </ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                onClick={() => void handleAddAccount()}
                disabled={addLoading || !rawText.trim()}
              >
                {addLoading ? "验证导入中…" : "一键导入并验证"}
              </ConfigButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
