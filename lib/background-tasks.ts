import {
  killPidTree,
  lookupProcessCommandLine,
  lookupProcessName,
  snapshotListeningPorts,
} from "./process-utils";

export interface BackgroundServerItem {
  port: number;
  pid: number;
  since: number;
  name?: string;
  command?: string;
  sessionId?: string;
}

// 过滤非 AI 启动的常见常驻系统或通讯软件
const EXCLUDED_PROCESS_NAMES = new Set([
  "wechat.exe",
  "weixin.exe",
  "qq.exe",
  "tim.exe",
  "telegram.exe",
  "dingtalk.exe",
  "explorer.exe",
  "svchost.exe",
  "searchhost.exe",
  "dwm.exe",
]);

class BackgroundTaskTracker {
  private readonly servers = new Map<number, BackgroundServerItem>();
  // 正在运行的 bash 执行 AbortController，按 sessionId 维护
  private readonly activeBashControllers = new Map<string, Set<AbortController>>();
  // bash 执行前的端口快照缓存
  private preBashSnapshots = new Map<string, Map<number, number>>();

  // 记录特定会话在 Bash 开始前的端口快照
  async snapshotBefore(sessionId: string): Promise<void> {
    const ports = await snapshotListeningPorts();
    this.preBashSnapshots.set(sessionId, ports);
  }

  // Bash 结束后对比端口快照，捕获新拉起的服务
  async trackAfter(sessionId: string): Promise<BackgroundServerItem[]> {
    const before = this.preBashSnapshots.get(sessionId);
    this.preBashSnapshots.delete(sessionId);
    if (!before) return [];

    // 等待 1.2 秒让服务有足够时间绑定端口
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = await snapshotListeningPorts();

    const newlyAdded: BackgroundServerItem[] = [];
    for (const [port, pid] of after) {
      if (!before.has(port) && !this.servers.has(port)) {
        const item: BackgroundServerItem = {
          port,
          pid,
          since: Date.now(),
          sessionId,
        };
        this.servers.set(port, item);
        newlyAdded.push(item);

        // 异步丰富进程名称与启动命令行
        void lookupProcessName(pid).then((name) => {
          if (name) {
            if (EXCLUDED_PROCESS_NAMES.has(name.toLowerCase())) {
              this.servers.delete(port);
              return;
            }
            item.name = name;
          }
        });
        void lookupProcessCommandLine(pid).then((cmd) => {
          if (cmd) item.command = cmd;
        });
      }
    }
    return newlyAdded;
  }

  // 注册当前正在运行的 Bash 执行
  registerBashController(sessionId: string, controller: AbortController): () => void {
    let set = this.activeBashControllers.get(sessionId);
    if (!set) {
      set = new Set();
      this.activeBashControllers.set(sessionId, set);
    }
    set.add(controller);
    return () => {
      set.delete(controller);
      if (set.size === 0) this.activeBashControllers.delete(sessionId);
    };
  }

  // 单独中止当前会话正在运行的 Bash 命令（不打断整个 AI 对话）
  abortActiveBash(sessionId: string): boolean {
    const set = this.activeBashControllers.get(sessionId);
    if (!set || set.size === 0) return false;
    for (const controller of set) {
      controller.abort();
    }
    set.clear();
    this.activeBashControllers.delete(sessionId);
    return true;
  }

  // 检查当前会话是否有活跃的 Bash 命令正在执行
  hasActiveBash(sessionId: string): boolean {
    const set = this.activeBashControllers.get(sessionId);
    return Boolean(set && set.size > 0);
  }

  // 刷新并剔除已经退出的服务
  async refresh(): Promise<BackgroundServerItem[]> {
    if (this.servers.size === 0) return [];
    const currentListening = await snapshotListeningPorts();
    for (const [port, item] of [...this.servers.entries()]) {
      if (currentListening.get(port) !== item.pid) {
        this.servers.delete(port);
      }
    }
    return this.list();
  }

  list(): BackgroundServerItem[] {
    return Array.from(this.servers.values()).sort((a, b) => b.since - a.since);
  }

  killOne(port: number): boolean {
    const item = this.servers.get(port);
    if (!item) return false;
    killPidTree(item.pid);
    this.servers.delete(port);
    return true;
  }

  killAll(): number[] {
    const killedPorts: number[] = [];
    for (const [port, item] of this.servers.entries()) {
      killPidTree(item.pid);
      killedPorts.push(port);
    }
    this.servers.clear();
    return killedPorts;
  }
}

// 全局单例
export const backgroundTasks = new BackgroundTaskTracker();
