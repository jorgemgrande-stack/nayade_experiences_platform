/**
 * Almacén de los servicios externos (CRM 0026): suscripciones externas, aceptaciones de contrato y su historial.
 * Las filas de Stripe se separan por modo (`livemode`): un entorno de pruebas nunca ve las de live ni al revés.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { StripeMode } from "../stripe/config";
import { ExternalError, type ContractAcceptance, type ExternalEvent, type ExternalSubscription } from "./types";

export type NewExternal = Omit<ExternalSubscription, "id" | "version" | "updatedAt">;
export type ExternalPatch = Partial<Omit<ExternalSubscription, "id" | "contractId" | "companyId" | "createdAt" | "createdBy" | "version">>;
/** Alta de una aceptación: el hash del token solo se guarda, nunca se devuelve. */
export type NewAcceptance = Omit<ContractAcceptance, "id"> & { tokenSha256: string };

export interface ExternalStore {
  readonly mode: StripeMode;
  insert(x: NewExternal): Promise<ExternalSubscription>;
  get(id: number): Promise<ExternalSubscription | null>;
  byContract(contractId: number): Promise<ExternalSubscription | null>;
  bySetupSession(sessionId: string): Promise<ExternalSubscription | null>;
  byStripeSubscription(subscriptionId: string): Promise<ExternalSubscription | null>;
  list(f?: { companyId?: number; status?: string }): Promise<ExternalSubscription[]>;
  /** Actualización optimista: falla con `conflict` si otra operación la cambió antes. */
  update(id: number, expectedVersion: number, patch: ExternalPatch, now: number): Promise<ExternalSubscription>;
  insertAcceptance(a: NewAcceptance): Promise<ContractAcceptance>;
  acceptanceByToken(tokenSha256: string): Promise<ContractAcceptance | null>;
  acceptances(contractId: number): Promise<ContractAcceptance[]>;
  /** Registra la aceptación si sigue pendiente; false si ya no lo estaba (doble envío). */
  markAccepted(id: number, p: Pick<ContractAcceptance, "acceptedName" | "acceptedTaxId" | "acceptedAt" | "acceptedIpHash" | "acceptedUserAgent" | "consentText">): Promise<boolean>;
  setAcceptanceStatus(id: number, status: "revoked" | "expired"): Promise<void>;
  /** Evento del historial; con `ref`, una sola vez por tipo (`created: false` si ya existía). */
  event(e: Omit<ExternalEvent, "id">): Promise<{ created: boolean }>;
  events(externalId: number): Promise<ExternalEvent[]>;
}

