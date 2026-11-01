/**
 * Operaciones comerciales de clientes externos (CRM 0041), además de la suscripción recurrente (service.ts):
 *
 *  - Cobro único: nota de cobro con desglose, IVA y vencimiento. Se emite como cargo extraordinario con su factura
 *    (server/invoicing/charges) y se cobra con el enlace de pago de Stripe o como pago externo (chargePayments).
 *  - Infraestructura recurrente: conceptos fijos (cantidad × precio) o variables (coste del proveedor + margen pactado,
 *    con límite de consumo) por servidor, Railway, almacenamiento, dominios, tokens de IA u otros. Cada mes se prepara
 *    un periodo en borrador, se ajusta si hace falta (con motivo y autor) y se emite con el mismo circuito.
 *
 * Reglas:
 *  - Todo nace en borrador: guardar nunca cobra ni envía nada. Emitir, enviar y cobrar son órdenes del administrador.
 *  - Nada se aprovisiona en Elephant Core: la empresa no puede ser cliente de la plataforma.
 *  - Sin cargos duplicados: un periodo por operación y mes (clave única), un cargo por periodo (clave de idempotencia
 *    del cargo) y el enlace de pago reutiliza el abierto. El cobro lo confirma el webhook firmado de Stripe sobre la
 *    factura del cargo; el estado de pago se lee de esa factura, nunca se duplica aquí.
 *  - Descuentos, recargos, ajustes de línea y excesos de límite: solo con autorización (orders:approve) y en el historial.
 */
import type { ChargeService } from "../invoicing/charges";
import { variableAmount } from "../invoicing/charges";
import type { ChargePaymentService } from "../invoicing/chargePayments";
import type { Invoice } from "../invoicing/types";
import { taxOf } from "../invoicing/rules";
import { adjustmentCents, adjustmentProblem, adjustmentText, cleanAdjustment, type Adjustment } from "./cadence";
import { ExternalError } from "./types";

export type OpKind = "one_off" | "infrastructure";
export type OpStatus = "draft" | "active" | "canceled" | "completed";
export type LineCategory = "service" | "server" | "railway" | "storage" | "domain" | "ai_tokens" | "other";
export const LINE_CATEGORIES: readonly LineCategory[] = ["service", "server", "railway", "storage", "domain", "ai_tokens", "other"];

export interface OpLine {
  key: string;
  concept: string;
  category: LineCategory;
  pricing: "fixed" | "variable";
  quantity?: number;
  unitCents?: number;
  provider?: string;
  marginBp?: number;
  marginCents?: number;
  capCents?: number | null;
}

