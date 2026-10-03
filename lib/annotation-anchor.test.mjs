import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./annotation-anchor.ts");
}

const SOURCE = [
  "# 标题",
  "",
  "第一段内容，包含需要压缩的句子。",
  "第二段内容。",
  "",
  "## 小节",
  "重复的句子",
  "重复的句子",
].join("\n");

test("lineRangeFromOffsets maps offsets to 1-based lines", async () => {
  const { lineRangeFromOffsets } = await loadSubject();
  assert.deepEqual(lineRangeFromOffsets("abc", 0, 3), { startLine: 1, endLine: 1 });
  const twoLines = "abc\ndef";
  assert.deepEqual(lineRangeFromOffsets(twoLines, 2, 5), { startLine: 1, endLine: 2 });
  assert.deepEqual(lineRangeFromOffsets(twoLines, 4, 7), { startLine: 2, endLine: 2 });
  // 越界偏移被夹住，不抛异常
  assert.deepEqual(lineRangeFromOffsets("abc", -5, 99), { startLine: 1, endLine: 1 });
});

test("offsetAtLine returns the first character offset of a line", async () => {
  const { offsetAtLine } = await loadSubject();
  assert.equal(offsetAtLine(SOURCE, 1), 0);
  assert.equal(offsetAtLine(SOURCE, 3), SOURCE.indexOf("第一段"));
  assert.equal(offsetAtLine(SOURCE, 99), SOURCE.length);
});

test("contextForQuote extracts quote with surroundings", async () => {
  const { contextForQuote } = await loadSubject();
  const match = contextForQuote(SOURCE, "需要压缩的句子");
  assert.ok(match);
  assert.equal(match.quote, "需要压缩的句子");
  assert.ok(match.prefix.endsWith("包含"));
  assert.ok(match.suffix.startsWith("。"));
});

test("contextForQuote falls back to whitespace-tolerant matching", async () => {
  const { contextForQuote } = await loadSubject();
  // 方向一：源里有换行（空行），渲染文本折叠成单个空格
  const collapsed = contextForQuote(SOURCE, "第二段内容。 ## 小节");
  assert.ok(collapsed, "collapsed whitespace should still match");
  assert.equal(collapsed.quote, "第二段内容。\n\n## 小节");

  // 方向二：引文里带换行、源里没有空白（渲染插入换行的情况）
  const expanded = contextForQuote(SOURCE, "第一段内容，\n包含需要压缩的句子");
  assert.ok(expanded, "extra whitespace in the quote should still match");
  assert.equal(expanded.quote, "第一段内容，包含需要压缩的句子");
});

test("contextForQuote prefers the match nearest the hint offset", async () => {
  const { contextForQuote } = await loadSubject();
  const secondIndex = SOURCE.lastIndexOf("重复的句子");
  const match = contextForQuote(SOURCE, "重复的句子", { hintOffset: secondIndex });
  assert.ok(match);
  assert.equal(match.index, secondIndex);
});

test("contextForQuote returns null when the quote is gone", async () => {
  const { contextForQuote } = await loadSubject();
  assert.equal(contextForQuote(SOURCE, "不存在的文本"), null);
  assert.equal(contextForQuote(SOURCE, "   "), null);
});

test("relocateQuote resolves a unique quote to a line range", async () => {
  const { relocateQuote } = await loadSubject();
  const range = relocateQuote(SOURCE, { quote: "第二段内容", prefix: "", suffix: "" });
  assert.deepEqual(range, { startLine: 4, endLine: 4 });
});

test("relocateQuote disambiguates duplicates with context", async () => {
  const { relocateQuote } = await loadSubject();
  const range = relocateQuote(SOURCE, {
    quote: "重复的句子",
    prefix: "## 小节\n",
    suffix: "",
  });
  assert.deepEqual(range, { startLine: 7, endLine: 7 });

  const fallback = relocateQuote(SOURCE, { quote: "重复的句子", prefix: "", suffix: "" });
  assert.deepEqual(fallback, { startLine: 7, endLine: 7 }, "no context prefers the first match");
});

test("relocateQuote returns null for removed text", async () => {
  const { relocateQuote } = await loadSubject();
  assert.equal(relocateQuote(SOURCE, { quote: "已删除的段落", prefix: "", suffix: "" }), null);
  assert.equal(relocateQuote(SOURCE, { quote: "  ", prefix: "", suffix: "" }), null);
});

test("enrichWithSourceContext fills prefix and suffix from the source text", async () => {
  const { enrichWithSourceContext } = await loadSubject();
  const enriched = enrichWithSourceContext(SOURCE, {
    quote: "需要压缩的句子",
    prefix: "",
    suffix: "",
    startLine: 3,
    endLine: 3,
  });
  assert.ok(enriched.prefix.endsWith("包含"));
  assert.ok(enriched.suffix.startsWith("。"));
  assert.equal(enriched.startLine, 3);
  assert.equal(enriched.endLine, 3);
});

test("enrichWithSourceContext derives a line range when the DOM had none", async () => {
  const { enrichWithSourceContext } = await loadSubject();
  const enriched = enrichWithSourceContext(SOURCE, {
    quote: "第二段内容。",
    prefix: "",
    suffix: "",
  });
  assert.equal(enriched.startLine, 4);
  assert.equal(enriched.endLine, 4);
});

test("enrichWithSourceContext keeps the snapshot when the quote is missing", async () => {
  const { enrichWithSourceContext } = await loadSubject();
  const snapshot = { quote: "不存在的文本", prefix: "", suffix: "", startLine: 2, endLine: 2 };
  assert.deepEqual(enrichWithSourceContext(SOURCE, snapshot), snapshot);
});
