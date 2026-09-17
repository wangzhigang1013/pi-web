"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigButton } from "./SettingsUi";

interface UserQuotaInfo {
  planName: string;
  totalBudget: number;
  actualCost: number;
  remainingBudget: number;
  usagePercentage: number;
  resetCycle: string;
}

interface RemoteChehejiaModel {
  id: string;
  displayName: string;
  createdAt?: string;
  hasVision: boolean;
  hasThinking: boolean;
  contextWindow: number;
  maxTokens: number;
  priceTag?: string;
  usedTokens?: string;
  usedCost?: string;
}

interface ApiResponse {
  ok: boolean;
  isNetworkError?: boolean;
  error?: string;
  gatewayUrl: string;
  hasEptToken: boolean;
  accountName: string | null;
  quota: UserQuotaInfo | null;
  remoteModels: RemoteChehejiaModel[];
  enabledModelIds: string[];
  defaultModelId: string | null;
}

const RECOMMENDED_DEFAULT_IDS = [
  "baidu-deepseek-v4-flash[1m]",
  "bailian-glm-5_3[1m]",
  "kivy-qwen3_8-flash[1m]",
  "azure-gpt-5_6-sol",
  "aws-claude-haiku-4-5",
];

export function ChehejiaDetail({
  onRefreshParent,
  onNavigateSection,
}: {
  onRefreshParent?: () => void;
  onNavigateSection?: (section: string) => void;
}) {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [gatewayUrl, setGatewayUrl] = useState("https://portal-k8s-prod.ep.chehejia.com/api/copilot/v2/claudecode");
  const [hasEptToken, setHasEptToken] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [quota, setQuota] = useState<UserQuotaInfo | null>(null);

  const [remoteModels, setRemoteModels] = useState<RemoteChehejiaModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);

  // 过滤与搜索状态
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [thinkingOnly, setThinkingOnly] = useState(false);
  const [visionOnly, setVisionOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "price-asc" | "price-desc">("default");

  const loadData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setIsNetworkError(false);
    setSuccessMsg(null);

    try {
      const resp = await fetch("/api/chehejia/models", { cache: "no-store" });
      const data = (await resp.json()) as ApiResponse;

      if (!resp.ok || !data.ok) {
        setError(data.error || `获取公司模型失败 (HTTP ${resp.status})`);
        setIsNetworkError(Boolean(data.isNetworkError));
      }

      setGatewayUrl(data.gatewayUrl || gatewayUrl);
      setHasEptToken(data.hasEptToken ?? false);
      setAccountName(data.accountName ?? null);
      setQuota(data.quota ?? null);
      setRemoteModels(data.remoteModels || []);
      setSelectedModelIds(new Set(data.enabledModelIds || []));
      setDefaultModelId(data.defaultModelId || null);

      if (isManualRefresh && data.ok) {
        setSuccessMsg(`已成功同步最新模型与额度数据（共 ${data.remoteModels?.length || 0} 个可用模型）`);
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err: any) {
      setError(err?.message || "网络请求失败，请检查服务状态");
      setIsNetworkError(true);
      setRemoteModels([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 解析价格数字辅助排序
  const parsePriceNum = (tag?: string): number => {
    if (!tag) return 999;
    if (tag === "免费") return 0;
    const m = tag.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 999;
  };

  // 过滤与排序后的模型列表
  const filteredModels = useMemo(() => {
    const list = remoteModels.filter((m) => {
      const name = m.displayName.toLowerCase();
      const id = m.id.toLowerCase();
      const q = searchQuery.trim().toLowerCase();

      if (q && !name.includes(q) && !id.includes(q)) return false;

      if (brandFilter === "claude" && !name.includes("claude") && !id.includes("claude")) return false;
      if (brandFilter === "gpt" && !name.includes("gpt") && !id.includes("gpt")) return false;
      if (brandFilter === "deepseek" && !name.includes("deepseek") && !id.includes("deepseek")) return false;
      if (brandFilter === "glm" && !name.includes("glm") && !id.includes("glm")) return false;
      if (brandFilter === "qwen" && !name.includes("qwen") && !id.includes("qwen")) return false;

      if (thinkingOnly && !m.hasThinking) return false;
      if (visionOnly && !m.hasVision) return false;

      return true;
    });

    if (sortBy === "price-asc") {
      list.sort((a, b) => parsePriceNum(a.priceTag) - parsePriceNum(b.priceTag));
    } else if (sortBy === "price-desc") {
      list.sort((a, b) => parsePriceNum(b.priceTag) - parsePriceNum(a.priceTag));
    }

    return list;
  }, [remoteModels, searchQuery, brandFilter, thinkingOnly, visionOnly, sortBy]);

  // 切换选中
  const toggleModel = useCallback((modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
        if (defaultModelId === modelId) setDefaultModelId(null);
      } else {
        next.add(modelId);
      }
      return next;
    });
  }, [defaultModelId]);

  // 快捷批量操作
  const selectAllFiltered = useCallback(() => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredModels) next.add(m.displayName);
      return next;
    });
  }, [filteredModels]);

  const unselectAllFiltered = useCallback(() => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredModels) next.delete(m.displayName);
      return next;
    });
  }, [filteredModels]);

  const resetToRecommended = useCallback(() => {
    setSelectedModelIds(new Set(RECOMMENDED_DEFAULT_IDS));
    setDefaultModelId(RECOMMENDED_DEFAULT_IDS[0] || null);
  }, []);

  // 保存并更新配置
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const enabledList: Array<{
        id: string;
        name: string;
        reasoning: boolean;
        hasVision: boolean;
        contextWindow: number;
        maxTokens: number;
        priceTag?: string;
      }> = [];

      for (const m of remoteModels) {
        if (selectedModelIds.has(m.displayName) || selectedModelIds.has(m.id)) {
          enabledList.push({
            id: m.displayName,
            name: `${m.displayName}${m.priceTag ? ` (${m.priceTag})` : ""}`,
            reasoning: m.hasThinking,
            hasVision: m.hasVision,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            priceTag: m.priceTag,
          });
        }
      }

      const resp = await fetch("/api/chehejia/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledModels: enabledList,
          defaultModelId: defaultModelId || undefined,
        }),
      });

      const result = await resp.json();
      if (!resp.ok || !result.ok) {
        throw new Error(result.error || `保存失败 HTTP ${resp.status}`);
      }

      setSuccessMsg(`保存成功！已启用 ${enabledList.length} 个公司模型，即刻生效。`);
      onRefreshParent?.();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.message || "保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  const isDisconnected = !loading && (!hasEptToken || isNetworkError || (Boolean(error) && remoteModels.length === 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 顶部标题与连接状态 */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0 }}>
              公司模型池子 (Chehejia Copilot)
            </h2>
            {isDisconnected ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 12,
                  fontSize: 11,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                {!hasEptToken ? "未登录 EPT" : "无法连接内网"}
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 12,
                  fontSize: 11,
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                内网已连通 ({accountName || "EPT 已认证"})
              </span>
            )}
          </div>
          <ConfigButton
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
            style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
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
              style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            {refreshing ? "正在重试连接..." : "刷新连接与模型"}
          </ConfigButton>
        </div>

        {/* 仅在连通时展示额度用量仪表盘 */}
        {!isDisconnected && quota && (
          <div
            style={{
              marginTop: 10,
              marginBottom: 12,
              padding: "12px 16px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
              border: "1px solid color-mix(in srgb, var(--accent) 20%, var(--border))",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}>剩余可用额度</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                  ¥ {quota.remainingBudget.toFixed(2)}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-dim)", marginLeft: 6 }}>
                  / 总额度 ¥ {quota.totalBudget.toFixed(2)} ({quota.resetCycle === "monthly" ? "按月重置" : quota.resetCycle})
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>
                  已消耗: <strong style={{ color: "var(--text)" }}>¥ {quota.actualCost.toFixed(2)}</strong>
                </span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      quota.usagePercentage > 80
                        ? "rgba(239, 68, 68, 0.15)"
                        : quota.usagePercentage > 50
                        ? "rgba(245, 158, 11, 0.15)"
                        : "rgba(16, 185, 129, 0.15)",
                    color:
                      quota.usagePercentage > 80
                        ? "#ef4444"
                        : quota.usagePercentage > 50
                        ? "#f59e0b"
                        : "#10b981",
                  }}
                >
                  已用 {quota.usagePercentage}%
                </span>
              </div>
            </div>

            {/* 进度条 */}
            <div
              style={{
                width: "100%",
                height: 6,
                borderRadius: 3,
                background: "var(--border)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(1, quota.usagePercentage))}%`,
                  height: "100%",
                  borderRadius: 3,
                  background:
                    quota.usagePercentage > 80
                      ? "#ef4444"
                      : quota.usagePercentage > 50
                      ? "#f59e0b"
                      : "var(--accent)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {!isDisconnected && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
            从公司内部网关动态同步最新的模型清单。已为您<strong>自动过滤冗余的普通版、仅保留 1M 超长上下文版本</strong>。在此勾选想在聊天中使用的模型，保存后主界面即刻可选。
          </p>
        )}

        {/* 成功提示 */}
        {successMsg && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              color: "#10b981",
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {successMsg}
          </div>
        )}

        {/* 仅在正常连接时展示筛选与搜索工具条 */}
        {!isDisconnected && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
            {/* 搜索框 */}
            <div style={{ position: "relative", flex: "1 1 180px" }}>
              <input
                type="text"
                placeholder="搜索模型名称..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 10px 6px 28px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>

            {/* 品牌芯片 */}
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { id: "all", label: "全部" },
                { id: "claude", label: "Claude" },
                { id: "gpt", label: "GPT" },
                { id: "deepseek", label: "DeepSeek" },
                { id: "glm", label: "GLM" },
                { id: "qwen", label: "Qwen" },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBrandFilter(b.id)}
                  style={{
                    padding: "4px 9px",
                    borderRadius: 5,
                    fontSize: 11,
                    cursor: "pointer",
                    border: brandFilter === b.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: brandFilter === b.id ? "var(--bg-selected)" : "none",
                    color: brandFilter === b.id ? "var(--accent)" : "var(--text-muted)",
                    fontWeight: brandFilter === b.id ? 600 : 400,
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* 价格排序下拉 */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{
                padding: "4px 8px",
                borderRadius: 5,
                fontSize: 11,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <option value="default">默认排序</option>
              <option value="price-asc">价格由低到高 🪙↑</option>
              <option value="price-desc">价格由高到低 🪙↓</option>
            </select>

            {/* 能力复选 */}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={thinkingOnly} onChange={(e) => setThinkingOnly(e.target.checked)} />
              🧠 仅支持思考
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={visionOnly} onChange={(e) => setVisionOnly(e.target.checked)} />
              🖼️ 仅支持视觉
            </label>

            {/* 快捷操作 */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={selectAllFiltered}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: 11,
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
              >
                全选
              </button>
              <button
                type="button"
                onClick={unselectAllFiltered}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                清空
              </button>
              <button
                type="button"
                onClick={resetToRecommended}
                title="重置为推荐的 5 个主力模型"
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                推荐预设
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 主展示区：离线未连接 vs 正常模型列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: 13 }}>
            <div style={{ marginBottom: 12 }}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ animation: "spin 1.2s linear infinite" }}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </div>
            正在连接公司网关与同步额度...
          </div>
        ) : isDisconnected ? (
          /* 【核心】离线/在家未连接内网专用页面（清空模型选项） */
          <div
            style={{
              maxWidth: 540,
              margin: "40px auto",
              padding: "28px 24px",
              borderRadius: 12,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05)",
              textAlign: "center",
            }}
          >
            {/* 离线警示图标 */}
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>

            <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>
              无法连接公司模型网关
            </h3>

            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
              {!hasEptToken
                ? "本地未检测到 EPT 登录凭证，请先登录企业账号。"
                : "检测到当前网络无法访问公司内部模型网关。在居家或外网环境下，必须开启公司 VPN 才能使用公司模型。"}
            </p>

            {/* 排查提示卡片 */}
            <div
              style={{
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--text-muted)",
                lineHeight: 1.8,
                marginBottom: 22,
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>💡 如何恢复连接：</div>
              <div>1. <strong>开启 VPN</strong>：打开电脑上的 EasyConnect / 理想 VPN 客户端并登录。</div>
              <div>2. <strong>EPT 认证</strong>：在终端执行 <code>ept login</code> 完成账号登录验证。</div>
              <div>3. <strong>使用公网模型</strong>：未连 VPN 时，请使用主界面的 Antigravity 或公共模型。</div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => void loadData(true)}
                disabled={refreshing}
                style={{
                  padding: "8px 20px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  cursor: refreshing ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
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
                  style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                {refreshing ? "正在重试..." : "重试连接网关"}
              </button>
            </div>
          </div>
        ) : filteredModels.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-dim)", fontSize: 13 }}>
            没有符合当前筛选条件的模型
          </div>
        ) : (
          /* 正常模型列表展示区 */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {filteredModels.map((m) => {
              const isChecked = selectedModelIds.has(m.displayName) || selectedModelIds.has(m.id);
              const isDefault = defaultModelId === m.displayName || defaultModelId === m.id;

              return (
                <div
                  key={m.id}
                  onClick={() => toggleModel(m.displayName)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    borderRadius: 8,
                    background: isChecked ? "color-mix(in srgb, var(--accent) 7%, var(--bg-panel))" : "var(--bg-panel)",
                    border: isChecked
                      ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)"
                      : "1px solid var(--border)",
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                    position: "relative",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        style={{ marginTop: 2, cursor: "pointer", accentColor: "var(--accent)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: isChecked ? "var(--text)" : "var(--text-muted)",
                              wordBreak: "break-all",
                            }}
                          >
                            {m.displayName}
                          </span>

                          {/* 价格倍率徽章 */}
                          {m.priceTag && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background:
                                  m.priceTag === "免费"
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : parsePriceNum(m.priceTag) <= 1.0
                                    ? "rgba(59, 130, 246, 0.12)"
                                    : parsePriceNum(m.priceTag) <= 3.0
                                    ? "rgba(245, 158, 11, 0.15)"
                                    : "rgba(239, 68, 68, 0.15)",
                                color:
                                  m.priceTag === "免费"
                                    ? "#10b981"
                                    : parsePriceNum(m.priceTag) <= 1.0
                                    ? "#3b82f6"
                                    : parsePriceNum(m.priceTag) <= 3.0
                                    ? "#f59e0b"
                                    : "#ef4444",
                                fontWeight: 600,
                                border: "1px solid currentColor",
                              }}
                            >
                              🪙 {m.priceTag}
                            </span>
                          )}

                          {isDefault && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "var(--accent)",
                                color: "#fff",
                                fontWeight: 500,
                              }}
                            >
                              默认
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                          {m.id}
                        </div>
                      </div>
                    </div>

                    {/* 特性徽章 */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10, marginLeft: 22 }}>
                      {m.hasThinking && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(168, 85, 247, 0.12)",
                            color: "#a855f7",
                            border: "1px solid rgba(168, 85, 247, 0.25)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          🧠 深度思考
                        </span>
                      )}
                      {m.hasVision && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(59, 130, 246, 0.12)",
                            color: "#3b82f6",
                            border: "1px solid rgba(59, 130, 246, 0.25)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          🖼️ 视觉识别
                        </span>
                      )}
                      {m.contextWindow >= 1000000 && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(16, 185, 129, 0.12)",
                            color: "#10b981",
                            border: "1px solid rgba(16, 185, 129, 0.25)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          ⚡ 1M 上下文
                        </span>
                      )}
                      {m.usedCost && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(107, 114, 128, 0.12)",
                            color: "var(--text-dim)",
                            border: "1px solid var(--border)",
                          }}
                          title={`本月已消耗: ${m.usedTokens} tokens (${m.usedCost})`}
                        >
                          已消耗 {m.usedCost}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 底部设为默认按钮 */}
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedModelIds((prev) => new Set([...prev, m.displayName]));
                        setDefaultModelId(m.displayName);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: 11,
                        color: isDefault ? "var(--accent)" : "var(--text-dim)",
                        cursor: "pointer",
                        fontWeight: isDefault ? 600 : 400,
                      }}
                    >
                      {isDefault ? "★ 当前默认" : "☆ 设为默认"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部浮动保存栏（仅连通时展示） */}
      {!isDisconnected && (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            已选择 <strong style={{ color: "var(--accent)" }}>{selectedModelIds.size}</strong> 个模型（网关共 {remoteModels.length} 个）
            {defaultModelId && (
              <span style={{ marginLeft: 12, color: "var(--text-dim)" }}>
                默认模型：<code style={{ color: "var(--text)" }}>{defaultModelId}</code>
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || selectedModelIds.size === 0}
              style={{
                padding: "7px 20px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                cursor: saving || selectedModelIds.size === 0 ? "not-allowed" : "pointer",
                opacity: saving || selectedModelIds.size === 0 ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {saving ? "正在保存..." : "保存并启用选中模型"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
