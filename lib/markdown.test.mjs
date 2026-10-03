import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markdownSanitizeSchema, normalizeDisplayMath, rehypeSourceLines } from "./markdown.ts";

describe("normalizeDisplayMath", () => {
  describe("single-line $$…$$", () => {
    it("splits a single-line block into three lines", () => {
      assert.equal(normalizeDisplayMath("$$a + b$$"), "$$\na + b\n$$");
    });

    it("preserves the indent of the surrounding list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  $$a + b$$\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });
  });

  describe("multi-line blocks with glued delimiters", () => {
    it("moves a glued opening delimiter to its own line", () => {
      const input = "$$\n\\frac{a}{b} = c\n<d$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\n\\frac{a}{b} = c\n<d\n$$\n\nafter");
    });

    it("moves a glued closing delimiter to its own line", () => {
      const input = "$$\nx = y\nz = w$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\nx = y\nz = w\n$$\n\nafter");
    });
  });

  describe("blocks nested in GFM list items", () => {
    it("re-indents lazy content lines of an indented bare-fence block", () => {
      const input = "- item:\n  $$\nx = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("re-indents partially indented content lines", () => {
      const input = "- item:\n  $$\n x = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("does not use a sibling list item's formula as a closing fence", () => {
      const input = "- first\n  $$x = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$x = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });

    it("does not scan a bare fence past a sibling list item", () => {
      const input = "- first\n  $$\nx = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$\nx = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });
  });

  describe("blocks that must stay untouched", () => {
    it("leaves a top-level block with detached delimiters untouched", () => {
      const input = "$$\n\\frac{a}{b}\n$$\n\nend";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("leaves content inside fenced code blocks untouched", () => {
      const input = "```\n$$ not math $$\n$$\n```\n\nreal $$x = 1$$ end";
      const normalized = normalizeDisplayMath(input);
      assert.ok(normalized.includes("```\n$$ not math $$\n$$\n```"));
      // every `$$` is preserved: 3 inside the fence + 2 in inline math
      assert.equal(normalized.match(/\$\$/g)?.length, 5);
    });

    it("leaves inline math and plain prose untouched", () => {
      const input = "text $x = 1$ and $$a + b$$ more";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("does not treat a glued opener with mid-line $$ as a block", () => {
      const input = "$$x$$ and text";
      assert.equal(normalizeDisplayMath(input), input);
    });
  });

  describe("\\[ … \\] blocks", () => {
    it("normalizes single-line brackets", () => {
      assert.equal(normalizeDisplayMath("\\[a + b\\]"), "$$\na + b\n$$");
    });

    it("keeps content indented when nested in a list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[a + b\\]\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });

    it("normalizes multi-line brackets without double-indenting", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[\n  x = y\n  \\]\n- next"),
        "- item:\n  $$\n  x = y\n  $$\n- next",
      );
    });
  });

  describe("loose [ … ] formula blocks", () => {
    it("normalizes model-emitted bracket-only formula lines", () => {
      assert.equal(
        normalizeDisplayMath("[ C(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)}) ]"),
        "$$\nC(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)})\n$$",
      );
    });

    it("leaves ambiguous bracket-only Markdown untouched", () => {
      for (const input of [
        "[普通说明文字]",
        "[See note (important)]",
        "[status=ready]",
        "[yes/no]",
        "[API_v2]\n\n[API_v2]: https://example.com/docs",
        "[C:\\Users\\alex]",
        "[\\\\server\\share]",
        "[https://example.com/\\alpha]",
      ]) {
        assert.equal(normalizeDisplayMath(input), input);
      }
    });
  });
});

describe("rehypeSourceLines", () => {
  const run = (tree) => {
    rehypeSourceLines()(tree);
    return tree;
  };

  it("writes data-src-start/end onto block elements", () => {
    const tree = run({
      type: "root",
      children: [{
        type: "element",
        tagName: "p",
        children: [{ type: "text", value: "段落" }],
        position: { start: { line: 3 }, end: { line: 5 } },
      }],
    });
    assert.deepEqual(tree.children[0].properties, {
      "data-src-start": "3",
      "data-src-end": "5",
    });
  });

  it("skips containers so closest() lands on the innermost block", () => {
    const tree = run({
      type: "root",
      children: [{
        type: "element",
        tagName: "ul",
        properties: {},
        position: { start: { line: 1 }, end: { line: 4 } },
        children: [{
          type: "element",
          tagName: "li",
          properties: {},
          position: { start: { line: 2 }, end: { line: 2 } },
          children: [],
        }],
      }],
    });
    assert.deepEqual(tree.children[0].properties, {}, "ul stays untouched");
    assert.deepEqual(tree.children[0].children[0].properties, {
      "data-src-start": "2",
      "data-src-end": "2",
    });
  });

  it("keeps existing properties and tolerates missing positions", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: { className: ["lead"] },
          children: [],
          position: { start: { line: 7 } },
        },
        { type: "element", tagName: "p", properties: {}, children: [] },
      ],
    });
    assert.deepEqual(tree.children[0].properties, {
      className: ["lead"],
      "data-src-start": "7",
      "data-src-end": "7",
    });
    assert.deepEqual(tree.children[1].properties, {});
  });
});

describe("markdown preview pipeline", () => {
  it("keeps injected source lines after sanitize", async () => {
    let unified;
    let remarkParse;
    let remarkRehype;
    let rehypeSanitize;
    try {
      ({ unified } = await import("unified"));
      ({ default: remarkParse } = await import("remark-parse"));
      ({ default: remarkRehype } = await import("remark-rehype"));
      ({ default: rehypeSanitize } = await import("rehype-sanitize"));
    } catch {
      // 依赖缺失时跳过：真实管线由 components/MarkdownBody.test.mjs 之类的集成测试覆盖。
      return;
    }

    const processor = unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeSanitize, markdownSanitizeSchema)
      .use(rehypeSourceLines);
    const tree = processor.runSync(processor.parse("# 标题\n\n第一段\n\n- 列表项"));

    const flatten = (node) => [
      node,
      ...(node.children ?? []).flatMap(flatten),
    ];
    const blocks = flatten(tree).filter((node) => node.type === "element");
    const heading = blocks.find((node) => node.tagName === "h1");
    const paragraph = blocks.find((node) => node.tagName === "p");
    const listItem = blocks.find((node) => node.tagName === "li");

    assert.equal(heading?.properties?.["data-src-start"], "1", "sanitize must not strip data-src-*");
    assert.equal(paragraph?.properties?.["data-src-start"], "3");
    assert.equal(listItem?.properties?.["data-src-start"], "5");
  });
});
