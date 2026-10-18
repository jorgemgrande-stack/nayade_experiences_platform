/**
 * Activación de Stripe en modo live en el controlplane del entorno live de Railway, sin que ninguna clave
 * aparezca en la terminal, en los logs ni en ficheros. Procedimiento: docs/runbooks/ACTIVACION_STRIPE_LIVE.md.
 *
 *   pnpm exec tsx scripts/railway/stripe-live.ts comprobar            variables + lecturas en la cuenta real
 *   pnpm exec tsx scripts/railway/stripe-live.ts activar [--apply]    fija CP_STRIPE_MODE=live (--skip-deploys)
 *   pnpm exec tsx scripts/railway/stripe-live.ts verificar            después del despliegue: webhook montado
 *
 * Garantías:
 *  - Simulación salvo `--apply`. Solo escribe CP_STRIPE_MODE; nunca la clave, el secreto ni la política fiscal.
 *  - `activar` exige antes todas las comprobaciones bloqueantes en verde (las mismas reglas que el servidor).
 *  - Nunca enciende Checkout ni la contratación pública: si alguna está encendida, se niega a activar.
 *  - Lee las variables con la CLI de Railway dentro del proceso; solo imprime nombres, estados y códigos.
 */
import { execFileSync } from "node:child_process";
import { canActivate, checkLiveStripe, checkLiveVariables, type Check } from "../../server/stripe/liveActivation";

const PROJECT = "5f32ccca-3f72-4c48-bc63-57881cb9e166";
const ENVIRONMENT = "live";
const SERVICE = "controlplane";
const CRM_ORIGIN = "https://elephant-source-crm-live.up.railway.app";
const WEBHOOK_URL = `${CRM_ORIGIN}/cp/v1/stripe/webhook`;

const railway = (args: string[], input?: string) =>
  execFileSync(process.env.RAILWAY_BIN || "railway", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });

function readVars(): Record<string, string> {
  try {
    return JSON.parse(railway(["variable", "list", "--service", SERVICE, "--environment", ENVIRONMENT, "--project", PROJECT, "--json"]) || "{}");
  } catch {
    // El error de la CLI puede incluir la salida: no se reenvía
    throw new Error(`No se pudieron leer las variables de ${SERVICE} en ${ENVIRONMENT} (¿sesión de Railway y proyecto enlazado?)`);
  }
}

const print = (checks: Check[]) => {
  for (const c of checks) console.log(`${c.ok ? "OK   " : c.blocking ? "FALLO" : "AVISO"}  ${c.id.padEnd(48)} ${c.detail}`);
};

async function comprobar(): Promise<{ checks: Check[]; ok: boolean }> {
  const vars = readVars();
  const checks = checkLiveVariables(vars);
  const key = vars.CP_STRIPE_API_KEY?.trim();
  if (key) checks.push(...(await checkLiveStripe(key, WEBHOOK_URL, (url, init) => fetch(url, init))));
  else checks.push({ id: "cuenta_real", ok: false, blocking: true, detail: "Sin clave no se puede leer la cuenta real (precios y webhook)" });
  print(checks);
  const ok = canActivate(checks);
  console.log(`\n${ok ? "LISTO para activar" : "NO se puede activar todavía"} (${checks.filter((c) => !c.ok && c.blocking).length} fallo(s) bloqueante(s))`);
  return { checks, ok };
}

async function activar(apply: boolean) {
  const { ok } = await comprobar();
  if (!ok) process.exit(2);
  if ((readVars().CP_STRIPE_MODE ?? "").trim() === "live") return void console.log("CP_STRIPE_MODE ya es «live»: nada que escribir.");
  if (!apply) return void console.log("\nSimulación: se fijaría CP_STRIPE_MODE=live en controlplane (live) con --skip-deploys. Añade --apply para aplicarlo.");
  railway(["variable", "set", "CP_STRIPE_MODE", "--stdin", "--skip-deploys", "--service", SERVICE, "--environment", ENVIRONMENT, "--project", PROJECT], "live");
  if ((readVars().CP_STRIPE_MODE ?? "").trim() !== "live") throw new Error("La relectura no muestra CP_STRIPE_MODE=live");
  console.log("\nCP_STRIPE_MODE=live escrito (sin desplegar). Siguiente paso: `railway up` del export verificado del controlplane de live y después `verificar`.");
}

/** Tras el despliegue: el webhook debe estar montado (firma falsa → 400) y el resto del CRM, protegido. */
async function verificar() {
  const bad = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=00" }, body: "{}" });
  const anon = await fetch(`${CRM_ORIGIN}/cp/v1/orders`);
  const checks: Check[] = [
    { id: "webhook_montado", ok: bad.status === 400, blocking: true, detail: `POST con firma falsa → ${bad.status} (esperado 400: ruta montada y firma rechazada)` },
    { id: "crm_protegido", ok: anon.status === 401, blocking: true, detail: `GET anónimo de /cp/v1/orders → ${anon.status} (esperado 401)` },
  ];
  print(checks);
  if (!canActivate(checks)) process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
const run = cmd === "comprobar" ? () => comprobar().then(({ ok }) => (ok ? undefined : process.exit(2))) : cmd === "activar" ? () => activar(rest.includes("--apply")) : cmd === "verificar" ? verificar : null;
if (!run) {
  console.error("Uso: tsx scripts/railway/stripe-live.ts comprobar | activar [--apply] | verificar");
  process.exit(1);
}
run().catch((e) => {
  console.error(e instanceof Error ? e.message : "error");
  process.exit(1);
});
