/**
 * Despliegue de Elephant Source desde GitHub Actions: aislado de Náyade y Skicenter y sin ejecutarse sin credencial.
 *  - El token debe ser del proyecto de Elephant Source y del entorno elegido; el servicio, conocido y existente.
 *  - Solo órdenes de operación permitidas (copias, migraciones con simulación/aplicación, verificación).
 *  - El export nunca lleva railway.toml (configuración de Náyade) ni datos de semilla.
 *  - El flujo: solo manual, solo desde integration/elephant-source, entorno protegido, sin interpolar entradas
 *    en los scripts y sin referencias a otros proyectos.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DRILL_ALLOWED, EXCLUDED_FROM_EXPORT, describeStorageVar, guard, isAllowedDrill, scrub, storageReferences, testTenantDomains, GATEWAY_COPIED_VARS, GATEWAY_TEMPLATE_SERVICE, type DeployConfig } from "../scripts/deploy/esRailwayLib";

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deploy/railway/elephant-source.deploy.json"), "utf8")) as DeployConfig;
const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8");
const scope = { projectId: cfg.projectId, environmentId: "env-1", environmentName: "live", services: ["core", "controlplane", "restore-drill", "backup-job", "core-gateway"] };

describe("guardia del token", () => {
  it("solo el proyecto de Elephant Source y el entorno elegido", () => {
    expect(guard(cfg, scope, { env: "live", service: "core" })).toEqual([]);
    expect(guard(cfg, { ...scope, projectId: "otro-proyecto-nayade" }, { env: "live" })).toEqual([expect.stringMatching(/no es del proyecto/)]);
    expect(guard(cfg, scope, { env: "production" })).toEqual([expect.stringMatching(/entorno «live», no de «production»/)]);
    expect(guard(cfg, { ...scope, environmentName: "staging" }, { env: "staging" })).toEqual([expect.stringMatching(/entorno no admitido/)]);
  });

  it("servicio desconocido o inexistente en el entorno: detenido", () => {
    expect(guard(cfg, scope, { env: "live", service: "web-nayade" })).toEqual([expect.stringMatching(/no admitido/)]);
    expect(guard(cfg, { ...scope, services: ["core"] }, { env: "live", service: "controlplane" })).toEqual([expect.stringMatching(/no existe/)]);
  });
});

describe("órdenes de operación permitidas", () => {
  it("copias, migraciones (simulación y aplicación) y verificación; nada más", () => {
    for (const ok of [
      "node dist-cp/backup-job.js run",
      "node dist-cp/backup-job.js run --only acme,costa-01",
      "node dist-cp/backup-job.js migrate-tenants",
      "node dist-cp/backup-job.js migrate-tenants --only acme --apply",
      "node dist-cp/backup-job.js check-data-exports",
      "node dist-cp/backup-job.js list",
      "node .mig/run.cjs registry plan",
      "node .mig/run.cjs registry apply",
      "node .mig/run.cjs crm status",
      "node .mig/run.cjs crm apply",
    ])
      expect(isAllowedDrill(ok), ok).toBe(true);
    for (const bad of [
      "node dist-cp/backup-job.js retention --apply",
      // Restaurar EN una base nueva está permitido (prueba de restauración); conmutar la empresa a ella, nunca
      "node dist-cp/backup-job.js restore-tenant acme --apply --switch",
      "node dist-cp/backup-job.js rebuild --apply",
      "node dist-cp/backup-job.js run; rm -rf /",
      "node dist-cp/backup-job.js migrate-tenants --only ACME",
      "sh -c 'curl evil'",
      "node .mig/run.cjs crm apply --database es_crm_drill_x",
      "node .mig/run.cjs crm down",
      "node .mig/run.cjs registry status; rm -rf /",
    ])
      expect(isAllowedDrill(bad), bad).toBe(false);
    expect(DRILL_ALLOWED.length).toBe(8);
  });

  it("el registro mostrado no lleva DSN, claves ni tokens", () => {
    expect(scrub("conecta a mysql://u:p@host:3306/db con sk_live_abc123 y token=xyz")).toBe("conecta a mysql://*** con *** y token=***");
  });
});

describe("diagnóstico de almacenamiento", () => {
  it("nunca muestra el valor de una clave: referencia o valor fijo, con huella corta", () => {
    const secret = "AKIA-SUPER-SECRETO-123";
    const fixed = describeStorageVar("BACKUP_S3_SECRET_KEY", secret, secret);
    expect(fixed).toMatch(/^valor fijo · huella [0-9a-f]{8}$/);
    expect(fixed).not.toContain(secret);
    const ref = describeStorageVar("BACKUP_S3_ACCESS_KEY", "${{backups.ACCESS_KEY_ID}}", secret);
    expect(ref.startsWith("referencia ${{backups.ACCESS_KEY_ID}} · huella ")).toBe(true);
    expect(ref).toMatch(/ · huella [0-9a-f]{8}$/);
    expect(ref).not.toContain(secret);
    expect(describeStorageVar("S3_SECRET_KEY", undefined, undefined)).toBe("—");
  });

  it("endpoint y bucket se muestran tal cual (o su referencia y valor efectivo)", () => {
    expect(describeStorageVar("BACKUP_S3_BUCKET", "elephant-source-backups", "elephant-source-backups")).toBe("elephant-source-backups");
    expect(describeStorageVar("BACKUP_S3_ENDPOINT", "${{backups.ENDPOINT}}", "https://t3.example")).toBe("referencia ${{backups.ENDPOINT}} → https://t3.example");
  });
});

describe("export y flujo", () => {
  it("el export excluye la configuración de Railway de Náyade y la semilla", () => {
    expect(EXCLUDED_FROM_EXPORT).toEqual(["railway.toml", "data/seed.json"]);
  });

  it("solo manual, solo desde integration/elephant-source, entorno protegido y sin interpolar entradas en scripts", () => {
    expect(wf).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(wf).toContain('"refs/heads/integration/elephant-source"');
    expect(wf).toContain(
      "environment: ${{ inputs.environment == 'production' && (inputs.action == 'publicar' || startsWith(inputs.action, 'revertir-')) && 'elephant-source-production-despliegue' || format('elephant-source-{0}', inputs.environment) }}",
    );
    expect(wf).toMatch(/RAILWAY_TOKEN: \$\{\{ secrets\.RAILWAY_TOKEN \}\}/);
    // Las entradas solo en env:, nunca dentro de run:
    const runBlocks = wf.split(/\n\s+run: /).slice(1).map((b) => b.split(/\n\s{6}- /)[0]);
    for (const b of runBlocks) expect(b).not.toMatch(/\$\{\{\s*inputs\./);
    const code = wf
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/n[aá]yade|skicenter/i);
    expect(wf).toContain("@railway/cli@5.68.0");
  });

  it("orden del plan: drill y backup-job se despliegan antes de migrar; las migraciones simulan antes de aplicar", () => {
    const order = ["desplegar-restore-drill", "desplegar-backup-job", "copia-de-seguridad", "migraciones-plataforma-simulacion", "migraciones-plataforma-aplicar", "migraciones-simulacion", "migraciones-aplicar", "verificar-migraciones", "desplegar-controlplane", "desplegar-core"].map((a) => wf.indexOf(`- ${a}`));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("preparar-pruebas-live (autorizado por el propietario el 23/10/2026)", () => {
  it("almacenamiento: referencias a los buckets de live para core, backup-job y restore-drill; ningún otro entorno", () => {
    const refs = storageReferences("live");
    expect(Object.keys(refs).sort()).toEqual(["backup-job", "core", "restore-drill"]);
    expect(refs.core).toEqual({
      S3_ENDPOINT: "${{es-live-media.ENDPOINT}}",
      S3_BUCKET: "${{es-live-media.BUCKET}}",
      S3_REGION: "${{es-live-media.REGION}}",
      S3_ACCESS_KEY: "${{es-live-media.ACCESS_KEY_ID}}",
      S3_SECRET_KEY: "${{es-live-media.SECRET_ACCESS_KEY}}",
    });
    expect(refs["restore-drill"].BACKUP_S3_SECRET_KEY).toBe("${{es-live-backups.SECRET_ACCESS_KEY}}");
    expect(refs["backup-job"].BACKUP_S3_ACCESS_KEY).toBe("${{es-live-backups.ACCESS_KEY_ID}}");
    // Production: solo los servicios de copias (backup-job y restore-drill), nunca el Core
    expect(Object.keys(storageReferences("production")).sort()).toEqual(["backup-job", "core", "restore-drill"]);
    expect(storageReferences("production")["restore-drill"].BACKUP_S3_SECRET_KEY).toBe("${{elephant-source-backups.SECRET_ACCESS_KEY}}");
    expect(() => storageReferences("staging")).toThrow();
  });

  it("dominios: solo dos empresas de prueba, en orden, en las pasarelas gw-prueba-a/b de live", () => {
    expect(testTenantDomains("live", "cms-prueba-a-20261023,cms-prueba-b-20261023")).toEqual([
      { service: "gw-prueba-a", tenantId: "cms-prueba-a-20261023", domain: "cms-prueba-a-20261023.up.railway.app" },
      { service: "gw-prueba-b", tenantId: "cms-prueba-b-20261023", domain: "cms-prueba-b-20261023.up.railway.app" },
    ]);
    for (const bad of ["skibox,cms-prueba-b-20261023", "cms-prueba-a-20261023", "app,bigelephant", "cms-prueba-a-20261023,cms-prueba-a-20261023"]) {
      expect(() => testTenantDomains("live", bad), bad).toThrow();
    }
    expect(() => testTenantDomains("production", "cms-prueba-a-20261023,cms-prueba-b-20261023")).toThrow();
  });

  it("el flujo la limita a live y a cms-prueba-a/b, y despliega el Core después", () => {
    expect(wf).toContain("- preparar-pruebas-live");
    expect(wf).toContain('if [ "${ES_ENV}" != "live" ]; then echo "preparar-pruebas-live solo existe en live"; exit 1; fi');
    expect(wf).toContain("grep -Eq '^cms-prueba-a-[0-9]{8},cms-prueba-b-[0-9]{8}$'");
    expect(wf.indexOf("storage-fix --env")).toBeLessThan(wf.indexOf('if [ "${ES_ACTION}" = "preparar-pruebas-live" ]; then SERVICE="core"; fi'));
    expect(wf.indexOf("test-gateways --env")).toBeLessThan(wf.indexOf('if [ "${ES_ACTION}" = "preparar-pruebas-live" ]; then SERVICE="core"; fi'));
  });

  it("pasarelas de prueba: se crean solo en el entorno del token, copian de core-gateway solo usuario, hash y destino", () => {
    expect(GATEWAY_TEMPLATE_SERVICE).toBe("core-gateway");
    expect([...GATEWAY_COPIED_VARS]).toEqual(["GATEWAY_USER", "GATEWAY_PASSWORD_HASH", "UPSTREAM"]);
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    // serviceCreate siempre con environmentId (sin él, Railway crea el servicio en todos los entornos)
    expect(src).toContain('serviceCreate(input:$i){ id } }", { i: { projectId: p, environmentId: sc.environmentId, name: g.service } }');
    expect(src).not.toMatch(/PUBLIC_HOSTS|APP_ENTRY_HOST/);
  });
});

describe("órdenes de restore-drill", () => {
  it("una orden que no termina en SUCCESS hace fallar el paso (detectado: copia de production CRASHED dada por buena)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    const body = src.slice(src.indexOf('if (cmd === "drill") {'));
    expect(body).toMatch(/if \(d\.status !== "SUCCESS"\) \{[\s\S]*?process\.exit\(1\);/);
    // Siempre se devuelve el servicio a «list» antes de fallar
    expect(body.indexOf("await setAndDeploy(DRILL_IDLE);")).toBeLessThan(body.indexOf('if (d.status !== "SUCCESS")'));
  });
});

describe("verificación independiente de la copia", () => {
  it("solo lectura, sin imprimir claves; sin copias de las últimas 24 h, falla", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
    const body = src.slice(src.indexOf('if (cmd === "backup-check") {'), src.indexOf('if (cmd === "status") {'));
    expect(body).toContain("ListObjectsV2Command");
    expect(body).not.toMatch(/PutObject|DeleteObject|variableUpsert/);
    for (const line of body.split("\n").filter((l) => /console\.(log|error)/.test(l))) expect(line, line.trim()).not.toMatch(/SECRET|ACCESS_KEY/);
    expect(body).toMatch(/if \(!recent\.length\) \{[\s\S]*?process\.exit\(1\)/);
    const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8");
    expect(wf.indexOf("- copia-de-seguridad")).toBeLessThan(wf.indexOf("- verificar-copia"));
  });
});