export class MemoryExternalStore implements ExternalStore {
  rows: ExternalSubscription[] = [];
  acceptRows: ContractAcceptance[] = [];
  private tokens = new Map<number, string>();
  eventRows: ExternalEvent[] = [];
  private seq = 0;
  constructor(readonly mode: StripeMode = "test") {}
  private copy = <T>(x: T): T => structuredClone(x);
  async insert(x: NewExternal) {
    if (this.rows.some((r) => r.contractId === x.contractId)) throw new ExternalError("conflict", "El contrato ya tiene una suscripción externa");
    const row: ExternalSubscription = { ...structuredClone(x), id: ++this.seq, version: 1, updatedAt: x.createdAt };
    this.rows.push(row);
    return this.copy(row);
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? this.copy(r) : null;
  }
  async byContract(contractId: number) {
    const r = this.rows.find((x) => x.contractId === contractId);
    return r ? this.copy(r) : null;
  }
  async bySetupSession(id: string) {
    const r = this.rows.find((x) => x.stripeSetupSessionId === id);
    return r ? this.copy(r) : null;
  }
  async byStripeSubscription(id: string) {
    const r = this.rows.find((x) => x.stripeSubscriptionId === id);
    return r ? this.copy(r) : null;
  }
  async list(f: { companyId?: number; status?: string } = {}) {
    return this.rows.filter((r) => (f.companyId === undefined || r.companyId === f.companyId) && (f.status === undefined || r.status === f.status)).map(this.copy);
  }
  async update(id: number, expectedVersion: number, patch: ExternalPatch, now: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new ExternalError("not_found", "Suscripción externa no encontrada");
    if (r.version !== expectedVersion) throw new ExternalError("conflict", "La suscripción externa cambió mientras tanto: vuelve a intentarlo");
    for (const k of ["stripeSubscriptionId", "stripeSetupSessionId"] as const) {
      const v = patch[k];
      if (v && this.rows.some((x) => x.id !== id && x[k] === v)) throw new ExternalError("conflict", "Objeto de Stripe ya enlazado a otra suscripción externa");
    }
    Object.assign(r, structuredClone(patch), { version: r.version + 1, updatedAt: now });
    return this.copy(r);
  }
  async insertAcceptance({ tokenSha256, ...a }: NewAcceptance) {
    const row = { ...structuredClone(a), id: ++this.seq };
    this.acceptRows.push(row);
    this.tokens.set(row.id, tokenSha256);
    return this.copy(row);
  }
  async acceptanceByToken(t: string) {
    const r = this.acceptRows.find((x) => this.tokens.get(x.id) === t);
    return r ? this.copy(r) : null;
  }
  async acceptances(contractId: number) {
    return this.acceptRows.filter((x) => x.contractId === contractId).sort((a, b) => b.id - a.id).map(this.copy);
  }
  async markAccepted(id: number, p: Parameters<ExternalStore["markAccepted"]>[1]) {
    const r = this.acceptRows.find((x) => x.id === id);
    if (!r || r.status !== "pending") return false;
    Object.assign(r, p, { status: "accepted" });
    return true;
  }
  async setAcceptanceStatus(id: number, status: "revoked" | "expired") {
    const r = this.acceptRows.find((x) => x.id === id);
    if (r && r.status === "pending") r.status = status;
  }
  async event(e: Omit<ExternalEvent, "id">) {
    if (e.ref && this.eventRows.some((x) => x.externalId === e.externalId && x.kind === e.kind && x.ref === e.ref)) return { created: false };
    this.eventRows.push({ ...structuredClone(e), id: ++this.seq });
    return { created: true };
  }
  async events(externalId: number) {
    return this.eventRows.filter((x) => x.externalId === externalId).sort((a, b) => a.at - b.at || a.id - b.id).map(this.copy);
  }
}

type Row = RowDataPacket & Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const COLS: Array<[keyof ExternalSubscription, string]> = [
  ["serviceKey", "service_key"],
  ["serviceName", "service_name"],
  ["amountCents", "amount_cents"],
  ["currency", "currency"],
  ["taxRateBp", "tax_rate_bp"],
  ["interval", "billing_interval"],
  ["billingDay", "billing_day"],
  ["billingHour", "billing_hour"],
  ["timezone", "timezone"],
  ["graceDays", "grace_days"],
  ["firstChargeAt", "first_charge_at"],
  ["externalRef", "external_ref"],
  ["status", "status"],
  ["stripeCustomerId", "stripe_customer_id"],
  ["stripeSetupSessionId", "stripe_setup_session_id"],
  ["stripePaymentMethodId", "stripe_payment_method_id"],
  ["stripeSubscriptionId", "stripe_subscription_id"],
  ["stripeTestClockId", "stripe_test_clock_id"],
  ["lastInvoiceId", "last_invoice_id"],
  ["lastInvoiceStatus", "last_invoice_status"],
  ["currentPeriodStart", "current_period_start"],
  ["currentPeriodEnd", "current_period_end"],
  ["graceUntil", "grace_until"],
  ["decisionReason", "decision_reason"],
  ["intervalCount", "interval_count"],
  ["durationPeriods", "duration_periods"],
  ["endsAt", "ends_at"],
  ["baseAmountCents", "base_amount_cents"],
];
const NUMERIC = new Set<keyof ExternalSubscription>(["amountCents", "taxRateBp", "billingDay", "billingHour", "graceDays", "firstChargeAt", "currentPeriodStart", "currentPeriodEnd", "graceUntil", "intervalCount", "durationPeriods", "endsAt", "baseAmountCents"]);

