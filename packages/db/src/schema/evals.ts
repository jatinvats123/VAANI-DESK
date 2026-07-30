import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { evalRunStatusEnum, evalTriggerEnum, evalVerdictEnum } from "./enums.js";

/**
 * Eval harness storage. Cases are versioned in the repo (packages/evals) and
 * synced here; runs/results are the durable record the CI gate and nightly
 * trend dashboards read. Jsonb shapes are owned by @vaanidesk/evals schemas.
 */

export const evalCases = pgTable("eval_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable slug, e.g. "hinglish-basic-booking" — repo fixtures sync on this. */
  name: text("name").notNull().unique(),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  /** Scripted caller: persona, language, goal, conversation script/branches. */
  persona: jsonb("persona").notNull(),
  /** Business fixture the scenario runs against (services, hours, policy). */
  fixture: jsonb("fixture").notNull(),
  /** Hard assertions (booking exists, no invented price, transfer offered, …). */
  assertions: jsonb("assertions").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gitSha: text("git_sha"),
    gitBranch: text("git_branch"),
    trigger: evalTriggerEnum("trigger").notNull(),
    /** Agent model under test, e.g. "claude-haiku-4-5". */
    model: text("model").notNull(),
    status: evalRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    passCount: integer("pass_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    totalCostPaise: integer("total_cost_paise"),
    summary: jsonb("summary"),
  },
  (t) => [index("eval_runs_started_idx").on(t.startedAt)],
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => evalCases.id, { onDelete: "cascade" }),
    verdict: evalVerdictEnum("verdict").notNull(),
    /** LLM-as-judge score in [0,1]; hard assertions gate independently. */
    judgeScore: real("judge_score"),
    judgeReasoning: text("judge_reasoning"),
    assertionFailures: jsonb("assertion_failures"),
    transcript: jsonb("transcript"),
    costPaise: integer("cost_paise"),
    latency: jsonb("latency"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("eval_results_run_case_uq").on(t.runId, t.caseId)],
);
