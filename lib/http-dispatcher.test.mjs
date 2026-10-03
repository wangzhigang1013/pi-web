import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const tempDir = mkdtempSync(join(tmpdir(), "pi-proxy-dispatcher-test-"));
process.env.PI_WEB_PROXY_CONFIG_PATH = join(tempDir, "web-proxy.json");

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
];

test("configures HTTP_PROXY, HTTPS_PROXY, and NO_PROXY for global fetch", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];

  const connectTargets = [];
  const forwardedRequests = [];
  const proxy = createServer((req, res) => {
    forwardedRequests.push(`${req.method} ${req.url}`);
    res.writeHead(204, { Connection: "close" });
    res.end();
  });
  proxy.on("connect", (req, socket) => {
    connectTargets.push(req.url);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");

  t.after(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
    });
  });

  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.NO_PROXY = "bypass.invalid";

  const jiti = createJiti(import.meta.url);
  const { configureHttpDispatcher } = await jiti.import("./http-dispatcher.ts");
  const { getGlobalDispatcher } = await import("undici");

  assert.throws(() => configureHttpDispatcher(-1), /Invalid HTTP idle timeout/);
  configureHttpDispatcher(2_000);

  const dispatcher = getGlobalDispatcher();
  configureHttpDispatcher(5_000);
  assert.equal(getGlobalDispatcher(), dispatcher, "configuration should be idempotent");

  const httpResponse = await fetch("http://target.invalid/through-http-proxy", {
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(httpResponse.status, 204);
  assert.deepEqual(forwardedRequests, ["GET http://target.invalid/through-http-proxy"]);
  assert.deepEqual(connectTargets, []);

  await assert.rejects(fetch("https://target.invalid/through-https-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.deepEqual(connectTargets, ["target.invalid:443"]);

  const forwardedRequestCount = forwardedRequests.length;
  const connectTargetCount = connectTargets.length;
  await assert.rejects(fetch("http://bypass.invalid:9/no-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.equal(forwardedRequests.length, forwardedRequestCount);
  assert.equal(connectTargets.length, connectTargetCount);
});

test("mergeLocalNoProxy keeps user entries and appends the local ones once", async () => {
  const jiti = createJiti(import.meta.url);
  const { mergeLocalNoProxy } = await jiti.import("./http-dispatcher.ts");

  assert.equal(mergeLocalNoProxy(undefined), "localhost,127.0.0.1,::1");
  assert.equal(mergeLocalNoProxy("example.com"), "example.com,localhost,127.0.0.1,::1");
  assert.equal(mergeLocalNoProxy("127.0.0.1, LocalHost"), "127.0.0.1,LocalHost,::1");
});

test("setHttpProxy toggles the proxy environment for the current process", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const jiti = createJiti(import.meta.url);
  const { getHttpProxyState, setHttpProxy } = await jiti.import("./http-dispatcher.ts");

  assert.deepEqual(getHttpProxyState(), { enabled: false, url: null });

  assert.deepEqual(setHttpProxy("http://127.0.0.1:7897"), {
    enabled: true,
    url: "http://127.0.0.1:7897",
  });
  assert.equal(process.env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(process.env.HTTPS_PROXY, "http://127.0.0.1:7897");
  // Pi Web 自己会用 127.0.0.1 访问本机服务，必须排除在代理之外。
  assert.match(process.env.NO_PROXY, /127\.0\.0\.1/);

  assert.deepEqual(setHttpProxy(null), { enabled: false, url: null });
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.HTTPS_PROXY, undefined);
  assert.equal(process.env.NO_PROXY, undefined);
});

test("setHttpProxy rebuilds the global dispatcher so a change takes effect at once", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const jiti = createJiti(import.meta.url);
  const { configureHttpDispatcher, setHttpProxy } = await jiti.import("./http-dispatcher.ts");
  const { getGlobalDispatcher } = await import("undici");

  // EnvHttpProxyAgent 只在构造时读取代理环境变量，因此不换 dispatcher 等于没改。
  configureHttpDispatcher();
  const disabledDispatcher = getGlobalDispatcher();
  setHttpProxy("http://127.0.0.1:7897");
  const enabledDispatcher = getGlobalDispatcher();
  assert.notEqual(enabledDispatcher, disabledDispatcher);

  setHttpProxy(null);
  assert.notEqual(getGlobalDispatcher(), enabledDispatcher);
});
