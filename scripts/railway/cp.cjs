// Cliente del plano de control del proyecto «Elephant Source» a través de la pasarela del CRM (mismo origen),
// con sesión de operador. Credenciales desde la carpeta privada; nunca se imprimen.
// Uso: node cp.cjs <MÉTODO> <ruta /cp/v1/...> [json_cuerpo]
//
// Entorno: ES_ENV=production (por defecto, el CRM de integración) o ES_ENV=live con ES_CP_BASE=<origen del CRM
// de live>; ES_CP_BASE fija el origen en cualquier entorno.
// Verificación en dos pasos: si el operador la tiene activa, el código TOTP (o de recuperación) se toma de
// ES_TOTP o se pide por la terminal; nunca se guarda ni se imprime.
const fs = require("fs");
const path = require("path");
// Carpeta privada con los secretos del entorno (fuera de cualquier repositorio)
const PRIV = process.env.ES_PRIVATE_DIR;
if (!PRIV) throw new Error("Define ES_PRIVATE_DIR (carpeta privada con secretos.json y operador-*.txt)");
const ENVS = { production: "https://elephant-source-crm.up.railway.app" };
const ENV = process.env.ES_ENV || "production";
const BASE = (process.env.ES_CP_BASE || ENVS[ENV] || "").replace(/\/+$/, "");
if (!BASE) throw new Error(`Sin origen del CRM para ES_ENV=${ENV}: define ES_CP_BASE (p. ej. el dominio del CRM de live)`);
// Credencial de la pasarela: secretos.json (gateway_user/gateway_password) o, en la carpeta de live, pasarela-<usuario>.txt
const SECRETS = path.join(PRIV, "secretos.json");
const s = fs.existsSync(SECRETS) ? JSON.parse(fs.readFileSync(SECRETS, "utf8")) : gatewayFromFile();
function gatewayFromFile() {
  const f = fs.readdirSync(PRIV).find((n) => /^pasarela-[a-z0-9_-]+.txt$/i.test(n));
  if (!f) throw new Error("La carpeta privada no tiene secretos.json ni pasarela-<usuario>.txt");
  return { gateway_user: f.slice("pasarela-".length, -".txt".length), gateway_password: fs.readFileSync(path.join(PRIV, f), "utf8").trim() };
}
const opText = fs.readFileSync(path.join(PRIV, "operador-jorge.txt"), "utf8");
const m = opText.match(/(?:contrase(?:ñ|n)a|password)\s*[:=]\s*(\S+)/i);
const opPassword = m ? m[1] : opText.trim().split(/\s+/).pop();
const basic = "Basic " + Buffer.from(`${s.gateway_user}:${s.gateway_password}`).toString("base64");
// Una sesión por entorno: no se mezclan las de production y live
const SESSION = path.join(PRIV, `.cp-session-${ENV}.json`);

/** Cookie de sesión de la respuesta (`__Host-be_cp_session` en HTTPS; se ignoran las que se borran). */
function sessionCookieOf(r) {
  const all = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  const c = all.map((x) => x.split(";")[0]).find((x) => /^(__Host-)?be_cp_session=.+/.test(x));
  if (!c) throw new Error("el servidor no devolvió la cookie de sesión");
  return c;
}

/** Código del segundo factor: ES_TOTP o pedido por la terminal (sin eco en el historial). */
async function totpCode() {
  if (process.env.ES_TOTP) return process.env.ES_TOTP.trim();
  if (!process.stdin.isTTY) throw new Error("El operador tiene verificación en dos pasos: define ES_TOTP o ejecuta en una terminal");
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise((res) => rl.question("Código de verificación en dos pasos: ", res));
  rl.close();
  return String(code).trim();
}

async function login() {
  const headers = { authorization: basic, origin: BASE, "content-type": "application/json" };
  let r = await fetch(`${BASE}/cp/v1/auth/login`, { method: "POST", headers, body: JSON.stringify({ username: "jorge", password: opPassword }) });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  let body = await r.json();
  if (body.mfaRequired) {
    // Segundo paso: la sesión pendiente va en la cookie; la respuesta trae la sesión definitiva (token nuevo)
    const pending = sessionCookieOf(r);
    r = await fetch(`${BASE}/cp/v1/auth/mfa/verify`, { method: "POST", headers: { ...headers, cookie: pending }, body: JSON.stringify({ code: await totpCode() }) });
    if (r.status !== 200) throw new Error(`verificación en dos pasos ${r.status}`);
    body = await r.json();
  }
  if (body.mfaSetupRequired) throw new Error("Este operador debe dar de alta la verificación en dos pasos en el CRM antes de usar la API");
  const sess = { cookie: sessionCookieOf(r), csrf: body.csrfToken || body.csrf || null };
  fs.writeFileSync(SESSION, JSON.stringify(sess), { mode: 0o600 });
  return sess;
}

async function call(method, route, body, retry = true) {
  let sess = fs.existsSync(SESSION) ? JSON.parse(fs.readFileSync(SESSION, "utf8")) : await login();
  const headers = { authorization: basic, origin: BASE, cookie: sess.cookie, ...(sess.csrf ? { "x-csrf-token": sess.csrf } : {}), ...(body ? { "content-type": "application/json" } : {}) };
  const r = await fetch(`${BASE}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && retry) {
    fs.rmSync(SESSION, { force: true });
    return call(method, route, body, false);
  }
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

if (require.main === module) {
  const [method, route, body] = process.argv.slice(2);
  call(method, route, body ? JSON.parse(body) : undefined).then((r) => {
    const out = JSON.stringify(r.json ?? r.text, (k, v) => (/token|password|secret|dsn/i.test(k) && k !== "accessUrl" ? "[oculto]" : v), 2);
    console.log(r.status, out.length > 6000 ? out.slice(0, 6000) + "…" : out);
  }).catch((e) => {
    console.error("error:", e.message, e.cause && (e.cause.code || e.cause.message), e.cause && e.cause.hostname);
    process.exit(1);
  });
}
/** Credencial de la pasarela (autenticación básica), para llegar a las webs de las empresas de este entorno. */
const gatewayAuth = () => ({ username: s.gateway_user, password: s.gateway_password, header: basic });
module.exports = { call, gatewayAuth };
