import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const tempDir = mkdtempSync(join(tmpdir(), "pi-proxy-route-test-"));
process.env.PI_WEB_PROXY_CONFIG_PATH = join(tempDir, "web-proxy.json");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./route.ts");
const { setHttpProxy } = await jiti.import("../../../../lib/http-dispatcher.ts");

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];

function snapshotProxyEnv() {
  return Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreProxyEnv(snapshot) {
  for (const key of PROXY_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function post(body) {
  return POST(new Request("http://localhost/api/proxy", {
    method: "POST",
    // 直接的 Request 不会像真实请求那样自带 Host，而路由的防跨站检查依赖它。
    headers: { host: "localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("/api/proxy reports and toggles the current process proxy", async (t) => {
  const snapshot = snapshotProxyEnv();
  t.after(() => restoreProxyEnv(snapshot));
  t.after(() => setHttpProxy(null));

  setHttpProxy(null);
  const initial = await (await GET()).json();
  assert.equal(initial.enabled, false);
  assert.equal(initial.url, null);
  assert.equal(initial.reachable, false);

  // 端口 1 上不会有人监听，正好用来验证"代理软件没开"时的探测结果。
  const enabled = await post({ enabled: true, url: "127.0.0.1:1" });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.enabled, true);
  assert.equal(enabledBody.url, "http://127.0.0.1:1");
  assert.equal(enabledBody.host, "127.0.0.1");
  assert.equal(enabledBody.port, 1);
  assert.equal(enabledBody.reachable, false);

  const disabled = await post({ enabled: false });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.enabled, false);
  assert.equal(disabledBody.url, null);
});

test("/api/proxy rejects an invalid body or proxy address", async (t) => {
  const snapshot = snapshotProxyEnv();
  t.after(() => restoreProxyEnv(snapshot));

  assert.equal((await post({ url: "127.0.0.1:7897" })).status, 400);
  assert.equal((await post({ enabled: true })).status, 400);
  assert.equal((await post({ enabled: true, url: "socks5://127.0.0.1:1080" })).status, 400);
  assert.equal((await post({ enabled: true, url: 42 })).status, 400);
});

test("/api/proxy requires a JSON content type", async () => {
  const response = await POST(new Request("http://localhost/api/proxy", {
    method: "POST",
    headers: { host: "localhost" },
    body: JSON.stringify({ enabled: false }),
  }));
  assert.equal(response.status, 415);
});
