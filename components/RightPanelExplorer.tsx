"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";

export interface RightPanelExplorerProps {
  cwd: string;
  onOpenFile: (
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff"; page?: number },
  ) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** 是否作为分栏子侧边栏呈现（更紧凑的边距与高度）。 */
  subpanel?: boolean;
  /** 折叠该子栏的回调（仅在 subpanel 模式下可用）。 */
  onCloseSubpanel?: () => void;
}

function ExplorerToolbarButton({
  onClick,
  title,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        borderRadius: 4,
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "color 0.15s, background 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={(event) => {
        if (!disabled && !active) {
          event.currentTarget.style.color = "var(--text)";
          event.currentTarget.style.background = "var(--bg-hover)";
        }
      }}
      onMouseLeave={(event) => {
        if (!disabled && !active) {
          event.currentTarget.style.color = "var(--text-muted)";
          event.currentTarget.style.background = "transparent";
        }
      }}
    >
      {children}
    </button>
  );
}

export function RightPanelExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  subpanel = false,
  onCloseSubpanel,
}: RightPanelExplorerProps) {
  const { t } = useI18n();
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setLocalRefreshKey((current) => current + 1);
    setRefreshDone(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 1800);
  }, []);

  const handleRevealInExplorer = useCallback(() => {
    if (!cwd) return;
    fetch("/api/files/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cwd, isDir: true }),
    }).catch(console.error);
  }, [cwd]);

  const folderName = getFileName(cwd) || cwd;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          minHeight: 32,
        }}
      >
        <span
          title={cwd}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            marginRight: 4,
            userSelect: "none",
          }}
        >
          {folderName}
        </span>

        {changesCount > 0 && (
          <ExplorerToolbarButton
            onClick={() => setChangesCollapsed((previous) => !previous)}
            title={t("sidebar.changedFiles", { count: changesCount })}
            active={!changesCollapsed}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M3 12h6" />
              <path d="M15 12h6" />
            </svg>
          </ExplorerToolbarButton>
        )}

        <ExplorerToolbarButton
          onClick={() => setFileSearchOpen((open) => !open)}
          title={t("sidebar.searchFiles")}
          active={fileSearchOpen}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
        </ExplorerToolbarButton>

        <ExplorerToolbarButton
          onClick={handleRevealInExplorer}
          title="在 Windows 资源管理器中打开项目文件夹"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <polyline points="14 11 18 15 14 19" />
          </svg>
        </ExplorerToolbarButton>

        <ExplorerToolbarButton
          onClick={() => fileExplorerRef.current?.openUploadPicker()}
          disabled={explorerUploadBusy}
          title={t("sidebar.uploadFilesTitle")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
        </ExplorerToolbarButton>

        <ExplorerToolbarButton
          onClick={handleRefresh}
          title={t("sidebar.refreshExplorer")}
          active={refreshDone}
        >
          {refreshDone ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </ExplorerToolbarButton>

        {subpanel && onCloseSubpanel && (
          <ExplorerToolbarButton
            onClick={onCloseSubpanel}
            title={t("files.hideExplorer")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </ExplorerToolbarButton>
        )}
      </div>

      {/* 文件目录树 */}
      <div className="scrollbar-subtle" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <FileExplorer
          ref={fileExplorerRef}
          cwd={cwd}
          onOpenFile={onOpenFile}
          refreshKey={(refreshKey ?? 0) + localRefreshKey}
          onAtMention={onAtMention}
          onAtMentions={onAtMentions}
          onUploadBusyChange={setExplorerUploadBusy}
          changesCollapsed={changesCollapsed}
          onChangesCountChange={setChangesCount}
          fileSearchOpen={fileSearchOpen}
          onFileSearchOpenChange={setFileSearchOpen}
        />
      </div>
    </div>
  );
}
