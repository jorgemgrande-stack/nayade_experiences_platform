/**
 * Travel Net — casos de uso: expedientes y servicios con su margen, presupuesto y reserva del Core, operaciones con
 * cada proveedor (adaptador manual) y bonos por servicio.
 *
 * Reutilización del Core (nada de un segundo sistema):
 *  - Presupuesto: se crea un lead (`createLead`, como cualquier oportunidad del CRM) y su presupuesto con
 *    `crm.leads.convertToQuote` (misma validación fiscal y numeración); al rehacerlo, `crm.quotes.update`. El envío,
 *    el enlace de aceptación y el cobro son los del CRM (`crm.quotes.send`, enlace público, Redsys).
 *  - Reserva: `crm.quotes.convertToReservation` (idempotente: si el cliente ya pagó por el enlace, devuelve la reserva
 *    que creó el pago).
 *  - Proveedores: tabla `suppliers` del Core.
 *  - Bono: PDF con el maquetador de documentos del Core (`renderBrandPdf`) y los datos del emisor de la empresa.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import { createLead } from "../db";
import { renderBrandPdf } from "../documents/brandPdf";
import { captureIssuerSnapshot } from "../invoiceHtml";
import { resolveSupplierAdapter } from "./adapters";
import {
  DEFAULT_SLA_MS,
  OPERATION_BUCKETS,
  OPERATION_STATUS_LABEL,
  QUOTE_EDITABLE,
  VOUCHER_STATUSES,
  conversionBlocker,
  fileNumber,
  fileTotals,
  marginRuleError,
  operationTransitionError,
  priceService,
  quoteLines,
  resolveMarginRule,
  servicesEditBlocker,
  type MarginRule,
  type OperationBucket,
  type OperationStatus,
  type PricingMode,
} from "./rules";
import * as store from "./store";

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const notFound = (what: string): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: `${what} no encontrado` });
};

// ─── Expedientes ──────────────────────────────────────────────────────────────

export async function listFiles(f: { status?: string; search?: string; site?: { siteId: string; isPrimary: boolean } | null }) {
  return store.travel(async () => store.listFiles(await store.db(), f));
}

export async function createFile(input: store.FileInput, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const id = await store.insertFile(tx, input, userId);
    const number = fileNumber(id, new Date().getUTCFullYear());
    await store.updateFileFields(tx, id, { file_number: number });
    await store.audit(tx, "file", id, "created", userId, { fileNumber: number });
    return { id, fileNumber: number };
  }));
}

export async function updateFile(id: number, patch: Partial<store.FileInput>, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const f = (await store.getFile(tx, id, true)) ?? notFound("Expediente");
    if (f.status === "cancelado" || f.status === "cerrado") bad("El expediente ya no se puede cambiar.");
    const map: Record<string, string> = {
      title: "title", siteId: "site_id", clientName: "client_name", clientEmail: "client_email", clientPhone: "client_phone", startDate: "start_date",
      endDate: "end_date", adults: "adults", children: "children", fiscalRegime: "fiscal_regime", taxRateBp: "tax_rate_bp", notes: "notes",
    };
    const fields: Record<string, string | number | null> = {};
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v !== undefined) fields[col] = v as string | number | null;
    }
    // El régimen fiscal y el IVA ya presupuestados no cambian una vez reservado
    if (f.status === "reservado" && (fields.fiscal_regime !== undefined || fields.tax_rate_bp !== undefined)) bad("El expediente ya está reservado: su régimen fiscal no cambia.");
    await store.updateFileFields(tx, id, fields);
    await store.audit(tx, "file", id, "updated", userId, { fields: Object.keys(fields) });
    return { ok: true as const };
  }));
}

export async function cancelFile(id: number, reason: string, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const f = (await store.getFile(tx, id, true)) ?? notFound("Expediente");
    if (f.status === "cancelado") bad("El expediente ya está cancelado.");
    if (f.status === "reservado" || f.status === "cerrado") bad("El expediente está reservado: cancela antes la reserva y las operaciones con los proveedores.");
    await store.updateFileFields(tx, id, { status: "cancelado" });
    await store.audit(tx, "file", id, "cancelled", userId, { reason });
    return { ok: true as const };
  }));
}

export async function getFileDetail(id: number) {
  return store.travel(async () => {
    const d = await store.db();
    const f = (await store.getFile(d, id)) ?? notFound("Expediente");
    const [services, operations, quote] = await Promise.all([store.listServices(d, id), store.listOperations(d, { fileId: id }), store.quoteStatus(d, f.quoteId)]);
    const byService = new Map(operations.map((o) => [o.serviceId, o]));
    return {
      file: f,
      services: services.map((s) => ({ ...s, operation: byService.get(s.id) ?? null })),
      totals: fileTotals(services),
      quote,
      editBlocker: servicesEditBlocker(f.status, quote?.status ?? null),
      conversionBlocker: conversionBlocker({ status: f.status, quoteId: f.quoteId, services: services.length }, quote?.status ?? null),
    };
  });
}

// ─── Servicios ────────────────────────────────────────────────────────────────

export interface ServiceInput {
  kind: string;
  source: "proveedor" | "propio";
  supplierId: number | null;
  title: string;
  description: string | null;
  serviceDate: string | null;
  endDate: string | null;
  quantity: number;
  pricingMode: PricingMode;
  /** Neto (modo neto), PVP del proveedor (comisión) o PVP (manual). */
  amountCents: number;
  /** Coste en el modo manual. */
  netCents?: number;
  sortOrder?: number;
}

