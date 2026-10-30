/**
 * Consentimiento comercial por contacto del CRM y por FINALIDAD (migración 0031).
 *
 * Finalidades: `newsletter` (novedades), `recommendations` (recomendaciones personalizadas) y `promotions`
 * (promociones y campañas). Por cada una: estado (concedido o retirado), origen, evidencia, fecha de concesión y fecha
 * de baja.
 *
 * Reglas:
 *  - Sin registro = sin consentimiento: nunca se presume.
 *  - Conceder exige el origen y la evidencia (texto aceptado, formulario, referencia…): es la prueba del consentimiento.
 *  - Cada cambio añade una fila al historial inmutable (`crm_contact_consent_events`) y recalcula el estado vigente en
 *    la misma transacción. El historial nunca se reescribe.
 *  - La baja pública (enlace del correo o baja en un clic) es idempotente: una finalidad ya retirada no cambia.
 *  - Un envío comercial de una finalidad solo sale a un contacto con esa finalidad concedida y sin baja posterior
 *    (`consentAllows`).
 */
import { z } from "zod";
import type mysql from "mysql2/promise";
import { CrmError } from "../crm/types";

export const CONSENT_PURPOSES = ["newsletter", "recommendations", "promotions"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  newsletter: "Novedades (newsletter)",
  recommendations: "Recomendaciones personalizadas",
  promotions: "Promociones y campañas",
};
export type ConsentStatus = "granted" | "withdrawn";
export type ConsentAction = "granted" | "withdrawn" | "unsubscribed";

export interface ConsentRecord {
  contactId: number;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  source: string | null;
  evidence: string | null;
  grantedAt: number | null;
  /** Fecha de la baja o retirada (null si está concedido). */
  withdrawnAt: number | null;
  updatedBy: string;
  updatedAt: number;
}
export interface ConsentEvent {
  id: number;
  contactId: number;
  purpose: ConsentPurpose;
  action: ConsentAction;
  source: string | null;
  evidence: string | null;
  ipHash: string | null;
  actor: string;
  at: number;
}

/** ¿Puede recibir comunicaciones comerciales de esta finalidad? */
export function consentAllows(records: readonly ConsentRecord[] | null | undefined, purpose: ConsentPurpose): boolean {
  const r = records?.find((x) => x.purpose === purpose);
  return !!r && r.status === "granted" && r.withdrawnAt === null;
}
/** Motivo por el que un contacto no puede recibir la finalidad: sin consentimiento o dado de baja. */
export function consentBlock(records: readonly ConsentRecord[] | null | undefined, purpose: ConsentPurpose): "no_consent" | "unsubscribed" | null {
  if (consentAllows(records, purpose)) return null;
  return records?.find((x) => x.purpose === purpose)?.status === "withdrawn" ? "unsubscribed" : "no_consent";
}

export interface ConsentStore {
  list(contactId: number): Promise<ConsentRecord[]>;
  listMany(contactIds: number[]): Promise<Map<number, ConsentRecord[]>>;
  /** Añade el evento al historial y fija el estado vigente, a la vez (transacción). */
  apply(e: Omit<ConsentEvent, "id">, next: ConsentRecord): Promise<void>;
  events(contactId: number, limit: number): Promise<ConsentEvent[]>;
}

