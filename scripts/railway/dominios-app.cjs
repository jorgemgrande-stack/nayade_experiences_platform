// Migración ADITIVA de las empresas a <empresa>.app.bigelephant.es (o el dominio de plataforma indicado).
//
// Por defecto SOLO LEE: inventario de tenants y de sus dominios, el dominio nuevo propuesto para cada uno y
// las colisiones (dominio ya registrado por otra empresa, etiqueta reservada, etiqueta no válida o repetida).
// Con --apply registra los que no tienen problema como `platform_subdomain` NO principal: los dominios actuales
// se conservan y siguen funcionando (POST /cp/v1/tenants/:id/domains, auditado como `domain.added`).
//
// Uso (credenciales de operador de la carpeta privada, como cp.cjs; nunca se imprimen):
//   ES_PRIVATE_DIR=<carpeta> node scripts/railway/dominios-app.cjs                 # inventario y plan
//   ES_PRIVATE_DIR=<carpeta> node scripts/railway/dominios-app.cjs --apply         # registra el plan
//   ... --platform app.bigelephant.es --only t3-empresa-demo-elephant-01           # opciones
//
// Requisitos antes de --apply: el comodín *.app.bigelephant.es apuntando a core-gateway (Railway + DNS), para
// que los dominios nuevos respondan. Registrarlos antes no rompe nada: solo no serían accesibles todavía.

/** Etiquetas que nunca pueden ser de una empresa (dominios corporativos de Big Elephant). */
const RESERVED = new Set(["www", "admin", "app", "api", "mail", "crm", "cp", "smtp", "imap", "pop", "ftp", "status", "help", "soporte", "static", "cdn"]);
/** Prefijos de los servicios propios en Railway (p. ej. elephant-source-crm-live). Igual en platformDomains.ts. */
const RESERVED_PREFIXES = ["elephant-source-"];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Estados con acceso o que pueden recuperarlo (TENANT_STATUSES): archivadas y en borrado se omiten. */
const LIVE = new Set(["provisioning", "trial", "active", "grace", "suspended"]);

/**
 * Plan de dominios a partir del inventario (lógica pura, probada sin red).
 * @param {{ id: string, status?: string, domains: { domain: string, kind?: string, status?: string }[] }[]} tenants
 * @param {string} platform p. ej. "app.bigelephant.es"
 */
function plan(tenants, platform) {
  const taken = new Map(); // dominio → tenant que ya lo tiene
  for (const t of tenants) for (const d of t.domains) if (d.status !== "removed") taken.set(d.domain.toLowerCase(), t.id);
  const seen = new Set();
  return tenants.map((t) => {
    const label = String(t.id).toLowerCase();
    const domain = `${label}.${platform}`;
    const base = { tenant: t.id, status: t.status ?? "?", current: t.domains.filter((d) => d.status !== "removed").map((d) => d.domain), domain };
    if (t.status === "deleted") return { ...base, action: "skip", reason: "empresa eliminada" };
    if (t.status && !LIVE.has(t.status)) return { ...base, action: "skip", reason: `estado «${t.status}»` };
    if (!LABEL.test(label)) return { ...base, action: "conflict", reason: "el identificador no es una etiqueta DNS válida (minúsculas, cifras y guiones; máx. 63)" };
    if (RESERVED.has(label) || RESERVED_PREFIXES.some((p) => label.startsWith(p))) return { ...base, action: "conflict", reason: "etiqueta reservada para Big Elephant" };
    if (seen.has(domain)) return { ...base, action: "conflict", reason: "dominio repetido en el plan" };
    seen.add(domain);
    const owner = taken.get(domain);
    if (owner === t.id) return { ...base, action: "skip", reason: "ya registrado" };
    if (owner) return { ...base, action: "conflict", reason: `ya lo tiene la empresa ${owner}` };
    return { ...base, action: "add" };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const apply = args.includes("--apply");
  const platform = opt("--platform", "app.bigelephant.es").toLowerCase();
  const only = opt("--only", null);
  const { call } = require("./cp.cjs");

  const list = await call("GET", "/cp/v1/tenants");
  if (list.status !== 200) throw new Error(`GET /tenants → ${list.status}`);
  const tenants = [];
  for (const t of list.json.tenants) {
    if (only && t.id !== only) continue;
    const r = await call("GET", `/cp/v1/tenants/${encodeURIComponent(t.id)}`);
    if (r.status !== 200) throw new Error(`GET /tenants/${t.id} → ${r.status}`);
    tenants.push({ id: t.id, status: t.status, domains: r.json.domains ?? [] });
  }
  const rows = plan(tenants, platform);
  console.log(`Inventario: ${tenants.length} empresas · dominio de plataforma ${platform}`);
  for (const r of rows) console.log(`${r.action.padEnd(8)} ${r.tenant.padEnd(34)} ${r.domain}${r.reason ? `  (${r.reason})` : ""}\n         actuales: ${r.current.join(", ") || "—"}`);
  const conflicts = rows.filter((r) => r.action === "conflict");
  if (conflicts.length) console.log(`\n${conflicts.length} colisiones: se omiten; resuélvelas antes de registrarlas.`);
  if (!apply) return console.log("\nSolo lectura. Para registrar los marcados «add»: --apply");

  for (const r of rows.filter((x) => x.action === "add")) {
    const res = await call("POST", `/cp/v1/tenants/${encodeURIComponent(r.tenant)}/domains`, { domain: r.domain, kind: "platform_subdomain", primary: false });
    console.log(`${res.status === 200 || res.status === 201 ? "registrado" : `ERROR ${res.status}`}  ${r.domain}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("error:", e.message);
    process.exit(1);
  });
}
module.exports = { plan, RESERVED, RESERVED_PREFIXES };
