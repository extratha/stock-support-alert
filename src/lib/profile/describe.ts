import { formatDateString } from "@/lib/format/datetime";
import type { StockProfile } from "@/lib/db/profiles";

/** A stored profile as plain data (dates as ISO strings) so it can cross into client components. */
export type ProfileData = Omit<StockProfile, "historyAt" | "fundamentalsAt"> & { historyAt: string | null; fundamentalsAt: string | null };

export const toProfileData = (p: StockProfile): ProfileData => ({
  ...p,
  historyAt: p.historyAt ? p.historyAt.toISOString() : null,
  fundamentalsAt: p.fundamentalsAt ? p.fundamentalsAt.toISOString() : null,
});

/**
 * Turns the raw figures into plain Thai: what the number is, and what it means for someone holding the stock.
 * The thresholds are common rules of thumb (stated in the UI as such), not a verdict on the stock: nothing here says
 * "buy", "cheap" or "good". `caution` only marks figures that mean more risk or a known event ahead.
 */
export interface ProfileLine {
  key: "pe" | "growth" | "margin" | "beta" | "fromHigh" | "drawdown" | "earnings";
  label: string;
  value: string;
  meaning: string;
  caution: boolean;
}

export interface ProfileView {
  lines: ProfileLine[];
  /** where the numbers came from and how old they are */
  footnote: string | null;
}

const f1 = (n: number) => n.toFixed(1);
const pctText = (n: number, digits = 0) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
const money = (n: number) => `$${n.toFixed(0)}`;
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function describePe(p: ProfileData): ProfileLine | null {
  const pe = p.pe ?? null;
  const fwd = p.forwardPe ?? null;
  if (pe === null || pe <= 0) {
    if ((p.netMargin ?? 0) < 0) {
      return { key: "pe", label: "P/E", value: "–", meaning: "บริษัทยังขาดทุน จึงคำนวณ P/E ไม่ได้ ราคาหุ้นสะท้อนความหวังในอนาคตล้วน ๆ", caution: true };
    }
    return null;
  }
  const base = `ราคาหุ้นเท่ากับกำไรต่อหุ้นราว ${f1(pe)} ปี (จ่าย $${f1(pe)} ต่อกำไร $1 ต่อปี)`;
  let level: string;
  let caution = false;
  if (pe < 15) level = "ต่ำกว่าระดับทั่วไปของตลาดสหรัฐ (~15–25 เท่า) มักเป็นเพราะตลาดคาดว่ากำไรจะโตช้าหรือมีความเสี่ยงบางอย่าง";
  else if (pe <= 30) level = "อยู่ในช่วงทั่วไปของตลาดสหรัฐ";
  else if (pe <= 60) {
    level = "สูงกว่าทั่วไป ตลาดคาดหวังให้กำไรโตเร็ว ถ้าผลประกอบการออกมาต่ำกว่าที่คาด ราคามักถูกปรับลงแรง";
    caution = true;
  } else {
    level = "สูงมาก ราคาสะท้อนความคาดหวังในอนาคตเป็นหลัก แกว่งแรงเมื่อข่าวหรือผลประกอบการไม่เป็นไปตามคาด";
    caution = true;
  }
  let outlook = "";
  if (fwd !== null && fwd > 0) {
    if (fwd < pe * 0.85) outlook = ` · P/E ปีหน้า ${f1(fwd)} เท่า ต่ำกว่าปัจจุบัน แปลว่านักวิเคราะห์คาดว่ากำไรจะเพิ่มขึ้น`;
    else if (fwd > pe * 1.15) {
      outlook = ` · P/E ปีหน้า ${f1(fwd)} เท่า สูงกว่าปัจจุบัน แปลว่านักวิเคราะห์คาดว่ากำไรจะลดลง`;
      caution = true;
    } else outlook = ` · P/E ปีหน้า ${f1(fwd)} เท่า ใกล้เคียงเดิม (คาดว่ากำไรทรงตัว)`;
  }
  return {
    key: "pe",
    label: "P/E",
    value: fwd !== null && fwd > 0 ? `${f1(pe)} เท่า (ปีหน้า ${f1(fwd)})` : `${f1(pe)} เท่า`,
    meaning: `${base} — ${level}${outlook}`,
    caution,
  };
}

