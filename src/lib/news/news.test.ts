import { describe, expect, it } from "vitest";
import { toBriefView } from "@/lib/db/news";
import { briefWindow } from "@/lib/jobs/news";
import { articleText, skipsFullText } from "./extract";
import { parseNews } from "./finnhub";
import { parseBrief } from "./parse";
import { buildNewsPrompt, selectArticles, type BriefArticle } from "./prompt";
import { matcher, namesFor, relevance } from "./relevance";

describe("namesFor / matcher", () => {
  it("uses the ticker and the company's short name", () => {
    expect(namesFor("NVDA", "NVIDIA Corp")).toEqual(["NVDA", "NVIDIA"]);
    expect(namesFor("PLTR", "Palantir Technologies Inc")).toEqual(["PLTR", "Palantir"]);
    expect(namesFor("AVGO", "Broadcom Inc")).toEqual(["AVGO", "Broadcom"]);
  });

  it("takes two words when the first is too common, and adds known aliases", () => {
    expect(namesFor("AMD", "Advanced Micro Devices Inc")).toEqual(["AMD", "Advanced Micro"]);
    expect(namesFor("TSM", "Taiwan Semiconductor Manufacturing Co Ltd")).toEqual(["TSM", "TSMC", "Taiwan Semiconductor"]);
    expect(namesFor("ARM", "Arm Holdings PLC ADR")).toEqual(["ARM"]); // "arm" alone is an English word
  });

  it("matches whole words; the ticker only in capitals, names in any case", () => {
    const count = matcher("AMD", namesFor("AMD", "Advanced Micro Devices Inc"));
    expect(count("AMD and $AMD rose; advanced micro devices too")).toBe(3);
    expect(count("AMDOCS fell, amd lowercase is not the ticker")).toBe(0);
    const arm = matcher("ARM", ["ARM"]);
    expect(arm("an arm of the company")).toBe(0);
    expect(arm("ARM shares rose")).toBe(1);
  });

  it("scores headline mentions highest and ignores a single passing mention in the text", () => {
    const count = matcher("NVDA", ["NVDA", "Nvidia"]);
    expect(relevance(count, { headline: "Nvidia hits a record", summary: "", body: null })).toBe(6);
    expect(relevance(count, { headline: "Chip stocks", summary: "", body: "a list: AAPL, NVDA, MSFT" })).toBe(0);
    expect(relevance(count, { headline: "Chip stocks", summary: "", body: "Nvidia ... Nvidia ... NVDA" })).toBe(1.5);
    expect(relevance(count, { headline: "Novo falls", summary: "weight loss drugs", body: "nothing here" })).toBe(0);
  });
});

describe("parseNews", () => {
  const since = new Date("2026-10-05T00:00:00Z");
  it("keeps complete items newer than `since`, keyed by Finnhub id", () => {
    const json = [
      { id: 7, datetime: Date.parse("2026-10-06T12:00:00Z") / 1000, headline: " Nvidia  up ", summary: "s", source: "Yahoo", url: "https://finnhub.io/api/news?id=x" },
      { id: 8, datetime: Date.parse("2026-10-01T12:00:00Z") / 1000, headline: "old", source: "Yahoo", url: "https://a" },
      { id: 9, datetime: Date.parse("2026-10-06T12:00:00Z") / 1000, headline: "no link", source: "Yahoo", url: "javascript:x" },
      { datetime: Date.parse("2026-10-06T12:00:00Z") / 1000, headline: "no id", url: "https://a" },
    ];
    const out = parseNews(json, "company", "NVDA", since);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "fh:7", scope: "company", symbols: ["NVDA"], headline: "Nvidia up", source: "Yahoo" });
    expect(parseNews({ error: "x" }, "market", null, since)).toEqual([]);
  });
});

