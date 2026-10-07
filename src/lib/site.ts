/** Shared by the server and the browser: plain values only. */

export const SITE_NAME = "Stock Support Alert";
export const SITE_DESCRIPTION =
  "โปรเจกต์ตัวอย่าง (portfolio): คำนวณแนวรับหุ้น US อัตโนมัติ แจ้งเตือนผ่าน LINE ตรวจย้อนหลังด้วย backtest และสรุปข่าวที่กระทบหุ้นด้วย AI — Next.js, Postgres, LINE Messaging API";

/** The pages a visitor (and a search engine) can open, in menu order. */
export const PUBLIC_PAGES = ["/", "/analysis", "/news", "/symbols", "/recipients", "/history"] as const;

/**
 * The public address, for canonical links, the sitemap and link previews: SITE_URL when set (a custom domain), else
 * the production address Vercel provides, else local development.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
