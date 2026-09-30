import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  // Also run by Vercel before every build ("vercel-build"). Only production deployments touch the database:
  // a preview of an unmerged branch must not change the production schema.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.log(`Schema not applied on a ${process.env.VERCEL_ENV} deployment.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
    console.log("Schema applied.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
