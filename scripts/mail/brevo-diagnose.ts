/**
 * Diagnóstico de la cuenta de Brevo SIN ENVIAR NADA (solo lecturas de la API oficial):
 * cuenta y envío transaccional, remitentes, dominios y estado del dominio de envío.
 *
 *   BREVO_API_KEY=… MAIL_SENDING_DOMAIN=bigelephant.es pnpm exec tsx scripts/mail/brevo-diagnose.ts
 *
 * Endpoints usados (ver server/mail/providers.ts → brevoDiagnostics): GET /v3/account, GET /v3/senders,
 * GET /v3/senders/domains y GET /v3/senders/domains/{dominio}. La clave nunca se imprime.
 * Código de salida: 0 si el dominio está autenticado y el envío transaccional activo; 1 si no; 2 sin clave.
 * También disponible en el plano de control: GET /cp/v1/mail/diagnostics (alcance ops:read).
 */
import { brevoDiagnostics } from "../../server/mail/providers";

async function main() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("Falta BREVO_API_KEY: no hay nada que diagnosticar.");
    process.exit(2);
  }
  const r = await brevoDiagnostics({ apiKey, sendingDomain: (process.env.MAIL_SENDING_DOMAIN ?? "").trim().toLowerCase() || null, baseUrl: process.env.BREVO_API_BASE_URL });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("Error en el diagnóstico:", e instanceof Error ? e.name : "error");
  process.exit(1);
});
