import { NextResponse } from "next/server";
import { backgroundTasks } from "@/lib/background-tasks";

export async function GET() {
  const servers = await backgroundTasks.refresh();
  return NextResponse.json({ servers });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "kill" | "killAll" | "abortBash" | "refresh";
      port?: number;
      sessionId?: string;
    };

    if (body.action === "kill" && typeof body.port === "number") {
      const success = backgroundTasks.killOne(body.port);
      const servers = await backgroundTasks.refresh();
      return NextResponse.json({ success, servers });
    }

    if (body.action === "killAll") {
      const killed = backgroundTasks.killAll();
      const servers = await backgroundTasks.refresh();
      return NextResponse.json({ success: true, killed, servers });
    }

    if (body.action === "abortBash" && body.sessionId) {
      const stopped = backgroundTasks.abortActiveBash(body.sessionId);
      return NextResponse.json({ success: stopped });
    }

    const servers = await backgroundTasks.refresh();
    return NextResponse.json({ success: true, servers });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 },
    );
  }
}