export class MysqlExternalStore implements ExternalStore {
  private readonly lm: 0 | 1;
  constructor(
    private pool: mysql.Pool,
    readonly mode: StripeMode = "test",
  ) {
    this.lm = mode === "live" ? 1 : 0;
  }
  private row = (r: Row): ExternalSubscription => {
    const out: Record<string, unknown> = { id: Number(r.id), contractId: Number(r.contract_id), companyId: Number(r.company_id), version: Number(r.version), createdBy: String(r.created_by), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
    for (const [k, c] of COLS) out[k] = NUMERIC.has(k) ? num(r[c]) : str(r[c]);
    // Filas anteriores a la 0041: mensuales, sin ajuste
    out.intervalCount = (out.intervalCount as number | null) ?? 1;
    out.adjustment = r.adjustment_json ? (typeof r.adjustment_json === "string" ? JSON.parse(r.adjustment_json) : r.adjustment_json) : null;
    return out as unknown as ExternalSubscription;
  };
  private async one(where: string, args: unknown[]) {
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM external_subscriptions WHERE ${where} AND livemode = ? LIMIT 1`, [...args, this.lm]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async insert(x: NewExternal) {
    const cols = ["livemode", "contract_id", "company_id", "created_by", "created_at", "updated_at", "adjustment_json", ...COLS.map(([, c]) => c)];
    const vals = [this.lm, x.contractId, x.companyId, x.createdBy, x.createdAt, x.createdAt, x.adjustment ? JSON.stringify(x.adjustment) : null, ...COLS.map(([k]) => (x as unknown as Record<string, unknown>)[k] ?? null)];
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(`INSERT INTO external_subscriptions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
      return (await this.get(r.insertId))!;
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ExternalError("conflict", "El contrato ya tiene una suscripción externa");
      throw e;
    }
  }
  get(id: number) {
    return this.one("id = ?", [id]);
  }
  byContract(contractId: number) {
    return this.one("contract_id = ?", [contractId]);
  }
  bySetupSession(id: string) {
    return this.one("stripe_setup_session_id = ?", [id]);
  }
  byStripeSubscription(id: string) {
    return this.one("stripe_subscription_id = ?", [id]);
  }
  async list(f: { companyId?: number; status?: string } = {}) {
    const where = ["livemode = ?"];
    const args: unknown[] = [this.lm];
    if (f.companyId !== undefined) (where.push("company_id = ?"), args.push(f.companyId));
    if (f.status !== undefined) (where.push("status = ?"), args.push(f.status));
    const [rows] = await this.pool.query<Row[]>(`SELECT * FROM external_subscriptions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 500`, args);
    return rows.map(this.row);
  }
  async update(id: number, expectedVersion: number, patch: ExternalPatch, now: number) {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, c] of COLS) if (k in patch) (sets.push(`${c} = ?`), args.push((patch as Record<string, unknown>)[k] ?? null));
    if ("adjustment" in patch) (sets.push("adjustment_json = ?"), args.push(patch.adjustment ? JSON.stringify(patch.adjustment) : null));
    try {
      const [r] = await this.pool.query<mysql.ResultSetHeader>(`UPDATE external_subscriptions SET ${[...sets, "version = version + 1", "updated_at = ?"].join(", ")} WHERE id = ? AND version = ? AND livemode = ?`, [...args, now, id, expectedVersion, this.lm]);
      if (r.affectedRows !== 1) {
        if (!(await this.get(id))) throw new ExternalError("not_found", "Suscripción externa no encontrada");
        throw new ExternalError("conflict", "La suscripción externa cambió mientras tanto: vuelve a intentarlo");
      }
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ExternalError("conflict", "Objeto de Stripe ya enlazado a otra suscripción externa");
      throw e;
    }
    return (await this.get(id))!;
  }
  private acc = (r: Row): ContractAcceptance => ({
    id: Number(r.id),
    contractId: Number(r.contract_id),
    contractVersion: Number(r.contract_version),
    documentSha256: String(r.document_sha256),
    status: String(r.status) as ContractAcceptance["status"],
    signerName: String(r.signer_name),
    signerEmail: String(r.signer_email),
    signerRole: str(r.signer_role),
    signerTaxId: str(r.signer_tax_id),
    acceptedName: str(r.accepted_name),
    acceptedTaxId: str(r.accepted_tax_id),
    acceptedAt: num(r.accepted_at),
    acceptedIpHash: str(r.accepted_ip_hash),
    acceptedUserAgent: str(r.accepted_user_agent),
    consentText: str(r.consent_text),
    expiresAt: Number(r.expires_at),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
  });
  async insertAcceptance(a: NewAcceptance) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      `INSERT INTO crm_contract_acceptances (contract_id, contract_version, document_sha256, token_sha256, status, signer_name, signer_email, signer_role, signer_tax_id, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.contractId, a.contractVersion, a.documentSha256, a.tokenSha256, a.status, a.signerName, a.signerEmail, a.signerRole, a.signerTaxId, a.expiresAt, a.createdBy, a.createdAt],
    );
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM crm_contract_acceptances WHERE id = ?", [r.insertId]);
    return this.acc(rows[0]);
  }
  async acceptanceByToken(t: string) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM crm_contract_acceptances WHERE token_sha256 = ? LIMIT 1", [t]);
    return rows[0] ? this.acc(rows[0]) : null;
  }
  async acceptances(contractId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM crm_contract_acceptances WHERE contract_id = ? ORDER BY id DESC", [contractId]);
    return rows.map(this.acc);
  }
  async markAccepted(id: number, p: Parameters<ExternalStore["markAccepted"]>[1]) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "UPDATE crm_contract_acceptances SET status = 'accepted', accepted_name = ?, accepted_tax_id = ?, accepted_at = ?, accepted_ip_hash = ?, accepted_user_agent = ?, consent_text = ? WHERE id = ? AND status = 'pending'",
      [p.acceptedName, p.acceptedTaxId, p.acceptedAt, p.acceptedIpHash, p.acceptedUserAgent, p.consentText, id],
    );
    return r.affectedRows === 1;
  }
  async setAcceptanceStatus(id: number, status: "revoked" | "expired") {
    await this.pool.query("UPDATE crm_contract_acceptances SET status = ? WHERE id = ? AND status = 'pending'", [status, id]);
  }
  async event(e: Omit<ExternalEvent, "id">) {
    const [r] = await this.pool.query<mysql.ResultSetHeader>(
      "INSERT IGNORE INTO external_subscription_events (external_id, kind, ref, detail_json, actor, at) VALUES (?, ?, ?, ?, ?, ?)",
      [e.externalId, e.kind, e.ref, e.detail ? JSON.stringify(e.detail) : null, e.actor.slice(0, 100), e.at],
    );
    return { created: r.affectedRows === 1 };
  }
  async events(externalId: number) {
    const [rows] = await this.pool.query<Row[]>("SELECT * FROM external_subscription_events WHERE external_id = ? ORDER BY at, id", [externalId]);
    return rows.map((r) => ({ id: Number(r.id), externalId: Number(r.external_id), kind: String(r.kind), ref: str(r.ref), detail: r.detail_json ? (typeof r.detail_json === "string" ? JSON.parse(r.detail_json) : (r.detail_json as Record<string, unknown>)) : null, actor: String(r.actor), at: Number(r.at) }));
  }
}
