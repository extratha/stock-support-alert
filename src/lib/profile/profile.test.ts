import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/support/types";
import { describeProfile, type ProfileData } from "./describe";
import { parseMetric, parseNextEarnings } from "./finnhub";
import { historyStats } from "./history";

const bar = (date: string, close: number, high = close, low = close): Candle => ({ date, open: close, high, low, close, volume: 1 });

describe("historyStats", () => {
  it("finds the worst peak-to-trough fall, its dates, and whether the peak was regained", () => {
    const c = [bar("2021-01-01", 100), bar("2021-02-01", 150), bar("2021-03-01", 60), bar("2021-04-01", 120), bar("2021-05-01", 160)];
    const s = historyStats(c)!;
    expect(s.maxDrawdown).toBeCloseTo(60 / 150 - 1); // -60%
    expect(s.peakDate).toBe("2021-02-01");
    expect(s.troughDate).toBe("2021-03-01");
    expect(s.recovered).toBe(true);
    expect(s.historyFrom).toBe("2021-01-01");
  });
  it("reports not recovered when the price never got back above the old peak", () => {
    const s = historyStats([bar("a", 100), bar("b", 50), bar("c", 90)])!;
    expect(s.maxDrawdown).toBeCloseTo(-0.5);
    expect(s.recovered).toBe(false);
  });
  it("uses the highest HIGH of the last 252 bars for the 52-week high", () => {
    const c = Array.from({ length: 300 }, (_, i) => bar(`d${i}`, 100, i === 10 ? 999 : i === 200 ? 130 : 101));
    expect(historyStats(c)!.high52w).toBe(130); // bar 10 is older than 52 weeks
  });
  it("a price that only went up has no drawdown", () => {
    expect(historyStats([bar("a", 1), bar("b", 2), bar("c", 3)])!.maxDrawdown).toBe(0);
  });
});

describe("Finnhub parsers", () => {
  it("reads the metrics we use and ignores missing ones", () => {
    expect(parseMetric({ metric: { peTTM: 28.7, forwardPE: 17, revenueGrowthTTMYoy: 83.4, netProfitMarginTTM: 63.7, beta: 2.2 } })).toEqual({
      pe: 28.7,
      forwardPe: 17,
      revenueGrowth: 83.4,
      netMargin: 63.7,
      beta: 2.2,
    });
    expect(parseMetric({ metric: { beta: 0.8 } })).toEqual({ pe: null, forwardPe: null, revenueGrowth: null, netMargin: null, beta: 0.8 });
    expect(parseMetric({})).toMatchObject({ pe: null, beta: null });
  });
  it("picks the earliest earnings date that is today or later", () => {
    const json = { earningsCalendar: [{ date: "2027-02-23", hour: "amc" }, { date: "2026-11-17", hour: "amc" }, { date: "2026-08-01", hour: "bmo" }] };
    expect(parseNextEarnings(json, "2026-09-30")).toEqual({ nextEarnings: "2026-11-17", earningsHour: "amc" });
    expect(parseNextEarnings({ earningsCalendar: [] }, "2026-09-30")).toEqual({ nextEarnings: null, earningsHour: null });
    expect(parseNextEarnings({}, "2026-09-30")).toEqual({ nextEarnings: null, earningsHour: null });
  });
});

const base: ProfileData = {
  symbol: "NVDA",
  pe: 28.7,
  forwardPe: 17,
  revenueGrowth: 83.4,
  netMargin: 63.7,
  beta: 2.2,
  nextEarnings: "2026-11-17",
  earningsHour: "amc",
  lastClose: 227.21,
  high52w: 236.54,
  maxDrawdown: -0.66,
  peakDate: "2021-11-29",
  troughDate: "2022-10-13",
  recovered: true,
  historyFrom: "2021-06-01",
  historyAt: "2026-09-30T22:00:00.000Z",
  fundamentalsAt: "2026-09-30T22:00:00.000Z",
};
const view = (p: Partial<ProfileData>, price: number | null = 227.21, today = "2026-09-30") => describeProfile({ ...base, ...p }, price, today);
const line = (p: Partial<ProfileData>, key: string, price?: number | null, today?: string) =>
  view(p, price, today).lines.find((l) => l.key === key);

