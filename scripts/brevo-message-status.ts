// Consulta el estado real de entrega de un mensaje enviado vía Brevo HTTP API.
//
// Brevo devuelve "OK" + messageId en cuanto acepta el POST, pero la entrega
// real al inbox del destinatario depende de pasos posteriores (relay SMTP,
// SPF/DKIM, filtros del receptor, listas de bloqueo...). Este script
// consulta /v3/smtp/statistics/events para ver el evento final del mensaje:
//
//   delivered    → entregado al MTA del destinatario (no garantiza inbox vs spam)
//   soft_bounce  → rechazo temporal (cuota llena, servidor down...)
//   hard_bounce  → rechazo permanente (dirección inexistente)
//   spam         → marcado como spam por el destinatario
//   blocked      → Brevo bloqueó el envío (sender no verificado, lista negra...)
//   invalid_email/unsubscribed → otros estados
//
// Uso:
//   $env:BREVO_API_KEY = "xkeysib-..."
//   npx tsx scripts/brevo-message-status.ts <messageId-o-email>
//
// Ejemplos:
//   npx tsx scripts/brevo-message-status.ts "<202605251439.15606745043@smtp-relay.mailin.fr>"
//   npx tsx scripts/brevo-message-status.ts jorgemgrande@gmail.com

import "dotenv/config";

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Uso: npx tsx scripts/brevo-message-status.ts <messageId-o-email>");
    process.exit(1);
  }
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("ABORTADO: falta BREVO_API_KEY en el entorno.");
    process.exit(1);
  }

  const params = new URLSearchParams();
  params.set("limit", "50");
  // Heurística mejorada: si parece un messageId de Brevo (contiene ".mailin.fr" o
  // empieza por "<" o por dígitos largos), va como messageId. Si no, va como email.
  const cleaned = query.replace(/^<|>$/g, "");
  const looksLikeMessageId =
    query.startsWith("<") ||
    cleaned.includes(".mailin.fr") ||
    /^\d{12,}/.test(cleaned);
  if (looksLikeMessageId) {
    params.set("messageId", cleaned);
  } else if (cleaned.includes("@")) {
    params.set("email", cleaned);
  } else {
    params.set("messageId", cleaned);
  }
  // Últimos 7 días por defecto
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  params.set("startDate", weekAgo);
  params.set("endDate", today);

  const url = `https://api.brevo.com/v3/smtp/statistics/events?${params.toString()}`;
  console.log(`GET ${url}\n`);

  const res = await fetch(url, {
    headers: { "accept": "application/json", "api-key": apiKey },
  });

  if (!res.ok) {
    const t = await res.text();
    console.error(`✗ HTTP ${res.status}: ${t}`);
    process.exit(1);
  }

  const data = await res.json() as { events?: Array<Record<string, unknown>> };
  const events = data.events ?? [];
  if (!events.length) {
    console.log("Sin eventos. Posibles causas:");
    console.log("  · El mensaje aún no se ha procesado (espera 30-60s y reintenta).");
    console.log("  · El messageId no existe / pertenece a otro proyecto.");
    console.log("  · Filtro fuera de rango (Brevo solo guarda eventos recientes).");
    return;
  }

  console.log(`Encontrados ${events.length} evento(s):\n`);
  for (const e of events) {
    const ts = e.date ?? "?";
    const event = e.event ?? "?";
    const email = e.email ?? "?";
    const subject = e.subject ?? "";
    const reason = e.reason ?? "";
    const ip = e.ip ?? "";
    console.log(`[${ts}] ${event.toString().toUpperCase().padEnd(14)} → ${email}`);
    if (subject) console.log(`   Subject: ${subject}`);
    if (reason) console.log(`   Reason:  ${reason}`);
    if (ip) console.log(`   IP:      ${ip}`);
  }
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
