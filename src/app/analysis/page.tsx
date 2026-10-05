import { AnalysisPanel } from "@/components/AnalysisPanel";
import { config } from "@/lib/config";
import { latestAnalysis, runsOnDay } from "@/lib/db/analyses";
import { nyToday } from "@/lib/market/calendar";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  // Both reads tolerate a missing table (before `db:migrate`): the page then simply starts empty.
  const [latest, used] = await withTimeout(
    Promise.all([latestAnalysis().catch(() => null), runsOnDay(nyToday()).catch(() => 0)]),
    PAGE_DATA_TIMEOUT_MS,
    "load the last analysis",
  );
  return <AnalysisPanel initial={latest} used={used} limit={config.ai.dailyLimit()} missing={config.ai.missing()} models={config.ai.models()} />;
}
