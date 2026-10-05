import { AiError, chat } from "@/lib/ai/client";
import { buildStockInput, buildUserPrompt, MANUAL_PROMPT_RULES, SYSTEM_PROMPT, type StockInput } from "@/lib/analysis/prompt";
import { AnalysisParseError, parseAnalysis } from "@/lib/analysis/parse";
import type { AnalysisPick, AnalysisView, GoalId } from "@/lib/analysis/types";
import { config } from "@/lib/config";
import { cancelAnalysis, finishAnalysis, getAnalysis, startAnalysis } from "@/lib/db/analyses";
import { listProfiles } from "@/lib/db/profiles";
import { listSupportTests } from "@/lib/db/supports";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { nyToday } from "@/lib/market/calendar";
import { withTimeout } from "@/lib/timeout";
import { toProfileData } from "@/lib/profile/describe";
import { summarizeTrack } from "@/lib/support/track";
import { getLivePrices } from "./livePrices";

const PRICE_BUDGET_MS = 8000;

export type AnalysisErrorCode = "bad_request" | "not_configured" | "no_symbols" | "limit" | "timeout" | "ai" | "parse";

/** `message` is user-safe (shown on the page). */
export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly code: AnalysisErrorCode,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

/**
 * Ask the AI to rank the tracked stocks for the given goals, and store the run.
 *
 * Order matters for cost: configuration and "is there anything to analyse" are checked first (free); then a run is
 * reserved (it counts toward AI_DAILY_LIMIT whatever happens next); only then are prices fetched and the provider called.
 */
export async function runAnalysis(goals: GoalId[], opts: { model?: string } = {}, now = new Date()): Promise<AnalysisView> {
  const missing = config.ai.missing();
  if (missing.length > 0) throw new AnalysisError(`ยังไม่ได้ตั้งค่า ${missing.join(", ")} ใน environment variables`, "not_configured");

  // The chosen model goes first; the others stay as fallbacks. Only models listed in AI_MODEL can be chosen.
  const configured = config.ai.models();
  if (opts.model !== undefined && !configured.includes(opts.model)) throw new AnalysisError("โมเดลที่เลือกไม่อยู่ในรายการ AI_MODEL", "bad_request");
  const models = opts.model === undefined ? configured : [opts.model, ...configured.filter((m) => m !== opts.model)];

  const data = await loadData();
  const day = nyToday(now);
  const id = await startAnalysis(day, goals, models[0], config.ai.dailyLimit());
  if (id === null) {
    throw new AnalysisError(`ใช้ครบ ${config.ai.dailyLimit()} ครั้งของวันนี้แล้ว (ปรับได้ด้วย AI_DAILY_LIMIT) ลองใหม่พรุ่งนี้`, "limit");
  }

  try {
    const stocks = await stockInputs(data, day);
    const reply = await chat({ system: SYSTEM_PROMPT, user: buildUserPrompt(goals, stocks, day), models });
    const parsed = parseAnalysis(reply.text, data.tracked.map((s) => s.symbol));

    const picks: AnalysisPick[] = parsed.picks.map((p) => ({ ...p, price: stocks.find((s) => s.symbol === p.symbol)?.price ?? null }));
    await finishAnalysis(id, {
      ok: true,
      model: reply.model,
      result: { summary: parsed.summary, picks, caveats: parsed.caveats, universe: data.tracked.length, skipped: reply.skipped },
    });
    const view = await getAnalysis(id);
    if (!view) throw new Error("analysis row missing after save");
    return view;
  } catch (err) {
    const error =
      err instanceof AnalysisParseError
        ? new AnalysisError(`${err.message} — ลองใหม่อีกครั้ง (หรือเลือกโมเดลที่ทำตามคำสั่งได้ดีกว่า)`, "parse")
        : err instanceof AiError
          ? new AnalysisError(err.message, err.kind === "timeout" ? "timeout" : "ai")
          : new AnalysisError("วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง", "ai");
    if (!(err instanceof AiError) && !(err instanceof AnalysisParseError)) console.error("analysis failed", err);
    // A request the provider turned away (bad key/model, over quota, overloaded) cost nothing: give the run back.
    // One that may have been processed (timeout, empty or unusable reply) stays counted.
    const refund = err instanceof AiError && !err.billable;
    await (refund ? cancelAnalysis(id) : finishAnalysis(id, { ok: false, error: error.message })).catch((e) => console.error("could not record the failed run", e));
    throw error;
  }
}

type Data = Awaited<ReturnType<typeof loadData>>;

/** Tracked stocks with their profiles and level history (database only). */
async function loadData() {
  const [tracked, profiles, tests] = await Promise.all([
    listTrackedSymbols(),
    listProfiles().catch(() => []),
    listSupportTests().catch(() => []),
  ]);
  if (tracked.length === 0) throw new AnalysisError("ยังไม่มีหุ้นที่ track — เพิ่มที่หน้าจัดการหุ้นก่อน", "no_symbols");
  return { tracked, profiles, tests };
}

/**
 * What the AI gets per stock, with the current price: the shared live cache (Finnhub -> Yahoo), else the price saved by
 * the scheduled check. Prices are capped at 8 s so they plus the AI call always fit in the function's 60 s (usually
 * instant: the cache is shared with the dashboard).
 */
async function stockInputs({ tracked, profiles, tests }: Data, day: string): Promise<StockInput[]> {
  const live: Record<string, { price: number }> = await withTimeout(getLivePrices(tracked.map((s) => s.symbol)), PRICE_BUDGET_MS, "live prices")
    .then((r) => r.prices)
    .catch(() => ({}));
  return tracked.map((s) => {
    const profile = profiles.find((x) => x.symbol === s.symbol);
    return buildStockInput(
      s,
      live[s.symbol]?.price ?? s.price,
      profile ? toProfileData(profile) : undefined,
      summarizeTrack(tests.filter((t) => t.symbol === s.symbol), day),
      day,
    );
  });
}

/**
 * The same instructions and data as an in-app run, as one text to paste into any AI chat. No provider call, no quota,
 * no AI settings needed: the way out when the quota is used up or the provider is down.
 */
export async function manualPrompt(goals: GoalId[], now = new Date()): Promise<string> {
  const day = nyToday(now);
  const stocks = await stockInputs(await loadData(), day);
  return `${MANUAL_PROMPT_RULES}\n\n---\n\n${buildUserPrompt(goals, stocks, day)}`;
}
