/**
 * Las migraciones 0033 (libro), 0035 (operaciones), 0036 (Stripe), 0037 (gestoría), 0038 (análisis) y 0039 (parametrización fiscal) y el código del módulo son ORDINARIOS para el clasificador de
 * despliegue (scripts/deploy/esRailwayLib): migraciones aditivas (sin palabras prohibidas ni en comentarios), sin
 * borrados en el código de server/finance y sin cambios críticos. Los interruptores que aparecen son NUEVOS
 * (`CP_FINANCE_RECURRING_ENABLED` y `CP_FINANCE_TAX_REMINDERS_ENABLED`, apagados), ordinario porque no existe en la rama base (como lo comprueba
 * scripts/deploy/esRailway.ts con `git grep`). Si esta prueba falla, el despliegue pediría aprobación extraordinaria.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { destructiveMigration, extraordinaryChanges } from "../../scripts/deploy/esRailwayLib";
import { loadMigrations, validateMigrations } from "../../scripts/db/migrationLib";
import { MIGRATION_0033, MIGRATION_0035, MIGRATION_0036, MIGRATION_0037, MIGRATION_0038, MIGRATION_0039 } from "./testkit";

const ROOT = path.resolve(__dirname, "../..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const MIGRATIONS = [MIGRATION_0033, MIGRATION_0035, MIGRATION_0036, MIGRATION_0037, MIGRATION_0038, MIGRATION_0039];
const sqlOf = (f: string) => fs.readFileSync(f, "utf8");
const moduleFiles = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(__dirname, f));
const NEW_SWITCHES = new Set(["CP_FINANCE_RECURRING_ENABLED", "CP_FINANCE_TAX_REMINDERS_ENABLED"]);

/** Diff sintético «todo añadido» de unos ficheros, con el formato de `git diff`. */
const addedDiff = (files: string[]) =>
  files
    .map((f) => {
      const r = rel(f);
      const body = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`);
      return [`diff --git a/${r} b/${r}`, "new file mode 100644", "--- /dev/null", `+++ b/${r}`, `@@ -0,0 +1,${body.length} @@`, ...body].join("\n");
    })
    .join("\n");

describe("migraciones 0033, 0035, 0036, 0037, 0038 y 0039 y módulo de finanzas: despliegue ordinario", () => {
  it("las migraciones son aditivas para el clasificador y válidas para el ejecutor (irreversibles con motivo)", () => {
    for (const f of MIGRATIONS) expect(destructiveMigration(sqlOf(f))).toBeNull();
    const { migrations, errors } = loadMigrations(path.join(ROOT, "db/crm/migrations"));
    expect(errors).toEqual([]);
    expect(validateMigrations(migrations)).toEqual([]);
    for (const id of ["0033_finance_ledger", "0035_finance_operations", "0036_finance_stripe", "0037_finance_tax", "0038_finance_analysis", "0039_finance_fiscal"]) expect(migrations.find((x) => x.id === id)!.irreversible).toBe(true);
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

  it("0037 solo crea tablas fin_tax_* y fin_payrolls, sin siembra (nada se presupone) y con la unicidad de cada obligación", () => {
    const sql = sqlOf(MIGRATION_0037);
    const stmts = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(stmts.map((s) => /^CREATE TABLE (fin_\w+)/.exec(s)?.[1])).toEqual(["fin_tax_settings", "fin_tax_settings_log", "fin_tax_obligations", "fin_tax_obligation_log", "fin_payrolls", "fin_tax_deferrals", "fin_tax_deferral_installments", "fin_tax_dossiers", "fin_tax_dossier_log", "fin_tax_corporate_adjustments"]);
    expect(sql).not.toMatch(/INSERT INTO/i);
    for (const k of ["uq_fin_tax_obligation_key (obligation_key)", "uq_fin_payroll (period, employee_alias)", "uq_fin_tax_deferral_installment (deferral_id, number)"]) expect(sql).toContain(`UNIQUE KEY ${k}`);
    // Sin datos reales: el NIF del emisor solo se precarga en tiempo de ejecución, nunca en la migración
    expect(sql).not.toMatch(/B26987875/);
  });

  it("0038 solo crea las tablas de la revisión diaria, añade la columna de coste directo (NULL, sin escribir filas) y un índice", () => {
    const sql = sqlOf(MIGRATION_0038);
    const stmts = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    expect(stmts.map((s) => s.split(" (")[0])).toEqual(["CREATE TABLE fin_daily_reviews", "CREATE TABLE fin_daily_review_log", "ALTER TABLE fin_expense_categories ADD COLUMN is_direct_cost TINYINT(1) NULL", "CREATE INDEX ix_fin_expense_registered ON fin_expenses"]);
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).toContain("UNIQUE KEY uq_fin_daily_review_day (review_day)");
  });

  it("0039 solo añade columnas NULL a fin_tax_settings y fin_expenses y crea las tablas de la parametrización fiscal, sin escribir filas", () => {
    const sql = sqlOf(MIGRATION_0039);
    const stmts = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    expect(stmts.map((s) => s.split(" (")[0])).toEqual([
      "ALTER TABLE fin_tax_settings ADD COLUMN validated_at BIGINT NULL, ADD COLUMN validated_by VARCHAR(100) NULL, ADD COLUMN validation_note VARCHAR(500) NULL",
      "ALTER TABLE fin_expenses ADD COLUMN vat_treatment VARCHAR(24) NULL, ADD COLUMN reverse_charge_rate_bp INT NULL, ADD COLUMN settles_stripe_fees TINYINT(1) NOT NULL DEFAULT 0",
      "CREATE TABLE fin_stripe_fee_vat_rules",
      "CREATE TABLE fin_tax_corporate_years",
      "CREATE TABLE fin_tax_corporate_year_log",
      "CREATE TABLE fin_tax_corporate_entries",
      "CREATE TABLE fin_analysis_settings",
    ]);
    // Columnas añadidas NULL o con valor por defecto (las filas existentes no cambian: gastos interiores que no son
    // facturas de comisiones de Stripe, configuración sin validar)
    for (const s of stmts.filter((x) => x.startsWith("ALTER TABLE"))) for (const c of s.split("ADD COLUMN").slice(1)) expect(c.trim()).toMatch(/( NULL| NOT NULL DEFAULT 0),?$/);
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/updated_by/i);
    for (const k of ["uq_fin_tax_corporate_entry_source (source_key)", "uq_fin_tax_corporate_entry_live (live_year)"]) expect(sql).toContain(`UNIQUE KEY ${k}`);
  });

  it("el código de server/finance no borra datos y nada del conjunto es extraordinario", () => {
    for (const f of moduleFiles.filter((x) => !/\.test\.ts$/.test(x))) expect(fs.readFileSync(f, "utf8")).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|DATABASE|SCHEMA|COLUMN|INDEX))\b/i);
    const files = [...MIGRATIONS.map(rel), ...moduleFiles.map(rel)];
    const existsInBase = (name: string) => !NEW_SWITCHES.has(name);
    expect(extraordinaryChanges(files, addedDiff([...MIGRATIONS, ...moduleFiles]), (f) => (f.endsWith(".sql") ? sqlOf(path.join(ROOT, f)) : null), { existsInBase })).toEqual([]);
    // Sin `existsInBase` el interruptor se trataría como uno ya existente: confirma que la prueba lo ve
    expect(extraordinaryChanges(files, addedDiff(moduleFiles), () => null).join(" ")).toMatch(/CP_FINANCE_RECURRING_ENABLED/);
    expect(extraordinaryChanges(files, addedDiff(moduleFiles), () => null).join(" ")).toMatch(/CP_FINANCE_TAX_REMINDERS_ENABLED/);
  });
});
