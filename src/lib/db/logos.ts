import type { ImageType, Logo } from "@/lib/stock/logo";
import { sql } from "./client";

export interface StoredLogo {
  data: Buffer;
  type: ImageType;
}

export async function getLogo(symbol: string): Promise<StoredLogo | null> {
  const [row] = await sql()<{ data: Buffer; type: ImageType }[]>`
    select logo_data as data, logo_type as type from symbols where symbol = ${symbol} and logo_type is not null`;
  return row ?? null;
}

export async function saveLogo(symbol: string, logo: Logo) {
  await sql()`
    update symbols
    set logo_data = ${logo.data}, logo_type = ${logo.type}, logo_source = ${logo.source}, logo_checked_at = now()
    where symbol = ${symbol}`;
}

/** No source had a logo: remember when we looked so it is not retried on every run. */
export async function markLogoMissing(symbol: string) {
  await sql()`update symbols set logo_checked_at = now() where symbol = ${symbol} and logo_type is null`;
}

/** Symbols without a logo that have never been tried, or not within the last `retryAfterDays` days. */
export async function symbolsNeedingLogo(limit: number, retryAfterDays: number): Promise<string[]> {
  const rows = await sql()<{ symbol: string }[]>`
    select symbol from symbols
    where logo_type is null
      and (logo_checked_at is null or logo_checked_at < now() - make_interval(days => ${retryAfterDays}))
    order by logo_checked_at nulls first, symbol
    limit ${limit}`;
  return rows.map((r) => r.symbol);
}
