import { EventEmitter } from "node:events";
import * as undici from "undici";
import { readWebProxyConfig, writeWebProxyConfig } from "./proxy-settings";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

/**
 * 本地地址永远直连：Pi Web 自己会用 127.0.0.1 访问 Next 服务、SSE 和本机工具服务，
 * 这些请求一旦被送进代理就会被代理软件当成外网流量，轻则绕远路重则直接失败。
 */
const LOCAL_NO_PROXY_ENTRIES = ["localhost", "127.0.0.1", "::1"];

/** 代理开关的当前状态。 */
export interface HttpProxyState {
  /** 当前进程是否正在使用代理。 */
  enabled: boolean;
  /** 当前生效的代理地址，未启用时为 null。 */
  url: string | null;
}

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
  __piWebHttpIdleTimeoutMs?: number;
  __piWebProxyPersistedApplied?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};
let installedGlobalFetch: typeof globalThis.fetch | undefined;

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

// `EnvHttpProxyAgent` reads the proxy environment variables **in its
// constructor**, so a proxy change only takes effect through a new instance.
function buildDispatcher(timeoutMs: number): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
}

function installDispatcher(dispatcher: undici.Dispatcher): void {
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  const shouldInstallGlobals = installedGlobalFetch === undefined
    ? globalThis.fetch === originalGlobalFetch
    : globalThis.fetch === installedGlobalFetch;
  if (shouldInstallGlobals) {
    undici.install?.();
    installedGlobalFetch = globalThis.fetch;
  }
}

function applyDispatcher(timeoutMs: unknown): void {
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  installDispatcher(buildDispatcher(normalizedTimeoutMs));
  dispatcherGlobal.__piWebHttpIdleTimeoutMs = normalizedTimeoutMs;
  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;
  applyDispatcher(timeoutMs);
}

/** 把本地地址并入已有的 NO_PROXY 列表，保留用户自己配置的条目。 */
export function mergeLocalNoProxy(value: string | undefined): string {
  const entries = (value ?? "").split(/[,\s]/).filter((entry) => entry.length > 0);
  const normalized = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const local of LOCAL_NO_PROXY_ENTRIES) {
    if (!normalized.has(local)) entries.push(local);
  }
  return entries.join(",");
}

export function getHttpProxyState(): HttpProxyState {
  const url = (process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? "").trim();
  return url.length > 0 ? { enabled: true, url } : { enabled: false, url: null };
}

/**
 * 切换当前 Pi Web 进程使用的 HTTP 代理。
 *
 * 状态持久化到 ~/.pi/agent/web-proxy.json，保证 Pi Web 重启后恢复上次状态。
 * 不写入 Pi 命令行的 settings.json，命令行 pi 仍由用户自己控制。
 *
 * @param proxy 代理地址；传 null 或空字符串表示关闭代理
 * @param persist 是否落盘到 web-proxy.json，默认为 true
 * @returns 切换后的状态
 */
export function setHttpProxy(proxy: string | null, persist = true): HttpProxyState {
  const trimmed = proxy?.trim() ?? "";

  if (trimmed.length === 0) {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
    if (persist) {
      const existing = readWebProxyConfig();
      writeWebProxyConfig({ enabled: false, url: existing?.url ?? null });
    }
  } else {
    process.env.HTTP_PROXY = trimmed;
    process.env.HTTPS_PROXY = trimmed;
    process.env.NO_PROXY = mergeLocalNoProxy(process.env.NO_PROXY);
    if (persist) {
      writeWebProxyConfig({ enabled: true, url: trimmed });
    }
  }

  // 已经启动过才重建；尚未配置时下一次 configureHttpDispatcher() 会自然读到新环境变量。
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) {
    applyDispatcher(dispatcherGlobal.__piWebHttpIdleTimeoutMs ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS);
  }

  return getHttpProxyState();
}

/**
 * 在 Pi Web 服务端启动时恢复上次记忆的代理状态（来自 ~/.pi/agent/web-proxy.json）。
 *
 * 由 instrumentation-node.ts 启动初始化，或首次访问 getHttpProxyState() 时兜底调用。
 */
export function applyPersistedProxySettings(): void {
  if (dispatcherGlobal.__piWebProxyPersistedApplied) return;
  dispatcherGlobal.__piWebProxyPersistedApplied = true;

  const config = readWebProxyConfig();
  if (!config) return;
  if (config.enabled && config.url) {
    setHttpProxy(config.url, false);
  } else {
    setHttpProxy(null, false);
  }
}
