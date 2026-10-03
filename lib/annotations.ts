/**
 * 预览批注（Preview Annotations）：数据结构、持久化与发送给 agent 的 prompt 构建。
 *
 * 设计要点（见 docs/adr/0007-preview-annotations.md）：
 * - 批注只保存在浏览器 localStorage，不写入被评审的文件；
 * - 锚定以「源码行号为主、引用文本为辅」，文件被外部改写后可用 quote 重新定位；
 * - 发送时构建一次性的结构化 prompt，交给 agent 定点修改源文件。
 *
 * 本文件只包含纯函数，便于 node:test 直接覆盖。
 */

export type AnnotationStatus = "draft" | "sent";

export interface PreviewAnnotation {
  id: string;
  /** 文件绝对路径，用于归属与去重。 */
  filePath: string;
  /** 相对 cwd 的路径，写进 prompt 让 agent 直接可用。 */
  relativePath: string;
  /** 源码行范围；Markdown 预览与源码模式都能给出，HTML 预览可能缺失。 */
  startLine?: number;
  endLine?: number;
  /** 用户选中的文本（渲染后的内容），用于消歧、重定位与 prompt 展示。 */
  quote: string;
  /** 选区前的上下文，重定位时消歧用。 */
  prefix?: string;
  /** 选区后的上下文，重定位时消歧用。 */
  suffix?: string;
  /** 用户的批注内容。 */
  note: string;
  status: AnnotationStatus;
  createdAt: number;
}

export const ANNOTATION_STORAGE_PREFIX = "pi-web:annotations";

/** 单文件 + 单会话的批注存储键。 */
export function annotationStorageKey(filePath: string, sessionId?: string | null): string {
  return `${ANNOTATION_STORAGE_PREFIX}:${sessionId ?? "-"}:${filePath}`;
}

export function createAnnotationId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return cryptoObject.randomUUID();
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 创建一条批注；id/status/createdAt 可注入，便于测试。 */
export function createAnnotation(
  input: Omit<PreviewAnnotation, "id" | "status" | "createdAt">
    & Partial<Pick<PreviewAnnotation, "id" | "status" | "createdAt">>,
): PreviewAnnotation {
  return {
    ...input,
    id: input.id ?? createAnnotationId(),
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? Date.now(),
  };
}

function isStoredAnnotation(value: unknown): value is PreviewAnnotation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreviewAnnotation>;
  return typeof candidate.id === "string"
    && typeof candidate.filePath === "string"
    && typeof candidate.note === "string"
    && typeof candidate.quote === "string";
}

/** 解析 localStorage 中的批注数组；任何损坏的数据都退回空数组（绝不抛异常）。 */
export function parseStoredAnnotations(raw: string | null | undefined): PreviewAnnotation[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAnnotation).map((annotation) => ({
      ...annotation,
      relativePath: annotation.relativePath ?? annotation.filePath,
      status: annotation.status === "sent" ? "sent" : "draft",
      createdAt: typeof annotation.createdAt === "number" ? annotation.createdAt : 0,
    }));
  } catch {
    return [];
  }
}

export function serializeAnnotations(annotations: readonly PreviewAnnotation[]): string {
  return JSON.stringify(annotations);
}

/** 有实际内容的批注才会进入 prompt（空批注只是误触）。 */
export function annotationsForPrompt(
  annotations: readonly PreviewAnnotation[],
): PreviewAnnotation[] {
  return annotations.filter((annotation) => annotation.note.trim().length > 0);
}

/** 行号范围文案，例如 `L12-L14`、`L7`，没有行号时回退为空字符串。 */
export function formatLineRange(
  annotation: Pick<PreviewAnnotation, "startLine" | "endLine">,
): string {
  const { startLine, endLine } = annotation;
  if (!Number.isInteger(startLine)) return "";
  if (!Number.isInteger(endLine) || endLine === startLine) return `L${startLine}`;
  return `L${startLine}-L${endLine}`;
}

/** UI 列表里的单行摘要：优先引文，其次行号。 */
export function summarizeAnnotation(
  annotation: Pick<PreviewAnnotation, "quote">
    & Partial<Pick<PreviewAnnotation, "startLine" | "endLine" | "filePath">>,
  maxLength = 48,
): string {
  const source = annotation.quote.trim()
    || formatLineRange(annotation)
    || annotation.filePath
    || "";
  const flattened = source.replace(/\s+/g, " ");
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength - 1)}…` : flattened;
}

function formatQuoteBlock(quote: string, indent: string): string {
  return quote.split("\n").map((line) => `${indent}> ${line}`).join("\n");
}

function formatContextLine(annotation: PreviewAnnotation): string | null {
  const { prefix, suffix } = annotation;
  const before = prefix?.trim();
  const after = suffix?.trim();
  if (!before && !after) return null;
  return `${before ?? ""}〈选中〉${after ?? ""}`;
}

export interface AnnotationPromptOptions {
  /** 会话工作目录，仅用于提示 agent 解析相对路径。 */
  cwd?: string | null;
}

/**
 * 构建发送给 agent 的批注 prompt。
 *
 * 约定（与 human-review 的 SKILL 规则一致）：
 * - 明确指出「定点修改、不要重写整个文件」；
 * - 行号为主、原文引用为辅，两者互相校验；
 * - 提醒引文来自渲染结果，可能与源码标记语法不完全一致。
 */
export function buildAnnotationPrompt(
  annotations: readonly PreviewAnnotation[],
  options: AnnotationPromptOptions = {},
): string {
  const pending = annotationsForPrompt(annotations);
  if (pending.length === 0) return "";

  const grouped = new Map<string, PreviewAnnotation[]>();
  for (const annotation of pending) {
    const key = annotation.relativePath || annotation.filePath;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(annotation);
    else grouped.set(key, [annotation]);
  }

  const lines: string[] = [];
  lines.push("请按以下批注修改文件（定点修改源文件，不要重写整个文件，也不要改动批注未涉及的段落）：");
  if (options.cwd) lines.push(`工作目录：${options.cwd}`);
  lines.push("");

  let index = 0;
  for (const [file, fileAnnotations] of grouped) {
    lines.push(`文件：${file}`);
    lines.push("");
    for (const annotation of fileAnnotations) {
      index += 1;
      const lineRange = formatLineRange(annotation);
      lines.push(lineRange ? `批注 ${index}（${lineRange}）` : `批注 ${index}（未取到行号，按引用文本定位）`);
      if (annotation.quote.trim()) {
        lines.push("  选中原文：");
        lines.push(formatQuoteBlock(annotation.quote.trim(), "  "));
      }
      const context = formatContextLine(annotation);
      if (context) lines.push(`  上下文：${context}`);
      lines.push(`  要求：${annotation.note.trim()}`);
      lines.push("");
    }
  }

  lines.push("注意：");
  lines.push("1. 批注引用的文本是「渲染后」的内容，可能与源文件里的标记语法不完全一致，请结合行号与上下文确认位置；");
  lines.push("2. 行号基于发送时的文件内容，若文件已被改动请先重新读取文件再定位；");
  lines.push("3. 完成后逐条说明改了什么，以及有没有无法处理的批注。");

  return lines.join("\n");
}
