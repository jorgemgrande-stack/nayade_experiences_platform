/**
 * API tRPC de Travel Net (`travel.*`). Licencia: capacidad `travel-net` por `TRPC_ROUTER_CAPABILITIES` (en solo
 * lectura se consulta, no se opera). Expedientes, servicios, presupuesto, reserva, operaciones y bonos: el equipo
 * comercial (mismo permiso que el CRM: `crm.view`, admin y agente). Márgenes y proveedores: administración.
 */
import { z } from "zod";
import { adminProcedure, router, staffProcedure } from "../_core/trpc";
import { resolveSiteFilter, resolveSiteForWrite } from "../sitesDb";
import { CONNECTION_MODES } from "./adapters";
import { MARGIN_SCOPES, OPERATION_BUCKETS, OPERATION_STATUSES, PRICING_MODES, SERVICE_KINDS, SERVICE_SOURCES } from "./rules";
import * as svc from "./service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida (AAAA-MM-DD)");
const id = z.number().int().positive();
const optText = (max: number) => z.string().max(max).nullable().optional();

const fileFields = {
  title: z.string().trim().min(2).max(200),
  siteId: z.string().max(63).nullable().optional(),
  clientName: z.string().trim().min(2).max(200),
  clientEmail: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
  clientPhone: optText(50),
  startDate: day.nullable().optional(),
  endDate: day.nullable().optional(),
  adults: z.number().int().min(0).max(500).default(1),
  children: z.number().int().min(0).max(500).default(0),
  fiscalRegime: z.enum(["reav", "general"]).default("reav"),
  taxRateBp: z.number().int().min(0).max(3000).default(2100),
  notes: optText(4000),
};

