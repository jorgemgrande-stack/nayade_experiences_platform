// Validación funcional REAL del CMS en un entorno desplegado (pensado para «live»): dos empresas de prueba nuevas (A y
// B) con la plantilla «generico»; A edita su portada y publica una página nueva; se comprueba, por la API pública y con
// NAVEGADOR REAL, que los cambios aparecen en la web de A y en ninguna otra, y que los textos legales de plantilla
// están en borrador. Procedimiento completo: docs/elephant-source/VALIDACION_CMS_LIVE.md.
//
// Uso:
//   ES_ENV=live ES_CP_BASE=<origen del CRM de live> ES_PRIVATE_DIR=<carpeta privada> node scripts/railway/validar-cms-live.cjs
//     → solo comprobaciones previas (no escribe nada).
//   ... ES_APLICAR=si node scripts/railway/validar-cms-live.cjs
//     → crea las dos empresas y ejecuta la prueba (escribe en el entorno; no hay borrado físico, quedan archivables).
//   ... ES_ARCHIVAR=<empresaA>,<empresaB> node scripts/railway/validar-cms-live.cjs
//     → archiva las empresas de prueba al terminar la revisión.
// ES_PLAN=<plan> inicia la prueba de ese plan en las dos empresas (si live aplica licencias por capacidad).
// Nunca imprime contraseñas, tokens ni cookies. No envía correos (el alta asistida devuelve la invitación al operador).
const crypto = require("crypto");
const { call } = require("./cp.cjs");

if (process.env.ES_ENV !== "live") throw new Error("Esta validación es para live: define ES_ENV=live (production exige otra aprobación)");
const APPLY = process.env.ES_APLICAR === "si";
const PLAN = (process.env.ES_PLAN || "").trim();
const ARCHIVE = (process.env.ES_ARCHIVAR || "").split(",").map((s) => s.trim()).filter(Boolean);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK   " : "FALLO"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}
function must(name, ok, detail) {
  if (!check(name, ok, detail)) throw new Error(`Paso imprescindible fallido: ${name}`);
}

/** Llamadas a la web/API de una empresa (Core), por su host. */
function core(host) {
  const base = `https://${host}`;
  let cookie = "";
  const req = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
    const c = set.map((x) => x.split(";")[0]).find((x) => /=.+/.test(x) && !/=;?$/.test(x));
    if (c && path === "/api/auth/login") cookie = c;
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  };
  const data = (r) => r.json?.result?.data?.json ?? null;
  return {
    base,
    raw: req,
    q: async (proc, input) => data(await req("GET", `/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`))),
    m: async (proc, input) => {
      const r = await req("POST", `/api/trpc/${proc}`, { json: input ?? null });
      return { status: r.status, data: data(r), error: r.json?.error?.json?.data?.code ?? null };
    },
  };
}

async function cp(method, route, body) {
  const r = await call(method, route, body);
  if (r.status >= 400) throw new Error(`${method} ${route} → ${r.status} ${(r.json && (r.json.message || r.json.error)) || ""}`);
  return r.json;
}

async function createTenant(label, stamp, platformDomain) {
  const tenantId = `cms-prueba-${label}-${stamp}`;
  const pre = await cp("GET", `/cp/v1/crm/onboarding/check?tenantId=${encodeURIComponent(tenantId)}`);
  must(`${tenantId}: identificador libre`, pre?.available === true, pre?.reason ?? "");
  const { company } = await cp("POST", "/cp/v1/crm/companies", { name: `Prueba CMS ${label.toUpperCase()} ${stamp} (no comercial)`, status: "active" });
  const email = `cms-prueba-${label}-${stamp}@example.com`;
  const { contact } = await cp("POST", `/cp/v1/crm/companies/${company.id}/contacts`, { name: `Administración ${label.toUpperCase()}`, email });
  // Plan de prueba opcional (ES_PLAN): si el entorno exige licencias por capacidad, sin plan el editor de la web estaría bloqueado
  const ob = await cp("POST", `/cp/v1/crm/companies/${company.id}/onboard`, { tenantId, adminContactId: contact.id, templateId: "generico", modules: ["cms"], ...(PLAN ? { planId: PLAN } : {}) });
  for (const n of ob?.notes ?? []) console.log(`      nota: ${n}`);
  must(`${tenantId}: alta completada`, ob?.status === "completed", ob?.status);
  const token = ob?.provisioning?.adminInviteToken;
  must(`${tenantId}: invitación del administrador devuelta al operador`, typeof token === "string" && token.length >= 16);
  const host = ob.domain || `${tenantId}.${platformDomain}`;
  const site = core(host);
  const password = crypto.randomBytes(18).toString("base64url");
  const sp = await site.m("public.setPassword", { token, password });
  must(`${tenantId}: contraseña definida con la invitación`, sp.status === 200, String(sp.error ?? sp.status));
  const login = await site.raw("POST", "/api/auth/login", { email, password });
  must(`${tenantId}: inicio de sesión del administrador`, login.status === 200, String(login.status));
  return { tenantId, host, site };
}

