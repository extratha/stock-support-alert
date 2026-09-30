/**
 * One-off / repeatable: fetch and store logos for every tracked symbol that has none (for symbols added before
 * logos existed, or whose earlier lookup failed). Safe to run again; symbols that already have a logo are skipped.
 *
 *   set -a; source .env.local; set +a; npm run seed:logos            (skips symbols tried in the last 7 days)
 *   set -a; source .env.local; set +a; npm run seed:logos -- --retry (try everything that has no logo again now)
 */
import { backfillLogos } from "@/lib/jobs/logos";
import { sql } from "@/lib/db/client";

async function main() {
  const retry = process.argv.includes("--retry");
  const { saved, missing } = await backfillLogos({ limit: 200, retryAfterDays: retry ? 0 : 7 });
  console.log(`saved (${saved.length}): ${saved.join(", ") || "-"}`);
  for (const [symbol, errors] of Object.entries(missing)) console.log(`no logo for ${symbol}: ${errors.join("; ")}`);
  const rows = await sql()<{ symbol: string; source: string | null; bytes: number | null }[]>`
    select symbol, logo_source as source, length(logo_data) as bytes from symbols order by position nulls last, symbol`;
  console.log("\nnow in the database:");
  for (const r of rows) console.log(`  ${r.symbol.padEnd(6)} ${r.source ? `${r.source}, ${r.bytes} bytes` : "(no logo)"}`);
  await sql().end({ timeout: 2 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
