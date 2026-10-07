import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import { isOwner } from "@/lib/viewer";

const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "แนวรับหุ้น",
    "หุ้น US",
    "แจ้งเตือนหุ้น LINE",
    "support level",
    "backtest",
    "Next.js",
    "portfolio",
  ],
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    locale: "th_TH",
    url: "./",
  },
  twitter: { card: "summary", title: SITE_NAME, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
  // Google Search Console (URL-prefix property, "HTML tag" method): only the content value, Next.js writes the tag
  verification: { google: "hSFeBYW2QwZmJsxgxLWxegJXbDRk57UgALTKCuXiAto" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = await isOwner();
  return (
    <html
      lang="th"
      className={`${plexThai.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav owner={owner} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {!owner && (
            <p className="mb-5 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-medium text-foreground">
                โหมดผู้เยี่ยมชม (ดูอย่างเดียว)
              </span>{" "}
              — โปรเจกต์ portfolio ที่ทำงานจริง: ข้อมูลอัปเดตอัตโนมัติทุกวัน
              ปุ่มจัดการต่าง ๆ ใช้ได้เฉพาะเจ้าของระบบ
              และข้อมูลส่วนตัวของผู้รับแจ้งเตือนถูกซ่อนไว้
            </p>
          )}
          {children}
        </main>
        <footer className="mx-auto w-full max-w-5xl px-4 pb-8 pt-2 text-[11px] leading-relaxed text-muted">
          ข้อมูลและผลวิเคราะห์ในเว็บนี้เพื่อการศึกษาและสาธิตระบบเท่านั้น
          ไม่ใช่คำแนะนำการลงทุน ราคาอาจล่าช้าหรือคลาดเคลื่อน และผลจาก AI
          อาจผิดพลาด — ตัดสินใจลงทุนด้วยตัวเอง
        </footer>
      </body>
    </html>
  );
}