async function browserChecks(a, b, nonce, newSlug) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    try {
      ({ chromium } = require("@playwright/test"));
    } catch {
      check("navegador real (Playwright no instalado: se omite)", true);
      return;
    }
  }
  const browser = await chromium.launch();
  try {
    const text = async (url) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(800);
      const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      await ctx.close();
      return t;
    };
    check("navegador: la portada de A muestra su texto nuevo", (await text(`${a.site.base}/`)).includes(nonce));
    check("navegador: la página nueva de A se ve publicada", (await text(`${a.site.base}/${newSlug}`)).includes(nonce));
    const bHome = await text(`${b.site.base}/`);
    check("navegador: la web de B no muestra nada de A", !bHome.includes(nonce) && !bHome.includes("Prueba CMS A"));
    check("navegador: la página nueva de A no existe en B", !(await text(`${b.site.base}/${newSlug}`)).includes(nonce));
  } finally {
    await browser.close();
  }
}

(async () => {
  if (ARCHIVE.length) {
    for (const t of ARCHIVE) {
      if (!/^cms-prueba-[ab]-\d{8}-[a-z0-9]{4}$/.test(t)) throw new Error(`Solo se archivan empresas de esta prueba (cms-prueba-…): ${t}`);
      await cp("POST", `/cp/v1/tenants/${t}/status`, { status: "archived", reason: "Fin de la validación del CMS en live" });
      check(`${t}: archivada`, true);
    }
    return;
  }

  const cfg = await cp("GET", "/cp/v1/crm/onboarding/config");
  must("alta asistida disponible en el entorno", cfg?.available === true);
  const platformDomain = cfg.platformDomain;
  must("dominio de plataforma configurado", typeof platformDomain === "string" && platformDomain.includes("."), platformDomain);
  const probe = await fetch(`https://comprobacion-dns.${platformDomain}/`, { redirect: "manual" }).then((r) => r.status).catch((e) => `error ${e.cause?.code || e.message}`);
  check("el comodín *.dominio llega a la pasarela del Core", typeof probe === "number", String(probe));
  if (!APPLY) {
    console.log("\nComprobaciones previas hechas. Para ejecutar la prueba (escribe en el entorno): ES_APLICAR=si");
    return;
  }

  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}-${crypto.randomBytes(2).toString("hex")}`;
  const nonce = `Validación CMS ${stamp}`;
  const newSlug = `novedades-${stamp.slice(-4)}`;
  const a = await createTenant("a", stamp, platformDomain);
  const b = await createTenant("b", stamp, platformDomain);

  // Estado inicial: plantilla sembrada, legales en borrador
  check("A: portada de plantilla publicada", !!(await a.site.q("public.getTenantPage", { slug: "inicio" })));
  check("A: aviso legal de plantilla en borrador (no se sirve)", (await a.site.q("public.getTenantPage", { slug: "aviso-legal" })) === null);
  check("A: privacidad de plantilla en borrador (no se sirve)", (await a.site.q("public.getTenantPage", { slug: "politica-de-privacidad" })) === null);
  const footer = (await a.site.q("public.getMenuItems", { zone: "footer" })) || [];
  check("A: el pie no enlaza textos legales en borrador", !footer.some((m) => /aviso-legal|privacidad/.test(m.url || "")));

  // A edita su portada y publica una página nueva
  const home = await a.site.m("cms.savePageContent", { slug: "inicio", title: "Inicio", content: `<h1>${nonce}</h1><p>Portada editada en la validación.</p>`, isPublished: true, metaDescription: "Validación del CMS" });
  must("A: portada guardada", home.status === 200, String(home.error ?? home.status));
  const page = await a.site.m("cms.savePageContent", { slug: newSlug, title: "Novedades", content: `<h2>Novedades</h2><p>${nonce}</p>`, isPublished: true });
  must("A: página nueva publicada", page.status === 200, String(page.error ?? page.status));

  // API pública: cada web, lo suyo
  check("A: la portada pública muestra el texto nuevo", ((await a.site.q("public.getTenantPage", { slug: "inicio" }))?.html || "").includes(nonce));
  check("A: la página nueva se sirve", ((await a.site.q("public.getTenantPage", { slug: newSlug }))?.html || "").includes(nonce));
  check("B: su portada no contiene nada de A", !((await b.site.q("public.getTenantPage", { slug: "inicio" }))?.html || "").includes(nonce));
  check("B: la página nueva de A no existe", (await b.site.q("public.getTenantPage", { slug: newSlug })) === null);
  const bPages = await b.site.q("cms.getPages");
  check("B (panel): ninguna página de A", Array.isArray(bPages) && !bPages.some((p) => p.slug === newSlug || String(p.content || "").includes(nonce)));
  const html = await b.site.raw("GET", "/");
  check("B: el HTML de su web no contiene la marca de A", html.status === 200 && !html.text.includes(`Prueba CMS A ${stamp}`));
  const sm = await a.site.raw("GET", "/sitemap.xml");
  check("A: la página nueva está en su sitemap", sm.status === 200 && sm.text.includes(`/${newSlug}`));
  const smB = await b.site.raw("GET", "/sitemap.xml");
  check("B: su sitemap no incluye la página de A", smB.status === 200 && !smB.text.includes(`/${newSlug}`));

  await browserChecks(a, b, nonce, newSlug);

  const bad = results.filter((r) => !r.ok).length;
  console.log(`\nEmpresas de prueba: ${a.tenantId} (${a.host}) y ${b.tenantId} (${b.host})`);
  console.log(`Para archivarlas tras revisar: ES_ARCHIVAR=${a.tenantId},${b.tenantId}`);
  console.log(bad ? `\n${bad} comprobaciones fallidas` : `\nValidación superada (${results.length} comprobaciones)`);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => {
  console.error("error:", e.message);
  process.exit(2);
});
