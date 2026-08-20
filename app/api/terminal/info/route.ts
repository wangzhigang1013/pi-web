import { NextResponse } from "next/server";
import { ensureTerminalServer } from "@/lib/terminal/server";
import { terminalManager } from "@/lib/terminal/pty-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const port = await ensureTerminalServer();
    const sessions = terminalManager.listSessions();

    return NextResponse.json({
      status: "ok",
      port,
      sessions,
    });
  } catch (error) {
    console.error("[Terminal API] Failed to ensure terminal server:", error);
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
