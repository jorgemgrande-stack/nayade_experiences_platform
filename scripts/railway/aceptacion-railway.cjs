// Prueba de aceptación multiempresa sobre la infraestructura REAL de Railway (proyecto «Elephant Source»).
// Datos sintéticos (.example). Sin cobros reales (Redsys en modo pruebas con clave ficticia propia; pago de
// contratación con el proveedor «simulated» firmado). Sin correos (el envío está apagado). Falla en cuanto
// un paso esencial falla. Las credenciales salen de la carpeta privada y no se imprimen.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Crea empresas y datos de prueba: solo en live, nunca en production (empresas demo purgadas el 30/10/2026)
if (process.env.ES_ENV !== "live" || !process.env.ES_CP_BASE) throw new Error("La aceptación crea empresas de prueba: solo en live (ES_ENV=live y ES_CP_BASE=<origen del CRM de live>), nunca en production");
const { call: cp } = require("./cp.cjs");

// Carpeta privada con los secretos del entorno (fuera de cualquier repositorio)
const PRIV = process.env.ES_PRIVATE_DIR;
if (!PRIV) throw new Error("Define ES_PRIVATE_DIR (carpeta privada con secretos.json y operador-*.txt)");
const S = JSON.parse(fs.readFileSync(path.join(PRIV, "secretos.json"), "utf8"));
const BASIC = "Basic " + Buffer.from(`${S.gateway_user}:${S.gateway_password}`).toString("base64");
const A = JSON.parse(fs.readFileSync(path.join(PRIV, "alta-A.json"), "utf8").replace(/^[^{]*/, ""));
const B = JSON.parse(fs.readFileSync(path.join(PRIV, "alta-B.json"), "utf8").replace(/^[^{]*/, ""));
const ACCESOS = path.join(PRIV, "demo-accesos.json");
const acc = fs.existsSync(ACCESOS) ? JSON.parse(fs.readFileSync(ACCESOS, "utf8")) : {};
const log = [];
let fallos = 0;

function paso(n, texto, ok, detalle = "") {
  log.push({ n, texto, ok, detalle });
  console.log(`${ok ? "✓" : "✗"} ${n}. ${texto}${detalle ? ` — ${detalle}` : ""}`);
  if (!ok) fallos++;
  return ok;
}
function esencial(n, texto, ok, detalle) {
  if (!paso(n, texto, ok, detalle)) {
    guardar();
    throw new Error(`Paso esencial fallido: ${n}`);
  }
}
function guardar() {
  fs.writeFileSync(path.join(PRIV, "aceptacion-resultado.json"), JSON.stringify({ fecha: new Date().toISOString(), fallos, pasos: log }, null, 2));
  fs.writeFileSync(ACCESOS, JSON.stringify(acc, null, 2), { mode: 0o600 });
}

async function http(host, method, route, { body, raw, cookie, headers = {} } = {}) {
  const base = `https://${host}`;
  const h = { authorization: BASIC, origin: base, ...(cookie ? { cookie } : {}), ...headers };
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const r = await fetch(base + route, { method, headers: h, body: payload, redirect: "manual" });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text, setCookie: r.headers.get("set-cookie") };
}
const trpcM = (host, proc, input, cookie) => http(host, "POST", `/api/trpc/${proc}`, { body: { json: input }, cookie });
const trpcQ = (host, proc, input, cookie) => http(host, "GET", `/api/trpc/${proc}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`, { cookie });
const data = (r) => r.json?.result?.data?.json;
const code = (r) => r.json?.error?.json?.data?.code;

async function login(host, email, password) {
  const r = await http(host, "POST", "/api/auth/login", { body: { email, password } });
  return { status: r.status, cookie: (r.setCookie || "").split(";")[0] };
}
async function definirPassword(host, accessUrl, key) {
  if (acc[key]?.password) return acc[key].password;
  const token = new URL(accessUrl).searchParams.get("token");
  const password = "Demo-" + crypto.randomBytes(12).toString("base64url");
  const r = await trpcM(host, "public.setPassword", { token, password });
  if (r.status !== 200) throw new Error(`setPassword ${r.status} ${r.text.slice(0, 160)}`);
  acc[key] = { ...(acc[key] || {}), password };
  return password;
}
function redsysFirmado(key, d) {
  const params = Buffer.from(JSON.stringify(d)).toString("base64");
  const k = Buffer.from(key, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(d.Ds_Order) / 8) * 8, 0);
  Buffer.from(d.Ds_Order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", k, Buffer.alloc(8, 0));
  c.setAutoPadding(false);
  const derived = Buffer.concat([c.update(padded), c.final()]);
  const sig = crypto.createHmac("sha256", derived).update(params).digest("base64");
  return new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: sig }).toString();
}

