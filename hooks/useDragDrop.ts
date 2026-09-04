"use client";

import { useState, useCallback, useRef } from "react";

export interface DragPathPayload {
  type?: string;
  path: string;
  fullPath?: string;
  name?: string;
  isDir?: boolean;
}

export type DragDropOptions =
  | ((files: File[]) => void)
  | {
      onDropFiles?: (files: File[]) => void;
      onDropPath?: (data: DragPathPayload) => void;
    };

export function useDragDrop(options: DragDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const onDropFiles = typeof options === "function" ? options : options.onDropFiles;
  const onDropPath = typeof options === "object" ? options.onDropPath : undefined;

  const isAcceptedDrag = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-pi-web-path")) return true;
    if (e.dataTransfer.types.includes("Files")) return true;
    return Array.from(e.dataTransfer.items).some(
      (item) => item.type.startsWith("image/") || item.type === "application/x-pi-web-path"
    );
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isAcceptedDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
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
          // ignore JSON parse error
        }
      }

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onDropFiles?.(files);
      }
    },
    [onDropFiles, onDropPath]
  );

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
