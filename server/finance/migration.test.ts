/**
 * La migración 0033 y el código del módulo son ORDINARIOS para el clasificador de despliegue (scripts/deploy/esRailwayLib):
 * migración aditiva (sin palabras prohibidas ni en comentarios), sin borrados en el código de server/finance y sin
 * cambios críticos. Si esta prueba falla, el despliegue a production pediría aprobación extraordinaria.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { destructiveMigration, extraordinaryChanges } from "../../scripts/deploy/esRailwayLib";
import { loadMigrations, validateMigrations } from "../../scripts/db/migrationLib";
import { MIGRATION_0033 } from "./testkit";

const ROOT = path.resolve(__dirname, "../..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const sql = fs.readFileSync(MIGRATION_0033, "utf8");
const moduleFiles = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(__dirname, f));

/** Diff sintético «todo añadido» de unos ficheros, con el formato de `git diff`. */
const addedDiff = (files: string[]) =>
  files
    .map((f) => {
      const r = rel(f);
      const body = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split("\n").map((l) => `+${l}`);
      return [`diff --git a/${r} b/${r}`, "new file mode 100644", "--- /dev/null", `+++ b/${r}`, `@@ -0,0 +1,${body.length} @@`, ...body].join("\n");
    })
    .join("\n");

describe("migración 0033 y módulo de finanzas: despliegue ordinario", () => {
  it("la migración es aditiva para el clasificador y válida para el ejecutor", () => {
    expect(destructiveMigration(sql)).toBeNull();
    const { migrations, errors } = loadMigrations(path.join(ROOT, "db/crm/migrations"));
    expect(errors).toEqual([]);
    expect(validateMigrations(migrations)).toEqual([]);
    const m = migrations.find((x) => x.id === "0033_finance_ledger")!;
    expect(m.irreversible).toBe(true);
  });

  it("sin palabras prohibidas en todo el fichero (también comentarios y literales) ni ';' dentro de literales", () => {
    expect(sql).not.toMatch(/\b(change|modify|rename|drop|delete|update|truncate)\b/i);
    expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    for (const lit of sql.match(/'[^']*'/g) ?? []) expect(lit).not.toContain(";");
  });

  it("el código de server/finance no borra datos y nada del conjunto es extraordinario", () => {
    for (const f of moduleFiles.filter((x) => !/\.test\.ts$/.test(x))) expect(fs.readFileSync(f, "utf8")).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|DATABASE|SCHEMA|COLUMN|INDEX))\b/i);
    const files = [rel(MIGRATION_0033), ...moduleFiles.map(rel)];
    expect(extraordinaryChanges(files, addedDiff([MIGRATION_0033, ...moduleFiles]), (f) => (f === rel(MIGRATION_0033) ? sql : null))).toEqual([]);
  });
});
