"use client";

import { useState, useCallback, useRef } from "react";
import type { DroppedItem } from "@/lib/file-upload-client";

export interface DragPathPayload {
  type?: string;
  path: string;
  fullPath?: string;
  name?: string;
  isDir?: boolean;
}

export type DragDropOptions =
  | ((items: DroppedItem[]) => void)
  | {
      onDropItems?: (items: DroppedItem[]) => void;
      onDropFiles?: (files: File[]) => void;
      onDropPath?: (data: DragPathPayload) => void;
    };

function hasDraggedFiles(e: React.DragEvent): boolean {
  if (e.dataTransfer.types.includes("application/x-pi-web-path")) return true;
  if (e.dataTransfer.types.includes("Files")) return true;
  return Array.from(e.dataTransfer.items).some(
    (item) => item.kind === "file" || item.type.startsWith("image/") || item.type === "application/x-pi-web-path"
  );
}

function droppedItems(dataTransfer: DataTransfer): DroppedItem[] {
  const items: DroppedItem[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      items.push({ kind: "folder", name: entry.name });
      continue;
    }
    const file = item.getAsFile();
    if (file) items.push({ kind: "file", file });
  }
  if (items.length > 0) return items;
  return Array.from(dataTransfer.files).map((file) => ({ kind: "file", file }));
}

export function useDragDrop(options: DragDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const onDropCallback = typeof options === "function" ? options : options.onDropItems;
  const onDropFiles = typeof options === "object" ? options.onDropFiles : undefined;
  const onDropPath = typeof options === "object" ? options.onDropPath : undefined;

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      counterRef.current = 0;
      setIsDragOver(false);

      const pathData = e.dataTransfer.getData("application/x-pi-web-path");
      if (pathData) {
        try {
          const parsed = JSON.parse(pathData) as DragPathPayload;
          if (parsed.path) {
            onDropPath?.(parsed);
            return;
          }
        } catch {
          // ignore
        }
      }

      const items = droppedItems(e.dataTransfer);
      if (onDropCallback) {
        onDropCallback(items);
      } else if (onDropFiles) {
        const files = items.filter((i): i is { kind: "file"; file: File } => i.kind === "file").map((i) => i.file);
        if (files.length > 0) onDropFiles(files);
      }
    },
    [onDropCallback, onDropFiles, onDropPath]
  );

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
