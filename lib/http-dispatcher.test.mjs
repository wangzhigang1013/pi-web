import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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
  // 这个用例要先注入代理再加载模块，基线会被固化成随机端口，收尾必须重置。
  globalThis.__piWebSystemProxyBaseline = {};
  delete globalThis.__piWebProxyOverrideUrl;

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
    globalThis.__piWebSystemProxyBaseline = {};
    delete globalThis.__piWebProxyOverrideUrl;
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

  // An http:// origin is tunneled too, exactly as the pi CLI's own dispatcher
  // does it. Forwarding it left the response body on a client that kept
  // undici's own bodyTimeout, so `httpIdleTimeoutMs` never applied.
  await assert.rejects(fetch("http://target.invalid/through-http-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.deepEqual(connectTargets, ["target.invalid:80"]);
  assert.deepEqual(forwardedRequests, [], "an http origin is tunneled, not forwarded");

  await assert.rejects(fetch("https://target.invalid/through-https-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.deepEqual(connectTargets, ["target.invalid:80", "target.invalid:443"]);

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
  globalThis.__piWebSystemProxyBaseline = {};
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__piWebProxyOverrideUrl;
  });

  const jiti = createJiti(import.meta.url);
  const { getHttpProxyState, setHttpProxy } = await jiti.import("./http-dispatcher.ts");

  assert.deepEqual(getHttpProxyState(), { enabled: false, url: null, source: "none" });

  assert.deepEqual(setHttpProxy("http://127.0.0.1:7897"), {
    enabled: true,
    url: "http://127.0.0.1:7897",
    source: "web",
  });
  assert.equal(process.env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(process.env.HTTPS_PROXY, "http://127.0.0.1:7897");
  // Pi Web 自己会用 127.0.0.1 访问本机服务，必须排除在代理之外。
  assert.match(process.env.NO_PROXY, /127\.0\.0\.1/);

  // 这个用例把代理环境变量清空了，基线也随之是空的，所以关闭后仍是直连。
  assert.deepEqual(setHttpProxy(null), { enabled: false, url: null, source: "none" });
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.HTTPS_PROXY, undefined);
  assert.equal(process.env.NO_PROXY, undefined);
});

test("closing the switch restores the inherited system proxy instead of wiping it", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__piWebProxyOverrideUrl;
    // 留一个空基线，免得后续用例意外继承这份被预置的代理。
    globalThis.__piWebSystemProxyBaseline = {};
  });

  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  delete globalThis.__piWebProxyOverrideUrl;
  // 模拟「用户在系统里配了 Clash 7890」：基线在 http-dispatcher 加载时就已经固化，
  // 这里直接预置，等价于进程启动时继承了这两个变量。
  globalThis.__piWebSystemProxyBaseline = {
    HTTPS_PROXY: "http://127.0.0.1:7890",
    NO_PROXY: "example.com",
  };
  process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
  process.env.NO_PROXY = "example.com";

  const jiti = createJiti(import.meta.url);
  const { getHttpProxyState, setHttpProxy } = await jiti.import("./http-dispatcher.ts");

  assert.deepEqual(getHttpProxyState(), {
    enabled: true,
    url: "http://127.0.0.1:7890",
    source: "system",
  });

  assert.equal(setHttpProxy("http://127.0.0.1:7897").source, "web");
  assert.equal(process.env.HTTPS_PROXY, "http://127.0.0.1:7897");

  // 关闭只撤销 Pi Web 的覆盖，系统里配好的代理必须原样回来。
  assert.deepEqual(setHttpProxy(null), {
    enabled: true,
    url: "http://127.0.0.1:7890",
    source: "system",
  });
  assert.equal(process.env.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.NO_PROXY, "example.com,localhost,127.0.0.1,::1");
});

test("a baseline without NO_PROXY still keeps loopback out of the proxy", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.__piWebSystemProxyBaseline = {};
    delete globalThis.__piWebProxyOverrideUrl;
  });

  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  // 事故现场就是这个形状：系统里只有 HTTPS_PROXY，没有 NO_PROXY。
  globalThis.__piWebSystemProxyBaseline = { HTTPS_PROXY: "http://127.0.0.1:7890" };
  delete globalThis.__piWebProxyOverrideUrl;
  process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
  delete process.env.NO_PROXY;

  const jiti = createJiti(import.meta.url);
  const { setHttpProxy } = await jiti.import("./http-dispatcher.ts");

  setHttpProxy("http://127.0.0.1:7897");
  assert.match(process.env.NO_PROXY, /127\.0\.0\.1/);

  setHttpProxy(null);
  // no_proxy 为空时 undici 会把所有请求（含 127.0.0.1）都送进代理，本地项必须补上。
  assert.equal(process.env.NO_PROXY, "localhost,127.0.0.1,::1");
  assert.equal(process.env.HTTPS_PROXY, "http://127.0.0.1:7890");
});

