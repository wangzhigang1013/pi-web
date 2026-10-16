import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as undici from "undici";
import type { ProxySource } from "./api-types";
import { readWebProxyConfig, writeWebProxyConfig } from "./proxy-settings";
import { readRegularFileText } from "./regular-file";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

/**
 * 本地地址永远直连：Pi Web 自己会用 127.0.0.1 访问 Next 服务、SSE 和本机工具服务，
 * 这些请求一旦被送进代理就会被代理软件当成外网流量，轻则绕远路重则直接失败。
 */
const LOCAL_NO_PROXY_ENTRIES = ["localhost", "127.0.0.1", "::1"];

/**
 * Pi Web 的开关只覆盖这三个变量，而不是取代它们。
 *
 * 进程启动时继承的这份值称为「系统代理基线」：用户在系统里配好的 Clash 端口
 * 就藏在里面，关闭开关时必须还原它，否则会把系统代理一起抹掉。
 */
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"] as const;
type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number];
type ProxyEnvBaseline = Partial<Record<ProxyEnvKey, string>>;

/** 代理开关的当前状态。 */
export interface HttpProxyState {
  /** 当前进程是否正在使用代理。 */
  enabled: boolean;
  /** 当前生效的代理地址，未启用时为 null。 */
  url: string | null;
  /** 代理是谁提供的：Pi Web 开关、进程继承的系统环境变量，或没有代理。 */
  source: ProxySource;
}

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
  __piWebHttpIdleTimeoutMs?: number;
  __piWebProxyPersistedApplied?: boolean;
  /** 进程启动时继承的系统代理基线，只捕获一次，避免被 Pi Web 自己的写入污染。 */
  __piWebSystemProxyBaseline?: ProxyEnvBaseline;
  /** Pi Web 当前覆盖的代理地址；null 表示没有覆盖、一切听系统的。 */
  __piWebProxyOverrideUrl?: string | null;
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

/**
 * The agent directory pi keeps its global `settings.json` in, resolved as pi's
 * `getAgentDir()` resolves it. It is resolved here instead of through the SDK
 * because this module runs in Next.js instrumentation: importing the SDK there
 * costs about a second of startup time, while `undici` costs a tenth of one.
 */
export function defaultAgentDir(): string {
  let configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");

  // pi's normalizePath(): Git Bash, MSYS, Cygwin and WSL drive paths on
  // Windows, then `~`, then file: URLs. The value is not trimmed.
  if (process.platform === "win32") configured = windowsShellPath(configured);
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"))) {
    return join(homedir(), configured.slice(2));
  }
  if (/^file:\/\//.test(configured)) return fileURLToPath(configured);
  return configured;
}

/** pi's normalizeWindowsShellPath(): `/c/x`, `/mnt/c/x`, `/cygdrive/c/x` to `C:\x`. */
function windowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

/**
 * The global `httpIdleTimeoutMs`, read the way the pi CLI reads it, so a Web UI
 * session gets the HTTP idle timeout the user configured instead of the
 * built-in default. Only the global file counts: the dispatcher is configured
 * once at startup, before any project is selected, so a project's
 * `.pi/settings.json` cannot apply here.
 *
 * A missing file, a file that does not parse, an absent key, or a value the CLI
 * would reject yields `undefined`, which leaves `configureHttpDispatcher`'s own
 * default in place.
 */