async function priced(exec: Pick<store.Exec, "execute">, file: store.TravelFile, s: ServiceInput): Promise<store.ServiceWrite> {
  if (s.source === "proveedor" && s.supplierId == null) bad("Elige el proveedor del servicio.");
  if (s.supplierId != null && !(await store.supplierExists(exec, s.supplierId))) bad("El proveedor no existe.");
  const mode: PricingMode = s.source === "propio" ? "manual" : s.pricingMode;
  const rule = resolveMarginRule(await store.listMarginRules(exec), { supplierId: s.source === "propio" ? null : s.supplierId, siteId: file.siteId });
  const p = priceService({ mode, amountCents: s.amountCents, netCents: s.netCents, rule });
  return {
    kind: s.kind, source: s.source, supplierId: s.source === "propio" ? null : s.supplierId, title: s.title.trim(), description: s.description?.trim() || null,
    serviceDate: s.serviceDate, endDate: s.endDate, quantity: Math.max(1, Math.trunc(s.quantity)), pricingMode: mode, netCents: p.netCents,
    sellingCents: p.sellingCents, markupBp: p.markupBp, commissionBp: p.commissionBp, ruleSource: p.ruleSource, sortOrder: s.sortOrder ?? 0,
  };
}

async function editableFile(tx: store.Exec, fileId: number) {
  const f = (await store.getFile(tx, fileId, true)) ?? notFound("Expediente");
  const q = await store.quoteStatus(tx, f.quoteId);
  const why = servicesEditBlocker(f.status, q?.status ?? null);
  if (why) bad(why);
  return f;
}

export async function addService(fileId: number, s: ServiceInput, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const f = await editableFile(tx, fileId);
    const id = await store.insertService(tx, fileId, await priced(tx, f, s));
    await store.audit(tx, "service", id, "created", userId, { fileId });
    return { id };
  }));
}

export async function updateServiceById(fileId: number, serviceId: number, s: ServiceInput, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const f = await editableFile(tx, fileId);
    if (!(await store.listServices(tx, fileId)).some((x) => x.id === serviceId)) notFound("Servicio");
    await store.updateService(tx, serviceId, await priced(tx, f, s));
    await store.audit(tx, "service", serviceId, "updated", userId, { fileId });
    return { ok: true as const };
  }));
}

export async function removeService(fileId: number, serviceId: number, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    await editableFile(tx, fileId);
    if (!(await store.listServices(tx, fileId)).some((x) => x.id === serviceId)) notFound("Servicio");
    await store.deleteService(tx, serviceId);
    await store.audit(tx, "service", serviceId, "deleted", userId, { fileId });
    return { ok: true as const };
  }));
}

