/**
 * Run the news jobs now, against the database in the environment:
 *
 *   set -a; source .env.local; set +a; npm run news            collect the latest news (what the hourly cron does)
 *   set -a; source .env.local; set +a; npm run news -- brief   collect, then the AI news brief (one AI call; counts
 *                                                               toward NEWS_DAILY_LIMIT)
 */
import { sql } from "@/lib/db/client";
import { collectNews, runNewsBrief } from "@/lib/jobs/news";

async function main() {
  const started = Date.now();
  const result = process.argv[2] === "brief" ? await runNewsBrief({ trigger: "manual" }) : await collectNews();
  console.log(JSON.stringify(result, null, 2));
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await sql().end();
}

main().catch(async (err) => {
  console.error(err);
  await sql().end().catch(() => {});
  process.exit(1);
});
