import { NextRequest, NextResponse } from "next/server";
import { performRepoSync } from "@/lib/dotpi/sync-service";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      target?: "dot-pi" | "pi-web" | "all";
      mode?: "pull" | "push" | "auto";
    };
    const result = await performRepoSync(body.target || "all", body.mode || "auto");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