/** Simulación del precio con las reglas vigentes (para el formulario). */
export async function simulatePrice(input: { supplierId: number | null; siteId: string | null; mode: PricingMode; amountCents: number; netCents?: number }) {
  return store.travel(async () => {
    const rule = resolveMarginRule(await store.listMarginRules(await store.db()), { supplierId: input.supplierId, siteId: input.siteId });
    return { rule, price: priceService({ mode: input.mode, amountCents: input.amountCents, netCents: input.netCents, rule }) };
  });
}

// ─── Presupuesto y reserva (CRM del Core) ─────────────────────────────────────

type CrmCaller = {
  leads: { convertToQuote(input: unknown): Promise<{ quoteId: number; quoteNumber: string }> };
  quotes: {
    update(input: unknown): Promise<unknown>;
    convertToReservation(input: { quoteId: number; notes?: string }): Promise<{ reservationId: number }>;
  };
};

async function crm(ctx: TrpcContext): Promise<CrmCaller> {
  const { crmRouter } = await import("../routers/crm");
  return crmRouter.createCaller(ctx) as unknown as CrmCaller;
}

/**
 * Genera (o rehace mientras no se haya aceptado) el presupuesto del Core del expediente: una línea por servicio con su
 * PVP; el coste y el margen nunca salen. El envío al cliente se hace después con el envío de presupuestos del CRM.
 */
export async function generateQuote(fileId: number, ctx: TrpcContext & { user: { id: number } }) {
  return store.travel(async () => {
    const d = await store.db();
    const f = (await store.getFile(d, fileId)) ?? notFound("Expediente");
    const q = await store.quoteStatus(d, f.quoteId);
    const why = servicesEditBlocker(f.status, q?.status ?? null);
    if (why) bad(why);
    const services = await store.listServices(d, fileId);
    const lines = quoteLines(services, { regime: f.fiscalRegime, taxRateBp: f.taxRateBp });
    if (!lines.length) bad("Añade al menos un servicio con precio antes de presupuestar.");
    const total = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
    const payload = {
      title: `${f.title}${f.fileNumber ? ` (${f.fileNumber})` : ""}`,
      description: [f.startDate && f.endDate ? `Del ${f.startDate} al ${f.endDate}` : null, `${f.adults} adulto${f.adults === 1 ? "" : "s"}${f.children ? ` y ${f.children} niño${f.children === 1 ? "" : "s"}` : ""}`].filter(Boolean).join(" · "),
      items: lines,
      subtotal: total,
      discount: 0,
      taxRate: f.fiscalRegime === "reav" ? 0 : f.taxRateBp / 100,
      total,
      pricesIncludeTax: true,
      activityDate: f.startDate,
      notes: f.notes ?? undefined,
    };
    const caller = await crm(ctx);
    if (f.quoteId && q && (QUOTE_EDITABLE as readonly string[]).includes(q.status)) {
      await caller.quotes.update({ id: f.quoteId, ...payload });
      await store.updateFileFields(d, fileId, { status: "presupuestado" });
      await store.audit(d, "file", fileId, "quote_updated", ctx.user.id, { quoteId: f.quoteId });
      return { quoteId: f.quoteId, quoteNumber: q.quoteNumber, updated: true };
    }
    let leadId = f.leadId;
    if (!leadId) {
      if (!f.clientEmail) bad("Indica el correo del cliente para presupuestar.");
      const lead = await createLead({
        name: f.clientName, email: f.clientEmail!, phone: f.clientPhone ?? undefined, source: "travel_net",
        message: `Expediente ${f.fileNumber ?? fileId}: ${f.title}`, numberOfAdults: f.adults, numberOfChildren: f.children,
        numberOfPersons: f.adults + f.children, preferredDate: f.startDate ?? undefined,
      });
      leadId = lead.id;
      await store.updateFileFields(d, fileId, { lead_id: leadId });
    }
    const created = await caller.leads.convertToQuote({ leadId, ...payload });
    await store.updateFileFields(d, fileId, { quote_id: created.quoteId, status: "presupuestado" });
    await store.audit(d, "file", fileId, "quote_created", ctx.user.id, { quoteId: created.quoteId, quoteNumber: created.quoteNumber });
    return { quoteId: created.quoteId, quoteNumber: created.quoteNumber, updated: false };
  });
}

