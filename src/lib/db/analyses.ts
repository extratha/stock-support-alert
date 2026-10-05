import { GOAL_IDS, type AnalysisPick, type AnalysisView, type GoalId } from "@/lib/analysis/types";
import { sql } from "./client";

/** What is stored in `result` when a run succeeds. */
export interface StoredResult {
  summary: string;
  picks: AnalysisPick[];
  caveats: string[];
  universe: number;
  skipped?: { model: string; reason: string }[];
}

/**
 * Reserve a run for `day`, atomically: the row is only inserted while fewer than `limit` runs exist for that day
 * (two clicks at once cannot both slip through). Returns the new id, or null when the daily limit is used up.
 */
export async function startAnalysis(day: string, goals: GoalId[], model: string, limit: number): Promise<number | null> {
  const rows = await sql()<{ id: number }[]>`
    insert into ai_analyses (day, goals, model)
    select ${day}::date, ${goals.join(",")}::text, ${model}::text
    where (select count(*) from ai_analyses where day = ${day}::date) < ${limit}::int
    returning id::int as id`;
  return rows[0]?.id ?? null;
}

/** `model` = the one that actually answered (it can differ from the one reserved when a fallback was used). */
export async function finishAnalysis(id: number, outcome: { ok: true; model: string; result: StoredResult }) {
  // Pass the object, not a JSON string: with `prepare: false` postgres.js learns the column is jsonb and runs the value
  // through JSON.stringify itself, so a string would be stored as one JSON string instead of an object.
  const db = sql();
  await db`update ai_analyses set status = 'ok', model = ${outcome.model}, result = ${db.json(outcome.result as never)} where id = ${id}`;
}

/** Give a reserved run back: a run that ended in an error does not use up the day. */
export async function cancelAnalysis(id: number) {
  await sql()`delete from ai_analyses where id = ${id}`;
}

export async function runsOnDay(day: string): Promise<number> {
  const rows = await sql()<{ n: number }[]>`select count(*)::int as n from ai_analyses where day = ${day}::date`;
  return rows[0]?.n ?? 0;
}

interface Row {
  id: number;
  created_at: Date;
  goals: string;
  model: string;
  /** an object; a JSON string in the rows written before that was fixed */
  result: StoredResult | string | null;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tolerant of old or partial rows: a page must never crash because one stored result is odd. */
export function toView(r: Row): AnalysisView {
  let result: Partial<StoredResult> = {};
  try {
    const raw = typeof r.result === "string" ? (JSON.parse(r.result) as unknown) : r.result;
    if (raw && typeof raw === "object") result = raw as Partial<StoredResult>;
  } catch {
    // unreadable: shown as an empty result
  }
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    model: r.model,
    goals: r.goals.split(",").filter((g): g is GoalId => GOAL_IDS.includes(g)),
    summary: typeof result.summary === "string" ? result.summary : "",
    picks: list<AnalysisPick>(result.picks).map((p) => ({ ...p, reasons: list<string>(p.reasons), risks: list<string>(p.risks), entryNote: p.entryNote ?? "" })),
    caveats: list<string>(result.caveats),
    universe: typeof result.universe === "number" ? result.universe : 0,
    skipped: list<{ model: string; reason: string }>(result.skipped),
  };
}

export async function getAnalysis(id: number): Promise<AnalysisView | null> {
  const rows = await sql()<Row[]>`
    select id::int as id, created_at, goals, model, result from ai_analyses where id = ${id} and status = 'ok'`;
  return rows[0] ? toView(rows[0]) : null;
}

/** The most recent successful run (any goals), for the page to show on load. */
export async function latestAnalysis(): Promise<AnalysisView | null> {
  const rows = await sql()<Row[]>`
    select id::int as id, created_at, goals, model, result from ai_analyses where status = 'ok' order by id desc limit 1`;
  return rows[0] ? toView(rows[0]) : null;
}
