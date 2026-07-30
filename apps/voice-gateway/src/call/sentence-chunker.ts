/**
 * Streams LLM text deltas into TTS-ready sentence chunks. Rule 1 of the
 * latency budget: never wait for the full completion — the first sentence goes
 * to TTS the moment it ends.
 *
 * Boundary = sentence punctuation (. ! ? and the Hindi danda ।) followed by
 * whitespace/end, unless it is an abbreviation ("Rs.", "Dr.") or a decimal
 * ("4.5"). Chunks shorter than `minChunkChars` wait for the next boundary so
 * TTS isn't fed confetti.
 */

const ABBREVIATIONS = /(?:\b(?:rs|dr|mr|mrs|ms|st|no|vs)\.)$/i;

export interface SentenceChunkerOptions {
  minChunkChars?: number;
}

export class SentenceChunker {
  private buffer = "";
  private readonly minChunkChars: number;

  constructor(options: SentenceChunkerOptions = {}) {
    this.minChunkChars = options.minChunkChars ?? 12;
  }

  /** Feed a streamed delta; returns zero or more completed sentence chunks. */
  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];

    let searchFrom = 0;
    for (;;) {
      const boundary = this.findBoundaryFrom(searchFrom - 1);
      if (boundary === -1) break;
      if (this.buffer.slice(0, boundary + 1).trim().length < this.minChunkChars) {
        // Too short to synthesize alone — merge with the next sentence.
        searchFrom = boundary + 1;
        continue;
      }
      chunks.push(this.buffer.slice(0, boundary + 1).trimStart());
      this.buffer = this.buffer.slice(boundary + 1);
      searchFrom = 0;
    }
    return chunks;
  }

  /** End of stream: whatever remains is the final chunk. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }

  get pending(): string {
    return this.buffer;
  }

  private findBoundaryFrom(after: number): number {
    for (let i = after + 1; i < this.buffer.length; i++) {
      if (this.isBoundaryAt(i)) return i;
    }
    return -1;
  }

  private isBoundaryAt(i: number): boolean {
    const char = this.buffer[i]!;
    if (char !== "." && char !== "!" && char !== "?" && char !== "।") return false;

    const next = this.buffer[i + 1];
    // Need to see what follows: end-of-buffer is not a boundary yet (more
    // deltas may arrive; flush() handles true end of stream).
    if (next === undefined) return false;
    if (!/\s/.test(next)) return false;

    if (char === ".") {
      const before = this.buffer.slice(Math.max(0, i - 5), i + 1);
      if (ABBREVIATIONS.test(before)) return false;
      const prev = this.buffer[i - 1];
      // Decimal / time-like "4.5" won't have whitespace after in speech text,
      // but guard anyway when digits surround the dot.
      if (prev !== undefined && /\d/.test(prev) && /\d/.test(this.buffer[i + 2] ?? "")) {
        return false;
      }
    }
    return true;
  }
}