describe("articleText", () => {
  it("returns the article's text and drops the page around it", () => {
    const para = "Shares of the chip maker rose after the company raised its outlook for data center demand. ".repeat(4);
    const html = `<html><head><title>t</title></head><body><nav>Home Markets Sign in</nav>
      <article><h1>Headline</h1>${Array.from({ length: 6 }, (_, i) => `<p>${i} ${para}</p>`).join("")}</article>
      <footer>Copyright footer links</footer></body></html>`;
    const text = articleText(html)!;
    expect(text).toContain("raised its outlook");
    expect(text).not.toContain("Sign in");
    expect(text).not.toMatch(/\s{2}/);
  });

  it("knows the sources that always refuse readers", () => {
    expect(skipsFullText("SeekingAlpha")).toBe(true);
    expect(skipsFullText("Benzinga")).toBe(true);
    expect(skipsFullText("Yahoo")).toBe(false);
  });
});

const at = (iso: string) => new Date(iso);
const art = (over: Partial<BriefArticle>): BriefArticle => ({
  scope: "company",
  source: "Yahoo",
  headline: "h",
  summary: "",
  url: "https://finnhub.io/x",
  finalUrl: null,
  publishedAt: at("2026-10-06T12:00:00Z"),
  body: null,
  ...over,
});
const tracked = [
  { symbol: "NVDA", companyName: "NVIDIA Corp" },
  { symbol: "TSM", companyName: "Taiwan Semiconductor Manufacturing Co Ltd" },
  { symbol: "PLTR", companyName: "Palantir Technologies Inc" },
];

describe("selectArticles", () => {
  it("files articles under every stock they discuss, drops ones about none, lists quiet stocks", () => {
    const sel = selectArticles(
      [
        art({ headline: "TSMC sales jump on Nvidia orders", body: "TSMC ... Nvidia ...".repeat(3) }),
        art({ headline: "Novo stock is down 70%. Value trap?", summary: "weight loss" }),
        art({ headline: "Is Nvidia a buy?", finalUrl: "https://www.fool.com/a", publishedAt: at("2026-10-06T13:00:00Z") }),
        art({ scope: "market", headline: "Oil rises as storms threaten supply" }),
      ],
      tracked,
    );
    expect(sel.articles.map((a) => a.headline)).toEqual(["Oil rises as storms threaten supply", "Is Nvidia a buy?", "TSMC sales jump on Nvidia orders"]);
    expect(sel.articles.map((a) => a.n)).toEqual([1, 2, 3]);
    expect(sel.articles[2].symbols).toEqual(["NVDA", "TSM"]);
    expect(sel.articles[0].symbols).toEqual([]);
    expect(sel.articles[1].url).toBe("https://www.fool.com/a"); // the publisher's page once known
    expect(sel.articles[2].fullText).toBe(true);
    expect(sel.quiet).toEqual(["PLTR"]);
  });

  it("keeps the most relevant per stock, skips repeats of one story, and fits the text budget", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      art({ headline: `Nvidia story ${i}`, body: "x".repeat(10_000), publishedAt: at(`2026-10-06T${String(10 + i).padStart(2, "0")}:00:00Z`) }),
    );
    many.push(art({ headline: "NVIDIA story 9!" })); // same story, other punctuation
    const sel = selectArticles(many, tracked, { perStock: 4, market: 0, maxChars: 8000 });
    expect(sel.articles).toHaveLength(4);
    expect(sel.articles[0].headline).toBe("Nvidia story 9"); // equal relevance: newest first
    expect(sel.articles.reduce((n, a) => n + a.text.length, 0)).toBeLessThanOrEqual(8000 + 4);
    expect(sel.articles.every((a) => a.text.endsWith("…"))).toBe(true);
  });

  it("builds a prompt that numbers articles and says which are headline-only", () => {
    const sel = selectArticles([art({ headline: "Palantir wins Army deal", summary: "contract" })], tracked);
    const prompt = buildNewsPrompt(sel, tracked, at("2026-10-05T12:30:00Z"), at("2026-10-06T12:30:00Z"));
    expect(prompt).toContain("PLTR: 1");
    expect(prompt).toContain("NVDA: none");
    expect(prompt).toContain("[1] Yahoo · 2026-10-06 12:00 UTC · about: PLTR");
    expect(prompt).toContain("SUMMARY ONLY");
  });
});

