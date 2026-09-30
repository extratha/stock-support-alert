import { sql } from "./client";

/**
 * line_users.active = currently a friend of the OA (follow / unfollow events).
 * line_users.notify = additionally receives push alerts. Friends can always *ask*
 * ("ขอแนวรับ", a free reply); only `notify` users consume the monthly push quota,
 * and the number of them is capped (MAX_PUSH_RECIPIENTS).
 */
export interface LineUser {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  label: string | null;
  active: boolean;
  notify: boolean;
  followedAt: Date;
}

export async function listUsers(): Promise<LineUser[]> {
  return sql()<LineUser[]>`
    select user_id as "userId", display_name as "displayName", picture_url as "pictureUrl",
           label, active, notify, followed_at as "followedAt"
    from line_users
    order by active desc, notify desc, followed_at`;
}

/** `follow` event. Push stays OFF until the owner enables it (also after re-following). */
export async function upsertFollower(userId: string) {
  await sql()`
    insert into line_users (user_id, active, notify, followed_at, unfollowed_at)
    values (${userId}, true, false, now(), null)
    on conflict (user_id) do update
      set active = true, notify = false, followed_at = now(), unfollowed_at = null`;
}

/** `unfollow` (block / remove): no longer a friend, so no push either. */
export async function deactivateUser(userId: string) {
  await sql()`update line_users set active = false, notify = false, unfollowed_at = now() where user_id = ${userId}`;
}

/**
 * Called for any incoming message: a user who talks to the bot is a friend, even if the
 * `follow` event was missed (e.g. they added the OA before the webhook worked).
 */
export async function ensureFriend(userId: string): Promise<{ needsProfile: boolean }> {
  await sql()`
    insert into line_users (user_id) values (${userId})
    on conflict (user_id) do update set active = true, unfollowed_at = null where not line_users.active`;
  const [row] = await sql()<{ display_name: string | null }[]>`select display_name from line_users where user_id = ${userId}`;
  return { needsProfile: !row?.display_name };
}

export async function saveProfile(userId: string, profile: { displayName: string; pictureUrl?: string }) {
  await sql()`
    update line_users set display_name = ${profile.displayName}, picture_url = ${profile.pictureUrl ?? null}
    where user_id = ${userId}`;
}

export async function setLabel(userId: string, label: string | null): Promise<boolean> {
  const rows = await sql()`update line_users set label = ${label} where user_id = ${userId} returning user_id`;
  return rows.length > 0;
}

export type SetNotifyResult = "ok" | "limit" | "inactive" | "not_found";

/**
 * Turn push on/off for one user. Enabling is one atomic statement that re-checks the cap,
 * so two quick clicks can never push the number of recipients past `max`.
 */
export async function setNotify(userId: string, on: boolean, max: number): Promise<SetNotifyResult> {
  if (!on) {
    const rows = await sql()`update line_users set notify = false where user_id = ${userId} returning user_id`;
    return rows.length > 0 ? "ok" : "not_found";
  }
  const rows = await sql()`
    update line_users set notify = true
    where user_id = ${userId} and active
      and (select count(*) from line_users where notify and active and user_id <> ${userId}) < ${max}
    returning user_id`;
  if (rows.length > 0) return "ok";
  const [user] = await sql()<{ active: boolean }[]>`select active from line_users where user_id = ${userId}`;
  if (!user) return "not_found";
  return user.active ? "limit" : "inactive";
}

/** Who actually gets push alerts. `limit` is a second line of defence for the quota. */
export async function listRecipientIds(max: number): Promise<string[]> {
  const rows = await sql()<{ user_id: string }[]>`
    select user_id from line_users where active and notify order by followed_at limit ${max}`;
  return rows.map((r) => r.user_id);
}

export async function listActiveUserIds(limit = 50): Promise<string[]> {
  const rows = await sql()<{ user_id: string }[]>`select user_id from line_users where active order by followed_at limit ${limit}`;
  return rows.map((r) => r.user_id);
}
