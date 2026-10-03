"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProxySettingsResponse } from "@/lib/api-types";
import {
  DEFAULT_PROXY_URL,
  readStoredAutoFallback,
  readStoredProxyEnabled,
  readStoredProxyUrl,
  writeStoredAutoFallback,
  writeStoredProxyEnabled,
  writeStoredProxyUrl,
} from "@/lib/proxy-preference";

export interface ProxySettingsController {
  /** 服务端返回的状态；首次加载完成前为 null。 */
  state: ProxySettingsResponse | null;
  /** 输入框里的代理地址。 */
  draftUrl: string;
  setDraftUrl: (url: string) => void;
  loading: boolean;
  saving: boolean;
  /** 展示给用户的错误详情，null 表示没有错误。 */
  error: string | null;
  /** 是否开启「不可达时自动切回直连」。 */
  autoFallback: boolean;
  setAutoFallback: (enabled: boolean) => void;
  /** 是否刚刚触发了自动切回直连。 */
  autoFallbackTriggered: boolean;
  clearAutoFallbackNotice: () => void;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  toggle: () => Promise<void>;
}

interface Options {
  /** 大于 0 时按该间隔轮询服务端状态（顶栏图标用）。 */
  pollMs?: number;
}

// 模块级单例缓存与监听器：保证顶栏图标、设置面板与多标签页之间毫秒级同步。
let sharedProxyState: ProxySettingsResponse | null = null;
const stateListeners = new Set<(state: ProxySettingsResponse) => void>();

const PROXY_BROADCAST_CHANNEL = "pi-web:proxy-sync";
let broadcastChannelInstance: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(PROXY_BROADCAST_CHANNEL);
      broadcastChannelInstance.onmessage = (event) => {
        if (event.data && typeof event.data === "object" && "enabled" in event.data) {
          notifyStateChange(event.data as ProxySettingsResponse, false);
        }
      };
    } catch {
      broadcastChannelInstance = null;
    }
  }
  return broadcastChannelInstance;
}

function notifyStateChange(next: ProxySettingsResponse, broadcast = true): void {
  sharedProxyState = next;
  for (const listener of stateListeners) {
    listener(next);
  }
  if (broadcast) {
    try {
      getBroadcastChannel()?.postMessage(next);
    } catch {
      // 广播通道为尽力而为。
    }
  }
}

/**
 * 代理开关状态 Hook。
 *
 * 特性：
 * 1. 顶栏、设置面板、多标签页之间毫秒级发布订阅同步；
 * 2. 页面在后台时休眠轮询，切回前台时立即主动探测一次；
 * 3. 检测到代理离线且开启了 autoFallback 时，自动关闭代理切回直连，防止国内模型受累。
 */
export function useProxySettings({ pollMs = 0 }: Options = {}): ProxySettingsController {
  const [state, setState] = useState<ProxySettingsResponse | null>(() => {
    if (sharedProxyState) return sharedProxyState;
    if (typeof window === "undefined") return null;
    const storedEnabled = readStoredProxyEnabled();
    const storedUrl = readStoredProxyUrl();
    return {
      enabled: storedEnabled,
      url: storedEnabled ? storedUrl : null,
      reachable: storedEnabled,
      host: null,
      port: null,
    };
  });
  const [draftUrl, setDraftUrlState] = useState(DEFAULT_PROXY_URL);
  const [loading, setLoading] = useState(sharedProxyState === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFallback, setAutoFallbackState] = useState(true);
  const [autoFallbackTriggered, setAutoFallbackTriggered] = useState(false);

  const mountedRef = useRef(true);
  const userEditedRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const lastUserActionTimeRef = useRef(Date.now());
  const autoFallbackRef = useRef(true);
  autoFallbackRef.current = autoFallback;

  const applyState = useCallback((next: ProxySettingsResponse, broadcast = true) => {
    setState(next);
    writeStoredProxyEnabled(next.enabled);
    notifyStateChange(next, broadcast);
    if (next.url && !userEditedRef.current) setDraftUrlState(next.url);
  }, []);

  const setAutoFallback = useCallback((val: boolean) => {
    setAutoFallbackState(val);
    autoFallbackRef.current = val;
    writeStoredAutoFallback(val);
  }, []);

  const clearAutoFallbackNotice = useCallback(() => {
    setAutoFallbackTriggered(false);
  }, []);

  // 跨组件监听模块级状态变更
  useEffect(() => {
    const onStateUpdate = (next: ProxySettingsResponse) => {
      if (!mountedRef.current) return;
      setState(next);
      if (next.url && !userEditedRef.current) setDraftUrlState(next.url);
    };
    stateListeners.add(onStateUpdate);
    return () => {
      stateListeners.delete(onStateUpdate);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/proxy");
      const data = await response.json() as ProxySettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (!mountedRef.current) return;

      applyState(data);

      const isFirstMount = isInitialMountRef.current;
      isInitialMountRef.current = false;

      // 优化 3：检测到代理开启但已不可达，且距页面初次加载或手动操作超过 6 秒
      if (
        !isFirstMount &&
        data.enabled &&
        !data.reachable &&
        autoFallbackRef.current &&
        Date.now() - lastUserActionTimeRef.current > 6000
      ) {
        try {
          const fallbackRes = await fetch("/api/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json() as ProxySettingsResponse;
            if (mountedRef.current) {
              applyState(fallbackData);
              setAutoFallbackTriggered(true);
            }
          }
        } catch {
          // 降级失败由下次轮询兜底
        }
      }
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    mountedRef.current = true;
    setDraftUrlState(readStoredProxyUrl());
    setAutoFallbackState(readStoredAutoFallback());
    void refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  // 优化 2：页面后台休眠 + 切回前台立即探测
  useEffect(() => {
    if (pollMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const startTimer = () => {
      if (!timer) {
        timer = setInterval(() => {
          if (typeof document === "undefined" || document.visibilityState === "visible") {
            void refresh();
          }
        }, pollMs);
      }
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        // 切回前台：立即探测一次最新状态，并恢复轮询
        void refresh();
        startTimer();
      } else {
        // 切到后台：停止定时器，避免无意义的唤醒与网络探测
        stopTimer();
      }
    };

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startTimer();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      stopTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [pollMs, refresh]);

  const setDraftUrl = useCallback((url: string) => {
    userEditedRef.current = true;
    setDraftUrlState(url);
    writeStoredProxyUrl(url);
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    lastUserActionTimeRef.current = Date.now();
    setAutoFallbackTriggered(false);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled ? { enabled: true, url: draftUrl } : { enabled: false }),
      });
      const data = await response.json() as ProxySettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (!mountedRef.current) return;
      applyState(data);
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [applyState, draftUrl]);

  const toggle = useCallback(async () => {
    await setEnabled(!(state?.enabled ?? false));
  }, [setEnabled, state?.enabled]);

  return {
    state,
    draftUrl,
    setDraftUrl,
    loading,
    saving,
    error,
    autoFallback,
    setAutoFallback,
    autoFallbackTriggered,
    clearAutoFallbackNotice,
    refresh,
    setEnabled,
    toggle,
  };
}
