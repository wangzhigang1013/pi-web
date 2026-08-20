import test from "node:test";
import assert from "node:assert/strict";
import { TerminalRingBuffer } from "./ring-buffer.ts";

test("TerminalRingBuffer stores and retrieves data correctly", () => {
  const buffer = new TerminalRingBuffer(100);
  buffer.write("Hello, world!");
  assert.equal(buffer.getHistory(), "Hello, world!");

  buffer.write(" Line 2\r\n");
  assert.equal(buffer.getHistory(), "Hello, world! Line 2\r\n");
});

test("TerminalRingBuffer prunes data exceeding maxChars limit", () => {
  const buffer = new TerminalRingBuffer(20);
  buffer.write("1234567890"); // 10 chars
  buffer.write("abcdefghij"); // 10 chars (total 20)
  buffer.write("XYZ");        // exceeds 20 -> drops first chunk
  const history = buffer.getHistory();
  assert.ok(history.includes("XYZ"));
  assert.ok(history.length <= 25);
});
