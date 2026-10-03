"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  annotationStorageKey,
  annotationsForPrompt,
  buildAnnotationPrompt,
  createAnnotation,
  formatLineRange,
  parseStoredAnnotations,
  serializeAnnotations,
  summarizeAnnotation,
  type PreviewAnnotation,
} from "@/lib/annotations";
import {
  enrichWithSourceContext,
  readSelectionSnapshot,
  type SelectionSnapshot,
} from "@/lib/annotation-anchor";

/**
 * 预览批注层（Canvas 浮动气泡 + Docs 正文高亮 + 右下角胶囊抽屉模式）：
 * 1. 划词时紧贴选区就地弹出 [📝 批注] 与输入卡片（视线零跳跃）；
 * 2. 批注保存后，正文对应代码行/段落自动持久高亮（浅金底色 + 左金条），点击高亮段落可直接激活对应批注；
 * 3. 移除居中遮挡黑条，改为右下角紧凑胶囊徽章 [📝 N 条批注]，点击滑出专属批注卡片抽屉，支持悬停预览与滚动定位；
 * 4. 支持快捷键：Ctrl+Enter 快速保存/发送，Esc 关闭。
 */
export interface PreviewAnnotationsProps {
  /** 选区与源码行号的根容器（FileViewer 的滚动内容容器）。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  filePath: string;
  relativePath: string;
  cwd?: string | null;
  sessionId?: string | null;
  /** 源文件文本，用于补全引文上下文。 */
  sourceText: string;
  /** 当前预览/源码模式是否允许批注（内容被截断时禁用）。 */
  enabled: boolean;
  /** 把构建好的 prompt 交给会话；缺省时只能查看/编辑批注，不能发送。 */
  onSendPrompt?: (prompt: string) => void;
  /** 点击批注时滚动定位（由 FileViewer 提供）。 */
  onRevealAnnotation?: (annotation: PreviewAnnotation) => void;
}

interface SelectionMarker {
  snapshot: SelectionSnapshot;
  top: number;
  left: number;
}

interface ComposerState {
  open: boolean;
  note: string;
  target: SelectionSnapshot | null;
  editingId: string | null;
  top: number;
  left: number;
  placement: "bottom" | "top";
}

