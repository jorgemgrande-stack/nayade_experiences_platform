/**
 * Contratos y firma electrónica · contenido firmado, huella y documentos (puro: sin BD ni red).
 *
 *  - Contenido firmado: JSON canónico (claves ordenadas) con el texto exacto del contrato, el cliente, el importe y la
 *    plantilla de la que sale. Su SHA-256 es la huella que se muestra a quien firma y se guarda con la firma, como en el
 *    contrato de alquiler de Ski Net (server/skiRental/units.ts).
 *  - PDF del contrato firmado (HTML que server/pdfGenerator.ts convierte) con la firma y el registro de evidencias.
 *  - Correo con el enlace de firma (diseño común de server/mail/design.ts, marca de la empresa).
 */
import { createHash } from "node:crypto";
import { renderEmail } from "../mail/design";
import { EVIDENCE_EVENT_LABEL, SIMPLE_SIGNATURE_NOTICE, formatAmount, formatLongDay } from "../../shared/contractsEsign";

export interface SignedContent {
  contractId: number;
  company: string;
  title: string;
  body: string;
  customerName: string;
  customerEmail: string | null;
  /** Importe con dos decimales («1234.50») o null. */
  amount: string | null;
  contractDate: string;
  templateId: number | null;
  templateVersion: number | null;
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;

/** Serialización canónica: el mismo contenido da siempre el mismo texto y la misma huella. */
export function canonicalContent(c: SignedContent): string {
  return JSON.stringify(sortKeys(c));
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export function contentHash(c: SignedContent): string {
  return sha256(canonicalContent(c));
}

/** Lee el contenido guardado y comprueba que corresponde a su huella; null si no es legible o no coincide. */
export function verifiedContent(json: string | null, hash: string | null): SignedContent | null {
  if (!json || !hash) return null;
  try {
    const c = JSON.parse(json) as SignedContent;
    return contentHash(c) === hash ? c : null;
  } catch {
    return null;
  }
}

/** El texto aún tiene datos sin completar (variables sin valor). */
export const hasBlanks = (text: string) => text.includes("________");

// ─── PDF ─────────────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Fecha y hora de Madrid («8/11/2026, 10:15:03»). */
export function fmtMadrid(ms: number | null): string {
  if (ms == null) return "—";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(ms));
}

export interface SignatureEvidence {
  signerName: string;
  signerTaxId: string | null;
  signedAt: number;
  ip: string | null;
  userAgent: string | null;
  method: "panel" | "link";
  signedBy: string;
}

export interface EvidenceEvent {
  event: string;
  actor: string;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: number;
}

/** HTML del contrato firmado (A4) con la firma y su registro de evidencias. */
export function signedContractHtml(c: SignedContent, hash: string, sig: SignatureEvidence, events: EvidenceEvent[]): string {
  const amount = c.amount != null ? formatAmount(Number(c.amount)) : null;
  const rows = events
    .map((e) => `<tr><td>${esc(fmtMadrid(e.createdAt))}</td><td>${esc(EVIDENCE_EVENT_LABEL[e.event] ?? e.event)}</td><td>${esc(e.actor)}</td><td>${esc(e.ip ?? "")}</td><td>${esc(e.detail ?? "")}</td></tr>`)
    .join("");
  return (
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>` +
    "body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px;line-height:1.5}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}" +
    ".muted{color:#6b7280}.body{white-space:pre-wrap;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:12px 0;margin:12px 0}" +
    ".sig{border:1px solid #d1d5db;border-radius:8px;padding:10px 12px}.mono{font-family:Consolas,monospace;font-size:10px;word-break:break-all}" +
    "table{border-collapse:collapse;width:100%;font-size:10px}td,th{border:1px solid #e5e7eb;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6}" +
    `</style></head><body>` +
    `<h1>${esc(c.title)}</h1><p class="muted">${esc(c.company)} · Contrato n.º ${c.contractId} · ${esc(formatLongDay(c.contractDate))}</p>` +
    `<p>Cliente: <strong>${esc(c.customerName)}</strong>${c.customerEmail ? ` · ${esc(c.customerEmail)}` : ""}${amount ? ` · Importe: ${esc(amount)}` : ""}</p>` +
    `<div class="body">${esc(c.body)}</div>` +
    `<h2>Firma</h2><div class="sig"><p>Firmado por <strong>${esc(sig.signerName)}</strong>${sig.signerTaxId ? ` (DNI/NIF ${esc(sig.signerTaxId)})` : ""} el ${esc(fmtMadrid(sig.signedAt))} (hora de Madrid).</p>` +
    `<p>${sig.method === "link" ? "Firmado a distancia con un enlace personal de un solo uso." : "Firmado en el equipo de la empresa."} IP: ${esc(sig.ip ?? "desconocida")}. Navegador: ${esc(sig.userAgent ?? "desconocido")}.</p>` +
    `<p>Huella SHA-256 del texto firmado:</p><p class="mono">${esc(hash)}</p><p class="muted">${esc(SIMPLE_SIGNATURE_NOTICE)}</p></div>` +
    `<h2>Registro de evidencias</h2><table><thead><tr><th>Fecha</th><th>Evento</th><th>Quién</th><th>IP</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>` +
    `</body></html>`
  );
}

// ─── Correo con el enlace ────────────────────────────────────────────────────

export function signRequestEmail(i: { company: string; customerName: string; title: string; amount: string | null; url: string; expiresAt: number; recipient: string }) {
  const amount = i.amount != null ? formatAmount(Number(i.amount)) : null;
  return renderEmail(
    { name: i.company, supportEmail: null },
    {
      family: "transactional",
      eyebrow: "Contrato para firmar",
      title: "Tienes un contrato para revisar y firmar",
      subject: `${i.company}: contrato para firmar «${i.title.replace(/[\r\n\t]+/g, " ")}»`,
      greeting: `Hola, ${i.customerName}:`,
      intro: [`${i.company} te envía este contrato para que lo revises y, si estás de acuerdo, lo firmes desde el enlace.`],
      blocks: [
        { card: { rows: [{ label: "Contrato", value: i.title }, ...(amount ? [{ label: "Importe", value: amount }] : []), { label: "El enlace caduca", value: fmtMadrid(i.expiresAt) }] } },
        { notice: { tone: "info", text: "El enlace es personal y de un solo uso: no lo reenvíes. Si no esperabas este correo, ignóralo." } },
        { p: SIMPLE_SIGNATURE_NOTICE },
      ],
      cta: { label: "Revisar y firmar", url: i.url },
      recipient: i.recipient,
    },
  );
}
