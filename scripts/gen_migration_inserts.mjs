/**
 * Generates INSERT statements to pre-populate __drizzle_migrations
 * with all already-applied migrations, so Drizzle stops trying to re-run them.
 *
 * Drizzle MySQL migrator hashes each migration SQL file as:
 *   SHA256(content.replaceAll('\r', '').trimEnd())
 *
 * Run: node scripts/gen_migration_inserts.mjs
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, "../drizzle");

// Read journal to get migration order and timestamps
const journal = JSON.parse(
  fs.readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8")
);

const lines = [];
lines.push("-- Run this in: railway connect mysql");
lines.push("-- Pre-populates __drizzle_migrations so Drizzle stops re-running applied migrations");
lines.push("");
lines.push("CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (");
lines.push("  `id` int AUTO_INCREMENT NOT NULL,");
lines.push("  `hash` text NOT NULL,");
lines.push("  `created_at` bigint,");
lines.push("  CONSTRAINT `__drizzle_migrations_pk` PRIMARY KEY(`id`)");
lines.push(") ENGINE=InnoDB;");
lines.push("");

for (const entry of journal.entries) {
  const sqlFile = path.join(drizzleDir, `${entry.tag}.sql`);

  if (!fs.existsSync(sqlFile)) {
    console.warn(`WARNING: SQL file not found: ${entry.tag}.sql — skipping`);
    continue;
  }

  const raw = fs.readFileSync(sqlFile, "utf8");
  // Drizzle normalizes: remove \r, trim trailing whitespace
  const normalized = raw.replaceAll("\r", "").trimEnd();
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");

  lines.push(
    `INSERT IGNORE INTO \`__drizzle_migrations\` (\`hash\`, \`created_at\`) VALUES ('${hash}', ${entry.when});` +
    `  -- ${entry.tag}`
  );
}

// 0042–0044 are now in the journal — they were processed in the loop above

const output = lines.join("\n");
const outFile = path.resolve(__dirname, "../drizzle_seed_migrations.sql");
fs.writeFileSync(outFile, output, "utf8");

console.log(`\nGenerated: drizzle_seed_migrations.sql`);
console.log(`Total entries: ${journal.entries.length}`);
console.log("\nPreview (first 10 lines):");
lines.slice(0, 10).forEach((l) => console.log(l));