/**
 * Acepta el presupuesto y lo convierte en reserva del Core (`crm.quotes.convertToReservation`, idempotente) y crea una
 * operación con el proveedor por cada servicio de proveedor (pendiente de envío). Dos peticiones a la vez no crean dos
 * reservas ni operaciones duplicadas (el expediente se bloquea y cada servicio tiene una operación como máximo).
 */
export async function convertToReservation(fileId: number, ctx: TrpcContext & { user: { id: number } }) {
  return store.travel(() => store.inTx(async (tx) => {
    // El expediente queda bloqueado durante toda la conversión: una segunda petición espera y ve el expediente reservado
    const f = (await store.getFile(tx, fileId, true)) ?? notFound("Expediente");
    if (f.status === "reservado" && f.reservationId) {
      return { reservationId: f.reservationId, operations: (await store.listOperations(tx, { fileId })).length, alreadyReserved: true };
    }
    const services = await store.listServices(tx, fileId);
    const why = conversionBlocker({ status: f.status, quoteId: f.quoteId, services: services.length }, (await store.quoteStatus(tx, f.quoteId))?.status ?? null);
    if (why) bad(why);
    // La reserva la crea el CRM (idempotente por presupuesto: si el cliente ya pagó por el enlace, devuelve esa)
    const { reservationId } = await (await crm(ctx)).quotes.convertToReservation({ quoteId: f.quoteId!, notes: `Travel Net · expediente ${f.fileNumber ?? fileId}` });
    for (const s of services) {
      if (s.source !== "proveedor") continue;
      await store.insertOperation(tx, { fileId, serviceId: s.id, reservationId, supplierId: s.supplierId });
    }
    await store.updateFileFields(tx, fileId, { status: "reservado", reservation_id: reservationId });
    await store.audit(tx, "file", fileId, "reserved", ctx.user.id, { reservationId });
    return { reservationId, operations: (await store.listOperations(tx, { fileId })).length, alreadyReserved: false };
  }));
}

// ─── Operaciones con proveedores ──────────────────────────────────────────────

export async function listOperations(bucket?: OperationBucket) {
  return store.travel(async () => store.listOperations(await store.db(), { statuses: bucket ? OPERATION_BUCKETS[bucket] : undefined }));
}

export async function operationDetail(id: number) {
  return store.travel(async () => {
    const d = await store.db();
    const op = (await store.getOperation(d, id)) ?? notFound("Operación");
    return { operation: op, history: await store.operationHistory(d, id) };
  });
}

/**
 * Envía la operación al proveedor. Si el servicio viene de Veturis y la empresa tiene la reserva ENCENDIDA, se reserva
 * en Veturis (fuera de la transacción: es una llamada de red) con revalidación previa del precio, y la operación queda
 * confirmada con su localizador. En cualquier otro caso, el adaptador manual de siempre (queda enviada con plazo).
 */
export async function submitOperation(id: number, userId: number) {
  const veturis = await store.travel(async () => {
    const d = await store.db();
    const op = (await store.getOperation(d, id)) ?? notFound("Operación");
    const why = operationTransitionError(op.status, "submitted");
    if (why) bad(why);
    const f = await store.getFile(d, op.fileId);
    const { bookForOperation } = await import("./veturis/service");
    return bookForOperation({ id: op.id, serviceId: op.serviceId }, { fileNumber: f?.fileNumber ?? null, clientName: f?.clientName ?? "", clientEmail: f?.clientEmail ?? null, clientPhone: f?.clientPhone ?? null });
  });
  return store.travel(() => store.inTx(async (tx) => {
    const op = (await store.getOperation(tx, id, true)) ?? notFound("Operación");
    const why = operationTransitionError(op.status, "submitted");
    if (why) bad(why);
    if (veturis) {
      await store.setOperationStatus(tx, op, "submitted", { locator: veturis.locator ?? undefined, slaDeadlineAt: Date.now() + DEFAULT_SLA_MS }, { userId, reason: veturis.note });
      if (veturis.status === "provider_confirmed") {
        await store.setOperationStatus(tx, { id: op.id, status: "submitted" }, "provider_confirmed", { locator: veturis.locator ?? undefined }, { userId, reason: veturis.note });
      }
      await store.audit(tx, "operation", id, "submitted", userId, { adapter: "api", provider: "veturis", status: veturis.status });
      return { ok: true as const, status: veturis.status, note: veturis.note };
    }
    const f = await store.getFile(tx, op.fileId);
    const [mode] = await store.rows<{ connection_mode: string }>(tx, sql`SELECT connection_mode FROM travel_supplier_profiles WHERE supplier_id = ${op.supplierId}`);
    const adapter = resolveSupplierAdapter(mode?.connection_mode ?? "manual");
    const res = await adapter.submitBooking({
      operationId: op.id, fileNumber: f?.fileNumber ?? null, serviceTitle: op.serviceTitle ?? "", serviceDate: op.serviceDate, endDate: null, quantity: 1,
      clientName: f?.clientName ?? "", adults: f?.adults ?? 0, children: f?.children ?? 0,
    });
    await store.setOperationStatus(tx, op, res.status, { locator: res.providerLocator ?? undefined, slaDeadlineAt: Date.now() + DEFAULT_SLA_MS }, { userId, reason: res.note });
    await store.audit(tx, "operation", id, "submitted", userId, { adapter: adapter.mode });
    return { ok: true as const, status: res.status, note: res.note };
  }));
}