describe("describeProfile: plain-language meaning", () => {
  it("shows all seven figures in a fixed order with a footnote naming the sources", () => {
    const v = view({});
    expect(v.lines.map((l) => l.key)).toEqual(["pe", "growth", "margin", "beta", "fromHigh", "drawdown", "earnings"]);
    expect(v.footnote).toContain("Finnhub");
    expect(v.footnote).toContain("ไม่ใช่คำแนะนำการลงทุน");
  });

  it("P/E: explains the number, places it vs the usual market range, and reads the forward P/E", () => {
    const pe = line({}, "pe")!;
    expect(pe.value).toBe("28.7 เท่า (ปีหน้า 17.0)");
    expect(pe.meaning).toContain("จ่าย $28.7 ต่อกำไร $1 ต่อปี");
    expect(pe.meaning).toContain("ช่วงทั่วไป");
    expect(pe.meaning).toContain("คาดว่ากำไรจะเพิ่มขึ้น");
    expect(line({ pe: 12, forwardPe: null }, "pe")!.meaning).toContain("ต่ำกว่าระดับทั่วไป");
    expect(line({ pe: 45, forwardPe: null }, "pe")).toMatchObject({ caution: true });
    expect(line({ pe: 80, forwardPe: null }, "pe")!.meaning).toContain("สูงมาก");
    expect(line({ pe: 20, forwardPe: 30 }, "pe")).toMatchObject({ caution: true });
    expect(line({ pe: 20, forwardPe: 30 }, "pe")!.meaning).toContain("คาดว่ากำไรจะลดลง");
    expect(line({ pe: 20, forwardPe: 21 }, "pe")!.meaning).toContain("ทรงตัว");
  });

  it("P/E: a loss-making company gets an explanation instead of a number; unknown P/E is simply omitted", () => {
    expect(line({ pe: null, netMargin: -12 }, "pe")).toMatchObject({ value: "–", caution: true });
    expect(line({ pe: null, netMargin: 10 }, "pe")).toBeUndefined();
  });

  it("revenue growth bands", () => {
    expect(line({ revenueGrowth: -8 }, "growth")).toMatchObject({ value: "-8%", caution: true });
    expect(line({ revenueGrowth: -8 }, "growth")!.meaning).toContain("หดตัว");
    expect(line({ revenueGrowth: 5 }, "growth")!.meaning).toContain("โตช้า");
    expect(line({ revenueGrowth: 15 }, "growth")!.meaning).toContain("ปานกลาง");
    expect(line({ revenueGrowth: 30 }, "growth")!.meaning).toBe("รายได้โตเร็ว");
    expect(line({ revenueGrowth: 83.4 }, "growth")!.value).toBe("+83%");
    expect(line({ revenueGrowth: 83.4 }, "growth")!.meaning).toContain("รักษาได้ยาก");
  });

  it("net margin in dollars per $100 of sales", () => {
    expect(line({}, "margin")!.meaning).toContain("ขายได้ $100 เหลือเป็นกำไรสุทธิ ราว $64");
    expect(line({ netMargin: -5 }, "margin")).toMatchObject({ caution: true });
    expect(line({ netMargin: -5 }, "margin")!.meaning).toContain("ขาดทุน $5");
    expect(line({ netMargin: 6 }, "margin")!.meaning).toContain("กำไรบาง");
  });

  it("beta as 'if the market falls 10%'", () => {
    const b = line({}, "beta")!;
    expect(b.meaning).toContain("แกว่งแรงกว่าตลาดราว 2.2 เท่า");
    expect(b.meaning).toContain("ถ้าตลาดลง 10% หุ้นนี้ลงโดยเฉลี่ยราว 22%");
    expect(b.caution).toBe(true);
    expect(line({ beta: 0.6 }, "beta")!.meaning).toContain("แกว่งน้อยกว่าตลาด");
    expect(line({ beta: 1.0 }, "beta")).toMatchObject({ caution: false });
  });

  it("distance from the 52-week high uses the price on the card, and never calls a fall 'cheap'", () => {
    const near = line({}, "fromHigh", 227.21)!;
    expect(near.value).toBe("-4%");
    expect(near.meaning).toContain("ใกล้จุดสูงสุด");
    expect(near.meaning).toContain("ไม่ได้แปลว่าถูก");
    expect(line({}, "fromHigh", 200)!.meaning).toContain("ย่อลงมา");
    expect(line({}, "fromHigh", 160)).toMatchObject({ caution: true });
    expect(line({}, "fromHigh", 100)!.meaning).toContain("ลงมาหนักมาก");
    expect(line({}, "fromHigh", 240)!.value).toBe("+0%"); // above the stored high: shown as at the high
    expect(line({}, "fromHigh", null)!.value).toBe("-4%"); // no live price: falls back to the last close
  });

  it("worst fall: $100 would have become how much, when, and whether it came back", () => {
    const d = line({}, "drawdown")!;
    expect(d.value).toBe("-66%");
    expect(d.meaning).toContain("เงิน $100 จะเหลือ $34");
    expect(d.meaning).toContain("29/11/2021 → 13/10/2022");
    expect(d.meaning).toContain("ราว 5 ปี");
    expect(d.meaning).toContain("กลับขึ้นไปสูงกว่าจุดสูงสุดเดิมได้แล้ว");
    expect(d.caution).toBe(true);
    expect(line({ recovered: false, maxDrawdown: -0.3 }, "drawdown")).toMatchObject({ caution: false });
    expect(line({ recovered: false }, "drawdown")!.meaning).toContain("ยังไม่กลับไปถึง");
    expect(line({ maxDrawdown: -0.05 }, "drawdown")!.meaning).toContain("ไม่เคยลงจากจุดสูงสุดเกิน 10%");
  });

  it("earnings: days away, time of day, and a caution in the last week", () => {
    const far = line({}, "earnings")!;
    expect(far.value).toBe("อีก 48 วัน");
    expect(far.meaning).toContain("17/11/2026 หลังตลาดปิด");
    expect(far.caution).toBe(false);
    expect(line({}, "earnings", 227, "2026-11-12")).toMatchObject({ value: "อีก 5 วัน", caution: true });
    expect(line({}, "earnings", 227, "2026-11-17")!.value).toBe("วันนี้");
    expect(line({}, "earnings", 227, "2026-11-18")).toBeUndefined(); // already past
    expect(line({ nextEarnings: null }, "earnings")).toBeUndefined();
  });

  it("nothing known yet: no lines, no footnote", () => {
    expect(describeProfile(undefined, 100, "2026-09-30")).toEqual({ lines: [], footnote: null });
    const empty = describeProfile({ symbol: "X", historyAt: null, fundamentalsAt: null }, null, "2026-09-30");
    expect(empty.lines).toEqual([]);
    expect(empty.footnote).toBeNull();
  });

  it("never uses buy/sell or 'cheap' wording", () => {
    const all = [view({}), view({ pe: 8, revenueGrowth: -20, netMargin: -3, beta: 3, maxDrawdown: -0.9 }, 50)]
      .flatMap((v) => v.lines.map((l) => l.meaning))
      .join(" ");
    for (const word of ["ควรซื้อ", "ควรขาย", "น่าซื้อ", "ราคาถูก", "พื้นฐานดี"]) expect(all).not.toContain(word);
  });
});