export class MemoryConsentStore implements ConsentStore {
  rows = new Map<string, ConsentRecord>();
  log: ConsentEvent[] = [];
  async list(id: number) {
    return CONSENT_PURPOSES.map((p) => this.rows.get(`${id}:${p}`)).filter((r): r is ConsentRecord => !!r).map((r) => ({ ...r }));
  }
  async listMany(ids: number[]) {
    const out = new Map<number, ConsentRecord[]>();
    for (const id of ids) {
      const l = await this.list(id);
      if (l.length) out.set(id, l);
    }
    return out;
  }
  async apply(e: Omit<ConsentEvent, "id">, next: ConsentRecord) {
    this.log.push({ ...e, id: this.log.length + 1 });
    this.rows.set(`${next.contactId}:${next.purpose}`, { ...next });
  }
  async events(id: number, limit: number) {
    return this.log.filter((e) => e.contactId === id).reverse().slice(0, limit).map((e) => ({ ...e }));
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const recordFromRow = (r: any): ConsentRecord => ({
  contactId: Number(r.contact_id),
  purpose: r.purpose as ConsentPurpose,
  status: r.status as ConsentStatus,
  source: r.source ?? null,
  evidence: r.evidence ?? null,
  grantedAt: num(r.granted_at),
  withdrawnAt: num(r.withdrawn_at),
  updatedBy: r.updated_by,
  updatedAt: Number(r.updated_at),
});

export class MysqlConsentStore implements ConsentStore {
  constructor(private pool: mysql.Pool) {}
  async list(id: number) {
    const [rows] = (await this.pool.query("SELECT * FROM crm_contact_consents WHERE contact_id = ? ORDER BY purpose", [id])) as unknown as [any[]];
    return rows.map(recordFromRow).filter((r) => (CONSENT_PURPOSES as readonly string[]).includes(r.purpose));
  }
  async listMany(ids: number[]) {
    const out = new Map<number, ConsentRecord[]>();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      if (!part.length) continue;
      const [rows] = (await this.pool.query(`SELECT * FROM crm_contact_consents WHERE contact_id IN (${part.map(() => "?").join(",")})`, part)) as unknown as [any[]];
      for (const r of rows.map(recordFromRow)) {
        if (!(CONSENT_PURPOSES as readonly string[]).includes(r.purpose)) continue;
        out.set(r.contactId, [...(out.get(r.contactId) ?? []), r]);
      }
    }
    return out;
  }
  async apply(e: Omit<ConsentEvent, "id">, n: ConsentRecord) {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      await c.query("INSERT INTO crm_contact_consent_events (contact_id, purpose, action, source, evidence, ip_hash, actor, created_at) VALUES (?,?,?,?,?,?,?,?)", [e.contactId, e.purpose, e.action, e.source, e.evidence, e.ipHash, e.actor.slice(0, 120), e.at]);
      await c.query(
        "INSERT INTO crm_contact_consents (contact_id, purpose, status, source, evidence, granted_at, withdrawn_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?) " +
          "ON DUPLICATE KEY UPDATE status = VALUES(status), source = VALUES(source), evidence = VALUES(evidence), granted_at = VALUES(granted_at), withdrawn_at = VALUES(withdrawn_at), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
        [n.contactId, n.purpose, n.status, n.source, n.evidence, n.grantedAt, n.withdrawnAt, n.updatedBy.slice(0, 120), n.updatedAt],
      );
      await c.commit();
    } catch (err) {
      await c.rollback().catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
  async events(id: number, limit: number) {
    const [rows] = (await this.pool.query("SELECT * FROM crm_contact_consent_events WHERE contact_id = ? ORDER BY id DESC LIMIT ?", [id, Math.min(200, Math.max(1, limit))])) as unknown as [any[]];
    return rows.map((r) => ({ id: Number(r.id), contactId: Number(r.contact_id), purpose: r.purpose as ConsentPurpose, action: r.action as ConsentAction, source: r.source ?? null, evidence: r.evidence ?? null, ipHash: r.ip_hash ?? null, actor: r.actor, at: Number(r.created_at) }));
  }
}

export const consentInput = z
  .object({
    purpose: z.enum(CONSENT_PURPOSES),
    status: z.enum(["granted", "withdrawn"]),
    source: z.string().trim().max(200).optional(),
    evidence: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentInput>;

export interface ContactConsentView {
  contactId: number;
  purposes: Record<ConsentPurpose, ConsentRecord | null>;
  events: ConsentEvent[];
}

export class ConsentService {
  constructor(private d: { store: ConsentStore; contactExists: (id: number) => Promise<boolean>; now?: () => number }) {}
  private get now() {
    return this.d.now?.() ?? Date.now();
  }

  async records(contactId: number) {
    return this.d.store.list(contactId);
  }
  async recordsMany(ids: number[]) {
    return this.d.store.listMany(ids);
  }

  async view(contactId: number): Promise<ContactConsentView> {
    if (!(await this.d.contactExists(contactId))) throw new CrmError("not_found", "Contacto no encontrado");
    const list = await this.d.store.list(contactId);
    const purposes = Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, list.find((r) => r.purpose === p) ?? null])) as Record<ConsentPurpose, ConsentRecord | null>;
    return { contactId, purposes, events: await this.d.store.events(contactId, 100) };
  }

  /** Registro desde el CRM: concede o retira una finalidad. Siempre añade una fila al historial. */
  async record(contactId: number, raw: unknown, actor: string): Promise<ContactConsentView> {
    if (!(await this.d.contactExists(contactId))) throw new CrmError("not_found", "Contacto no encontrado");
    const input = consentInput.parse(raw);
    const cur = (await this.d.store.list(contactId)).find((r) => r.purpose === input.purpose) ?? null;
    const now = this.now;
    const who = actor.slice(0, 120);
    if (input.status === "granted") {
      if (!input.source || input.source.length < 3) throw new CrmError("invalid_input", "Indica el origen del consentimiento (formulario, contrato, conversación registrada…)");
      if (!input.evidence || input.evidence.length < 5) throw new CrmError("invalid_input", "Indica la evidencia: texto aceptado, formulario, referencia del documento…");
      const next: ConsentRecord = { contactId, purpose: input.purpose, status: "granted", source: input.source, evidence: input.evidence, grantedAt: now, withdrawnAt: null, updatedBy: who, updatedAt: now };
      await this.d.store.apply({ contactId, purpose: input.purpose, action: "granted", source: input.source, evidence: input.evidence, ipHash: null, actor: who, at: now }, next);
    } else {
      if (cur?.status === "withdrawn") throw new CrmError("invalid_input", "Esa finalidad ya está retirada");
      const source = input.source && input.source.length ? input.source : "Retirada registrada en el CRM";
      const next: ConsentRecord = { contactId, purpose: input.purpose, status: "withdrawn", source: cur?.source ?? null, evidence: cur?.evidence ?? null, grantedAt: cur?.grantedAt ?? null, withdrawnAt: now, updatedBy: who, updatedAt: now };
      await this.d.store.apply({ contactId, purpose: input.purpose, action: "withdrawn", source, evidence: input.evidence || null, ipHash: null, actor: who, at: now }, next);
    }
    return this.view(contactId);
  }

  /**
   * Baja pública (enlace firmado del correo o baja en un clic del cliente de correo). Idempotente: solo registra las
   * finalidades que no estaban ya retiradas. Una finalidad sin registro también queda dada de baja (explícita).
   */
  async unsubscribe(contactId: number, purposes: readonly ConsentPurpose[], o: { channel: "link" | "one_click"; ipHash: string | null }): Promise<{ changed: ConsentPurpose[] }> {
    const cur = await this.d.store.list(contactId);
    const changed: ConsentPurpose[] = [];
    const now = this.now;
    const actor = `public:${o.channel}`;
    const source = o.channel === "one_click" ? "Baja en un clic desde el cliente de correo" : "Enlace de baja del correo";
    for (const p of purposes) {
      const r = cur.find((x) => x.purpose === p) ?? null;
      if (r?.status === "withdrawn") continue;
      const next: ConsentRecord = { contactId, purpose: p, status: "withdrawn", source: r?.source ?? null, evidence: r?.evidence ?? null, grantedAt: r?.grantedAt ?? null, withdrawnAt: now, updatedBy: actor, updatedAt: now };
      await this.d.store.apply({ contactId, purpose: p, action: "unsubscribed", source, evidence: null, ipHash: o.ipHash, actor, at: now }, next);
      changed.push(p);
    }
    return { changed };
  }
}

export async function commsTablesReady(pool: Pick<mysql.Pool, "query">): Promise<boolean> {
  for (const t of ["crm_contact_consents", "crm_contact_consent_events", "comm_sends", "comm_send_recipients", "comm_survey_responses", "comm_link_secrets"])
    if (!(await pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false))) return false;
  return true;
}
