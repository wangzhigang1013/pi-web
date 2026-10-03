import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const jitiSource = async (url) => (await readFile(url, "utf8")).replace(/\r\n/g, "\n");
const hookSource = await jitiSource(new URL("./useProxySettings.ts", import.meta.url));
const toggleSource = await jitiSource(new URL("../components/ProxyToggle.tsx", import.meta.url));

test("useProxySettings subscribes to visibilitychange to sleep in background and probe on focus", () => {
  assert.match(hookSource, /document\.addEventListener\(\s*["']visibilitychange["']/);
  assert.match(hookSource, /document\.removeEventListener\(\s*["']visibilitychange["']/);
  assert.match(hookSource, /document\.visibilityState === ["']visible["']/);
});

test("useProxySettings synchronizes state across components and tabs", () => {
  assert.match(hookSource, /stateListeners\s*=\s*new Set/);
  assert.match(hookSource, /BroadcastChannel/);
  assert.match(hookSource, /pi-web:proxy-sync/);
});

test("useProxySettings performs auto-fallback when proxy becomes unreachable", () => {
  assert.match(hookSource, /readStoredAutoFallback/);
  assert.match(hookSource, /autoFallbackRef\.current/);
  assert.match(hookSource, /!data\.reachable/);
  assert.match(hookSource, /body:\s*JSON\.stringify\({\s*enabled:\s*false\s*}\)/);
  assert.match(hookSource, /setAutoFallbackTriggered\(true\)/);
});

test("ProxyToggle presents auto-fallback switch and notice", () => {
  assert.match(toggleSource, /t\(\s*["']settings\.proxyAutoFallback["']\s*\)/);
  assert.match(toggleSource, /t\(\s*["']settings\.proxyAutoFallbackDescription["']\s*\)/);
  assert.match(toggleSource, /t\(\s*["']settings\.proxyAutoFallbackNotice["']\s*\)/);
  assert.match(toggleSource, /autoFallbackTriggered/);
});
