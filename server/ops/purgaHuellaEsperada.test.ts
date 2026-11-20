/**
 * Parámetro obligatorio `expected_plan_hash` del workflow protegido de la purga (Dirección, 20/11/2026): sin la huella autorizada no
 * hay orden de borrado, la huella se valida antes de nada y se compara con el plan recalculado antes del primer borrado.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DRILL_ALLOWED, isAllowedDrill } from "../../scripts/deploy/esRailwayLib";

const H = "9d0c1fdd82f8db98658d13cff457abaf05958e43d9904e1ecfa4eddcefaf5650";
const BJ = "node dist-cp/backup-job.js purge-test-companies";
const REF = "44830001:jorgemgrande-stack";

describe("lista blanca de la orden de purga", () => {
  it("POSITIVOS: simulación (con o sin huella) y borrado solo con huella y referencia de auditoría", () => {
    expect(isAllowedDrill(BJ)).toBe(true);
    expect(isAllowedDrill(`${BJ} --expected-plan-hash=${H}`)).toBe(true);
    expect(isAllowedDrill(`${BJ} --apply --expected-plan-hash=${H} --audit-ref=${REF}`)).toBe(true);
    expect(isAllowedDrill(`${BJ} --apply --expected-plan-hash=${H} --audit-ref=1:a`)).toBe(true);
  });

  it("NEGATIVOS: --apply sin huella o sin referencia, huella mal formada y argumentos de más NO son órdenes permitidas", () => {
    for (const bad of [
      `${BJ} --apply`,
      `${BJ} --apply --expected-plan-hash=${H}`,
      `${BJ} --apply --audit-ref=${REF}`,
      `${BJ} --apply --audit-ref=${REF} --expected-plan-hash=${H}`,
      `${BJ} --apply --expected-plan-hash=${H.slice(1)} --audit-ref=${REF}`,
      `${BJ} --apply --expected-plan-hash=${H}0 --audit-ref=${REF}`,
      `${BJ} --apply --expected-plan-hash=${H.toUpperCase()} --audit-ref=${REF}`,
      `${BJ} --apply --expected-plan-hash=${"z".repeat(64)} --audit-ref=${REF}`,
      `${BJ} --expected-plan-hash=`,
      `${BJ} --expected-plan-hash=${H} --audit-ref=${REF}`,
      `${BJ} --apply --expected-plan-hash=${H} --audit-ref=run:actor`,
      `${BJ} --apply --expected-plan-hash=${H} --audit-ref=1:ac tor`,
      `${BJ} --apply --expected-plan-hash=${H} --audit-ref=1:a;rm -rf /`,
      `${BJ} --apply --expected-plan-hash=${H} --audit-ref=${REF} --force`,
      `${BJ} --apply --expected-plan-hash=${H} --audit-ref=1:${"a".repeat(40)}`,
      `${BJ} --expected-plan-hash=${H}; rm -rf /`,
      `${BJ} --expected-plan-hash=${H} --apply`,
    ])
      expect(isAllowedDrill(bad), bad).toBe(false);
  });

  it("la purga tiene UNA sola entrada en la lista blanca (se sustituye la anterior, no se añade otra)", () => {
    expect(DRILL_ALLOWED.filter((r) => r.source.includes("purge-test-companies")).length).toBe(1);
  });
});

describe("workflow de despliegue: expected_plan_hash", () => {
  const wf = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");

  it("es una entrada del workflow, se pasa por env y nunca se interpola dentro de un run", () => {
    expect(wf).toMatch(/\n {6}expected_plan_hash:\n {8}description: [^\n]*\n {8}required: false\n {8}type: string\n/);
    expect(wf).toContain("ES_EXPECTED_PLAN_HASH: ${{ inputs.expected_plan_hash }}");
    const runBlocks = wf.split(/\n\s+run: /).slice(1).map((b) => b.split(/\n\s{6}- /)[0]);
    for (const b of runBlocks) expect(b).not.toMatch(/\$\{\{\s*inputs\./);
  });

  it("las comprobaciones previas rechazan una huella mal formada y exigen la huella para purgar, antes de cualquier otro paso", () => {
    const pre = wf.slice(wf.indexOf("Comprobaciones previas"), wf.indexOf("- uses: actions/checkout@v4"));
    expect(pre).toContain(`grep -Eq '^[0-9a-f]{64}$'`);
    expect(pre).toMatch(/\[ "\$\{ES_ACTION\}" = "purgar-empresas-prueba" \] && \[ -z "\$\{ES_EXPECTED_PLAN_HASH\}" \]; then echo "[^"]*"; exit 1/);
  });

  it("el borrado lleva la huella y la referencia de la ejecución; la simulación previa también lleva la huella (falla pronto)", () => {
    const apply = wf.slice(wf.indexOf("Purga de empresas de prueba 3/3"));
    expect(apply.slice(0, 700)).toContain('purge-test-companies --apply --expected-plan-hash=${ES_EXPECTED_PLAN_HASH} --audit-ref=${GITHUB_RUN_ID}:${GITHUB_ACTOR}"');
    const sim = wf.slice(wf.indexOf("Purga de empresas de prueba 2/3"), wf.indexOf("Purga de empresas de prueba 3/3"));
    expect(sim).toContain('purge-test-companies --expected-plan-hash=${ES_EXPECTED_PLAN_HASH}"');
    // El orden se mantiene: copia verificada (1/3) → simulación con huella (2/3) → borrado (3/3)
    expect(wf.indexOf("Purga de empresas de prueba 1/3")).toBeLessThan(wf.indexOf("Purga de empresas de prueba 2/3"));
    expect(wf.indexOf("Purga de empresas de prueba 2/3")).toBeLessThan(wf.indexOf("Purga de empresas de prueba 3/3"));
    // Ninguna orden de borrado sin huella
    expect(wf).not.toMatch(/purge-test-companies --apply"/);
  });

  it("la orden de la purga exige --expected-plan-hash y --audit-ref para borrar y compara antes de aplicar", () => {
    const job = fs.readFileSync(path.resolve(__dirname, "../controlPlane/backupJob.ts"), "utf8").replace(/\r\n/g, "\n");
    const start = job.indexOf('case "purge-test-companies"');
    const body = job.slice(start, job.indexOf('case "orphans"'));
    expect(body).toContain('if (apply && (!expectedPlanHash || !auditRef)) die(');
    // La comprobación va antes de calcular el plan y antes de aplicarlo
    expect(body.indexOf("if (apply && (!expectedPlanHash || !auditRef))")).toBeLessThan(body.indexOf("await planPurge("));
    expect(body.indexOf("plan.planHash !== expectedPlanHash")).toBeLessThan(body.indexOf("await applyPurge("));
    expect(body).toContain("expectedPlanHash!,");
    expect(body).toContain("auditRef!,");
  });
});
