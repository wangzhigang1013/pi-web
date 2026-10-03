import { NextResponse } from "next/server";
import type { ProxySettingsResponse } from "@/lib/api-types";
import { applyPersistedProxySettings, getHttpProxyState, setHttpProxy } from "@/lib/http-dispatcher";
import { normalizeProxyInput, parseProxyEndpoint, probeProxyEndpoint } from "@/lib/proxy-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * 代理开关只作用于当前 Pi Web 进程：不读写 `~/.pi/agent/settings.json`，
 * 命令行 `pi` 的 httpProxy 不受影响。详见 docs/adr/0006-http-proxy-toggle.md。
 */
async function describeState(): Promise<ProxySettingsResponse> {
  applyPersistedProxySettings();
  const { enabled, url } = getHttpProxyState();
  const endpoint = url === null ? null : parseProxyEndpoint(url);
  const reachable = endpoint === null
    ? false
    : await probeProxyEndpoint(endpoint.host, endpoint.port);

  return {
    enabled,
    url,
    reachable,
    host: endpoint?.host ?? null,
    port: endpoint?.port ?? null,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await describeState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown; url?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    if (!body.enabled) {
      setHttpProxy(null);
      return NextResponse.json(await describeState());
    }

    // 开启时代理地址必填：默认为空会让 Pi 悄悄退回直连，反而更难排查。
    const normalized = normalizeProxyInput(body.url);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    setHttpProxy(normalized.url);
    return NextResponse.json(await describeState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
