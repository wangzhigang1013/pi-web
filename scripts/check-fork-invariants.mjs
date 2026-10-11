#!/usr/bin/env node
/**
 * check-fork-invariants.mjs
 * 
 * Fork 特性不变量自动化守卫脚本。
 * 每次合入 upstream 官方更新后必须运行此脚本！
 * 若有任何自定义 Fork 特性被官方改动覆盖冲掉，此脚本将立即报错阻断。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let failures = [];

function assertCondition(name, condition, errorMsg) {
  if (!condition) {
    failures.push(`[FAILED] ${name}: ${errorMsg}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

function assertFileContains(filePath, pattern, name, description) {
  const fullPath = resolve(ROOT, filePath);
  if (!existsSync(fullPath)) {
    failures.push(`[FAILED] ${name}: 文件不存在 -> ${filePath}`);
    return;
  }
  const content = readFileSync(fullPath, "utf8");
  const passed = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  assertCondition(name, passed, `文件 ${filePath} 缺少核心标识: ${description}`);
}

function assertFileNotContains(filePath, pattern, name, description) {
  const fullPath = resolve(ROOT, filePath);
  if (!existsSync(fullPath)) return;
  const content = readFileSync(fullPath, "utf8");
  const forbidden = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  assertCondition(name, !forbidden, `文件 ${filePath} 包含了禁止的官方残留: ${description}`);
}

console.log("\n🔍 正在运行 Fork 特性不变量自动化校验...\n");

// 1. 左侧侧边栏 (SessionSidebar) 纯粹性与 Codex 会话树
assertFileNotContains(
  "components/SessionSidebar.tsx",
  "FileExplorer",
  "侧边栏不包含文件树",
  "禁止在左侧边栏导入或渲染 FileExplorer（文件树已完全右迁）"
);

assertFileNotContains(
  "components/SessionSidebar.tsx",
  "useFilesPlacement",
  "侧边栏禁用官方多Tab/下置分栏",
  "禁止使用官方 useFilesPlacement / Files Tabs 模式"
);

assertFileContains(
  "components/SessionSidebar.tsx",
  "buildSessionTreeStructure",
  "保留 Codex 风格会话树逻辑",
  "必须使用 buildSessionTreeStructure (来自 lib/session-folders)"
);

assertFileContains(
  "components/SessionSidebar.tsx",
  "serverBootId",
  "服务端重启平滑无缝感知",
  "必须包含 serverBootId 变化时自动刷新页面逻辑"
);

// 2. 右侧独立文件工作台 (RightPanelExplorer)
assertFileContains(
  "components/AppShell.tsx",
  "<RightPanelExplorer",
  "主布局集成右侧独立文件浏览器",
  "AppShell 必须渲染 <RightPanelExplorer"
);

assertFileContains(
  "components/AppShell.tsx",
  "onSendAnnotations={handleSendAnnotations}",
  "右侧文件预览内联批注流转",
  "FileViewer 必须支持 onSendAnnotations 回调"
);

assertCondition(
  "存在 RightPanelExplorer 组件",
  existsSync(resolve(ROOT, "components/RightPanelExplorer.tsx")),
  "缺少 components/RightPanelExplorer.tsx"
);

// 3. 云端同步按钮与状态感知
assertFileContains(
  "components/AppShell.tsx",
  "<CloudSyncButton",
  "顶栏常驻 CloudSync 云端同步按钮",
  "AppShell 顶栏必须渲染 <CloudSyncButton"
);

assertCondition(
  "存在 CloudSyncButton 组件与服务",
  existsSync(resolve(ROOT, "components/CloudSyncButton.tsx")) &&
  existsSync(resolve(ROOT, "lib/dotpi/sync-service.ts")),
  "缺少 CloudSyncButton 组件或 sync-service"
);

// 4. 输入栏 Plan / Edit 模式独立开关
assertFileContains(
  "components/ChatInput.tsx",
  'aria-label="方案模式"',
  "输入栏 Plan 方案模式开关",
  "ChatInput 必须包含 Plan 模式切换按钮 (aria-label=\"方案模式\")"
);

assertFileContains(
  "components/ChatInput.tsx",
  'aria-label="修改模式"',
  "输入栏 Edit 修改模式开关",
  "ChatInput 必须包含 Edit 模式切换按钮 (aria-label=\"修改模式\")"
);

// 5. Mermaid 流程图语法自愈
assertFileContains(
  "components/MermaidBlock.tsx",
  "sanitizeMermaidCode",
  "Mermaid 语法自愈能力",
  "MermaidBlock 必须保留 sanitizeMermaidCode 容错处理"
);

// 6. Markdown 预览源码行号映射
assertFileContains(
  "lib/markdown.ts",
  "rehypeSourceLines",
  "Markdown 源码行号插件",
  "markdown.ts 必须保留 rehypeSourceLines 注入插件"
);

// 7. Antigravity 多账号与配额扩展支持
assertCondition(
  "存在 Antigravity 配额接口",
  existsSync(resolve(ROOT, "app/api/antigravity/accounts/route.ts")),
  "缺少 app/api/antigravity/accounts/route.ts"
);

console.log("");

if (failures.length > 0) {
  console.error("❌ 校验失败！检测到有 Fork 核心定制特性被冲掉或缺失：\n");
  failures.forEach((f) => console.error(`  ${f}`));
  console.error("\n💡 提示：请查阅 FORK_MAINTENANCE.md 并从备份分支或上一次提交恢复相应定制代码！\n");
  process.exit(1);
} else {
  console.log("🎉 所有 Fork 特性不变量校验通过！定制特性完好无损。\n");
  process.exit(0);
}
