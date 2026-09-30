/**
 * Fill in / refresh the "fundamentals and risk" figures for every tracked symbol right now, instead of waiting for
 * the daily job (e.g. right after deploying this feature). Uses ~1 Twelve Data credit per symbol and pauses 61 s
 * between batches of 8 (free plan limit), then 2 Finnhub calls per symbol.
 *
 *   set -a; source .env.local; set +a; npm run refresh:profiles
 */
import { sql } from "@/lib/db/client";
import { listSymbols } from "@/lib/db/symbols";
import { refreshFundamentals } from "@/lib/jobs/profiles";
import { recalculate } from "@/lib/jobs/recalculateSupports";

async function main() {
  const symbols = await listSymbols();
  let offset = 0;
  for (;;) {
    const r = await recalculate(symbols, new Date(), { force: true, offset });
    console.log(`price history: updated ${r.updated.join(", ") || "-"}${Object.keys(r.errors).length ? ` | errors ${JSON.stringify(r.errors)}` : ""}`);
    if (r.remaining === 0) break;
    offset = r.next;
    console.log("waiting 61 s (Twelve Data free plan: 8 credits/minute)…");
    await new Promise((res) => setTimeout(res, 61_000));
  }
  const f = await refreshFundamentals({ symbols, deadlineMs: 60_000 });
  console.log(`fundamentals: updated ${f.updated.length}/${symbols.length}${Object.keys(f.errors).length ? ` | errors ${JSON.stringify(f.errors)}` : ""}`);
  await sql().end({ timeout: 2 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
