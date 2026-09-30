import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Cron endpoints: `Authorization: Bearer $CRON_SECRET`. Fails closed when the secret is unset. */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), secret);
}

/** Dashboard / management API: HTTP Basic, any username, password = ADMIN_PASSWORD. */
export function isAdminAuthorized(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  return safeEqual(pass, password);
}
