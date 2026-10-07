/**
 * Smoke / speed check against a RUNNING app (local `next start` or the Vercel deployment).
 *
 *   npm run smoke -- https://your-app.vercel.app      as a visitor of the public site (no login)
 *   SMOKE_USERNAME=... SMOKE_PASSWORD=... npm run smoke -- https://your-app.vercel.app   as the owner
 *
 * Optionally logs in, then loads every page and API several times, all at once (like a browser prefetching
 * the menu). Any request that fails, answers non-200, or takes longer than LIMIT_MS (15 s) is a
 * FAILURE and the script exits with code 1. Only read-only requests are made.
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const LIMIT_MS = 15_000;
const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 3);
const PATHS = ["/", "/analysis", "/news", "/symbols", "/history", "/recipients", "/api/symbols", "/api/prices"];

async function login(): Promise<string> {
  const { SMOKE_USERNAME: username, SMOKE_PASSWORD: password } = process.env;
  if (!username || !password) return ""; // a visitor: every page is public (read-only)
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(LIMIT_MS),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function hit(path: string, cookie: string) {
  const started = Date.now();
  try {
    const res = await fetch(base + path, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(LIMIT_MS) });
    await res.text();
    const ms = Date.now() - started;
    return { path, ms, ok: res.status === 200, note: res.status === 200 ? "" : `HTTP ${res.status}` };
  } catch {
    return { path, ms: Date.now() - started, ok: false, note: `no answer within ${LIMIT_MS / 1000}s` };
  }
}

async function main() {
  const cookie = await login();
  let failures = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    // each path 3x at the same time = 18 simultaneous requests per round
    const results = await Promise.all(PATHS.flatMap((p) => [0, 1, 2].map(() => hit(p, cookie))));
    const bad = results.filter((r) => !r.ok);
    failures += bad.length;
    const slowest = results.reduce((a, b) => (b.ms > a.ms ? b : a));
    console.log(
      `round ${round}: ${results.length - bad.length}/${results.length} ok, slowest ${slowest.ms}ms (${slowest.path})` +
        (bad.length ? `\n  FAIL: ${bad.map((b) => `${b.path} ${b.note} after ${b.ms}ms`).join("; ")}` : ""),
    );
  }
  console.log(failures === 0 ? `PASS: everything answered within ${LIMIT_MS / 1000}s` : `FAIL: ${failures} request(s) failed or took over ${LIMIT_MS / 1000}s`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
