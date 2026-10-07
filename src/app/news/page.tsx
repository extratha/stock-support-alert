import { NewsPanel } from "@/components/NewsPanel";
import { config } from "@/lib/config";
import { briefsOnDay, latestBrief } from "@/lib/db/news";
import { nyToday } from "@/lib/market/calendar";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  // Both reads tolerate a missing table (before the migration ran): the page then simply starts empty.
  const [latest, used] = await withTimeout(
    Promise.all([latestBrief().catch(() => null), briefsOnDay(nyToday()).catch(() => 0)]),
    PAGE_DATA_TIMEOUT_MS,
    "load the last news brief",
  );
  return <NewsPanel initial={latest} used={used} limit={config.news.dailyLimit()} missing={config.ai.missing()} />;
}
