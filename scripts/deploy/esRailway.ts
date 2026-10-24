/**
 * Despliegue de Elephant Source en Railway desde GitHub Actions (.github/workflows/deploy-elephant-source.yml).
 *
 * AISLADO de Náyade y Skicenter: solo actúa si el token (RAILWAY_TOKEN, token de PROYECTO) pertenece al proyecto
 * de Elephant Source (deploy/railway/elephant-source.deploy.json) y al entorno pedido; si no, se detiene antes de
 * tocar nada. Sin token, no hace nada. Nunca imprime el token.
 *
 *   tsx scripts/deploy/esRailway.ts verify  --env live
 *   tsx scripts/deploy/esRailway.ts status  --env live            (despliegue activo de cada servicio: vuelta atrás)
 *   tsx scripts/deploy/esRailway.ts export  --sha <commit> --out <dir>
 *   tsx scripts/deploy/esRailway.ts deploy  --env live --service core --dir <dir> --sha <commit>
 *   tsx scripts/deploy/esRailway.ts drill   --env live --command "node dist-cp/backup-job.js migrate-tenants"
 *   tsx scripts/deploy/esRailway.ts health  --url https://... [--expect 200]
 *   tsx scripts/deploy/esRailway.ts storage --env live            (almacenamiento de cada servicio, sin secretos)
 *   tsx scripts/deploy/esRailway.ts storage-fix --env live        (almacenamiento como referencias a los buckets de live)
 *   tsx scripts/deploy/esRailway.ts mail-live --env live [--allow a@x,b@y]  (diagnóstico de Postmark; con --allow, sandbox)
 *   tsx scripts/deploy/esRailway.ts active-sha --env live          (commit activo de los servicios ordinarios; vacío si no se sabe)
 *   tsx scripts/deploy/esRailway.ts changes --from <commit> --to <commit> [--production]  (qué exige el procedimiento protegido)
 *   tsx scripts/deploy/esRailway.ts publish --env live --dir <dir> --sha <commit>   (despliegue ordinario con vuelta atrás automática)
 *   tsx scripts/deploy/esRailway.ts functional --env live          (comprobaciones funcionales)
 *   tsx scripts/deploy/esRailway.ts revert --env live --service core   (vuelve al despliegue anterior del servicio)
 *   tsx scripts/deploy/esRailway.ts active-crm --env live          (commit del CRM activo; vacío si no se sabe)
 *   tsx scripts/deploy/esRailway.ts crm-changes --from <c> --to <c> --dir <crm> [--production]  (cambios protegidos del CRM)
 *   tsx scripts/deploy/esRailway.ts publish-crm --env live --dir <dir> --sha <commit>   (CRM ordinario con vuelta atrás)
 *   tsx scripts/deploy/esRailway.ts test-gateways --env live --only <a>,<b> --dir <dir> --sha <commit>  (pasarelas de prueba)
 *   tsx scripts/deploy/esRailway.ts platform-domain --env live [--domain live.bigelephant.es] [--apply | --variables]
 *       (comodín *.<dominio> en core-gateway: estado y registros DNS; --apply lo crea; --variables, con el DNS verificado,
 *        pone CP_PLATFORM_DOMAINS en el plano de control)
 *
 * `drill` ejecuta una orden de operación PERMITIDA (copias, simulación y aplicación de migraciones, verificación)
 * en el servicio restore-drill de la red privada, espera a que termine, muestra su registro (sin DSN ni claves) y
 * devuelve el servicio a `list`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAIL_TEST_SERVICES, POSTMARK_WEBHOOK_TRIGGERS, mailSandboxPlan, parseMailAllowlist } from "./esRailwayLib";
import { DRILL_IDLE, EXCLUDED_FROM_EXPORT, GATEWAY_COPIED_VARS, GATEWAY_TEMPLATE_SERVICE, STORAGE_BUCKETS, STORAGE_VARS, describeStorageVar, guard, isAllowedDrill, scrub, meteringReferences, storageReferences, testTenantDomains, type DeployConfig, type TokenScope } from "./esRailwayLib";
import { ERM_DB_SERVICE, ERM_PASSWORD_VAR, LIVE_PLATFORM_DOMAIN_DEFAULT, livePlatformDomainProblems, meteringPlan, platformDomainsValue } from "./esRailwayLib";
import { CRM_CHECKS, EXTERNAL_LOCKED_SWITCHES, FUNCTIONAL_CHECKS, ORDINARY_SERVICES, WEB_CHECKS, crmProtectedChanges, hasMigrations, isExternalService, protectedChanges, shaFromDeployMeta } from "./esRailwayLib";
import { REPOSITORIES } from "../../shared/repositories";

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../deploy/railway/elephant-source.deploy.json");
const loadConfig = (): DeployConfig => JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

// ── Railway (API GraphQL oficial con token de proyecto) ─────────────────────────

const API = "https://backboard.railway.com/graphql/v2";
function token(): string {
  const t = (process.env.RAILWAY_TOKEN ?? "").trim();
  if (!t) {
    console.error("Sin RAILWAY_TOKEN: no se hace nada. Hace falta el token de proyecto autorizado (secreto del entorno de GitHub).");
    process.exit(3);
  }
  return t;
}
async function api<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", "Project-Access-Token": token() }, body: JSON.stringify({ query, variables }) });
  const j = (await r.json().catch(() => ({ errors: [{ message: `HTTP ${r.status}` }] }))) as { data?: T; errors?: unknown };
  if (j.errors || !j.data) throw new Error(`API de Railway: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}

async function scope(): Promise<TokenScope> {
  const t = await api<{ projectToken: { projectId: string; environmentId: string } }>("query { projectToken { projectId environmentId } }");
  const e = await api<{ environment: { name: string } }>("query($id:String!){ environment(id:$id){ name } }", { id: t.projectToken.environmentId });
  const p = await api<{ project: { services: { edges: Array<{ node: { id: string; name: string } }> } } }>("query($id:String!){ project(id:$id){ services { edges { node { id name } } } } }", { id: t.projectToken.projectId });
  return { projectId: t.projectToken.projectId, environmentId: t.projectToken.environmentId, environmentName: e.environment.name, services: p.project.services.edges.map((x) => x.node.name) };
}

async function serviceId(name: string): Promise<string> {
  const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
  const p = await api<{ project: { services: { edges: Array<{ node: { id: string; name: string } }> } } }>("query($id:String!){ project(id:$id){ services { edges { node { id name } } } } }", { id: t.projectToken.projectId });
  const s = p.project.services.edges.find((x) => x.node.name === name);
  if (!s) throw new Error(`servicio desconocido: ${name}`);
  return s.node.id;
}

async function latest(serviceIdValue: string, environmentId: string) {
  const d = await api<{ deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string } }> } }>(
    "query($s:String!,$e:String!){ deployments(first:1, input:{serviceId:$s, environmentId:$e}){ edges { node { id status createdAt } } } }",
    { s: serviceIdValue, e: environmentId },
  );
  return d.deployments.edges[0]?.node ?? null;
}

const FINAL = new Set(["SUCCESS", "FAILED", "CRASHED", "REMOVED", "SKIPPED"]);
/**
 * Como waitFor, pero una espera agotada es un FALLO normal (estado «TIMEOUT»): se cancela el despliegue en curso para
 * que no se active después y quien llama vuelve atrás como en cualquier otro fallo, en lugar de terminar sin hacerlo.
 */
