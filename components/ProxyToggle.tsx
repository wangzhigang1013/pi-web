"use client";

import { useI18n } from "@/hooks/useI18n";
import { useProxySettings } from "@/hooks/useProxySettings";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

const PROXY_POLL_MS = 30_000;

/** 状态点：未启用为灰，启用且可达为绿，启用但探测不到为红。 */
function statusTone(enabled: boolean, reachable: boolean): "off" | "ok" | "warn" {
  if (!enabled) return "off";
  return reachable ? "ok" : "warn";
}

/**
 * 顶栏图标按钮：一眼看出代理开没开、代理软件在不在，点一下直接切换。
 *
 * 与设置面板里的开关共用 `/api/proxy`，只影响当前 Pi Web 进程。
 */
export function ProxyIconButton({ iconButtonSize = 36 }: { iconButtonSize?: number }) {
  const { t } = useI18n();
  const { state, loading, saving, error, toggle, autoFallbackTriggered } = useProxySettings({ pollMs: PROXY_POLL_MS });

  const enabled = state?.enabled === true;
  const reachable = state?.reachable === true;
  const tone = statusTone(enabled, reachable);

  const statusLabel = loading || state === null
    ? t("settings.proxyChecking")
    : !enabled
      ? t("settings.proxyOff")
      : reachable
        ? t("settings.proxyReachable")
        : t("settings.proxyUnreachable");

  const detail = enabled && state?.url ? ` · ${state.url}` : "";
  const errorSuffix = error ? ` · ${t("settings.proxySaveFailed")}: ${error}` : "";
  const autoNotice = autoFallbackTriggered ? ` · ℹ️ ${t("settings.proxyAutoFallbackNotice")}` : "";
  const title = `${t("settings.proxy")} · ${statusLabel}${detail}${autoNotice}${errorSuffix}`;
  const dotColor = tone === "ok" ? "#22c55e" : tone === "warn" ? "#ef4444" : "var(--text-dim)";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={loading || saving}
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: iconButtonSize,
        height: iconButtonSize,
        padding: 0,
        background: "none",
        border: "none",
        borderLeft: "1px solid var(--border)",
        color: enabled ? "var(--text)" : "var(--text-muted)",
        cursor: loading || saving ? "default" : "pointer",
        flexShrink: 0,
        position: "relative",
        opacity: saving ? 0.6 : 1,
        transition: "color 0.12s, background 0.12s, opacity 0.15s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = enabled ? "var(--text)" : "var(--text-muted)";
      }}
    >
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
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
      </svg>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 7,
          bottom: 7,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: "0 0 0 2px var(--bg)",
        }}
      />
    </button>
  );
}

/**
 * 设置面板里的详细开关：带地址输入、可达性状态与手动复检。
 *
 * 地址只在点击开关时提交，避免边输入边改全局 dispatcher。
 */
export function ProxySettingsSection() {
  const { t } = useI18n();
  const {
    state,
    draftUrl,
    setDraftUrl,
    loading,
    saving,
    error,
    autoFallback,
    setAutoFallback,
    autoFallbackTriggered,
    setEnabled,
    refresh,
  } = useProxySettings();

  const enabled = state?.enabled === true;
  const reachable = state?.reachable === true;
  const tone = statusTone(enabled, reachable);

  const statusLabel = loading || state === null
    ? t("settings.proxyChecking")
    : !enabled
      ? t("settings.proxyOff")
      : reachable
        ? t("settings.proxyReachable")
        : t("settings.proxyUnreachable");

  return (
    <section className="settings-general-section">
      <h3 className="settings-general-heading">{t("settings.proxy")}</h3>
      <p className="settings-general-description">{t("settings.proxyDescription")}</p>
      <div className="settings-shell-option">
        <span>{t("settings.proxyEnabled")}</span>
        <ConfigSwitch
          checked={enabled}
          loading={saving || loading}
          label={t("settings.proxyEnabled")}
          onChange={(next) => void setEnabled(next)}
        />
      </div>
      <div className="settings-shell-option">
        <div>
          <span>{t("settings.proxyAutoFallback")}</span>
          <p className="settings-general-description" style={{ margin: "2px 0 0", fontSize: 11 }}>
            {t("settings.proxyAutoFallbackDescription")}
          </p>
        </div>
        <ConfigSwitch
          checked={autoFallback}
          loading={saving || loading}
          label={t("settings.proxyAutoFallback")}
          onChange={(next) => setAutoFallback(next)}
        />
      </div>
      <input
        className="settings-proxy-input"
        type="text"
        value={draftUrl}
        spellCheck={false}
        aria-label={t("settings.proxyUrl")}
        placeholder="http://127.0.0.1:7897"
        onChange={(event) => setDraftUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void setEnabled(true);
        }}
      />
      <div className={`settings-proxy-status${tone === "ok" ? " is-ok" : tone === "warn" ? " is-warn" : ""}`}>
        <span>{statusLabel}{enabled && state?.url ? ` · ${state.url}` : ""}</span>
      </div>
      <div className="settings-proxy-actions">
        <ConfigButton variant="secondary" size="small" onClick={() => void setEnabled(true)} disabled={saving || loading}>
          {t("settings.proxyApply")}
        </ConfigButton>
        <ConfigButton variant="ghost" size="small" onClick={() => void refresh()} disabled={loading}>
          {t("settings.proxyRecheck")}
        </ConfigButton>
      </div>
      {autoFallbackTriggered && (
        <p role="status" className="settings-proxy-notice" style={{ color: "#3b82f6", fontSize: 12, margin: "6px 0 0" }}>
          ℹ️ {t("settings.proxyAutoFallbackNotice")}
        </p>
      )}
      {error && <p role="alert" className="settings-general-error">{t("settings.proxySaveFailed")}: {error}</p>}
    </section>
  );
}
