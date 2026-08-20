import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve, normalize, basename } from "node:path";
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
      const escaped = winPath.replace(/'/g, "''");
      const leafName = basename(resolvedPath).replace(/'/g, "''");

      const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Foreground {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@ -ErrorAction SilentlyContinue

$path = '${escaped}'
if ('${shouldSelect}' -eq 'true') {
    Start-Process explorer.exe -ArgumentList @("/select,$path")
} else {
    Start-Process explorer.exe -ArgumentList @($path)
}

Start-Sleep -Milliseconds 200

$ws = New-Object -ComObject WScript.Shell
$ws.AppActivate('File Explorer') | Out-Null
$ws.AppActivate('文件资源管理器') | Out-Null
if ('${leafName}') {
    $ws.AppActivate('${leafName}') | Out-Null
}

$explorers = Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($exp in $explorers) {
    [Win32Foreground]::ShowWindow($exp.MainWindowHandle, 9) | Out-Null
    [Win32Foreground]::SwitchToThisWindow($exp.MainWindowHandle, $true) | Out-Null
    [Win32Foreground]::SetForegroundWindow($exp.MainWindowHandle) | Out-Null
}
`;

      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
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