function describeGrowth(p: ProfileData): ProfileLine | null {
  const g = p.revenueGrowth ?? null;
  if (g === null) return null;
  let meaning: string;
  let caution = false;
  if (g < 0) {
    meaning = `รายได้ลดลง ${Math.abs(g).toFixed(0)}% จากปีก่อน ธุรกิจกำลังหดตัว`;
    caution = true;
  } else if (g < 10) meaning = "รายได้โตช้า ใกล้เคียงหรือต่ำกว่าเศรษฐกิจโดยรวม";
  else if (g < 25) meaning = "รายได้โตในระดับปานกลาง";
  else if (g < 50) meaning = "รายได้โตเร็ว";
  else {
    meaning = "รายได้โตเร็วมาก — การโตระดับนี้มักรักษาได้ยากในระยะยาว ถ้าเริ่มชะลอลง ราคามักแกว่งแรง";
  }
  return { key: "growth", label: "รายได้ (เทียบปีก่อน)", value: pctText(g), meaning, caution };
}

function describeMargin(p: ProfileData): ProfileLine | null {
  const m = p.netMargin ?? null;
  if (m === null) return null;
  const per100 = `ขายได้ $100 เหลือเป็นกำไรสุทธิ ${m >= 0 ? `ราว ${money(m)}` : `ขาดทุน ${money(Math.abs(m))}`}`;
  let level: string;
  let caution = false;
  if (m < 0) {
    level = "บริษัทยังขาดทุน";
    caution = true;
  } else if (m < 10) level = "กำไรบาง ต้นทุนที่เพิ่มขึ้นนิดเดียวก็กระทบกำไรได้มาก";
  else if (m < 20) level = "ระดับทั่วไป";
  else level = "สูง ธุรกิจมีอำนาจตั้งราคาหรือต้นทุนต่ำ";
  return { key: "margin", label: "อัตรากำไรสุทธิ", value: `${m.toFixed(0)}%`, meaning: `${per100} — ${level} (ระดับที่ถือว่าสูง/ต่ำต่างกันไปตามอุตสาหกรรม)`, caution };
}

function describeBeta(p: ProfileData): ProfileLine | null {
  const b = p.beta ?? null;
  if (b === null) return null;
  const move = `ในอดีต ถ้าตลาดลง 10% หุ้นนี้ลงโดยเฉลี่ยราว ${(b * 10).toFixed(0)}% (และตอนขึ้นก็ขึ้นในสัดส่วนเดียวกัน)`;
  let level: string;
  if (b < 0.8) level = "แกว่งน้อยกว่าตลาด";
  else if (b <= 1.2) level = "แกว่งใกล้เคียงตลาด";
  else level = `แกว่งแรงกว่าตลาดราว ${f1(b)} เท่า`;
  return { key: "beta", label: "ความผันผวน (Beta)", value: f1(b), meaning: `${level} — ${move}`, caution: b > 1.5 };
}

function describeFromHigh(p: ProfileData, price: number | null): ProfileLine | null {
  const high = p.high52w ?? null;
  const now = price ?? p.lastClose ?? null;
  if (high === null || now === null || high <= 0) return null;
  const d = (now / high - 1) * 100;
  let meaning: string;
  let caution = false;
  if (d >= -5) meaning = `ใกล้จุดสูงสุดของรอบปี ($${high.toFixed(2)})`;
  else if (d >= -20) meaning = `ย่อลงมาจากจุดสูงสุดของรอบปี ($${high.toFixed(2)})`;
  else if (d >= -40) {
    meaning = `ลงมาแรงจากจุดสูงสุดของรอบปี ($${high.toFixed(2)}) — ลงเกิน 20% มักนับเป็นขาลงของหุ้นตัวนั้น`;
    caution = true;
  } else {
    meaning = `ลงมาหนักมากจากจุดสูงสุดของรอบปี ($${high.toFixed(2)}) ควรดูว่ามีเหตุอะไรเกิดขึ้นกับบริษัท`;
    caution = true;
  }
  return { key: "fromHigh", label: "เทียบจุดสูงสุด 52 สัปดาห์", value: pctText(Math.min(0, d)), meaning: `${meaning} · ราคาที่ลงมาไม่ได้แปลว่าถูกเสมอไป`, caution };
}

