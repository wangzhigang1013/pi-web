import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./annotations.ts");
}

function makeAnnotation(overrides = {}) {
  return {
    filePath: "/repo/docs/plan.md",
    relativePath: "docs/plan.md",
    quote: "选中的一句话",
    note: "压缩成两句",
    startLine: 12,
    endLine: 14,
    target: "selection",
    ...overrides,
  };
}

test("createAnnotation fills id, draft status and timestamp", async () => {
  const { createAnnotation } = await loadSubject();
  const annotation = createAnnotation(makeAnnotation());
  assert.equal(typeof annotation.id, "string");
  assert.ok(annotation.id.length > 0);
  assert.equal(annotation.status, "draft");
  assert.ok(annotation.createdAt > 0);
});

test("createAnnotation honours injected id, status and timestamp", async () => {
  const { createAnnotation } = await loadSubject();
  const annotation = createAnnotation(makeAnnotation({ id: "fixed", status: "sent", createdAt: 7 }));
  assert.equal(annotation.id, "fixed");
  assert.equal(annotation.status, "sent");
  assert.equal(annotation.createdAt, 7);
});

test("annotationStorageKey namespaces by session and file", async () => {
  const { annotationStorageKey, ANNOTATION_STORAGE_PREFIX } = await loadSubject();
  assert.equal(
    annotationStorageKey("/repo/docs/plan.md", "sess-1"),
    `${ANNOTATION_STORAGE_PREFIX}:sess-1:/repo/docs/plan.md`,
  );
  assert.equal(
    annotationStorageKey("/repo/docs/plan.md", null),
    `${ANNOTATION_STORAGE_PREFIX}:-:/repo/docs/plan.md`,
  );
});

test("parseStoredAnnotations survives corrupted payloads", async () => {
  const { parseStoredAnnotations } = await loadSubject();
  assert.deepEqual(parseStoredAnnotations(null), []);
  assert.deepEqual(parseStoredAnnotations(""), []);
  assert.deepEqual(parseStoredAnnotations("{not json"), []);
  assert.deepEqual(parseStoredAnnotations('{"a":1}'), []);
  assert.deepEqual(parseStoredAnnotations('[{"id":"x"}]'), []);
});

test("parseStoredAnnotations normalizes missing fields and round-trips", async () => {
  const { parseStoredAnnotations, serializeAnnotations, createAnnotation } = await loadSubject();
  const annotation = createAnnotation(makeAnnotation({ status: "sent" }));
  const restored = parseStoredAnnotations(serializeAnnotations([annotation]));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, annotation.id);
  assert.equal(restored[0].status, "sent");

  const legacy = parseStoredAnnotations(JSON.stringify([{
    id: "old",
    filePath: "/repo/a.md",
    quote: "q",
    note: "n",
  }]));
  assert.equal(legacy[0].relativePath, "/repo/a.md");
  assert.equal(legacy[0].status, "draft");
});

test("annotationsForPrompt drops empty notes", async () => {
  const { annotationsForPrompt, createAnnotation } = await loadSubject();
  const kept = createAnnotation(makeAnnotation());
  const dropped = createAnnotation(makeAnnotation({ note: "   " }));
  assert.deepEqual(annotationsForPrompt([kept, dropped]).map((item) => item.id), [kept.id]);
});

test("formatLineRange and summarizeAnnotation describe the anchor", async () => {
  const { formatLineRange, summarizeAnnotation, createAnnotation } = await loadSubject();
  assert.equal(formatLineRange({ startLine: 7, endLine: 7 }), "L7");
  assert.equal(formatLineRange({ startLine: 12, endLine: 14 }), "L12-L14");
  assert.equal(formatLineRange({ endLine: 4 }), "");

  const annotation = createAnnotation(makeAnnotation({ quote: "第一行\n第二行" }));
  assert.equal(summarizeAnnotation(annotation), "第一行 第二行");

  const long = createAnnotation(makeAnnotation({ quote: "x".repeat(80) }));
  assert.equal(summarizeAnnotation(long).length, 48);
});

test("buildAnnotationPrompt carries file, anchored quote and requirement", async () => {
  const { buildAnnotationPrompt, createAnnotation } = await loadSubject();
  const prompt = buildAnnotationPrompt([
    createAnnotation(makeAnnotation({ prefix: "前面", suffix: "后面" })),
    createAnnotation(makeAnnotation({
      id: "second",
      startLine: undefined,
      endLine: undefined,
      quote: "无行号的引用",
      note: "改措辞",
    })),
  ], { cwd: "/repo" });

  assert.match(prompt, /定点修改源文件/);
  assert.match(prompt, /工作目录：\/repo/);
  assert.match(prompt, /文件：docs\/plan\.md/);
  assert.match(prompt, /批注 1（L12-L14）/);
  assert.match(prompt, /批注 2（未取到行号，按引用文本定位）/);
  assert.match(prompt, /> 选中的一句话/);
  assert.match(prompt, /上下文：前面〈选中〉后面/);
  assert.match(prompt, /要求：压缩成两句/);
  assert.match(prompt, /要求：改措辞/);
  assert.match(prompt, /渲染后/);
});

test("buildAnnotationPrompt returns empty string when nothing to send", async () => {
  const { buildAnnotationPrompt, createAnnotation } = await loadSubject();
  assert.equal(buildAnnotationPrompt([]), "");
  assert.equal(buildAnnotationPrompt([createAnnotation(makeAnnotation({ note: " " }))]), "");
});
