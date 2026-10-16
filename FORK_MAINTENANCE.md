# Pi Web Fork 维护、特性矩阵与上游同步指南

本仓库是基于官方上游 [`agegr/pi-web`](https://github.com/agegr/pi-web) 深度定制的 Fork 版本，专为高强度 Coding Agent 配对编程场景深度优化。

---

## 一、 Fork 架构模型与上游协同

### 1. 拥抱官方原生会话与文件侧边栏
官方最新版已原生支持多项目/多文件夹会话树（`SessionTree.tsx` + `lib/session-tree.ts`），并原生集成了文件管理能力。为了将后续从 upstream 合并代码的冲突降低 90% 以上，本 Fork **直接继承官方原生的 SessionSidebar 与会话树体系**，不再魔改左栏核心结构。

```
+-----------------------------------+----------------------------------+------------------------------------+
|         左栏：官方原生侧边栏        |           中栏：执行与交互        |          右栏：资产与预览          |
|  (继承官方 SessionSidebar+Tree)    |            (ChatWindow)          |        (FileViewer & Terminal)     |
+-----------------------------------+----------------------------------+------------------------------------+
| • 官方原生多项目会话树            | • 思考流式展现与工具调用折叠     | • 官方 TabBar (文件/终端/Subagent) |
| • 原生项目折叠/置顶/排序/检索     | • Plan / Edit 模式常驻快捷开关    | • Markdown / 代码文件即时预览      |
| • 左侧原生 FileExplorer 文件树    | • 顶栏 CloudSync 跨设备云同步    | • 选区气泡内联批注流转 Agent       |
| • 服务端重启平滑无缝自动刷新      | • 顶栏 ProxyToggle 网络代理切换  | • 纯粹只读与辅助执行，无冗余文件树 |
+-----------------------------------+----------------------------------+------------------------------------+
```

---

## 二、 核心特性不变量矩阵（Feature Invariants Matrix）

| 模块类别 | Fork 核心特性（必须 100% 保留） | 保护级别 | 核心代码路径 | 官方对应实现 | 守卫检查方式 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **会话管理** | **官方原生多项目会话树**<br>• 原生多项目/工作区分组<br>• 支持拖拽排序、置顶、分组折叠<br>• 服务端重启平滑自动感知刷新 | **P0** | `components/SessionSidebar.tsx`<br>`lib/session-tree.ts` | 官方原生实现 | 静态检查：包含 `buildSessionTree` 与 `serverBootId` |
| **代码批注** | **文件预览内联批注 (Preview Annotations)**<br>• 选区就地浮动气泡（Popover Anchor）<br>• 正文持久化高亮层<br>• 右下角收敛抽屉 + 一键直达会话排队 | **P0** | `components/FileViewer.tsx`<br>`lib/markdown.ts`<br>`hooks/useSessionAnnotations.ts` | 官方无此能力 | 静态检查：`AppShell` 必须暴露 `onSendAnnotations` |
| **底栏控制** | **Plan 模式快捷开关**<br>• `[Plan]` 方案模式（只读+出方案）<br>• 独立高亮状态与双向会话感知 | **P1** | `components/ChatInput.tsx` | 官方无此按钮 | 静态检查：必须包含 `aria-label="方案模式"` |
| **云端同步** | **个人全局配置与技能库云同步**<br>• 顶栏 `CloudSyncButton` 状态指示灯<br>• 自动感知 `~/.pi` 与远端差异<br>• 一键双向拉取/推送 | **P1** | `components/CloudSyncButton.tsx`<br>`lib/dotpi/sync-service.ts` | 官方无此机制 | 静态检查：`AppShell` 必须包含 `<CloudSyncButton` |
| **网络代理** | **顶栏代理快捷开关 (ProxyToggle)**<br>• 一键开启/关闭/自动回退系统代理<br>• 进程级 HTTP_PROXY / HTTPS_PROXY 动态生效 | **P1** | `components/ProxyToggle.tsx`<br>`hooks/useProxySettings.ts` | 官方仅支持启动参数 | 静态检查：`AppShell` 必须包含 `<ProxyIconButton` |
| **模型扩展** | **Google Antigravity 多账号池与配额监控**<br>• 多账号配额实时轮询与切换<br>• 智能动态模型适配器 | **P1** | `app/api/antigravity/` | 官方普通 API Key 轮询 | 静态检查：接口文件必须存在 |
| **系统定位** | **Windows 资源管理器一键唤起**<br>• 文件树右键或 Hover 直达 Windows 资源管理器定位 | **P1** | `app/api/files/reveal/route.ts`<br>`components/FileExplorer.tsx` | 官方不支持定位本地目录 | 静态检查：接口文件必须存在 |
| **渲染排版** | **Mermaid 流程图自愈与多行公式防溢出**<br>• LLM 漏引号特殊字符自动修复<br>• 宽公式平滑排版 | **P2** | `components/MermaidBlock.tsx`<br>`lib/markdown.ts` | 官方直接报错 Red Screen | 静态检查：必须包含 `sanitizeMermaidCode` |

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
守卫脚本位于 `scripts/check-fork-invariants.mjs`，会对代码树进行文本特征断言：
- 若检测到 `SessionSidebar.tsx` 丢失了 `buildSessionTree` 或 `serverBootId`，**立即报错阻断**。
- 若检测到 `AppShell.tsx` 丢失了 `CloudSyncButton`、`ProxyIconButton` 或批注回调，**立即报错阻断**。
- 若检测到 `ChatInput.tsx` 丢失了 Plan / Edit 按钮，**立即报错阻断**。
- **只要守卫测试红牌，绝不允许执行提交！**

---

## 四、 标准上游同步 SOP（零遗漏合并操作流程）

后续官方发布新版本（如 v0.12.2、v0.13.0）时，请**严格按照以下 6 步流程**执行：

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

### Step 4: 冲突处理
由于侧边栏已对齐官方原生，冲突发生率大幅降低：
1. **`components/SessionSidebar.tsx`**：绝大部分情况可直接接受上游变更，只需确认保留 `serverBootId` 的 6 行重启刷新逻辑。
2. **`components/AppShell.tsx`**：保留顶栏 `CloudSyncButton`、`ProxyIconButton` 和 `onSendAnnotations` 回调。
3. **`components/ChatInput.tsx`**：保留 Plan / Edit 模式按钮 DOM 与状态回调。
4. **纯通用模块**：完全拥抱 upstream 的最新官方实现。

### Step 5: 运行自动化守卫与构建验证
```bash
npm run check:fork
npm test
npm run build
```

### Step 6: 确认无误，提交 Merge Commit
```bash
git commit -m "Merge upstream <release-tag> into fork"
```
