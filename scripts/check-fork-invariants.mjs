#!/usr/bin/env node
/**
 * check-fork-invariants.mjs
 * 
 * Fork 特性不变量自动化守卫脚本。
 * 每次合入 upstream 官方更新后必须运行此脚本！
 * 若有任何自定义 Fork 核心特性被官方改动覆盖冲掉，此脚本将立即报错阻断。
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

console.log("\n🛡️ 正在运行 Fork 特性不变量自动化校验...\n");

// 1. 左侧原生会话树与服务重启感知
assertFileContains(
  "components/SessionSidebar.tsx",
  "buildSessionTree",
  "采用官方原生会话树",
  "必须使用官方 buildSessionTree (来自 lib/session-tree)"
);

assertFileContains(
  "components/SessionSidebar.tsx",
  "serverBootId",
  "服务端重启平滑无缝感知",
  "必须包含 serverBootId 变化时自动刷新页面逻辑"
);

// 2. 右侧文件预览内联批注流转
assertFileContains(
  "components/AppShell.tsx",
  "onSendAnnotations={handleSendAnnotations}",
  "右侧文件预览内联批注流转",
  "FileViewer 必须支持 onSendAnnotations 回调"
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

// 4. 网络代理快捷开关 (ProxyToggle)
assertFileContains(
  "components/AppShell.tsx",
  "<ProxyIconButton",
  "顶栏常驻网络代理切换按钮",
  "AppShell 顶栏必须渲染 <ProxyIconButton"
);

assertCondition(
  "存在 ProxyToggle 组件与服务",
  existsSync(resolve(ROOT, "components/ProxyToggle.tsx")) &&
  existsSync(resolve(ROOT, "hooks/useProxySettings.ts")),
  "缺少 ProxyToggle 组件或 useProxySettings"
);

// 5. 输入栏 Plan / Edit 模式独立开关
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

// 6. Mermaid 流程图语法自愈
assertFileContains(
  "components/MermaidBlock.tsx",
  "sanitizeMermaidCode",
  "Mermaid 语法自愈能力",
  "MermaidBlock 必须保留 sanitizeMermaidCode 容错处理"
);

// 7. Markdown 预览源码行号映射
assertFileContains(
  "lib/markdown.ts",
  "rehypeSourceLines",
  "Markdown 源码行号插件",
  "markdown.ts 必须保留 rehypeSourceLines 注入插件"
);

// 8. Windows 资源管理器定位
assertCondition(
  "存在文件系统定位接口",
  existsSync(resolve(ROOT, "app/api/files/reveal/route.ts")),
  "缺少 app/api/files/reveal/route.ts"
);

// 9. Antigravity 多账号与配额扩展支持
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
