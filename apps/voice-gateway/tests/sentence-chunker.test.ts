import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/call/sentence-chunker.js";

function feed(chunker: SentenceChunker, deltas: string[]): string[] {
  const out: string[] = [];
  for (const delta of deltas) out.push(...chunker.push(delta));
  return out;
}

describe("SentenceChunker", () => {
  it("emits a sentence as soon as its boundary arrives", () => {
    const chunker = new SentenceChunker();
    const chunks = feed(chunker, ["Kal shaam 5 baje free hai. ", "Book kar doon?"]);
    expect(chunks).toEqual(["Kal shaam 5 baje free hai."]);
    expect(chunker.flush()).toBe("Book kar doon?");
  });

  it("handles boundaries split across deltas", () => {
    const chunker = new SentenceChunker();
    const chunks = feed(chunker, ["Aapka slot confirm ho gaya", ".", " Aur kuch?"]);
    expect(chunks).toEqual(["Aapka slot confirm ho gaya."]);
    expect(chunker.flush()).toBe("Aur kuch?");
  });

  it("does not split on abbreviations or decimals", () => {
    const chunker = new SentenceChunker();
    const chunks = feed(chunker, ["Haircut Rs. 400 ka hai aur rating 4.5 hai. ", "Theek hai?"]);
    expect(chunks).toEqual(["Haircut Rs. 400 ka hai aur rating 4.5 hai."]);
  });

  it("splits on the Hindi danda", () => {
    const chunker = new SentenceChunker();
    const chunks = feed(chunker, ["आपका समय पक्का हो गया है। ", "और कुछ चाहिए?"]);
    expect(chunks).toEqual(["आपका समय पक्का हो गया है।"]);
  });

  it("merges too-short sentences into the next chunk", () => {
    const chunker = new SentenceChunker({ minChunkChars: 12 });
    const chunks = feed(chunker, ["Ji. ", "Kal shaam 5:30 available hai. ", "Aur?"]);
    expect(chunks).toEqual(["Ji. Kal shaam 5:30 available hai."]);
    expect(chunker.flush()).toBe("Aur?");
  });

  it("flush returns null when nothing is pending", () => {
    const chunker = new SentenceChunker();
    feed(chunker, ["Complete sentence here."]);
    expect(chunker.push(" ")).toEqual(["Complete sentence here."]);
    expect(chunker.flush()).toBeNull();
  });

  it("question and exclamation marks are boundaries", () => {
    const chunker = new SentenceChunker();
    const chunks = feed(chunker, ["Kya aap available hain? ", "Zaroor bataiye! ", "Ok."]);
    expect(chunks).toEqual(["Kya aap available hain?", "Zaroor bataiye!"]);
  });
});
