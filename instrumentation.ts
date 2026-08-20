export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  try {
    const { ensureTerminalServer } = await import("@/lib/terminal/server");
    await ensureTerminalServer();
  } catch (err) {
    console.warn("[Terminal] Failed to start terminal server on startup:", err);
  }
}
