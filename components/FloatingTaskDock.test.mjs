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

test("renders floating task board when rpiv-todos widget is present", () => {
  const html = renderToStaticMarkup(
    React.createElement(FloatingTaskDock, {
      widgets: [
        {
          key: "rpiv-todos",
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
