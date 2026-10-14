/**
 * CLI de la migración de credenciales heredadas (cifrado de campo).
 *
 *   tsx scripts/legacy-credentials.ts plan
 *   tsx scripts/legacy-credentials.ts apply    [--execute --backup-confirmed]
 *   tsx scripts/legacy-credentials.ts rollback [--execute --backup-confirmed]
 *
 * Entorno (todo explícito; no usa DATABASE_URL por defecto):
 *   LEGACY_CREDENTIALS_DATABASE_URL   BD del tenant a migrar
 *   INTEGRATION_KEYS / INTEGRATION_ACTIVE_KEY_ID   claves de cifrado
 *
 * Sin `--execute` es siempre un simulacro. Con `--execute` exige `--backup-confirmed`.
 * La salida nunca contiene valores de credenciales.
 */
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../server/_core/credentials/vault";
import { applyLegacyEncryption, planLegacyCredentials, rollbackLegacyEncryption } from "../server/_core/credentials/legacyMigration";

async function main() {
  const [cmd, ...flags] = process.argv.slice(2);
  const url = process.env.LEGACY_CREDENTIALS_DATABASE_URL;
  if (!url || !["plan", "apply", "rollback"].includes(cmd ?? "")) {
    console.error("Uso: legacy-credentials <plan|apply|rollback> [--execute --backup-confirmed]\nRequiere LEGACY_CREDENTIALS_DATABASE_URL.");
    process.exit(2);
  }
  const ring = keyringFromEnv();
  const execute = flags.includes("--execute");
  if (execute && !flags.includes("--backup-confirmed")) {
    console.error("Con --execute es obligatorio --backup-confirmed (copia verificada de system_settings y site_settings).");
    process.exit(2);
  }
  const pool = mysql.createPool({ uri: url, connectionLimit: 2 });
  try {
    if (cmd === "plan") {
      console.log(JSON.stringify({ keyring: ring ? "ok" : "ausente", fields: await planLegacyCredentials(pool, ring) }, null, 2));
      return;
    }
    if (!ring) {
      console.error("Sin claves de cifrado válidas (INTEGRATION_KEYS / INTEGRATION_ACTIVE_KEY_ID).");
      process.exit(2);
    }
    const actor = `cli:${process.env.USERNAME ?? process.env.USER ?? "operator"}`;
    const run = cmd === "apply" ? applyLegacyEncryption : rollbackLegacyEncryption;
    const report = await run(pool, { ring, actor, dryRun: !execute, persistAudit: execute });
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.error > 0 || report.summary.conflict > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.name : "error");
  process.exit(1);
});
