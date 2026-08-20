import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
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
      return NextResponse.json({ error: "File or directory does not exist" }, { status: 404 });
    }

    const shouldSelect = body.select ?? !isDirectory;

    if (process.platform === "win32") {
      const winPath = resolvedPath.replace(/\//g, "\\");
      if (shouldSelect) {
        const child = spawn("explorer.exe", [`/select,${winPath}`], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } else {
        const cmd = process.env.ComSpec || "cmd.exe";
        const child = spawn(cmd, ["/c", "start", "", winPath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }
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