async function waitOrCancel(serviceIdValue: string, environmentId: string, after: string | null): Promise<{ id: string; status: string }> {
  try {
    return await waitFor(serviceIdValue, environmentId, after);
  } catch {
    const pending = await latest(serviceIdValue, environmentId).catch(() => null);
    if (pending && pending.id !== after && !FINAL.has(pending.status)) await api("mutation($id:String!){ deploymentCancel(id:$id) }", { id: pending.id }).catch(() => undefined);
    return { id: pending?.id ?? "?", status: "TIMEOUT" };
  }
}
async function waitFor(serviceIdValue: string, environmentId: string, after: string | null, timeoutMs = 25 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const d = await latest(serviceIdValue, environmentId);
    if (d && d.id !== after && FINAL.has(d.status)) return d;
    if (Date.now() - t0 > timeoutMs) throw new Error("tiempo de espera agotado");
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function logs(deploymentId: string, limit = 400): Promise<string> {
  const d = await api<{ deploymentLogs: Array<{ message: string }> }>("query($id:String!,$n:Int){ deploymentLogs(deploymentId:$id, limit:$n){ message } }", { id: deploymentId, n: limit });
  const run = scrub(d.deploymentLogs.map((l) => l.message).join("\n"));
  if (run.trim()) return run;
  // Si falló la construcción no hay registro de ejecución: el motivo está en el de construcción
  const b = await api<{ buildLogs: Array<{ message: string }> }>("query($id:String!,$n:Int){ buildLogs(deploymentId:$id, limit:$n){ message } }", { id: deploymentId, n: limit }).catch(() => null);
  return b ? `(registro de construcción)\n${scrub(b.buildLogs.map((l) => l.message).join("\n"))}` : "";
}

type DeploymentNode = { id: string; status: string; createdAt: string; meta: unknown };
async function deployments(serviceIdValue: string, environmentId: string, n = 10): Promise<DeploymentNode[]> {
  const d = await api<{ deployments: { edges: Array<{ node: DeploymentNode }> } }>(
    "query($s:String!,$e:String!,$n:Int){ deployments(first:$n, input:{serviceId:$s, environmentId:$e}){ edges { node { id status createdAt meta } } } }",
    { s: serviceIdValue, e: environmentId, n },
  );
  return d.deployments.edges.map((x) => x.node);
}
/** Despliegue activo (el último que terminó bien) y su commit. */
async function active(serviceIdValue: string, environmentId: string) {
  const a = (await deployments(serviceIdValue, environmentId)).find((x) => x.status === "SUCCESS");
  return a ? { id: a.id, sha: shaFromDeployMeta(a.meta, REPOSITORIES.core) } : null;
}
/** Vuelve a un despliegue anterior (misma imagen) y espera a que quede activo. */
async function rollback(serviceIdValue: string, environmentId: string, deploymentId: string): Promise<string> {
  const before = (await latest(serviceIdValue, environmentId))?.id ?? null;
  await api("mutation($id:String!){ deploymentRollback(id:$id) }", { id: deploymentId });
  return (await waitFor(serviceIdValue, environmentId, before)).status;
}
/** Comprobaciones funcionales del entorno; la credencial de la pasarela de live llega por ES_GATEWAY_AUTH (usuario:clave). */
async function functional(env: string, set: Record<string, Array<{ url: string; expect: number; auth?: boolean }>> = FUNCTIONAL_CHECKS): Promise<boolean> {
  const checks = set[env];
  if (!checks) throw new Error(`sin comprobaciones funcionales para «${env}»`);
  const auth = (process.env.ES_GATEWAY_AUTH ?? "").trim();
  let ok = true;
  for (const c of checks) {
    if (c.auth && !auth) {
      console.error(`${c.url}: falta ES_GATEWAY_AUTH`);
      ok = false;
      continue;
    }
    const headers: Record<string, string> = c.auth ? { authorization: "Basic " + Buffer.from(auth).toString("base64") } : {};
    let got = 0;
    for (let i = 0; i < 8 && got !== c.expect; i++) {
      if (i) await new Promise((r) => setTimeout(r, 15_000));
      got = (await fetch(c.url, { redirect: "manual", headers }).catch(() => null))?.status ?? 0;
    }
    console.log(`${got === c.expect ? "OK" : "FALLO"} ${c.url} → ${got}`);
    if (got !== c.expect) ok = false;
  }
  return ok;
}

// ── Órdenes ─────────────────────────────────────────────────────────────────────

function arg(name: string, required = true): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v && required) throw new Error(`Falta --${name}`);
  return v ?? "";
}

/** Servicio de otro repositorio (CRM o web comercial): repositorio del mensaje de despliegue y comprobaciones. */
function externalOf(service: string) {
  if (!isExternalService(service)) throw new Error(`servicio externo no admitido: ${service}`);
  return service === "crm" ? { service, repo: REPOSITORIES.crm, checks: CRM_CHECKS, label: "CRM" } : { service, repo: REPOSITORIES.web, checks: WEB_CHECKS, label: "Web" };
}

