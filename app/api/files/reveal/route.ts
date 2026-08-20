import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { path?: string; isDir?: boolean; select?: boolean };
    const rawPath = body?.path?.trim();

    if (!rawPath) {
      return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    const resolvedPath = resolve(normalize(rawPath));

    let isDirectory = Boolean(body.isDir);
    try {
      const pathStat = await stat(resolvedPath);
      isDirectory = pathStat.isDirectory();
    } catch {
      // If file doesn't exist directly, check parent
      try {
        const parentPath = resolve(resolvedPath, "..");
        const parentStat = await stat(parentPath);
        if (!parentStat.isDirectory()) {
          return NextResponse.json({ error: "File or directory does not exist" }, { status: 404 });
        }
      } catch {
        return NextResponse.json({ error: "File or directory does not exist" }, { status: 404 });
      }
    }

    const shouldSelect = body.select ?? !isDirectory;

    if (process.platform === "win32") {
      const winPath = resolvedPath.replace(/\//g, "\\");
      const cmd = shouldSelect
        ? `explorer.exe /select,"${winPath}"`
        : `explorer.exe "${winPath}"`;

      // In Windows, exec dispatches through shell host (cmd /c) which is required for explorer.exe handoff
      exec(cmd, () => {
        // explorer.exe exits with code 1 by design in Windows after handing off window to Desktop Shell
      });
    } else if (process.platform === "darwin") {
      const args = shouldSelect ? ["-R", resolvedPath] : [resolvedPath];
      const child = spawn("open", args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      const target = isDirectory ? resolvedPath : resolve(resolvedPath, "..");
      const child = spawn("xdg-open", [target], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }

    return NextResponse.json({ success: true, path: resolvedPath, isDirectory });
  } catch (error) {
    console.error("[Reveal API] Failed to open path in explorer:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
