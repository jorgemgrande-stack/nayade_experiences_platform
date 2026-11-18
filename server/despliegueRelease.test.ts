/**
 * Regresión del incidente de despliegues parciales (#875, 17-18/11/2026) y del modelo de autorizaciones por contenido.
 * Escenarios A–N de la orden de Dirección, sobre repositorios git temporales (sin Railway ni GitHub).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitView } from "../scripts/deploy/esGitView";
import { approvalsFromRuns, ciGate, describeOutcome, isBlocked, planRelease, releaseOk, renderSummary, verifyRelease, type Approval, type RunRecord, type Service } from "../scripts/deploy/esReleaseLib";

let dir: string;
const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
const write = (f: string, c: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), c);
};
const commit = (msg: string, files: Record<string, string>) => {
  for (const [f, c] of Object.entries(files)) write(f, c);
  g("add", "-A");
  g("commit", "-q", "-m", msg);
  return g("rev-parse", "HEAD");
};
const AUTH = (n: number) => `export const guard = () => { return ${n}; };\n`;
const approval = (sha: string, action = "desplegar-core", over: Partial<Approval> = {}): Approval => ({
  runId: 1,
  action,
  environment: "production",
  sha,
  services: action === "aplicar-production" ? ["controlplane", "core", "core-gateway"] : ["core"],
  actor: "owner",
  at: "2026-11-17",
  ...over,
});
const at = (s: string | null, c: string | null, w: string | null): Record<Service, string | null> => ({ controlplane: s, core: c, "core-gateway": w });
const plan = (target: string, active: Record<Service, string | null>, approvals: Approval[] = [], environment = "production") => planRelease({ environment, target, active, git: gitView(dir), approvals });

let base: string, auth1: string, ord1: string, auth2: string, authB: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "es-release-"));
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  base = commit("base", { "server/authGuard.ts": AUTH(0), "server/ok.ts": "export const a = 1;\n" });
  auth1 = commit("cambio protegido en autenticación", { "server/authGuard.ts": AUTH(1) });
  ord1 = commit("cambio ordinario", { "server/ok.ts": "export const a = 2;\n" });
  auth2 = commit("autenticación otra vez", { "server/authGuard.ts": AUTH(2) });
  authB = commit("otro protegido nuevo", { "server/localAuth.ts": AUTH(9) });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("A/B: ordinario y protegido nuevo", () => {
  it("A: tres servicios alineados + cambio ordinario → publicar", () => {
    const p = plan(ord1, at(auth1, auth1, auth1), []);
    expect(p.decision).toBe("publicar");
    expect(p.migrations).toBe("no");
  });
  it("B: protegido nuevo en autenticación sin aprobación → bloqueo", () => {
    const p = plan(auth1, at(base, base, base));
    expect(p.decision).toBe("bloqueado-protegido");
    expect(p.reasons.join()).toMatch(/authGuard/);
  });
});

describe("C/D: parcial y publicación ordinaria posterior (el incidente)", () => {
  const approvedList = () => [approval(auth1)];
  it("C: tras aprobar y publicar en Core, Core está al día y los otros dos quedan pendientes y coherentes", () => {
    const p = plan(auth1, at(base, auth1, base), approvedList());
    expect(p.services.map((s) => s.state)).toEqual(["ordinario", "al-dia", "ordinario"]);
    expect(p.services[0].covered[0].runId).toBe(1);
    expect(p.decision).toBe("publicar");
  });
  it("D: se fusiona un cambio ordinario y Core va por delante: NO se repite la aprobación del contenido ya aprobado", () => {
    const p = plan(ord1, at(base, auth1, base), approvedList());
    expect(p.decision).toBe("publicar");
    expect(p.services.every((s) => s.missing.length === 0)).toBe(true);
  });
  it("D (defecto original): sin registro de aprobación el mismo escenario sí bloquea, y por eso hacía falta", () => {
    expect(plan(ord1, at(base, auth1, base), []).decision).toBe("bloqueado-protegido");
  });
});

describe("E/N/M/K: el alcance de la autorización", () => {
  it("E: el mismo fichero protegido vuelve a modificarse → nueva autorización", () => {
    expect(plan(auth2, at(auth1, auth1, auth1), [approval(auth1)]).decision).toBe("bloqueado-protegido");
  });
  it("E': el contenido aprobado en un commit sigue aprobado en el destino si el fichero es idéntico", () => {
    expect(plan(auth2, at(base, base, base), [approval(auth2)]).decision).toBe("publicar");
  });
  it("N: cubre lo aprobado pero hay otro protegido nuevo → pide solo la parte no autorizada", () => {
    const p = plan(authB, at(base, base, base), [approval(auth2)]);
    expect(p.decision).toBe("bloqueado-protegido");
    expect(p.reasons.every((r) => /localAuth/.test(r))).toBe(true);
    expect(p.services[0].covered.length).toBe(1);
  });
  it("M: el mismo cambio aprobado vía desplegar-core cubre controlplane y core-gateway", () => {
    expect(plan(auth1, at(base, base, base), [approval(auth1, "desplegar-core")]).decision).toBe("publicar");
  });
  it("K: aprobación de otro entorno → rechazo", () => {
    expect(plan(auth1, at(base, base, base), [approval(auth1, "desplegar-core", { environment: "live" })]).decision).toBe("bloqueado-protegido");
  });
  it("K': una aprobación sin servicios del Core no cubre código", () => {
    expect(plan(auth1, at(base, base, base), [approval(auth1, "desplegar-core", { services: [] })]).decision).toBe("bloqueado-protegido");
  });
});

describe("aprobaciones verificables desde GitHub (invariantes 5 y 8)", () => {
  const run = (o: Partial<RunRecord> = {}): RunRecord => ({
    id: 7,
    displayTitle: `desplegar-core · production · ${auth1.slice(0, 12)}`,
    event: "workflow_dispatch",
    conclusion: "success",
    headBranch: "integration/elephant-source",
    headSha: ord1,
    actor: "owner",
    actorPermission: "admin",
    createdAt: "2026-11-17",
    ...o,
  });
  const resolve = (s: string) => (auth1.startsWith(s) ? auth1 : null);
  it("una ejecución legítima produce la aprobación del commit exacto", () => {
    const a = approvalsFromRuns([run()], resolve);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ sha: auth1, services: ["core"], environment: "production" });
  });
  it("no cuentan: fallida, de otra rama, sin admin, otra acción, ordinaria, live, nombre libre o commit no resoluble", () => {
    const bad: Partial<RunRecord>[] = [
      { conclusion: "failure" },
      { conclusion: null },
      { headBranch: "feat/x" },
      { actorPermission: "write" },
      { actorPermission: null },
      { event: "pull_request" },
      { displayTitle: `publicar · production · ${auth1.slice(0, 12)}` },
      { displayTitle: `desplegar-core · live · ${auth1.slice(0, 12)}` },
      { displayTitle: "aprobado por Dirección: desplegar-core production" },
      { displayTitle: `correo-production-activar · production · ${auth1.slice(0, 12)}` },
      { displayTitle: "desplegar-core · production · deadbeef" },
    ];
    for (const b of bad) expect(approvalsFromRuns([run(b)], resolve), JSON.stringify(b)).toEqual([]);
  });
});

describe("F/G: CI estricta", () => {
  const REQ = ["Suites del Core multiempresa (bloqueante)", "Secretos y ficheros sensibles (bloqueante)"];
  it("success en todo → sin problemas", () => expect(ciGate(REQ.map((name) => ({ name, conclusion: "success" })), REQ)).toEqual([]));
  it("failure, cancelled, skipped, pendiente, ausente o duplicado en otro estado bloquean", () => {
    for (const c of ["failure", "cancelled", "skipped", null, "neutral", "timed_out", "action_required"])
      expect(ciGate([{ name: REQ[0], conclusion: c }, { name: REQ[1], conclusion: "success" }], REQ), String(c)).toHaveLength(1);
    expect(ciGate([{ name: REQ[1], conclusion: "success" }], REQ)).toHaveLength(1);
    expect(ciGate([{ name: REQ[0], conclusion: "success" }, { name: REQ[0], conclusion: "failure" }, { name: REQ[1], conclusion: "success" }], REQ)).toHaveLength(1);
  });
});

describe("H: concurrencia y regresión", () => {
  it("un commit antiguo no sustituye a uno más reciente", () => {
    const p = plan(ord1, at(auth2, auth2, auth2), [approval(auth2)]);
    expect(p.decision).toBe("bloqueado-regresion");
    expect(p.reasons.join()).toMatch(/revertir-core/);
  });
  it("misma versión: sin cambios, no hay doble despliegue", () => expect(plan(auth2, at(auth2, auth2, auth2)).decision).toBe("sin-cambios"));
  it("commit de una rama divergente tampoco se publica", () => {
    const head = g("rev-parse", "HEAD");
    g("checkout", "-q", "-b", "otra", base);
    const other = commit("divergente", { "server/ok.ts": "export const a = 99;\n" });
    g("checkout", "-q", head);
    expect(plan(other, at(ord1, ord1, ord1)).decision).toBe("bloqueado-regresion");
  });
});

describe("I/L/J: fallos parciales, verificación y mensajes", () => {
  it("I: un servicio queda atrás → desalineado, nunca verificado; la siguiente publicación retoma desde el estado real", () => {
    expect(verifyRelease(auth1, at(auth1, auth1, base))).toEqual({ controlplane: "verificado", core: "verificado", "core-gateway": "desalineado" });
    expect(releaseOk({ environment: "production", outcome: "fallido", detail: "core-gateway no quedó activo" })).toBe(false);
    const p = plan(auth1, at(auth1, auth1, base), [approval(auth1)]);
    expect(p.services.map((s) => s.state)).toEqual(["al-dia", "al-dia", "ordinario"]);
  });
  it("L: sin información real del despliegue → desconocido y bloqueo, nunca éxito", () => {
    expect(verifyRelease(auth1, at(auth1, null, auth1)).core).toBe("desconocido");
    const p = plan(ord1, at(auth1, null, auth1));
    expect(p.decision).toBe("bloqueado-desconocido");
    expect(p.migrations).toBe("unknown");
    expect(isBlocked(p.decision)).toBe(true);
  });
  it("J: live publicado y production bloqueado → mensaje explícito", () => {
    const live = { environment: "live", outcome: "publicado-verificado" as const };
    const prod = { environment: "production", outcome: "bloqueado" as const, detail: "authGuard.ts" };
    const md = renderSummary({ target: ord1, outcomes: [live, prod], plans: [plan(auth1, at(base, base, base))] });
    expect(describeOutcome(live)).toBe("live: PUBLICADO y verificado");
    expect(md).toMatch(/production: NO PUBLICADO — bloqueado/);
    expect(md).toMatch(/production NO\*\*/);
    expect(md).not.toMatch(/Publicación correcta/i);
  });
});

