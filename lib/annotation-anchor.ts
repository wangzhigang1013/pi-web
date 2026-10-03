/**
 * 批注锚定：把浏览器选区映射回源码位置，并在文件被外部改写后重新定位。
 *
 * 锚定策略（与 W3C Web Annotation 的 TextQuoteSelector 同构）：
 * - 主锚点：源码行号（Markdown 预览由 rehype 插件写入 data-src-start/end，源码模式用 data-line-number）；
 * - 副锚点：quote + prefix + suffix，用于消歧与失效后的重定位。
 *
 * 纯文本函数可单测；DOM 函数只依赖标准 DOM 接口。
 */

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface QuoteAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface QuoteMatch extends QuoteAnchor {
  /** 命中位置在源码中的字符偏移。 */
  index: number;
}

/** 引文前后各取多少个字符作为上下文。 */
export const ANCHOR_CONTEXT_CHARS = 40;

/** 把字符偏移映射为 1 起始的行号范围。 */
export function lineRangeFromOffsets(
  sourceText: string,
  startOffset: number,
  endOffset: number,
): LineRange {
  const length = sourceText.length;
  const start = Math.max(0, Math.min(startOffset, length));
  const end = Math.max(start, Math.min(endOffset, length));

  let startLine = 1;
  for (let index = 0; index < start; index++) {
    if (sourceText[index] === "\n") startLine += 1;
  }

  let endLine = startLine;
  for (let index = start; index < end; index++) {
    if (sourceText[index] === "\n") endLine += 1;
  }

  return { startLine, endLine };
}

