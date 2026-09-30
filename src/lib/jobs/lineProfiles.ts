import { saveProfile } from "@/lib/db/lineUsers";
import { getProfile } from "@/lib/line/client";

/** Fetch a friend's LINE display name / picture and store it. Never throws (best effort). */
export async function syncProfile(userId: string): Promise<boolean> {
  try {
    const profile = await getProfile(userId);
    if (!profile) return false;
    await saveProfile(userId, profile);
    return true;
  } catch (err) {
    console.error("profile sync failed", err);
    return false;
  }
}
