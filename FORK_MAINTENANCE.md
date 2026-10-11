# Pi Web Fork 维护、特性矩阵与上游同步指南

本仓库是基于官方上游 [`agegr/pi-web`](https://github.com/agegr/pi-web) 深度定制的 Fork 版本，专为高强度 Coding Agent 配对编程场景深度优化。

---

## 一、 Fork 核心设计哲学与架构模型

### 1. 经典三栏工作台模型（彻底解耦）
官方上游为了迎合移动端和极简 Web 聊天，倾向于将文件树与会话塞在左侧同一个侧边栏中（导致长会话与文件树相互挤压）。本 Fork 坚持采用与现代专业 IDE（Cursor / VS Code）一致的**三栏解耦模型**：

```
+------------------+----------------------------------+------------------------------+
|   左栏：脑与记忆   |           中栏：执行与交互        |        右栏：代码与资产       |
| (SessionSidebar) |            (ChatWindow)          |     (RightPanelExplorer)     |
+------------------+----------------------------------+------------------------------+
| • 100% 纵向空间   | • 思考流式展现与工具调用          | • 独立文件树 (展开/折叠)     |
| • Codex 树状组织  | • Plan / Edit 模式常驻快捷开关    | • Markdown / 代码文件预览    |
| • 拖拽/置顶/归档  | • Mermaid / Math 公式智能自愈    | • 选区气泡内联批注流转 Agent |
| • 绝无文件树干扰  | • 顶栏 CloudSync 跨设备云同步    | • Windows 资源管理器一键直达 |
+------------------+----------------------------------+------------------------------+
```

### 2. 为什么坚决拦截官方的某些“新特性”？
- **官方 `filesPlacement`（左侧文件树/Tab 切换）**：左侧只要出现文件树，无论上下切分还是标签切换，都会严重蚕食多项目、长会话的垂直检索视野。**本 Fork 坚决将文件浏览收敛于右侧面板**。
- **官方扁平化 `SessionTree`**：官方原生会话列表主要按时间线和单层 Git 仓库平铺，缺乏对多项目、长期任务的精细化管控。**本 Fork 坚持采用基于 `session-folders.ts` 的 Codex / Z Code 风格会话树**，支持项目置顶、分组拖拽、工作区隐藏等。

---

## 二、 核心特性不变量矩阵（Feature Invariants Matrix）

| 模块类别 | Fork 核心特性（必须 100% 保留） | 保护级别 | 核心代码路径 | 官方对应实现（坚决拦截/替换） | 守卫检查方式 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **会话管理** | **纯粹 Codex 风格会话树**<br>• 100% 高度无文件树<br>• 支持拖拽排序、置顶、分组折叠<br>• 工作区隐藏与已隐藏抽屉 | **P0** | `components/SessionSidebar.tsx`<br>`lib/session-folders.ts` | 官方原生 `SessionTree.tsx` 与左侧文件列表 | 静态检查：严禁包含 `FileExplorer` 与 `useFilesPlacement` |
| **文件管理** | **右侧独立工作台 (RightPanelExplorer)**<br>• 满宽/双栏动态自适应<br>• Windows 资源管理器一键唤起<br>• 全局文件搜索与上传 | **P0** | `components/RightPanelExplorer.tsx`<br>`components/AppShell.tsx` | 官方仅支持只读 `FileViewer`，强依赖左侧打开 | 静态检查：`AppShell` 必须包含 `<RightPanelExplorer` |
| **代码批注** | **文件预览内联批注 (Preview Annotations)**<br>• 选区就地浮动气泡（Popover Anchor）<br>• 正文持久化高亮层<br>• 右下角收敛抽屉 + 一键直达会话排队 | **P0** | `components/FileViewer.tsx`<br>`lib/markdown.ts`<br>`hooks/useSessionAnnotations.ts` | 官方无此能力 | 静态检查：`FileViewer` 必须暴露 `onSendAnnotations` |
| **底栏控制** | **Plan / Edit 模式快捷开关**<br>• `[📋 Plan]` 方案模式（只读+出方案）<br>• `[✏️ Edit]` 修改模式（只改不跑）<br>• 独立高亮状态与双向会话感知 | **P1** | `components/ChatInput.tsx` | 官方无此按钮 | 静态检查：必须包含 `aria-label="方案模式"` 与 `"修改模式"` |
| **云端同步** | **个人全局配置与技能库云同步**<br>• 顶栏 `CloudSyncButton` 状态指示灯<br>• 自动感知 `~/.pi` 与远端差异<br>• 一键双向拉取/推送 | **P1** | `components/CloudSyncButton.tsx`<br>`lib/dotpi/sync-service.ts` | 官方无此机制 | 静态检查：`AppShell` 必须包含 `<CloudSyncButton` |
| **模型扩展** | **Google Antigravity 多账号池与配额监控**<br>• 多账号配额实时轮询与切换<br>• 智能动态模型适配器 | **P1** | `app/api/antigravity/` | 官方普通 API Key 轮询 | 静态检查：接口文件必须存在 |
| **渲染排版** | **Mermaid 流程图自愈与多行公式防溢出**<br>• LLM 漏引号特殊字符自动修复<br>• 宽公式平滑排版 | **P2** | `components/MermaidBlock.tsx`<br>`lib/markdown.ts` | 官方直接报错 Red Screen | 静态检查：必须包含 `sanitizeMermaidCode` |
| **运行感知** | **服务重启无缝平滑刷新**<br>• `serverBootId` 变化自动重载前端 | **P2** | `components/SessionSidebar.tsx` | 官方无感知（需手动 F5） | 静态检查：必须包含 `serverBootId` 轮询 |
| **页面纯净化** | **移除新会话上方官方条框**<br>• 彻底屏蔽官方多余的 `NewSessionContextBar`<br>• 杜绝对话框上方文件图标误点击报错跳转<br>• 项目/工作区纯粹收敛于左侧专职管理 | **P2** | `components/ChatWindow.tsx`<br>`components/AppShell.tsx` | 官方输入框上方强塞文件图标与抽屉 | 静态检查：严禁在 `ChatWindow` 渲染 `{newSessionContextBar}` |

---

## 三、 自动化守卫测试机制（Guard Check Pipeline）

为了避免后续合入官方代码时因手滑或 `--theirs` 覆盖导致特性丢失，仓库内置了专用的不变量守卫脚本：

### 1. 运行守卫检查
```bash
# 专跑 Fork 不变量守卫检查（耗时 < 1 秒）
npm run check:fork

# 运行全量测试套件（内置自动前置执行 check:fork）
npm test
```

### 2. 守卫拦截逻辑
守卫脚本位于 `scripts/check-fork-invariants.mjs`，会对代码树进行 AST / 文本特征断言：
- 若检测到 `SessionSidebar.tsx` 被塞入了 `FileExplorer` 或官方 Tab 分流逻辑，**立即报错阻断**。
- 若检测到 `AppShell.tsx` 丢失了 `RightPanelExplorer`、`CloudSyncButton` 或批注回调，**立即报错阻断**。
- 若检测到 `ChatInput.tsx` 丢失了 Plan / Edit 按钮，**立即报错阻断**。
- **只要守卫测试红牌，绝不允许执行提交！**

---

## 四、 标准上游同步 SOP（零遗漏合并操作流程）

后续官方发布新版本（如 v0.13.0、v0.14.0）时，请**严格按照以下 6 步流程**执行：

### Step 1: 建立快照备份分支
在做任何变动前，先给当前稳定环境打一个安全分支：
```bash
git checkout main
git branch backup-before-upstream-$(date +%Y%m%d)
```

### Step 2: 拉取上游最新代码并比对
```bash
git fetch upstream
# 查看上游有哪些新 Commit
git log HEAD..upstream/main --oneline
```

### Step 3: 发起非快进、暂不提交的 Merge
```bash
git merge upstream/main --no-commit --no-ff
```

### Step 4: 冲突处理铁律（核心文件处置指引）
遇到冲突时，切记以下处置原则：
1. **`components/SessionSidebar.tsx`**：
   - ⚠️ **严禁 `git checkout --theirs`**！
   - 以当前 Fork 版本为基准，仅吸收 upstream 的数据接口调整（如新增的 props、事件回调）与必要补丁。
2. **`components/AppShell.tsx`**：
   - 解决冲突时，务必保留右侧 `RightPanelExplorer` 和顶栏 `CloudSyncButton` 的挂载代码。
3. **`components/ChatInput.tsx`**：
   - 保留 Plan Mode / Edit Mode 的状态与按钮 DOM。
4. **`components/FileViewer.tsx` 与 `lib/markdown.ts`**：
   - 保留内联批注 `onSendAnnotations` 回调与 `rehypeSourceLines` 行号映射。
5. **纯通用模块（如后端 API、Terminal、MCP 协议更新）**：
   - 可积极拥抱 upstream 的最新官方实现。

### Step 5: 运行自动化守卫与构建验证
冲突全部标记解决后，**在提交之前必须执行两道验证命令**：
```bash
# 1. 验证 Fork 定制特性是否 100% 存活
npm run check:fork

# 2. 验证前端 TypeScript 类型与生产打包是否完全通过
npm run build
```

### Step 6: 确认无误，生成规范的 Merge Commit
```bash
git commit -m "Merge upstream <release-tag> into fork

- Integrated upstream features: <列出采纳的上游特性>
- Preserved custom fork invariants:
  - Pure Codex session tree & workspace management
  - Right-panel decoupled file explorer & inline annotations
  - Plan/Edit mode switches & CloudSync button
  - Antigravity quota & server reboot auto-refresh"
```

---

## 五、 敏感文件与跨设备隔离规范

为防止在多台机器（如家用台式机与办公笔记本）协同工作时造成配置相互覆盖或密钥泄露，以下文件必须**严格保持 Untracked**（已被 `.gitignore` 排除）：

1. **设置与存储**：
   - `agent/settings.json`（各机器独立配置）
   - `agent/models-store.json`（各机器独立模型缓存）
2. **鉴权与密钥**：
   - `agent/auth.json`
   - `agent/antigravity-accounts.json`
3. **运行时产物**：
   - `.next/`、`node_modules/`、`.plans/`
   - 会话历史记录与二进制缓存

任何时候切勿使用 `git add -f` 强制将上述文件推送到公共远程仓库。
