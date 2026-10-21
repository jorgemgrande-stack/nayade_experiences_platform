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
 *
 * `drill` ejecuta una orden de operación PERMITIDA (copias, simulación y aplicación de migraciones, verificación)
 * en el servicio restore-drill de la red privada, espera a que termine, muestra su registro (sin DSN ni claves) y
 * devuelve el servicio a `list`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRILL_IDLE, EXCLUDED_FROM_EXPORT, guard, isAllowedDrill, scrub, type DeployConfig, type TokenScope } from "./esRailwayLib";

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
  if (!["verify", "status", "deploy", "drill"].includes(cmd)) throw new Error(`orden desconocida: ${cmd}`);
  const problems = guard(cfg, sc, { env, service });
  if (problems.length) {
    console.error(`Detenido antes de tocar nada:\n - ${problems.join("\n - ")}`);
    process.exit(2);
  }
  if (cmd === "verify") return void console.log(`Token del proyecto de Elephant Source, entorno «${env}»; servicios: ${sc.services.join(", ")}`);
  if (cmd === "status") {
    // Punto de vuelta atrás: despliegue activo y mensaje (repo y commit) de cada servicio, antes de tocar nada
    for (const name of Object.keys(cfg.services).filter((n) => sc.services.includes(n))) {
      const sid = await serviceId(name);
      const d = await api<{ deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string; meta: Record<string, unknown> | null } }> } }>(
        "query($s:String!,$e:String!){ deployments(first:5, input:{serviceId:$s, environmentId:$e}){ edges { node { id status createdAt meta } } } }",
        { s: sid, e: sc.environmentId },
      );
      const active = d.deployments.edges.map((x) => x.node).find((x) => x.status === "SUCCESS");
      console.log(`${name.padEnd(14)} ${active ? `${active.id} ${active.createdAt} «${String(active.meta?.commitMessage ?? active.meta?.reason ?? "").slice(0, 80)}»` : "sin despliegue activo"}`);
    }
    return;
  }
  if (cmd === "deploy") {
    const dir = path.resolve(arg("dir"));
    const sha = arg("sha");
    for (const f of EXCLUDED_FROM_EXPORT) if (fs.existsSync(path.join(dir, f))) throw new Error(`el export contiene ${f}: no se despliega`);
    const sid = await serviceId(service!);
    const before = (await latest(sid, sc.environmentId))?.id ?? null;
    const r = spawnSync("railway", ["up", dir, "--path-as-root", "-s", service!, "-e", env, "--detach", "-m", `nayade_experiences_platform ${sha}`], { encoding: "utf8", env: process.env });
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
