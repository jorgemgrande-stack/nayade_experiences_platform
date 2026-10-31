/**
 * Las migraciones 0033 (libro), 0035 (operaciones) y 0036 (Stripe) y el código del módulo son ORDINARIOS para el clasificador de
 * despliegue (scripts/deploy/esRailwayLib): migraciones aditivas (sin palabras prohibidas ni en comentarios), sin
 * borrados en el código de server/finance y sin cambios críticos. El único interruptor que aparece es NUEVO
 * (`CP_FINANCE_RECURRING_ENABLED`, apagado), ordinario porque no existe en la rama base (como lo comprueba
 * scripts/deploy/esRailway.ts con `git grep`). Si esta prueba falla, el despliegue pediría aprobación extraordinaria.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { destructiveMigration, extraordinaryChanges } from "../../scripts/deploy/esRailwayLib";
import { loadMigrations, validateMigrations } from "../../scripts/db/migrationLib";
import { MIGRATION_0033, MIGRATION_0035, MIGRATION_0036 } from "./testkit";

const ROOT = path.resolve(__dirname, "../..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const MIGRATIONS = [MIGRATION_0033, MIGRATION_0035, MIGRATION_0036];
const sqlOf = (f: string) => fs.readFileSync(f, "utf8");
const moduleFiles = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(__dirname, f));
const NEW_SWITCHES = new Set(["CP_FINANCE_RECURRING_ENABLED"]);

/** Diff sintético «todo añadido» de unos ficheros, con el formato de `git diff`. */
const addedDiff = (files: string[]) =>
  files
    .map((f) => {
      const r = rel(f);
      const body = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`);
      return [`diff --git a/${r} b/${r}`, "new file mode 100644", "--- /dev/null", `+++ b/${r}`, `@@ -0,0 +1,${body.length} @@`, ...body].join("\n");
    })
    .join("\n");

describe("migraciones 0033, 0035 y 0036 y módulo de finanzas: despliegue ordinario", () => {
  it("las migraciones son aditivas para el clasificador y válidas para el ejecutor (irreversibles con motivo)", () => {
    for (const f of MIGRATIONS) expect(destructiveMigration(sqlOf(f))).toBeNull();
    const { migrations, errors } = loadMigrations(path.join(ROOT, "db/crm/migrations"));
    expect(errors).toEqual([]);
    expect(validateMigrations(migrations)).toEqual([]);
    for (const id of ["0033_finance_ledger", "0035_finance_operations", "0036_finance_stripe"]) expect(migrations.find((x) => x.id === id)!.irreversible).toBe(true);
  });

  it("sin palabras prohibidas en todo el fichero (también comentarios y literales) ni ';' dentro de literales", () => {
    for (const f of MIGRATIONS) {
      const sql = sqlOf(f);
      expect(sql).not.toMatch(/\b(change|modify|rename|drop|delete|update|truncate)\b/i);
      expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
      for (const lit of sql.match(/'[^']*'/g) ?? []) expect(lit).not.toContain(";");
    }
  });

  it("0035 solo crea tablas fin_* e inserta la siembra (sin importes ni datos de clientes)", () => {
    const stmts = sqlOf(MIGRATION_0035)
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) expect(s).toMatch(/^(CREATE TABLE fin_\w+|INSERT INTO fin_(cost_centers|expense_categories))\b/);
    expect(stmts.filter((s) => s.startsWith("CREATE TABLE"))).toHaveLength(12);
  });

  it("0036 solo crea las cuatro tablas fin_stripe_* (sin siembra ni datos), con la unicidad de cada hecho", () => {
    const sql = sqlOf(MIGRATION_0036);
    const stmts = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(stmts.map((s) => /^CREATE TABLE (fin_stripe_\w+)/.exec(s)?.[1])).toEqual(["fin_stripe_settings", "fin_stripe_imports", "fin_stripe_payouts", "fin_stripe_transactions"]);
    for (const k of ["uq_fin_stripe_import_file (kind, sha256)", "uq_fin_stripe_payout (provider, payout_id)", "uq_fin_stripe_payout_bank (bank_movement_id)", "uq_fin_stripe_txn (provider, balance_transaction_id)"]) expect(sql).toContain(`UNIQUE KEY ${k}`);
  });

  it("el código de server/finance no borra datos y nada del conjunto es extraordinario", () => {
    for (const f of moduleFiles.filter((x) => !/\.test\.ts$/.test(x))) expect(fs.readFileSync(f, "utf8")).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|DATABASE|SCHEMA|COLUMN|INDEX))\b/i);
    const files = [...MIGRATIONS.map(rel), ...moduleFiles.map(rel)];
    const existsInBase = (name: string) => !NEW_SWITCHES.has(name);
    expect(extraordinaryChanges(files, addedDiff([...MIGRATIONS, ...moduleFiles]), (f) => (f.endsWith(".sql") ? sqlOf(path.join(ROOT, f)) : null), { existsInBase })).toEqual([]);
    // Sin `existsInBase` el interruptor se trataría como uno ya existente: confirma que la prueba lo ve
    expect(extraordinaryChanges(files, addedDiff(moduleFiles), () => null).join(" ")).toMatch(/CP_FINANCE_RECURRING_ENABLED/);
  });
});