describe("parseBrief", () => {
  it("keeps tracked symbols, valid labels and existing article numbers only", () => {
    const reply = `\`\`\`json
{"market":{"summary":"ตลาดขึ้น","points":[{"text":"น้ำมันขึ้น","kind":"fact","sources":[1,99]}]},
 "stocks":[
  {"symbol":"nvda","direction":"Positive","impact":"HIGH","summary":"ดี","points":[{"text":"ยอดขายโต","kind":"fact","sources":[2]},{"text":"ไม่มีแหล่ง","kind":"fact","sources":[]}]},
  {"symbol":"NVDA","direction":"negative"},
  {"symbol":"XYZ","direction":"negative"},
  {"symbol":"TSM","direction":"up","impact":"huge","points":[{"text":"มุมมอง","kind":"rumour","sources":[3]}]}
 ],"caveats":["บางข่าวอ่านได้แค่หัวข่าว"]}
\`\`\``;
    const b = parseBrief(reply, ["NVDA", "TSM"], 3);
    expect(b.market.points).toEqual([{ text: "น้ำมันขึ้น", kind: "fact", sources: [1] }]);
    expect(b.stocks.map((s) => s.symbol)).toEqual(["NVDA", "TSM"]);
    expect(b.stocks[0]).toMatchObject({ direction: "positive", impact: "high" });
    expect(b.stocks[0].points[1]).toEqual({ text: "ไม่มีแหล่ง", kind: "inference", sources: [] });
    expect(b.stocks[1]).toMatchObject({ direction: "neutral", impact: "low" });
    expect(b.stocks[1].points[0].kind).toBe("fact");
    expect(b.caveats).toEqual(["บางข่าวอ่านได้แค่หัวข่าว"]);
  });

  it("drops citation numbers and labels written into the text", () => {
    const b = parseBrief(
      '{"market":{"summary":"ดัชนีขึ้น [16] และน้ำมันขึ้น [1, 2]","points":[]},"stocks":[{"symbol":"NVDA","summary":"x","points":[{"text":"ความเห็นนักวิเคราะห์ (Opinion) ระบุว่า P/E ไม่แพง [16]","kind":"opinion","sources":[1]}]}]}',
      ["NVDA"],
      2,
    );
    expect(b.market.summary).toBe("ดัชนีขึ้น และน้ำมันขึ้น");
    expect(b.stocks[0].points[0].text).toBe("ความเห็นนักวิเคราะห์ ระบุว่า P/E ไม่แพง");
  });

  it("rejects a reply that is not the expected JSON", () => {
    expect(() => parseBrief("sorry, I cannot", ["NVDA"], 1)).toThrow("JSON");
    expect(() => parseBrief('{"market":{}}', ["NVDA"], 1)).toThrow("stocks");
  });
});

describe("briefWindow", () => {
  it("covers since the same time on the previous trading day", () => {
    // Tuesday 08:30 New York -> Monday 08:30
    const tue = at("2026-10-06T12:30:00Z");
    expect(briefWindow(tue).from.toISOString()).toBe("2026-10-05T12:30:00.000Z");
    // Monday 08:30 -> Friday 08:30 (the weekend's news)
    const mon = at("2026-10-05T12:30:00Z");
    expect(briefWindow(mon).from.toISOString()).toBe("2026-10-02T12:30:00.000Z");
    // the day after Thanksgiving (Fri 27 Nov 2026) -> Wednesday 08:30
    const fri = at("2026-11-27T13:30:00Z");
    expect(briefWindow(fri).from.toISOString()).toBe("2026-11-25T13:30:00.000Z");
  });
});

describe("toBriefView", () => {
  it("tolerates odd stored rows", () => {
    const created = at("2026-10-06T12:31:00Z");
    const v = toBriefView({ id: 1, created_at: created, trigger: "schedule", model: "m", window_from: null, window_to: null, result: "{bad json" });
    expect(v).toMatchObject({ trigger: "schedule", stocks: [], refs: [], market: { summary: "", points: [] }, windowFrom: created.toISOString() });
    const w = toBriefView({
      id: 2,
      created_at: created,
      trigger: "x",
      model: "m",
      window_from: created,
      window_to: created,
      result: { stocks: [{ symbol: "NVDA", direction: "positive", impact: "high", summary: "", points: [{ text: "t", kind: "fact" }] }] } as never,
    });
    expect(w.trigger).toBe("manual");
    expect(w.stocks[0].points[0].sources).toEqual([]);
  });
});
