/**
 * Elephant Connect · Campaigns — tipos y reglas compartidas (servidor y panel) de las campañas de correo.
 *
 *  - Contenido por BLOQUES (título, texto, botón, imagen, separador): nunca HTML libre. El HTML lo genera el servidor
 *    con la plantilla y la marca de la empresa, escapando todo lo escrito (sin etiquetas ni plantillas de Brevo).
 *  - Enlaces solo http(s); imágenes solo https (un correo con imágenes http lo bloquean los gestores).
 */

export const CAMPAIGN_STATUSES = ["draft", "preparing", "scheduled", "sent", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Borrador",
  preparing: "Preparando envío",
  scheduled: "Programada",
  sent: "Enviada",
  failed: "Fallida",
};

export type CampaignBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "button"; label: string; url: string }
  | { type: "image"; url: string; alt: string }
  | { type: "divider" };

export const MAX_BLOCKS = 40;
export const MAX_TEXT = 5000;
export const NAME_MAX = 120;
export const SUBJECT_MAX = 200;
export const PREVIEW_MAX = 200;
/** Las campañas programadas: como pronto dentro de 15 minutos (tiempo para preparar la lista en Brevo). */
export const MIN_SCHEDULE_LEAD_MS = 15 * 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 180 * 24 * 3600_000;

const HTTP_RE = /^https?:\/\/[^\s"'<>]+$/i;
const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/i;

export function isSafeUrl(u: string, httpsOnly = false): boolean {
  const v = u.trim();
  return v.length <= 1000 && (httpsOnly ? HTTPS_RE : HTTP_RE).test(v);
}

/** Valida y normaliza los bloques; lanza `Error` con un mensaje para la persona que redacta. */
export function checkBlocks(input: unknown): CampaignBlock[] {
  if (!Array.isArray(input)) throw new Error("Contenido no válido");
  if (input.length > MAX_BLOCKS) throw new Error(`Como máximo ${MAX_BLOCKS} bloques`);
  const out: CampaignBlock[] = [];
  for (const raw of input) {
    const b = (raw ?? {}) as Record<string, unknown>;
    const s = (k: string, max: number) => String(b[k] ?? "").trim().slice(0, max);
    switch (b.type) {
      case "heading": {
        const text = s("text", 200);
        if (text) out.push({ type: "heading", text });
        break;
      }
      case "text": {
        const text = s("text", MAX_TEXT);
        if (text) out.push({ type: "text", text });
        break;
      }
      case "button": {
        const label = s("label", 80);
        const url = s("url", 1000);
        if (!label) throw new Error("Un botón necesita texto");
        if (!isSafeUrl(url)) throw new Error("El enlace de un botón debe empezar por https:// o http://");
        out.push({ type: "button", label, url });
        break;
      }
      case "image": {
        const url = s("url", 1000);
        if (!isSafeUrl(url, true)) throw new Error("La dirección de una imagen debe empezar por https://");
        out.push({ type: "image", url, alt: s("alt", 200) });
        break;
      }
      case "divider":
        out.push({ type: "divider" });
        break;
      default:
        throw new Error("Tipo de bloque no válido");
    }
  }
  return out;
}

/** Lo que falta para poder enviar (vacío = lista para enviar). */
export function missingForSend(c: { subject: string; senderId: number | null; blocks: CampaignBlock[] }): string[] {
  const m: string[] = [];
  if (!c.subject.trim()) m.push("el asunto");
  if (!c.senderId) m.push("el remitente");
  if (!c.blocks.some((b) => b.type === "text" || b.type === "heading" || b.type === "image")) m.push("el contenido");
  return m;
}
