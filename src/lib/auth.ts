import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Both sides are hashed first so the comparison
 * works (and takes the same time) whatever their lengths.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/** Cron endpoints: `Authorization: Bearer $CRON_SECRET`. Fails closed when the secret is unset. */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), secret);
}

export interface AuthConfig {
  username: string;
  password: string;
  /** Signs the session cookie. Independent of the password so the cookie can't be used to guess it. */
  secret: string;
}

export type AuthSetup =
  | { ok: true; config: AuthConfig }
  /** Local development without ADMIN_PASSWORD: no login required. */
  | { ok: false; reason: "disabled" }
  /** Production without the needed variables: everything is refused (fail closed). */
  | { ok: false; reason: "misconfigured" };

const DEV_SECRET = "dev-only-session-secret";
const MIN_SECRET_LENGTH = 16;

/**
 * Web UI login = ADMIN_USERNAME (default "admin") + ADMIN_PASSWORD; sessions are signed
 * with SESSION_SECRET. In production a missing/short value refuses all access.
 */
export function loadAuthSetup(env: NodeJS.ProcessEnv = process.env): AuthSetup {
  const production = env.NODE_ENV === "production";
  const password = env.ADMIN_PASSWORD;
  if (!password) return { ok: false, reason: production ? "misconfigured" : "disabled" };

  const secret = env.SESSION_SECRET || (production ? "" : DEV_SECRET);
  if (secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "misconfigured" };

  return { ok: true, config: { username: env.ADMIN_USERNAME || "admin", password, secret } };
}

/** Both fields are always compared (no early exit) so timing doesn't reveal which one was wrong. */
export function checkCredentials(username: string, password: string, config: AuthConfig): boolean {
  const userOk = safeEqual(username, config.username);
  const passOk = safeEqual(password, config.password);
  return userOk && passOk;
}