export async function transitionOperation(input: { id: number; to: OperationStatus; locator?: string | null; reason?: string | null; userId: number }) {
  return store.travel(() => store.inTx(async (tx) => {
    const op = (await store.getOperation(tx, input.id, true)) ?? notFound("Operación");
    const locator = input.locator !== undefined ? input.locator?.trim() || null : op.providerLocator;
    const why = operationTransitionError(op.status, input.to, { locator });
    if (why) bad(why);
    await store.setOperationStatus(tx, op, input.to, { locator }, { userId: input.userId, reason: input.reason ?? null });
    await store.audit(tx, "operation", input.id, "status_changed", input.userId, { from: op.status, to: input.to });
    return { ok: true as const, status: input.to, label: OPERATION_STATUS_LABEL[input.to] };
  }));
}

export async function setOperationNotes(id: number, notes: string, userId: number) {
  return store.travel(async () => {
    const d = await store.db();
    (await store.getOperation(d, id)) ?? notFound("Operación");
    await d.execute(sql`UPDATE travel_operations SET internal_notes = ${notes.trim().slice(0, 4000) || null}, updated_at = ${Date.now()} WHERE id = ${id}`);
    await store.audit(d, "operation", id, "notes", userId);
    return { ok: true as const };
  });
}

// ─── Márgenes y proveedores ───────────────────────────────────────────────────

export async function listMarginRules() {
  return store.travel(async () => store.listMarginRules(await store.db()));
}

export async function saveMarginRule(rule: MarginRule, userId: number) {
  return store.travel(async () => {
    const why = marginRuleError(rule);
    if (why) bad(why);
    if (rule.scope === "global" && rule.scopeKey !== "") bad("La regla global no lleva clave.");
    if (rule.scope !== "global" && !rule.scopeKey) bad("Indica la sede o el proveedor de la regla.");
    const d = await store.db();
    if (rule.scope === "proveedor" && !(await store.supplierExists(d, Number(rule.scopeKey)))) bad("El proveedor no existe.");
    await store.upsertMarginRule(d, rule, userId);
    await store.audit(d, "margin_rule", 0, "saved", userId, { ...rule });
    return { ok: true as const };
  });
}

export async function listSuppliers() {
  return store.travel(async () => store.listSuppliers(await store.db()));
}

export async function createSupplier(input: { fiscalName: string; commercialName: string | null; nif: string | null; email: string | null; phone: string | null; contactPerson: string | null; connectionMode: string; serviceKinds: string[] }, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    const id = await store.insertSupplier(tx, input);
    await store.upsertSupplierProfile(tx, id, { connectionMode: input.connectionMode, serviceKinds: input.serviceKinds, operationalEmail: input.email, operationalPhone: input.phone, notes: null, isActive: true });
    await store.audit(tx, "supplier", id, "created", userId);
    return { id };
  }));
}

export async function saveSupplierProfile(supplierId: number, p: { connectionMode: string; serviceKinds: string[]; operationalEmail: string | null; operationalPhone: string | null; notes: string | null; isActive: boolean }, userId: number) {
  return store.travel(async () => {
    const d = await store.db();
    if (!(await store.supplierExists(d, supplierId))) notFound("Proveedor");
    await store.upsertSupplierProfile(d, supplierId, p);
    await store.audit(d, "supplier", supplierId, "profile_saved", userId);
    return { ok: true as const };
  });
}

