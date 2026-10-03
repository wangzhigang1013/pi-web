import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("PreviewAnnotations provides anchored popover composer and persistent highlight layer", () => {
  const source = fs.readFileSync(path.join(__dirname, "PreviewAnnotations.tsx"), "utf8");
  // 1. 紧贴选区就地 Composer
  assert.match(source, /openComposerForSelection/);
  assert.match(source, /preview-annotation-composer/);
  assert.match(source, /preview-annotation-marker/);

  // 2. 正文持久高亮注入
  assert.match(source, /data-annotation-highlight/);
  assert.match(source, /preview-annotation-block/);
  assert.match(source, /data-line-number/);
  assert.match(source, /data-src-start/);

  // 3. 右下角紧凑胶囊与上滑抽屉
  assert.match(source, /preview-annotation-capsule/);
  assert.match(source, /preview-annotation-drawer/);
  assert.match(source, /onRevealAnnotation/);
});
