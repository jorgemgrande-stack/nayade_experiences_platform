/**
 * Publicación continua de Elephant Source (docs/elephant-source/PROTOCOLO_PUBLICACION.md): live automático tras el CI,
 * production ordinario sin aprobación pero solo con lo superado en live y nada que exija el procedimiento protegido.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FUNCTIONAL_CHECKS, LIVE_STATUS_CONTEXT, ORDINARY_SERVICES, EXTERNAL_LOCKED_SWITCHES, crmProtectedChanges, crmShaFromStatus, hasMigrations, protectedChanges, shaFromDeployMeta } from "../scripts/deploy/esRailwayLib";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const wf = read(".github/workflows/deploy-elephant-source.yml");
const ci = read(".github/workflows/ci.yml");
const src = read("scripts/deploy/esRailway.ts");
const step = (name: string) => {
  const i = wf.indexOf(`- name: ${name}`);
  expect(i, name).toBeGreaterThan(0);
  return wf.slice(i, wf.indexOf("\n      - name:", i + 10) >>> 0 || undefined);
};

describe("publicación continua", () => {
  it("el despliegue ordinario solo publica controlplane, core y core-gateway", () => {
    expect([...ORDINARY_SERVICES]).toEqual(["controlplane", "core", "core-gateway"]);
  });

  it("migraciones, infraestructura, dependencias e interruptores bloqueados exigen el procedimiento protegido", () => {
    for (const f of [
      "db/migrations/0014_x.sql",
      "db/crm/migrations/0024_x.sql",
      "drizzle/schema.ts",
      "deploy/railway/Dockerfile",
      "Dockerfile.controlplane",
      "package.json",
      "pnpm-lock.yaml",
      "railway.controlplane.toml",
      "server/mail/policy.ts",
    ])
      expect(protectedChanges([f]), f).toHaveLength(1);
    expect(protectedChanges(["server/x.ts"], "+  if (process.env.CP_PUBLIC_CHECKOUT_ENABLED === '1') {")).toHaveLength(1);
    expect(protectedChanges(["server/x.ts"], "-  const mode = env.MAIL_MODE ?? 'off';")).toHaveLength(1);
    expect(protectedChanges(["server/x.ts"], "+  const model = process.env.LLM_MODEL;")).toHaveLength(1);
  });

  it("el código ordinario pasa", () => {
    expect(protectedChanges(["server/routers.ts", "client/src/pages/TenantHome.tsx", "shared/tenantNav.ts", "docs/x.md"], "+const a = 1;\n--- a/x\n+++ b/x")).toEqual([]);
    expect(hasMigrations(["server/routers.ts"])).toBe(false);
    expect(hasMigrations(["db/registry/migrations/0014.sql"])).toBe(true);
  });

  it("lee el commit del mensaje del despliegue y no inventa uno", () => {
    const sha = "d67516fc2c47a2b5b8ef3a8b0f6c3a1c0d9e8f71";
    expect(shaFromDeployMeta({ commitMessage: `nayade_experiences_platform ${sha}` }, "nayade_experiences_platform")).toBe(sha);
    expect(shaFromDeployMeta({ reason: "redeploy" }, "nayade_experiences_platform")).toBeNull();
    expect(shaFromDeployMeta({ commitMessage: "otro-repo " + sha }, "nayade_experiences_platform")).toBeNull();
  });

  it("comprobaciones funcionales en los dos entornos; las de live con la credencial de la pasarela", () => {
    expect(FUNCTIONAL_CHECKS.live.length).toBeGreaterThan(0);
    expect(FUNCTIONAL_CHECKS.live.every((c) => c.auth)).toBe(true);
    expect(FUNCTIONAL_CHECKS.production.map((c) => c.url)).toContain("https://skibox.app.bigelephant.es/readyz");
    expect(FUNCTIONAL_CHECKS.production.some((c) => c.auth)).toBe(false);
  });

  it("production ordinario: entorno propio sin aprobación solo para publicar y revertir; lo demás, el protegido", () => {
    expect(wf).toContain("'elephant-source-production-despliegue'");
    expect(wf).toContain("format('elephant-source-{0}', inputs.environment)");
    const gate = step("Publicar — production solo con CI y live superados por el mismo commit");
    expect(gate).toContain(`select(.context == "${LIVE_STATUS_CONTEXT}")`);
    expect(gate).toContain("Suites del Core multiempresa (bloqueante)");
    expect(gate).toContain("Secretos y ficheros sensibles (bloqueante)");
    expect(step("Publicar — qué trae respecto a lo activo (en production, nada que exija el procedimiento protegido)")).toContain("--production");
    // Las migraciones del despliegue ordinario solo existen en live
    expect(step("Publicar — live, copia y migraciones nuevas")).toContain("inputs.environment == 'live'");
  });

  it("el despliegue ordinario no toca variables, dominios ni servicios y vuelve atrás si algo falla", () => {
    const body = src.slice(src.indexOf('if (cmd === "publish")'), src.indexOf('if (cmd === "active-crm")'));
    const crm = src.slice(src.indexOf('if (cmd === "publish-crm")'), src.indexOf('if (cmd === "revert")'));
    expect(crm).not.toMatch(/variableUpsert|variableDelete|serviceCreate|serviceInstanceUpdate|customDomainCreate|serviceDomainCreate/);
    expect(crm).toContain("await rollback(sid, sc.environmentId, curNode.id)");
    expect(crm).toContain("functional(env, ext.checks)");
    expect(body).not.toMatch(/variableUpsert|variableDelete|serviceCreate|serviceInstanceUpdate|customDomainCreate|serviceDomainCreate/);
    expect(body).toContain("await rollbackAll();");
    expect(body.match(/process\.exit\(1\)/g)?.length).toBe(2);
    expect(src).toContain("deploymentRollback(id:$id)");
  });

  it("el CRM se lee con la clave de solo lectura, solo de su rama de integración y solo va al servicio crm", () => {
    const co = step("CRM — código de big-elephant-crm (integration/elephant-source)");
    expect(co).toContain("ssh-key: ${{ secrets.CRM_DEPLOY_KEY }}");
    expect(co).toContain("ref: integration/elephant-source");
    expect(co).toContain("persist-credentials: false");
    expect(step("CRM — export y despliegue")).toContain("--service crm --repo crm");
    expect(src).toContain('if ((service === "crm") !== (repo === REPOSITORIES.crm)) throw new Error(');
    expect(wf).toContain("if: (startsWith(inputs.action, 'desplegar-') && inputs.action != 'desplegar-crm' && inputs.action != 'desplegar-web') || inputs.action == 'preparar-pruebas-live'");
  });

  it("live se publica solo desde el CI de integration/elephant-source y nunca en paralelo", () => {
    expect(ci).toMatch(/branches: \[main, integration\/elephant-source\]/);
    const job = ci.slice(ci.indexOf("  publicar-live:"), ci.indexOf("  # Production ORDINARIO"));
    expect(job).toContain("needs: [quality, core-suites, secrets]");
    expect(job).toContain("if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/integration/elephant-source'");
    expect(job).toContain("auto: true");
    expect(job).toContain("environment: live");
    expect(job).toContain("action: publicar");
    expect(job).not.toContain("production");
    expect(wf).toMatch(/concurrency:\n {2}group: deploy-elephant-source-\$\{\{ inputs\.environment \}\}\n {2}cancel-in-progress: false/);
    expect(ci).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/integration/elephant-source' }}");
  });

  it("production ordinario automático solo después de live; lo protegido se omite con aviso en automático y falla en manual", () => {
    const job = ci.slice(ci.indexOf("  publicar-production:"));
    expect(job).toContain("needs: [publicar-live]");
    expect(job).toContain("environment: production");
    expect(job).toContain("action: publicar");
    expect(job).toContain("auto: true");
    expect(wf).toContain("'elephant-source-production-despliegue'");
    const changes = step("Publicar — qué trae respecto a lo activo (en production, nada que exija el procedimiento protegido)");
    expect(changes).toContain('if [ "${RC}" = "5" ] && [ "${ES_AUTO}" = "true" ]; then');
    expect(changes).toContain('echo "ES_PROD_SKIP=1" >> "${GITHUB_ENV}"');
    expect(changes).toContain('exit "${RC}"');
    expect(step("Publicar — controlplane, core y core-gateway (vuelta atrás automática si algo falla)")).toContain("env.ES_PROD_SKIP != '1'");
  });

  it("CRM: en production solo el commit que superó live, sin infraestructura ni dependencias, con su clave de solo lectura", () => {
    const pick = step("Publicar — CRM, commit a publicar");
    expect(pick).toContain('select(.context == "elephant-source/crm-live")');
    const co = step("Publicar — CRM, código (solo lectura)");
    expect(co).toContain("ssh-key: ${{ secrets.CRM_DEPLOY_KEY }}");
    expect(co).toContain("persist-credentials: false");
    const pub = step("Publicar — CRM (vuelta atrás automática si algo falla)");
    expect(pub).toContain("crm-changes");
    expect(pub).toContain("--production");
    expect(pub).toContain("publish-crm");
    expect(pub).toContain("-f context=elephant-source/crm-live");
    expect(crmProtectedChanges(["deploy/railway/Caddyfile", "package.json", "src/pages/X.tsx"])).toHaveLength(2);
    expect(crmShaFromStatus(`crm ${"a".repeat(40)}`)).toBe("a".repeat(40));
    expect(crmShaFromStatus("otra cosa")).toBeNull();
  });

  it("web comercial: mismo modelo que el CRM (live anota el commit, production solo ese, clave de solo lectura)", () => {
    const pick = step("Publicar — web, commit a publicar");
    expect(pick).toContain('select(.context == "elephant-source/web-live")');
    expect(pick).toContain("feat/elephant-web-portfolio");
    const co = step("Publicar — web, código (solo lectura)");
    expect(co).toContain("ssh-key: ${{ secrets.WEB_DEPLOY_KEY }}");
    expect(co).toContain("persist-credentials: false");
    const pub = step("Publicar — web (vuelta atrás automática si algo falla)");
    expect(pub).toContain("--service web");
    expect(pub).toContain("--production");
    expect(pub).toContain("-f context=elephant-source/web-live");
    expect(src).toContain('if ((service === "web") !== (repo === REPOSITORIES.web)) throw new Error(');
    expect(EXTERNAL_LOCKED_SWITCHES.test("+  if (env.PUBLIC_CHECKOUT_ENABLED) {")).toBe(true);
    expect(EXTERNAL_LOCKED_SWITCHES.test("+  const titulo = \"Hola\";")).toBe(false);
  });
});
