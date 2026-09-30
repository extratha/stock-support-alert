import { NextResponse, type NextRequest } from "next/server";
import { loadAuthSetup } from "@/lib/auth";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Browsers always send Origin (or Sec-Fetch-Site) on cross-site writes; reject those. */
function isCrossSiteWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== request.headers.get("host");
    } catch {
      return true;
    }
  }
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/**
 * Gate the dashboard and management API behind the login session cookie.
 * /api/cron/* and /api/line/webhook are excluded by the matcher: they authenticate
 * themselves (bearer secret / LINE signature) and are called by machines.
 */
export function proxy(request: NextRequest) {
  const setup = loadAuthSetup();
  if (!setup.ok) {
    if (setup.reason === "disabled") return NextResponse.next(); // local dev convenience
    return new NextResponse("Login is not configured (ADMIN_PASSWORD / SESSION_SECRET)", { status: 503 });
  }

  if (isCrossSiteWrite(request)) return NextResponse.json({ error: "cross-site request blocked" }, { status: 403 });

  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && verifySessionToken(token, setup.config)) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Static assets and image/icon files are public so the login page itself can show them.
  matcher: ["/((?!api/cron/|api/line/webhook|_next/static|_next/image|.*\\.(?:svg|png|ico|jpg|jpeg|webp)$).*)"],
};
