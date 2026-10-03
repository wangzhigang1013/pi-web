import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  DEFAULT_PROXY_URL,
  readStoredAutoFallback,
  readStoredProxyUrl,
  resolveProxyDraftUrl,
  writeStoredAutoFallback,
  writeStoredProxyUrl,
} = await jiti.import("./proxy-preference.ts");

function memoryStorage(initial) {
  const values = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("resolveProxyDraftUrl falls back to the default for missing or unusable values", () => {
  assert.equal(resolveProxyDraftUrl(null), DEFAULT_PROXY_URL);
  assert.equal(resolveProxyDraftUrl(""), DEFAULT_PROXY_URL);
  assert.equal(resolveProxyDraftUrl("   "), DEFAULT_PROXY_URL);
  assert.equal(resolveProxyDraftUrl("socks5://127.0.0.1:1080"), DEFAULT_PROXY_URL);
  assert.equal(resolveProxyDraftUrl("http://"), DEFAULT_PROXY_URL);
});

test("resolveProxyDraftUrl keeps a usable stored address verbatim", () => {
  assert.equal(resolveProxyDraftUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.equal(resolveProxyDraftUrl(" 127.0.0.1:7890 "), "127.0.0.1:7890");
});

test("stored proxy url round-trips through browser storage", () => {
  const storage = memoryStorage();
  assert.equal(readStoredProxyUrl(storage), DEFAULT_PROXY_URL);

  writeStoredProxyUrl("127.0.0.1:7890", storage);
  assert.equal(readStoredProxyUrl(storage), "127.0.0.1:7890");

  writeStoredProxyUrl("socks5://127.0.0.1:1080", storage);
  assert.equal(readStoredProxyUrl(storage), DEFAULT_PROXY_URL);
});

test("storage failures never break the toggle", () => {
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.equal(readStoredProxyUrl(broken), DEFAULT_PROXY_URL);
  assert.doesNotThrow(() => writeStoredProxyUrl("127.0.0.1:7890", broken));
});

test("stored auto fallback preference defaults to true and round-trips", () => {
  const storage = memoryStorage();
  assert.equal(readStoredAutoFallback(storage), true);

  writeStoredAutoFallback(false, storage);
  assert.equal(readStoredAutoFallback(storage), false);

  writeStoredAutoFallback(true, storage);
  assert.equal(readStoredAutoFallback(storage), true);

  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.equal(readStoredAutoFallback(broken), true);
  assert.doesNotThrow(() => writeStoredAutoFallback(false, broken));
});
