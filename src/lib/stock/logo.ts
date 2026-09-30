/**
 * Company logo lookup, used ONCE per symbol (when it is added, or by the backfill) and then stored in the DB.
 * Sources in order (the first that gives a valid image wins):
 *   1. Financial Modeling Prep image CDN  keyless; 404 for unknown symbols
 *   2. Finnhub /stock/profile2            official, uses FINNHUB_API_KEY (often no logo for smaller tickers)
 *   3. Twelve Data /logo                  uses STOCK_API_KEY
 * The images are untrusted input: only PNG/JPEG/GIF/WebP of a sane size are accepted (no SVG: it can carry
 * scripts), by looking at the bytes rather than trusting Content-Type, and only from hosts we expect.
 */
export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type LogoSource = "fmp" | "finnhub" | "twelvedata";

export interface Logo {
  data: Buffer;
  type: ImageType;
  source: LogoSource;
}

export const MIN_LOGO_BYTES = 200;
export const MAX_LOGO_BYTES = 150_000;
export const SOURCE_TIMEOUT_MS = 4000;

/** Identify an image by its magic bytes. */
export function sniffImageType(b: Uint8Array): ImageType | null {
  const at = (i: number) => b[i];
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (b.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (b.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return "image/webp";
  }
  return null;
}

const ALLOWED_HOSTS: Record<LogoSource, (host: string) => boolean> = {
  fmp: (h) => h === "financialmodelingprep.com",
  finnhub: (h) => h === "finnhub.io" || h.endsWith(".finnhub.io"),
  twelvedata: (h) => h === "api.twelvedata.com" || h === "twelvedata.com" || h.endsWith(".twelvedata.com"),
};

/** A URL that an API handed us is only followed if it is https and on that provider's own domain. */
export function isAllowedLogoUrl(source: LogoSource, url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS[source](u.hostname);
  } catch {
    return false;
  }
}

const signalFor = (deadline?: AbortSignal) =>
  deadline ? AbortSignal.any([AbortSignal.timeout(SOURCE_TIMEOUT_MS), deadline]) : AbortSignal.timeout(SOURCE_TIMEOUT_MS);

async function getJson(url: string, headers: Record<string, string>, deadline?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers, cache: "no-store", signal: signalFor(deadline) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

async function downloadImage(source: LogoSource, url: string, deadline?: AbortSignal): Promise<Logo> {
  if (!isAllowedLogoUrl(source, url)) throw new Error("URL not on the provider's domain");
  const res = await fetch(url, { cache: "no-store", signal: signalFor(deadline) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // redirects (Finnhub's CDN hops between hosts) must stay on the provider's domain too
  if (res.url && !isAllowedLogoUrl(source, res.url)) throw new Error("redirected off the provider's domain");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < MIN_LOGO_BYTES) throw new Error(`too small (${data.length} B)`);
  if (data.length > MAX_LOGO_BYTES) throw new Error(`too large (${data.length} B)`);
  const type = sniffImageType(data);
  if (!type) throw new Error("not a PNG/JPEG/GIF/WebP image");
  return { data, type, source };
}

async function fromFmp(symbol: string, deadline?: AbortSignal) {
  return downloadImage("fmp", `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`, deadline);
}

async function fromFinnhub(symbol: string, key: string, deadline?: AbortSignal) {
  const profile = await getJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}`, { "X-Finnhub-Token": key }, deadline);
  const url = typeof profile.logo === "string" ? profile.logo : "";
  if (!url) throw new Error("no logo in profile");
  return downloadImage("finnhub", url, deadline);
}

async function fromTwelveData(symbol: string, key: string, deadline?: AbortSignal) {
  const json = await getJson(`https://api.twelvedata.com/logo?symbol=${encodeURIComponent(symbol)}`, { Authorization: `apikey ${key}` }, deadline);
  const url = typeof json.url === "string" ? json.url : "";
  if (!url) throw new Error("no logo url");
  return downloadImage("twelvedata", url, deadline);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Try each source in turn; never throws. `errors` says what each skipped source reported. */
export async function fetchLogo(symbol: string, { deadlineMs = 10_000 }: { deadlineMs?: number } = {}): Promise<{ logo?: Logo; errors: string[] }> {
  const deadline = AbortSignal.timeout(deadlineMs);
  const errors: string[] = [];
  const attempts: [LogoSource, (() => Promise<Logo>) | null][] = [
    ["fmp", () => fromFmp(symbol, deadline)],
    ["finnhub", process.env.FINNHUB_API_KEY ? () => fromFinnhub(symbol, process.env.FINNHUB_API_KEY!, deadline) : null],
    ["twelvedata", process.env.STOCK_API_KEY ? () => fromTwelveData(symbol, process.env.STOCK_API_KEY!, deadline) : null],
  ];
  for (const [source, attempt] of attempts) {
    if (!attempt) {
      errors.push(`${source}: no API key`);
      continue;
    }
    if (deadline.aborted) {
      errors.push(`${source}: skipped, deadline reached`);
      continue;
    }
    try {
      return { logo: await attempt(), errors };
    } catch (err) {
      errors.push(`${source}: ${message(err)}`);
    }
  }
  return { errors };
}