const serviceFields = z.object({
  kind: z.enum(SERVICE_KINDS),
  source: z.enum(SERVICE_SOURCES),
  supplierId: id.nullable(),
  title: z.string().trim().min(2).max(200),
  description: optText(1000),
  serviceDate: day.nullable().optional(),
  endDate: day.nullable().optional(),
  quantity: z.number().int().min(1).max(999),
  pricingMode: z.enum(PRICING_MODES),
  amountCents: z.number().int().min(0).max(100_000_000),
  netCents: z.number().int().min(0).max(100_000_000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).refine((s) => !s.serviceDate || !s.endDate || s.endDate >= s.serviceDate, "La fecha de fin no puede ser anterior a la de inicio");

const toServiceInput = (s: z.infer<typeof serviceFields>): svc.ServiceInput => ({
  ...s, description: s.description ?? null, serviceDate: s.serviceDate ?? null, endDate: s.endDate ?? null,
});

export const travelRouter = router({
  // ── Expedientes ─────────────────────────────────────────────────────────
  listFiles: staffProcedure
    .input(z.object({ status: z.string().max(16).optional(), search: z.string().max(100).optional(), siteId: z.string().max(63).optional() }).optional())
    .query(async ({ input }) => {
      const site = await resolveSiteFilter(input?.siteId);
      return svc.listFiles({ status: input?.status, search: input?.search, site });
    }),

  getFile: staffProcedure.input(z.object({ id })).query(({ input }) => svc.getFileDetail(input.id)),

  createFile: staffProcedure
    .input(z.object(fileFields).refine((f) => !f.startDate || !f.endDate || f.endDate >= f.startDate, "La vuelta no puede ser anterior a la ida"))
    .mutation(async ({ input, ctx }) => svc.createFile({
      title: input.title, siteId: await resolveSiteForWrite(input.siteId), clientName: input.clientName, clientEmail: input.clientEmail || null,
      clientPhone: input.clientPhone ?? null, startDate: input.startDate ?? null, endDate: input.endDate ?? null, adults: input.adults, children: input.children,
      fiscalRegime: input.fiscalRegime, taxRateBp: input.taxRateBp, notes: input.notes ?? null,
    }, ctx.user.id)),

  updateFile: staffProcedure
    .input(z.object({ id, ...Object.fromEntries(Object.entries(fileFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) }))
    .mutation(async ({ input, ctx }) => {
      const { id: fileId, ...rest } = input as Record<string, unknown> & { id: number };
      if (rest.siteId !== undefined) rest.siteId = await resolveSiteForWrite(rest.siteId as string | null);
      if (rest.clientEmail === "") rest.clientEmail = null;
      return svc.updateFile(fileId, rest as Partial<import("./store").FileInput>, ctx.user.id);
    }),

  cancelFile: staffProcedure
    .input(z.object({ id, reason: z.string().trim().min(2).max(500) }))
    .mutation(({ input, ctx }) => svc.cancelFile(input.id, input.reason, ctx.user.id)),

  // ── Servicios ───────────────────────────────────────────────────────────
  addService: staffProcedure
    .input(z.object({ fileId: id, service: serviceFields }))
    .mutation(({ input, ctx }) => svc.addService(input.fileId, toServiceInput(input.service), ctx.user.id)),

  updateService: staffProcedure
    .input(z.object({ fileId: id, serviceId: id, service: serviceFields }))
    .mutation(({ input, ctx }) => svc.updateServiceById(input.fileId, input.serviceId, toServiceInput(input.service), ctx.user.id)),

  removeService: staffProcedure
    .input(z.object({ fileId: id, serviceId: id }))
    .mutation(({ input, ctx }) => svc.removeService(input.fileId, input.serviceId, ctx.user.id)),

  /** Precio con las reglas vigentes (el neto y el margen solo se ven en el panel). */
  simulatePrice: staffProcedure
    .input(z.object({ supplierId: id.nullable(), siteId: z.string().max(63).nullable(), mode: z.enum(PRICING_MODES), amountCents: z.number().int().min(0).max(100_000_000), netCents: z.number().int().min(0).optional() }))
    .query(({ input }) => svc.simulatePrice(input)),

  // ── Presupuesto y reserva (CRM del Core) ────────────────────────────────
  /** Crea o rehace el presupuesto del Core; se envía después con el envío de presupuestos del CRM. */
  generateQuote: staffProcedure.input(z.object({ id })).mutation(({ input, ctx }) => svc.generateQuote(input.id, ctx)),

  /** Convierte el presupuesto en reserva del Core y crea las operaciones con los proveedores. */
  convertToReservation: staffProcedure.input(z.object({ id })).mutation(({ input, ctx }) => svc.convertToReservation(input.id, ctx)),

  /** Bono (PDF en base64) de un servicio confirmado. */
  voucher: staffProcedure.input(z.object({ fileId: id, serviceId: id })).mutation(({ input }) => svc.voucherPdf(input.fileId, input.serviceId)),

  // ── Operaciones con proveedores ─────────────────────────────────────────
  listOperations: staffProcedure
    .input(z.object({ bucket: z.enum(Object.keys(OPERATION_BUCKETS) as [keyof typeof OPERATION_BUCKETS, ...(keyof typeof OPERATION_BUCKETS)[]]).optional() }).optional())
    .query(({ input }) => svc.listOperations(input?.bucket)),

  getOperation: staffProcedure.input(z.object({ id })).query(({ input }) => svc.operationDetail(input.id)),

  /** Envío al proveedor con su adaptador (hoy, manual). */
  submitOperation: staffProcedure.input(z.object({ id })).mutation(({ input, ctx }) => svc.submitOperation(input.id, ctx.user.id)),

  transitionOperation: staffProcedure
    .input(z.object({ id, to: z.enum(OPERATION_STATUSES), locator: optText(128), reason: optText(500) }))
    .mutation(({ input, ctx }) => svc.transitionOperation({ id: input.id, to: input.to, locator: input.locator, reason: input.reason, userId: ctx.user.id })),

  setOperationNotes: staffProcedure
    .input(z.object({ id, notes: z.string().max(4000) }))
    .mutation(({ input, ctx }) => svc.setOperationNotes(input.id, input.notes, ctx.user.id)),

  // ── Márgenes (administración) ───────────────────────────────────────────
  listMarginRules: staffProcedure.query(() => svc.listMarginRules()),

  saveMarginRule: adminProcedure
    .input(z.object({ scope: z.enum(MARGIN_SCOPES), scopeKey: z.string().max(63).default(""), markupBp: z.number().int(), commissionBp: z.number().int(), isActive: z.boolean().default(true) }))
    .mutation(({ input, ctx }) => svc.saveMarginRule(input, ctx.user.id)),

  // ── Proveedores (suppliers del Core + perfil turístico) ─────────────────
  listSuppliers: staffProcedure.query(() => svc.listSuppliers()),

  createSupplier: adminProcedure
    .input(z.object({
      fiscalName: z.string().trim().min(2).max(256), commercialName: optText(256), nif: optText(32), email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
      phone: optText(32), contactPerson: optText(256), connectionMode: z.enum(CONNECTION_MODES).default("manual"), serviceKinds: z.array(z.enum(SERVICE_KINDS)).max(10).default([]),
    }))
    .mutation(({ input, ctx }) => svc.createSupplier({
      fiscalName: input.fiscalName, commercialName: input.commercialName ?? null, nif: input.nif ?? null, email: input.email || null, phone: input.phone ?? null,
      contactPerson: input.contactPerson ?? null, connectionMode: input.connectionMode, serviceKinds: input.serviceKinds,
    }, ctx.user.id)),

  saveSupplierProfile: adminProcedure
    .input(z.object({
      supplierId: id, connectionMode: z.enum(CONNECTION_MODES), serviceKinds: z.array(z.enum(SERVICE_KINDS)).max(10), operationalEmail: z.string().trim().email().max(320).nullable().or(z.literal("")),
      operationalPhone: optText(50), notes: optText(4000), isActive: z.boolean(),
    }))
    .mutation(({ input, ctx }) => svc.saveSupplierProfile(input.supplierId, {
      connectionMode: input.connectionMode, serviceKinds: input.serviceKinds, operationalEmail: input.operationalEmail || null, operationalPhone: input.operationalPhone ?? null,
      notes: input.notes ?? null, isActive: input.isActive,
    }, ctx.user.id)),

  supplierContacts: staffProcedure.input(z.object({ supplierId: id })).query(({ input }) => svc.supplierContacts(input.supplierId)),

  addSupplierContact: adminProcedure
    .input(z.object({ supplierId: id, name: z.string().trim().min(2).max(200), role: optText(100), email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")), phone: optText(50), isPrimary: z.boolean().default(false) }))
    .mutation(({ input, ctx }) => svc.addSupplierContact(input.supplierId, { name: input.name, role: input.role ?? null, email: input.email || null, phone: input.phone ?? null, isPrimary: input.isPrimary }, ctx.user.id)),

  removeSupplierContact: adminProcedure.input(z.object({ id })).mutation(({ input, ctx }) => svc.removeSupplierContact(input.id, ctx.user.id)),
});
