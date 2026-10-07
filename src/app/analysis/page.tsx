import { AnalysisPanel } from "@/components/AnalysisPanel";
import { config } from "@/lib/config";
import { latestAnalysis, runsOnDay } from "@/lib/db/analyses";
import { nyToday } from "@/lib/market/calendar";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "วิเคราะห์ด้วย AI", description: "AI จัดอันดับหุ้นที่ติดตามตามเป้าหมาย จากข้อมูลพื้นฐาน ความเสี่ยง แนวรับ และข่าวล่าสุด" };

export default async function AnalysisPage() {
  // Both reads tolerate a missing table (before `db:migrate`): the page then simply starts empty.
  const [latest, used] = await withTimeout(
    Promise.all([latestAnalysis().catch(() => null), runsOnDay(nyToday()).catch(() => 0)]),
    PAGE_DATA_TIMEOUT_MS,
    "load the last analysis",
  );
  if (!(await isOwner())) {
    // visitors get the result only: no settings, quota or model list leave the server
    return <AnalysisPanel initial={latest} used={0} limit={0} missing={[]} models={[]} readOnly />;
  }
  return <AnalysisPanel initial={latest} used={used} limit={config.ai.dailyLimit()} missing={config.ai.missing()} models={config.ai.models()} />;
}
