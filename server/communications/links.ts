/**
 * Enlaces públicos firmados del Centro de envíos: baja de las comunicaciones comerciales y encuesta de soporte.
 *
 * Cada token sirve para UN propósito y no lleva datos personales:
 *  - baja:     `<contacto>.<finalidad|all>.<firma>`  (la firma cubre contacto y finalidad: cambiar cualquiera la rompe)
 *  - encuesta: `<ticket>.<firma>`
 * Firma = HMAC-SHA256 (base64url, 32 caracteres) con un secreto aleatorio guardado en la base del CRM
 * (`comm_link_secrets`, migración 0031), generado la primera vez. No caduca: una baja tiene que funcionar siempre.
 */
import crypto from "node:crypto";
import type mysql from "mysql2/promise";
import { CONSENT_PURPOSES, type ConsentPurpose } from "./consent";

export type UnsubscribeScope = ConsentPurpose | "all";
const UNSUB = /^([1-9]\d{0,14})\.([a-z]{3,20})\.([A-Za-z0-9_-]{32})$/;
const SURVEY = /^([1-9]\d{0,14})\.([A-Za-z0-9_-]{32})$/;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export class LinkSigner {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("Secreto de enlaces demasiado corto");
  }
  private mac(data: string): string {
    return crypto.createHmac("sha256", this.secret).update(data).digest("base64url").slice(0, 32);
  }

  unsubscribeToken(contactId: number, scope: UnsubscribeScope): string {
    if (!Number.isSafeInteger(contactId) || contactId <= 0) throw new Error("Contacto no válido");
    return `${contactId}.${scope}.${this.mac(`comm-unsub:${contactId}:${scope}`)}`;
  }
  /** Contacto y finalidad de un token de baja con firma válida; si no, null. */
  verifyUnsubscribe(token: unknown): { contactId: number; scope: UnsubscribeScope } | null {
    if (typeof token !== "string") return null;
    const m = UNSUB.exec(token.trim());
    if (!m) return null;
    const scope = m[2] as UnsubscribeScope;
    if (scope !== "all" && !(CONSENT_PURPOSES as readonly string[]).includes(scope)) return null;
    const contactId = Number(m[1]);
    return same(this.mac(`comm-unsub:${contactId}:${scope}`), m[3]) ? { contactId, scope } : null;
  }

  surveyToken(ticketId: number): string {
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error("Ticket no válido");
    return `${ticketId}.${this.mac(`comm-survey:${ticketId}`)}`;
  }
  /** Ticket de un token de encuesta con firma válida; si no, null. */
  verifySurvey(token: unknown): number | null {
    if (typeof token !== "string") return null;
    const m = SURVEY.exec(token.trim());
    if (!m) return null;
    const id = Number(m[1]);
    return same(this.mac(`comm-survey:${id}`), m[2]) ? id : null;
  }
}

/** Secreto de los enlaces desde la base del CRM: se crea una sola vez (aleatorio) y se reutiliza siempre. */
export async function linkSecretFromDb(pool: Pick<mysql.Pool, "query">, now = Date.now()): Promise<string> {
  await pool.query("INSERT IGNORE INTO comm_link_secrets (purpose, secret, created_at) VALUES ('links', ?, ?)", [crypto.randomBytes(32).toString("hex"), now]);
  const [rows] = (await pool.query("SELECT secret FROM comm_link_secrets WHERE purpose = 'links'")) as unknown as [Array<{ secret: string }>];
  const s = rows[0]?.secret;
  if (!s || s.length < 32) throw new Error("Secreto de enlaces no disponible");
  return s;
}
