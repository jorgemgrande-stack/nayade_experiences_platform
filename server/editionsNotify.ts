/**
 * Aviso por correo a la persona inscrita al confirmar o cancelar su plaza (E-4). OPCIONAL y APAGADO por defecto: la
 * empresa lo activa y edita los textos desde el panel (Convocatorias › Avisos por correo). Es un correo operativo (de
 * servicio sobre una gestión que la propia persona pidió): nunca marketing ni con enlace de baja comercial.
 *
 * Los textos admiten {nombre}, {producto}, {edicion}, {fechas} y {plazas}. Un fallo del correo nunca rompe la
 * confirmación ni la cancelación.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { escapeHtml } from "./_core/tenantSeo";
import { formatEditionDates } from "../shared/editions";
import { cleanText } from "../shared/offerMode";

export const NOTIFY_KEYS = {
  enabled: "edition_notify_enabled",
  confirmSubject: "edition_confirm_subject",
  confirmBody: "edition_confirm_body",
  cancelSubject: "edition_cancel_subject",
  cancelBody: "edition_cancel_body",
} as const;

export interface EditionNotifySettings {
  enabled: boolean;
  confirmSubject: string;
  confirmBody: string;
  cancelSubject: string;
  cancelBody: string;
}

/** Textos de partida (la empresa los cambia a su gusto; no son textos legales). */
export const DEFAULT_NOTIFY_TEXTS = {
  confirmSubject: "Tu plaza en {producto} está confirmada",
  confirmBody: "Hola {nombre},\n\nTe confirmamos {plazas} en «{producto}» · {edicion} ({fechas}).\n\nSi necesitas cambiar algo, responde a este correo.",
  cancelSubject: "Tu inscripción en {producto} se ha cancelado",
  cancelBody: "Hola {nombre},\n\nTe confirmamos que tu inscripción en «{producto}» · {edicion} ({fechas}) ha quedado cancelada.\n\nSi ha sido un error o quieres otra fecha, responde a este correo.",
} as const;

const LIMITS = { subject: 150, body: 2000 } as const;

type Row = Record<string, any>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const [r] = (await db.execute(q)) as unknown as [Row[]];
  return Array.isArray(r) ? r : [];
}

async function readKeys(): Promise<Record<string, string>> {
  const r = await rows(sql`SELECT \`key\` AS k, value AS v FROM system_settings WHERE \`key\` LIKE 'edition\\_%'`);
  return Object.fromEntries(r.map((x) => [String(x.k), String(x.v ?? "")]));
}

export async function getNotifySettings(): Promise<EditionNotifySettings> {
  const m = await readKeys();
  const t = (k: string, d: string) => (m[k] && m[k].trim() ? m[k] : d);
  return {
    enabled: m[NOTIFY_KEYS.enabled] === "1",
    confirmSubject: t(NOTIFY_KEYS.confirmSubject, DEFAULT_NOTIFY_TEXTS.confirmSubject),
    confirmBody: t(NOTIFY_KEYS.confirmBody, DEFAULT_NOTIFY_TEXTS.confirmBody),
    cancelSubject: t(NOTIFY_KEYS.cancelSubject, DEFAULT_NOTIFY_TEXTS.cancelSubject),
    cancelBody: t(NOTIFY_KEYS.cancelBody, DEFAULT_NOTIFY_TEXTS.cancelBody),
  };
}

export async function saveNotifySettings(s: EditionNotifySettings): Promise<EditionNotifySettings> {
  const clean: Record<string, string> = {
    [NOTIFY_KEYS.enabled]: s.enabled ? "1" : "0",
    [NOTIFY_KEYS.confirmSubject]: cleanText(s.confirmSubject, LIMITS.subject) || DEFAULT_NOTIFY_TEXTS.confirmSubject,
    [NOTIFY_KEYS.confirmBody]: cleanText(s.confirmBody, LIMITS.body, true) || DEFAULT_NOTIFY_TEXTS.confirmBody,
    [NOTIFY_KEYS.cancelSubject]: cleanText(s.cancelSubject, LIMITS.subject) || DEFAULT_NOTIFY_TEXTS.cancelSubject,
    [NOTIFY_KEYS.cancelBody]: cleanText(s.cancelBody, LIMITS.body, true) || DEFAULT_NOTIFY_TEXTS.cancelBody,
  };
  for (const [k, v] of Object.entries(clean)) {
    await rows(sql`INSERT INTO system_settings (\`key\`, value, value_type, category, label, is_public, is_sensitive) VALUES (${k}, ${v}, 'string', 'convocatorias', ${`Convocatorias: ${k}`}, 0, 0)
      ON DUPLICATE KEY UPDATE value = ${v}`);
  }
  const { invalidateConfigCache } = await import("./config");
  invalidateConfigCache();
  return getNotifySettings();
}

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(nombre|producto|edicion|fechas|plazas)\}/g, (_, k) => v[k] ?? "");

/** Correo de una inscripción que acaba de confirmarse o cancelarse. Nunca lanza. */
export async function notifyEnrollmentChange(enrollmentId: number, kind: "confirmed" | "cancelled"): Promise<{ sent: boolean; skipped?: string }> {
  try {
    const s = await getNotifySettings();
    if (!s.enabled) return { sent: false, skipped: "apagado" };
    const [r] = await rows(sql`SELECT n.name, n.email, n.seats, n.lead_id, e.id AS edition_id, e.label, e.starts_at, e.ends_at, e.timezone, x.title
      FROM edition_enrollments n JOIN product_editions e ON e.id = n.edition_id JOIN experiences x ON x.id = e.experience_id WHERE n.id = ${enrollmentId}`);
    if (!r || !r.email) return { sent: false, skipped: "sin destinatario" };
    const seats = Number(r.seats) === 1 ? "1 plaza" : `${Number(r.seats)} plazas`;
    const vars = { nombre: String(r.name), producto: String(r.title), edicion: String(r.label), fechas: formatEditionDates(Number(r.starts_at), r.ends_at == null ? null : Number(r.ends_at), String(r.timezone)), plazas: seats };
    const subject = fill(kind === "confirmed" ? s.confirmSubject : s.cancelSubject, vars).replace(/[\r\n]+/g, " ").slice(0, 200);
    const body = fill(kind === "confirmed" ? s.confirmBody : s.cancelBody, vars);
    const html = `<div style="font-family:inherit;line-height:1.5">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`;
    const { sendManagedEmail } = await import("./emailManager");
    // Clave desconocida para el gestor → categoría «operational» (server/mail/types.ts): correo de servicio, nunca marketing
    const res = await sendManagedEmail({
      templateKey: kind === "confirmed" ? "edition_enrollment_confirmed" : "edition_enrollment_cancelled",
      triggerEvent: kind === "confirmed" ? "edition_enrollment_confirmed" : "edition_enrollment_cancelled",
      recipientEmail: String(r.email),
      subject,
      html,
      relatedEntityType: "edition_enrollment",
      relatedEntityId: enrollmentId,
      leadId: r.lead_id ? Number(r.lead_id) : undefined,
      isAutomatic: false,
      forceCustomer: true,
    });
    return { sent: !!res.sent };
  } catch (e) {
    console.warn("[convocatorias] aviso por correo fallido:", (e as Error).message);
    return { sent: false, skipped: "error" };
  }
}