describe("migraciones destructivas", () => {
  it("una migración no aditiva exige aprobación del contenido, y se reconoce cuando está aprobada", () => {
    const m1 = commit("migración", { "db/crm/migrations/0001_x.sql": "ALTER TABLE x MODIFY COLUMN y BIGINT;\n" });
    expect(plan(m1, at(authB, authB, authB)).decision).toBe("bloqueado-protegido");
    expect(plan(m1, at(authB, authB, authB), [approval(m1, "aplicar-production")]).decision).toBe("publicar");
  });
});

describe("flujos: lo que garantiza el YAML", () => {
  const dep = fs.readFileSync(".github/workflows/deploy-elephant-source.yml", "utf8").replace(/\r\n/g, "\n");
  const pub = fs.readFileSync(".github/workflows/publicacion.yml", "utf8").replace(/\r\n/g, "\n");
  it("el run-name produce el formato que lee approvalsFromRuns", () => {
    expect(dep).toContain("run-name: ${{ inputs.action }} · ${{ inputs.environment }} · ${{ inputs.commit || github.sha }}");
  });
  it("production se clasifica por servicio (release-plan); el ancestro común de los tres ya no decide nada", () => {
    const prod = dep.slice(dep.indexOf('if [ "${ES_ENV}" = "production" ]; then\n            # Cada servicio contra SU commit'), dep.indexOf("Live se despliega en nativo"));
    expect(prod).toContain("release-plan");
    expect(prod).not.toContain("active-sha");
    expect(prod).not.toContain("merge-base");
  });
  it("tras publicar se verifica el commit servido y production bloqueado NO termina en verde", () => {
    expect(dep).toContain("release-verify");
    const res = dep.slice(dep.indexOf("Resultado de la publicación (explícito por entorno)"));
    expect(res).toContain("if: always()");
    expect(res).toContain("context=elephant-source/production");
    expect(res).toMatch(/STATE.*= "pending"[^\n]*\n?[^\n]*exit 1/);
  });
  it("la publicación separa los resultados de live y production", () => {
    expect(pub).toContain("resumen:");
    expect(pub).toMatch(/Live está publicado pero production NO/);
  });
  it("el flujo conserva la barrera de CI exacta (success) y la concurrencia sin cancelar", () => {
    expect(dep).toContain('"Suites del Core multiempresa (bloqueante)" "Secretos y ficheros sensibles (bloqueante)"');
    expect(dep).toMatch(/cancel-in-progress: false/);
  });
});