const EMPTY_COMPOSER: ComposerState = {
  open: false,
  note: "",
  target: null,
  editingId: null,
  top: 0,
  left: 0,
  placement: "bottom",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function PreviewAnnotations({
  containerRef,
  filePath,
  relativePath,
  cwd,
  sessionId,
  sourceText,
  enabled,
  onSendPrompt,
  onRevealAnnotation,
}: PreviewAnnotationsProps) {
  const { t } = useI18n();
  const storageKey = annotationStorageKey(filePath, sessionId);
  const [annotations, setAnnotations] = useState<PreviewAnnotation[]>([]);
  const [marker, setMarker] = useState<SelectionMarker | null>(null);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [listExpanded, setListExpanded] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hydratedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 切换文件/会话时重新载入批注，并丢弃未提交的浮层状态。
  useEffect(() => {
    hydratedRef.current = false;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      stored = null;
    }
    setAnnotations(parseStoredAnnotations(stored));
    setComposer(EMPTY_COMPOSER);
    setMarker(null);
    setListExpanded(false);
    setActiveAnnotationId(null);
    hydratedRef.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, serializeAnnotations(annotations));
    } catch {
      // 存储不可用（隐私模式/配额满）时批注只保留在内存里。
    }
  }, [annotations, storageKey]);

  // 监听选区：只在批注可用、且编辑浮层未打开时更新浮标，避免编辑时选区漂移。
  useEffect(() => {
    if (!enabled || composer.open) return;
    const root = containerRef.current;
    if (!root) return;

    const update = () => {
      const snapshot = readSelectionSnapshot(root, window.getSelection());
      if (!snapshot) {
        setMarker(null);
        return;
      }
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setMarker({
        snapshot,
        top: rect ? clamp(rect.bottom + 8, 8, viewportHeight - 44) : 8,
        left: rect ? clamp(rect.left + rect.width / 2, 72, window.innerWidth - 72) : 72,
      });
    };

    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [containerRef, composer.open, enabled]);

  // 正文持久高亮渲染与点击联动
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // 清理之前的全部高亮标记
    const prevElements = root.querySelectorAll<HTMLElement>("[data-annotation-highlight]");
    prevElements.forEach((el) => {
      el.removeAttribute("data-annotation-highlight");
      el.removeAttribute("data-annotation-id");
      el.classList.remove("preview-annotation-block");
    });

    if (annotations.length === 0) return;

    annotations.forEach((annotation) => {
      if (!Number.isInteger(annotation.startLine)) return;
      const start = annotation.startLine!;
      const end = annotation.endLine ?? start;

      // 1. 源码模式：按 .file-source-line[data-line-number] 匹配行
      let matched = false;
      const codeLines = root.querySelectorAll<HTMLElement>(".file-source-line[data-line-number]");
      if (codeLines.length > 0) {
        codeLines.forEach((lineEl) => {
          const lineNum = Number(lineEl.getAttribute("data-line-number"));
          if (lineNum >= start && lineNum <= end) {
            lineEl.setAttribute("data-annotation-highlight", annotation.status);
            lineEl.setAttribute("data-annotation-id", annotation.id);
            lineEl.classList.add("preview-annotation-block");
            matched = true;
          }
        });
      }

      // 2. Markdown 预览模式：匹配 rehypeSourceLines 注入的 block 元素
      if (!matched) {
        let blockEl = root.querySelector<HTMLElement>(`[data-src-start="${start}"]`);
        if (!blockEl) {
          const allBlocks = root.querySelectorAll<HTMLElement>("[data-src-start]");
          for (let i = 0; i < allBlocks.length; i++) {
            const b = allBlocks[i];
            const s = Number(b.getAttribute("data-src-start"));
            const e = Number(b.getAttribute("data-src-end") || s);
            if (start >= s && start <= e) {
              blockEl = b;
              break;
            }
          }
        }
        if (blockEl) {
          blockEl.setAttribute("data-annotation-highlight", annotation.status);
          blockEl.setAttribute("data-annotation-id", annotation.id);
          blockEl.classList.add("preview-annotation-block");
        }
      }
    });

    // 点击正文高亮块，展开抽屉并定位到对应卡片
    const handleBlockClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-annotation-id]");
      if (!target) return;
      const annId = target.getAttribute("data-annotation-id");
      if (!annId) return;

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      setListExpanded(true);
      setActiveAnnotationId(annId);
    };

    root.addEventListener("click", handleBlockClick);
    return () => {
      root.removeEventListener("click", handleBlockClick);
      const elements = root.querySelectorAll<HTMLElement>("[data-annotation-highlight]");
      elements.forEach((el) => {
        el.removeAttribute("data-annotation-highlight");
        el.removeAttribute("data-annotation-id");
        el.classList.remove("preview-annotation-block");
      });
    };
  }, [annotations, containerRef]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!composer.open) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
  }, [composer.open]);

  // 打开就地编辑气泡（根据选区自适应弹出）
  const openComposerForSelection = useCallback(() => {
    if (!marker) return;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const composerWidth = 320;
    const composerHeight = 160;

    let placement: "bottom" | "top" = "bottom";
    let top = marker.top + 8;
    if (top + composerHeight > viewportHeight - 20) {
      placement = "top";
      top = Math.max(16, marker.top - composerHeight - 36);
    }
    const left = clamp(marker.left, composerWidth / 2 + 16, viewportWidth - composerWidth / 2 - 16);

    setComposer({
      open: true,
      note: "",
      target: enrichWithSourceContext(sourceText, marker.snapshot),
      editingId: null,
      top,
      left,
      placement,
    });
    setMarker(null);
  }, [marker, sourceText]);

  // 重新编辑已有批注（定位到正文对应元素附近打开气泡）
  const openComposerForAnnotation = useCallback((annotation: PreviewAnnotation) => {
    const root = containerRef.current;
    let top = window.innerHeight / 2 - 80;
    let left = window.innerWidth / 2;
    let placement: "bottom" | "top" = "bottom";

    if (root && Number.isInteger(annotation.startLine)) {
      const el = root.querySelector<HTMLElement>(
        `[data-src-start="${annotation.startLine}"], [data-line-number="${annotation.startLine}"]`,
      );
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom + 170 > window.innerHeight - 20) {
          placement = "top";
          top = Math.max(16, rect.top - 180);
        } else {
          top = rect.bottom + 8;
        }
        left = clamp(rect.left + 160, 170, window.innerWidth - 170);
      }
    }

    setComposer({
      open: true,
      note: annotation.note,
      target: {
        quote: annotation.quote,
        prefix: annotation.prefix ?? "",
        suffix: annotation.suffix ?? "",
        startLine: annotation.startLine,
        endLine: annotation.endLine,
      },
      editingId: annotation.id,
      top,
      left,
      placement,
    });
  }, [containerRef]);

  const closeComposer = useCallback(() => {
    setComposer(EMPTY_COMPOSER);
    window.getSelection()?.removeAllRanges();
  }, []);

  const saveComposer = useCallback(() => {
    const note = composer.note.trim();
    const target = composer.target;
    if (!note || !target) return;

    if (composer.editingId) {
      const editingId = composer.editingId;
      setAnnotations((previous) => previous.map((annotation) => (
        annotation.id === editingId ? { ...annotation, note, status: "draft" } : annotation
      )));
    } else {
      const newAnn = createAnnotation({
        filePath,
        relativePath,
        startLine: target.startLine,
        endLine: target.endLine,
        quote: target.quote,
        prefix: target.prefix,
        suffix: target.suffix,
        note,
      });
      setAnnotations((previous) => [...previous, newAnn]);
      setActiveAnnotationId(newAnn.id);
    }
    closeComposer();
  }, [closeComposer, composer.editingId, composer.note, composer.target, filePath, relativePath]);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id));
    if (activeAnnotationId === id) setActiveAnnotationId(null);
  }, [activeAnnotationId]);

  const pending = useMemo(
    () => annotationsForPrompt(annotations).filter((annotation) => annotation.status === "draft"),
    [annotations],
  );
  const hasAnnotations = annotations.length > 0;

  const sendAnnotations = useCallback(() => {
    if (pending.length === 0) return;
    if (!onSendPrompt) {
      setNotice(t("annotations.sendUnavailable"));
      return;
    }
    const prompt = buildAnnotationPrompt(pending, { cwd });
    if (!prompt) return;
    onSendPrompt(prompt);
    const sentIds = new Set(pending.map((annotation) => annotation.id));
    setAnnotations((previous) => previous.map((annotation) => (
      sentIds.has(annotation.id) ? { ...annotation, status: "sent" } : annotation
    )));
    setNotice(t("annotations.sent", { count: pending.length }));
    setListExpanded(false);
  }, [cwd, onSendPrompt, pending, t]);

  if (!enabled && !hasAnnotations) return null;

  return (
    <>
      {/* 1. 选区紧贴浮标按钮 */}
      {marker && enabled && !composer.open && (
        <div
          className="preview-annotation-marker"
          style={{
            position: "fixed",
            top: marker.top,
            left: marker.left,
            transform: "translateX(-50%)",
            zIndex: 45,
          }}
        >
          <button
            type="button"
            className="preview-annotation-button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={openComposerForSelection}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            {t("annotations.add")}
          </button>
        </div>
      )}

      {/* 2. 就地弹出输入卡片（Popover Anchor，紧贴选区） */}
      {composer.open && (
        <div
          className="preview-annotation-composer"
          style={{
            position: "fixed",
            top: composer.top,
            left: composer.left,
            transform: "translateX(-50%)",
            width: 320,
            zIndex: 46,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-panel)",
            boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
            padding: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>
              {composer.target && (formatLineRange(composer.target) || t("annotations.noLineRange"))}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {composer.target?.quote ? summarizeAnnotation({ quote: composer.target.quote }) : ""}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            value={composer.note}
            onChange={(event) => setComposer((current) => ({ ...current, note: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                closeComposer();
                return;
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                saveComposer();
              }
            }}
            placeholder={t("annotations.placeholder")}
            rows={3}
            style={{
              width: "100%",
              resize: "vertical",
              font: "inherit",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--text)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("annotations.hint")}</span>
            <button
              type="button"
              className="preview-annotation-button"
              disabled={!composer.note.trim()}
              onClick={saveComposer}
              style={{ marginLeft: "auto", padding: "4px 12px" }}
            >
              {t("annotations.save")}
            </button>
            <button type="button" className="preview-annotation-button is-ghost" onClick={closeComposer} style={{ padding: "4px 8px" }}>
              {t("annotations.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* 3. 右下角收敛胶囊 + 侧滑卡片抽屉 */}
      {hasAnnotations && (
        <>
          {/* 胶囊操作条（右下角） */}
          <div
            className="preview-annotation-capsule"
            style={{
              position: "fixed",
              right: 28,
              bottom: 24,
              zIndex: 44,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px 4px 10px",
              borderRadius: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
              fontSize: 12,
            }}
          >
            <button
              type="button"
              onClick={() => setListExpanded((prev) => !prev)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: "var(--text)",
                cursor: "pointer",
                padding: "3px 6px",
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 500,
              }}
              title="展开/收起批注抽屉"
            >
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: pending.length > 0 ? "#f59e0b" : "#22c55e",
                  flexShrink: 0,
                }}
              />
              <span>{t("annotations.listTitle", { count: annotations.length })}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: listExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
                aria-hidden="true"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>

            <button
              type="button"
              className="preview-annotation-button"
              disabled={pending.length === 0}
              onClick={sendAnnotations}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 12,
              }}
              title="发送待修改批注给 Agent (Ctrl+Enter)"
            >
              {t("annotations.send", { count: pending.length })}
            </button>
          </div>

          {/* 向上浮出的批注卡片抽屉 */}
          {listExpanded && (
            <div
              className="preview-annotation-drawer"
              style={{
                position: "fixed",
                right: 28,
                bottom: 68,
                width: 320,
                maxHeight: "calc(100vh - 120px)",
                display: "flex",
                flexDirection: "column",
                zIndex: 44,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-panel)",
                boxShadow: "0 14px 38px rgba(0,0,0,0.26)",
                overflow: "hidden",
              }}
            >
              {/* 抽屉顶栏 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-selected)",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {t("annotations.listTitle", { count: annotations.length })}
                </span>
                <button
                  type="button"
                  className="preview-annotation-link"
                  onClick={() => setAnnotations([])}
                  style={{ color: "var(--text-dim)", fontSize: 11 }}
                >
                  {t("annotations.clear")}
                </button>
              </div>

              {/* 抽屉卡片列表 */}
              <div
                className="scrollbar-subtle"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {annotations.map((annotation, index) => {
                  const isActive = activeAnnotationId === annotation.id;
                  return (
                    <div
                      key={annotation.id}
                      onMouseEnter={() => {
                        if (onRevealAnnotation) onRevealAnnotation(annotation);
                      }}
                      style={{
                        border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "8px",
                        background: annotation.status === "sent" ? "var(--bg-subtle)" : "var(--bg)",
                        boxShadow: isActive ? "0 0 0 2px rgba(var(--accent-rgb, 99, 102, 241), 0.2)" : "none",
                        transition: "border-color 0.15s, box-shadow 0.15s",
                      }}
                    >
                      {/* 卡片头部：序号、行号、状态 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>{`#${index + 1}`}</span>
                        <span style={{ color: "var(--accent)" }}>
                          {formatLineRange(annotation) || t("annotations.noLineRange")}
                        </span>
                        {annotation.status === "sent" && (
                          <span style={{ marginLeft: "auto", color: "#22c55e", fontSize: 10 }}>
                            {t("annotations.sentBadge")}
                          </span>
                        )}
                      </div>

                      {/* 卡片引文引用条 */}
                      {annotation.quote && (
                        <div
                          style={{
                            margin: "4px 0",
                            padding: "2px 6px",
                            borderLeft: "2px solid #f59e0b",
                            background: "rgba(245, 158, 11, 0.08)",
                            fontSize: 11,
                            color: "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={annotation.quote}
                        >
                          {annotation.quote}
                        </div>
                      )}

                      {/* 批注说明文字 */}
                      <div style={{ fontSize: 12, color: "var(--text)", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                        {annotation.note}
                      </div>

                      {/* 卡片操作按钮条 */}
                      <div style={{ display: "flex", gap: 8, marginTop: 6, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
                        {onRevealAnnotation && (
                          <button
                            type="button"
                            className="preview-annotation-link"
                            onClick={() => {
                              setActiveAnnotationId(annotation.id);
                              onRevealAnnotation(annotation);
                            }}
                          >
                            {t("annotations.reveal")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="preview-annotation-link"
                          onClick={() => openComposerForAnnotation(annotation)}
                        >
                          {t("annotations.edit")}
                        </button>
                        <button
                          type="button"
                          className="preview-annotation-link"
                          onClick={() => removeAnnotation(annotation.id)}
                          style={{ marginLeft: "auto", color: "var(--text-dim)" }}
                        >
                          {t("annotations.remove")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 状态轻提示 */}
      {notice && (
        <div
          className="preview-annotation-notice"
          style={{
            position: "fixed",
            right: 28,
            bottom: 74,
            zIndex: 47,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
            fontSize: 11,
          }}
        >
          {notice}
        </div>
      )}
    </>
  );
}
