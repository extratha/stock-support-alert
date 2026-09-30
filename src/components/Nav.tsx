import Link from "next/link";

const links = [
  { href: "/", label: "แนวรับปัจจุบัน" },
  { href: "/symbols", label: "จัดการหุ้น" },
  { href: "/history", label: "ประวัติแจ้งเตือน" },
];

export function Nav() {
  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
        <span className="font-semibold">📉 Stock Support Alert</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-muted hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
