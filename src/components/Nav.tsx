"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { hardNavigate } from "@/lib/hardNavigate";
import { ActivityIcon, HistoryIcon, ListIcon, LogOutIcon, UsersIcon } from "./icons";
import { Spinner } from "./Spinner";

const links: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/", label: "แนวรับปัจจุบัน", icon: <ActivityIcon /> },
  { href: "/symbols", label: "จัดการหุ้น", icon: <ListIcon /> },
  { href: "/recipients", label: "ผู้รับแจ้งเตือน", icon: <UsersIcon /> },
  { href: "/history", label: "ประวัติแจ้งเตือน", icon: <HistoryIcon /> },
];

/**
 * The menu item's leading icon. While the destination page is loading it turns into a spinner
 * (same 16x16 box, so nothing shifts and no empty space is reserved). Must render inside a <Link>.
 */
function NavIcon({ icon }: { icon: ReactNode }) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{icon}</>;
  return (
    <>
      <Spinner className="text-primary" />
      <span className="sr-only" role="status">
        กำลังโหลด
      </span>
    </>
  );
}

function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      hardNavigate("/login");
    }
  }
  return (
    <button
      onClick={logout}
      disabled={busy}
      className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <Spinner /> : <LogOutIcon />}
      <span>ออกจากระบบ</span>
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null; // no navigation before signing in
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <nav
        aria-label="เมนูหลัก"
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2"
      >
        <Link href="/" className="mr-3 flex min-h-11 items-center gap-2 font-semibold tracking-tight">
          {/* The app icon (same file as the favicon), so the brand looks the same everywhere. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG */}
          <img src="/bell-icon.svg" alt="" width={32} height={32} className="size-8 shrink-0" />
          <span>
            Stock<span className="text-primary">Support</span>
          </span>
        </Link>

        {links.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-150 ${
                active
                  ? "bg-primary/10 text-primary ring-1 ring-primary/25"
                  : "text-muted hover:bg-elevated hover:text-foreground"
              }`}
            >
              <NavIcon icon={l.icon} />
              <span>{l.label}</span>
            </Link>
          );
        })}
        <LogoutButton />
      </nav>
    </header>
  );
}
