import { getLogo } from "@/lib/db/logos";
import { SYMBOL_PATTERN } from "@/lib/symbol";

export const dynamic = "force-dynamic";

/**
 * A stored company logo (public, read-only: database only, never fetched from the internet here). Pages link it as /api/logo/NVDA?v=<version>; the version
 * changes whenever the logo does, so the browser can keep each one for a long time.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return new Response("invalid symbol", { status: 400 });

  const logo = await getLogo(symbol);
  if (!logo) return new Response("no logo", { status: 404 });

  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "private, max-age=2592000",
      // defence in depth for bytes that came from the internet: never sniffed as HTML, never allowed to run anything
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
