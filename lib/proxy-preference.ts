/** 代理开关在浏览器里记住的地址，默认对齐 Clash Verge 的混合端口。 */
export const DEFAULT_PROXY_URL = "http://127.0.0.1:7897";

const STORAGE_KEY = "pi-web:proxy-url";
const PROXY_ENABLED_KEY = "pi-web:proxy-enabled";
const AUTO_FALLBACK_KEY = "pi-web:proxy-auto-fallback";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 把存储里读到的地址转换成可用的输入值。
 *
 * 存储只用于回填输入框，服务端返回的启用地址才是权威值，所以这里不做
 * 严格校验：无法解析的内容直接退回默认值。
 */
export function resolveProxyDraftUrl(stored: string | null | undefined): string {
  const trimmed = (stored ?? "").trim();
  if (trimmed.length === 0) return DEFAULT_PROXY_URL;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return DEFAULT_PROXY_URL;
    if (parsed.hostname.length === 0) return DEFAULT_PROXY_URL;
    return trimmed;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

export function readStoredProxyUrl(storage: StorageLike | null = getBrowserStorage()): string {
  if (!storage) return DEFAULT_PROXY_URL;
  try {
    return resolveProxyDraftUrl(storage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

export function writeStoredProxyUrl(
  url: string,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, url);
  } catch {
    // Browser storage is best-effort.
  }
}

/** 默认开启：当检测到代理端口不可达时，自动关闭代理切回直连，防止国内模型受累。 */
export function readStoredAutoFallback(
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(AUTO_FALLBACK_KEY);
    if (raw === null) return true;
    return raw === "true" || raw === "1";
  } catch {
    return true;
  }
}

export function writeStoredAutoFallback(
  value: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(AUTO_FALLBACK_KEY, value ? "true" : "false");
  } catch {
    // Browser storage is best-effort.
  }
}

/** 浏览器本地记录上次的代理开启状态，用于页面加载时避免小圆点闪灰。 */
export function readStoredProxyEnabled(
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PROXY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStoredProxyEnabled(
  enabled: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROXY_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Browser storage is best-effort.
  }
}
