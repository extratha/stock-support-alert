import { NextResponse } from "next/server";
import { listActiveUserIds } from "@/lib/db/lineUsers";
import { syncProfile } from "@/lib/jobs/lineProfiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Re-read every friend's LINE display name / picture (names change; old rows have none). */
export async function POST() {
  const ids = await listActiveUserIds(50);
  let updated = 0;
  for (const id of ids) if (await syncProfile(id)) updated++;
  return NextResponse.json({ updated, failed: ids.length - updated });
}
