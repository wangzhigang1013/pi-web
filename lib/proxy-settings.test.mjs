import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  normalizeProxyInput,
  parseProxyEndpoint,
  probeProxyEndpoint,
  readWebProxyConfig,
  writeWebProxyConfig,
} = await jiti.import("./proxy-settings.ts");

test("normalizeProxyInput accepts a bare host:port and canonicalizes it", () => {
  assert.deepEqual(normalizeProxyInput("127.0.0.1:7897"), { ok: true, url: "http://127.0.0.1:7897" });
  assert.deepEqual(normalizeProxyInput("  localhost:7890  "), { ok: true, url: "http://localhost:7890" });
  assert.deepEqual(normalizeProxyInput("https://proxy.local:8443"), { ok: true, url: "https://proxy.local:8443" });
});

test("normalizeProxyInput fills in the default port for the protocol", () => {
  assert.deepEqual(normalizeProxyInput("http://127.0.0.1"), { ok: true, url: "http://127.0.0.1:80" });
  assert.deepEqual(normalizeProxyInput("https://127.0.0.1"), { ok: true, url: "https://127.0.0.1:443" });
});

test("normalizeProxyInput keeps IPv6 hosts bracketed", () => {
  assert.deepEqual(normalizeProxyInput("[::1]:7897"), { ok: true, url: "http://[::1]:7897" });
});

test("normalizeProxyInput rejects empty, malformed, SOCKS and pathed addresses", () => {
  for (const value of ["", "   ", "socks5://127.0.0.1:1080", "ftp://127.0.0.1:21"]) {
    assert.equal(normalizeProxyInput(value).ok, false, `${value} must be rejected`);
  }
  assert.equal(normalizeProxyInput("http://127.0.0.1:7897/pac").ok, false);
  assert.equal(normalizeProxyInput(undefined).ok, false);
  assert.equal(normalizeProxyInput("http://:7897").ok, false);
});

test("parseProxyEndpoint returns host and port for probing", () => {
  assert.deepEqual(parseProxyEndpoint("http://127.0.0.1:7897"), { host: "127.0.0.1", port: 7897 });
  assert.deepEqual(parseProxyEndpoint("127.0.0.1:7890"), { host: "127.0.0.1", port: 7890 });
  assert.equal(parseProxyEndpoint("socks5://127.0.0.1:1080"), null);
});

test("probeProxyEndpoint reports a listening port as reachable and a closed one as not", async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  assert.equal(await probeProxyEndpoint("127.0.0.1", address.port), true);

  // 关闭后再探测同一端口，模拟"代理软件已退出"。
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await probeProxyEndpoint("127.0.0.1", address.port, 1000), false);
});

test("web-proxy.json config persistence round-trips correctly", (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-proxy-test-"));
  const configPath = join(tempDir, "web-proxy.json");
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  assert.equal(readWebProxyConfig(configPath), null);

  writeWebProxyConfig({ enabled: true, url: "http://127.0.0.1:7897" }, configPath);
  assert.deepEqual(readWebProxyConfig(configPath), { enabled: true, url: "http://127.0.0.1:7897" });

  writeWebProxyConfig({ enabled: false, url: "http://127.0.0.1:7897" }, configPath);
  assert.deepEqual(readWebProxyConfig(configPath), { enabled: false, url: "http://127.0.0.1:7897" });

  writeFileSync(configPath, "not valid json {", "utf8");
  assert.equal(readWebProxyConfig(configPath), null);
});
