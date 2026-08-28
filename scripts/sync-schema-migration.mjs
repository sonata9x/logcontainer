import { appendFileSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const migrationArgument = process.argv[2];
if (!migrationArgument) throw new Error("Usage: node scripts/sync-schema-migration.mjs <migration.sql>");

const migrationPath = resolve(migrationArgument);
const schemaPath = resolve("supabase/schema.sql");
const marker = `-- ${basename(migrationPath)}`;
const schema = readFileSync(schemaPath, "utf8");
if (schema.includes(marker)) {
  console.log(`${marker} is already present`);
  process.exit(0);
}

const migration = readFileSync(migrationPath, "utf8").trim();
appendFileSync(schemaPath, `\n\n${marker}\n${migration}\n`, "utf8");
console.log(`Appended ${marker} to supabase/schema.sql`);