export interface ExternalOperation {
  id: number;
  companyId: number;
  kind: OpKind;
  status: OpStatus;
  title: string;
  currency: string;
  taxRateBp: number;
  lines: OpLine[];
  adjustment: Adjustment | null;
  dueDate: string | null;
  billingDay: number | null;
  dueDays: number | null;
  startPeriod: string | null;
  capCents: number | null;
  recipientName: string | null;
  recipientEmail: string | null;
  notes: string | null;
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PeriodLine {
  key: string;
  concept: string;
  category: LineCategory;
  quantity: number;
  unitCents: number;
  amountCents: number;
  costCents?: number;
  capped?: boolean;
  adjusted?: { fromCents: number; reason: string; by: string };
}

export interface OpPeriod {
  id: number;
  operationId: number;
  period: string;
  status: "draft" | "issued" | "canceled";
  lines: PeriodLine[];
  usage: Record<string, number> | null;
  baseCents: number;
  adjustmentCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  dueDate: string;
  overCap: boolean;
  overCapAuthorized: { reason: string; by: string; at: number } | null;
  chargeId: number | null;
  invoiceId: number | null;
  sentAt: number | null;
  sentTo: string | null;
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface OpEvent {
  id: number;
  operationId: number;
  kind: string;
  ref: string | null;
  detail: Record<string, unknown> | null;
  actor: string;
  at: number;
}

export type NewOperation = Omit<ExternalOperation, "id" | "version" | "updatedAt">;
export type NewPeriod = Omit<OpPeriod, "id" | "version" | "updatedAt">;
export type OpPatch = Partial<Omit<ExternalOperation, "id" | "companyId" | "kind" | "createdBy" | "createdAt" | "version" | "updatedAt">>;
export type PeriodPatch = Partial<Pick<OpPeriod, "status" | "lines" | "usage" | "baseCents" | "adjustmentCents" | "netCents" | "taxCents" | "totalCents" | "dueDate" | "overCap" | "overCapAuthorized" | "chargeId" | "invoiceId" | "sentAt" | "sentTo">>;

export interface OperationStore {
  insert(o: NewOperation): Promise<ExternalOperation>;
  get(id: number): Promise<ExternalOperation | null>;
  list(f?: { companyId?: number }): Promise<ExternalOperation[]>;
  /** Actualización optimista: `conflict` si otra operación la cambió antes. */
  update(id: number, expectedVersion: number, patch: OpPatch, now: number): Promise<ExternalOperation>;
  /** Crea el periodo o devuelve el existente (`created: false`): uno por operación y periodo. */
  insertPeriod(p: NewPeriod): Promise<{ period: OpPeriod; created: boolean }>;
  period(id: number): Promise<OpPeriod | null>;
  periods(operationId: number): Promise<OpPeriod[]>;
  updatePeriod(id: number, expectedVersion: number, patch: PeriodPatch, now: number): Promise<OpPeriod>;
  /** Evento del historial; con `ref`, una sola vez por tipo. */
  event(e: Omit<OpEvent, "id">): Promise<{ created: boolean }>;
  events(operationId: number): Promise<OpEvent[]>;
}

export class MemoryOperationStore implements OperationStore {
  ops: ExternalOperation[] = [];
  periodRows: OpPeriod[] = [];
  eventRows: OpEvent[] = [];
  private seq = 0;
  private copy = <T>(x: T): T => structuredClone(x);
  async insert(o: NewOperation) {
    const row: ExternalOperation = { ...structuredClone(o), id: ++this.seq, version: 1, updatedAt: o.createdAt };
    this.ops.push(row);
    return this.copy(row);
  }
  async get(id: number) {
    const r = this.ops.find((x) => x.id === id);
    return r ? this.copy(r) : null;
  }
  async list(f: { companyId?: number } = {}) {
    return this.ops.filter((r) => f.companyId === undefined || r.companyId === f.companyId).sort((a, b) => b.id - a.id).map(this.copy);
  }
  async update(id: number, expectedVersion: number, patch: OpPatch, now: number) {
    const r = this.ops.find((x) => x.id === id);
    if (!r) throw new ExternalError("not_found", "Operación no encontrada");
    if (r.version !== expectedVersion) throw new ExternalError("conflict", "La operación cambió mientras tanto: vuelve a intentarlo");
    Object.assign(r, structuredClone(patch), { version: r.version + 1, updatedAt: now });
    return this.copy(r);
  }
  async insertPeriod(p: NewPeriod) {
    const cur = this.periodRows.find((x) => x.operationId === p.operationId && x.period === p.period);
    if (cur) return { period: this.copy(cur), created: false };
    const row: OpPeriod = { ...structuredClone(p), id: ++this.seq, version: 1, updatedAt: p.createdAt };
    this.periodRows.push(row);
    return { period: this.copy(row), created: true };
  }
  async period(id: number) {
    const r = this.periodRows.find((x) => x.id === id);
    return r ? this.copy(r) : null;
  }
  async periods(operationId: number) {
    return this.periodRows.filter((x) => x.operationId === operationId).sort((a, b) => b.period.localeCompare(a.period)).map(this.copy);
  }
  async updatePeriod(id: number, expectedVersion: number, patch: PeriodPatch, now: number) {
    const r = this.periodRows.find((x) => x.id === id);
    if (!r) throw new ExternalError("not_found", "Periodo no encontrado");
    if (r.version !== expectedVersion) throw new ExternalError("conflict", "El periodo cambió mientras tanto: vuelve a intentarlo");
    if (patch.chargeId && this.periodRows.some((x) => x.id !== id && x.chargeId === patch.chargeId)) throw new ExternalError("conflict", "El cargo ya pertenece a otro periodo");
    Object.assign(r, structuredClone(patch), { version: r.version + 1, updatedAt: now });
    return this.copy(r);
  }
  async event(e: Omit<OpEvent, "id">) {
    if (e.ref && this.eventRows.some((x) => x.operationId === e.operationId && x.kind === e.kind && x.ref === e.ref)) return { created: false };
    this.eventRows.push({ ...structuredClone(e), id: ++this.seq });
    return { created: true };
  }
  async events(operationId: number) {
    return this.eventRows.filter((x) => x.operationId === operationId).sort((a, b) => a.at - b.at || a.id - b.id).map(this.copy);
  }
}

// ── Cálculo (puro) ───────────────────────────────────────────────────────────

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CENTS = 100_000_000;

export const CATEGORY_LABEL: Record<LineCategory, string> = { service: "Servicio", server: "Servidor", railway: "Railway", storage: "Almacenamiento", domain: "Dominio", ai_tokens: "Tokens de IA", other: "Otros" };

/** Problemas de las líneas de una operación (vacío si son válidas). */
export function lineProblems(kind: OpKind, lines: OpLine[]): string[] {
  const p: string[] = [];
  if (!Array.isArray(lines) || !lines.length || lines.length > 40) return ["Indica entre 1 y 40 conceptos"];
  const keys = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const n = `Concepto ${i + 1}`;
    if (!l || !KEY_RE.test(l.key ?? "")) p.push(`${n}: clave no válida`);
    else if (keys.has(l.key)) p.push(`${n}: clave repetida`);
    else keys.add(l.key);
    const concept = String(l?.concept ?? "").trim();
    if (concept.length < 3 || concept.length > 200) p.push(`${n}: el concepto debe tener entre 3 y 200 caracteres`);
    if (!LINE_CATEGORIES.includes(l?.category)) p.push(`${n}: categoría no válida`);
    if (l?.pricing === "fixed") {
      const q = l.quantity ?? 1;
      if (!Number.isInteger(q) || q < 1 || q > 100_000) p.push(`${n}: cantidad no válida`);
      if (!Number.isInteger(l.unitCents) || (l.unitCents ?? 0) <= 0 || (l.unitCents ?? 0) > MAX_CENTS) p.push(`${n}: precio no válido`);
      if (l.provider !== undefined || l.marginBp !== undefined || l.marginCents !== undefined || (l.capCents !== undefined && l.capCents !== null)) p.push(`${n}: un concepto fijo no lleva proveedor, margen ni límite`);
    } else if (l?.pricing === "variable") {
      if (kind === "one_off") p.push(`${n}: un cobro único solo lleva conceptos fijos`);
      if (!String(l.provider ?? "").trim() || String(l.provider).length > 80) p.push(`${n}: indica el proveedor`);
      if (l.marginBp !== undefined && l.marginCents !== undefined) p.push(`${n}: el margen es un porcentaje o un importe, no los dos`);
      if (l.marginBp !== undefined && (!Number.isInteger(l.marginBp) || l.marginBp < 0 || l.marginBp > 10_000)) p.push(`${n}: margen (%) no válido`);
      if (l.marginCents !== undefined && (!Number.isInteger(l.marginCents) || l.marginCents < 0 || l.marginCents > MAX_CENTS)) p.push(`${n}: margen (importe) no válido`);
      if (l.capCents !== undefined && l.capCents !== null && (!Number.isInteger(l.capCents) || l.capCents <= 0 || l.capCents > MAX_CENTS)) p.push(`${n}: límite de consumo no válido`);
      if (l.quantity !== undefined || l.unitCents !== undefined) p.push(`${n}: un concepto variable se calcula con el consumo (sin cantidad ni precio)`);
    } else p.push(`${n}: tipo de precio no válido`);
  }
  return p;
}

/** Línea normalizada (sin campos sobrantes). */
function cleanLine(l: OpLine): OpLine {
  const base = { key: l.key, concept: l.concept.trim(), category: l.category, pricing: l.pricing };
  if (l.pricing === "fixed") return { ...base, quantity: l.quantity ?? 1, unitCents: l.unitCents };
  return { ...base, provider: String(l.provider).trim(), ...(l.marginBp !== undefined ? { marginBp: l.marginBp } : {}), ...(l.marginCents !== undefined ? { marginCents: l.marginCents } : {}), capCents: l.capCents ?? null };
}

export interface PeriodCalc {
  lines: PeriodLine[];
  baseCents: number;
  adjustmentCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  overCap: boolean;
  missingUsage: string[];
}

/**
 * Importes de un periodo. Fijos: cantidad × precio. Variables: coste + margen; por encima del límite de consumo se
 * factura el límite salvo exceso autorizado. Los ajustes de línea (con motivo) sustituyen el importe calculado. Sobre la
 * base se aplica el ajuste comercial de la operación; el IVA va sobre la base neta (como en la factura y en Stripe).
 */
export function computePeriod(
  op: Pick<ExternalOperation, "lines" | "adjustment" | "taxRateBp" | "capCents">,
  usage: Record<string, number> | null,
  o: { overrides?: Record<string, { amountCents: number; reason: string; by: string }>; overCapAuthorized?: boolean } = {},
): PeriodCalc {
  const missingUsage: string[] = [];
  let overCap = false;
  const lines: PeriodLine[] = op.lines.map((l) => {
    let out: PeriodLine;
    if (l.pricing === "fixed") {
      const q = l.quantity ?? 1;
      out = { key: l.key, concept: l.concept, category: l.category, quantity: q, unitCents: l.unitCents ?? 0, amountCents: q * (l.unitCents ?? 0) };
    } else {
      const cost = usage?.[l.key];
      if (cost === undefined) missingUsage.push(l.key);
      const real = variableAmount({ costCents: cost ?? 0, ...(l.marginBp !== undefined ? { marginBp: l.marginBp } : {}), ...(l.marginCents !== undefined ? { marginCents: l.marginCents } : {}) });
      const over = l.capCents != null && real > l.capCents;
      if (over) overCap = true;
      const amount = over && !o.overCapAuthorized ? l.capCents! : real;
      out = { key: l.key, concept: `${l.concept} (${l.provider})`, category: l.category, quantity: 1, unitCents: amount, amountCents: amount, costCents: cost ?? 0, ...(over && !o.overCapAuthorized ? { capped: true } : {}) };
    }
    const ov = o.overrides?.[l.key];
    if (ov && ov.amountCents !== out.amountCents) out = { ...out, quantity: 1, unitCents: ov.amountCents, amountCents: ov.amountCents, adjusted: { fromCents: out.amountCents, reason: ov.reason, by: ov.by } };
    return out;
  });
  const baseCents = lines.reduce((a, l) => a + l.amountCents, 0);
  if (op.capCents != null && baseCents > op.capCents) overCap = true;
  const adj = adjustmentCents(baseCents, op.adjustment);
  const netCents = baseCents + adj;
  const taxCents = taxOf(netCents, op.taxRateBp);
  return { lines, baseCents, adjustmentCents: adj, netCents, taxCents, totalCents: netCents + taxCents, overCap, missingUsage };
}

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const madridToday = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const periodLabel = (period: string) => (period === "unico" ? null : new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T12:00:00Z`)));

// ── Estados que ve el CRM ────────────────────────────────────────────────────

export type DisplayState = "draft" | "pending" | "active" | "overdue" | "failed" | "canceled";
export type PaymentState = "none" | "pending" | "paid" | "overdue" | "failed";

/** Estado de cobro de un periodo, leído de la factura de su cargo (la confirma el webhook de Stripe). */
export function paymentState(p: Pick<OpPeriod, "status" | "dueDate">, inv: Pick<Invoice, "paymentStatus"> | null, today: string): PaymentState {
  if (p.status !== "issued" || !inv) return "none";
  if (inv.paymentStatus === "paid" || inv.paymentStatus === "refunded") return "paid";
  if (inv.paymentStatus === "failed") return "failed";
  return p.dueDate < today ? "overdue" : "pending";
}

export function displayOf(op: Pick<ExternalOperation, "kind" | "status">, states: Array<{ status: OpPeriod["status"]; payment: PaymentState; sentAt: number | null }>): { state: DisplayState; label: string } {
  if (op.status === "draft") return { state: "draft", label: "Borrador" };
  if (op.status === "canceled") return { state: "canceled", label: "Cancelado" };
  const issued = states.filter((s) => s.status === "issued");
  if (issued.some((s) => s.payment === "failed")) return { state: "failed", label: "Cobro fallido" };
  if (issued.some((s) => s.payment === "overdue")) return { state: "overdue", label: "Vencido" };
  const pending = issued.filter((s) => s.payment === "pending");
  if (pending.length) return { state: "pending", label: pending.some((s) => !s.sentAt) ? "Emitido, pendiente de enviar" : "Pendiente de pago" };
  if (op.kind === "one_off") return issued.length ? { state: "active", label: "Pagado" } : { state: "pending", label: "Pendiente de emitir" };
  return { state: "active", label: "Activo" };
}

// ── Servicio ─────────────────────────────────────────────────────────────────

export interface PaymentRequestMail {
  companyName: string;
  recipientName: string | null;
  title: string;
  periodLabel: string | null;
  lines: Array<{ label: string; cents: number }>;
  adjustment: { label: string; cents: number } | null;
  baseCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  dueAt: number;
  invoiceNumber: string | null;
  url: string;
}
export interface OperationsMail {
  /** Nota de cobro con el enlace de pago (idempotente por clave). */
  paymentRequest(to: string, idempotencyKey: string, i: PaymentRequestMail): Promise<{ status: string; reason: string | null; id?: number | null }>;
}

export interface OperationsDeps {
  store: OperationStore;
  company(id: number): Promise<{ id: number; name: string; legalName?: string | null; tenantId?: string | null; billingEmail?: string | null; email?: string | null } | null>;
  charges: Pick<ChargeService, "create" | "approve" | "must">;
  invoices: { get(id: number): Promise<Invoice | null> };
  payments?: Pick<ChargePaymentService, "paymentLink" | "recordOffline">;
  mail?: OperationsMail;
  namespace: string;
  now?: () => number;
}

export interface OperationInput {
  title: string;
  taxRateBp: number;
  lines: OpLine[];
  adjustment?: Adjustment | null;
  dueDate?: string | null;
  billingDay?: number | null;
  dueDays?: number | null;
  startPeriod?: string | null;
  capCents?: number | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  notes?: string | null;
}

export class ExternalOperationsService {
  private now: () => number;
  constructor(private d: OperationsDeps) {
    this.now = d.now ?? Date.now;
  }

  private async must(id: number) {
    const o = await this.d.store.get(id);
    if (!o) throw new ExternalError("not_found", "Operación no encontrada");
    return o;
  }
  private async mustPeriod(o: ExternalOperation, pid: number) {
    const p = await this.d.store.period(pid);
    if (!p || p.operationId !== o.id) throw new ExternalError("not_found", "Periodo no encontrado");
    return p;
  }
  private event(o: { id: number }, kind: string, ref: string | null, detail: Record<string, unknown> | null, actor: string) {
    return this.d.store.event({ operationId: o.id, kind, ref, detail, actor, at: this.now() });
  }

  /** Valida y normaliza los datos de una operación (alta o edición del borrador). */
  private fields(kind: OpKind, i: OperationInput, actor: string, canAuthorize: boolean, keep?: Adjustment | null) {
    const title = String(i.title ?? "").trim();
    if (title.length < 3 || title.length > 200) throw new ExternalError("invalid_input", "El título debe tener entre 3 y 200 caracteres");
    if (!Number.isInteger(i.taxRateBp) || i.taxRateBp < 0 || i.taxRateBp > 2700) throw new ExternalError("invalid_input", "IVA no válido");
    const problems = lineProblems(kind, i.lines);
    if (problems.length) throw new ExternalError("invalid_input", problems.slice(0, 5).join("; "));
    const lines = i.lines.map(cleanLine);
    const adj = i.adjustment ?? null;
    const same = !!adj && !!keep && JSON.stringify(cleanAdjustment(adj, "")) === JSON.stringify(cleanAdjustment(keep, ""));
    if (adj && !canAuthorize && !same) throw new ExternalError("forbidden", "Un descuento o recargo comercial requiere la autorización de un administrador (orders:approve)");
    const fixedBase = lines.reduce((a, l) => a + (l.pricing === "fixed" ? (l.quantity ?? 1) * (l.unitCents ?? 0) : 0), 0);
    // En infraestructura lo variable aún no se conoce: el importe positivo se comprueba al emitir cada periodo
    const problem = adjustmentProblem(kind === "one_off" ? fixedBase : 1_000_000_000, adj);
    if (problem) throw new ExternalError("invalid_input", problem);
    const email = i.recipientEmail ? String(i.recipientEmail).trim().toLowerCase() : null;
    if (email && (!EMAIL_RE.test(email) || email.length > 254)) throw new ExternalError("invalid_input", "Correo del destinatario no válido");
    const name = i.recipientName ? String(i.recipientName).trim().slice(0, 160) || null : null;
    const notes = i.notes ? String(i.notes).trim().slice(0, 2000) || null : null;
    const out = { title, currency: "EUR", taxRateBp: i.taxRateBp, lines, adjustment: adj ? (same ? keep! : cleanAdjustment(adj, actor)) : null, recipientName: name, recipientEmail: email, notes, dueDate: null as string | null, billingDay: null as number | null, dueDays: null as number | null, startPeriod: null as string | null, capCents: null as number | null };
    if (kind === "one_off") {
      if (!YMD.test(i.dueDate ?? "")) throw new ExternalError("invalid_input", "Indica el vencimiento (AAAA-MM-DD)");
      if (i.dueDate! < madridToday(this.now())) throw new ExternalError("invalid_input", "El vencimiento ya ha pasado");
      out.dueDate = i.dueDate!;
    } else {
      const day = i.billingDay ?? 1;
      if (!Number.isInteger(day) || day < 1 || day > 28) throw new ExternalError("invalid_input", "El día de emisión debe estar entre el 1 y el 28");
      const dueDays = i.dueDays ?? 10;
      if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 60) throw new ExternalError("invalid_input", "Los días para pagar deben estar entre 0 y 60");
      if (!YM.test(i.startPeriod ?? "")) throw new ExternalError("invalid_input", "Indica el primer periodo (AAAA-MM)");
      if (i.capCents != null && (!Number.isInteger(i.capCents) || i.capCents <= 0 || i.capCents > MAX_CENTS)) throw new ExternalError("invalid_input", "Límite total no válido");
      Object.assign(out, { billingDay: day, dueDays, startPeriod: i.startPeriod!, capCents: i.capCents ?? null });
    }
    return out;
  }

  async create(input: OperationInput & { companyId: number; kind: OpKind }, actor: string, opts: { canAuthorize?: boolean } = {}) {
    if (input.kind !== "one_off" && input.kind !== "infrastructure") throw new ExternalError("invalid_input", "Modalidad no válida");
    const company = await this.d.company(input.companyId);
    if (!company) throw new ExternalError("not_found", "Empresa no encontrada");
    if (company.tenantId) throw new ExternalError("invalid_state", "La empresa ya es cliente de Elephant Core: sus servicios se contratan desde Contrataciones");
    const f = this.fields(input.kind, input, actor, opts.canAuthorize === true);
    const now = this.now();
    const o = await this.d.store.insert({ companyId: company.id, kind: input.kind, status: "draft", ...f, createdBy: actor, createdAt: now });
    await this.event(o, "created", null, { kind: o.kind, lines: o.lines.length, taxRateBp: o.taxRateBp }, actor);
    if (o.adjustment) await this.event(o, "adjustment_authorized", `v${o.version}`, { ...o.adjustment }, actor);
    if (o.kind === "one_off") await this.preparePeriod(o, "unico", null, actor);
    return this.view(o);
  }

  async update(id: number, input: OperationInput, actor: string, opts: { canAuthorize?: boolean } = {}) {
    const o = await this.must(id);
    if (o.status !== "draft") throw new ExternalError("invalid_state", "Solo se edita una operación en borrador");
    // Sin el campo, el ajuste vigente se conserva (null lo quita)
    const f = this.fields(o.kind, input.adjustment === undefined ? { ...input, adjustment: o.adjustment } : input, actor, opts.canAuthorize === true, o.adjustment);
    const cur = await this.d.store.update(o.id, o.version, f, this.now());
    await this.event(cur, "updated", `v${cur.version}`, { lines: cur.lines.length, taxRateBp: cur.taxRateBp }, actor);
    if (cur.adjustment && JSON.stringify(cur.adjustment) !== JSON.stringify(o.adjustment)) await this.event(cur, "adjustment_authorized", `v${cur.version}`, { ...cur.adjustment }, actor);
    // El periodo único en borrador se recalcula con los datos nuevos
    if (cur.kind === "one_off") {
      const p = (await this.d.store.periods(cur.id)).find((x) => x.period === "unico");
      if (p && p.status === "draft") await this.recalc(cur, p, actor, {});
    }
    return this.view(cur);
  }

  /** Infraestructura: del borrador a activa (se pueden preparar periodos). */
  async activate(id: number, actor: string) {
    const o = await this.must(id);
    if (o.kind !== "infrastructure") throw new ExternalError("invalid_state", "Solo la infraestructura recurrente se activa; un cobro único se emite");
    if (o.status !== "draft") throw new ExternalError("invalid_state", o.status === "active" ? "La operación ya está activa" : "La operación está cancelada");
    const cur = await this.d.store.update(o.id, o.version, { status: "active" }, this.now());
    await this.event(cur, "activated", null, null, actor);
    return this.view(cur);
  }

  /** Cancela: lo no emitido se anula; lo emitido sigue su curso (se corrige con rectificativa en Facturación). */
  async cancel(id: number, reason: string, actor: string) {
    const o = await this.must(id);
    if (o.status === "canceled") throw new ExternalError("invalid_state", "La operación ya está cancelada");
    const why = String(reason ?? "").trim();
    if (why.length < 5 || why.length > 300) throw new ExternalError("invalid_input", "Indica el motivo de la cancelación (5 a 300 caracteres)");
    const periods = await this.d.store.periods(o.id);
    if (o.kind === "one_off" && periods.some((p) => p.status === "issued")) throw new ExternalError("invalid_state", "La nota de cobro ya está emitida y tiene factura: se corrige con una rectificativa en Facturación");
    const now = this.now();
    for (const p of periods) if (p.status === "draft") await this.d.store.updatePeriod(p.id, p.version, { status: "canceled" }, now);
    const cur = await this.d.store.update(o.id, o.version, { status: "canceled" }, now);
    await this.event(cur, "canceled", null, { reason: why, from: o.status }, actor);
    return this.view(cur);
  }

  private dueFor(o: ExternalOperation, period: string) {
    if (o.kind === "one_off") return o.dueDate!;
    return addDays(`${period}-${String(o.billingDay ?? 1).padStart(2, "0")}`, o.dueDays ?? 10);
  }

  private overrides(p: OpPeriod | null) {
    const out: Record<string, { amountCents: number; reason: string; by: string }> = {};
    for (const l of p?.lines ?? []) if (l.adjusted) out[l.key] = { amountCents: l.amountCents, reason: l.adjusted.reason, by: l.adjusted.by };
    return out;
  }

  private async recalc(o: ExternalOperation, p: OpPeriod, actor: string, change: { usage?: Record<string, number> | null; overrides?: Record<string, { amountCents: number; reason: string; by: string }>; overCapAuthorized?: OpPeriod["overCapAuthorized"] }) {
    const usage = change.usage !== undefined ? change.usage : p.usage;
    const authorized = change.overCapAuthorized !== undefined ? change.overCapAuthorized : p.overCapAuthorized;
    const c = computePeriod(o, usage, { overrides: change.overrides ?? this.overrides(p), overCapAuthorized: !!authorized });
    return this.d.store.updatePeriod(p.id, p.version, { lines: c.lines, usage, baseCents: c.baseCents, adjustmentCents: c.adjustmentCents, netCents: c.netCents, taxCents: c.taxCents, totalCents: c.totalCents, overCap: c.overCap, overCapAuthorized: authorized ?? null, dueDate: this.dueFor(o, p.period) }, this.now());
  }

  private async preparePeriod(o: ExternalOperation, period: string, usage: Record<string, number> | null, actor: string) {
    const c = computePeriod(o, usage);
    const now = this.now();
    const r = await this.d.store.insertPeriod({ operationId: o.id, period, status: "draft", lines: c.lines, usage, baseCents: c.baseCents, adjustmentCents: c.adjustmentCents, netCents: c.netCents, taxCents: c.taxCents, totalCents: c.totalCents, dueDate: this.dueFor(o, period), overCap: c.overCap, overCapAuthorized: null, chargeId: null, invoiceId: null, sentAt: null, sentTo: null, createdBy: actor, createdAt: now });
    if (r.created) await this.event(o, "period_prepared", period, { netCents: c.netCents, overCap: c.overCap }, actor);
    return r;
  }

  private usageOf(o: ExternalOperation, usage: Record<string, number> | undefined | null) {
    if (!usage) return null;
    const variable = new Set(o.lines.filter((l) => l.pricing === "variable").map((l) => l.key));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(usage)) {
      if (!variable.has(k)) throw new ExternalError("invalid_input", `«${k}» no es un concepto variable de esta operación`);
      if (!Number.isInteger(v) || v < 0 || v > MAX_CENTS) throw new ExternalError("invalid_input", "Consumo no válido (céntimos de coste del proveedor)");
      out[k] = v;
    }
    return out;
  }

  /** Infraestructura activa: prepara el periodo «AAAA-MM» en borrador (idempotente: repetir devuelve el mismo). */
  async period(id: number, input: { period: string; usage?: Record<string, number> | null }, actor: string) {
    const o = await this.must(id);
    if (o.kind !== "infrastructure") throw new ExternalError("invalid_state", "Un cobro único tiene un solo periodo");
    if (o.status !== "active") throw new ExternalError("invalid_state", o.status === "draft" ? "Activa primero la operación" : "La operación está cancelada");
    if (!YM.test(input.period ?? "")) throw new ExternalError("invalid_input", "Periodo no válido (AAAA-MM)");
    if (input.period < o.startPeriod!) throw new ExternalError("invalid_input", `El primer periodo de esta operación es ${o.startPeriod}`);
    const { period } = await this.preparePeriod(o, input.period, this.usageOf(o, input.usage), actor);
    return this.periodView(o, period);
  }

  /** Borrador del periodo: consumo, ajustes de línea (con motivo) y autorización del exceso de límite. */
  async updatePeriod(id: number, pid: number, input: { usage?: Record<string, number> | null; adjustments?: Array<{ key: string; amountCents: number; reason: string }>; authorizeOverCap?: { reason: string } }, actor: string, opts: { canAuthorize?: boolean } = {}) {
    const o = await this.must(id);
    const p = await this.mustPeriod(o, pid);
    if (p.status !== "draft") throw new ExternalError("invalid_state", "El periodo ya está emitido: se corrige con una rectificativa en Facturación");
    if ((input.adjustments?.length || input.authorizeOverCap) && !opts.canAuthorize) throw new ExternalError("forbidden", "Ajustar importes o autorizar un exceso requiere la autorización de un administrador (orders:approve)");
    const overrides = this.overrides(p);
    for (const a of input.adjustments ?? []) {
      const line = p.lines.find((l) => l.key === a.key);
      if (!line) throw new ExternalError("invalid_input", `No hay ningún concepto «${a.key}» en este periodo`);
      if (!Number.isInteger(a.amountCents) || a.amountCents < 0 || a.amountCents > MAX_CENTS) throw new ExternalError("invalid_input", "Importe ajustado no válido");
      const reason = String(a.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 300) throw new ExternalError("invalid_input", "Indica el motivo del ajuste (5 a 300 caracteres)");
      overrides[a.key] = { amountCents: a.amountCents, reason, by: actor };
    }
    let authorized: OpPeriod["overCapAuthorized"] | undefined;
    if (input.authorizeOverCap) {
      const reason = String(input.authorizeOverCap.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 300) throw new ExternalError("invalid_input", "Indica el motivo de la autorización (5 a 300 caracteres)");
      authorized = { reason, by: actor, at: this.now() };
    }
    const cur = await this.recalc(o, p, actor, { ...(input.usage !== undefined ? { usage: this.usageOf(o, input.usage) } : {}), overrides, ...(authorized ? { overCapAuthorized: authorized } : {}) });
    // Trazabilidad: cada ajuste con su importe anterior y posterior, y la autorización del exceso
    for (const a of input.adjustments ?? []) {
      const before = p.lines.find((l) => l.key === a.key)!;
      await this.event(o, "line_adjusted", null, { period: p.period, key: a.key, fromCents: before.adjusted?.fromCents ?? before.amountCents, previousCents: before.amountCents, toCents: a.amountCents, reason: overrides[a.key].reason }, actor);
    }
    if (authorized) await this.event(o, "over_cap_authorized", null, { period: p.period, reason: authorized.reason, baseCents: cur.baseCents }, actor);
    if (input.usage !== undefined) await this.event(o, "usage_recorded", null, { period: p.period, usage: cur.usage }, actor);
    return this.periodView(o, cur);
  }

  /** Emite el periodo: cargo extraordinario con desglose y su factura (idempotente por operación y periodo). */
  async issue(id: number, pid: number, actor: string) {
    const o = await this.must(id);
    if (o.status === "canceled") throw new ExternalError("invalid_state", "La operación está cancelada");
    if (o.kind === "infrastructure" && o.status !== "active") throw new ExternalError("invalid_state", "Activa primero la operación");
    let p = await this.mustPeriod(o, pid);
    if (p.status === "canceled") throw new ExternalError("invalid_state", "El periodo está anulado");
    if (p.status === "draft") {
      // Siempre con los datos vigentes de la operación (un borrador editado no se emite con importes viejos)
      p = await this.recalc(o, p, actor, {});
      const c = computePeriod(o, p.usage, { overrides: this.overrides(p), overCapAuthorized: !!p.overCapAuthorized });
      if (c.missingUsage.length) throw new ExternalError("invalid_input", `Falta el consumo de: ${c.missingUsage.join(", ")}`);
      if (o.capCents != null && c.baseCents > o.capCents && !p.overCapAuthorized) throw new ExternalError("invalid_state", "El periodo supera el límite total pactado: ajusta los importes o autoriza el exceso");
      if (c.netCents <= 0) throw new ExternalError("invalid_input", "El periodo no tiene importe que cobrar");
      const lines = [
        ...c.lines.filter((l) => l.amountCents > 0).map((l) => (l.quantity > 1 ? { concept: l.concept, quantity: l.quantity, unitCents: l.unitCents } : { concept: l.concept, quantity: 1, unitCents: l.amountCents })),
        ...(c.adjustmentCents ? [{ concept: `${o.adjustment ? adjustmentText(o.adjustment, o.currency) : "Ajuste comercial"}`.replace(/^./, (m) => m.toUpperCase()), quantity: 1, unitCents: c.adjustmentCents }] : []),
      ];
      const label = periodLabel(p.period);
      const { charge } = await this.d.charges.create(
        {
          idempotencyKey: `ext-op:${this.d.namespace}:${o.id}:${p.period}`,
          companyId: o.companyId,
          kind: "extraordinary",
          concept: `${o.title}${label ? ` — ${label}` : ""}`.slice(0, 200),
          amountCents: c.netCents,
          taxRateBp: o.taxRateBp,
          dueDate: madridToday(this.now()),
          method: "payment_link",
          agreementRef: `nota de cobro, vence el ${p.dueDate.split("-").reverse().join("/")}`,
          billingRef: `external-op:${o.id}:${p.period}`,
          detail: { lines },
        },
        actor,
      ).catch(rethrow);
      const { invoice } = await this.d.charges.approve(charge.id, actor).catch(rethrow);
      p = await this.d.store.updatePeriod(p.id, p.version, { status: "issued", chargeId: charge.id, invoiceId: invoice.id }, this.now());
      await this.event(o, "issued", p.period, { chargeId: charge.id, invoiceId: invoice.id, netCents: c.netCents, totalCents: invoice.totalCents }, actor);
      if (o.kind === "one_off" && o.status === "draft") await this.d.store.update(o.id, o.version, { status: "active" }, this.now());
    }
    return this.periodView(await this.must(o.id), p);
  }

  private issued(p: OpPeriod) {
    if (p.status !== "issued" || !p.chargeId) throw new ExternalError("invalid_state", "Emite primero la nota de cobro");
    if (!this.d.payments) throw new ExternalError("unavailable", "Los cobros de cargos no están disponibles en este entorno");
    return { chargeId: p.chargeId, payments: this.d.payments };
  }

  /** Enlace de pago de Stripe del periodo emitido (reutiliza el abierto). */
  async paymentLink(id: number, pid: number, actor: string) {
    const o = await this.must(id);
    const p = await this.mustPeriod(o, pid);
    const { chargeId, payments } = this.issued(p);
    const link = await payments.paymentLink(chargeId, actor).catch(rethrow);
    if (!link.reused) await this.event(o, "payment_link", link.sessionId, { period: p.period, url: link.url, expiresAt: link.expiresAt, totalCents: link.totalCents }, actor);
    return { url: link.url, expiresAt: link.expiresAt, totalCents: link.totalCents, reused: link.reused };
  }

  /** Envía al cliente la nota de cobro con el enlace de pago (un correo por enlace y destinatario). */
  async send(id: number, pid: number, input: { to?: string | null }, actor: string) {
    const o = await this.must(id);
    const p = await this.mustPeriod(o, pid);
    this.issued(p);
    const company = await this.d.company(o.companyId);
    const to = String(input.to ?? o.recipientEmail ?? company?.billingEmail ?? company?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(to) || to.length > 254) throw new ExternalError("invalid_input", "Indica el correo del destinatario");
    if (!this.d.mail) throw new ExternalError("unavailable", "El correo de plataforma no está configurado en este entorno");
    const link = await this.paymentLink(id, pid, actor);
    const inv = p.invoiceId ? await this.d.invoices.get(p.invoiceId) : null;
    let mail: { status: string; reason: string | null; outboxId?: number };
    try {
      const r = await this.d.mail.paymentRequest(to, `ext-op-request:${this.d.namespace}:${p.id}:${link.expiresAt}:${to}`, {
        companyName: company?.legalName ?? company?.name ?? `Empresa #${o.companyId}`,
        recipientName: o.recipientName,
        title: o.title,
        periodLabel: periodLabel(p.period),
        lines: p.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.quantity > 1 ? `${l.concept} (${l.quantity} uds.)` : l.concept, cents: l.amountCents })),
        adjustment: p.adjustmentCents && o.adjustment ? { label: adjustmentText(o.adjustment, o.currency).replace(/^./, (m) => m.toUpperCase()), cents: p.adjustmentCents } : null,
        baseCents: p.netCents,
        taxRateBp: o.taxRateBp,
        taxCents: inv?.taxCents ?? p.taxCents,
        totalCents: inv?.totalCents ?? p.totalCents,
        currency: o.currency,
        dueAt: Date.parse(`${p.dueDate}T12:00:00Z`),
        invoiceNumber: inv?.number ?? null,
        url: link.url ?? "",
      });
      mail = { status: r.status, reason: r.reason, ...(r.id ? { outboxId: r.id } : {}) };
    } catch (e) {
      mail = { status: "failed", reason: (e instanceof Error ? e.message : "error").slice(0, 200) };
    }
    const ok = !["failed", "skipped", "suppressed"].includes(mail.status);
    let cur = p;
    if (ok) cur = await this.d.store.updatePeriod(p.id, p.version, { sentAt: this.now(), sentTo: to }, this.now());
    await this.event(o, "sent", null, { period: p.period, to, ...mail }, actor);
    return { period: await this.periodView(o, cur), mail: { status: mail.status, reason: mail.reason } };
  }

  /** Pago recibido fuera de Stripe (transferencia u otro medio), con su referencia. */
  async offlinePayment(id: number, pid: number, input: { reference: string; paidAt?: number | null }, actor: string) {
    const o = await this.must(id);
    const p = await this.mustPeriod(o, pid);
    const { chargeId, payments } = this.issued(p);
    await payments.recordOffline(chargeId, input, actor).catch(rethrow);
    await this.event(o, "paid_offline", p.period, { reference: String(input.reference).trim().slice(0, 120) }, actor);
    return this.periodView(o, p);
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  private async periodView(o: ExternalOperation, p: OpPeriod, events?: OpEvent[]) {
    const inv = p.invoiceId ? await this.d.invoices.get(p.invoiceId) : null;
    const today = madridToday(this.now());
    const state = paymentState(p, inv, today);
    const ev = events ?? (await this.d.store.events(o.id));
    const lastLink = ev.filter((e) => e.kind === "payment_link" && e.detail?.period === p.period).at(-1);
    const link = state === "pending" || state === "overdue" ? (lastLink && Number(lastLink.detail?.expiresAt) > this.now() ? { url: String(lastLink.detail!.url), expiresAt: Number(lastLink.detail!.expiresAt) } : null) : null;
    return { ...p, payment: { state, invoiceNumber: inv?.number ?? null, paidAt: state === "paid" ? (inv?.paidAt ?? null) : null, link, sentAt: p.sentAt, sentTo: p.sentTo } };
  }

  private async view(o: ExternalOperation) {
    const periods = await this.d.store.periods(o.id);
    const events = await this.d.store.events(o.id);
    const views = await Promise.all(periods.map((p) => this.periodView(o, p, events)));
    const one = o.kind === "one_off" ? periods[0] : null;
    const fixed = computePeriod({ ...o, lines: o.lines.filter((l) => l.pricing === "fixed") }, null);
    const t = one ?? fixed;
    return {
      operation: { ...o, display: displayOf(o, views.map((v) => ({ status: v.status, payment: v.payment.state, sentAt: v.sentAt }))), totals: { baseCents: t.baseCents, adjustmentCents: t.adjustmentCents, netCents: t.netCents, taxCents: t.taxCents, totalCents: t.totalCents } },
      periods: views,
      events,
    };
  }

  async list(f: { companyId?: number } = {}) {
    return Promise.all((await this.d.store.list(f)).map(async (o) => (await this.view(o)).operation));
  }

  async detail(id: number) {
    return this.view(await this.must(id));
  }
}

/** Errores de facturación y cobro, con el mismo código para el CRM. */
function rethrow(e: unknown): never {
  const code = (e as { code?: string })?.code;
  if (e instanceof Error && e.name === "InvoicingError" && code && ["not_found", "invalid_input", "invalid_state", "conflict", "unavailable"].includes(code)) throw new ExternalError(code as ExternalError["code"], e.message);
  throw e;
}