export async function supplierContacts(supplierId: number) {
  return store.travel(async () => store.listContacts(await store.db(), supplierId));
}

export async function addSupplierContact(supplierId: number, c: { name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    if (!(await store.supplierExists(tx, supplierId))) notFound("Proveedor");
    const id = await store.insertContact(tx, supplierId, c);
    await store.audit(tx, "contact", id, "created", userId, { supplierId });
    return { id };
  }));
}

export async function removeSupplierContact(id: number, userId: number) {
  return store.travel(() => store.inTx(async (tx) => {
    await store.deleteContact(tx, id);
    await store.audit(tx, "contact", id, "deleted", userId);
    return { ok: true as const };
  }));
}

// ─── Bono por servicio ────────────────────────────────────────────────────────

/** Motivo por el que no se puede emitir el bono del servicio, o null. */
export function voucherBlocker(fileStatus: string, source: string, operationStatus: string | null): string | null {
  if (fileStatus !== "reservado" && fileStatus !== "cerrado") return "El bono se emite cuando el expediente está reservado.";
  if (source === "propio") return null;
  if (!operationStatus || !(VOUCHER_STATUSES as readonly string[]).includes(operationStatus)) return "El bono se emite cuando el proveedor confirma el servicio.";
  return null;
}

/** Bono (PDF) de un servicio confirmado: datos del viaje, del servicio y del proveedor, con el emisor de la empresa. */
export async function voucherPdf(fileId: number, serviceId: number) {
  return store.travel(async () => {
    const d = await store.db();
    const f = (await store.getFile(d, fileId)) ?? notFound("Expediente");
    const s = (await store.listServices(d, fileId)).find((x) => x.id === serviceId) ?? notFound("Servicio");
    const op = (await store.listOperations(d, { fileId })).find((o) => o.serviceId === serviceId) ?? null;
    const why = voucherBlocker(f.status, s.source, op?.status ?? null);
    if (why) bad(why);
    const issuer = await captureIssuerSnapshot();
    const contacts = s.supplierId ? await store.listContacts(d, s.supplierId) : [];
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
    const dates = s.serviceDate ? (s.endDate && s.endDate !== s.serviceDate ? `${s.serviceDate} → ${s.endDate}` : s.serviceDate) : "Según programa";
    const pdf = await renderBrandPdf({
      title: `Bono ${f.fileNumber ?? f.id}-${s.id}`,
      issuer: { legalName: issuer?.name ?? "", taxId: issuer?.cif ?? "", address: [issuer?.address, issuer?.zip, issuer?.city].filter(Boolean).join(", ") },
      logoPng: null,
      footerNote: `Expediente ${f.fileNumber ?? f.id} · bono ${s.id}`,
      blocks: [
        { kind: "title", text: "Bono de servicio", subtitle: s.title },
        { kind: "keyValue", rows: [
          ["Expediente", f.fileNumber ?? String(f.id)],
          ["Titular", f.clientName],
          ["Viajeros", `${f.adults} adulto${f.adults === 1 ? "" : "s"}${f.children ? ` · ${f.children} niño${f.children === 1 ? "" : "s"}` : ""}`],
          ["Servicio", s.title],
          ["Fechas", dates],
          ["Cantidad", String(s.quantity)],
          ["Proveedor", s.supplierName ?? (s.source === "propio" ? (issuer?.name ?? "") : "—")],
          ["Localizador", op?.providerLocator ?? "—"],
        ] },
        ...(s.description ? [{ kind: "paragraph" as const, text: s.description }] : []),
        ...(primary ? [{ kind: "box" as const, title: "Contacto del proveedor", lines: [primary.name, primary.phone, primary.email].filter((x): x is string => !!x) }] : []),
        { kind: "paragraph", text: "Presenta este bono al proveedor. Para cualquier cambio, contacta con la agencia.", muted: true },
      ],
    });
    return { fileName: `bono-${f.fileNumber ?? f.id}-${s.id}.pdf`, base64: Buffer.from(pdf).toString("base64") };
  });
}
