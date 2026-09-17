import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./route.ts");

test("chehejia models route module exports GET and POST", () => {
  assert.equal(typeof GET, "function");
  assert.equal(typeof POST, "function");
});

test("GET returns chehejia models payload with quota and pricing", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(typeof json.ok, "boolean");
  assert.equal(typeof json.gatewayUrl, "string");
  assert.equal(Array.isArray(json.remoteModels), true);
  assert.equal(Array.isArray(json.enabledModelIds), true);
  if (json.quota) {
    assert.equal(typeof json.quota.totalBudget, "number");
    assert.equal(typeof json.quota.actualCost, "number");
    assert.equal(typeof json.quota.remainingBudget, "number");
    assert.equal(typeof json.quota.usagePercentage, "number");
  }
  const hasPrice = json.remoteModels.some((m) => Boolean(m.priceTag));
  assert.equal(hasPrice, true);
});
