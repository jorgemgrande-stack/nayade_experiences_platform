/**
 * Lógica pura del ejecutor de migraciones (scripts/db/migrationLib.ts):
 * lectura, validación y división de sentencias.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checksum, ledgerProblems, loadMigrations, resolveLane, splitStatements, targetProblem, validateMigrations, type LedgerState } from "../scripts/db/migrationLib";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

describe("splitStatements", () => {
  it("separa por punto y coma y por statement-breakpoint, sin comentarios", () => {
    const sql = `-- cabecera\nALTER TABLE a ADD COLUMN x INT NULL;\n-- otro\nUPDATE a SET x = 1 WHERE id = 1;\n--> statement-breakpoint\nCREATE INDEX i ON a (x)`;
    expect(splitStatements(sql)).toEqual([
      "ALTER TABLE a ADD COLUMN x INT NULL",
      "UPDATE a SET x = 1 WHERE id = 1",
      "CREATE INDEX i ON a (x)",
    ]);
  });
  it("ignora fichero vacío o solo comentarios", () => {
    expect(splitStatements("-- nada\n\n")).toEqual([]);
  });
  it("normaliza CRLF", () => {
    expect(splitStatements("SELECT 1;\r\nSELECT 2;\r\n")).toEqual(["SELECT 1", "SELECT 2"]);
  });
});

describe("checksum", () => {
  it("es estable ante CRLF y espacios finales, y cambia con el contenido", () => {
    expect(checksum("SELECT 1;\r\n")).toBe(checksum("SELECT 1;"));
    expect(checksum("SELECT 1;")).not.toBe(checksum("SELECT 2;"));
  });
});

describe("loadMigrations + validateMigrations", () => {
  it("acepta una migración con su reversión", () => {
    write("0001_crear_tabla.sql", "CREATE TABLE t (id INT);");
    write("0001_crear_tabla.down.sql", "DROP TABLE t;");
    const { migrations, errors } = loadMigrations(dir);
    expect(errors).toEqual([]);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatchObject({ id: "0001_crear_tabla", number: 1, irreversible: false });
    // El .down.sql incluye DROP TABLE pero solo se valida la parte «up» como destructiva
    expect(validateMigrations(migrations)).toEqual([]);
  });

  it("exige reversión o marca de irreversible", () => {
    write("0001_a.sql", "ALTER TABLE t ADD COLUMN c INT NULL;");
    const { migrations } = loadMigrations(dir);
    expect(validateMigrations(migrations).join("\n")).toMatch(/falta 0001_a\.down\.sql/);

    write("0001_a.sql", "-- irreversible: dato derivado, no recuperable\nALTER TABLE t ADD COLUMN c INT NULL;");
    expect(validateMigrations(loadMigrations(dir).migrations)).toEqual([]);
  });

  it("detecta sintaxis de MariaDB no válida en MySQL", () => {
    write("0001_a.sql", "ALTER TABLE t ADD COLUMN IF NOT EXISTS c INT NULL;");
    write("0001_a.down.sql", "ALTER TABLE t DROP COLUMN c;");
    expect(validateMigrations(loadMigrations(dir).migrations).join("\n")).toMatch(/MariaDB/);
  });

  it("detecta operaciones destructivas sin autorización explícita", () => {
    write("0001_a.sql", "DROP TABLE antigua;");
    write("0001_a.down.sql", "SELECT 1;");
    expect(validateMigrations(loadMigrations(dir).migrations).join("\n")).toMatch(/destructiva/);

    write("0001_a.sql", "-- allow-destructive\nDROP TABLE antigua;");
    expect(validateMigrations(loadMigrations(dir).migrations)).toEqual([]);
  });

  it("DELETE sin WHERE es destructivo; con WHERE no", () => {
    write("0001_a.sql", "DELETE FROM t;");
    write("0001_a.down.sql", "SELECT 1;");
    expect(validateMigrations(loadMigrations(dir).migrations).join("\n")).toMatch(/destructiva/);
    write("0001_a.sql", "DELETE FROM t WHERE id = 1;");
    expect(validateMigrations(loadMigrations(dir).migrations)).toEqual([]);
  });

  it("detecta huecos y nombres no válidos", () => {
    write("0001_a.sql", "SELECT 1;");
    write("0001_a.down.sql", "SELECT 1;");
    write("0003_c.sql", "SELECT 1;");
    write("0003_c.down.sql", "SELECT 1;");
    write("migracion_sin_numero.sql", "SELECT 1;");
    const { migrations, errors } = loadMigrations(dir);
    expect(errors.join("\n")).toMatch(/nombre no válido/);
    expect(validateMigrations(migrations).join("\n")).toMatch(/hueco de numeración/);
  });

  it("una reversión sin su migración es un error", () => {
    write("0002_huerfana.down.sql", "SELECT 1;");
    expect(loadMigrations(dir).errors.join("\n")).toMatch(/no existe la migración/);
  });

  it("rechaza ficheros sin sentencias", () => {
    write("0001_a.sql", "-- solo un comentario");
    write("0001_a.down.sql", "SELECT 1;");
    expect(validateMigrations(loadMigrations(dir).migrations).join("\n")).toMatch(/no contiene sentencias/);
  });

  it("ordena por número y el checksum cambia si cambia el contenido", () => {
    write("0002_b.sql", "SELECT 2;");
    write("0002_b.down.sql", "SELECT 1;");
    write("0001_a.sql", "SELECT 1;");
    write("0001_a.down.sql", "SELECT 1;");
    const a = loadMigrations(dir).migrations;
    expect(a.map((m) => m.number)).toEqual([1, 2]);
    write("0001_a.sql", "SELECT 99;");
    const b = loadMigrations(dir).migrations;
    expect(b[0].checksum).not.toBe(a[0].checksum);
  });

  it("directorio inexistente → error, sin lanzar", () => {
    expect(loadMigrations(path.join(dir, "no-existe")).errors).toHaveLength(1);
  });
});

describe("carriles (--dir obligatorio y explícito)", () => {
  it("sin --dir no hay carril por defecto", () => {
    expect(resolveLane(undefined, process.cwd()).error).toMatch(/no hay carril por defecto/);
  });
  it("carriles conocidos con sus tablas base", () => {
    expect(resolveLane("db/migrations", process.cwd()).lane).toMatchObject({ name: "app", requires: ["users"] });
    expect(resolveLane("db/crm/migrations", process.cwd()).lane).toMatchObject({ name: "crm", requires: ["crm_companies"] });
  });
  it("un directorio desconocido sin lane.json se rechaza; con lane.json válido se acepta", () => {
    expect(resolveLane(dir, process.cwd()).error).toMatch(/Carril desconocido/);
    write("lane.json", JSON.stringify({ name: "prueba", requires: ["t_base"] }));
    expect(resolveLane(dir, process.cwd()).lane).toMatchObject({ name: "prueba", requires: ["t_base"] });
    write("lane.json", "{ roto");
    expect(resolveLane(dir, process.cwd()).error).toMatch(/no es válido/);
  });
});

describe("integridad del registro", () => {
  const lane = { name: "app", dir: "x", requires: ["users"] };
  const mig = (n: number, body = `CREATE TABLE t${n} (id INT)`) => ({
    id: `000${n}_m${n}`, number: n, name: `m${n}`, up: body, down: "DROP TABLE x", irreversible: false, allowDestructive: false, checksum: checksum(body),
  });
  const list = [mig(1), mig(2), mig(3)];
  const state = (p: Partial<LedgerState> = {}): LedgerState => ({ applied: new Map(), lane: null, inProgress: null, tables: new Set(["users"]), ...p });

  it("registro sano (incluido el anterior a esta versión, sin carril) → sin problemas", () => {
    expect(ledgerProblems(list, state({ applied: new Map([[list[0].id, list[0].checksum]]) }), lane)).toEqual([]);
  });
  it("BD de otro carril, sin tablas base o con registros ajenos → se detiene", () => {
    expect(ledgerProblems(list, state({ lane: "crm" }), lane).join()).toMatch(/ligada al carril «crm»/);
    expect(ledgerProblems(list, state({ tables: new Set(["crm_companies"]) }), lane).join()).toMatch(/Faltan las tablas base/);
    expect(ledgerProblems(list, state({ applied: new Map([["0001_crm_commercial_v2", "x"]]) }), lane).join()).toMatch(/no existe en este carril/);
  });
  it("migración a medias, contenido cambiado o hueco → se detiene", () => {
    expect(ledgerProblems(list, state({ inProgress: "up:0002_m2" }), lane).join()).toMatch(/empezó y no terminó/);
    expect(ledgerProblems(list, state({ applied: new Map([[list[0].id, "otro"]]) }), lane).join()).toMatch(/checksum distinto/);
    expect(ledgerProblems(list, state({ applied: new Map([[list[0].id, list[0].checksum], [list[2].id, list[2].checksum]]) }), lane).join()).toMatch(/Hueco/);
  });
});

describe("identificación del destino antes de escribir", () => {
  const base = { apply: true, confirm: "crm", actualDb: "crm", urlHost: "127.0.0.1", allowRemote: false };
  it("lectura no exige nada", () => {
    expect(targetProblem({ ...base, apply: false, confirm: undefined })).toBeNull();
  });
  it("escribir exige --confirm-database con el nombre real, también en local", () => {
    expect(targetProblem({ ...base, confirm: undefined })).toMatch(/--confirm-database crm/);
    expect(targetProblem({ ...base, confirm: "otra" })).toMatch(/--confirm-database crm/);
    expect(targetProblem(base)).toBeNull();
  });
  it("destino remoto exige además --allow-remote", () => {
    expect(targetProblem({ ...base, urlHost: "db.railway.internal" })).toMatch(/--allow-remote/);
    expect(targetProblem({ ...base, urlHost: "db.railway.internal", allowRemote: true })).toBeNull();
  });
  it("sin base de datos seleccionada no se escribe", () => {
    expect(targetProblem({ ...base, actualDb: null })).toMatch(/ninguna base de datos/);
  });
});
