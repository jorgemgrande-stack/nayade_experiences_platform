/**
 * Finanzas corporativas, fase 1B: rutas de operaciones bajo /cp/v1/finance (CRM 0035). Formas EXACTAS del anexo
 * CRM-ESPERA. Permisos (./permissions.ts): lectura = finance:read; gestión = finance:expenses (proveedores:
 * finance:suppliers); lo que contabiliza o revierte = finance:post + sesión de operador (nunca un token de servicio).
 *
 *   GET|POST /cost-centers · PATCH /cost-centers/:id                                       lectura | gestión
 *   GET|POST /categories · PATCH /categories/:id                                           lectura | gestión
 *   GET|POST /suppliers · GET|PATCH /suppliers/:id · GET /suppliers/:id/statement          lectura | gestión
 *   GET|POST /expenses · GET|PATCH /expenses/:id (borrador)                                lectura | gestión
 *   POST /expenses/:id/register · /expenses/:id/void · /expenses/:id/payments              contabilizar
 *   POST /expense-payments/:id/reverse                                                     contabilizar
 *   GET|POST /documents · GET /documents/:id/content · POST /documents/:id/archive          lectura | gestión
 *   GET|POST /recurring · PATCH /recurring/:id · GET /recurring/preview · POST /recurring/run   lectura | gestión
 *   GET|POST /bank-accounts · PATCH /bank-accounts/:id                                     lectura | gestión
 *   GET|POST /bank-imports · GET /bank-movements · GET /bank-movements/:id/suggestions      lectura | gestión
 *   POST /bank-movements/:id/match|unmatch                                                 contabilizar
 *   POST /bank-movements/:id/ignore                                                        gestión
 *   GET|POST /cash-accounts                                                                lectura | gestión
 *   GET /cash-movements · POST /cash-movements                                             lectura | contabilizar
 *
 * Los documentos y extractos llegan en base64 dentro del JSON (hasta 10 MB de fichero): esas dos rutas leen su cuerpo
 * con un límite propio DESPUÉS de comprobar el permiso (el analizador general del plano de control las deja pasar).
 */