export function readHttpIdleTimeoutMs(agentDir: string = defaultAgentDir()): number | undefined {
  let text: string | undefined;
  try {
    text = readRegularFileText(join(agentDir, "settings.json"));
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;

  let settings: unknown;
  try {
    settings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
  if (typeof settings !== "object" || settings === null) return undefined;

  return parseHttpIdleTimeoutMs((settings as { httpIdleTimeoutMs?: unknown }).httpIdleTimeoutMs);
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
      // Reach an http:// origin through a CONNECT tunnel, as the pi SDK's own
      // dispatcher does. A forwarded request is carried by a client that keeps
      // undici's own 300 s bodyTimeout, so `httpIdleTimeoutMs` would not apply
      // and a provider stream that stalls cannot be cut at the configured time.
      proxyTunnel: true,
      bodyTimeout: timeoutMs,
      // Node's 250 ms default can terminate valid connection attempts on
      // high-latency routes; the pi CLI's dispatcher waits two seconds here.
      connect: { autoSelectFamilyAttemptTimeout: 2_000 },
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

/**
 * 捕获进程启动时继承的代理环境变量。
 *
 * 只在首次调用时读取并缓存到 globalThis：Pi Web 自己会改写这三个变量，
 * 稍后再读就拿不到用户真正配置的端口了。
 */
function systemProxyBaseline(): ProxyEnvBaseline {
  const cached = dispatcherGlobal.__piWebSystemProxyBaseline;
  if (cached !== undefined) return cached;

  const baseline: ProxyEnvBaseline = {};
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) baseline[key] = value.trim();
  }
  dispatcherGlobal.__piWebSystemProxyBaseline = baseline;
  return baseline;
}

// 模块加载时立刻固化基线：setHttpProxy() 会改写这三个变量，惰性到关闭开关时
// 才读，拿到的就是 Pi Web 自己写进去的覆盖值，反而会被当成“系统代理”恢复。
systemProxyBaseline();

/**
 * 把代理环境变量还原到系统基线。
 *
 * 基线里若还留着代理，`NO_PROXY` 必须继续带上本地地址：undici 的
 * `EnvHttpProxyAgent` 在 `no_proxy` 为空时会把**所有**请求送进代理，连 127.0.0.1
 * 上的本机服务与工具服务也会被当成外网流量（ADR 0006 第 3 条）。
 */
function restoreSystemProxyBaseline(): void {
  const baseline = systemProxyBaseline();
  const proxyFromBaseline = baseline.HTTP_PROXY !== undefined || baseline.HTTPS_PROXY !== undefined;

  for (const key of PROXY_ENV_KEYS) {
    if (key === "NO_PROXY") continue;
    const value = baseline[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  if (proxyFromBaseline) {
    process.env.NO_PROXY = mergeLocalNoProxy(baseline.NO_PROXY);
  } else if (baseline.NO_PROXY === undefined) {
    delete process.env.NO_PROXY;
  } else {
    process.env.NO_PROXY = baseline.NO_PROXY;
  }
}

export function getHttpProxyState(): HttpProxyState {
  const override = (dispatcherGlobal.__piWebProxyOverrideUrl ?? "").trim();
  if (override.length > 0) return { enabled: true, url: override, source: "web" };

  // 开关关闭时进程仍可能走在系统代理上，这里必须如实反映，否则 UI 会假装已直连。
  const inherited = (process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? "").trim();
  if (inherited.length > 0) return { enabled: true, url: inherited, source: "system" };
  return { enabled: false, url: null, source: "none" };
}

/**
 * 切换当前 Pi Web 进程使用的 HTTP 代理。
 *
 * 状态持久化到 ~/.pi/agent/web-proxy.json，保证 Pi Web 重启后恢复上次状态。
 * 不写入 Pi 命令行的 settings.json，命令行 pi 仍由用户自己控制。
 *
 * 传 null 或空字符串表示撤销 Pi Web 的覆盖：此时回退到进程启动时继承的系统代理
 * 环境变量，而不是把代理整个关掉。用户系统里本来就配着 Clash 时，`delete` 掉
 * 这三个变量会让 Antigravity 这类需要外网的 provider 静默报 `fetch failed`。
 *
 * @param proxy 代理地址；传 null 或空字符串表示撤销 Pi Web 的覆盖
 * @param persist 是否落盘到 web-proxy.json，默认为 true
 * @returns 切换后的状态
 */
export function setHttpProxy(proxy: string | null, persist = true): HttpProxyState {
  const trimmed = proxy?.trim() ?? "";

  if (trimmed.length === 0) {
    dispatcherGlobal.__piWebProxyOverrideUrl = null;
    restoreSystemProxyBaseline();
    if (persist) {
      const existing = readWebProxyConfig();
      writeWebProxyConfig({ enabled: false, url: existing?.url ?? null });
    }
  } else {
    dispatcherGlobal.__piWebProxyOverrideUrl = trimmed;
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
