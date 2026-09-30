import postgres from "postgres";
import { requireEnv } from "@/lib/config";

type Sql = ReturnType<typeof postgres>;

// Cached on globalThis so dev hot-reload and warm serverless instances reuse one pool.
const g = globalThis as unknown as { __sql?: Sql };

/**
 * Settings required by Supabase's transaction pooler (Supavisor):
 *
 *  - `prepare: false`   the pooler does not support prepared statements.
 *  - `max_pipeline: 0`  do NOT send several queries down one connection without waiting for
 *    the previous answer. Through the pooler that pipelining loses replies, and every request
 *    waiting on them then hangs forever (no error, no timeout). It showed up as pages that
 *    "freeze" whenever a few pages loaded at once, which is exactly what the browser does when
 *    it prefetches the other menu pages. Reproduced and verified outside Next.js: with the
 *    default pipelining 184 of 192 concurrent page loads hung; with 0 none did.
 *    Raising `max` only makes it rarer (pool sizes 4 and 5 still hung), it does not fix it.
 *
 * `max_pipeline` is a real but undocumented option of postgres.js (present in 3.4.x, used by
 * its connection code, missing from its TypeScript types), so the options live in a variable
 * instead of an object literal. client.test.ts guards that it stays set.
 */
const OPTIONS = {
  prepare: false,
  max_pipeline: 0,
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10, // postgres.js default is 30 s; a page must never wait that long for a connection
};

export function sql(): Sql {
  g.__sql ??= postgres(requireEnv("DATABASE_URL"), OPTIONS);
  return g.__sql;
}

type Reserved = Awaited<ReturnType<Sql["reserve"]>>;

/**
 * Run `work` inside a database transaction on ONE connection: BEGIN, work, COMMIT (ROLLBACK if it throws).
 *
 * Use this instead of `sql.begin()`. With `max_pipeline: 0` (see above) postgres.js never runs the hook
 * that `begin()` relies on to pin the connection, and it then aborts every transaction with
 * "UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1". A reserved connection is the
 * supported way to get a pinned connection, and it works with pipelining off.
 * Each statement in `work` must be awaited before the next one is issued.
 */
export async function transaction<T>(work: (tx: Reserved) => Promise<T>): Promise<T> {
  const tx = await sql().reserve();
  try {
    await tx`begin`;
    try {
      const result = await work(tx);
      await tx`commit`;
      return result;
    } catch (err) {
      await tx`rollback`.catch(() => {}); // keep the original error
      throw err;
    }
  } finally {
    tx.release(); // always hand the connection back, or the pool would run dry
  }
}