const RUN = Date.now().toString(36);
const CACHE_LICENCIAS_MS = 35_000; // el Core guarda las licencias 30 s en caché

async function main() {
  const hA = A.domain;
  const hB = B.domain;
  const ownerA = "propietaria@demo-01.example";
  const ownerB = "propietario@demo-02.example";

  // ── Empresa A ───────────────────────────────────────────────────────────────
  esencial("A1", "Web de la empresa A responde con su host (pasarela + resolución por host)", (await http(hA, "GET", "/")).status === 200, hA);
  esencial("A2", "Sin credenciales de la pasarela no se entra", (await fetch(`https://${hA}/`)).status === 401);
  const pwA = await definirPassword(hA, A.accessUrl ?? acc.A?.accessUrl ?? "https://x/?token=", "A");
  const la = await login(hA, ownerA, pwA);
  esencial("A3", "Propietaria define contraseña con su enlace e inicia sesión en su host", la.status === 200 && !!la.cookie);
  const cA = la.cookie;
  const company = { tradeName: "Empresa Demo Elephant A", legalName: "Empresa Demo Elephant A, S.L.", taxId: "B00000000", address: "Calle Demo 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid" };
  esencial("A4", "Asistente: datos de empresa y actividad", (await trpcM(hA, "setupWizard.saveCompany", company, cA)).status === 200 && (await trpcM(hA, "setupWizard.saveActivity", { activity: "servicios" }, cA)).status === 200);
  const cli = await trpcM(hA, "crm.clients.create", { name: "Cliente Demo A", email: `cliente-${RUN}@demo-a.example` }, cA);
  esencial("A5", "Crear cliente", cli.status === 200, `HTTP ${cli.status}`);
  const cat = data(await trpcM(hA, "products.createCategory", { slug: `servicios-a-${RUN}`, name: `Servicios ${RUN}` }, cA));
  const loc = data(await trpcM(hA, "products.createLocation", { slug: `sede-a-${RUN}`, name: `Sede ${RUN}` }, cA));
  const prod = await trpcM(hA, "products.create", { slug: `servicio-demo-a-${RUN}`, title: `Servicio Demo A ${RUN}`, categoryId: cat?.id, locationId: loc?.id, basePrice: "50.00", taxRate: "21", pricingType: "per_unit" }, cA);
  const productId = Number(data(prod)?.id);
  esencial("A6", "Crear producto", prod.status === 200 && productId > 0, `HTTP ${prod.status}`);
  const q = await trpcM(hA, "crm.quotes.createDirect", { clientName: "Cliente Demo A", clientEmail: "cliente@demo-a.example", title: "Presupuesto Demo A", items: [{ description: "Servicio Demo A", quantity: 2, unitPrice: 50, total: 100, taxRate: 21, productId }], subtotal: 100, taxRate: 21, total: 121, sendNow: false }, cA);
  const quoteId = Number(data(q)?.quoteId ?? data(q)?.id);
  esencial("A7", "Crear presupuesto", q.status === 200 && quoteId > 0, `HTTP ${q.status}`);
  const conv = await trpcM(hA, "crm.quotes.convertToReservation", { quoteId }, cA);
  const reservationId = Number(data(conv)?.reservationId);
  esencial("A8", "Convertir presupuesto en pedido", conv.status === 200 && reservationId > 0, `HTTP ${conv.status}`);
  // Checkout sin dinero real: Redsys en modo PRUEBAS con clave ficticia propia y notificación firmada
  const rkey = acc.A?.redsysKey ?? crypto.randomBytes(24).toString("base64");
  acc.A = { ...(acc.A || {}), redsysKey: rkey };
  const integ = await trpcM(hA, "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: rkey } }, cA);
  const pay = await trpcM(hA, "reservations.createAndPay", { productId, bookingDate: "2030-06-01", people: 1, customerName: "Cliente Demo A", customerEmail: "cliente@demo-a.example", origin: `https://${hA}` });
  const po = data(pay);
  esencial("A9", "Checkout: pasarela en entorno de PRUEBAS e importe calculado por el servidor", integ.status === 200 && pay.status === 200 && /sis-t\.redsys\.es/.test(po?.redsysForm?.url ?? "") && po?.amountCents === 5000, `HTTP ${pay.status}`);
  const falsa = await http(hA, "POST", "/api/redsys/notification", { raw: redsysFirmado(rkey, { Ds_Order: po.merchantOrder, Ds_Response: "0000", Ds_Amount: "5000" }).replace(/Ds_Signature=[^&]+/, "Ds_Signature=AAAA"), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const ipn = await http(hA, "POST", "/api/redsys/notification", { raw: redsysFirmado(rkey, { Ds_Order: po.merchantOrder, Ds_Response: "0000", Ds_Amount: "5000", Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
  esencial("A10", "Notificación de pago firmada aceptada; firma falsa rechazada", ipn.text === "OK" && falsa.text !== "OK", `firmada=${ipn.text.slice(0, 10)} falsa=${falsa.text.slice(0, 20)}`);
  let invoices = null;
  for (let i = 0; i < 20 && !(invoices && invoices.total > 0); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    invoices = data(await trpcQ(hA, "crm.invoices.listAll", {}, cA));
  }
  const inv = invoices?.rows?.[0] ?? invoices?.items?.[0] ?? null;
  esencial("A11", "Factura generada en la empresa sintética", (invoices?.total ?? 0) >= 1, inv ? `${inv.invoiceNumber} · ${inv.total} €` : "");
  // Empleada
  const emp = await trpcM(hA, "admin.createUser", { name: "Empleada Demo A", email: "empleada@demo-a.example", role: "agente" }, cA);
  let cEmp = null;
  if (emp.status === 200) {
    const tok = data(emp)?.token;
    const pwE = "Emp-" + crypto.randomBytes(12).toString("base64url");
    await trpcM(hA, "public.setPassword", { token: tok, password: pwE });
    acc.A.empleada = pwE;
    cEmp = (await login(hA, "empleada@demo-a.example", pwE)).cookie;
  } else if (acc.A?.empleada) cEmp = (await login(hA, "empleada@demo-a.example", acc.A.empleada)).cookie;
  esencial("A12", "Crear empleada (agente) por invitación y acceso propio", !!cEmp);
  esencial("A13", "Empleada opera CRM pero no administra usuarios", (await trpcQ(hA, "crm.clients.list", { limit: 10, offset: 0 }, cEmp)).status === 200 && code(await trpcQ(hA, "admin.getUsers", undefined, cEmp)) === "FORBIDDEN");
  const ov = data(await trpcQ(hA, "subscription.overview", undefined, cA));
  const seats = data(await trpcQ(hA, "setupWizard.seats", undefined, cA));
  paso("A14", "Consultar plan y límites", !!ov && !!seats, `plan=${ov?.plan ?? ov?.planKey ?? "?"} prueba=${ov?.trial?.daysLeft ?? ov?.daysLeft ?? "?"}d usuarios=${seats?.used}/${seats?.limit}`);

  // Vencimiento simulado (operador): licencias en solo lectura
  const caps = (await cp("GET", `/cp/v1/tenants/${A.tenantId}/capabilities`)).json?.capabilities ?? [];
  for (const c of caps) await cp("PUT", `/cp/v1/tenants/${A.tenantId}/capabilities/${c.capabilityId}`, { status: "read_only", reason: "Simulación de vencimiento (prueba de aceptación en Railway)" });
  await new Promise((r) => setTimeout(r, CACHE_LICENCIAS_MS));
  const leer = await trpcQ(hA, "crm.clients.list", { limit: 10, offset: 0 }, cA);
  const escribir = await trpcM(hA, "crm.clients.create", { name: "No debe crearse", email: `no-${RUN}@demo-a.example` }, cA);
  esencial("A15", "Vencimiento: lecturas permitidas, escrituras rechazadas en servidor", leer.status === 200 && escribir.status === 403, `lectura ${leer.status} · escritura ${escribir.status}`);

  // Contratación por el orquestador con pago de PRUEBA firmado
  const o = await cp("POST", "/cp/v1/orders", { idempotencyKey: `railway-conversion-${RUN}`, trialId: A.trial.id, request: { plan: "essential", interval: "month" } });
  const orderId = o.json?.order?.id;
  esencial("A16", "Pedido de contratación cotizado (nada se activa aún)", [200, 201].includes(o.status) && !!orderId, `HTTP ${o.status} ${o.json?.error ?? ""}`);
  const ac = await cp("POST", `/cp/v1/orders/${orderId}/accept`, { signatureRef: "aceptacion-railway-A", approvalReason: "Prueba de aceptación en Railway" });
  const pg = await cp("POST", `/cp/v1/orders/${orderId}/payments`);
  const p = pg.json?.payment;
  esencial("A17", "Aceptación y pago de PRUEBA pendiente (sin cobro)", [200, 202].includes(ac.status) && [200, 201].includes(pg.status) && p?.mode === "test", `accept ${ac.status} · pago ${pg.status}`);
  const ev = JSON.stringify({ id: `evt_railway_${Date.now()}`, type: "payment.succeeded", paymentKey: p.idempotencyKey, providerRef: p.providerRef, amountCents: p.amountCents, currency: p.currency, livemode: false });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac("sha256", S.cp_payments_test_webhook_secret).update(`${t}.${ev}`).digest("hex")}`;
  const crm = new URL(process.env.ES_CP_BASE).host;
  const falsoPago = await http(crm, "POST", "/cp/v1/payments/test/webhook", { raw: ev, headers: { "content-type": "application/json", "x-test-signature": sig.replace(/v1=[0-9a-f]+/, "v1=" + "f".repeat(64)) } });
  const wh = await http(crm, "POST", "/cp/v1/payments/test/webhook", { raw: ev, headers: { "content-type": "application/json", "x-test-signature": sig } });
  esencial("A18", "Evento de pago firmado activa la suscripción; firma falsa rechazada", wh.status === 200 && falsoPago.status === 400, `válido ${wh.status} ${JSON.stringify(wh.json)} · falso ${falsoPago.status}`);
  const det = (await cp("GET", `/cp/v1/orders/${orderId}`)).json;
  await new Promise((r) => setTimeout(r, CACHE_LICENCIAS_MS));
  const escribe2 = await trpcM(hA, "crm.clients.create", { name: "Cliente tras contratar", email: `cliente-dos-${RUN}@demo-a.example` }, cA);
  esencial("A19", "Licencias activas: escritura recuperada", det?.order?.state === "active" && escribe2.status === 200, `pedido ${det?.order?.state} · escritura ${escribe2.status}`);
  const lista = data(await trpcQ(hA, "crm.clients.list", { limit: 50, offset: 0 }, cA));
  const filas = lista?.rows ?? lista?.items ?? lista ?? [];
  const emails = filas.map((c) => c.email);
  esencial("A20", "Datos conservados tras vencimiento y contratación (y nada escrito en solo lectura)", emails.includes(`cliente-${RUN}@demo-a.example`) && emails.includes(`cliente-dos-${RUN}@demo-a.example`) && !emails.includes(`no-${RUN}@demo-a.example`), `${filas.length} clientes`);

  // ── Empresa B y aislamiento ─────────────────────────────────────────────────
  const pwB = await definirPassword(hB, B.accessUrl ?? acc.B?.accessUrl ?? "https://x/?token=", "B");
  const lb = await login(hB, ownerB, pwB);
  esencial("B1", "Propietario de B inicia sesión en su host", lb.status === 200 && !!lb.cookie);
  const cB = lb.cookie;
  esencial("B2", "B crea sus propios datos", (await trpcM(hB, "crm.clients.create", { name: "Cliente Demo B", email: `cliente-${RUN}@demo-b.example` }, cB)).status === 200);
  const listB = data(await trpcQ(hB, "crm.clients.list", { limit: 50, offset: 0 }, cB));
  const nB = (listB?.rows ?? listB?.items ?? listB ?? []).map((c) => c.name);
  paso("I1", "B no ve clientes de A", !nB.some((n) => /Demo A|tras contratar/.test(n)), nB.join(", "));
  const qB = await trpcQ(hB, "crm.quotes.get", { id: quoteId }, cB);
  paso("I2", "B no lee el presupuesto de A por su id (IDOR)", qB.status !== 200 || !JSON.stringify(qB.json).includes("Presupuesto Demo A"), `HTTP ${qB.status}`);
  const invB = data(await trpcQ(hB, "crm.invoices.listAll", {}, cB));
  paso("I3", "B no ve facturas de A", (invB?.total ?? 0) === 0, `facturas de B: ${invB?.total}`);
  if (inv?.invoiceNumber) {
    const pv = await http(hB, "GET", `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`, { cookie: cB });
    paso("I4", "B no descarga la factura de A (REST)", pv.status !== 200 || !pv.text.includes("Demo Elephant A"), `HTTP ${pv.status}`);
  }
  paso("I5", "La cookie de A no vale en el host de B (y al revés)", (await trpcQ(hB, "crm.clients.list", { limit: 1, offset: 0 }, cA)).status === 401 && (await trpcQ(hA, "crm.clients.list", { limit: 1, offset: 0 }, cB)).status === 401);
  paso("I6", "Las credenciales de A no inician sesión en B", (await login(hB, ownerA, pwA)).status !== 200);
  const updB = await trpcM(hB, "crm.clients.update", { id: Number(data(cli)?.id ?? 0), name: "Modificado por B" }, cB);
  const tras = data(await trpcQ(hA, "crm.clients.list", { limit: 50, offset: 0 }, cA));
  paso("I7", "B no modifica clientes de A por id", !(tras?.rows ?? tras?.items ?? tras ?? []).some((c) => c.name === "Modificado por B"), `HTTP ${updB.status}`);
  const capsB = (await cp("GET", `/cp/v1/tenants/${B.tenantId}/capabilities`)).json?.capabilities ?? [];
  paso("I8", "Las licencias de B no cambiaron con el vencimiento ni la contratación de A", capsB.length === 29 && capsB.every((c) => c.status === "active"), `${capsB.length} activas`);

  // ── Concurrencia ────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(trpcQ(hA, "crm.clients.list", { limit: 50, offset: 0 }, cA).then((r) => ({ who: "A", r })));
    jobs.push(trpcQ(hB, "crm.clients.list", { limit: 50, offset: 0 }, cB).then((r) => ({ who: "B", r })));
  }
  const res = await Promise.all(jobs);
  const cruces = res.filter(({ who, r }) => {
    const names = (data(r)?.rows ?? data(r)?.items ?? data(r) ?? []).map((c) => c.name).join("|");
    return who === "A" ? /Demo B/.test(names) : /Demo A|tras contratar/.test(names);
  }).length;
  paso("C1", "40 peticiones simultáneas A/B sin cruces ni errores", res.every(({ r }) => r.status === 200) && cruces === 0, `${Date.now() - t0} ms · errores ${res.filter(({ r }) => r.status !== 200).length} · cruces ${cruces}`);
  const t1 = Date.now();
  const logins = await Promise.all(Array.from({ length: 10 }, (_, i) => login(i % 2 ? hB : hA, i % 2 ? ownerB : ownerA, i % 2 ? pwB : pwA)));
  paso("C2", "10 inicios de sesión simultáneos", logins.every((l) => l.status === 200), `${Date.now() - t1} ms`);
  const t2 = Date.now();
  const quotes = await Promise.all(Array.from({ length: 10 }, (_, i) => trpcM(hA, "crm.quotes.createDirect", { clientName: "Cliente Demo A", clientEmail: "cliente@demo-a.example", title: `Concurrente ${i}`, items: [{ description: "S", quantity: 1, unitPrice: 10, total: 10, taxRate: 21, productId }], subtotal: 10, taxRate: 21, total: 12.1, sendNow: false }, cA)));
  const nums = quotes.map((r) => data(r)?.quoteNumber).filter(Boolean);
  paso("C3", "10 presupuestos simultáneos con números únicos", quotes.every((r) => r.status === 200) && new Set(nums).size === nums.length, `${Date.now() - t2} ms · ${nums.length} números`);

  guardar();
  console.log(`\nResultado: ${log.length - fallos}/${log.length} pasos correctos`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("ABORTADO:", e.message);
  guardar();
  process.exit(1);
});
