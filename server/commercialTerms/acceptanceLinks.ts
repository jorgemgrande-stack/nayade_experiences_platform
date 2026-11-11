/**
 * Enlaces recuperables y envíos de la aceptación de unas condiciones comerciales personalizadas (CRM 0051).
 *
 * - El enlace público se sigue buscando SOLO por su huella (`crm_contract_acceptances.token_sha256`). Aquí se guarda,
 *   además, el propio enlace CIFRADO en reposo (AES-256-GCM con el llavero del registro, `REGISTRY_KEYS`; el id de la
 *   aceptación va como datos autenticados, así que un valor copiado a otra fila no descifra). Sirve para que el
 *   operador con el permiso de precios personalizados lo vuelva a consultar, lo copie o lo reenvíe cuantas veces haga
 *   falta: consultarlo no lo consume.
 * - El historial de envíos guarda destinatario, fecha, contrato y versión, el mensaje de la bandeja de salida y el
 *   resultado al encolarlo. Nunca el enlace.
 * Sin estas tablas la aceptación funciona como antes (el enlace se entrega una sola vez).
 */
import type mysql from "mysql2/promise";
import { decryptDsn, encryptDsn, type Keyring } from "../_core/tenantRegistry/crypto";

export interface StoredAcceptanceLink {
  acceptanceId: number;
  termsId: number;
  contractId: number;
  /** Enlace cifrado (base64) y clave del llavero con la que se cifró. */
  cipher: string;
  keyId: string;
  createdAt: number;
}

/** sent: primer envío · resent: reenvío del mismo enlace · regenerated: enlace nuevo (el anterior caducó o se revocó). */
export type AcceptanceSendKind = "sent" | "resent" | "regenerated";

export interface AcceptanceSend {
  id: number;
  termsId: number;
  acceptanceId: number;
  contractId: number;
  contractVersion: number;
  kind: AcceptanceSendKind;
  recipientName: string;
  recipientEmail: string;
  /** Mensaje de la bandeja de salida de plataforma (null si no llegó a encolarse). */
  outboxId: number | null;
  /** Estado al encolarlo (pending, skipped, failed…) o `unavailable` si no hay correo de plataforma. */
  status: string;
  reason: string | null;
  actor: string;
  createdAt: number;
}

export interface AcceptanceLinkStore {
  saveLink(l: StoredAcceptanceLink): Promise<void>;
  link(acceptanceId: number): Promise<StoredAcceptanceLink | null>;
  addSend(s: Omit<AcceptanceSend, "id">): Promise<AcceptanceSend>;
  /** Envíos de un acuerdo, del más reciente al más antiguo. */
  sends(termsId: number): Promise<AcceptanceSend[]>;
}

/** Datos autenticados del cifrado: el enlace solo descifra como el de SU aceptación. */
const aad = (acceptanceId: number) => `commercial-terms-acceptance:${acceptanceId}`;

export function sealAcceptanceToken(token: string, acceptanceId: number, ring: Keyring): { cipher: string; keyId: string } {
  return encryptDsn(token, aad(acceptanceId), ring);
}

export function openAcceptanceToken(l: Pick<StoredAcceptanceLink, "cipher" | "keyId" | "acceptanceId">, ring: Keyring): string {
  return decryptDsn(l.cipher, l.keyId, aad(l.acceptanceId), ring);
}

// ── Memoria (pruebas y desarrollo) ──────────────────────────────────────────────

export class MemoryAcceptanceLinkStore implements AcceptanceLinkStore {
  links = new Map<number, StoredAcceptanceLink>();
  sendRows: AcceptanceSend[] = [];
  private seq = 0;
  async saveLink(l: StoredAcceptanceLink) {
    if (this.links.has(l.acceptanceId)) throw new Error("El enlace de esta aceptación ya está guardado");
    this.links.set(l.acceptanceId, { ...l });
  }
  async link(acceptanceId: number) {
    const l = this.links.get(acceptanceId);
    return l ? { ...l } : null;
  }
  async addSend(s: Omit<AcceptanceSend, "id">) {
    const row = { ...s, id: ++this.seq };
    this.sendRows.push(row);
    return { ...row };
  }
  async sends(termsId: number) {
    return this.sendRows.filter((s) => s.termsId === termsId).sort((a, b) => b.id - a.id).map((s) => ({ ...s }));
  }
}

// ── MySQL (CRM 0051) ────────────────────────────────────────────────────────────

type Row = mysql.RowDataPacket;

export class MysqlAcceptanceLinkStore implements AcceptanceLinkStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async saveLink(l: StoredAcceptanceLink) {
    await this.pool.query("INSERT INTO commercial_terms_acceptance_links (acceptance_id, terms_id, contract_id, token_cipher, key_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [l.acceptanceId, l.termsId, l.contractId, l.cipher, l.keyId, l.createdAt]);
  }

  async link(acceptanceId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM commercial_terms_acceptance_links WHERE acceptance_id = ? LIMIT 1", [acceptanceId]);
    const r = rows[0];
    return r ? { acceptanceId: Number(r.acceptance_id), termsId: Number(r.terms_id), contractId: Number(r.contract_id), cipher: String(r.token_cipher), keyId: String(r.key_id), createdAt: Number(r.created_at) } : null;
  }

  private send = (r: Row): AcceptanceSend => ({
    id: Number(r.id),
    termsId: Number(r.terms_id),
    acceptanceId: Number(r.acceptance_id),
    contractId: Number(r.contract_id),
    contractVersion: Number(r.contract_version),
    kind: String(r.kind) as AcceptanceSendKind,
    recipientName: String(r.recipient_name),
    recipientEmail: String(r.recipient_email),
    outboxId: r.outbox_id === null ? null : Number(r.outbox_id),
    status: String(r.status),
    reason: r.reason === null ? null : String(r.reason),
    actor: String(r.actor),
    createdAt: Number(r.created_at),
  });

  async addSend(s: Omit<AcceptanceSend, "id">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT INTO commercial_terms_acceptance_sends (terms_id, acceptance_id, contract_id, contract_version, kind, recipient_name, recipient_email, outbox_id, status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [s.termsId, s.acceptanceId, s.contractId, s.contractVersion, s.kind, s.recipientName.slice(0, 160), s.recipientEmail.slice(0, 254), s.outboxId, s.status.slice(0, 24), s.reason?.slice(0, 300) ?? null, s.actor.slice(0, 100), s.createdAt],
    );
    return { ...s, id: Number(r.insertId) };
  }

  async sends(termsId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM commercial_terms_acceptance_sends WHERE terms_id = ? ORDER BY id DESC LIMIT 200", [termsId]);
    return rows.map(this.send);
  }
}
