/**
 * Orden permanente del propietario (26/10/2026): production publica sin aprobación lo ORDINARIO (código, dependencias,
 * imágenes probadas en live y migraciones ADITIVAS con copia verificada) y conserva la aprobación para lo EXTRAORDINARIO
 * (migraciones destructivas, interruptores de cobros, autoservicio, correo real e IA, política del correo y la pasarela de
 * seguridad; variables, secretos y operaciones a mano siguen en el entorno protegido).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ORDINARY_PRODUCTION_ACTIONS, destructiveMigration, externalExtraordinaryChanges, extraordinaryChanges, migrationUpFiles } from "../scripts/deploy/esRailwayLib";

const WF = fs.readFileSync(".github/workflows/deploy-elephant-source.yml", "utf8");
const none = () => null;

describe("migraciones: aditivas frente a destructivas", () => {
  it("crear tablas, añadir columnas e índices e insertar datos nuevos es aditivo", () => {
    expect(destructiveMigration("-- comentario con DROP TABLE dentro\nCREATE TABLE x (id INT);\nCREATE INDEX i ON x (id);")).toBeNull();
    expect(destructiveMigration("ALTER TABLE x\n  ADD COLUMN y INT NULL,\n  ADD KEY k (y);")).toBeNull();
    expect(destructiveMigration("INSERT INTO x (id) VALUES (1);")).toBeNull();
  });
  it("borrar, vaciar, reescribir, renombrar o cambiar tipos es destructivo; lo desconocido, también", () => {
    for (const sql of ["DROP TABLE x;", "ALTER TABLE x DROP COLUMN y;", "TRUNCATE x;", "DELETE FROM x WHERE 1;", "UPDATE x SET y = 1;", "ALTER TABLE x MODIFY COLUMN y BIGINT;", "RENAME TABLE x TO z;", "GRANT ALL ON *.* TO 'a';"])
      expect(destructiveMigration(sql), sql).not.toBeNull();
  });
  it("la 0025 (ajustes del CRM) es aditiva: habría salido sola a production con copia verificada", () => {
    expect(destructiveMigration(fs.readFileSync("db/crm/migrations/0025_crm_settings.sql", "utf8"))).toBeNull();
  });
  it("solo se clasifican los ficheros de subida (ni .down, ni README, ni la línea base)", () => {
    expect(migrationUpFiles(["db/crm/migrations/0025_x.sql", "db/crm/migrations/0025_x.down.sql", "db/crm/migrations/README.md", "db/baseline/core.sql", "server/a.ts"])).toEqual(["db/crm/migrations/0025_x.sql"]);
  });
});

describe("cambios de production: ordinario frente a extraordinario", () => {
  it("código, dependencias, imagen y migraciones aditivas son ordinarios", () => {
    const files = ["server/routers.ts", "client/src/App.tsx", "package.json", "pnpm-lock.yaml", "Dockerfile.controlplane", "deploy/railway/core.json", "db/crm/migrations/0026_x.sql"];
    expect(extraordinaryChanges(files, "+ const x = 1;", () => "CREATE TABLE t (id INT);")).toEqual([]);
  });
  it("migración destructiva, política del correo e interruptores bloqueados son extraordinarios", () => {
    expect(extraordinaryChanges(["db/crm/migrations/0026_x.sql"], "", () => "ALTER TABLE t DROP COLUMN c;")).toHaveLength(1);
    expect(extraordinaryChanges(["db/crm/migrations/0026_x.sql"], "", none)).toHaveLength(1); // migración borrada
    expect(extraordinaryChanges(["server/mail/policy.ts"], "", none)).toHaveLength(1);
    for (const line of ["+  if (process.env.CP_PUBLIC_CHECKOUT_ENABLED === '1') {", "-  const mode = env.MAIL_MODE ?? 'off';", "+  const m = process.env.LLM_MODEL;", "+ CP_STRIPE_MODE=live"])
      expect(extraordinaryChanges(["server/x.ts"], line, none), line).toHaveLength(1);
  });
  it("CRM y web: dependencias e imagen ordinarias; la pasarela de seguridad, extraordinaria", () => {
    expect(externalExtraordinaryChanges(["package.json", "pnpm-lock.yaml", "deploy/railway/Dockerfile", "src/pages/X.tsx"])).toEqual([]);
    expect(externalExtraordinaryChanges(["deploy/railway/Caddyfile"])).toHaveLength(1);
  });
});

describe("flujo de despliegue", () => {
  it("las acciones ordinarias de production son exactamente las del código y no incluyen nada sensible", () => {
    const m = /contains\(fromJSON\('(\[[^\]]+\])'\), inputs\.action\)/.exec(WF);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual([...ORDINARY_PRODUCTION_ACTIONS]);
    for (const a of ["aplicar-production", "preparar-production", "almacenamiento-referencias", "migraciones-aplicar", "migraciones-plataforma-aplicar", "correo-acceso-activar", "correo-acceso-desactivar", "avisos-solicitudes-activar", "avisos-solicitudes-desactivar", "medicion-preparar", "desplegar-controlplane", "desplegar-core", "desplegar-web", "desplegar-crm"])
      expect(ORDINARY_PRODUCTION_ACTIONS as readonly string[], a).not.toContain(a);
  });
  it("publicar en production aplica las migraciones aditivas con copia verificada y canario, antes del código", () => {
    const step = WF.slice(WF.indexOf("Publicar — production, copia verificada y migraciones aditivas"), WF.indexOf("Publicar — controlplane, core y core-gateway"));
    // Sin empresas fijas: migrate-tenants hace de canario con la primera empresa pendiente
    const order = ["--service restore-drill", "backup-job.js run", "backup-check", "registry apply", "crm apply", "migrate-tenants --apply", "check-data-exports\""];
    expect(step).not.toMatch(/--only (t3-empresa-demo|t5-skibox)/);
    let at = 0;
    for (const s of order) {
      const i = step.indexOf(s, at);
      expect(i, s).toBeGreaterThan(-1);
      at = i;
    }
    expect(WF).toContain("env.ES_PROD_MIGRATE == '1'");
  });
  it("lo extraordinario sigue sin publicarse solo: el CI deja aviso y no despliega", () => {
    expect(WF).toContain("ES_PROD_SKIP=1");
    expect(fs.readFileSync(path.join("scripts/deploy/esRailway.ts"), "utf8")).toContain("extraordinaryChanges(files");
  });
});
