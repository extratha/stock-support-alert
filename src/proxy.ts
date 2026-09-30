import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthorized } from "@/lib/auth";

/**
 * Gate the dashboard and management API behind ADMIN_PASSWORD (HTTP Basic).
 * /api/cron/* and /api/line/webhook are excluded: they authenticate themselves
 * (bearer secret / LINE signature) and are called by machines.
 */
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("ADMIN_PASSWORD is not configured", { status: 503 });
    }
    return NextResponse.next(); // local dev convenience
  }

  if (isAdminAuthorized(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-support-alert"' },
  });
}

export const config = {
  matcher: ["/((?!api/cron/|api/line/webhook|_next/static|_next/image|favicon.ico).*)"],
};
