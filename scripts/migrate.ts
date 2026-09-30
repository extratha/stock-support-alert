import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
try {
  await sql.unsafe(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  console.log("Schema applied.");
} finally {
  await sql.end();
}
