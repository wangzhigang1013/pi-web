"use client";

import { useEffect, useState, useCallback } from "react";
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

function formatReset(resetTime?: string): string {
  if (!resetTime) return "随时重置";
  const ts = Date.parse(resetTime);
  if (!Number.isFinite(ts)) return resetTime;
  const delta = ts - Date.now();
  if (delta <= 0) return "已重置";
  const totalMin = Math.round(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}天 ${hours}小时后`;
  if (hours > 0) return `${hours}小时 ${mins}分钟后`;
  return `${mins}分钟后`;
}

function ProgressBar({
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
  const color = disabled || percent === 0 ? "#ef4444" : percent > 50 ? "#22c55e" : percent > 20 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, flexWrap: "wrap", gap: 4 }}>
        <span style={{ color: "var(--text)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color }}>
          {disabled
            ? `0% (已用尽锁定 · ${resetTime ? formatReset(resetTime) : "待重置"})`
            : percent === 0
              ? `0% (已用尽 · ${resetTime ? formatReset(resetTime) : "待重置"})`
              : `${percent}% 剩余 ${resetTime ? `· ${formatReset(resetTime)}` : ""}`}
        </span>
      </div>
      <div
        style={{
          width: "100%",
          height: 6,
          borderRadius: 3,
          backgroundColor: "var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: 3,
            backgroundColor: color,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      {disabled && description && (
        <span style={{ fontSize: 10, color: "#ef4444", lineHeight: 1.3 }}>
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
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
        <p>正在读取 Antigravity 多账号与配额信息…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚡ Google Antigravity 账号管理中心</span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 12,
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                fontWeight: 500,
              }}
            >
              已连接 {data?.accounts.length || 0} 个账号
            </span>
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            手动选择当前使用的账号，配额用尽或限流时由你自行切换
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ConfigButton
            variant="secondary"
            size="small"
            onClick={() => void fetchAccounts(true)}
            disabled={refreshing}
          >
            {refreshing ? "刷新中…" : "🔄 刷新配额"}
          </ConfigButton>
          <ConfigButton
            variant="primary"
            size="small"
            onClick={() => setShowAddModal(true)}
          >
            ➕ 添加账号 / 导入凭据
          </ConfigButton>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Account Cards List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {data?.accounts.map((acc, idx) => {
          const isPrimary = acc.isActive;
          return (
            <div
              key={acc.email}
              style={{
                borderRadius: 8,
                background: "var(--bg)",
                border: isPrimary ? "2px solid #3b82f6" : "1px solid var(--border)",
                padding: 16,
                boxShadow: isPrimary ? "0 0 12px rgba(59, 130, 246, 0.15)" : undefined,
              }}
            >
              {/* Account Top Row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: isPrimary ? "#3b82f6" : "var(--border)",
                      color: isPrimary ? "#ffffff" : "var(--text)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {acc.email.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{acc.email}</strong>
                      {isPrimary && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "#3b82f6",
                            color: "#fff",
                            fontWeight: 600,
                          }}
                        >
                          👑 当前主用
                        </span>
                      )}
                      {!isPrimary && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "var(--bg-panel)",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          🔄 备用容灾
                        </span>
                      )}
                      {acc.isCooldown && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(245, 158, 11, 0.15)",
                            color: "#f59e0b",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                          }}
                        >
                          ⚠️ 429 冷却中
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 12 }}>
                      <span>项目: {acc.projectId}</span>
                      {acc.tier && <span>计划: {acc.tier}</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                      style={{ color: "#ef4444" }}
                    >
                      移除
                    </ConfigButton>
                  )}
                </div>
              </div>

              {/* Quota Progress */}
              {acc.error ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-panel)", padding: "8px 12px", borderRadius: 4 }}>
                  ⚠️ 配额查询异常: {acc.error}
                </div>
              ) : acc.usage?.groups && acc.usage.groups.length > 0 ? (
                <div
                  style={{
                    background: "var(--bg-panel)",
                    borderRadius: 6,
                    padding: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: 12,
                  }}
                >
                  {acc.usage.groups.map((group) => (
                    <div key={group.displayName}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                        {group.displayName}
                      </span>
                      {group.buckets.map((b) => (
                        <ProgressBar
                          key={b.displayName}
                          fraction={b.remainingFraction}
                          label={b.displayName}
                          resetTime={b.resetTime}
                          disabled={b.disabled}
                          description={b.description}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  暂无配额分组信息
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
            background: "rgba(0, 0, 0, 0.5)",
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
              borderRadius: 10,
              width: "100%",
              maxWidth: 580,
              padding: 20,
              boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 15 }}>添加 / 导入 Google Antigravity 账号</strong>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              支持直接粘贴整段购买的账号信息或 JSON 凭证（包含 client_id, refresh_token, token, project_id 等），系统将自动识别并验证。
            </p>

            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={'例如直接粘贴整段凭据：\ndanijames255@gmail.com|password|... {"client_id": "...", "refresh_token": "...", "project_id": "..."}'}
              style={{
                width: "100%",
                padding: 10,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />

            {addError && (
              <div style={{ fontSize: 12, color: "#ef4444" }}>
                ❌ {addError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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
