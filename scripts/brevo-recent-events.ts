// Lista eventos recientes de Brevo (últimas 24h por defecto) — útil para
// confirmar que un envío concreto ha pasado realmente por el relay y conocer
// su estado final (delivered/blocked/bounced).
//
// Uso:
//   railway run npx tsx scripts/brevo-recent-events.ts
//   railway run npx tsx scripts/brevo-recent-events.ts --email jorgemgrande@gmail.com
//   railway run npx tsx scripts/brevo-recent-events.ts --hours 48

import "dotenv/config";

function parseArgs(argv: string[]): { email?: string; hours?: number } {
  const out: { email?: string; hours?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i];
    else if (argv[i] === "--hours") out.hours = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("ABORTADO: falta BREVO_API_KEY.");
    process.exit(1);
  }
  const hours = args.hours ?? 24;
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0, 10);

  const params = new URLSearchParams({ limit: "100", startDate: start, endDate: end });
  if (args.email) params.set("email", args.email);

  const url = `https://api.brevo.com/v3/smtp/statistics/events?${params.toString()}`;
  console.log("GET", url);

  const res = await fetch(url, {
    headers: { accept: "application/json", "api-key": apiKey },
  });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as { events?: Array<Record<string, any>> };
  const events = data.events ?? [];
  console.log(`\nTotal eventos (${start} → ${end}): ${events.length}\n`);

  if (events.length === 0) {
    console.log("Sin eventos en el rango. Si esperabas envíos recientes, comprueba:");
    console.log("  · Que el sender está verificado en Brevo (dashboard → Senders & IP).");
    console.log("  · Que la API key pertenece a esta cuenta.");
    console.log("  · Que no se ha alcanzado el límite del plan (Free: 300 emails/día).");
    return;
  }

  const byEvent: Record<string, number> = {};
  for (const e of events) {
    const ev = String(e.event ?? "?");
    byEvent[ev] = (byEvent[ev] ?? 0) + 1;
  }
  console.log("Por tipo:");
  for (const [ev, n] of Object.entries(byEvent).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ev.padEnd(16)} ${n}`);
  }
  console.log("\nÚltimos 20:");
  for (const e of events.slice(0, 20)) {
    const ts = String(e.date ?? "");
    const event = String(e.event ?? "?").padEnd(14);
    const email = String(e.email ?? "");
    const subject = String(e.subject ?? "").slice(0, 55);
    const reason = e.reason ? ` REASON=${e.reason}` : "";
    console.log(`[${ts}] ${event} → ${email}  |  ${subject}${reason}`);
  }
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