import express, { type Router } from "express";
import { z } from "zod";
import { actorOf, wrap } from "./http";
import type { FinanceAnalysisService } from "./analysisService";
import type { FinanceOpsService } from "./opsService";
import { FinanceError } from "./types";
import { ACCOUNT_MATCH_TYPES, DOCUMENT_OWNERS, EXPENSE_KINDS, EXPENSE_STATUSES, FREQUENCIES, IMPORT_FORMATS, MOVEMENT_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from "./opsTypes";
import { canExpenses, canPost, canRead, canSuppliers } from "./permissions";

/** Rutas con fichero en base64: el analizador JSON general (256 kB) no las lee; aquí, hasta 15 MB y tras el permiso. */
export const FINANCE_UPLOAD_PATHS = /^\/cp\/v1\/finance\/(documents|bank-imports|stripe\/imports|tax\/obligations\/\d+\/present)\/?(\?|$)/;
export const bigJson = express.json({ limit: "15mb" });

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const ref = z.number().int().positive();
const bp = z.number().int().min(0).max(10_000);
const accountCode = z.string().regex(/^\d{3,12}$/, "código de cuenta de 3 a 12 dígitos");
const qId = z.coerce.number().int().positive();
const limit = (max: number) => z.coerce.number().int().min(1).max(max).optional();
const offset = z.coerce.number().int().min(0).optional();
const body = (req: { body?: unknown }) => req.body ?? {};

const supplierSchema = z
  .object({
    name: z.string().max(160),
    legalName: z.string().max(200).nullable().optional(),
    taxId: z.string().max(30).nullable().optional(),
    country: z.string().max(2).optional(),
    address: z.string().max(300).nullable().optional(),
    email: z.string().max(160).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    iban: z.string().max(42).nullable().optional(),
    paymentTermsDays: z.number().int().nullable().optional(),
    defaultCategoryId: ref.nullable().optional(),
    defaultCostCenterId: ref.nullable().optional(),
    accountCode: z.enum(["400", "410"]).optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

const expenseSchema = z
  .object({
    kind: z.enum(EXPENSE_KINDS),
    supplierId: ref.nullable().optional(),
    categoryId: ref.nullable().optional(),
    costCenterId: ref.nullable().optional(),
    invoiceNumber: z.string().max(60).nullable().optional(),
    invoiceDate: date,
    accrualDate: date.nullable().optional(),
    dueDate: date.nullable().optional(),
    description: z.string().max(500),
    baseCents: z.number().int(),
    taxRateBp: bp,
    deductibleBp: bp.optional(),
    withholdingRateBp: bp.optional(),
    rectifiesExpenseId: ref.nullable().optional(),
  })
  .strict();

const recurringSchema = z
  .object({
    supplierId: ref,
    categoryId: ref,
    costCenterId: ref.nullable().optional(),
    description: z.string().max(400),
    baseCents: z.number().int(),
    taxRateBp: bp,
    deductibleBp: bp.optional(),
    withholdingRateBp: bp.optional(),
    frequency: z.enum(FREQUENCIES),
    dayOfMonth: z.number().int(),
    startDate: date,
    endDate: date.nullable().optional(),
  })
  .strict();

const mappingSchema = z
  .object({
    delimiter: z.enum([";", ",", "\t"]),
    headerRows: z.number().int().min(0).max(50),
    date: z.number().int().min(0).max(200),
    amount: z.number().int().min(0).max(200),
    description: z.number().int().min(0).max(200),
    balance: z.number().int().min(0).max(200).nullable(),
    dateFormat: z.enum(["dd/mm/yyyy", "yyyy-mm-dd", "mm/dd/yyyy"]),
    decimal: z.enum([",", "."]),
  })
  .strict();

const matchSchema = z.union([
  z.object({ type: z.literal("expense_payment"), expenseId: ref }).strict(),
  z.object({ type: z.literal("expense_payment"), expensePaymentId: ref }).strict(),
  z.object({ type: z.enum(ACCOUNT_MATCH_TYPES), accountCode, description: z.string().max(300).nullable().optional() }).strict(),
  // Fase 2: abono de un payout de Stripe (sin asiento) y cobro de una factura propia por transferencia
  z.object({ type: z.literal("stripe_payout"), payoutId: ref }).strict(),
  z.object({ type: z.literal("invoice_payment"), invoiceId: ref }).strict(),
]);

const reason = z.object({ reason: z.string().max(300) }).strict();

export function mountFinanceOpsRoutes(r: Router, ops: FinanceOpsService, analysis?: FinanceAnalysisService | null): void {
  // Centros de coste
  r.get("/cost-centers", ...canRead, wrap(async (_req, res) => void res.json({ items: await ops.costCenters() })));
  r.post("/cost-centers", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ code: z.string().max(20), name: z.string().max(120) }).strict().parse(body(req));
    res.status(201).json({ item: await ops.createCostCenter(b, actorOf(req)) });
  }));
  r.patch("/cost-centers/:id", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ code: z.string().max(20).optional(), name: z.string().max(120).optional(), active: z.boolean().optional() }).strict().parse(body(req));
    res.json({ item: await ops.patchCostCenter(id.parse(req.params.id), b, actorOf(req)) });
  }));

  // Categorías de gasto
  // Fase 4 (CRM 0038): cada categoría lleva además su marca de coste directo (`isDirectCost`, null = según cuenta) y la resuelta (`directCost`)
  const categoryOut = async <T extends { id: number; name: string; accountCode: string }>(items: T[]) => (analysis ? analysis.decorateCategories(items) : items);
  r.get("/categories", ...canRead, wrap(async (_req, res) => void res.json({ items: await categoryOut(await ops.categories()) })));
  r.post("/categories", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ name: z.string().max(120), accountCode, defaultTaxRateBp: bp.nullable().optional() }).strict().parse(body(req));
    res.status(201).json({ item: (await categoryOut([await ops.createCategory(b, actorOf(req))]))[0] });
  }));
  r.patch("/categories/:id", ...canExpenses, wrap(async (req, res) => {
    const { isDirectCost, ...b } = z.object({ name: z.string().max(120).optional(), accountCode: accountCode.optional(), defaultTaxRateBp: bp.nullable().optional(), active: z.boolean().optional(), isDirectCost: z.boolean().nullable().optional() }).strict().parse(body(req));
    if (isDirectCost !== undefined && !analysis) throw new FinanceError("unavailable", "La marca de coste directo llega con el análisis (migración 0038), que no está montado en este entorno");
    const categoryId = id.parse(req.params.id);
    const item = await ops.patchCategory(categoryId, b, actorOf(req));
    if (isDirectCost !== undefined) await analysis!.setDirectCost(categoryId, isDirectCost, actorOf(req));
    res.json({ item: (await categoryOut([item]))[0] });
  }));

  // Proveedores
  r.get("/suppliers", ...canRead, wrap(async (req, res) => {
    const q = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(["true", "false", ""]).optional(), limit: limit(500), offset }).strict().parse(req.query);
    res.json(await ops.suppliers({ q: q.q || undefined, active: q.active ? q.active === "true" : undefined, limit: q.limit, offset: q.offset }));
  }));
  r.post("/suppliers", ...canSuppliers, wrap(async (req, res) => void res.status(201).json({ item: await ops.createSupplier(supplierSchema.parse(body(req)), actorOf(req)) })));
  r.get("/suppliers/:id", ...canRead, wrap(async (req, res) => void res.json({ item: await ops.supplier(id.parse(req.params.id)) })));
  r.patch("/suppliers/:id", ...canSuppliers, wrap(async (req, res) => {
    const b = supplierSchema.partial().extend({ active: z.boolean().optional() }).strict().parse(body(req));
    res.json({ item: await ops.patchSupplier(id.parse(req.params.id), b, actorOf(req)) });
  }));
  r.get("/suppliers/:id/statement", ...canRead, wrap(async (req, res) => {
    const q = z.object({ from: date.optional(), to: date.optional() }).strict().parse(req.query);
    res.json(await ops.supplierStatement(id.parse(req.params.id), q.from, q.to));
  }));

  // Gastos (facturas recibidas)
  r.get("/expenses", ...canRead, wrap(async (req, res) => {
    const q = z
      .object({
        status: z.enum(EXPENSE_STATUSES).optional(),
        paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
        supplier: qId.optional(),
        category: qId.optional(),
        costCenter: qId.optional(),
        from: date.optional(),
        to: date.optional(),
        q: z.string().trim().max(100).optional(),
        due: z.enum(["overdue"]).optional(),
        sort: z.enum(["invoiceDate", "dueDate", "totalCents", "supplier"]).optional(),
        dir: z.enum(["asc", "desc"]).optional(),
        limit: limit(200),
        offset,
      })
      .strict()
      .parse(req.query);
    const { supplier, category, costCenter, q: text, ...rest } = q;
    res.json(await ops.listExpenses({ ...rest, supplierId: supplier, categoryId: category, costCenterId: costCenter, q: text || undefined }));
  }));
  r.post("/expenses", ...canExpenses, wrap(async (req, res) => {
    const e = await ops.createExpense(expenseSchema.parse(body(req)), actorOf(req));
    res.status(201).json({ item: ops.expenseDto(e) });
  }));
  r.get("/expenses/:id", ...canRead, wrap(async (req, res) => void res.json(await ops.expenseWithPayments(id.parse(req.params.id)))));
  r.patch("/expenses/:id", ...canExpenses, wrap(async (req, res) => {
    const e = await ops.patchExpense(id.parse(req.params.id), expenseSchema.partial().strict().parse(body(req)), actorOf(req));
    res.json({ item: ops.expenseDto(e) });
  }));
  r.post("/expenses/:id/register", ...canPost, wrap(async (req, res) => void res.json({ item: ops.expenseDto(await ops.registerExpense(id.parse(req.params.id), actorOf(req))) })));
  r.post("/expenses/:id/void", ...canPost, wrap(async (req, res) => {
    const b = reason.parse(body(req));
    res.json({ item: ops.expenseDto(await ops.voidExpense(id.parse(req.params.id), b.reason, actorOf(req))) });
  }));
  r.post("/expenses/:id/payments", ...canPost, wrap(async (req, res) => {
    const b = z
      .object({ paidOn: date, amountCents: z.number().int(), method: z.enum(PAYMENT_METHODS), bankAccountId: ref.nullable().optional(), cashAccountId: ref.nullable().optional(), reference: z.string().max(140).nullable().optional() })
      .strict()
      .parse(body(req));
    res.status(201).json(await ops.addPayment(id.parse(req.params.id), b, actorOf(req)));
  }));
  r.post("/expense-payments/:id/reverse", ...canPost, wrap(async (req, res) => {
    const b = reason.parse(body(req));
    res.json({ item: await ops.reversePayment(id.parse(req.params.id), b.reason, actorOf(req)) });
  }));

  // Documentos adjuntos
  r.get("/documents", ...canRead, wrap(async (req, res) => {
    const q = z.object({ ownerType: z.enum(DOCUMENT_OWNERS), ownerId: qId }).strict().parse(req.query);
    res.json({ items: await ops.documents(q.ownerType, q.ownerId) });
  }));
  r.post("/documents", ...canExpenses, bigJson, wrap(async (req, res) => {
    const b = z.object({ ownerType: z.enum(DOCUMENT_OWNERS), ownerId: ref, filename: z.string().min(1).max(255), contentBase64: z.string().min(1) }).strict().parse(body(req));
    res.status(201).json({ item: await ops.uploadDocument(b, actorOf(req)) });
  }));
  r.get("/documents/:id/content", ...canRead, wrap(async (req, res) => {
    const { doc, content } = await ops.documentContent(id.parse(req.params.id));
    res.setHeader("Content-Type", doc.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "no-store");
    res.send(content);
  }));
  r.post("/documents/:id/archive", ...canExpenses, wrap(async (req, res) => void res.json({ item: await ops.archiveDocument(id.parse(req.params.id), actorOf(req)) })));

  // Gastos recurrentes (generan BORRADORES; no contabilizan)
  r.get("/recurring", ...canRead, wrap(async (_req, res) => void res.json({ items: await ops.recurring() })));
  r.get("/recurring/preview", ...canRead, wrap(async (req, res) => {
    const q = z.object({ until: date }).strict().parse(req.query);
    res.json({ items: await ops.previewRecurring(q.until) });
  }));
  r.post("/recurring/run", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ until: date }).strict().parse(body(req));
    res.json(await ops.runRecurring(b.until, actorOf(req)));
  }));
  r.post("/recurring", ...canExpenses, wrap(async (req, res) => void res.status(201).json({ item: await ops.createRecurring(recurringSchema.parse(body(req)), actorOf(req)) })));
  r.patch("/recurring/:id", ...canExpenses, wrap(async (req, res) => {
    const b = recurringSchema.partial().extend({ active: z.boolean().optional() }).strict().parse(body(req));
    res.json({ item: await ops.patchRecurring(id.parse(req.params.id), b, actorOf(req)) });
  }));

  // Bancos
  r.get("/bank-accounts", ...canRead, wrap(async (_req, res) => void res.json({ items: await ops.bankAccounts() })));
  r.post("/bank-accounts", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ name: z.string().max(120), iban: z.string().max(42).nullable().optional(), bankName: z.string().max(120).nullable().optional(), openingDate: date.nullable().optional() }).strict().parse(body(req));
    res.status(201).json({ item: await ops.createBankAccount(b, actorOf(req)) });
  }));
  r.patch("/bank-accounts/:id", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ name: z.string().max(120).optional(), bankName: z.string().max(120).nullable().optional(), active: z.boolean().optional() }).strict().parse(body(req));
    res.json({ item: await ops.patchBankAccount(id.parse(req.params.id), b, actorOf(req)) });
  }));
  r.post("/bank-imports", ...canExpenses, bigJson, wrap(async (req, res) => {
    const b = z.object({ bankAccountId: ref, format: z.enum(IMPORT_FORMATS), filename: z.string().min(1).max(255), contentBase64: z.string().min(1), mapping: mappingSchema.nullable().optional() }).strict().parse(body(req));
    res.status(201).json({ item: await ops.importStatement(b, actorOf(req)) });
  }));
  r.get("/bank-imports", ...canRead, wrap(async (req, res) => {
    const q = z.object({ bankAccountId: qId.optional() }).strict().parse(req.query);
    res.json({ items: await ops.imports(q.bankAccountId) });
  }));
  r.get("/bank-movements", ...canRead, wrap(async (req, res) => {
    const q = z.object({ bankAccountId: qId.optional(), status: z.enum(MOVEMENT_STATUSES).optional(), from: date.optional(), to: date.optional(), q: z.string().trim().max(100).optional(), limit: limit(500), offset }).strict().parse(req.query);
    res.json(await ops.movements({ ...q, q: q.q || undefined }));
  }));
  r.get("/bank-movements/:id/suggestions", ...canRead, wrap(async (req, res) => void res.json({ items: await ops.suggestions(id.parse(req.params.id)) })));
  r.post("/bank-movements/:id/match", ...canPost, wrap(async (req, res) => void res.json({ item: await ops.match(id.parse(req.params.id), matchSchema.parse(body(req)), actorOf(req)) })));
  r.post("/bank-movements/:id/unmatch", ...canPost, wrap(async (req, res) => void res.json({ item: await ops.unmatch(id.parse(req.params.id), actorOf(req)) })));
  r.post("/bank-movements/:id/ignore", ...canExpenses, wrap(async (req, res) => void res.json({ item: await ops.ignore(id.parse(req.params.id), actorOf(req)) })));

  // Caja
  r.get("/cash-accounts", ...canRead, wrap(async (_req, res) => void res.json({ items: await ops.cashAccounts() })));
  r.post("/cash-accounts", ...canExpenses, wrap(async (req, res) => {
    const b = z.object({ name: z.string().max(120) }).strict().parse(body(req));
    res.status(201).json({ item: await ops.createCashAccount(b, actorOf(req)) });
  }));
  r.get("/cash-movements", ...canRead, wrap(async (req, res) => {
    const q = z.object({ cashAccountId: qId.optional(), limit: limit(500), offset }).strict().parse(req.query);
    res.json(await ops.cashMovements(q));
  }));
  r.post("/cash-movements", ...canPost, wrap(async (req, res) => {
    const b = z.object({ cashAccountId: ref, movedOn: date, amountCents: z.number().int(), description: z.string().max(300), counterpartAccountCode: accountCode }).strict().parse(body(req));
    res.status(201).json({ item: await ops.createCashMovement(b, actorOf(req)) });
  }));
}
