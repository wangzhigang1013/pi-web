import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("RightPanelExplorer component embeds file explorer with desktop reveal actions", () => {
  const explorerSource = fs.readFileSync(path.join(__dirname, "RightPanelExplorer.tsx"), "utf8");
  assert.match(explorerSource, /export function RightPanelExplorer/);
  assert.match(explorerSource, /\/api\/files\/reveal/);
  assert.match(explorerSource, /subpanel/);
  assert.match(explorerSource, /onCloseSubpanel/);
  assert.match(explorerSource, /FileExplorer/);
});

test("AppShell mounts RightPanelExplorer in right file panel", () => {
  const shellSource = fs.readFileSync(path.join(__dirname, "AppShell.tsx"), "utf8");
  assert.match(shellSource, /import \{ RightPanelExplorer \} from "\.\/RightPanelExplorer"/);
  assert.match(shellSource, /rightPanelExplorerOpen/);
  assert.match(shellSource, /handleToggleRightPanelExplorer/);
  assert.match(shellSource, /files\.showExplorer/);
  assert.match(shellSource, /files\.hideExplorer/);
  // Closing the last tab does not force close the right panel
  assert.doesNotMatch(shellSource, /if \(next\.length === 0\) setRightPanelOpen\(false\);/);
});
