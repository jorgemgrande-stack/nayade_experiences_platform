/**
 * Elephant Connect · Campaigns — reglas puras (sin BD ni red) del envío de campañas con la cuenta de Brevo de la empresa.
 *
 *  - Audiencia = segmento del CRM (etiquetas) ∩ consentimiento de marketing CONCEDIDO ∩ correo válido. Si un correo
 *    tiene la baja en cualquier ficha (dos clientes con el mismo correo), no recibe la campaña.
 *  - Un segmento mayor que el tope no se envía a medias: se rechaza.
 *  - La importación a Brevo es asíncrona: la campaña solo se envía cuando todos sus procesos han terminado.
 */
import { normalizeEmail } from "../brevoMarketing/plan";
import { MAX_SCHEDULE_AHEAD_MS, MIN_SCHEDULE_LEAD_MS } from "../../shared/connectCampaigns";

export const MAX_RECIPIENTS = 5000;
/** Llamadas a Brevo por operación (preparar: carpeta, atributo, lista e importaciones de 500; leer bajas: páginas de 500). */
export const MAX_CALLS_PER_STEP = 40;
/** Atributo de contacto de Brevo con el enlace de baja propio (firmado) de cada cliente. */
export const UNSUB_ATTRIBUTE = "BAJA_URL";
/** Etiqueta de la plantilla de Brevo que se sustituye por ese atributo al enviar. */
export const UNSUB_TAG = `{{ contact.${UNSUB_ATTRIBUTE} }}`;
export const FOLDER_NAME = "Elephant Campaigns";

export interface AudienceRow {
  clientId: number;
  email: string | null;
  name: string | null;
}
export interface Recipient {
  clientId: number;
  email: string;
  firstName: string | null;
}
export interface Audience {
  recipients: Recipient[];
  /** Sin correo válido o con el correo repetido. */
  skipped: number;
  /** Con consentimiento en esta ficha pero el mismo correo dado de baja en otra. */
  withdrawn: number;
}

const firstName = (name: string | null) => {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n.slice(0, 60) : null;
};

/** `rows` ya viene filtrado por consentimiento concedido y segmento; `withdrawnEmails`, correos con la baja en el CRM. */
export function planAudience(rows: AudienceRow[], withdrawnEmails: Set<string>): Audience {
  const out: Audience = { recipients: [], skipped: 0, withdrawn: 0 };
  const seen = new Set<string>();
  for (const r of [...rows].sort((a, b) => a.clientId - b.clientId)) {
    const email = normalizeEmail(r.email);
    if (!email || seen.has(email)) {
      out.skipped++;
      continue;
    }
    seen.add(email);
    if (withdrawnEmails.has(email)) {
      out.withdrawn++;
      continue;
    }
    out.recipients.push({ clientId: r.clientId, email, firstName: firstName(r.name) });
  }
  return out;
}

/** Estado conjunto de los procesos de importación de Brevo. */
export function importsState(statuses: string[]): "ready" | "wait" | "failed" {
  if (statuses.some((s) => s === "failed" || s === "cancelled")) return "failed";
  return statuses.every((s) => s === "completed") ? "ready" : "wait";
}

/** Fecha de programación válida (como pronto dentro de 15 minutos y como tarde dentro de 180 días). */
export function checkSchedule(at: Date, now: Date): void {
  if (Number.isNaN(at.getTime())) throw new Error("Fecha de envío no válida");
  if (at.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) throw new Error("Programa el envío al menos 15 minutos más tarde");
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) throw new Error("Programa el envío como mucho a 180 días vista");
}

/** Mensaje claro para un envío de prueba que Brevo rechaza (el código lo da el cliente HTTP). */
export function testErrorMessage(code: string | null): string {
  switch (code) {
    case "unexistingEmails":
      return "Ese buzón no es un contacto de tu cuenta de Brevo: añádelo en Brevo (por ejemplo a tu lista de pruebas) y repite la prueba";
    case "blackListedEmails":
      return "Ese buzón está dado de baja en tu cuenta de Brevo";
    case "withoutListEmails":
      return "Ese contacto no está en ninguna lista de tu cuenta de Brevo: añádelo a tu lista de pruebas";
    default:
      return "Brevo no pudo enviar la prueba (revisa el remitente y el contenido)";
  }
}
