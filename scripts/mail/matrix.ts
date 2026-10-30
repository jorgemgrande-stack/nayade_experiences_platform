/**
 * Matriz de comunicaciones generada desde el CÓDIGO (catálogo + vistas previas con datos ficticios), para que la
 * documentación no se separe de la realidad:
 *
 *   pnpm exec tsx scripts/mail/matrix.ts > docs/elephant-source/MATRIZ_COMUNICACIONES.md
 */
import { TEMPLATE_CATALOG, type TemplateSpec } from "../../server/notifications/catalog";
import { previewTemplate } from "../../server/notifications/preview";
import { ADMIN_ALERTS } from "../../server/adminAlerts/catalog";

const RECIPIENT: Record<string, string> = {
  billing_contact: "Contacto de facturación",
  trial_requester: "Quien pidió la prueba",
  ticket_requester: "Quien abrió el ticket",
  account_user: "La propia persona",
  consumer: "El particular",
  ops_team: "Equipo (CP_ALERT_EMAIL)",
};
const STATE: Record<TemplateSpec["status"], string> = { active: "✅ Activa (despachador de eventos)", legacy: "✅ Activa (notificador)", contract: "⏸️ Pendiente: sin disparador" };
const priority = (t: TemplateSpec) =>
  t.group === "security" || t.group === "data" || t.id.startsWith("ops.") || /payment|suspended|incident|withdrawal/.test(t.id) ? "Alta" : t.group === "trial" || t.group === "subscription" || t.group === "billing" ? "Media" : "Normal";
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const cta = (html: string) => {
  const m = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(html);
  if (!m) return "—";
  const u = new URL(m[1].replace(/&amp;/g, "&"));
  return `${m[2]} → \`${u.pathname}\` del ${u.hostname.includes("bigelephant") && !u.hostname.startsWith("hotel") ? "sitio web" : "host de la empresa"}`;
};
const RETRY = "Bandeja: hasta 5 intentos (MAIL_MAX_ATTEMPTS) con espera creciente de 1 min a 1 h; los errores definitivos no se reintentan";

const rows = TEMPLATE_CATALOG.map((t) => {
  const p = t.sentBy === "stripe" ? null : previewTemplate(t.id);
  const state = t.sentBy === "stripe" ? "✅ Delegada en Stripe (no se duplica)" : STATE[t.status];
  return [
    `\`${t.id}\``,
    p ? cell(p.subject) : t.sentBy === "stripe" ? "(correo de Stripe)" : "—",
    cell(t.trigger),
    RECIPIENT[t.recipient] ?? t.recipient,
    cell(t.sendWhen),
    cell(t.suppressWhen),
    priority(t),
    t.variables.length ? t.variables.map((v) => `\`${v}\``).join(", ") : "—",
    p ? cta(p.html) : "—",
    t.sentBy === "stripe" ? "Stripe" : t.status === "contract" ? "—" : RETRY,
    `\`${t.idempotency}\``,
    state,
  ];
});

const head = ["Id", "Asunto (vista previa)", "Evento", "Destinatario", "Momento", "Condiciones para no enviar", "Prioridad", "Variables", "CTA y destino", "Reintentos", "Idempotencia", "Estado"];
console.log("# Matriz de comunicaciones de Elephant Source\n");
console.log("**Generada desde el código** (`pnpm exec tsx scripts/mail/matrix.ts`). El contenido HTML y el texto de cada aviso se ven en la vista previa: CRM → Atención al cliente → Comunicaciones, o en la galería (`scripts/mail/preview.ts`).\n");
console.log(`| ${head.join(" | ")} |`);
console.log(`|${head.map(() => "---").join("|")}|`);
for (const r of rows) console.log(`| ${r.join(" | ")} |`);

// ── D. Administración Big Elephant: alertas internas (server/adminAlerts/catalog.ts) ──
const SEV: Record<string, string> = { info: "Informativo", important: "Importante", critical: "Crítico (no desactivable)" };
const adminHead = ["N.º", "Id", "Alerta", "Hecho que la activa", "Fuente", "Prioridad", "Intervención", "Frecuencia por defecto", "Estado"];
console.log("\n## D. Administración Big Elephant (alertas internas)\n");
console.log("Destinatario por defecto: administracion@bigelephant.es, más los configurados en CRM → Comunicaciones → Alertas administrativas y CP_ALERT_EMAIL. Idempotencia: `admin:<alerta>:<hecho>:<destinatario>` y registro único por hecho (`admin_alert_log`, CRM 0030).\n");
console.log(`| ${adminHead.join(" | ")} |`);
console.log(`|${adminHead.map(() => "---").join("|")}|`);
for (const a of ADMIN_ALERTS)
  console.log(`| ${[String(a.n), `\`${a.id}\``, a.name, a.trigger, a.source, SEV[a.severity], a.intervention ? "Sí" : "No", a.frequencyMinutes ? `Agrupar ${a.frequencyMinutes} min` : "Cada hecho", a.state === "conectada" ? "✅ Conectada" : `⏸️ Pendiente: ${a.pending}`].join(" | ")} |`);
