"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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

function LogoutButton({ className = "" }: { className?: string }) {
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
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors duration-150 hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {busy ? <Spinner /> : <LogOutIcon />}
      <span>ออกจากระบบ</span>
    </button>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
      {/* The app icon (same file as the favicon), so the brand looks the same everywhere. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG */}
      <img src="/bell-icon.svg" alt="" width={32} height={32} className="size-8 shrink-0" />
      <span>
        Stock<span className="text-primary">Support</span>
      </span>
    </Link>
  );
}

/**
 * Three bars that morph into an X (and back): the top and bottom bars slide to the middle and rotate
 * +/-45 degrees, the middle bar shrinks away. Closed, the bars have staggered lengths for a little
 * character; open, they all become full width so the X is clean. Transitions honour
 * prefers-reduced-motion through the global rule in globals.css.
 */
function HamburgerIcon({ open }: { open: boolean }) {
  const bar = "absolute left-0 h-0.5 rounded-full bg-current transition-all duration-300 ease-[cubic-bezier(0.65,0,0.35,1)]";
  return (
    <span aria-hidden="true" className="relative block h-[18px] w-6">
      <span className={`${bar} top-0 origin-center ${open ? "w-full translate-y-[8px] rotate-45" : "w-full"}`} />
      <span className={`${bar} top-[8px] origin-right ${open ? "w-full scale-x-0 opacity-0" : "w-3/4"}`} />
      <span className={`${bar} top-[16px] origin-center ${open ? "w-full -translate-y-[8px] -rotate-45" : "w-1/2"}`} />
    </span>
  );
}

const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** Below 1024px: top bar = icon + title + hamburger, menu in a slide-in drawer. From 1024px: the inline menu. */
export function Nav() {
  const pathname = usePathname();
  // The drawer is "open" only while we are still on the page where it was opened, so it closes by
  // itself as soon as navigation lands on another page (and the loading spinner stays visible until then).
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const close = () => setOpenedAt(null);

  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const toggle = toggleRef.current;
    const focusables = () => [toggle, ...(drawer?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])].filter(
      (el): el is HTMLElement => !!el,
    );

    // page behind must not scroll; move focus into the drawer
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    drawer?.querySelector<HTMLElement>("a[href]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenedAt(null);
        toggle?.focus();
      } else if (e.key === "Tab") {
        // keep keyboard focus inside the open menu (toggle + drawer items)
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // growing past the breakpoint (rotating a tablet) must not leave the page locked
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = (e: MediaQueryListEvent) => e.matches && setOpenedAt(null);

    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  if (pathname === "/login") return null; // no navigation before signing in

  const linkClass = (active: boolean, size: string) =>
    `flex cursor-pointer items-center rounded-lg px-3 transition-colors duration-150 ${size} ${
      active ? "bg-primary/10 text-primary ring-1 ring-primary/25" : "text-muted hover:bg-elevated hover:text-foreground"
    }`;

  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-full max-w-5xl items-center gap-x-2 px-4">
          <Brand onClick={close} />

          {/* wide screens: the menu stays in the bar */}
          <nav aria-label="เมนูหลัก" className="ml-3 hidden flex-1 items-center gap-x-2 lg:flex">
            {links.map((l) => {
              const active = isActive(l.href, pathname);
              return (
                <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={linkClass(active, "min-h-11 gap-2 text-sm")}>
                  <NavIcon icon={l.icon} />
                  <span>{l.label}</span>
                </Link>
              );
            })}
            <LogoutButton className="ml-auto" />
          </nav>

          {/* narrow screens: hamburger only */}
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpenedAt(open ? null : pathname)}
            aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            className={`ml-auto grid size-11 cursor-pointer place-items-center rounded-lg transition-colors duration-200 hover:bg-elevated lg:hidden ${
              open ? "text-primary" : "text-foreground"
            }`}
          >
            <HamburgerIcon open={open} />
          </button>
        </div>
      </header>

      {/* Drawer + backdrop are siblings of the header, not children: the header's backdrop-blur would
          otherwise become the containing block of these fixed elements. Both sit below the 56px bar
          so the hamburger/X stays visible and clickable. */}
      <div
        aria-hidden="true"
        onClick={close}
        className={`fixed inset-x-0 bottom-0 top-14 z-10 bg-black/60 transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={drawerRef}
        id="mobile-menu"
        inert={!open}
        className={`fixed bottom-0 left-0 top-14 z-20 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-2xl shadow-black/50 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full invisible"
        }`}
      >
        <nav aria-label="เมนูหลัก" className="flex-1 space-y-1 overflow-y-auto p-3">
          {links.map((l) => {
            const active = isActive(l.href, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => active && close()} // same page: no navigation will follow, so close right away
                aria-current={active ? "page" : undefined}
                className={linkClass(active, "min-h-12 gap-3 text-base")}
              >
                <NavIcon icon={l.icon} />
                <span>{l.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <LogoutButton className="min-h-12 w-full text-base" />
        </div>
      </div>
    </>
  );
}
