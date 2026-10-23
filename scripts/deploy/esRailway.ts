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
import { MAIL_TEST_SERVICES, POSTMARK_WEBHOOK_TRIGGERS, mailSandboxPlan, parseMailAllowlist } from "./esRailwayLib";
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
  if (!["verify", "status", "deploy", "drill", "storage", "storage-fix", "test-gateways", "mail-live", "backup-check"].includes(cmd)) throw new Error(`orden desconocida: ${cmd}`);
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
    if (!token) console.log("Postmark: sin token de servidor en live");
    else {
      const sv = await pm("GET", "/server");
      console.log(`Postmark servidor: HTTP ${sv.status} · ${sv.status === 200 ? `«${sv.j.Name}» · color ${sv.j.Color ?? "—"} · entrada ${sv.j.InboundAddress ? "sí" : "no"}` : String(sv.j.Message ?? "")}`);
      const wh = await pm("GET", "/webhooks?MessageStream=outbound");
      webhooks = ((wh.j.Webhooks as Array<{ ID: number; Url: string }>) ?? []);
      console.log(`Postmark webhooks: ${webhooks.length ? webhooks.map((w) => w.Url).join(", ") : "ninguno"}`);
      const out = await pm("GET", "/messages/outbound?count=10&offset=0");
      console.log(`Postmark envíos registrados: ${out.status === 200 ? out.j.TotalCount : `HTTP ${out.status}`}`);
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
    const r = existing ? await pm("PUT", `/webhooks/${existing.ID}`, hook) : await pm("POST", "/webhooks", hook);
    if (r.status !== 200) throw new Error(`Postmark no aceptó el webhook: HTTP ${r.status} ${String(r.j.Message ?? "")}`);
    console.log(`Postmark webhook ${existing ? "actualizado" : "creado"}: ${url} (entrega, rebote, queja y baja)`);
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
    const prefix = (v.BACKUP_S3_PREFIX ?? "").replace(/^/+/, "");
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
