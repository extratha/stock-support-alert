import { sql } from "./client";

export async function upsertFollower(userId: string) {
  await sql()`
    insert into line_users (user_id, active, followed_at, unfollowed_at)
    values (${userId}, true, now(), null)
    on conflict (user_id) do update set active = true, followed_at = now(), unfollowed_at = null`;
}

export async function deactivateUser(userId: string) {
  await sql()`update line_users set active = false, unfollowed_at = now() where user_id = ${userId}`;
}

export async function listActiveUserIds(): Promise<string[]> {
  const rows = await sql()<{ user_id: string }[]>`select user_id from line_users where active order by followed_at`;
  return rows.map((r) => r.user_id);
}
