import { and, desc, eq } from "drizzle-orm";
import type { EvalRunStatus, EvalTrigger, EvalVerdict } from "@vaanidesk/core";
import type { Database } from "../client.js";
import { evalCases, evalResults, evalRuns } from "../schema/index.js";
import type { EvalCase, EvalRun } from "../types.js";

/**
 * Storage for the eval harness — not tenant-scoped (cases/runs are global CI
 * artifacts, ADR-0007). Cases are versioned in the repo and upserted by name;
 * runs/results are the durable record the CI gate and trend views read.
 */
export function createEvalStore(db: Database) {
  return {
    /** Repo fixture → DB row, keyed by stable scenario name. */
    async syncCase(input: {
      name: string;
      description?: string;
      tags: string[];
      persona: unknown;
      fixture: unknown;
      assertions: unknown;
    }): Promise<EvalCase> {
      const rows = await db
        .insert(evalCases)
        .values({ ...input, active: true })
        .onConflictDoUpdate({
          target: evalCases.name,
          set: {
            description: input.description ?? null,
            tags: input.tags,
            persona: input.persona,
            fixture: input.fixture,
            assertions: input.assertions,
            active: true,
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`Failed to sync eval case "${input.name}"`);
      return row;
    },

    async createRun(input: {
      trigger: EvalTrigger;
      model: string;
      gitSha?: string;
      gitBranch?: string;
    }): Promise<EvalRun> {
      const rows = await db.insert(evalRuns).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error("Failed to create eval run");
      return row;
    },

    async recordResult(input: {
      runId: string;
      caseId: string;
      verdict: EvalVerdict;
      judgeScore?: number;
      judgeReasoning?: string;
      assertionFailures?: unknown;
      transcript?: unknown;
      costPaise?: number;
    }): Promise<void> {
      await db
        .insert(evalResults)
        .values(input)
        .onConflictDoNothing({ target: [evalResults.runId, evalResults.caseId] });
    },

    async completeRun(
      runId: string,
      summary: {
        status: Extract<EvalRunStatus, "completed" | "failed">;
        passCount: number;
        failCount: number;
        errorCount: number;
        totalCostPaise?: number;
        summary?: unknown;
      },
    ): Promise<void> {
      await db
        .update(evalRuns)
        .set({ ...summary, finishedAt: new Date() })
        .where(eq(evalRuns.id, runId));
    },

    /** Pass rate of the latest completed run on a branch — the CI gate baseline. */
    async latestPassRate(gitBranch: string): Promise<number | undefined> {
      const rows = await db
        .select()
        .from(evalRuns)
        .where(and(eq(evalRuns.gitBranch, gitBranch), eq(evalRuns.status, "completed")))
        .orderBy(desc(evalRuns.startedAt))
        .limit(1);
      const run = rows[0];
      if (!run) return undefined;
      const total = run.passCount + run.failCount + run.errorCount;
      return total === 0 ? undefined : run.passCount / total;
    },
  };
}

export type EvalStore = ReturnType<typeof createEvalStore>;
