import { existsSync, mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** 探测代理端口时使用的默认超时，保持 UI 反馈足够快。 */
export const PROXY_PROBE_TIMEOUT_MS = 1500;

export interface WebProxyConfig {
  enabled: boolean;
  url: string | null;
}

export function getWebProxyConfigPath(agentDir = getAgentDir()): string {
  if (process.env.PI_WEB_PROXY_CONFIG_PATH) {
    return process.env.PI_WEB_PROXY_CONFIG_PATH;
  }
  return join(agentDir, "web-proxy.json");
}

export function readWebProxyConfig(configPath = getWebProxyConfigPath()): WebProxyConfig | null {
  try {
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.enabled !== "boolean") return null;
    const url = typeof record.url === "string" && record.url.trim().length > 0
      ? record.url.trim()
      : null;
    return { enabled: record.enabled, url };
  } catch {
    return null;
  }
}

export function writeWebProxyConfig(
  config: WebProxyConfig,
  configPath = getWebProxyConfigPath(),
): void {
  try {
    const dir = dirname(configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writePrivateFileAtomicSync(configPath, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // 写入失败不阻断运行时
  }
}

const DEFAULT_PROXY_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

export type ProxyInputResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * 把用户输入的代理地址规范成 `http://host:port`。
 *
 * 允许省略协议（`127.0.0.1:7897`）和端口（按协议取默认值），但拒绝
 * SOCKS/PAC 等 Pi 与 undici 都不支持的协议。
 */
export function normalizeProxyInput(value: unknown): ProxyInputResult {
  if (typeof value !== "string") return { ok: false, error: "代理地址必须是字符串" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: "代理地址不能为空" };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "代理地址格式无效" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "仅支持 http:// 或 https:// 代理" };
  }
  if (parsed.hostname.length === 0) return { ok: false, error: "代理地址缺少主机名" };
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, error: "代理地址不应包含路径" };
  }

  const port = parsed.port.length > 0
    ? Number.parseInt(parsed.port, 10)
    : DEFAULT_PROXY_PORTS[parsed.protocol] ?? 0;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, error: "代理端口无效" };
  }

  // URL 的 hostname 对 IPv6 会带上方括号，需要先去掉再按需补回，否则会拼成 [[::1]]。
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return { ok: true, url: `${parsed.protocol}//${host.includes(":") ? `[${host}]` : host}:${port}` };
}

/** 取出代理地址的 host 与 port，用于端口可达性探测。 */
export function parseProxyEndpoint(url: string): { host: string; port: number } | null {
  const normalized = normalizeProxyInput(url);
  if (!normalized.ok) return null;
  const parsed = new URL(normalized.url);
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: Number.parseInt(parsed.port, 10),
  };
}

/**
 * 探测代理端口是否能建立 TCP 连接。
 *
 * 只判断"代理软件在不在"，不校验代理的转发能力：这样代理由 Clash、v2rayN
 * 还是其他实现提供都无所谓。
 */
export function probeProxyEndpoint(
  host: string,
  port: number,
  timeoutMs: number = PROXY_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      socket.destroy();
      resolve(reachable);
    };
    const onConnect = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
