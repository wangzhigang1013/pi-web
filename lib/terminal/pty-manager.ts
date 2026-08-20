import * as pty from "node-pty";
import { TerminalRingBuffer } from "./ring-buffer";
import type { WebSocket } from "ws";

export interface TerminalSession {
  id: string;
  cwd: string;
  ptyProcess: pty.IPty;
  buffer: TerminalRingBuffer;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  createdAt: number;
  lastActive: number;
}

class TerminalManager {
  private sessions = new Map<string, TerminalSession>();

  private getDefaultShell(): string {
    if (process.platform === "win32") {
      return process.env.COMSPEC || "powershell.exe";
    }
    return process.env.SHELL || "/bin/bash";
  }

  private getDefaultShellArgs(): string[] {
    if (process.platform === "win32") {
      const shell = this.getDefaultShell().toLowerCase();
      if (shell.includes("powershell") || shell.includes("pwsh")) {
        return ["-NoLogo"];
      }
    }
    return [];
  }

  getOrCreateSession(sessionId: string = "default", initialCwd?: string, cols: number = 80, rows: number = 24): TerminalSession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActive = Date.now();
      return existing;
    }

    const cwd = initialCwd || process.cwd();
    const shell = this.getDefaultShell();
    const args = this.getDefaultShellArgs();

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PI_WEB_TERMINAL: "1",
    };

    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: Math.max(10, cols || 80),
      rows: Math.max(5, rows || 24),
      cwd,
      env: env as Record<string, string>,
    });

    const buffer = new TerminalRingBuffer(500_000);
    const clients = new Set<WebSocket>();

    const session: TerminalSession = {
      id: sessionId,
      cwd,
      ptyProcess,
      buffer,
      clients,
      cols,
      rows,
      createdAt: Date.now(),
      lastActive: Date.now(),
    };

    ptyProcess.onData((data: string) => {
      buffer.write(data);
      session.lastActive = Date.now();
      const message = JSON.stringify({ type: "output", data });
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          try {
            client.send(message);
          } catch {
            // ignore send error on closing socket
          }
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const exitMsg = `\r\n[Process exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}]\r\n`;
      buffer.write(exitMsg);
      const message = JSON.stringify({ type: "exit", exitCode, signal });
      for (const client of clients) {
        if (client.readyState === 1) {
          try {
            client.send(message);
          } catch {
            // ignore
          }
        }
      }
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  attachClient(sessionId: string, ws: WebSocket, initialCols?: number, initialRows?: number, cwd?: string): TerminalSession {
    const session = this.getOrCreateSession(sessionId, cwd, initialCols, initialRows);
    session.clients.add(ws);
    session.lastActive = Date.now();

    if (initialCols && initialRows && (initialCols !== session.cols || initialRows !== session.rows)) {
      this.resize(sessionId, initialCols, initialRows);
    }

    // Replay buffer history immediately to newly attached client
    const history = session.buffer.getHistory();
    if (history.length > 0) {
      ws.send(JSON.stringify({ type: "history", data: history }));
    }

    return session;
  }

  detachClient(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients.delete(ws);
      session.lastActive = Date.now();
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
      session.lastActive = Date.now();
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && cols > 0 && rows > 0) {
      session.cols = cols;
      session.rows = rows;
      try {
        session.ptyProcess.resize(cols, rows);
      } catch (err) {
        console.warn(`[Terminal] Resize failed for session ${sessionId}:`, err);
      }
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId);
    }
  }

  restart(sessionId: string, cwd?: string, cols?: number, rows?: number): TerminalSession {
    this.kill(sessionId);
    return this.getOrCreateSession(sessionId, cwd, cols, rows);
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{ id: string; cwd: string; clientCount: number; createdAt: number }> {
    const result = [];
    for (const [id, s] of this.sessions.entries()) {
      result.push({
        id,
        cwd: s.cwd,
        clientCount: s.clients.size,
        createdAt: s.createdAt,
      });
    }
    return result;
  }
}

// Global singleton instance across Next.js reloads
declare global {
  // eslint-disable-next-line no-var
  var __pi_terminal_manager: TerminalManager | undefined;
}

export const terminalManager = globalThis.__pi_terminal_manager ?? (globalThis.__pi_terminal_manager = new TerminalManager());
