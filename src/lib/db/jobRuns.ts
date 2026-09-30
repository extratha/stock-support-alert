import { sql } from "./client";

/** The last New York day `job` finished (YYYY-MM-DD), or null if never. */
export async function lastRunDay(job: string): Promise<string | null> {
  const rows = await sql()<{ last_day: string }[]>`select last_day::text as last_day from job_runs where job = ${job}`;
  return rows[0]?.last_day ?? null;
}

export async function markRun(job: string, day: string) {
  await sql()`
    insert into job_runs (job, last_day) values (${job}, ${day})
    on conflict (job) do update set last_day = excluded.last_day, finished_at = now()`;
}
