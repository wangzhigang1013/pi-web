import { execFile, spawn } from "node:child_process";

export interface ListeningPortInfo {
  port: number;
  pid: number;
}

/**
 * 拍照当前系统处于 LISTENING 状态的 TCP 端口与其所属的 PID。
 * Windows: 使用 netstat -ano -p tcp
 * Linux / macOS: 使用 lsof -iTCP -sTCP:LISTEN -P -n
 */
export async function snapshotListeningPorts(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    if (process.platform === "win32") {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, timeout: 8000 }, (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      });
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        // TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 12345
        if (parts.length >= 5 && parts[0] === "TCP" && parts[3] === "LISTENING") {
          const portStr = parts[1].split(":").pop();
          const port = portStr ? Number(portStr) : NaN;
          const pid = Number(parts[4]);
          if (Number.isFinite(port) && Number.isFinite(pid) && port > 0) {
            map.set(port, pid);
          }
        }
      }
    } else {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"], { timeout: 8000 }, (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      });
      for (const line of stdout.split(/\r?\n/).slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const tail = parts[parts.length - 1] ?? "";
          const match = tail.match(/:(\d+)\)?\s*$/);
          const port = match ? Number(match[1]) : NaN;
          const pid = Number(parts[1]);
          if (Number.isFinite(port) && Number.isFinite(pid) && port > 0) {
            map.set(port, pid);
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return map;
}

/**
 * 杀死指定 PID 及其整个进程树（跨平台健壮清理）。
 */
export function killPidTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      }).unref();
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // 进程可能已经提前退出
  }
}

/**
 * 获取指定 PID 的完整命令行（用于在后台任务面板清晰展示运行的脚本）。
 */
export async function lookupProcessCommandLine(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
          ],
          { windowsHide: true, timeout: 6000 },
          (err, out) => (err ? reject(err) : resolve(out)),
        );
      });
      const line = stdout.trim();
      return line || undefined;
    }
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 4000 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const line = stdout.trim();
    return line || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 获取指定 PID 的进程名称（如 node.exe, python.exe）。
 */
export async function lookupProcessName(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          "tasklist",
          ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
          { windowsHide: true, timeout: 4000 },
          (err, out) => (err ? reject(err) : resolve(out)),
        );
      });
      const match = stdout.match(/"([^"]+)"/);
      return match ? match[1] : undefined;
    }
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("ps", ["-o", "comm=", "-p", String(pid)], { timeout: 4000 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const name = stdout.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
