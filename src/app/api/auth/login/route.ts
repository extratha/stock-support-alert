import { NextResponse } from "next/server";
import { checkCredentials, loadAuthSetup } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Slows down password guessing a little (there is no shared state to count attempts in). */
export const FAILURE_DELAY_MS = 500;

export async function POST(request: Request) {
  const setup = loadAuthSetup();
  if (!setup.ok) {
    return NextResponse.json({ error: "login is not configured" }, { status: setup.reason === "disabled" ? 400 : 503 });
  }

  const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!checkCredentials(username, password, setup.config)) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return NextResponse.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(setup.config),
    httpOnly: true, // not readable by page scripts
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return response;
}
