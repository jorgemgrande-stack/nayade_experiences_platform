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
 *   tsx scripts/deploy/esRailway.ts test-gateways --env live --only <a>,<b> --dir <dir> --sha <commit>  (pasarelas de prueba)
 *
 * `drill` ejecuta una orden de operación PERMITIDA (copias, simulación y aplicación de migraciones, verificación)
 * en el servicio restore-drill de la red privada, espera a que termine, muestra su registro (sin DSN ni claves) y
 * devuelve el servicio a `list`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRILL_IDLE, EXCLUDED_FROM_EXPORT, GATEWAY_COPIED_VARS, GATEWAY_TEMPLATE_SERVICE, STORAGE_BUCKETS, STORAGE_VARS, describeStorageVar, guard, isAllowedDrill, scrub, storageReferences, testTenantDomains, type DeployConfig, type TokenScope } from "./esRailwayLib";
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
  return scrub(d.deploymentLogs.map((l) => l.message).join("\n"));
}

// ── Órdenes ─────────────────────────────────────────────────────────────────────

function arg(name: string, required = true): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v && required) throw new Error(`Falta --${name}`);
  return v ?? "";
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
  const service = cmd === "deploy" ? arg("service") : cmd === "drill" ? "restore-drill" : undefined;
  if (!["verify", "status", "deploy", "drill", "storage", "storage-fix", "test-gateways"].includes(cmd)) throw new Error(`orden desconocida: ${cmd}`);
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
    for (const [service, wanted] of Object.entries(storageReferences(env))) {
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
  if (cmd === "deploy") {
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    for (const f of EXCLUDED_FROM_EXPORT) if (fs.existsSync(path.join(dir, f))) throw new Error(`el export contiene ${f}: no se despliega`);
    const sid = await serviceId(service!);
    const before = (await latest(sid, sc.environmentId))?.id ?? null;
    const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", service!, "-e", env, "--detach", "-m", `${REPOSITORIES.core} ${sha}`], { encoding: "utf8", env: process.env });
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
    const setAndDeploy = async (start: string) => {
      const before = (await latest(sid, sc.environmentId))?.id ?? null;
      await api("mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }", { s: sid, e: sc.environmentId, i: { startCommand: start } });
      await api("mutation($s:String!,$e:String!){ serviceInstanceDeployV2(serviceId:$s, environmentId:$e) }", { s: sid, e: sc.environmentId });
      return waitFor(sid, sc.environmentId, before);
    };
    const d = await setAndDeploy(command);
    console.log(`restore-drill «${command}» → ${d.status}\n${await logs(d.id)}`);
    await setAndDeploy(DRILL_IDLE);
    console.log(`restore-drill devuelto a «${DRILL_IDLE}»`);
    return;
  }
  throw new Error(`orden desconocida: ${cmd}`);
}

main().catch((e) => {
  console.error(scrub(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