function describeDrawdown(p: ProfileData, today: string): ProfileLine | null {
  const dd = p.maxDrawdown ?? null;
  if (dd === null || !p.peakDate || !p.troughDate || !p.historyFrom) return null;
  const pct = dd * 100;
  const years = Math.max(1, Math.round(daysBetween(p.historyFrom, today) / 365));
  if (pct > -10) {
    return {
      key: "drawdown",
      label: "ลงลึกสุดในอดีต",
      value: pctText(pct),
      meaning: `ตั้งแต่ ${formatDateString(p.historyFrom)} (ราว ${years} ปี) ราคาไม่เคยลงจากจุดสูงสุดเกิน 10% ช่วงข้อมูลอาจสั้นเกินไปที่จะเห็นช่วงตลาดแย่`,
      caution: false,
    };
  }
  const left = 100 * (1 + dd);
  const recovered = p.recovered
    ? "ต่อมาราคากลับขึ้นไปสูงกว่าจุดสูงสุดเดิมได้แล้ว"
    : "จนถึงตอนนี้ราคายังไม่กลับไปถึงจุดสูงสุดเดิม";
  return {
    key: "drawdown",
    label: "ลงลึกสุดในอดีต",
    value: pctText(pct),
    meaning:
      `ในช่วงราว ${years} ปีที่มีข้อมูล หุ้นนี้เคยลงจากจุดสูงสุด ${Math.abs(pct).toFixed(0)}% (${formatDateString(p.peakDate)} → ${formatDateString(p.troughDate)}) ` +
      `ถ้าซื้อที่จุดสูงสุดครั้งนั้น เงิน $100 จะเหลือ ${money(left)} ที่จุดต่ำสุด — ${recovered} · ใช้ดูว่าต้องทนการร่วงได้แค่ไหน`,
    caution: pct <= -50,
  };
}

const HOUR_TH: Record<string, string> = { bmo: "ก่อนตลาดเปิด", amc: "หลังตลาดปิด", dmh: "ระหว่างวัน" };

function describeEarnings(p: ProfileData, today: string): ProfileLine | null {
  if (!p.nextEarnings) return null;
  const days = daysBetween(today, p.nextEarnings);
  if (days < 0) return null;
  const when = `${formatDateString(p.nextEarnings)}${p.earningsHour && HOUR_TH[p.earningsHour] ? ` ${HOUR_TH[p.earningsHour]}` : ""} (เวลาสหรัฐ)`;
  const soon = days <= 7;
  return {
    key: "earnings",
    label: "ประกาศงบครั้งถัดไป",
    value: days === 0 ? "วันนี้" : `อีก ${days} วัน`,
    meaning: soon
      ? `${when} — ช่วงประกาศงบราคามักขึ้นหรือลงแรงในวันเดียว และอาจหลุดแนวรับได้ง่าย`
      : `${when} — ช่วงใกล้วันประกาศงบราคามักแกว่งแรงกว่าปกติ`,
    caution: soon,
  };
}

/** `price` = the price shown on the card (live if available); `today` = New York date YYYY-MM-DD. */
export function describeProfile(p: ProfileData | undefined, price: number | null, today: string): ProfileView {
  if (!p) return { lines: [], footnote: null };
  const lines = [
    describePe(p),
    describeGrowth(p),
    describeMargin(p),
    describeBeta(p),
    describeFromHigh(p, price),
    describeDrawdown(p, today),
    describeEarnings(p, today),
  ].filter((l): l is ProfileLine => l !== null);

  const parts: string[] = [];
  if (p.fundamentalsAt) parts.push(`ข้อมูลพื้นฐาน ณ ${formatDateString(p.fundamentalsAt.slice(0, 10))} จาก Finnhub`);
  if (p.historyAt) parts.push(`ราคาย้อนหลังจาก Twelve Data`);
  parts.push("เกณฑ์ที่ใช้แปลความหมายเป็นค่าประมาณทั่วไป ไม่ใช่คำแนะนำการลงทุน");
  return { lines, footnote: lines.length ? parts.join(" · ") : null };
}
