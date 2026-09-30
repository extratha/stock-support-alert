"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActivityIcon, HistoryIcon, ListIcon, ShieldIcon } from "./icons";
import { Spinner } from "./Spinner";

const links: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/", label: "แนวรับปัจจุบัน", icon: <ActivityIcon /> },
  { href: "/symbols", label: "จัดการหุ้น", icon: <ListIcon /> },
  { href: "/history", label: "ประวัติแจ้งเตือน", icon: <HistoryIcon /> },
];

/**
 * Must render inside a <Link>. Shows a spinner after a short delay (no flash on fast
 * navigations) while the destination route is loading. Space is reserved, so no layout shift.
 */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`grid size-4 place-items-center transition-opacity duration-150 ${
        pending ? "opacity-100 delay-100" : "opacity-0"
      }`}
    >
      {pending && <Spinner className="text-primary" />}
      <span className="sr-only" role="status">
        {pending ? "กำลังโหลด" : ""}
      </span>
    </span>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <nav
        aria-label="เมนูหลัก"
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2"
      >
        <Link href="/" className="mr-3 flex min-h-11 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <ShieldIcon className="size-4.5" />
          </span>
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
              {l.icon}
              <span>{l.label}</span>
              <PendingIndicator />
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