test("a baseline without any proxy still clears the variables as before", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.__piWebSystemProxyBaseline = {};
    delete globalThis.__piWebProxyOverrideUrl;
  });

  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  globalThis.__piWebSystemProxyBaseline = {};
  delete globalThis.__piWebProxyOverrideUrl;
  process.env.NO_PROXY = "example.com";

  const jiti = createJiti(import.meta.url);
  const { setHttpProxy } = await jiti.import("./http-dispatcher.ts");

  setHttpProxy(null);
  assert.equal(process.env.HTTPS_PROXY, undefined);
  assert.equal(process.env.NO_PROXY, undefined, "没有代理时不该留着一个孤零零的 NO_PROXY");
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

test("reads httpIdleTimeoutMs from the agent settings file", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-http-idle-"));
  const settingsPath = join(agentDir, "settings.json");
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const jiti = createJiti(import.meta.url);
  const { readHttpIdleTimeoutMs } = await jiti.import("./http-dispatcher.ts");

  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "no settings file keeps the default");

  writeFileSync(settingsPath, "{ not json");
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "unparsable settings keep the default");

  writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a settings file without the key keeps the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: -1 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a value the CLI rejects keeps the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: null }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "a null value keeps the default");

  writeFileSync(settingsPath, JSON.stringify(["httpIdleTimeoutMs"]));
  assert.equal(readHttpIdleTimeoutMs(agentDir), undefined, "settings that are not an object keep the default");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: 1_200_000 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 1_200_000, "the configured timeout is used");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: 0 }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 0, "0 disables the timeout");

  writeFileSync(settingsPath, JSON.stringify({ httpIdleTimeoutMs: "disabled" }));
  assert.equal(readHttpIdleTimeoutMs(agentDir), 0, "the CLI's disabled spelling disables the timeout");

  writeFileSync(settingsPath, `\ufeff${JSON.stringify({ httpIdleTimeoutMs: 900_000 })}`);
  assert.equal(readHttpIdleTimeoutMs(agentDir), 900_000, "a byte-order mark is allowed");

  // Without an argument the agent directory comes from pi's own override.
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  assert.equal(readHttpIdleTimeoutMs(), 900_000, "PI_CODING_AGENT_DIR picks the directory");
});

test("resolves PI_CODING_AGENT_DIR as pi's getAgentDir() does", async (t) => {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const jiti = createJiti(import.meta.url);
  const { defaultAgentDir } = await jiti.import("./http-dispatcher.ts");

  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });

  for (const value of [undefined, "", "~", "~/agent", "~\\agent", "/abs/agent", "rel/agent", " /padded ", "file:///tmp/agent", "/c/Users/agent", "/mnt/d/agent"]) {
    if (value === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = value;
    let customDir, piDir, customErr, piErr;
    try { customDir = defaultAgentDir(); } catch (e) { customErr = e.code || e.message; }
    try { piDir = getAgentDir(); } catch (e) { piErr = e.code || e.message; }
    if (customErr || piErr) {
      assert.equal(customErr, piErr, `PI_CODING_AGENT_DIR=${JSON.stringify(value)}`);
    } else {
      assert.equal(customDir, piDir, `PI_CODING_AGENT_DIR=${JSON.stringify(value)}`);
    }
  }
});

test("captures the system proxy baseline when the module is first loaded", async (t) => {
  // 基线必须在模块加载时固化：惰性到关闭开关时才读，拿到的会是被 Pi Web 自己
  // 写进去的覆盖值。放进子进程跑，避开前面用例预置的 globalThis 干扰这条契约。
  const dir = mkdtempSync(join(tmpdir(), "pi-proxy-baseline-load-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const repoRoot = join(import.meta.dirname, "..");
  const scriptPath = join(dir, "probe.mjs");
  writeFileSync(scriptPath, `
    const { createJiti } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, "node_modules", "jiti", "lib", "jiti.mjs")).href)});
    const jiti = createJiti(import.meta.url);
    const { getHttpProxyState, setHttpProxy } = await jiti.import(${JSON.stringify(pathToFileURL(join(repoRoot, "lib", "http-dispatcher.ts")).href)});
    setHttpProxy("http://127.0.0.1:7897");
    setHttpProxy(null);
    console.log(JSON.stringify({ state: getHttpProxyState(), https: process.env.HTTPS_PROXY ?? null }));
  `);

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "",
      NO_PROXY: "",
      PI_WEB_PROXY_CONFIG_PATH: join(dir, "web-proxy.json"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
  assert.deepEqual(payload.state, {
    enabled: true,
    url: "http://127.0.0.1:7890",
    source: "system",
  });
  assert.equal(payload.https, "http://127.0.0.1:7890", "关闭开关后系统代理必须原样在岗");
});