/** 第 line 行在源码中的起始字符偏移（1 起始）。 */
export function offsetAtLine(sourceText: string, line: number): number {
  if (line <= 1) return 0;
  let currentLine = 1;
  for (let index = 0; index < sourceText.length; index++) {
    if (sourceText[index] !== "\n") continue;
    currentLine += 1;
    if (currentLine === line) return index + 1;
  }
  return sourceText.length;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CandidateMatch {
  index: number;
  /** 折叠空白匹配时，命中的原始文本长度。 */
  length: number;
}

function findMatches(sourceText: string, quote: string): CandidateMatch[] {
  if (!quote) return [];
  const matches: CandidateMatch[] = [];
  let cursor = sourceText.indexOf(quote);
  while (cursor !== -1) {
    matches.push({ index: cursor, length: quote.length });
    cursor = sourceText.indexOf(quote, cursor + Math.max(1, quote.length));
  }
  if (matches.length > 0) return matches;

  // 渲染后的文本会折叠或拆分连续空白（换行、多余空格），这里用「空白宽松」正则兜底：
  // 先允许一个以上空白（源里有换行、引文里是空格），再退到可有可无。
  const words = quote.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return [];
  for (const quantifier of ["\\s+", "\\s*"]) {
    const pattern = new RegExp(words.join(quantifier), "g");
    const loose: CandidateMatch[] = [];
    for (const match of sourceText.matchAll(pattern)) {
      if (match.index === undefined) continue;
      loose.push({ index: match.index, length: match[0].length });
    }
    if (loose.length > 0) return loose;
  }
  return [];
}

/** 在源码中查找引文，并连带取出前后上下文。优先从 hintOffset（通常由行号换算）附近开始找。 */
export function contextForQuote(
  sourceText: string,
  quote: string,
  options: { hintOffset?: number; contextChars?: number } = {},
): QuoteMatch | null {
  const contextChars = options.contextChars ?? ANCHOR_CONTEXT_CHARS;
  const matches = findMatches(sourceText, quote);
  if (matches.length === 0) return null;

  const hint = options.hintOffset;
  const best = typeof hint === "number" && Number.isFinite(hint)
    ? matches.reduce((closest, candidate) => (
      Math.abs(candidate.index - hint) < Math.abs(closest.index - hint) ? candidate : closest
    ))
    : matches[0];

  const start = best.index;
  const end = best.index + best.length;
  return {
    index: start,
    quote: sourceText.slice(start, end),
    prefix: sourceText.slice(Math.max(0, start - contextChars), start),
    suffix: sourceText.slice(end, Math.min(sourceText.length, end + contextChars)),
  };
}

function scoreByContext(sourceText: string, anchor: QuoteAnchor, match: CandidateMatch): number {
  let score = 0;
  const prefix = collapseWhitespace(anchor.prefix ?? "");
  const suffix = collapseWhitespace(anchor.suffix ?? "");
  const before = collapseWhitespace(sourceText.slice(Math.max(0, match.index - prefix.length * 2), match.index));
  const after = collapseWhitespace(sourceText.slice(match.index + match.length, match.index + match.length + suffix.length * 2));
  if (prefix && before.endsWith(prefix)) score += 2;
  else if (prefix && before.includes(prefix.slice(-Math.max(4, prefix.length / 2)))) score += 1;
  if (suffix && after.startsWith(suffix)) score += 2;
  else if (suffix && after.includes(suffix.slice(0, Math.max(4, suffix.length / 2)))) score += 1;
  return score;
}

/**
 * 文件内容变化后，用 quote + prefix + suffix 重新定位批注。
 * 返回 null 表示目标文本已经不存在（UI 应提示用户人工确认）。
 */
export function relocateQuote(sourceText: string, anchor: QuoteAnchor): LineRange | null {
  const quote = anchor.quote ?? "";
  if (!quote.trim()) return null;

  const matches = findMatches(sourceText, quote);
  if (matches.length === 0) return null;

  let best = matches[0];
  if (matches.length > 1) {
    let bestScore = -1;
    for (const candidate of matches) {
      const score = scoreByContext(sourceText, anchor, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return lineRangeFromOffsets(sourceText, best.index, best.index + best.length);
}

/**
 * 从 DOM 节点向上找最近的块级行号容器：
 * - Markdown 预览：rehype 注入的 `[data-src-start]`；
 * - 源码模式：每行的 `[data-line-number]`。
 */
export function closestLineRangeFromDom(node: Node | null, root: HTMLElement | null): LineRange | null {
  if (!node || !root) return null;
  const element = node.nodeType === 1 /* Node.ELEMENT_NODE */
    ? node as Element
    : node.parentElement;
  if (!element || !root.contains(element)) return null;

  const sourceBlock = element.closest<HTMLElement>("[data-src-start]");
  if (sourceBlock && root.contains(sourceBlock)) {
    const startLine = Number(sourceBlock.dataset.srcStart);
    const endLine = Number(sourceBlock.dataset.srcEnd);
    if (Number.isInteger(startLine)) {
      return { startLine, endLine: Number.isInteger(endLine) ? endLine : startLine };
    }
  }

  const singleLine = element.closest<HTMLElement>("[data-line-number]");
  const lineNumber = singleLine ? Number(singleLine.dataset.lineNumber) : Number.NaN;
  if (Number.isInteger(lineNumber)) return { startLine: lineNumber, endLine: lineNumber };

  return null;
}

export interface SelectionSnapshot extends QuoteAnchor {
  startLine?: number;
  endLine?: number;
}

/** 读取当前选区的引文、上下文与源码行范围；选区不在 root 内或为空时返回 null。 */
export function readSelectionSnapshot(
  root: HTMLElement | null,
  selection: Selection | null,
): SelectionSnapshot | null {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const text = selection.toString();
  if (!text.trim()) return null;

  const startLineRange = closestLineRangeFromDom(range.startContainer, root);
  const endLineRange = closestLineRangeFromDom(range.endContainer, root);
  const snapshot: SelectionSnapshot = {
    quote: text,
    prefix: "",
    suffix: "",
  };
  if (startLineRange && endLineRange) {
    snapshot.startLine = Math.min(startLineRange.startLine, endLineRange.startLine);
    snapshot.endLine = Math.max(startLineRange.endLine, endLineRange.endLine);
  }
  return snapshot;
}

/** 用渲染后的选区文本在源码里补全上下文（前缀/后缀），失败时保留空上下文。 */
export function enrichWithSourceContext(
  sourceText: string,
  snapshot: SelectionSnapshot,
): SelectionSnapshot {
  if (!sourceText || !snapshot.quote.trim()) return snapshot;
  if (snapshot.prefix || snapshot.suffix) return snapshot;
  const hintOffset = Number.isInteger(snapshot.startLine)
    ? offsetAtLine(sourceText, snapshot.startLine as number)
    : undefined;
  const match = contextForQuote(sourceText, snapshot.quote, { hintOffset });
  if (!match) return snapshot;
  return {
    ...snapshot,
    quote: match.quote,
    prefix: match.prefix,
    suffix: match.suffix,
    ...(Number.isInteger(snapshot.startLine) ? {} : lineRangeFromOffsets(sourceText, match.index, match.index + match.quote.length)),
  };
}
