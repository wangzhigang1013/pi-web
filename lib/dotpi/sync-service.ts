import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface RepoStatus {
  id: "dot-pi" | "pi-web";
  name: string;
  path: string;
  isGitRepo: boolean;
  ahead: number;
  behind: number;
  isDirty: boolean;
  dirtyFiles: string[];
  lastCommit?: string;
  remoteUrl?: string;
  error?: string;
}

export interface UnifiedSyncStatus {
  dotPi: RepoStatus;
  piWeb: RepoStatus;
  hasCloudUpdates: boolean;
  hasLocalChanges: boolean;
  totalBehind: number;
  totalAhead: number;
  lastCheckedAt: number;
}

const DOT_PI_DIR = join(homedir(), ".pi");
const PI_WEB_DIR = join(homedir(), "pi-web");

async function checkSingleRepo(id: "dot-pi" | "pi-web", name: string, dir: string): Promise<RepoStatus> {
  const dotGitDir = join(dir, ".git");
  if (!existsSync(dotGitDir)) {
    return {
      id,
      name,
      path: dir,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      isDirty: false,
      dirtyFiles: [],
    };
  }

  try {
    // 1. Fetch silently from origin
    try {
      await execAsync("git fetch --quiet origin", {
        cwd: dir,
        timeout: 8000,
      });
    } catch {
      // Offline or remote timeout, proceed with local comparison
    }

    // 2. Check local uncommitted changes
    const { stdout: statusOut } = await execAsync("git status --porcelain", {
      cwd: dir,
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
        { cwd: dir, timeout: 5000 }
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
        cwd: dir,
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
        cwd: dir,
        timeout: 3000,
      });
      remoteUrl = remoteOut.trim();
    } catch {
      // ignore
    }

    return {
      id,
      name,
      path: dir,
      isGitRepo: true,
      ahead,
      behind,
      isDirty,
      dirtyFiles,
      lastCommit,
      remoteUrl,
    };
  } catch (err) {
    return {
      id,
      name,
      path: dir,
      isGitRepo: true,
      ahead: 0,
      behind: 0,
      isDirty: false,
      dirtyFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getUnifiedSyncStatus(): Promise<UnifiedSyncStatus> {
  const [dotPi, piWeb] = await Promise.all([
    checkSingleRepo("dot-pi", "dot-pi (配置与技能库)", DOT_PI_DIR),
    checkSingleRepo("pi-web", "pi-web (前端交互系统)", PI_WEB_DIR),
  ]);

  const hasCloudUpdates = dotPi.behind > 0 || piWeb.behind > 0;
  const hasLocalChanges = dotPi.isDirty || dotPi.ahead > 0 || piWeb.isDirty || piWeb.ahead > 0;
  const totalBehind = dotPi.behind + piWeb.behind;
  const totalAhead = dotPi.ahead + piWeb.ahead;

  return {
    dotPi,
    piWeb,
    hasCloudUpdates,
    hasLocalChanges,
    totalBehind,
    totalAhead,
    lastCheckedAt: Date.now(),
  };
}

export async function performRepoSync(
  target: "dot-pi" | "pi-web" | "all" = "all",
  mode: "pull" | "push" | "auto" = "auto"
): Promise<{
  success: boolean;
  results: Array<{ repo: string; action: string; message: string }>;
  status: UnifiedSyncStatus;
}> {
  const results: Array<{ repo: string; action: string; message: string }> = [];

  const syncDir = async (repoName: string, dir: string) => {
    const status = await checkSingleRepo(repoName as "dot-pi" | "pi-web", repoName, dir);
    if (!status.isGitRepo) return;

    if (mode === "pull" || (mode === "auto" && status.behind > 0 && !status.isDirty)) {
      await execAsync("git pull --rebase origin main", { cwd: dir, timeout: 20000 });
      results.push({ repo: repoName, action: "pulled", message: `成功拉取云端 ${status.behind} 个更新` });
      return;
    }

    if (mode === "push" || (mode === "auto" && (status.isDirty || status.ahead > 0))) {
      if (status.isDirty) {
        await execAsync(`git add . && git commit -m "sync: update ${repoName} from cloud sync button"`, {
          cwd: dir,
          timeout: 10000,
        });
      }
      await execAsync("git push origin main", { cwd: dir, timeout: 20000 });
      results.push({ repo: repoName, action: "pushed", message: "已推送到 GitHub 远端" });
      return;
    }

    results.push({ repo: repoName, action: "none", message: "已是最新状态" });
  };

  if (target === "dot-pi" || target === "all") {
    await syncDir("dot-pi", DOT_PI_DIR);
  }
  if (target === "pi-web" || target === "all") {
    await syncDir("pi-web", PI_WEB_DIR);
  }

  const updatedStatus = await getUnifiedSyncStatus();
  return {
    success: true,
    results,
    status: updatedStatus,
  };
}
