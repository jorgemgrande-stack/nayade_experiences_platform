/** Procedimiento de la medición del Resource Manager (live y production): referencias sin secretos y órdenes permitidas. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ermUrlTemplate, isAllowedDrill, meteringPlan } from "../scripts/deploy/esRailwayLib";

describe("medición por referencias", () => {
  it("la URL del core se compone solo con referencias al servicio MySQL (sin contraseña en claro)", () => {
    expect(ermUrlTemplate("MYSQLHOST", "MYSQLPORT")).toBe("mysql://es_erm:${{MySQL.ES_ERM_PASSWORD}}@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/es_erm");
  });
  it("restore-drill recibe la contraseña por referencia y el plano de control lee la URL del core", () => {
    const p = meteringPlan("MYSQLHOST", "MYSQLPORT");
    expect(p["restore-drill"]).toEqual({ ES_ERM_PASSWORD: "${{MySQL.ES_ERM_PASSWORD}}" });
    expect(p.controlplane).toEqual({ ERM_DATABASE_URL: "${{core.ERM_DATABASE_URL}}" });
    for (const v of Object.values(p).flatMap((x) => Object.values(x))) expect(v.replace(/\$\{\{[^}]+\}\}/g, "")).not.toMatch(/[A-Za-z0-9_-]{24,}/);
  });
  it("una URL del core ya existente (live) se respeta", () => {
    expect(meteringPlan("MYSQLHOST", "MYSQLPORT", "mysql://es_erm:${{MySQL.ES_ERM_PASSWORD}}@host:3306/es_erm").core.ERM_DATABASE_URL).toBe("mysql://es_erm:${{MySQL.ES_ERM_PASSWORD}}@host:3306/es_erm");
  });
  it("restore-drill solo admite erm-setup tal cual (con o sin --apply)", () => {
    expect(isAllowedDrill("node dist-cp/backup-job.js erm-setup")).toBe(true);
    expect(isAllowedDrill("node dist-cp/backup-job.js erm-setup --apply")).toBe(true);
    expect(isAllowedDrill("node dist-cp/backup-job.js erm-setup --apply; rm -rf /")).toBe(false);
    expect(isAllowedDrill("node dist-cp/backup-job.js erm-setup --password x")).toBe(false);
  });
  it("el workflow despliega restore-drill con el commit antes de erm-setup y lo exige", () => {
    const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");
    const i = wf.indexOf("- name: Medición — base es_erm");
    const b = wf.slice(i, wf.indexOf("\n\n", i));
    expect(b.indexOf("--service restore-drill")).toBeGreaterThan(0);
    expect(b.indexOf("--service restore-drill")).toBeLessThan(b.indexOf("erm-setup --apply"));
    expect(b).toContain('--expect-sha "${ES_DEPLOY_SHA}" --command "node dist-cp/backup-job.js erm-setup --apply"');
    expect(b.indexOf("metering --env \"${ES_ENV}\" --refs")).toBeGreaterThan(b.indexOf("erm-setup --apply"));
    // Regresión 24/10: el paso debe ir DESPUÉS del commit y del export (si no, --sha y --dir llegan vacíos)
    expect(wf.indexOf("- name: Medición — base es_erm")).toBeGreaterThan(wf.indexOf("- name: Export del commit"));
    expect(wf.indexOf("- name: Export del commit")).toBeGreaterThan(wf.indexOf("- name: Commit a desplegar"));
  });
  it("medicion-comprobar lee con restore-drill del commit actual (y solo erm-setup sin --apply)", () => {
    const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");
    const i = wf.indexOf("- name: Medición — comprobar");
    const b = wf.slice(i, wf.indexOf("\n\n", i));
    expect(b.indexOf("--service restore-drill")).toBeGreaterThan(0);
    expect(b.indexOf("--service restore-drill")).toBeLessThan(b.indexOf("erm-setup"));
    expect(b).toContain('--expect-sha "${ES_DEPLOY_SHA}" --command "node dist-cp/backup-job.js erm-setup"');
    expect(b).not.toContain("--apply");
    expect(i).toBeGreaterThan(wf.indexOf("- name: Export del commit"));
    // El commit y el export también corren para esta acción
    const at = wf.indexOf("- name: Export del commit");
    expect(wf.slice(at, wf.indexOf("\n", wf.indexOf("if:", at)))).toContain("inputs.action == 'medicion-comprobar'");
  });
});
