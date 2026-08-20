import test from "node:test";
import assert from "node:assert/strict";
import { terminalManager } from "./pty-manager.ts";

test("TerminalManager creates and writes to PTY session", async () => {
  const session = terminalManager.getOrCreateSession("test-session", process.cwd(), 80, 24);
  assert.ok(session);
  assert.equal(session.id, "test-session");

  // Send simple echo
  await new Promise((resolve) => setTimeout(resolve, 500));
  terminalManager.write("test-session", "echo 123456\r");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const history = session.buffer.getHistory();
  assert.ok(history.length > 0);

  terminalManager.kill("test-session");
});
