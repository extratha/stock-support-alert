import postgres from "postgres";
import { requireEnv } from "@/lib/config";

type Sql = ReturnType<typeof postgres>;

// Cached on globalThis so dev hot-reload and warm serverless instances reuse one pool.
const g = globalThis as unknown as { __sql?: Sql };

/**
 * `prepare: false` keeps this compatible with Supabase's transaction pooler
 * (pgbouncer), which does not support prepared statements.
 */
export function sql(): Sql {
  g.__sql ??= postgres(requireEnv("DATABASE_URL"), {
    prepare: false,
    max: 3,
    idle_timeout: 20,
  });
  return g.__sql;
}
