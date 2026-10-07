import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { loadAuthSetup } from "@/lib/auth";
import { safeNextPath } from "@/lib/safeNext";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "เข้าสู่ระบบ", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);

  // Already signed in (or login disabled in local dev): nothing to do here.
  const setup = loadAuthSetup();
  if (!setup.ok && setup.reason === "disabled") redirect(next);
  if (setup.ok) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token && verifySessionToken(token, setup.config)) redirect(next);
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-sm sm:mt-20">
      <div className="surface space-y-6 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand icon */}
          <img src="/bell-icon.svg" alt="" width={56} height={56} className="size-14" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Stock<span className="text-primary">Support</span>
            </h1>
            <p className="mt-1 text-sm text-muted">สำหรับเจ้าของระบบ — ผู้เยี่ยมชมดูทุกหน้าได้โดยไม่ต้องเข้าสู่ระบบ</p>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
      <p className="mt-4 text-center text-sm">
        <Link href={next} className="text-muted underline-offset-4 hover:text-primary hover:underline">
          ← กลับไปดูหน้าเว็บ
        </Link>
      </p>
    </div>
  );
}
