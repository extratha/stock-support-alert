import { markLogoMissing, saveLogo, symbolsNeedingLogo } from "@/lib/db/logos";
import { fetchLogo, type LogoSource } from "@/lib/stock/logo";

export type EnsureResult = { status: "saved"; source: LogoSource } | { status: "missing"; errors: string[] };

/** Look the logo up (all sources, one overall deadline) and store it, or remember that none was found. Never throws. */
export async function ensureLogo(symbol: string, opts: { deadlineMs?: number } = {}): Promise<EnsureResult> {
  try {
    const { logo, errors } = await fetchLogo(symbol, opts);
    if (logo) {
      await saveLogo(symbol, logo);
      return { status: "saved", source: logo.source };
    }
    await markLogoMissing(symbol);
    return { status: "missing", errors };
  } catch (err) {
    return { status: "missing", errors: [err instanceof Error ? err.message : String(err)] };
  }
}

/**
 * Fill in logos for symbols that have none (added before this feature, or every source failed earlier).
 * A few per call keeps the daily job fast; symbols with no logo are retried only after `retryAfterDays`.
 */
export async function backfillLogos({ limit = 3, retryAfterDays = 7 }: { limit?: number; retryAfterDays?: number } = {}) {
  const saved: string[] = [];
  const missing: Record<string, string[]> = {};
  for (const symbol of await symbolsNeedingLogo(limit, retryAfterDays)) {
    const result = await ensureLogo(symbol);
    if (result.status === "saved") saved.push(symbol);
    else missing[symbol] = result.errors;
  }
  return { saved, missing };
}
