# 0008 — 代理开关的「关闭」只撤销 Pi Web 的覆盖，不再删除系统代理

## Status

Accepted. 修订 [0006](0006-http-proxy-toggle.md) 第 1 条里「关闭即删除代理环境变量」的实现。

## Context

0006 把开关状态持久化到 `~/.pi/agent/web-proxy.json`，并让 `setHttpProxy(null)`
直接 `delete process.env.HTTP_PROXY / HTTPS_PROXY / NO_PROXY`。当时的前提是
"用户自己管理命令行 `pi` 的代理"，但漏掉了一种现场：**用户在系统里配好了代理，
而 Pi Web 的开关只是没开**。

真实事故（Windows + Clash Verge + Antigravity）：

1. 用户的用户级环境变量里有 `HTTPS_PROXY=http://127.0.0.1:7890`（Clash 正在跑），
   于是命令行 `pi`、子进程都能正常出网。
2. `web-proxy.json` 处于 `enabled: false`（可能由「离线自动切回直连」写下），
   `instrumentation-node.ts` 启动时立刻调用 `setHttpProxy(null)`，把上面三个
   变量删掉。
3. Node 24 的 `--use-env-proxy` **只认 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，
   不认 `ALL_PROXY`**。三个变量一没，进程内所有 `fetch` 退回直连，Google 直连
   超时，Antigravity 全部报 `fetch failed`。
4. 现场表现极具误导性：Clash 在跑、7890 能连通、账号 refresh token 有效、两个
   账号配额都是 100%、三个 Google 端点手动请求全部 200 —— 只有 Pi Web 自己
   "连不上"，因为它把自己的代理变量删干净了。
5. 同时 `web-proxy.json` 里存的是 `DEFAULT_PROXY_URL`（`127.0.0.1:7897`），
   与用户实际在用的 7890 不一致，UI 探测 7897 必然红灯，进一步坐实了
   "代理坏了"的误判。

结论：`delete` 混淆了两个不同的意图 ——「不要用 Pi Web 覆盖的代理」与
「这个进程不要用任何代理」。前者是开关的职责，后者不该由开关擅自决定。

## Decision

1. **固化「系统代理基线」**：`lib/http-dispatcher.ts` 在**模块加载时**捕获
   进程启动即继承的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，缓存到
   `globalThis.__piWebSystemProxyBaseline`。必须加载即捕获，惰性到关闭开关时
   再读会拿到 Pi Web 自己写进去的覆盖值，反而把覆盖当成"系统代理"恢复。

2. **关闭 = 回退基线**：`setHttpProxy(null)` 不再无条件 `delete`，而是把三个
   变量还原成基线值，基线里也没有的键才删除。系统没配代理时行为与旧版完全一致。
   回退时 `NO_PROXY` 要单独处理：基线里若还留着代理，必须把
   `localhost,127.0.0.1,::1` 重新并进去 —— undici 的 `EnvHttpProxyAgent` 在
   `no_proxy` 为空时会把**所有**请求送进代理，连本机服务也会被当成外网流量，
   而这正是 0006 第 3 条要防的事。

3. **如实暴露来源**：`/api/proxy` 新增 `source: "web" | "system" | "none"`。
   `web` 表示 Pi Web 覆盖生效，`system` 表示开关没开但进程仍走在系统环境变量
   的代理上 —— 这种状态下"关掉开关"不会变成直连，UI 必须说清楚。

4. **UI 把开关与「实际是否走代理」拆开**：设置面板的开关 `checked` 绑定
   `source === "web"`（它控制的是 Pi Web 的覆盖），顶栏状态灯仍看 `enabled`
   （它反映的才是真实连通性）。`source === "system"` 时展示系统代理提示。

5. **自动降级只在 `source === "web"` 时触发**：系统代理在上时，自动降级发出
   的 `{ enabled: false }` 改不动它，只会每个轮询周期白撞一次，还会反复弹提示。

## Consequences

- 「关闭开关」不再等价于「直连」。当系统层配了代理时，关掉开关后请求仍走系统
  代理 —— 这是刻意的：用户的系统配置不该被一个 UI 开关抹掉。代价是 UI 必须
  如实显示来源，否则用户会以为开关失灵。
- Antigravity 等依赖外网的 provider 不再因为一次"关开关"就静默失效。
- 仍修不了的情形：Pi Web 本身就是从一个**没有**代理变量的环境启动的（例如从
  资源管理器直接启动，或父进程环境早于变量写入）。此时基线为空，关闭后依旧是
  直连，只能由用户在 UI 里填地址并开启覆盖。
- 基线缓存在 `globalThis` 上：同一进程内重复加载模块（Next.js 多实例、热更新）
  不会二次捕获，避免被自身写入污染。
- **已知限制（POSIX）**：undici 读代理环境变量时，小写 `https_proxy` / `no_proxy`
  优先于大写。基线与覆盖仍只处理大写三项，所以在 Linux / macOS 上只配了小写
  变量的环境里，`source` 可能报 `none` 而实际仍在走代理，Pi Web 的覆盖也可能
  被小写值影子掉。Windows 的 `process.env` 大小写不敏感（本 fork 的主要平台），
  不受影响。
