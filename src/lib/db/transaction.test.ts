import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fake reserved connection that records the statements run on it, in order. */
const events: string[] = [];
const release = vi.fn(() => events.push("release"));
const tx = Object.assign(
  (strings: TemplateStringsArray) => {
    const text = strings.join("?").trim();
    events.push(text);
    const p = Promise.resolve([]);
    return Object.assign(p, { catch: p.catch.bind(p) });
  },
  { release },
);
const reserve = vi.fn(async () => tx);
vi.mock("postgres", () => ({ default: vi.fn(() => ({ reserve })) }));

beforeEach(() => {
  vi.resetModules();
  events.length = 0;
  release.mockClear();
  reserve.mockClear();
  delete (globalThis as { __sql?: unknown }).__sql;
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@host:6543/postgres");
});

describe("transaction()", () => {
  it("runs BEGIN, the work, COMMIT on one reserved connection, then releases it", async () => {
    const { transaction } = await import("./client");
    const result = await transaction(async (t) => {
      await t`select 1`;
      return "done";
    });
    expect(result).toBe("done");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["begin", "select 1", "commit", "release"]);
  });

  it("ROLLBACKs, rethrows the original error and still releases the connection when the work fails", async () => {
    const { transaction } = await import("./client");
    await expect(
      transaction(async () => {
        throw new Error("original failure");
      }),
    ).rejects.toThrow("original failure");
    expect(events).toEqual(["begin", "rollback", "release"]);
  });
});

describe("guard against the UNSAFE_TRANSACTION regression", () => {
  it("no code uses sql.begin(): with max_pipeline 0 it aborts every transaction. Use transaction() instead", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "client.ts") {
          if (/\.begin\s*\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "scripts"));
    expect(offenders).toEqual([]);
  });
});
