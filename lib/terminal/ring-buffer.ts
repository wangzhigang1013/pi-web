/**
 * Ring buffer to retain recent terminal output for reconnection replay.
 */
export class TerminalRingBuffer {
  private buffer: string[] = [];
  private maxChars: number;
  private currentLength: number = 0;

  constructor(maxChars: number = 200_000) {
    this.maxChars = maxChars;
  }

  write(chunk: string): void {
    this.buffer.push(chunk);
    this.currentLength += chunk.length;

    // Prune old chunks if exceeding maxChars
    while (this.currentLength > this.maxChars && this.buffer.length > 1) {
      const removed = this.buffer.shift();
      if (removed) {
        this.currentLength -= removed.length;
      }
    }
  }

  getHistory(): string {
    return this.buffer.join("");
  }

  clear(): void {
    this.buffer = [];
    this.currentLength = 0;
  }
}
