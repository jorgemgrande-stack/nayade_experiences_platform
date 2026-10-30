/**
 * Plantillas de la familia D · Administración Big Elephant: avisos INTERNOS al equipo. Información operativa primero
 * (qué ha pasado, empresa, fecha y hora, estado real, importe, prioridad, si requiere intervención y enlace directo
 * al expediente del CRM), con el diseño corporativo aprobado y su versión de texto. Puras: no envían nada.
 *
 * Sin datos sensibles: nunca tarjetas, tokens, enlaces de un solo uso, contraseñas ni el texto libre de un cliente.
 */
import { fmt, renderEmail, type Block, type Hero, type Tone } from "../mail/design";
import { platformBrand } from "../mail/templates";
import type { MailContent } from "../mail/types";

export type AlertSeverity = "info" | "important" | "critical";
export type AlertSection = "contratacion" | "facturacion" | "soporte" | "operaciones";

export const SEVERITY_LABEL: Record<AlertSeverity, string> = { info: "Informativo", important: "Importante", critical: "Crítico" };
export const SECTION_LABEL: Record<AlertSection, string> = { contratacion: "Contrataciones y clientes", facturacion: "Facturación y cobros", soporte: "Soporte y atención al cliente", operaciones: "Operaciones e infraestructura" };
const SUBJECT_TAG: Record<AlertSeverity, string> = { info: "Info", important: "Importante", critical: "CRÍTICO" };
const SEVERITY_TONE: Record<AlertSeverity, Tone> = { info: "info", important: "warning", critical: "error" };
const HERO: Record<AlertSection, Hero> = { contratacion: "contrato", facturacion: "pago", soporte: "soporte", operaciones: "aviso" };

/** Fecha y hora completas en Madrid (el equipo trabaja en esa zona). */
export const dateTime = (ms: number) => new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export interface AdminAlertView {
  alert: { n: number; name: string; section: AlertSection };
  severity: AlertSeverity;
  intervention: boolean;
  /** Qué ha sucedido (una frase, sin datos sensibles). */
  summary: string;
  company: string | null;
  tenantId: string | null;
  occurredAt: number;
  /** Estado REAL de la operación (p. ej. «Suscripción programada en Stripe»). */
  status: { label: string; tone: Tone };
  amount: { cents: number; currency: string } | null;
  reference: string | null;
  details: Array<{ label: string; value: string }>;
  /** Enlace directo al expediente (https del CRM), o null si el entorno no tiene el CRM configurado. */
  crmUrl: string | null;
  /** Entorno que lo registró (production, live…). */
  environment: string | null;
  /** Prioridad subida por repetición: motivo. */
  escalated: string | null;
  /** Avisos del mismo tipo agrupados desde el último correo. */
  grouped: number;
  test?: boolean;
}

/** Aviso administrativo completo. */
export function adminAlertEmail(v: AdminAlertView): MailContent & { text: string } {
  const who = v.company ?? (v.tenantId ? `empresa ${v.tenantId}` : null);
  const prefix = `${v.test ? "[PRUEBA] " : ""}[${SUBJECT_TAG[v.severity]}]`;
  const subject = `${prefix} ${v.alert.name}${who ? ` · ${who}` : ""}`.slice(0, 200);
  const rows = [
    { label: "Qué ha sucedido", value: v.summary },
    { label: "Empresa o cliente", value: who ?? "Sin empresa asociada" },
    { label: "Fecha y hora", value: dateTime(v.occurredAt) },
    ...(v.reference ? [{ label: "Referencia", value: v.reference }] : []),
    { label: "Prioridad", value: SEVERITY_LABEL[v.severity] },
    { label: "Requiere intervención", value: v.intervention ? "Sí" : "No" },
    ...(v.environment ? [{ label: "Entorno", value: v.environment }] : []),
  ];
  const blocks: Block[] = [
    { notice: { tone: v.intervention ? SEVERITY_TONE[v.severity] : "info", text: v.intervention ? "Requiere intervención del equipo. Revisa el expediente y deja constancia en el CRM." : "Informativo: no requiere ninguna acción." } },
    ...(v.escalated ? [{ notice: { tone: "error" as Tone, text: `Prioridad elevada: ${v.escalated}` } }] : []),
    { card: { status: v.status, rows, ...(v.amount ? { total: { label: "Importe", value: fmt.money(v.amount.cents, v.amount.currency) } } : {}) } },
    ...(v.details.length ? [{ h2: "Detalle" } as Block, { card: { rows: v.details } } as Block] : []),
    ...(v.grouped > 0 ? [{ notice: { tone: "info" as Tone, text: `Incluye ${v.grouped} aviso${v.grouped === 1 ? "" : "s"} del mismo tipo agrupado${v.grouped === 1 ? "" : "s"} desde el último correo. El detalle está en el historial del CRM.` } }] : []),
    ...(v.test ? [{ notice: { tone: "warning" as Tone, text: "Correo de PRUEBA con datos ficticios: no corresponde a ninguna operación real." } }] : []),
  ];
  return renderEmail(platformBrand(null), {
    family: "admin",
    eyebrow: `${SECTION_LABEL[v.alert.section]} · Aviso ${String(v.alert.n).padStart(2, "0")}`,
    title: v.alert.name,
    hero: v.severity === "critical" ? "aviso" : HERO[v.alert.section],
    intro: [v.summary],
    blocks,
    cta: v.crmUrl ? { label: "Abrir el expediente en el CRM", url: v.crmUrl } : null,
    subject,
    preheader: `${SEVERITY_LABEL[v.severity]} · ${v.status.label}${who ? ` · ${who}` : ""}`,
  });
}

export interface DigestItem {
  occurredAt: number;
  summary: string;
  company: string | null;
}

/** Resumen de los avisos repetidos que se agruparon (frecuencia configurable de los no críticos). */
export function adminDigestEmail(v: { alert: { n: number; name: string; section: AlertSection }; severity: AlertSeverity; items: DigestItem[]; total: number; since: number; crmUrl: string | null; test?: boolean }): MailContent & { text: string } {
  const shown = v.items.slice(0, 15);
  return renderEmail(platformBrand(null), {
    family: "admin",
    eyebrow: `${SECTION_LABEL[v.alert.section]} · Resumen agrupado`,
    title: `${v.total} aviso${v.total === 1 ? "" : "s"}: ${v.alert.name}`,
    hero: "equipo",
    intro: [`Desde el ${dateTime(v.since)} se han producido ${v.total} aviso${v.total === 1 ? "" : "s"} de este tipo. Para no saturar el buzón se envían agrupados según la frecuencia configurada en el CRM.`],
    blocks: [
      { card: { status: { label: SEVERITY_LABEL[v.severity], tone: SEVERITY_TONE[v.severity] }, rows: shown.map((i) => ({ label: dateTime(i.occurredAt), value: `${i.company ? `${i.company}: ` : ""}${i.summary}` })) } },
      ...(v.total > shown.length ? [{ p: `Y ${v.total - shown.length} más en el historial del CRM.` } as Block] : []),
      ...(v.test ? [{ notice: { tone: "warning" as Tone, text: "Correo de PRUEBA con datos ficticios: no corresponde a ninguna operación real." } }] : []),
    ],
    cta: v.crmUrl ? { label: "Ver el historial en el CRM", url: v.crmUrl } : null,
    subject: `${v.test ? "[PRUEBA] " : ""}[Resumen] ${v.total} × ${v.alert.name}`.slice(0, 200),
  });
}
