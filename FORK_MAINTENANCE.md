# Pi Web Fork 维护与上游同步指南

本仓库是基于官方上游 [`agegr/pi-web`](https://github.com/agegr/pi-web) 深度定制的 Fork 版本，核心增强了 **右侧边栏内置交互式终端（WebTerminal）**。

---

## 🌟 核心定制功能说明

### 1. 右侧边栏内置交互终端
- **终端引擎**：基于 `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links`。
- **系统后端**：基于 `node-pty` 原生调用操作系统伪终端（Windows ConPTY / Linux openpty / macOS）。
- **双模面板**：右侧面板顶部提供 `[📁 文件]` 与 `[>_ 终端]` 双 Tab 切换，同时在顶栏常驻 `>_` 终端切换按钮。

### 2. 评测/长时间任务防中断保活（Persistent Session）
- **DOM 常驻机制**：当切换到文件查看、关闭右侧栏或切换到其他聊天 Session 时，`<WebTerminal />` 通过 CSS `display: none` 隐藏，**DOM 实例与 WebSocket 绝不卸载**。
- **后端环形缓冲区（Ring Buffer）**：后端常驻保存最近 50 万字符的终端日志。
- **自动防折行与重连恢复**：自适应窗口拖拽 Resize，网络重连或刷新页面时瞬间回放缓冲区日志，保证 `tqdm`、`rich` 进度条原地恢复。

### 3. 文件浏览器一键唤起 Windows 资源管理器（Reveal in Explorer）
- **文件/文件夹悬浮直达**：在左侧文件浏览器中鼠标悬浮在任何文件或文件夹上，在 `@提及` 按钮右侧新增 **文件夹打开/定位图标**，点击即可直接调起 Windows 资源管理器打开该文件夹或定位选中该文件。
- **项目根目录一键打开**：在文件浏览器顶栏（刷新/上传旁边）增加文件夹图标，点击一键唤起 Windows 资源管理器打开当前工作区根目录。

---

## 📁 改动清单与文件地图（File Map）

为了最大程度保证后续合并官方代码（`git merge upstream/main`）**0 冲突**，所有功能均采用高度解耦的插件化设计：

### 1. 独立新增模块（完全解耦，不与上游冲突）
- `lib/terminal/pty-manager.ts`：PTY 进程管理池、生命周期与环境配置。
- `lib/terminal/ring-buffer.ts`：环形内存缓冲区，用于断线与重连回放。
- `lib/terminal/server.ts`：WebSocket 服务守护进程与消息路由。
- `lib/terminal/terminal.test.mjs` / `pty.test.mjs`：终端与缓冲区单元测试。
- `app/api/terminal/info/route.ts`：终端服务端口与状态发现 API。
- `app/api/files/reveal/route.ts`：系统资源管理器（explorer.exe / open / xdg-open）唤起 API。
- `components/terminal/WebTerminal.tsx`：xterm.js 前端渲染组件、快捷按键栏（`Ctrl+C`、`Tab`、`↑`、`↓`、`清屏`、`重启`）。

### 2. 原版代码仅有的轻量修改（挂载点）
| 文件 | 改动说明 | 冲突防范建议 |
| :--- | :--- | :--- |
| `components/AppShell.tsx` | 引入 `WebTerminal`，在顶栏增加终端按钮，在右侧面板增加模式 Tab 切换与常驻挂载 | 如上游重构右侧栏，只需保留 `<WebTerminal />` 的常驻渲染和 `rightPanelTab` 状态 |
| `components/FileExplorer.tsx` | 在悬浮条目中增加唤起资源管理器按钮 | 保留悬浮操作栏中的打开按钮 |
| `components/SessionSidebar.tsx` | 在文件浏览器顶栏增加打开项目根目录按钮 | 保留顶栏打开按钮 |
| `instrumentation.ts` | 服务启动时调用 `ensureTerminalServer()` 预热 WebSocket | 如上游修改 `register()`，只需保留对 `ensureTerminalServer` 的调用 |
| `next.config.ts` | `serverExternalPackages` 中增加 `"node-pty"`, `"ws"` | 保持这两个依赖在 external packages 列表中即可 |
| `package.json` | 增加 `@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`、`node-pty`、`ws` | 依赖合并时保留这些包 |

---

## 🔄 上游同步标准流程（Upstream Sync Guide）

当官方发布新版本时，请按以下标准步骤进行同步：

### 步骤 1：获取上游最新代码
```bash
# 确保本地在 main 分支且工作区干净
git checkout main
git status

# 拉取上游最新分支
git fetch upstream
```

### 步骤 2：合并上游代码
```bash
git merge upstream/main
```

### 步骤 3：如有少量冲突时的解决原则
- 如果 `components/AppShell.tsx` 产生冲突：
  - 核心是保留 `WebTerminal` 的引入以及右侧面板的 `rightPanelTab` 切换逻辑与常驻渲染。
- 如果 `next.config.ts` 冲突：
  - 确保 `serverExternalPackages` 包含 `"node-pty"` 和 `"ws"`。

### 步骤 4：安装可能新增的依赖并构建验证
```bash
npm install
npm run build
```

### 步骤 5：推送到自己的 GitHub 仓库
```bash
git push origin main
```

---

## 🚀 本地启动与全局安装

```bash
# 方式 A：开发模式
npm run dev

# 方式 B：生产模式全局 link（推荐）
npm run build
npm link
# 之后在任意终端直接运行 pi-web
```
