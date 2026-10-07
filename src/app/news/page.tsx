import { NewsPanel } from "@/components/NewsPanel";
import { config } from "@/lib/config";
import { briefsOnDay, latestBrief } from "@/lib/db/news";
import { nyToday } from "@/lib/market/calendar";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "ข่าวที่กระทบหุ้น", description: "สรุปข่าวฟรีรายวันด้วย AI ว่ากระทบตลาดและหุ้นที่ติดตามอย่างไร แยกข้อเท็จจริง ความเห็น และการตีความ พร้อมลิงก์ข่าวต้นทาง" };

export default async function NewsPage() {
  // Both reads tolerate a missing table (before the migration ran): the page then simply starts empty.
  const [latest, used] = await withTimeout(
    Promise.all([latestBrief().catch(() => null), briefsOnDay(nyToday()).catch(() => 0)]),
    PAGE_DATA_TIMEOUT_MS,
    "load the last news brief",
  );
  if (!(await isOwner())) return <NewsPanel initial={latest} used={0} limit={0} missing={[]} readOnly />;
  return <NewsPanel initial={latest} used={used} limit={config.news.dailyLimit()} missing={config.ai.missing()} />;
}
