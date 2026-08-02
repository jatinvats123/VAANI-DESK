import { config } from "dotenv";
import { createGeminiClient } from "./src/providers/gemini.js";

config({ path: "../../.env" });
config();

const apiKey = process.env.GEMINI_API_KEY ?? "";
const model = process.env.AGENT_MODEL ?? "gemini-flash-lite-latest";

async function main(): Promise<void> {
  const llm = createGeminiClient({ apiKey, model });
  const controller = new AbortController();
  const started = performance.now();
  let ttftMs = 0;
  let chars = 0;

  const result = await llm.streamTurn({
    system:
      "You are a warm Hinglish salon receptionist. Keep replies to one short spoken sentence.",
    messages: [{ role: "user", content: "Hi, kal shaam ko haircut ka slot hai kya?" }],
    signal: controller.signal,
    callbacks: {
      onFirstToken: () => {
        ttftMs = performance.now() - started;
      },
      onTextDelta: (d) => {
        chars += d.length;
      },
    },
  });

  const totalMs = performance.now() - started;
  console.log(`model=${model}`);
  console.log(`  LLM TTFT=${ttftMs.toFixed(0)}ms · total=${totalMs.toFixed(0)}ms`);
  console.log(`  tokens in/out=${result.usage.inputTokens}/${result.usage.outputTokens} · reply="${result.text}"`);
  console.log(`SUMMARY llm_ttft_ms=${ttftMs.toFixed(0)} llm_total_ms=${totalMs.toFixed(0)}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("LLM latency probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