async function main() {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  if (cmd === "export") {
    const sha = arg("sha");
    const out = path.resolve(arg("out"));
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("commit no válido");
    fs.mkdirSync(out, { recursive: true });
    // En flujo: git archive → tar (sin cargar el repositorio en memoria)
    await new Promise<void>((resolve, reject) => {
      const git = spawn("git", ["archive", "--format=tar", sha]);
      const tar = spawn("tar", ["-x", "-C", out.split(path.sep).join("/")]);
      git.stdout.pipe(tar.stdin);
      git.on("error", reject);
      tar.on("error", reject);
      tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar terminó con ${code}`))));
    });
    for (const f of EXCLUDED_FROM_EXPORT) fs.rmSync(path.join(out, f), { force: true });
    console.log(`export de ${sha} en ${out} (sin ${EXCLUDED_FROM_EXPORT.join(", ")})`);
    return;
  }
  if (cmd === "crm-changes") {
    const from = arg("from", false);
    const to = arg("to");
    const dir = path.resolve(arg("dir"));
    for (const c of [from, to]) if (c && !/^[0-9a-f]{7,40}$/.test(c)) throw new Error("commit no válido");
    if (!from) {
      console.log("No se sabe qué versión del CRM está activa: se trata como cambio protegido.");
      if (process.argv.includes("--production")) process.exit(5);
      return;
    }
    const r = spawnSync("git", ["-C", dir, "diff", "--name-only", `${from}..${to}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git diff del CRM falló: ${(r.stderr ?? "").slice(0, 200)}`);
    const files = (r.stdout ?? "").split("\n").filter(Boolean);
    console.log(`CRM: ${files.length} ficheros cambiados entre ${from.slice(0, 12)} y ${to.slice(0, 12)}`);
    if (process.argv.includes("--production")) {
      const blocked = crmProtectedChanges(files);
      // Interruptores de funciones comerciales bloqueadas (checkout, autoservicio, Stripe): un cambio que los toque no es ordinario
      const d = spawnSync("git", ["-C", dir, "diff", "--unified=0", `${from}..${to}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (d.status !== 0) throw new Error("git diff del repositorio externo falló");
      for (const line of (d.stdout ?? "").split("\n")) {
        if (!/^[+-](?![+-])/.test(line)) continue;
        const m = EXTERNAL_LOCKED_SWITCHES.exec(line);
        if (m) blocked.push(`cambio en ${m[0]} — funciones bloqueadas`);
      }
      if (blocked.length) {
        console.error(`El CRM trae cambios que exigen el procedimiento protegido (con aprobación):\n - ${blocked.join("\n - ")}`);
        process.exit(5);
      }
      console.log("CRM: cambio ordinario (sin infraestructura ni dependencias).");
    }
    return;
  }
  if (cmd === "changes") {
    // Sin red: qué trae el rango. --production: falla (5) si hay algo que exige el procedimiento protegido
    const from = arg("from", false);
    const to = arg("to");
    for (const c of [from, to]) if (c && !/^[0-9a-f]{7,40}$/.test(c)) throw new Error("commit no válido");
    if (!from) {
      console.log("No se sabe qué versión está activa: se trata como cambio protegido.");
      console.log("migrations=unknown");
      if (process.argv.includes("--production")) process.exit(5);
      return;
    }
    const git = (a: string[]) => {
      const r = spawnSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`git ${a[0]} falló: ${(r.stderr ?? "").slice(0, 200)}`);
      return r.stdout ?? "";
    };
    const files = git(["diff", "--name-only", `${from}..${to}`]).split("\n").filter(Boolean);
    console.log(`${files.length} ficheros cambiados entre ${from.slice(0, 12)} y ${to.slice(0, 12)}`);
    console.log(`migrations=${hasMigrations(files) ? "yes" : "no"}`);
    if (process.argv.includes("--production")) {
      const blocked = protectedChanges(files, git(["diff", "--unified=0", `${from}..${to}`, "--", "server", "shared", "client", ":!*.test.ts", ":!*.test.tsx"]));
      if (blocked.length) {
        console.error(`Este despliegue no es ordinario; usa el procedimiento protegido (con aprobación):\n - ${blocked.join("\n - ")}`);
        process.exit(5);
      }
      console.log("Cambio ordinario: sin migraciones, infraestructura ni funciones bloqueadas.");
    }
    return;
  }
  if (cmd === "functional") {
    if (!(await functional(arg("env")))) process.exit(1);
    return;
  }
  if (cmd === "health") {
    const url = arg("url");
    const expect = Number(arg("expect", false) || 200);
    for (let i = 0; i < 10; i++) {
      const r = await fetch(url, { redirect: "manual" }).catch(() => null);
      if (r && r.status === expect) return void console.log(`OK ${url} → ${r.status}`);
      await new Promise((res) => setTimeout(res, 15_000));
    }
    throw new Error(`${url} no responde ${expect}`);
  }
  const env = arg("env");
  const sc = await scope();
  const service = cmd === "deploy" || cmd === "revert" ? arg("service") : cmd === "drill" ? "restore-drill" : undefined;
  if (!["verify", "status", "deploy", "drill", "active-sha", "publish", "revert", "active-crm", "publish-crm", "storage", "storage-fix", "test-gateways", "mail-live", "backup-check", "platform-domain", "metering"].includes(cmd)) throw new Error(`orden desconocida: ${cmd}`);
  const problems = guard(cfg, sc, { env, service });
  if (problems.length) {
    console.error(`Detenido antes de tocar nada:\n - ${problems.join("\n - ")}`);
    process.exit(2);
  }
  if (cmd === "verify") return void console.log(`Token del proyecto de Elephant Source, entorno «${env}»; servicios: ${sc.services.join(", ")}`);
  if (cmd === "storage") {
    // Solo lectura: qué almacenamiento usa cada servicio, sin imprimir nunca el valor de una clave
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const q = "query($p:String!,$e:String!,$s:String!,$u:Boolean){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:$u) }";
    for (const name of sc.services) {
      const vars = { p: t.projectToken.projectId, e: sc.environmentId, s: await serviceId(name) };
      const raw = await api<{ variables: Record<string, string> }>(q, { ...vars, u: true }).catch(() => null);
      const eff = await api<{ variables: Record<string, string> }>(q, { ...vars, u: false }).catch(() => null);
      if (!raw) {
        console.log(`${name}: variables no disponibles`);
        continue;
      }
      const lines = STORAGE_VARS.filter((k) => raw.variables[k] !== undefined).map((k) => `  ${k.padEnd(34)} ${describeStorageVar(k, raw.variables[k], eff?.variables[k])}`);
      console.log(`${name}:${lines.length ? "\n" + lines.join("\n") : " sin variables de almacenamiento"}`);
      // Otras dependencias del backoffice (medición, canal interno con el Core): presencia y tipo, nunca el valor
      for (const k of ["ERM_DATABASE_URL", "CP_CORE_INTERNAL_URL", "SUPPORT_JWT_SECRET"]) {
        if (raw.variables[k] === undefined) continue;
        const ref = /\$\{\{[^}]+\}\}/.test(raw.variables[k]);
        console.log(`  ${k.padEnd(34)} definida · ${ref ? `referencia ${raw.variables[k].match(/\$\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/)?.[1] ?? ""}` : "valor fijo"}${eff?.variables[k] ? "" : " · SIN VALOR EFECTIVO"}`);
      }
    }
    return;
  }
  if (cmd === "metering") {
    // Medición del Resource Manager por referencias (ver meteringPlan). --secret: contraseña del usuario es_erm en
    // MySQL.ES_ERM_PASSWORD si falta (nunca se imprime) y su referencia en restore-drill. --refs: URL del core y del plano
    // de control; si una referencia no da valor, se restaura lo anterior y falla. Sin opciones: solo lectura.
    const crypto = await import("node:crypto");
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const pid = t.projectToken.projectId;
    const q = "query($p:String!,$e:String!,$s:String!,$u:Boolean){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:$u) }";
    const vars = async (sid: string, unrendered: boolean) => (await api<{ variables: Record<string, string> }>(q, { p: pid, e: sc.environmentId, s: sid, u: unrendered })).variables;
    const upsert = (sid: string, name: string, value: string) =>
      api("mutation($i:VariableUpsertInput!){ variableUpsert(input:$i) }", { i: { projectId: pid, environmentId: sc.environmentId, serviceId: sid, name, value, skipDeploys: true } });
    const remove = (sid: string, name: string) => api("mutation($i:VariableDeleteInput!){ variableDelete(input:$i) }", { i: { projectId: pid, environmentId: sc.environmentId, serviceId: sid, name } });
    const dbSid = await serviceId(ERM_DB_SERVICE);
    const db = await vars(dbSid, true);
    const hostVar = "MYSQLHOST" in db ? "MYSQLHOST" : "RAILWAY_PRIVATE_DOMAIN";
    if (!("MYSQLPORT" in db)) throw new Error(`${ERM_DB_SERVICE} no expone MYSQLPORT: no se puede componer la URL por referencias`);
    const coreRaw = await vars(await serviceId("core"), true);
    const plan = meteringPlan(hostVar, "MYSQLPORT", coreRaw.ERM_DATABASE_URL);
    console.log(`${ERM_DB_SERVICE}: ${ERM_PASSWORD_VAR} ${db[ERM_PASSWORD_VAR] ? "definida" : "NO definida"} · host por ${hostVar}, puerto por MYSQLPORT`);
    for (const [service, wanted] of Object.entries(plan)) {
      const cur = await vars(await serviceId(service), true);
      for (const [k, v] of Object.entries(wanted)) console.log(`${service}: ${k} ${cur[k] === v ? "ya como debe" : cur[k] ? "con otro valor" : "sin definir"}`);
    }
    if (process.argv.includes("--secret") && !db[ERM_PASSWORD_VAR]) {
      await upsert(dbSid, ERM_PASSWORD_VAR, crypto.randomBytes(32).toString("base64url"));
      console.log(`${ERM_DB_SERVICE}: ${ERM_PASSWORD_VAR} creada (aleatoria, 43 caracteres; no se muestra)`);
    }
    const apply = async (services: string[]) => {
      for (const service of services) {
        const sid = await serviceId(service);
        const before = await vars(sid, true);
        const changed: string[] = [];
        for (const [k, v] of Object.entries(plan[service])) {
          if (before[k] === v) continue;
          await upsert(sid, k, v);
          changed.push(k);
        }
        const eff = await vars(sid, false);
        const empty = Object.keys(plan[service]).filter((k) => !eff[k]);
        if (empty.length) {
          for (const k of changed) {
            if (before[k] !== undefined) await upsert(sid, k, before[k]);
            else await remove(sid, k);
          }
          throw new Error(`${service}: referencias sin valor (${empty.join(", ")}); restaurados los valores anteriores`);
        }
        console.log(`${service}: ${changed.length ? `${changed.join(", ")} por referencia` : "sin cambios"} · valor efectivo presente`);
      }
    };
    if (process.argv.includes("--secret")) await apply(["restore-drill"]);
    if (process.argv.includes("--refs")) await apply(["core", "controlplane"]);
    return;
  }
  if (cmd === "platform-domain") {
    // Subdominios automáticos de las empresas de LIVE con la misma arquitectura que production: un comodín propio en la
    // pasarela compartida (nunca un servicio por empresa). Sin opciones: solo lectura.
    const domain = (arg("domain", false) || LIVE_PLATFORM_DOMAIN_DEFAULT).toLowerCase();
    const bad = livePlatformDomainProblems(env, domain);
    if (bad.length) throw new Error(bad.join("; "));
    const wildcard = `*.${domain}`;
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const pid = t.projectToken.projectId;
    const gw = await serviceId("core-gateway");
    type Rec = { hostlabel?: string; fqdn?: string; recordType?: string; requiredValue?: string; currentValue?: string; status?: string };
    type Dom = { id: string; domain: string; status?: { dnsRecords?: Rec[]; certificateStatus?: string } | null };
    const FULL = "customDomains { id domain status { dnsRecords { hostlabel fqdn recordType requiredValue currentValue status } certificateStatus } }";
    const read = async (): Promise<Dom[]> => {
      const q = (f: string) => api<{ domains: { customDomains: Dom[] } }>(`query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ ${f} } }`, { p: pid, e: sc.environmentId, s: gw });
      // Si la API no expone el detalle de estado, al menos los dominios
      return (await q(FULL).catch(() => q("customDomains { id domain }"))).domains.customDomains;
    };
    const show = (d: Dom) => {
      console.log(`core-gateway (${env}): ${d.domain} · certificado: ${d.status?.certificateStatus ?? "desconocido"}`);
      const recs = d.status?.dnsRecords ?? [];
      if (!recs.length) console.log("  (Railway no devuelve los registros DNS: consúltalos en Settings → Domains)");
      for (const r of recs) console.log(`  DNS ${(r.recordType ?? "").replace("DNS_RECORD_TYPE_", "")} ${r.fqdn ?? r.hostlabel} → ${r.requiredValue} · actual: ${r.currentValue || "—"} · ${(r.status ?? "").replace("DNS_RECORD_STATUS_", "")}`);
      return recs.length > 0 && recs.every((r) => /PROPAGATED|VALID/i.test(r.status ?? ""));
    };
    let mine = (await read()).find((d) => d.domain === wildcard);
    if (!mine && process.argv.includes("--apply")) {
      // Puerto de la pasarela (Caddy escucha en $PORT=8080 en Railway, como el resto de dominios de core-gateway)
      const c = await api<{ customDomainCreate: { id: string } }>("mutation($i:CustomDomainCreateInput!){ customDomainCreate(input:$i){ id } }", {
        i: { domain: wildcard, environmentId: sc.environmentId, projectId: pid, serviceId: gw, targetPort: 8080 },
      });
      console.log(`core-gateway: creado ${wildcard} (${c.customDomainCreate.id})`);
      mine = (await read()).find((d) => d.domain === wildcard);
    }
    if (!mine) {
      console.log(`core-gateway (${env}): sin ${wildcard}. Con --apply se crea (sin efecto hasta que exista el DNS).`);
      return;
    }
    const ready = show(mine);
    if (process.argv.includes("--variables")) {
      if (!ready) throw new Error("el DNS y el certificado aún no están verificados: no se cambia CP_PLATFORM_DOMAINS");
      const cp = await serviceId("controlplane");
      const q = "query($p:String!,$e:String!,$s:String!,$u:Boolean){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:$u) }";
      const cur = (await api<{ variables: Record<string, string> }>(q, { p: pid, e: sc.environmentId, s: cp, u: true })).variables;
      const value = platformDomainsValue(domain, cur.CP_PLATFORM_DOMAINS || cur.CP_PLATFORM_DOMAIN);
      if (cur.CP_PLATFORM_DOMAINS === value) return void console.log(`controlplane: CP_PLATFORM_DOMAINS ya es ${value}`);
      // Sin skipDeploys: Railway vuelve a desplegar el plano de control con la variable nueva (mismo código)
      await api("mutation($i:VariableUpsertInput!){ variableUpsert(input:$i) }", { i: { projectId: pid, environmentId: sc.environmentId, serviceId: cp, name: "CP_PLATFORM_DOMAINS", value } });
      console.log(`controlplane: CP_PLATFORM_DOMAINS = ${value} (antes: ${cur.CP_PLATFORM_DOMAINS ?? cur.CP_PLATFORM_DOMAIN ?? "—"})`);
    }
    return;
  }
  if (cmd === "storage-fix") {
    // Variables de almacenamiento → referencias a los buckets del entorno. Sin desplegar (lo hace el paso siguiente).
    // Si una referencia no da valor, se restaura el valor anterior y se detiene: nunca se deja un servicio sin almacenamiento.
    const buckets = STORAGE_BUCKETS[env];
    if (!buckets) throw new Error(`sin buckets definidos para «${env}»`);
    // Los buckets no siempre figuran como servicios: su existencia la prueba el valor efectivo de cada referencia (abajo)
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const q = "query($p:String!,$e:String!,$s:String!,$u:Boolean){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:$u) }";
    const upsert = (sid: string, name: string, value: string) =>
      api("mutation($i:VariableUpsertInput!){ variableUpsert(input:$i) }", { i: { projectId: t.projectToken.projectId, environmentId: sc.environmentId, serviceId: sid, name, value, skipDeploys: true } });
    for (const [service, wanted] of Object.entries({ ...storageReferences(env), ...meteringReferences(env) })) {
      if (!sc.services.includes(service)) throw new Error(`el servicio ${service} no existe en el entorno`);
      const sid = await serviceId(service);
      const vars = { p: t.projectToken.projectId, e: sc.environmentId, s: sid };
      const before = (await api<{ variables: Record<string, string> }>(q, { ...vars, u: true })).variables;
      const changed: string[] = [];
      for (const [name, value] of Object.entries(wanted)) {
        if (before[name] === value) continue;
        await upsert(sid, name, value);
        changed.push(name);
      }
      const eff = (await api<{ variables: Record<string, string> }>(q, { ...vars, u: false })).variables;
      const empty = Object.keys(wanted).filter((k) => !eff[k]);
      if (empty.length) {
        for (const name of changed) {
          if (before[name] !== undefined) await upsert(sid, name, before[name]);
          else await api("mutation($i:VariableDeleteInput!){ variableDelete(input:$i) }", { i: { projectId: t.projectToken.projectId, environmentId: sc.environmentId, serviceId: sid, name } });
        }
        throw new Error(`${service}: referencias sin valor (${empty.join(", ")}); restaurados los valores anteriores`);
      }
      console.log(`${service}: ${changed.length ? `${changed.length} variables pasan a referencia` : "ya usaba referencias"}`);
      for (const k of Object.keys(wanted)) console.log(`  ${k.padEnd(34)} ${describeStorageVar(k, wanted[k], eff[k])}`);
    }
    return;
  }
  if (cmd === "test-gateways") {
    // Pasarelas de las empresas de prueba, SOLO en live: se crean en este entorno (environmentId) si no existen, con la
    // construcción y las variables de core-gateway, se despliegan desde el mismo export y reciben <empresa>.up.railway.app
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const p = t.projectToken.projectId;
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    for (const f of EXCLUDED_FROM_EXPORT) if (fs.existsSync(path.join(dir, f))) throw new Error(`el export contiene ${f}: no se despliega`);
    const tplId = await serviceId(GATEWAY_TEMPLATE_SERVICE);
    const tplInstance = await api<{ serviceInstance: { builder: string | null; dockerfilePath: string | null; rootDirectory: string | null; healthcheckPath: string | null } }>(
      "query($e:String!,$s:String!){ serviceInstance(environmentId:$e, serviceId:$s){ builder dockerfilePath rootDirectory healthcheckPath } }",
      { e: sc.environmentId, s: tplId },
    );
    const tplVars = (await api<{ variables: Record<string, string> }>("query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:true) }", { p, e: sc.environmentId, s: tplId })).variables;
    for (const k of GATEWAY_COPIED_VARS) if (!tplVars[k]) throw new Error(`${GATEWAY_TEMPLATE_SERVICE} no tiene ${k}`);
    const cfg = tplInstance.serviceInstance;
    for (const g of testTenantDomains(env, arg("only"))) {
      let sid: string;
      const known = (await scope()).services.includes(g.service);
      if (known) sid = await serviceId(g.service);
      else {
        const c = await api<{ serviceCreate: { id: string } }>("mutation($i:ServiceCreateInput!){ serviceCreate(input:$i){ id } }", { i: { projectId: p, environmentId: sc.environmentId, name: g.service } });
        sid = c.serviceCreate.id;
        console.log(`${g.service}: creada en «${env}»`);
      }
      for (const k of GATEWAY_COPIED_VARS) {
        await api("mutation($i:VariableUpsertInput!){ variableUpsert(input:$i) }", { i: { projectId: p, environmentId: sc.environmentId, serviceId: sid, name: k, value: tplVars[k], skipDeploys: true } });
      }
      await api("mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }", {
        s: sid,
        e: sc.environmentId,
        i: { ...(cfg.builder ? { builder: cfg.builder } : {}), dockerfilePath: cfg.dockerfilePath, rootDirectory: cfg.rootDirectory, healthcheckPath: cfg.healthcheckPath },
      });
      const before = (await latest(sid, sc.environmentId))?.id ?? null;
      const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", g.service, "-e", env, "--detach", "-m", `${REPOSITORIES.core} ${sha}`], { encoding: "utf8", env: process.env });
      if (r.status !== 0) throw new Error(`railway up falló: ${scrub(r.stderr || r.stdout || "").slice(0, 400)}`);
      const d = await waitFor(sid, sc.environmentId, before);
      console.log(`${g.service}: despliegue ${d.id} → ${d.status}`);
      if (d.status !== "SUCCESS") {
        console.log((await logs(d.id, 120)).split("\n").slice(-40).join("\n"));
        process.exit(1);
      }
      const dm = await api<{ domains: { serviceDomains: Array<{ id: string; domain: string }> } }>(
        "query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ serviceDomains { id domain } } }",
        { p, e: sc.environmentId, s: sid },
      );
      const current = dm.domains.serviceDomains[0];
      if (current?.domain === g.domain) {
        console.log(`${g.service}: ya sirve ${g.domain}`);
        continue;
      }
      if (current) {
        await api("mutation($i:ServiceDomainUpdateInput!){ serviceDomainUpdate(input:$i) }", { i: { serviceDomainId: current.id, domain: g.domain, environmentId: sc.environmentId, serviceId: sid } });
      } else {
        const c = await api<{ serviceDomainCreate: { id: string } }>("mutation($i:ServiceDomainCreateInput!){ serviceDomainCreate(input:$i){ id } }", { i: { environmentId: sc.environmentId, serviceId: sid } });
        await api("mutation($i:ServiceDomainUpdateInput!){ serviceDomainUpdate(input:$i) }", { i: { serviceDomainId: c.serviceDomainCreate.id, domain: g.domain, environmentId: sc.environmentId, serviceId: sid } });
      }
      console.log(`${g.service}: ${current ? current.domain : "sin dominio"} → ${g.domain}`);
    }
    return;
  }
  if (cmd === "mail-live") {
    // Correo de pruebas en live con Postmark. Sin --allow: solo diagnóstico (lectura). Con --allow: MAIL_MODE=sandbox
    // limitado a esos destinatarios, webhook de Postmark y nada más. Nunca imprime el valor de un token.
    if (env !== "live") throw new Error("mail-live solo existe en live");
    const crypto = await import("node:crypto");
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const p = t.projectToken.projectId;
    const q = "query($p:String!,$e:String!,$s:String!,$u:Boolean){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:$u) }";
    const huella = (v: string) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 8);
    const vars: Record<string, Record<string, string>> = {};
    for (const svc of [...MAIL_TEST_SERVICES, "crm"]) {
      if (!sc.services.includes(svc)) throw new Error(`el servicio ${svc} no existe en el entorno`);
      vars[svc] = (await api<{ variables: Record<string, string> }>(q, { p, e: sc.environmentId, s: await serviceId(svc), u: false })).variables;
      const shown = Object.keys(vars[svc]).filter((k) => /^(MAIL_|POSTMARK_)/.test(k)).sort();
      console.log(`${svc}: ${shown.length ? "" : "sin variables de correo"}`);
      for (const k of shown) console.log(`  ${k.padEnd(28)} ${/TOKEN/.test(k) ? `definido · huella ${huella(vars[svc][k])}` : vars[svc][k]}`);
    }
    // Postmark: estado real del servidor y webhooks (con el token ya configurado)
    const token = MAIL_TEST_SERVICES.map((svc) => vars[svc].POSTMARK_SERVER_TOKEN).find((v) => v && v.trim());
    const pm = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`https://api.postmarkapp.com${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": token! }, body: body ? JSON.stringify(body) : undefined });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: r.status, j };
    };
    let webhooks: Array<{ ID: number; Url: string }> = [];
    const webhookHeaderFp: Record<number, string> = {};
    if (!token) console.log("Postmark: sin token de servidor en live");
    else {
      const sv = await pm("GET", "/server");
      console.log(`Postmark servidor: HTTP ${sv.status} · ${sv.status === 200 ? `«${sv.j.Name}» · color ${sv.j.Color ?? "—"} · entrada ${sv.j.InboundAddress ? "sí" : "no"}` : String(sv.j.Message ?? "")}`);
      const wh = await pm("GET", "/webhooks?MessageStream=outbound");
      webhooks = ((wh.j.Webhooks as Array<{ ID: number; Url: string }>) ?? []);
      console.log(`Postmark webhooks: ${webhooks.length ? webhooks.map((w) => w.Url).join(", ") : "ninguno"}`);
      // ¿La cabecera de cada webhook lleva el token actual del plano de control? Solo huellas, nunca valores
      const cpToken = vars.controlplane.POSTMARK_WEBHOOK_TOKEN ?? "";
      for (const w of webhooks) {
        const det = await pm("GET", `/webhooks/${w.ID}`);
        const h = ((det.j.HttpHeaders as Array<{ Name: string; Value: string }>) ?? []).find((x) => x.Name.toLowerCase() === "x-elephant-webhook-token");
        webhookHeaderFp[w.ID] = h ? huella(h.Value) : "";
        console.log(`  webhook ${w.ID}: token ${h ? `huella ${huella(h.Value)}` : "AUSENTE"} · plano de control ${cpToken ? `huella ${huella(cpToken)}` : "sin token"} → ${h && cpToken && huella(h.Value) === huella(cpToken) ? "coinciden" : "NO coinciden"}`);
        const tr = (det.j.Triggers as Record<string, { Enabled?: boolean }>) ?? {};
        console.log(`  webhook ${w.ID}: eventos activos ${Object.entries(tr).filter(([, v]) => v?.Enabled).map(([k]) => k).join(", ") || "ninguno"}`);
      }
      // El plano de control registra cada llamada del webhook (MailWebhook processed/rejected/apply_failed)
      {
        const sid = await serviceId("controlplane");
        const cur = (await deployments(sid, sc.environmentId)).find((x) => x.status === "SUCCESS");
        const lines = cur ? (await logs(cur.id, 3000)).split("\n").filter((l) => /MailWebhook/.test(l)) : [];
        console.log(`Registro del plano de control (despliegue activo): ${lines.length} líneas MailWebhook`);
        for (const l of lines.slice(-15)) console.log(`  ${l.slice(0, 240)}`);
      }
      // Prueba del lado propio: el evento de entrega REAL del último mensaje entregado (sus metadatos de Postmark),
      // enviado al webhook con la cabecera configurada. Respuesta del plano de control: recibidos/aplicados/ignorados
      if (webhooks.length) {
        const last = await pm("GET", "/messages/outbound?count=1&offset=0&status=sent");
        const m = ((last.j.Messages as Array<{ MessageID: string; Recipients?: string[] }>) ?? [])[0];
        const det = m ? await pm("GET", `/messages/outbound/${m.MessageID}/details`) : null;
        const hook = await pm("GET", `/webhooks/${webhooks[0].ID}`);
        const h = ((hook.j.HttpHeaders as Array<{ Name: string; Value: string }>) ?? []).find((x) => x.Name.toLowerCase() === "x-elephant-webhook-token");
        if (m && det && h) {
          const ev = { RecordType: "Delivery", MessageID: m.MessageID, Recipient: m.Recipients?.[0], DeliveredAt: new Date().toISOString(), Details: "prueba del webhook", Metadata: det.j.Metadata ?? {}, MessageStream: "outbound" };
          const r = await fetch(webhooks[0].Url, { method: "POST", headers: { "content-type": "application/json", "x-elephant-webhook-token": h.Value }, body: JSON.stringify(ev) });
          const txt = (await r.text()).slice(0, 200);
          console.log(`Prueba del webhook: metadatos ${Object.keys((det.j.Metadata as object) ?? {}).join(",") || "NINGUNO"} → HTTP ${r.status} ${scrub(txt)}`);
        } else console.log("Prueba del webhook: sin mensaje entregado o sin cabecera");
      }
      const out = await pm("GET", "/messages/outbound?count=100&offset=0");
      console.log(`Postmark envíos registrados: ${out.status === 200 ? out.j.TotalCount : `HTTP ${out.status}`}`);
      // Estado real de cada mensaje (evidencia sin depender del webhook): destinatario enmascarado, asunto y eventos
      const msgs = ((out.j.Messages as Array<{ MessageID: string; Subject: string; Status: string; To: Array<{ Email: string }>; ReceivedAt: string }>) ?? []);
      const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");
      const tally: Record<string, number> = {};
      for (const m of msgs) {
        const det = await pm("GET", `/messages/outbound/${m.MessageID}/details`);
        const events = ((det.j.MessageEvents as Array<{ Type: string }>) ?? []).map((e) => e.Type);
        const final = events.includes("Bounced") ? "Bounced" : events.includes("Delivered") ? "Delivered" : m.Status;
        tally[final] = (tally[final] ?? 0) + 1;
        console.log(`  ${m.ReceivedAt.slice(0, 19)} ${final.padEnd(10)} ${mask(m.To?.[0]?.Email ?? "")} · ${m.Subject.slice(0, 90)}`);
      }
      console.log(`Postmark por estado: ${JSON.stringify(tally)}`);
    }
    const allowRaw = arg("allow", false);
    if (!allowRaw) return;
    const plan = mailSandboxPlan(env, vars, parseMailAllowlist(allowRaw));
    if (plan.problems.length) throw new Error(`No se configura el sandbox:\n - ${plan.problems.join("\n - ")}`);
    const upsert = async (svc: string, name: string, value: string) =>
      api("mutation($i:VariableUpsertInput!){ variableUpsert(input:$i) }", { i: { projectId: p, environmentId: sc.environmentId, serviceId: await serviceId(svc), name, value, skipDeploys: true } });
    let webhookToken = vars.controlplane.POSTMARK_WEBHOOK_TOKEN ?? "";
    for (const c of plan.changes) {
      const value = c.generate ? crypto.randomBytes(32).toString("base64url") : c.copyFrom ? vars[c.copyFrom].POSTMARK_SERVER_TOKEN : c.value!;
      if (c.service === "controlplane" && c.name === "POSTMARK_WEBHOOK_TOKEN") webhookToken = value;
      await upsert(c.service, c.name, value);
      console.log(`${c.service}: ${c.name} → ${/TOKEN/.test(c.name) ? (c.generate ? "generado" : `copiado de ${c.copyFrom}`) : value}`);
    }
    // Webhook en Postmark hacia el CRM de live (mismo origen que el plano de control), con la cabecera de su token
    const dm = await api<{ domains: { customDomains: Array<{ domain: string }>; serviceDomains: Array<{ domain: string }> } }>(
      "query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ customDomains { domain } serviceDomains { domain } } }",
      { p, e: sc.environmentId, s: await serviceId("crm") },
    );
    const crmHost = dm.domains.customDomains[0]?.domain ?? dm.domains.serviceDomains[0]?.domain;
    if (!crmHost) throw new Error("el CRM de live no tiene dominio");
    const url = `https://${crmHost}/cp/v1/mail/postmark/webhook`;
    const hook = { Url: url, MessageStream: "outbound", HttpHeaders: [{ Name: "x-elephant-webhook-token", Value: webhookToken }], Triggers: POSTMARK_WEBHOOK_TRIGGERS };
    const existing = webhooks.find((w) => w.Url === url);
    const tokenChanged = plan.changes.some((c) => c.service === "controlplane" && c.name === "POSTMARK_WEBHOOK_TOKEN");
    // Se reescribe si el token cambió o si la cabecera guardada no lleva el token actual (o falta)
    const headerOk = !!existing && !!webhookToken && webhookHeaderFp[existing.ID] === huella(webhookToken);
    if (existing && !tokenChanged && headerOk) console.log(`Postmark webhook ya configurado: ${url} (sin cambios)`);
    else {
      const r = existing ? await pm("PUT", `/webhooks/${existing.ID}`, hook) : await pm("POST", "/webhooks", hook);
      // Postmark verifica el destino al guardar: si la pasarela del CRM aún no abre la ruta (imagen anterior a su
      // excepción), no se guarda, pero el correo de pruebas puede seguir (la entrega se comprueba por la API de Postmark)
      if (r.status !== 200) console.log(`AVISO: Postmark no guardó el webhook (HTTP ${r.status}: ${String(r.j.Message ?? "")}). Revisar la pasarela del CRM; se continúa.`);
      else console.log(`Postmark webhook ${existing ? "actualizado" : "creado"}: ${url} (entrega, rebote, queja y baja)`);
    }
    // El CRM (otro repositorio) toma su variable al redesplegar la MISMA imagen que ya sirve (sin recompilar su código)
    if (plan.changes.some((c) => c.service === "crm")) {
      const crmId = await serviceId("crm");
      const before = await latest(crmId, sc.environmentId);
      if (!before) throw new Error("el CRM de live no tiene despliegue que redesplegar");
      await api("mutation($id:String!){ deploymentRedeploy(id:$id, usePreviousImageTag:true){ id } }", { id: before.id });
      const d = await waitFor(crmId, sc.environmentId, before.id);
      console.log(`crm: redesplegado con su misma imagen → ${d.status}`);
      if (d.status !== "SUCCESS") process.exit(1);
    }
    return;
  }
  if (cmd === "backup-check") {
    // Verificación INDEPENDIENTE de las copias (solo lectura): con las credenciales de restore-drill, qué objetos hay en el
    // bucket de copias de las últimas 24 h, por carpeta (empresa o base de plataforma). Nunca imprime una clave.
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    const v = (await api<{ variables: Record<string, string> }>("query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s, unrendered:false) }", { p: t.projectToken.projectId, e: sc.environmentId, s: await serviceId("restore-drill") })).variables;
    for (const k of ["BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET_KEY"]) if (!v[k]) throw new Error(`restore-drill no tiene ${k}`);
    const client = new S3Client({ region: v.BACKUP_S3_REGION || "auto", endpoint: v.BACKUP_S3_ENDPOINT || undefined, forcePathStyle: v.BACKUP_S3_FORCE_PATH_STYLE === "1", credentials: { accessKeyId: v.BACKUP_S3_ACCESS_KEY, secretAccessKey: v.BACKUP_S3_SECRET_KEY } });
    const prefix = (v.BACKUP_S3_PREFIX ?? "").replace(/^\/+/, "");
    const since = Date.now() - 24 * 3600_000;
    const recent: Array<{ key: string; bytes: number; at: number }> = [];
    let total = 0;
    let token: string | undefined;
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket: v.BACKUP_S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) {
        total++;
        const at = o.LastModified ? o.LastModified.getTime() : 0;
        if (at >= since && o.Key) recent.push({ key: o.Key.slice(prefix.length), bytes: Number(o.Size ?? 0), at });
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    const byFolder = new Map<string, { n: number; bytes: number; last: number }>();
    for (const o of recent) {
      const folder = o.key.split("/").slice(0, 2).join("/");
      const cur = byFolder.get(folder) ?? { n: 0, bytes: 0, last: 0 };
      byFolder.set(folder, { n: cur.n + 1, bytes: cur.bytes + o.bytes, last: Math.max(cur.last, o.at) });
    }
    console.log(`Bucket de copias: ${total} objetos en total; ${recent.length} de las últimas 24 h`);
    for (const [folder, x] of Array.from(byFolder.entries()).sort()) console.log(`  ${folder.padEnd(48)} ${String(x.n).padStart(4)} objetos · ${(x.bytes / 1024 / 1024).toFixed(2)} MB · último ${new Date(x.last).toISOString()}`);
    if (!recent.length) {
      console.error("No hay ninguna copia de las últimas 24 h: no se puede continuar con las migraciones.");
      process.exit(1);
    }
    return;
  }
  if (cmd === "status") {
    // Punto de vuelta atrás: despliegue activo y mensaje (repo y commit) de cada servicio, antes de tocar nada
    for (const name of Object.keys(cfg.services).filter((n) => sc.services.includes(n))) {
      const sid = await serviceId(name);
      const d = await api<{ deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string; meta: Record<string, unknown> | null } }> } }>(
        "query($s:String!,$e:String!){ deployments(first:5, input:{serviceId:$s, environmentId:$e}){ edges { node { id status createdAt meta } } } }",
        { s: sid, e: sc.environmentId },
      );
      const active = d.deployments.edges.map((x) => x.node).find((x) => x.status === "SUCCESS");
      console.log(`${name.padEnd(14)} ${active ? `${active.id} ${active.createdAt} «${String(active.meta?.commitMessage ?? active.meta?.reason ?? "").slice(0, 80)}»${active.meta?.commitHash ? ` commit ${String(active.meta.commitHash).slice(0, 12)}` : ""}` : "sin despliegue activo"}`);
    }
    // Imagen base REAL de cada despliegue activo (registro de construcción): versión de Node.js y huella de la imagen
    console.log(`\nImagen base de cada servicio activo («${env}»):`);
    for (const name of sc.services) {
      const sid = await serviceId(name).catch(() => null);
      if (!sid) continue;
      const cur = (await deployments(sid, sc.environmentId).catch(() => [])).find((x) => x.status === "SUCCESS");
      if (!cur) continue;
      const b = await api<{ buildLogs: Array<{ message: string }> }>("query($id:String!,$n:Int){ buildLogs(deploymentId:$id, limit:$n){ message } }", { id: cur.id, n: 3000 }).catch(() => null);
      const lines = (b?.buildLogs ?? []).map((l) => l.message);
      const from = [...new Set(lines.filter((l) => /\b(FROM|resolve|load metadata for)\b.*(node|caddy)[:@]/i.test(l)).map((l) => scrub(l).trim().slice(0, 180)))].slice(0, 4);
      const nodeV = lines.map((l) => /\bv?(2[0-9]\.\d+\.\d+)\b.*node|node[^\n]{0,20}\bv?(2[0-9]\.\d+\.\d+)\b/i.exec(l)).find(Boolean);
      console.log(`  ${name.padEnd(14)} ${cur.createdAt}${nodeV ? ` · node ${nodeV[1] ?? nodeV[2]}` : ""}${from.length ? "" : " · sin registro de la imagen base"}`);
      for (const l of from) console.log(`      ${l}`);
    }
    // Indicios relacionados con el aviso de Node.js de 21/10/2026 (Brotli/zlib, memoria, TLS/DNS) y caídas: historial de
    // despliegues (fallidos o caídos) y registro de ejecución del despliegue activo. Solo lectura; registro saneado.
    const SIGNS = /brotli|Z_DATA_ERROR|Z_BUF_ERROR|zlib|ERR_ZLIB|SIGSEGV|SIGABRT|segmentation fault|out of memory|heap out of memory|core dumped|ERR_TLS_CERT_ALTNAME|ERR_INVALID_IP|ENOTFOUND .*\\0|uncaughtException|unhandledRejection/i;
    const since = Date.parse("2026-10-14T00:00:00Z");
    console.log(`\nIndicios en los registros («${env}», desde el 14/10):`);
    for (const name of sc.services) {
      const sid = await serviceId(name).catch(() => null);
      if (!sid) continue;
      const list = await deployments(sid, sc.environmentId, 50).catch(() => []);
      const recent = list.filter((x) => Date.parse(x.createdAt) >= since);
      const bad = recent.filter((x) => x.status === "CRASHED" || x.status === "FAILED");
      const cur = list.find((x) => x.status === "SUCCESS");
      const run = cur ? await api<{ deploymentLogs: Array<{ message: string }> }>("query($id:String!,$n:Int){ deploymentLogs(deploymentId:$id, limit:$n){ message } }", { id: cur.id, n: 5000 }).catch(() => null) : null;
      const hits = (run?.deploymentLogs ?? []).map((l) => l.message).filter((m) => SIGNS.test(m));
      console.log(`  ${name.padEnd(14)} despliegues ${recent.length} · fallidos/caídos ${bad.length}${bad.length ? ` (${bad.map((x) => `${x.status} ${x.createdAt.slice(0, 16)}`).slice(0, 4).join(", ")})` : ""} · líneas con indicios ${hits.length}`);
      for (const h of hits.slice(0, 5)) console.log(`      ${scrub(h).slice(0, 200)}`);
    }
    // Qué dominios sirve ESTE entorno (todos los servicios del proyecto): fija cuál es el de ensayo y cuál el comercial
    const t = await api<{ projectToken: { projectId: string } }>("query { projectToken { projectId } }");
    console.log(`\nDominios del entorno «${env}»:`);
    for (const name of sc.services) {
      const dm = await api<{ domains: { customDomains: Array<{ domain: string }>; serviceDomains: Array<{ domain: string }> } }>(
        "query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ customDomains { domain } serviceDomains { domain } } }",
        { p: t.projectToken.projectId, e: sc.environmentId, s: await serviceId(name) },
      ).catch((e: Error) => (console.log(`${name.padEnd(14)} dominios no disponibles: ${scrub(e.message).slice(0, 120)}`), null));
      if (!dm) continue;
      const custom = dm.domains.customDomains.map((x) => x.domain);
      const generated = dm.domains.serviceDomains.map((x) => x.domain);
      if (custom.length || generated.length) console.log(`${name.padEnd(14)} propios: ${custom.join(", ") || "—"} · generados: ${generated.join(", ") || "—"}`);
    }
    return;
  }
  if (cmd === "active-sha") {
    // Commit de referencia de los servicios ordinarios: el común o, si difieren, su antepasado común (el diff desde
    // ahí cubre lo de todos). Vacío si alguno no se sabe o no está en la historia (se tratará como protegido)
    const shas: Array<string | null> = [];
    for (const name of ORDINARY_SERVICES) {
      const sha = (await active(await serviceId(name), sc.environmentId))?.sha ?? null;
      console.error(`${name}: ${sha ?? "desconocido"}`);
      shas.push(sha);
    }
    const known = shas.filter((x): x is string => !!x);
    let base = "";
    if (known.length === shas.length) {
      if (new Set(known).size === 1) base = known[0];
      else {
        const r = spawnSync("git", ["merge-base", "--octopus", ...new Set(known)], { encoding: "utf8" });
        base = r.status === 0 && /^[0-9a-f]{40}$/.test((r.stdout ?? "").trim()) ? r.stdout.trim() : "";
        console.error(`servicios en commits distintos; referencia: ${base || "ninguna (se trata como protegido)"}`);
      }
    }
    console.log(base);
    return;
  }
  if (cmd === "publish") {
    // Despliegue ORDINARIO: solo sube el código de los servicios ordinarios (sin variables, migraciones ni
    // infraestructura). Si un servicio no queda bien o fallan las comprobaciones funcionales, todos los publicados en
    // esta ejecución vuelven a su despliegue anterior.
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("commit no válido");
    for (const f of EXCLUDED_FROM_EXPORT) if (fs.existsSync(path.join(dir, f))) throw new Error(`el export contiene ${f}: no se despliega`);
    const done: Array<{ name: string; sid: string; prev: string | null }> = [];
    const rollbackAll = async () => {
      for (const d of done.reverse()) {
        if (!d.prev) {
          console.error(`${d.name}: sin despliegue anterior al que volver`);
          continue;
        }
        console.error(`${d.name}: vuelta atrás a ${d.prev} → ${await rollback(d.sid, sc.environmentId, d.prev)}`);
      }
    };
    for (const name of ORDINARY_SERVICES) {
      if (!sc.services.includes(name)) throw new Error(`el servicio ${name} no existe en el entorno`);
      const sid = await serviceId(name);
      const cur = await active(sid, sc.environmentId);
      if (cur?.sha === sha) {
        console.log(`${name}: ya sirve ${sha.slice(0, 12)}`);
        continue;
      }
      const before = (await latest(sid, sc.environmentId))?.id ?? null;
      done.push({ name, sid, prev: cur?.id ?? null });
      const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", name, "-e", env, "--detach", "-m", `${REPOSITORIES.core} ${sha}`], { encoding: "utf8", env: process.env });
      const d = r.status === 0 ? await waitOrCancel(sid, sc.environmentId, before) : null;
      console.log(`${name}: ${d ? `despliegue ${d.id} → ${d.status}` : `railway up falló: ${scrub(r.stderr || r.stdout || "").slice(0, 300)}`}`);
      if (d?.status !== "SUCCESS") {
        if (d && d.status !== "TIMEOUT") console.log((await logs(d.id, 120)).split("\n").slice(-40).join("\n"));
        await rollbackAll();
        process.exit(1);
      }
    }
    if (!(await functional(env))) {
      await rollbackAll();
      process.exit(1);
    }
    console.log(`Publicado ${sha.slice(0, 12)} en ${env}`);
    return;
  }
  if (cmd === "active-crm") {
    // Commit activo de un servicio de otro repositorio (--service crm, por defecto, o web)
    const ext = externalOf(arg("service", false) || "crm");
    const sid = await serviceId(ext.service);
    const cur = (await deployments(sid, sc.environmentId)).find((x) => x.status === "SUCCESS");
    const extSha = cur ? shaFromDeployMeta(cur.meta, ext.repo) : null;
    console.error(`${ext.service}: ${extSha ?? "desconocido"}`);
    console.log(extSha ?? "");
    return;
  }
  if (cmd === "publish-crm") {
    // CRM ORDINARIO: solo sube su código (sin variables ni infraestructura); si no queda bien o fallan sus
    // comprobaciones, vuelve a su despliegue anterior
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("commit no válido");
    const ext = externalOf(arg("service", false) || "crm");
    if (!sc.services.includes(ext.service)) throw new Error(`el servicio ${ext.service} no existe en el entorno`);
    const sid = await serviceId(ext.service);
    const curNode = (await deployments(sid, sc.environmentId)).find((x) => x.status === "SUCCESS");
    if (curNode && shaFromDeployMeta(curNode.meta, ext.repo) === sha) {
      console.log(`${ext.service}: ya sirve ${sha.slice(0, 12)}`);
      return;
    }
    const before = (await latest(sid, sc.environmentId))?.id ?? null;
    const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", ext.service, "-e", env, "--detach", "-m", `${ext.repo} ${sha}`], { encoding: "utf8", env: process.env });
    const d = r.status === 0 ? await waitOrCancel(sid, sc.environmentId, before) : null;
    console.log(`${ext.service}: ${d ? `despliegue ${d.id} → ${d.status}` : `railway up falló: ${scrub(r.stderr || r.stdout || "").slice(0, 300)}`}`);
    const ok = d?.status === "SUCCESS" && (await functional(env, ext.checks));
    if (!ok) {
      if (d && d.status !== "SUCCESS" && d.status !== "TIMEOUT") console.log((await logs(d.id, 120)).split("\n").slice(-40).join("\n"));
      if (curNode) console.error(`${ext.service}: vuelta atrás a ${curNode.id} → ${await rollback(sid, sc.environmentId, curNode.id)}`);
      process.exit(1);
    }
    console.log(`${ext.label} publicado ${sha.slice(0, 12)} en ${env}`);
    return;
  }
  if (cmd === "revert") {
    // Vuelta atrás rápida: el despliegue anterior del servicio (ya construido), sin compilar de nuevo
    const sid = await serviceId(service!);
    const list = await deployments(sid, sc.environmentId, 20);
    const i = list.findIndex((x) => x.status === "SUCCESS");
    const repo = service === "crm" ? REPOSITORIES.crm : service === "web" ? REPOSITORIES.web : REPOSITORIES.core;
    const prev = i >= 0 ? list.slice(i + 1).find((x) => x.status === "REMOVED" && shaFromDeployMeta(x.meta, repo)) : undefined;
    if (!prev) throw new Error(`${service}: no hay un despliegue anterior al que volver`);
    console.log(`${service}: vuelve a ${prev.id} (commit ${shaFromDeployMeta(prev.meta, repo)?.slice(0, 12)}) → ${await rollback(sid, sc.environmentId, prev.id)}`);
    if (!(await functional(env))) process.exit(1);
    return;
  }
  if (cmd === "deploy") {
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    // El CRM se despliega SOLO desde su repositorio (--repo crm) y ese código solo va al servicio crm
    const repoArg = arg("repo", false);
    const repo = repoArg === "crm" ? REPOSITORIES.crm : repoArg === "web" ? REPOSITORIES.web : REPOSITORIES.core;
    if ((service === "crm") !== (repo === REPOSITORIES.crm)) throw new Error("el servicio crm solo se despliega con --repo crm, y --repo crm solo en el servicio crm");
    if ((service === "web") !== (repo === REPOSITORIES.web)) throw new Error("el servicio web solo se despliega con --repo web, y --repo web solo en el servicio web");
    for (const f of EXCLUDED_FROM_EXPORT) if (fs.existsSync(path.join(dir, f))) throw new Error(`el export contiene ${f}: no se despliega`);
    const sid = await serviceId(service!);
    const before = (await latest(sid, sc.environmentId))?.id ?? null;
    const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", service!, "-e", env, "--detach", "-m", `${repo} ${sha}`], { encoding: "utf8", env: process.env });
    if (r.status !== 0) throw new Error(`railway up falló: ${scrub(r.stderr || r.stdout || "").slice(0, 400)}`);
    const d = await waitFor(sid, sc.environmentId, before);
    console.log(`${service}: despliegue ${d.id} → ${d.status}`);
    console.log((await logs(d.id, 120)).split("\n").slice(-60).join("\n"));
    if (d.status !== "SUCCESS") process.exit(1);
    return;
  }
  if (cmd === "drill") {
    const command = arg("command");
    if (!isAllowedDrill(command)) throw new Error(`orden no permitida: ${command}`);
    const sid = await serviceId("restore-drill");
    // Las migraciones van DENTRO de la imagen de restore-drill: con una imagen anterior «aplicaría» 0 migraciones y diría
    // que todo está al día. --expect-sha exige que la última imagen subida (los redespliegues de drill la reutilizan) sea
    // la de ese commit; si no, se detiene sin ejecutar nada.
    const expectSha = arg("expect-sha", false);
    if (expectSha) {
      const img = (await deployments(sid, sc.environmentId, 30)).map((x) => shaFromDeployMeta(x.meta, REPOSITORIES.core)).find(Boolean) ?? null;
      if (img !== expectSha) {
        console.error(`restore-drill tiene la imagen de ${img ? img.slice(0, 12) : "un commit desconocido"}, no la de ${expectSha.slice(0, 12)}: despliégalo antes de migrar. No se ejecuta «${command}».`);
        process.exit(1);
      }
    }
    const setAndDeploy = async (start: string) => {
      const before = (await latest(sid, sc.environmentId))?.id ?? null;
      await api("mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }", { s: sid, e: sc.environmentId, i: { startCommand: start } });
      await api("mutation($s:String!,$e:String!){ serviceInstanceDeployV2(serviceId:$s, environmentId:$e) }", { s: sid, e: sc.environmentId });
      return waitFor(sid, sc.environmentId, before);
    };
    const d = await setAndDeploy(command);
    // El registro tarda en estar completo tras terminar la orden: se espera un poco antes de leerlo
    await new Promise((r) => setTimeout(r, 20_000));
    console.log(`restore-drill «${command}» → ${d.status}\n${await logs(d.id)}`);
    await setAndDeploy(DRILL_IDLE);
    console.log(`restore-drill devuelto a «${DRILL_IDLE}»`);
    // Una orden que no termina bien (p. ej. una copia que no se sube) es un FALLO del paso, nunca un éxito
    if (d.status !== "SUCCESS") {
      console.error(`La orden «${command}» terminó en ${d.status}: el paso falla.`);
      process.exit(1);
    }
    return;
  }
  throw new Error(`orden desconocida: ${cmd}`);
}

main().catch((e) => {
  console.error(scrub(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