describe("revisión independiente: huecos cerrados", () => {
  it("borrar un fichero protegido nunca se aprueba por coincidir en «ausente»", () => {
    const del = commit("borra el guardián", { "server/passwordReset.ts": AUTH(1) });
    const del2 = (() => {
      fs.rmSync(path.join(dir, "server/passwordReset.ts"));
      g("add", "-A");
      g("commit", "-q", "-m", "borra");
      return g("rev-parse", "HEAD");
    })();
    // una aprobación anterior en cuyo commit el fichero no existía (base) no cubre el borrado
    expect(plan(del2, at(del, del, del), [approval(base)]).decision).toBe("bloqueado-protegido");
  });
  it("los flujos pueden leer las ejecuciones anteriores (actions: read) donde se calcula la aprobación", () => {
    const dep = fs.readFileSync(".github/workflows/deploy-elephant-source.yml", "utf8").replace(/\r\n/g, "\n");
    const pub = fs.readFileSync(".github/workflows/publicacion.yml", "utf8").replace(/\r\n/g, "\n");
    expect(dep).toMatch(/statuses: write\n  # [^\n]*\n  actions: read/);
    expect(pub.match(/statuses: write\n      actions: read/g)?.length).toBe(2);
  });
  it("release-verify solo en production (en live el despliegue nativo puede adelantarse)", () => {
    const dep = fs.readFileSync(".github/workflows/deploy-elephant-source.yml", "utf8").replace(/\r\n/g, "\n");
    expect(dep).toMatch(/inputs\.environment == 'production' && env\.ES_PROD_SKIP != '1' && env\.ES_SERVICES == 'todos'\n        run: \|\n          pnpm exec tsx scripts\/deploy\/esRailway\.ts release-verify/);
  });
});
