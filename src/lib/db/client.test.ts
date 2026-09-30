import { beforeEach, describe, expect, it, vi } from "vitest";

const postgres = vi.fn(() => ({}));
vi.mock("postgres", () => ({ default: postgres }));

beforeEach(() => {
  vi.resetModules();
  postgres.mockClear();
  delete (globalThis as { __sql?: unknown }).__sql;
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@host:6543/postgres");
});

describe("database client options", () => {
  it("never pipelines queries and never uses prepared statements (Supavisor transaction pooler)", async () => {
    // Regression guard: with pipelining enabled, requests hang forever when several pages load at once.
    const { sql } = await import("./client");
    sql();
    expect(postgres).toHaveBeenCalledTimes(1);
    const [url, options] = postgres.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe("postgresql://u:p@host:6543/postgres");
    expect(options).toMatchObject({ prepare: false, max_pipeline: 0 });
  });

  it("creates one shared pool, not one per call", async () => {
    const { sql } = await import("./client");
    sql();
    sql();
    expect(postgres).toHaveBeenCalledTimes(1);
  });
});
