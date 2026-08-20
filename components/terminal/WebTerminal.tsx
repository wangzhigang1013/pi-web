"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface WebTerminalProps {
  sessionId?: string;
  cwd?: string;
  isActive?: boolean;
}

export function WebTerminal({ sessionId = "default", cwd, isActive = true }: WebTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>("正在连接终端服务...");

  // Send keystroke or custom string to shell
  const sendInput = useCallback((data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  // Send resize event
  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  // Restart shell
  const handleRestart = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (termInstance.current) {
        termInstance.current.clear();
        termInstance.current.writeln("\x1b[33m[正在重启终端会话...]\x1b[0m\r\n");
      }
      wsRef.current.send(JSON.stringify({
        type: "restart",
        cwd,
        cols: termInstance.current?.cols || 80,
        rows: termInstance.current?.rows || 24,
      }));
    } else {
      setReconnectCount((c) => c + 1);
    }
  }, [cwd]);

  // Clear terminal
  const handleClear = useCallback(() => {
    if (termInstance.current) {
      termInstance.current.clear();
    }
  }, []);

  // Initialize xterm.js instance
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "Consolas, 'Cascadia Code', 'Fira Code', 'Courier New', monospace",
      theme: {
        background: "#18181b", // zinc-900
        foreground: "#f4f4f5", // zinc-100
        cursor: "#38bdf8",     // sky-400
        cursorAccent: "#18181b",
        selectionBackground: "rgba(56, 189, 248, 0.3)",
        black: "#27272a",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#f4f4f5",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#fde047",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    try {
      fitAddon.fit();
    } catch {
      // ignore
    }

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      sendInput(data);
    });

    return () => {
      term.dispose();
      termInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [sendInput]);

  // Connect WebSocket
  useEffect(() => {
    let unmounted = false;
    let ws: WebSocket | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    const connect = async () => {
      try {
        setStatusMessage("正在获取终端服务端口...");
        let port: number = 30142;
        try {
          const res = await fetch("/api/terminal/info");
          if (res.ok) {
            const info = await res.json();
            if (info.port) port = info.port;
          } else {
            const currentPort = Number(window.location.port) || 30141;
            port = currentPort + 1;
          }
        } catch {
          const currentPort = Number(window.location.port) || 30141;
          port = currentPort + 1;
        }
        if (unmounted) return;
        const host = window.location.hostname || "127.0.0.1";
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        
        const queryParams = new URLSearchParams({
          sessionId: sessionId || "default",
          cols: String(termInstance.current?.cols || 80),
          rows: String(termInstance.current?.rows || 24),
        });
        if (cwd) {
          queryParams.set("cwd", cwd);
        }

        const wsUrl = `${protocol}//${host}:${port}/?${queryParams.toString()}`;
        setStatusMessage(`连接至 ws://${host}:${port}...`);

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (unmounted) return;
          setConnected(true);
          setStatusMessage("已连接");
          if (fitAddonRef.current && termInstance.current) {
            try {
              fitAddonRef.current.fit();
              sendResize(termInstance.current.cols, termInstance.current.rows);
            } catch {
              // ignore
            }
          }
          // Ping keep-alive
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 15000);
        };

        ws.onmessage = (event) => {
          if (unmounted || !termInstance.current) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "output" || msg.type === "history") {
              termInstance.current.write(msg.data);
            } else if (msg.type === "exit") {
              termInstance.current.writeln(`\r\n\x1b[31m[进程已退出 (代码: ${msg.exitCode})]\x1b[0m`);
            }
          } catch {
            termInstance.current.write(event.data);
          }
        };

        ws.onclose = () => {
          if (unmounted) return;
          setConnected(false);
          setStatusMessage("连接已断开");
          if (pingInterval) clearInterval(pingInterval);
        };

        ws.onerror = (err) => {
          if (unmounted) return;
          console.warn("[WebTerminal] WebSocket error:", err);
          setConnected(false);
          setStatusMessage("连接异常");
        };
      } catch (err) {
        if (unmounted) return;
        setStatusMessage(`连接失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void connect();

    return () => {
      unmounted = true;
      if (pingInterval) clearInterval(pingInterval);
      if (ws) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sessionId, cwd, reconnectCount, sendResize]);

  // Handle ResizeObserver & Visibility
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current || !termInstance.current) return;

    const fit = () => {
      if (!fitAddonRef.current || !termInstance.current || !isActive) return;
      try {
        fitAddonRef.current.fit();
        sendResize(termInstance.current.cols, termInstance.current.rows);
      } catch {
        // ignore
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly to allow DOM layout animation to settle
      requestAnimationFrame(fit);
    });

    resizeObserver.observe(terminalRef.current);

    if (isActive) {
      setTimeout(fit, 100);
      termInstance.current.focus();
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [isActive, sendResize]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "#18181b",
        color: "#f4f4f5",
        overflow: "hidden",
      }}
    >
      {/* Terminal Top Control Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          background: "#27272a",
          borderBottom: "1px solid #3f3f46",
          fontSize: 12,
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: connected ? "#22c55e" : "#ef4444",
            }}
            title={connected ? "已连接到终端" : "未连接"}
          />
          <span style={{ color: "#a1a1aa", fontSize: 11 }}>
            {connected ? (cwd ? `CWD: ${cwd}` : "终端运行中") : statusMessage}
          </span>
        </div>

        {/* Soft Keys & Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => sendInput("\x03")} // Ctrl+C
            title="发送 Ctrl+C (中断运行)"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Ctrl+C
          </button>
          <button
            type="button"
            onClick={() => sendInput("\t")} // Tab
            title="发送 Tab (自动补全)"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Tab
          </button>
          <button
            type="button"
            onClick={() => sendInput("\x1b[A")} // Up Arrow
            title="上一条历史命令 (↑)"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => sendInput("\x1b[B")} // Down Arrow
            title="下一条历史命令 (↓)"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="清空屏幕"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            清屏
          </button>
          <button
            type="button"
            onClick={handleRestart}
            title="重启终端进程"
            style={{
              padding: "2px 6px",
              background: "#3f3f46",
              border: "1px solid #52525b",
              borderRadius: 3,
              color: "#f4f4f5",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            重启
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          padding: "4px 6px",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
