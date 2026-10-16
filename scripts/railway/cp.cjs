// Cliente del plano de control del proyecto «Elephant Source» a través de la pasarela del CRM (mismo origen),
// con sesión de operador. Credenciales desde la carpeta privada; nunca se imprimen.
// Uso: node cp.cjs <MÉTODO> <ruta /cp/v1/...> [json_cuerpo]
const fs = require("fs");
const path = require("path");
// Carpeta privada con los secretos del entorno (fuera de cualquier repositorio)
const PRIV = process.env.ES_PRIVATE_DIR;
if (!PRIV) throw new Error("Define ES_PRIVATE_DIR (carpeta privada con secretos.json y operador-*.txt)");
const BASE = "https://elephant-source-crm.up.railway.app";
const s = JSON.parse(fs.readFileSync(path.join(PRIV, "secretos.json"), "utf8"));
const opText = fs.readFileSync(path.join(PRIV, "operador-jorge.txt"), "utf8");
const m = opText.match(/(?:contrase(?:ñ|n)a|password)\s*[:=]\s*(\S+)/i);
const opPassword = m ? m[1] : opText.trim().split(/\s+/).pop();
const basic = "Basic " + Buffer.from(`${s.gateway_user}:${s.gateway_password}`).toString("base64");
const SESSION = path.join(PRIV, ".cp-session.json");

async function login() {
  const r = await fetch(`${BASE}/cp/v1/auth/login`, { method: "POST", headers: { authorization: basic, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ username: "jorge", password: opPassword }) });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const body = await r.json();
  const sess = { cookie, csrf: body.csrfToken || body.csrf || null };
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
module.exports = { call };
