/**
 * Regresión del 24/10/2026: las migraciones viajan en la imagen de restore-drill. Con una imagen anterior, la publicación
 * en live «aplicó» 0 migraciones (0014 y la 0024 del CRM) y dio a las empresas por al día en la 0013.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");
const script = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
const block = (from: string, to: string) => wf.slice(wf.indexOf(from), wf.indexOf(to, wf.indexOf(from)));

describe("migraciones con la imagen del commit que se publica", () => {
  it("live: se despliega restore-drill con ESE commit antes de migrar, y cada orden lo exige", () => {
    const b = block("- name: Publicar — live, copia y migraciones nuevas", "- name: Publicar — controlplane");
    const deploy = b.indexOf('deploy --env "${ES_ENV}" --service restore-drill --dir "${RUNNER_TEMP}/export" --sha "${ES_DEPLOY_SHA}"');
    expect(deploy).toBeGreaterThan(0);
    const drills = b.split("\n").filter((l) => l.includes(" drill "));
    expect(drills.length).toBeGreaterThanOrEqual(4);
    for (const l of drills) expect(l).toContain('--expect-sha "${ES_DEPLOY_SHA}"');
    expect(b.indexOf(" drill ")).toBeGreaterThan(deploy);
  });

  it("production (aplicar-production): igual, desde la copia previa hasta la última migración", () => {
    const b = block('- name: "Aplicar production 1/5', '- name: "Aplicar production 4/5');
    const deploy = b.indexOf('--service restore-drill --dir "${RUNNER_TEMP}/export" --sha "${ES_DEPLOY_SHA}"');
    expect(deploy).toBeGreaterThan(0);
    const drills = b.split("\n").filter((l) => l.includes(" drill "));
    expect(drills.length).toBeGreaterThanOrEqual(8);
    for (const l of drills) expect(l).toContain('--expect-sha "${ES_DEPLOY_SHA}"');
  });

  it("drill --expect-sha se detiene sin ejecutar nada si la imagen es de otro commit", () => {
    expect(script).toMatch(/const expectSha = arg\("expect-sha", false\);/);
    expect(script).toMatch(/if \(img !== expectSha\) \{[\s\S]{0,300}process\.exit\(1\)/);
  });
});

describe("publicación: una espera agotada vuelve atrás", () => {
  it("publish y publish-crm usan waitOrCancel (cancela el despliegue en curso y devuelve TIMEOUT, que es un fallo)", () => {
    expect(script).toMatch(/async function waitOrCancel\(/);
    expect(script).toMatch(/deploymentCancel/);
    const publish = script.slice(script.indexOf('if (cmd === "publish")'), script.indexOf('if (cmd === "active-crm")'));
    expect(publish).toContain("await waitOrCancel(sid, sc.environmentId, before)");
    expect(publish).not.toContain("await waitFor(sid, sc.environmentId, before)");
  });
});
