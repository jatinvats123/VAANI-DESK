import { parseArgs } from "node:util";
import { config } from "dotenv";
import { computeLlmCostPaise, pricingForModel } from "@vaanidesk/agent";
import { createDatabase, createEvalStore } from "@vaanidesk/db";
import { evaluateAssertions } from "./assertions.js";
import { createGeminiEvalLlm, judgeWithGemini } from "./gemini.js";
import { judgeConversation } from "./judge.js";
import { createEvalLlm, type EvalLlm } from "./llm.js";
import { runConversation } from "./runner.js";
import type { ConversationResult, EvalScenario, JudgeVerdict } from "./types.js";
import { ALL_SCENARIOS } from "./scenarios/index.js";
import type { ScenarioOutcome } from "./types.js";

config({ path: "../../.env" });
config();

const JUDGE_PASS_THRESHOLD = 0.7;
/** CI gate: fail when pass rate drops more than this vs the main baseline. */
const MAX_PASS_RATE_DROP = 0.05;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      trigger: { type: "string", default: "manual" }, // ci | nightly | manual
      filter: { type: "string" },
      "no-judge": { type: "boolean", default: false },
      "no-db": { type: "boolean", default: false },
      gate: { type: "boolean", default: false },
      "git-sha": { type: "string" },
      "git-branch": { type: "string" },
    },
  });

  // Provider selection mirrors the gateway (ADR-0009): LLM_PROVIDER picks the
  // backend, and only that provider's key is required.
  const provider = process.env.LLM_PROVIDER === "gemini" ? "gemini" : "anthropic";
  const defaultModel =
    provider === "gemini" ? "gemini-flash-lite-latest" : "claude-haiku-4-5-20251001";
  const apiKey = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    console.error(`${keyName} is required to run evals with LLM_PROVIDER=${provider}.`);
    process.exit(2);
  }
  const model = process.env.AGENT_MODEL ?? defaultModel;
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? model;

  const llm: EvalLlm =
    provider === "gemini"
      ? createGeminiEvalLlm({ apiKey, model })
      : createEvalLlm({ apiKey, model });
  const judge = (
    scenario: EvalScenario,
    result: ConversationResult,
  ): Promise<JudgeVerdict> =>
    provider === "gemini"
      ? judgeWithGemini({ apiKey, model: judgeModel }, scenario, result)
      : judgeConversation({ apiKey, model: judgeModel }, scenario, result);

  const scenarios = values.filter
    ? ALL_SCENARIOS.filter(
        (s) => s.name.includes(values.filter!) || s.tags.includes(values.filter!),
      )
    : ALL_SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`No scenarios match filter "${values.filter}".`);
    process.exit(2);
  }

  console.log(`Running ${scenarios.length} scenario(s) against ${provider}:${model}…\n`);
  const outcomes: ScenarioOutcome[] = [];

  for (const scenario of scenarios) {
    const startedAt = Date.now();
    const result = await runConversation(llm, scenario);
    const assertionFailures = result.runError
      ? []
      : evaluateAssertions(scenario.assertions, result);

    let judgeVerdict;
    if (!values["no-judge"] && !result.runError) {
      judgeVerdict = await judge(scenario, result);
    }

    const pricing = pricingForModel(model);
    const costPaise = pricing ? computeLlmCostPaise(result.usage, pricing) : 0;
    const verdict: ScenarioOutcome["verdict"] = result.runError
      ? "error"
      : assertionFailures.length > 0 ||
          (judgeVerdict !== undefined && judgeVerdict.score < JUDGE_PASS_THRESHOLD)
        ? "fail"
        : "pass";

    outcomes.push({
      scenario,
      result,
      assertionFailures,
      ...(judgeVerdict !== undefined ? { judge: judgeVerdict } : {}),
      verdict,
      costPaise,
      durationMs: Date.now() - startedAt,
    });

    const icon = verdict === "pass" ? "✓" : verdict === "fail" ? "✗" : "!";
    const judgeNote = judgeVerdict ? ` judge=${judgeVerdict.score.toFixed(2)}` : "";
    console.log(
      `${icon} ${scenario.name} (${verdict})${judgeNote} · ₹${(costPaise / 100).toFixed(2)} · ${Math.round(
        (Date.now() - startedAt) / 1000,
      )}s`,
    );
    for (const failure of assertionFailures) {
      console.log(`    ↳ [${failure.assertion.kind}] ${failure.detail}`);
    }
    if (result.runError) console.log(`    ↳ runner error: ${result.runError}`);
  }

  const passCount = outcomes.filter((o) => o.verdict === "pass").length;
  const failCount = outcomes.filter((o) => o.verdict === "fail").length;
  const errorCount = outcomes.filter((o) => o.verdict === "error").length;
  const totalCostPaise = outcomes.reduce((sum, o) => sum + o.costPaise, 0);
  const passRate = passCount / outcomes.length;

  console.log(
    `\n${passCount}/${outcomes.length} passed (${(passRate * 100).toFixed(0)}%) · ` +
      `${failCount} failed · ${errorCount} errored · total cost ₹${(totalCostPaise / 100).toFixed(2)}`,
  );

  let gateFailed = false;
  if (!values["no-db"] && process.env.DATABASE_URL) {
    const { db, close } = createDatabase(process.env.DATABASE_URL, { max: 1 });
    try {
      const store = createEvalStore(db);
      const run = await store.createRun({
        trigger:
          values.trigger === "ci" ? "ci" : values.trigger === "nightly" ? "nightly" : "manual",
        model,
        ...(values["git-sha"] !== undefined ? { gitSha: values["git-sha"] } : {}),
        ...(values["git-branch"] !== undefined ? { gitBranch: values["git-branch"] } : {}),
      });
      for (const outcome of outcomes) {
        const evalCase = await store.syncCase({
          name: outcome.scenario.name,
          description: outcome.scenario.description,
          tags: outcome.scenario.tags,
          persona: outcome.scenario.persona,
          fixture: outcome.scenario.fixture,
          assertions: outcome.scenario.assertions,
        });
        await store.recordResult({
          runId: run.id,
          caseId: evalCase.id,
          verdict: outcome.verdict,
          ...(outcome.judge !== undefined
            ? { judgeScore: outcome.judge.score, judgeReasoning: outcome.judge.reasoning }
            : {}),
          assertionFailures: outcome.assertionFailures,
          transcript: outcome.result.turns,
          costPaise: outcome.costPaise,
        });
      }
      await store.completeRun(run.id, {
        status: errorCount === outcomes.length ? "failed" : "completed",
        passCount,
        failCount,
        errorCount,
        totalCostPaise,
      });
      console.log(`Run ${run.id} persisted.`);

      if (values.gate) {
        const baseline = await store.latestPassRate("main");
        if (baseline === undefined) {
          console.log("Gate: no main baseline yet — passing by default.");
        } else if (passRate < baseline - MAX_PASS_RATE_DROP) {
          console.error(
            `Gate FAILED: pass rate ${(passRate * 100).toFixed(0)}% vs main baseline ` +
              `${(baseline * 100).toFixed(0)}% (allowed drop ${MAX_PASS_RATE_DROP * 100}%).`,
          );
          gateFailed = true;
        } else {
          console.log(
            `Gate OK: ${(passRate * 100).toFixed(0)}% vs baseline ${(baseline * 100).toFixed(0)}%.`,
          );
        }
      }
    } finally {
      await close();
    }
  } else if (values.gate) {
    console.warn("Gate requested but no DATABASE_URL — gate skipped.");
  }

  process.exit(
    gateFailed || errorCount > 0
      ? 1
      : failCount > 0 && values.trigger === "ci" && !values.gate
        ? 1
        : 0,
  );
}

main().catch((error: unknown) => {
  console.error("Eval run crashed:", error);
  process.exit(1);
});
