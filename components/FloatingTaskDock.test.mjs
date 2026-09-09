import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { FloatingTaskDock } = await jiti.import("./FloatingTaskDock.tsx");

test("renders null when there are no todo widgets or tasks", () => {
  const html = renderToStaticMarkup(
    React.createElement(FloatingTaskDock, {
      widgets: [],
      statuses: [],
    }),
  );
  assert.equal(html, "");
});

test("renders floating task board for rpiv-todos format", () => {
  const html = renderToStaticMarkup(
    React.createElement(FloatingTaskDock, {
      widgets: [
        {
          key: "rpiv-todos",
          lines: [
            "● Todos (2/4)",
            "├─ ✓ #1 调研现有工具",
            "├─ ✓ #2 编写单元测试",
            "├─ ◐ #3 运行测试回归 (writing tests...)",
            "└─ ○ #4 提交代码并验证",
          ],
        },
      ],
      statuses: [],
    }),
  );

  assert.ok(html.includes("任务进度看板"));
  assert.ok(html.includes("2/4"));
  assert.ok(html.includes("调研现有工具"));
  assert.ok(html.includes("编写单元测试"));
  assert.ok(html.includes("运行测试回归"));
  assert.ok(html.includes("writing tests..."));
});

test("renders floating task board for bracket format", () => {
  const html = renderToStaticMarkup(
    React.createElement(FloatingTaskDock, {
      widgets: [
        {
          key: "todo",
          lines: [
            "● Todos (2/4)",
            "[x] 1. Initial research",
            "[>] 2. Writing tests",
            "[ ] 3. Implementation",
            "[ ] 4. Verification",
          ],
        },
      ],
      statuses: [],
    }),
  );

  assert.ok(html.includes("任务进度看板"));
  assert.ok(html.includes("2/4"));
  assert.ok(html.includes("Writing tests"));
});

test("ignores non-todo extension widgets and stays hidden", () => {
  const html = renderToStaticMarkup(
    React.createElement(FloatingTaskDock, {
      widgets: [
        {
          key: "git-branch",
          lines: ["main*"],
        },
      ],
      statuses: [],
    }),
  );
  assert.equal(html, "");
});
