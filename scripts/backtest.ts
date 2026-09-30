/**
 * Walk-forward backtest of the real support logic on the tracked stocks. See src/lib/backtest/engine.ts.
 *
 *   set -a; source .env.local; set +a
 *   npm run backtest                        # tracked symbols from the database
 *   npm run backtest -- --symbols NVDA,AMD  # specific symbols
 *   npm run backtest -- --refresh           # re-download the price history instead of using the cache
 *
 * Writes docs/backtest-report.md and docs/backtest-events.csv. Uses ~1 Twelve Data credit per symbol the first time
 * (the free plan allows 8 per minute, so it pauses between batches); afterwards the cache is used.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { baselineSamples, findTouchEvents, NEAR_PEAK, WARMUP_BARS, type DaySample, type TouchEvent } from "@/lib/backtest/engine";
import { baselineBySymbol, bySymbolMonth, bySymbolYear, bySymbolYearBucket, makeBucketer, mean, summarize, type GroupSummary, type Row } from "@/lib/backtest/stats";
import { listSymbols } from "@/lib/db/symbols";
import { lastCompletedSession } from "@/lib/market/calendar";
import { twelveData } from "@/lib/stock/twelvedata";
import type { Candle, Tier } from "@/lib/support/types";
import { TIER_LABEL_TH } from "@/lib/support/types";
import { TRACK_RULES, trackLevels, type LevelTest } from "@/lib/support/track";
import { config } from "@/lib/config";
import { sql } from "@/lib/db/client";

const BARS = 1400; // ~5.5 years of daily bars
const CACHE = ".backtest-cache/candles.json";
const REPORT = "docs/backtest-report.md";
const EVENTS_CSV = "docs/backtest-events.csv";
const TIERS: Tier[] = ["minor", "intermediate", "major"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function loadCandles(symbols: string[], refresh: boolean): Promise<Record<string, Candle[]>> {
  const cached: Record<string, Candle[]> = !refresh && existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")).candles ?? {}) : {};
  const missing = symbols.filter((s) => !cached[s]);
  for (let i = 0; i < missing.length; i += 8) {
    if (i > 0) {
      console.log("  waiting 61s (Twelve Data free plan: 8 credits/minute)…");
      await sleep(61_000);
    }
    const chunk = missing.slice(i, i + 8);
    console.log(`  downloading ${BARS} daily bars: ${chunk.join(", ")}`);
    const result = await twelveData.getDailyCandles(chunk, BARS);
    Object.assign(cached, result.data);
    for (const [s, e] of Object.entries(result.errors)) console.log(`  ! ${s}: ${e}`);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), bars: BARS, candles: cached }));
  return cached;
}

const pct = (x: number, digits = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%` : "–");
const pts = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} จุด` : "–");
const share = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–");

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

const headerCols = ["กลุ่ม", "จำนวนครั้ง", "เฉลี่ย 20 วัน", "% ที่เป็นบวก", "เลวร้าย 10% ล่าง", "ลงลึกสุดเฉลี่ย (20 วัน)", "ปิดต่ำกว่าทุน ≥3%", "**ส่วนต่างเฉลี่ย 20 วัน [ช่วงเชื่อมั่น 90%]**", "ส่วนต่าง % บวก", "ส่วนต่าง ลงลึก", "ส่วนต่าง ปิดต่ำ ≥3%"];
function summaryRow(label: string, s: GroupSummary): string[] {
  const ci = s.excess.ret20;
  return [
    label,
    String(s.n),
    pct(s.ret[20].mean),
    share(s.pos20),
    pct(s.p10_20),
    pct(s.mae20),
    share(s.fell3),
    `**${pct(ci.mean)}** [${pct(ci.lo)}, ${pct(ci.hi)}]`,
    pts(s.excess.pos20),
    pts(s.excess.mae20),
    pts(s.excess.fell3),
  ];
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const only = arg("symbols")?.split(",").map((s) => s.trim().toUpperCase());
  const symbols = only ?? (await listSymbols());
  console.log(`backtest for ${symbols.length} symbols: ${symbols.join(", ")}`);

  const session = lastCompletedSession(new Date());
  const raw = await loadCandles(symbols, refresh);
  const candles: Record<string, Candle[]> = {};
  const skipped: string[] = [];
  for (const s of symbols) {
    const c = (raw[s] ?? []).filter((x) => x.date <= session);
    if (c.length < WARMUP_BARS + 65) skipped.push(`${s} (${c.length} bars)`);
    else candles[s] = c;
  }

  const events: TouchEvent[] = [];
  const samples: DaySample[] = [];
  for (const [s, c] of Object.entries(candles)) {
    events.push(...findTouchEvents(s, c));
    samples.push(...baselineSamples(s, c));
  }
  const bucketOf = makeBucketer(samples);
  const samplesB: Row[] = samples.map((x) => ({ ...x, bucket: bucketOf(x.symbol, x.prev5) }));
  const baseAll = baselineBySymbol(samples); // same stock, whole period
  const baseMonth = baselineBySymbol(samples, bySymbolMonth); // same stock, same calendar month (removes the market regime)
  const baseDip = baselineBySymbol(samplesB, bySymbolYearBucket); // same stock, same year, similar fall over the previous 5 days

  const closeRows = (evs: TouchEvent[]): Row[] => evs.map((e) => ({ symbol: e.symbol, date: e.date, bucket: bucketOf(e.symbol, e.atClose.prev5), ...e.atClose }));
  const levelRows = (evs: TouchEvent[]): Row[] => evs.filter((e) => e.atLevel).map((e) => ({ symbol: e.symbol, date: e.date, bucket: bucketOf(e.symbol, e.atLevel!.prev5), ...e.atLevel! }));
  const vsMonth = (rows: Row[]) => summarize(rows, baseMonth, bySymbolMonth);
  const vsDip = (rows: Row[]) => summarize(rows, baseDip, bySymbolYearBucket);
  const vsAll = (rows: Row[]) => summarize(rows, baseAll);
  const byTier = (t: Tier) => events.filter((e) => e.tier === t);
  const baselineAll = vsAll(samples);

  const dates = Object.values(candles).flatMap((c) => [c[WARMUP_BARS].date, c[c.length - 1].date]).sort();
  const years = [...new Set(events.map((e) => e.date.slice(0, 4)))].sort();
  const symbolsWithEvents = [...new Set(events.map((e) => e.symbol))];

  const sections: string[] = [];
  sections.push(`# Backtest ของระบบแนวรับ

สร้างเมื่อ ${new Date().toISOString().slice(0, 10)} ด้วย \`npm run backtest\` — ผลนี้**ไม่ใช่คำแนะนำการลงทุน** และผลในอดีตไม่รับประกันอนาคต

## ทดสอบอะไร
คำถาม: *"ถ้าซื้อเมื่อราคาแตะแนวรับตามที่ระบบแจ้งเตือน ผลหลังจากนั้นดีกว่า/ขาดทุนน้อยกว่าการซื้อวันอื่น ๆ ของหุ้นตัวเดียวกันหรือไม่"*

- **แนวรับเชิงโครงสร้างเท่านั้น:** Swing Low (รวมเป็นโซน นับจำนวนครั้งที่เด้ง), MA50/MA200, Fibonacci — Pivot รายวันถูกเอาออกแล้ว เพราะคำนวณใหม่จากแท่งเดียวทุกวันจึงเลื่อนตามราคาลงไปเรื่อย ๆ (ผลของเวอร์ชันที่ยังมี Pivot ดูได้จากประวัติ git ของไฟล์นี้)
- ใช้**โค้ดตัวจริงของระบบ** (\`computeSupports\` จัดระดับแรก/ถัดไป/สำคัญ + กติกาแจ้งเตือน \`evaluateTier\`) เดินย้อนทีละวัน
- **ไม่แอบดูอนาคต:** วันที่ t ใช้ข้อมูลถึงวัน t−1 เท่านั้น (เหมือนระบบจริงที่คำนวณหลังตลาดปิดวันก่อน)
- **นิยามการแตะ = เหมือนแจ้งเตือนจริง:** ราคาต่ำสุดของวัน ≤ แนวรับ + 0.3% แจ้งครั้งเดียวต่อระดับ จนกว่าราคาปิดจะเด้งเหนือแนวรับ +1% ถึงนับครั้งใหม่
- **ตัวเปรียบเทียบ (สำคัญที่สุด):** ซื้อที่ราคาปิด**ทุกวัน**ของหุ้นตัวเดียวกันในช่วงเดียวกัน ถ้าหุ้นขึ้นทั้งปี ทุกวิธีจะดูดีเอง จึงดูที่ "ส่วนต่างจากวันสุ่ม" ของหุ้นตัวเดียวกัน ไม่ใช่ผลตอบแทนดิบ
- **เข้าซื้อ 2 แบบ:** (ก) ที่ราคาปิดของวันที่แตะ (สมจริงกับการรอเห็นแจ้งเตือนแล้วซื้อ) (ข) สั่งซื้อจำกัดราคาที่ระดับแนวรับ ได้ราคาเท่ากับระดับ หรือราคาเปิดถ้าเปิดต่ำกว่า (กรณีดีที่สุด)
- **ตัวชี้วัด:** ผลตอบแทน 5/20/60 วันทำการหลังซื้อ, ลงลึกสุดภายใน 20 วัน, และสัดส่วนที่ราคาปิดต่ำกว่าราคาซื้อ ≥ 3% ภายใน 20 วัน (เรียกว่า "ปิดต่ำกว่าทุน ≥3%")

## ข้อมูล
- หุ้น ${Object.keys(candles).length} ตัว: ${Object.keys(candles).join(", ")}${skipped.length ? ` (ข้าม: ${skipped.join(", ")} ข้อมูลสั้นเกินไป)` : ""}
- ช่วงที่ทดสอบ ${dates[0]} ถึง ${dates[dates.length - 1]} (ราคาปรับ split แล้วจาก Twelve Data ไม่ปรับปันผล)
- เหตุการณ์แตะแนวรับทั้งหมด **${events.length} ครั้ง** จาก ${symbolsWithEvents.length} ตัว; วันเปรียบเทียบ ${samples.length} วัน
- รายละเอียดทุกเหตุการณ์อยู่ใน \`${EVENTS_CSV}\` (สร้างใหม่ได้ด้วย \`npm run backtest\` ไม่ได้เก็บใน git)`);

  const cols = headerCols;
  const baselineRow = ["*วันสุ่ม (ตัวเปรียบเทียบ)*", String(baselineAll.n), pct(baselineAll.ret[20].mean), share(baselineAll.pos20), pct(baselineAll.p10_20), pct(baselineAll.mae20), share(baselineAll.fell3), "–", "–", "–", "–"];
  const tierRows = (summ: (rows: Row[]) => GroupSummary, pick: (evs: TouchEvent[]) => Row[]) => [
    ...TIERS.map((t) => summaryRow(TIER_LABEL_TH[t], summ(pick(byTier(t))))),
    summaryRow("**ทุกระดับรวม**", summ(pick(events))),
  ];

  sections.push(`## ผลลัพธ์หลัก: ซื้อที่ราคาปิดของวันที่แตะ
"ส่วนต่าง" = ผลจริงลบสิ่งที่ตัวเปรียบเทียบได้ (ค่าบวกดีกว่า; ยกเว้น "ลงลึก" ค่าบวกหมายถึงลงน้อยลง และ "ปิดต่ำ ≥3%" ค่าลบดีกว่า)

### ก) เทียบกับหุ้นตัวเดียวกัน ทั้งช่วงเวลา
${table(cols, [...tierRows(vsAll, closeRows), baselineRow])}

### ข) เทียบกับหุ้นตัวเดียวกัน **ในเดือนเดียวกัน** (ตัดอิทธิพลตลาดขาขึ้น/ขาลงออก)
การแตะแนวรับเกิดตอนราคาลงอยู่แล้ว จึงกระจุกในช่วงตลาดอ่อนแอ การเทียบกับวันสุ่มทั้งช่วงจึงปนผลของ "ตลาดตอนนั้น" เข้าไป ตารางนี้เทียบกับวันอื่นในเดือนเดียวกันของหุ้นตัวเดียวกัน

${table(cols, tierRows(vsMonth, closeRows))}

### ค) เทียบกับหุ้นตัวเดียวกัน **ปีเดียวกัน ที่เพิ่งลงมาใกล้เคียงกัน** — ตารางที่เข้มที่สุด
หุ้นที่เพิ่งลงมักเด้งกลับมากกว่าวันปกติอยู่แล้ว (ไม่เกี่ยวกับแนวรับ) และผลแต่ละปียังขึ้นกับภาวะตลาด ตารางก)–ข) จึงอาจให้เครดิตแนวรับเกินจริง ตารางนี้แบ่งวันของแต่ละหุ้นในแต่ละปีเป็น 5 กลุ่มตามขนาดการลงของ 5 วันก่อนหน้า แล้วเทียบเหตุการณ์กับวันในกลุ่มเดียวกันของปีเดียวกัน จึงตอบว่า **"ระดับแนวรับเพิ่มอะไรนอกเหนือจากการที่ราคาเพิ่งลงและภาวะตลาดของปีนั้น"**

${table(cols, tierRows(vsDip, closeRows))}`);

  const filled = events.filter((e) => e.atLevel);
  sections.push(`## กรณีดีที่สุด: สั่งซื้อจำกัดราคาที่ระดับแนวรับ
เติมได้ ${filled.length} จาก ${events.length} ครั้ง (${share(filled.length / Math.max(1, events.length))}) — ที่เหลือราคาเข้าใกล้แต่ไม่ถึงระดับ สั่งจำกัดราคาไม่ติด

### เทียบเดือนเดียวกัน
${table(cols, tierRows(vsMonth, levelRows))}

### เทียบปีเดียวกัน ที่เพิ่งลงมาใกล้เคียงกัน (เข้มที่สุด)
${table(cols, tierRows(vsDip, levelRows))}`);

  // The premise to test directly: "buying near the peak is more likely to be followed by a pullback than buying at support"
  const baseYear = baselineBySymbol(samples, bySymbolYear);
  const vsYear = (rows: Row[]) => summarize(rows, baseYear, bySymbolYear);
  const nearPeak = samples.filter((x) => x.fromHigh60 >= -NEAR_PEAK);
  const farFromPeak = samples.filter((x) => x.fromHigh60 < -NEAR_PEAK);
  const peakRows: [string, GroupSummary][] = [
    [`ซื้อใกล้จุดสูงสุด (ปิดห่างจากจุดสูงสุด 60 วันไม่เกิน ${NEAR_PEAK * 100}%) — ${share(nearPeak.length / samples.length)} ของวัน`, vsYear(nearPeak)],
    ["ซื้อวันที่ไม่ได้อยู่ใกล้จุดสูงสุด", vsYear(farFromPeak)],
    ["ซื้อวันไหนก็ได้ (ทุกวัน)", vsYear(samples)],
    ["ซื้อตอนแตะแนวรับ (ทุกระดับ)", vsYear(closeRows(events))],
    ["ซื้อตอนแตะ แนวรับแรก+ถัดไป", vsYear(closeRows([...byTier("minor"), ...byTier("intermediate")]))],
    ["ซื้อตอนแตะ แนวรับสำคัญ", vsYear(closeRows(byTier("major")))],
  ];
  sections.push(`## ตรวจสมมติฐาน: "ซื้อช่วงพีคย่อตัวมากกว่า" เทียบกับ "ซื้อตอนแตะแนวรับ"
ตัวเปรียบเทียบคือวันอื่น ๆ ของหุ้นตัวเดียวกันในปีเดียวกัน (ตัดภาวะตลาดของปี) ค่าในช่อง "ปิดต่ำกว่าทุน ≥3%" ยิ่งต่ำยิ่งดี

${table(cols, peakRows.map(([label, sm]) => summaryRow(label, sm)))}`);

  const methodGroups: [string, (e: TouchEvent) => boolean][] = [
    ["MA50", (e) => e.method === "ma50"],
    ["MA200", (e) => e.method === "ma200"],
    ["Swing Low (เด้งครั้งเดียว)", (e) => e.method === "swing_low" && (e.touches ?? 0) < 2],
    ["Swing Low (เด้ง ≥2 ครั้ง)", (e) => e.method === "swing_low" && (e.touches ?? 0) >= 2],
    ["Fibonacci", (e) => e.method.startsWith("fib")],
  ];
  sections.push(`## แยกตามชนิดของแนวรับ (ซื้อที่ราคาปิด)
ทุกชนิดเป็นระดับเชิงโครงสร้าง (Pivot รายวันถูกเอาออกแล้ว) — Swing Low แยกตามจำนวนครั้งที่ราคาเคยเด้งในโซนนั้น

### เทียบเดือนเดียวกัน
${table(cols, methodGroups.map(([label, test]) => summaryRow(label, vsMonth(closeRows(events.filter(test))))))}

### เทียบปีเดียวกัน ที่เพิ่งลงมาใกล้เคียงกัน (เข้มที่สุด)
${table(cols, methodGroups.map(([label, test]) => summaryRow(label, vsDip(closeRows(events.filter(test))))))}`);

  sections.push(`## แยกตามปี (ทุกระดับ, ซื้อที่ราคาปิด, เทียบปีเดียวกันที่เพิ่งลงใกล้เคียงกัน)
ดูว่าผลคงที่ข้ามช่วงตลาดหรือไม่ (2022 เป็นตลาดหมี)

${table(["ปี", ...cols.slice(1)], years.map((y) => summaryRow(y, vsDip(closeRows(events.filter((e) => e.date.startsWith(y)))))))}`);

  sections.push(`## แยกตามหุ้น (ทุกระดับ, ซื้อที่ราคาปิด, เทียบปีเดียวกันที่เพิ่งลงใกล้เคียงกัน)

${table(cols, symbolsWithEvents.map((s) => summaryRow(s, vsDip(closeRows(events.filter((e) => e.symbol === s))))))}`);

  // Did the levels hold? Same replay the dashboard shows under each level, against the same rule on random prices.
  const tests: LevelTest[] = Object.values(candles).flatMap((c) => trackLevels(c));
  const holdRow = (label: string, group: LevelTest[]) => {
    const done = group.filter((t) => t.outcome !== "open" && t.expectedHeld !== null);
    const n = done.length;
    const held = done.filter((t) => t.outcome === "held").length / n;
    const broken = done.filter((t) => t.outcome === "broken").length / n;
    const expected = mean(done.map((t) => t.expectedHeld!));
    return [label, String(n), share(held), share(broken), share(1 - held - broken), share(expected), n ? `**${pts(held - expected)}**` : "–"];
  };
  const testGroups: [string, (t: LevelTest) => boolean][] = [
    ...TIERS.map((tier): [string, (t: LevelTest) => boolean] => [TIER_LABEL_TH[tier], (t) => t.tier === tier]),
    ["MA50", (t) => t.method === "ma50"],
    ["MA200", (t) => t.method === "ma200"],
    ["Swing Low (เด้งครั้งเดียว)", (t) => t.method === "swing_low" && (t.touches ?? 0) < 2],
    ["Swing Low (เด้ง ≥2 ครั้ง)", (t) => t.method === "swing_low" && (t.touches ?? 0) >= 2],
    ["Fibonacci", (t) => t.method.startsWith("fib")],
  ];
  sections.push(`## แนวรับ "รับได้" หรือ "หลุด" บ่อยแค่ไหน (ตัวเลขเดียวกับที่หน้าเว็บแสดงใต้แต่ละระดับ)
ทุกครั้งที่ราคาแตะระดับ ระบบ**จำราคาระดับนั้นไว้** (ไม่ใช้ค่าที่คำนวณใหม่วันถัดไป) แล้วดูว่าเกิดอะไรก่อนภายใน ${TRACK_RULES.maxDays} วันทำการ: ราคาปิดเด้งขึ้น ≥${TRACK_RULES.bounce * 100}% จากระดับ = **รับได้**, ราคาปิดต่ำกว่าระดับ (หรือขอบล่างของโซน) เกิน ${TRACK_RULES.breakBelow * 100}% = **หลุด**, ไม่เกิดทั้งสอง = ไม่ชัด
"รับได้" อย่างเดียวพิสูจน์อะไรไม่ได้ (วันที่แตะ ราคาปิดมักอยู่เหนือระดับอยู่แล้ว จึงไปถึง +3% ง่ายกว่า −3%) ตัวเปรียบเทียบจึงเอา**ระยะห่างจากราคาปิดวันก่อนเท่ากัน**ไปวางเป็น "แนวรับมั่ว ๆ" ในทุกวันอื่นของหุ้นตัวเดียวกันที่ราคาแตะระดับนั้น แล้วใช้กติกาเดียวกัน (ทดสอบกับราคาสุ่มแบบ random walk แล้ว สองค่านี้ออกมาเท่ากัน ตามที่ควรเป็นเมื่อไม่มีแนวรับจริง)

${table(["กลุ่ม", "จำนวนครั้งที่แตะ", "รับได้", "หลุด", "ไม่ชัด", "รับได้ (ระดับมั่ว ระยะเท่ากัน)", "**ส่วนต่าง**"], testGroups.map(([label, f]) => holdRow(label, tests.filter(f))))}`);

  // how noisy would the live alerts be? (every event = one alert the live rules would have sent)
  const tradingDays = new Set(samples.map((x) => x.date)).size;
  const daysWithAlert = new Set(events.map((e) => e.date)).size;
  const months = tradingDays / 21;
  const alertTiers = config.alertTiers();
  const alertDays = new Set(events.filter((e) => alertTiers.includes(e.tier)).map((e) => e.date)).size;
  sections.push(`## ความถี่ของแจ้งเตือน (ถ้ารันกติกานี้ย้อนหลัง)
- เหตุการณ์ทั้งหมด ${events.length} ครั้ง ≈ **${(events.length / Object.keys(candles).length / months).toFixed(1)} ครั้งต่อหุ้นต่อเดือน** (แนวรับแรก ${(byTier("minor").length / Object.keys(candles).length / months).toFixed(1)}, ถัดไป ${(byTier("intermediate").length / Object.keys(candles).length / months).toFixed(1)}, สำคัญ ${(byTier("major").length / Object.keys(candles).length / months).toFixed(1)})
- มีอย่างน้อย 1 แจ้งเตือนใน **${share(daysWithAlert / tradingDays)} ของวันทำการ** (รวมทุกหุ้น) ≈ ${(21 * daysWithAlert / tradingDays).toFixed(0)} ข้อความต่อเดือนต่อผู้รับ เพราะระบบรวมแจ้งเตือนของวันเดียวกันเป็นข้อความเดียว — เทียบกับโควตา push ของ LINE ที่จำกัดต่อเดือน
- ระบบจริงแจ้งเตือนเฉพาะ: **${alertTiers.map((t) => TIER_LABEL_TH[t]).join(", ")}** (ตั้งด้วย \`ALERT_TIERS\`) → มีแจ้งเตือนใน ${share(alertDays / tradingDays)} ของวันทำการ ≈ **${(21 * alertDays / tradingDays).toFixed(0)} ข้อความต่อเดือนต่อผู้รับ**`);

  sections.push(`## ข้อจำกัดที่ต้องอ่านก่อนสรุปอะไร
1. **ตัวอย่างน้อยและกระจุกตัว:** เหตุการณ์ที่เกิดใกล้กัน (หุ้นตัวเดียวกันแตะหลายระดับใกล้ ๆ กัน หรือหลายตัวแตะพร้อมกันตอนตลาดลง) ไม่เป็นอิสระต่อกัน ช่วงเชื่อมั่นจาก bootstrap จึง**แคบกว่าความไม่แน่นอนจริง**
2. **ช่วงเวลาสั้น:** ~5.5 ปี มีขาขึ้นแรงของกลุ่ม semiconductor/AI เป็นส่วนใหญ่ ผลจึงผูกกับช่วงนี้
3. **Survivorship bias:** หุ้นที่ track คือตัวที่ผู้ใช้เลือกในวันนี้ ซึ่งผ่านมารอดและโตมาแล้ว ตัวที่ตกลงไปแล้วไม่อยู่ในรายการ
4. **ราคาในแท่งวัน:** ไม่รู้ลำดับเวลาภายในวัน (ราคาต่ำสุดเกิดก่อนหรือหลังที่ระบบเช็ก) และระบบจริงเช็กตอน 13:30 น. นิวยอร์ก ซึ่งอาจยังไม่เห็นราคาต่ำสุดของทั้งวัน จึงอาจจับการแตะได้น้อยกว่าในการทดสอบนี้
5. **ไม่รวมค่าธรรมเนียม ภาษี การลื่นไถลของราคา** และไม่จำลองการแบ่งไม้หลายครั้ง วัดเฉพาะ "ซื้อที่จุดที่แตะ" ทีละครั้ง
6. **พารามิเตอร์ของระบบ** (เช่น 5 แท่ง, โซนกว้าง 1.5%, 250/120 แท่ง, ±3% ใน 20 วัน) เป็นค่ามาตรฐานที่เลือกเอง ไม่ได้ปรับจูนจากผลนี้ (ตั้งใจ เพื่อไม่ให้ overfit) ถ้าไปปรับจนผลดี ผลนั้นจะเชื่อถือไม่ได้`);

  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, sections.join("\n\n") + "\n");

  const csv = ["symbol,date,tier,method,level,fill_at_level,ret5_close,ret20_close,ret60_close,mae20_close,fell3_close,ret20_level"];
  for (const e of events) {
    csv.push(
      [e.symbol, e.date, e.tier, e.method, e.level.toFixed(4), e.atLevel ? 1 : 0, e.atClose.ret[5] ?? "", e.atClose.ret[20] ?? "", e.atClose.ret[60] ?? "", e.atClose.mae20 ?? "", e.atClose.fell3 === null ? "" : e.atClose.fell3 ? 1 : 0, e.atLevel?.ret[20] ?? ""].join(","),
    );
  }
  writeFileSync(EVENTS_CSV, csv.join("\n") + "\n");

  console.log(`\n${events.length} events, ${samples.length} baseline days, mean 20d baseline ${pct(mean(samples.map((s) => s.ret[20]).filter((v): v is number => v !== null)))}`);
  console.log(`wrote ${REPORT} and ${EVENTS_CSV}`);
  await sql().end({ timeout: 2 }).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
