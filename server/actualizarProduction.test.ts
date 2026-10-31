/**
 * Actualización de production en DOS aprobaciones (autorizada por el propietario el 23/10/2026): preparar (copia,
 * verificación, restauración en base nueva y simulación; nunca aplica) y aplicar (en el orden del plan: copia justo
 * antes, plataforma, migraciones de empresas con canario genérico, despliegues y salud). Sin tocar correo, cobros ni autoservicio.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRILL_ALLOWED, isAllowedDrill, storageReferences } from "../scripts/deploy/esRailwayLib";

const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");
const steps = (action: string) => wf.split("\n      - name: ").filter((b) => b.includes(`if: inputs.action == '${action}'`)).join("\n");

describe("actualización de production", () => {
  it("prueba de restauración solo en una base NUEVA (nunca --switch)", () => {
    expect(isAllowedDrill("node dist-cp/backup-job.js restore-tenant t5-skibox --apply")).toBe(true);
    expect(isAllowedDrill("node dist-cp/backup-job.js restore-tenant t5-skibox --apply --switch")).toBe(false);
    expect(isAllowedDrill("node dist-cp/backup-job.js restore-tenant --any --apply")).toBe(true);
    expect(isAllowedDrill("node dist-cp/backup-job.js restore-tenant --any --apply --switch")).toBe(false);
    expect(isAllowedDrill("node dist-cp/backup-job.js restore-platform crm --apply")).toBe(false);
    expect(DRILL_ALLOWED.length).toBe(16);
  });

  it("el Core de production usa la referencia al bucket de ficheros", () => {
    expect(storageReferences("production").core.S3_SECRET_KEY).toBe("${{elephant-source-media.SECRET_ACCESS_KEY}}");
  });

  it("preparar-production nunca aplica migraciones", () => {
    const p = steps("preparar-production");
    expect(p).not.toMatch(/registry apply|crm apply|migrate-tenants[^"\n]*--apply/);
    expect(p).toContain("backup-check");
    // Sin empresa fija (Skibox es de prueba y se retirará): la primera con copia verificada
    expect(p).toContain('restore-tenant --any --apply"');
    expect(p).not.toContain("t5-skibox");
    expect(p).toContain("registry plan");
    expect(p).not.toContain("--switch");
  });

  it("aplicar-production: copia justo antes, plataforma, empresas (canario genérico, sin empresas fijas), despliegues y salud", () => {
    const a = steps("aplicar-production");
    const i = (x: string) => a.indexOf(x);
    expect(i("backup-job.js run")).toBeGreaterThan(-1);
    expect(i("backup-job.js run")).toBeLessThan(i("registry apply"));
    expect(i("crm apply")).toBeLessThan(i("migrate-tenants --apply"));
    expect(i("migrate-tenants --apply")).toBeLessThan(i("--service controlplane"));
    expect(i("--service core ")).toBeLessThan(i("esRailway.ts access --env"));
    // Ninguna empresa fija (demos, canarios o clientes concretos) en la publicación
    expect(a).not.toMatch(/--only [a-z0-9]|empresa-demo|skibox/);
    expect(a).not.toMatch(/MAIL_MODE|MAIL_LIVE_AUTHORIZED|CHECKOUT|SELF_SERVICE/);
  });

  it("las dos acciones se niegan fuera de production", () => {
    for (const n of ["preparar-production", "aplicar-production"]) expect(wf).toContain(`echo "${n} solo existe en production"; exit 1; fi`);
  });
});
