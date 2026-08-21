import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface DotPiStatus {
  isGitRepo: boolean;
  ahead: number;
  behind: number;
  isDirty: boolean;
  dirtyFiles: string[];
  lastCommit?: string;
  remoteUrl?: string;
  error?: string;
  lastCheckedAt: number;
}

const DOT_PI_DIR = join(homedir(), ".pi");

export async function getDotPiStatus(): Promise<DotPiStatus> {
  const dotGitDir = join(DOT_PI_DIR, ".git");
  if (!existsSync(dotGitDir)) {
    return {
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      isDirty: false,
      dirtyFiles: [],
      lastCheckedAt: Date.now(),
    };
  }

  try {
    // 1. Fetch silently from origin
    try {
      await execAsync("git fetch --quiet origin", {
        cwd: DOT_PI_DIR,
        timeout: 8000,
      });
    } catch {
      // Offline or remote timeout, proceed with local comparison
    }

    // 2. Check local uncommitted changes
    const { stdout: statusOut } = await execAsync("git status --porcelain", {
      cwd: DOT_PI_DIR,
      timeout: 5000,
    });
    const dirtyFiles = statusOut
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.slice(3));
    const isDirty = dirtyFiles.length > 0;

    // 3. Check ahead / behind count against origin/main
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: revOut } = await execAsync(
        "git rev-list --left-right --count HEAD...origin/main",
        { cwd: DOT_PI_DIR, timeout: 5000 }
      );
      const parts = revOut.trim().split(/\s+/);
      if (parts.length >= 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // Branch might not have tracking set yet
    }

    // 4. Get last commit subject
    let lastCommit = "";
    try {
      const { stdout: logOut } = await execAsync("git log -1 --format=%s", {
        cwd: DOT_PI_DIR,
        timeout: 3000,
      });
      lastCommit = logOut.trim();
    } catch {
      // ignore
    }

    // 5. Get remote url
    let remoteUrl = "";
    try {
      const { stdout: remoteOut } = await execAsync("git config --get remote.origin.url", {
        cwd: DOT_PI_DIR,
        timeout: 3000,
      });
      remoteUrl = remoteOut.trim();
    } catch {
      // ignore
    }

    return {
      isGitRepo: true,
      ahead,
      behind,
      isDirty,
      dirtyFiles,
      lastCommit,
      remoteUrl,
      lastCheckedAt: Date.now(),
    };
  } catch (err) {
    return {
      isGitRepo: true,
      ahead: 0,
      behind: 0,
      isDirty: false,
      dirtyFiles: [],
      error: err instanceof Error ? err.message : String(err),
      lastCheckedAt: Date.now(),
    };
  }
}

export async function performDotPiSync(mode: "pull" | "push" | "auto" = "auto"): Promise<{
  success: boolean;
  action: "pulled" | "pushed" | "synced" | "none";
  message: string;
  status: DotPiStatus;
}> {
  const currentStatus = await getDotPiStatus();
  if (!currentStatus.isGitRepo) {
    throw new Error("~/.pi 不是一个 Git 仓库");
  }

  // Action: Pull from cloud
  if (mode === "pull" || (mode === "auto" && currentStatus.behind > 0 && !currentStatus.isDirty)) {
    try {
      await execAsync("git pull --rebase origin main", {
        cwd: DOT_PI_DIR,
        timeout: 15000,
      });
      const newStatus = await getDotPiStatus();
      return {
        success: true,
        action: "pulled",
        message: `成功拉取云端更新（${currentStatus.behind} 个新提交）`,
        status: newStatus,
      };
    } catch (err) {
      throw new Error(`拉取云端更新失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Action: Push local changes to cloud
  if (mode === "push" || (mode === "auto" && (currentStatus.isDirty || currentStatus.ahead > 0))) {
    try {
      if (currentStatus.isDirty) {
        await execAsync('git add . && git commit -m "sync: update pi configurations from web"', {
          cwd: DOT_PI_DIR,
          timeout: 10000,
        });
      }
      await execAsync("git push origin main", {
        cwd: DOT_PI_DIR,
        timeout: 15000,
      });
      const newStatus = await getDotPiStatus();
      return {
        success: true,
        action: "pushed",
        message: "已将本地最新配置成功推送到 GitHub 远端",
        status: newStatus,
      };
    } catch (err) {
      throw new Error(`推送到云端失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: true,
    action: "none",
    message: "配置已是最新，无需同步",
    status: currentStatus,
  };
}
