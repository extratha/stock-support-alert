const MAX_LISTED = 20;

/** Words that ask for the usage guide again (matched against the whole trimmed message, case-insensitive). */
const HELP_WORDS = new Set(["วิธีใช้", "วิธีใช้งาน", "ช่วยเหลือ", "เมนู", "help", "?"]);

export function isHelpCommand(text: string): boolean {
  return HELP_WORDS.has(text.trim().toLowerCase());
}

/**
 * How to use the bot, shown when someone adds the OA (welcome = true) or types "วิธีใช้".
 * Examples use the stocks actually being tracked so they work when copied.
 */
export function formatGuide(symbols: string[], { welcome }: { welcome: boolean }): string {
  const first = symbols[0] ?? "NVDA";
  const second = symbols[1];
  const lines = [
    welcome ? "ยินดีต้อนรับสู่ Stock Support Alert 👋\nบอทนี้ช่วยดูแนวรับของหุ้น US" : "วิธีใช้ Stock Support Alert",
    "",
    "พิมพ์ข้อความต่อไปนี้ได้เลย (ตอบกลับฟรี ถามได้ไม่จำกัด):",
    "• ขอแนวรับ → แนวรับของหุ้นทุกตัวที่ติดตาม",
    `• ขอแนวรับของ ${first} → เฉพาะตัวที่ต้องการ`,
    ...(second ? [`• ขอแนวรับ ${first} ${second} → หลายตัวพร้อมกัน`] : []),
    "",
    "แนวรับมี 3 ระดับ: แนวรับแรก (ใกล้ราคาปัจจุบัน) · แนวรับถัดไป · แนวรับสำคัญ (ระยะยาว)",
  ];
  if (symbols.length > 0) {
    const listed = symbols.slice(0, MAX_LISTED).join(", ");
    lines.push(`หุ้นที่ติดตามอยู่: ${listed}${symbols.length > MAX_LISTED ? " …" : ""}`);
  }
  lines.push("", 'พิมพ์ "วิธีใช้" เพื่อดูข้อความนี้อีกครั้ง', "การแจ้งเตือนอัตโนมัติเมื่อราคาแตะแนวรับ ต้องให้เจ้าของระบบเปิดรับให้ก่อน");
  return lines.join("\n");
}

/** Sent (push) when the owner switches alerts ON for someone on the "ผู้รับแจ้งเตือน" page. */
export function formatNotifyEnabledNotice(symbols: string[]): string {
  const lines = [
    "🔔 เปิดรับแจ้งเตือนให้บัญชีนี้แล้ว",
    "",
    "บัญชีของคุณจะได้รับข้อความจาก LINE นี้ เมื่อราคาหุ้นที่กำหนดไว้ในระบบเข้าแนวรับ โดยระบบเช็กราคาตามเวลาตลาดหุ้น US",
  ];
  if (symbols.length > 0) {
    lines.push("", `หุ้นที่ติดตามอยู่: ${symbols.slice(0, MAX_LISTED).join(", ")}${symbols.length > MAX_LISTED ? " …" : ""}`);
  }
  lines.push("", 'ดูแนวรับตอนนี้ได้เลย พิมพ์ "ขอแนวรับ" (หรือ "วิธีใช้" เพื่อดูคำสั่งทั้งหมด)');
  return lines.join("\n");
}

