import { WebSocketServer, WebSocket } from "ws";
import { terminalManager } from "./pty-manager";
import type { IncomingMessage } from "http";
import { URL } from "url";

declare global {
  // eslint-disable-next-line no-var
  var __pi_terminal_wss: WebSocketServer | undefined;
  // eslint-disable-next-line no-var
  var __pi_terminal_port: number | undefined;
}

export function getTerminalPort(): number | undefined {
  return globalThis.__pi_terminal_port;
}

export async function ensureTerminalServer(preferredPort?: number): Promise<number> {
  if (globalThis.__pi_terminal_wss && globalThis.__pi_terminal_port) {
    return globalThis.__pi_terminal_port;
  }

  const basePort = preferredPort || Number(process.env.PI_WEB_TERMINAL_PORT) || (Number(process.env.PORT || 30141) + 1);

  return new Promise<number>((resolve, reject) => {
    let port = basePort;
    const maxTries = 10;
    let tries = 0;

    const tryListen = () => {
      const wss = new WebSocketServer({ port, host: process.env.PI_WEB_HOSTNAME || "127.0.0.1" }, () => {
        globalThis.__pi_terminal_wss = wss;
        globalThis.__pi_terminal_port = port;
        console.log(`[Terminal] WebSocket server listening on port ${port}`);
        setupWss(wss);
        resolve(port);
      });

      wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && tries < maxTries) {
          tries++;
          port++;
          tryListen();
        } else {
          reject(err);
        }
      });
    };

    tryListen();
  });
}

function setupWss(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const sessionId = parsedUrl.searchParams.get("sessionId") || "default";
    const initialCwd = parsedUrl.searchParams.get("cwd") || undefined;
    const cols = parseInt(parsedUrl.searchParams.get("cols") || "80", 10);
    const rows = parseInt(parsedUrl.searchParams.get("rows") || "24", 10);

    // Attach client to PTY session (auto-creates if needed and replays history)
    terminalManager.attachClient(sessionId, ws, cols, rows, initialCwd);

    ws.on("message", (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const msg = JSON.parse(text) as {
          type: string;
          data?: string;
          cols?: number;
          rows?: number;
          cwd?: string;
        };

        if (msg.type === "input" && typeof msg.data === "string") {
          terminalManager.write(sessionId, msg.data);
        } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
          terminalManager.resize(sessionId, msg.cols, msg.rows);
        } else if (msg.type === "restart") {
          terminalManager.restart(sessionId, msg.cwd, msg.cols, msg.rows);
          // Re-attach to give clean stream
          terminalManager.attachClient(sessionId, ws, msg.cols, msg.rows, msg.cwd);
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (err) {
        console.warn("[Terminal] Invalid message from client:", err);
      }
    });

    ws.on("close", () => {
      terminalManager.detachClient(sessionId, ws);
    });

    ws.on("error", (err) => {
      console.warn(`[Terminal] Client socket error (${sessionId}):`, err);
      terminalManager.detachClient(sessionId, ws);
    });
  });
}
