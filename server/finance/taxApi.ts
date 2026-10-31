/**
 * Finanzas corporativas, fase 3: gestoría e impuestos bajo /cp/v1/finance/tax (CRM 0037). Formas EXACTAS del anexo
 * CRM-ESPERA-FASE3 (el CRM ya está hecho): fichas `{item}`, listas `{items}`/`{items,total}`, céntimos, null = sin datos.
 * Permisos (./permissions.ts): lectura = billing:read; borradores, obligaciones, nóminas, aplazamientos y expedientes =
 * billing:write + sesión de operador; configuración fiscal, reapertura de lo presentado y cierre del trimestre = además
 * rol admin|superadmin. El sistema NUNCA presenta nada ante ningún organismo.
 *
 *   GET   /tax/settings                                  lectura         { item: TaxSettings|null, log, defaults }
 *   PATCH /tax/settings                                  configuración   campos de la configuración (§1)
 *   GET   /tax/dashboard                                 lectura
 *   GET   /tax/calendar?year                             lectura         { items, notApplicable }
 *   POST  /tax/calendar/generate                         operador        { year } → { created, existing, retired, notApplicable }
 *   GET   /tax/obligations?year&model&status             lectura         { items, total }
 *   GET   /tax/obligations/:id                           lectura         { item: Obligation & { draft, log, documents } }
 *   POST  /tax/obligations/:id/calculate|review|present|pay|mark      operador
 *   POST  /tax/obligations/:id/reopen                    configuración   { reason }
 *   POST  /tax/quarters/:year/:quarter/close             configuración   { closePeriods? }
 *   GET   /tax/models/:model/preview?year&period         lectura         Draft
 *   GET   /tax/registers/issued.csv|received.csv?from&to lectura
 *   GET|POST /tax/payrolls · POST /tax/payrolls/:id/post|pay
 *   GET|POST /tax/deferrals · PATCH /tax/deferrals/:id · POST /tax/deferrals/:id/installments/:n/pay
 *   GET|POST /tax/dossiers · GET|PATCH /tax/dossiers/:id · POST /tax/dossiers/:id/log
 *   GET   /tax/export.zip?from&to                        lectura         (máximo un año)
 *   GET   /tax/corporate/:year · POST /tax/corporate/:year/adjustments
 *
 * La presentación lleva el PDF del justificante en base64 en el mismo cuerpo: su ruta lee el cuerpo con el límite
 * grande DESPUÉS de comprobar el permiso (ver FINANCE_UPLOAD_PATHS).
 */
import type { Router } from "express";
import { z } from "zod";
import { actorOf, wrap } from "./http";
import { bigJson } from "./opsApi";
import { canClose, canPost, canRead } from "./permissions";
import { periodLabel } from "./taxRules";
import type { FinanceTaxService } from "./taxService";
import {
  ADJUSTMENT_KINDS,
  DEFERRAL_STATUSES,
  DOSSIER_KINDS,
  DOSSIER_STATUSES,
  INSTALLMENT_METHODS,
  MODEL_NAMES,
  OBLIGATION_STATUSES,
  TAX_MODELS,
  VAT_PERIODS,
  VAT_REGIMES,
  type CorporateAdjustment,
  type Deferral,
  type Dossier,
  type DossierLogRow,
  type Obligation,
  type ObligationLogRow,
  type Payroll,
  type TaxDraft,
  type TaxSettings,
  type TaxSettingsLogRow,
} from "./taxTypes";

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const year = z.coerce.number().int().min(2000).max(2100);
const cents = z.number().int().min(0);
const body = (req: { body?: unknown }) => req.body ?? {};

// ── Formas del CRM ────────────────────────────────────────────────────────────────────────────────────────────────

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function obligationDto(o: Obligation) {
  const s = o.staleDetail;
  return {
    id: o.id,
    model: o.model,
    year: o.year,
    period: o.period,
    dueDate: o.dueDate,
    status: o.status,
    amountCents: o.amountCents,
    result: o.outcome,
    draftHash: o.draftHash,
    stale: o.stale,
    staleDiff:
      o.stale && s
        ? { previousCents: s.resultBefore, currentCents: s.resultAfter, differenceCents: s.resultBefore === null || s.resultAfter === null ? null : s.resultAfter - s.resultBefore, boxes: s.differences.map((d) => ({ box: d.box, label: d.label, beforeCents: d.before, afterCents: d.after })) }
        : null,
    presentedAt: o.presentedAt,
    presentedBy: o.presentedBy,
    receiptNumber: o.receiptRef,
    paidAt: o.paidAt,
    paymentEntryId: o.paymentEntryId,
    notes: o.notes,
    // Datos adicionales (el CRM puede ignorarlos)
    key: o.key,
    modelName: MODEL_NAMES[o.model],
    periodLabel: periodLabel(o.year, o.period),
    periodFrom: o.periodFrom,
    periodTo: o.periodTo,
    presentedOn: o.presentedOn,
    presentedAmountCents: o.presentedAmountCents,
    receiptDocumentId: o.receiptDocumentId,
    paidOn: o.paidOn,
    paidAmountCents: o.paidAmountCents,
    settlementEntryId: o.settlementEntryId,
    reviewedAt: o.reviewedAt,
    reviewedBy: o.reviewedBy,
    frozenAt: o.frozenAt,
  };
}

/** Código estable de un aviso (el texto puede cambiar; el código no). */
export function warningCode(message: string, hasData: boolean): string {
  if (!hasData) return "sin_datos";
  if (/sin NIF|NIF-IVA|necesita su NIF|sin su NIF/i.test(message)) return "sin_nif";
  if (/inversión del sujeto pasivo/i.test(message)) return "inversion_sujeto_pasivo";
  if (/^Faltan|^Falta/i.test(message)) return "faltan_datos";
  if (/anterior/i.test(message)) return "periodo_anterior";
  if (/mensual/i.test(message)) return "periodicidad";
  return "revisar";
}

const boxText = (b: TaxDraft["boxes"][number]) => (b.valueCents === null ? "Sin datos" : b.unit === "count" ? String(b.valueCents) : b.unit === "bp" ? `${(b.valueCents / 100).toLocaleString("es-ES")} %` : euro.format(b.valueCents / 100));

export function draftDto(d: TaxDraft) {
  return {
    boxes: d.boxes.map((b) => ({ box: b.box, label: b.label, valueCents: b.valueCents, text: boxText(b) })),
    sources: d.details.map((x) => {
      const tail = x.ref.split(":").pop() ?? "";
      return { box: x.box, kind: x.source, id: /^\d+$/.test(tail) ? Number(tail) : null, label: x.description, date: x.date, number: x.number ?? null, taxId: x.taxId ?? null, baseCents: x.baseCents, taxCents: x.taxCents, amountCents: x.taxCents ?? x.baseCents, ref: x.ref };
    }),
    warnings: d.warnings.map((m, i) => ({ code: warningCode(m, d.hasData || i > 0), message: m })),
    result: d.outcome,
    resultCents: d.resultCents,
    hash: d.hash,
    calculatedAt: d.computedAt,
    applies: d.applicable,
    reason: d.reason,
    // Datos adicionales
    model: d.model,
    year: d.year,
    period: d.period,
    from: d.from,
    to: d.to,
    hasData: d.hasData,
    declarants: d.declarants,
    notice: d.notice,
  };
}

const logDto = (l: ObligationLogRow) => ({ at: l.at, actor: l.actor, action: l.action, fromStatus: l.fromStatus, toStatus: l.toStatus, note: l.note });

export function payrollDto(p: Payroll) {
  return { id: p.id, period: p.period, employeeAlias: p.employeeAlias, grossCents: p.grossCents, irpfCents: p.irpfCents, ssEmployeeCents: p.ssEmployeeCents, ssCompanyCents: p.ssCompanyCents, netCents: p.netCents, paymentDate: p.payDate, status: p.status, entryId: p.entryId, paymentEntryId: p.paymentEntryId, paidOn: p.paidOn, bankAccountId: p.bankAccountId, notes: p.notes };
}

export function deferralDto(d: Deferral, o: Pick<Obligation, "model" | "period" | "year"> | null) {
  return {
    id: d.id,
    obligationId: d.obligationId,
    model: o?.model ?? null,
    period: o?.period ?? null,
    year: o?.year ?? null,
    principalCents: d.principalCents,
    interestCents: d.interestCents,
    reference: d.reference,
    requestedOn: d.requestedOn,
    status: d.status,
    installments: d.installments.map((x) => ({ n: x.number, dueDate: x.dueDate, amountCents: x.amountCents, paidAt: x.paidAt, entryId: x.entryId, paidOn: x.paidOn, status: x.status })),
    resolutionOn: d.resolutionOn,
    notes: d.notes,
  };
}

export const dossierDto = (d: Dossier) => ({ ...d });
const dossierLogDto = (l: DossierLogRow) => ({ at: l.at, actor: l.actor, note: l.note, action: l.action });
const adjustmentDto = (a: CorporateAdjustment) => ({ id: a.id, kind: a.kind, description: a.description, amountCents: a.amountCents, originYear: a.originYear });

const META = new Set(["configured", "version", "updatedBy", "updatedAt"]);
/** Historial de la configuración con lo que cambió en cada versión: `{campo: [antes, después]}`. */
export function settingsLogDto(rows: TaxSettingsLogRow[]) {
  return rows.map((r) => {
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(r.after)) {
      if (META.has(k)) continue;
      const before = r.before ? (r.before as Record<string, unknown>)[k] : undefined;
      if (JSON.stringify(before ?? null) !== JSON.stringify(v ?? null)) changes[k] = [before ?? null, v ?? null];
    }
    return { at: r.at, actor: r.actor, changes, note: r.before?.configured ? null : "Primera configuración (antes, valores por defecto)" };
  });
}

// ── Esquemas ──────────────────────────────────────────────────────────────────────────────────────────────────────

const settingsSchema = z
  .object({
    legalName: z.string().max(200).nullable().optional(),
    taxId: z.string().max(20).nullable().optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    vatRegime: z.enum(VAT_REGIMES).optional(),
    vatPeriod: z.enum(VAT_PERIODS).optional(),
    redeme: z.boolean().optional(),
    sii: z.boolean().optional(),
    vat390Exempt: z.boolean().optional(),
    openingVatCompensationCents: cents.nullable().optional(),
    corporateTaxRateBp: z.number().int().min(0).max(10_000).optional(),
    newEntityFirstProfitYear: z.number().int().min(2000).max(2100).nullable().optional(),
    hasEmployees: z.boolean().optional(),
    hasProfessionalWithholdings: z.boolean().optional(),
    hasRentWithholdings: z.boolean().optional(),
    intraEuOperations: z.boolean().optional(),
    operations347: z.boolean().optional(),
    installmentPaymentsMethod: z.enum(INSTALLMENT_METHODS).optional(),
    stripeVatId: z.string().max(20).nullable().optional(),
    extraHolidays: z.array(date).max(100).optional(),
    gestoriaEmail: z.string().max(200).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    expectedVersion: z.number().int().min(0).nullable().optional(),
  })
  .strict();
const paySchema = z.object({ paidOn: date, bankAccountId: z.number().int().positive(), amountCents: z.number().int().positive().optional() }).strict();
const dossierSchema = z
  .object({
    kind: z.enum(DOSSIER_KINDS),
    agency: z.string().max(120),
    reference: z.string().max(80).nullable().optional(),
    subject: z.string().max(300),
    notifiedOn: date.nullable().optional(),
    responseDueOn: date.nullable().optional(),
    status: z.enum(DOSSIER_STATUSES).optional(),
    obligationId: z.number().int().positive().nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

export function mountFinanceTaxRoutes(r: Router, tax: FinanceTaxService): void {
  const obligationsOf = async (ids: number[]) => new Map((await Promise.all(Array.from(new Set(ids)).map((x) => tax.obligation(x).then((o) => o.obligation, () => null)))).filter((o): o is Obligation => !!o).map((o) => [o.id, o]));
  const deferralsDto = async (list: Deferral[]) => {
    const obs = await obligationsOf(list.map((d) => d.obligationId));
    return list.map((d) => deferralDto(d, obs.get(d.obligationId) ?? null));
  };
  const fullObligation = async (oid: number) => {
    const o = await tax.obligation(oid);
    return { ...obligationDto(o.obligation), draft: o.draft ? draftDto(o.draft) : null, log: o.log.map(logDto), documents: o.documents };
  };

  // Configuración fiscal
  r.get("/tax/settings", ...canRead, wrap(async (_req, res) => {
    const [item, log] = await Promise.all([tax.storedSettings(), tax.settingsLog()]);
    res.json({ item, log: settingsLogDto(log), defaults: tax.defaults() });
  }));
  r.patch("/tax/settings", ...canClose, wrap(async (req, res) => {
    const b = settingsSchema.parse(body(req));
    res.json({ item: (await tax.saveSettings(b, actorOf(req))) as TaxSettings });
  }));

  // Panel y calendario
  r.get("/tax/dashboard", ...canRead, wrap(async (_req, res) => {
    const d = await tax.dashboard();
    res.json({ ...d, upcoming: d.upcoming.map(obligationDto) });
  }));
  r.get("/tax/calendar", ...canRead, wrap(async (req, res) => {
    const q = z.object({ year }).strict().parse(req.query);
    const c = await tax.calendar(q.year);
    res.json({ items: c.items.map(obligationDto), notApplicable: c.notApplicable });
  }));
  r.post("/tax/calendar/generate", ...canPost, wrap(async (req, res) => {
    const b = z.object({ year: z.number().int().min(2000).max(2100) }).strict().parse(body(req));
    res.json(await tax.generateCalendar(b.year, actorOf(req)));
  }));

  // Obligaciones
  r.get("/tax/obligations", ...canRead, wrap(async (req, res) => {
    const q = z.object({ year: year.optional(), model: z.enum(TAX_MODELS).optional(), status: z.enum(OBLIGATION_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict().parse(req.query);
    const out = await tax.listObligations(q);
    res.json({ items: out.items.map(obligationDto), total: out.total });
  }));
  r.get("/tax/obligations/:id", ...canRead, wrap(async (req, res) => void res.json({ item: await fullObligation(id.parse(req.params.id)) })));
  r.post("/tax/obligations/:id/calculate", ...canPost, wrap(async (req, res) => {
    const b = z.object({ force: z.boolean().optional() }).strict().parse(body(req));
    const oid = id.parse(req.params.id);
    await tax.calculate(oid, actorOf(req), b);
    res.json({ item: await fullObligation(oid) });
  }));
  r.post("/tax/obligations/:id/review", ...canPost, wrap(async (req, res) => {
    const b = z.object({ note: z.string().max(500).nullable().optional() }).strict().parse(body(req));
    res.json({ item: obligationDto(await tax.review(id.parse(req.params.id), actorOf(req), b.note)) });
  }));
  r.post("/tax/obligations/:id/present", ...canPost, bigJson, wrap(async (req, res) => {
    const b = z
      .object({
        presentedOn: date,
        receiptNumber: z.string().max(100),
        note: z.string().max(500).nullable().optional(),
        document: z.object({ filename: z.string().min(1).max(255), contentBase64: z.string().min(1) }).strict().nullable().optional(),
        refund: z.boolean().optional(),
        directDebit: z.boolean().optional(),
      })
      .strict()
      .parse(body(req));
    res.json({ item: obligationDto(await tax.present(id.parse(req.params.id), b, actorOf(req))) });
  }));
  r.post("/tax/obligations/:id/pay", ...canPost, wrap(async (req, res) => void res.json({ item: obligationDto(await tax.pay(id.parse(req.params.id), paySchema.parse(body(req)), actorOf(req))) })));
  r.post("/tax/obligations/:id/mark", ...canPost, wrap(async (req, res) => {
    const b = z.object({ status: z.enum(["a_compensar", "sin_actividad"]), note: z.string().max(500).nullable().optional() }).strict().parse(body(req));
    res.json({ item: obligationDto(await tax.mark(id.parse(req.params.id), b.status, b.note, actorOf(req))) });
  }));
  r.post("/tax/obligations/:id/reopen", ...canClose, wrap(async (req, res) => {
    const b = z.object({ reason: z.string().max(300) }).strict().parse(body(req));
    res.json({ item: obligationDto(await tax.reopen(id.parse(req.params.id), b.reason, actorOf(req))) });
  }));
  r.post("/tax/quarters/:year/:quarter/close", ...canClose, wrap(async (req, res) => {
    const b = z.object({ closePeriods: z.boolean().optional() }).strict().parse(body(req));
    res.json({ item: await tax.closeQuarter(year.parse(req.params.year), z.coerce.number().int().parse(req.params.quarter), !!b.closePeriods, actorOf(req)) });
  }));

  // Vista previa de un modelo (sin guardar)
  r.get("/tax/models/:model/preview", ...canRead, wrap(async (req, res) => {
    const model = z.enum(TAX_MODELS).parse(req.params.model);
    const q = z.object({ year, period: z.string().max(6) }).strict().parse(req.query);
    res.json(draftDto(await tax.preview(model, q.year, q.period)));
  }));

  // Libros registro
  for (const kind of ["issued", "received"] as const) {
    r.get(`/tax/registers/${kind}.csv`, ...canRead, wrap(async (req, res) => {
      const q = z.object({ from: date.optional(), to: date.optional() }).strict().parse(req.query);
      const out = kind === "issued" ? await tax.issuedRegisterCsv(q.from, q.to) : await tax.receivedRegisterCsv(q.from, q.to);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="libro-registro-${kind === "issued" ? "expedidas" : "recibidas"}-${out.from}-${out.to}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(out.csv);
    }));
  }

  // Nóminas
  r.get("/tax/payrolls", ...canRead, wrap(async (req, res) => {
    const q = z.object({ period: z.string().max(7).optional() }).strict().parse(req.query);
    res.json({ items: (await tax.listPayrolls(q.period)).map(payrollDto) });
  }));
  r.post("/tax/payrolls", ...canPost, wrap(async (req, res) => {
    const b = z.object({ period: z.string().max(7), employeeAlias: z.string().max(60), grossCents: cents, irpfCents: cents, ssEmployeeCents: cents, ssCompanyCents: cents, netCents: cents, paymentDate: date.nullable().optional(), notes: z.string().max(500).nullable().optional() }).strict().parse(body(req));
    const out = await tax.savePayroll(b, actorOf(req));
    res.status(out.created ? 201 : 200).json({ item: payrollDto(out.payroll) });
  }));
  r.post("/tax/payrolls/:id/post", ...canPost, wrap(async (req, res) => {
    z.object({}).strict().parse(body(req));
    res.json({ item: payrollDto(await tax.postPayroll(id.parse(req.params.id), actorOf(req))) });
  }));
  r.post("/tax/payrolls/:id/pay", ...canPost, wrap(async (req, res) => void res.json({ item: payrollDto(await tax.payPayroll(id.parse(req.params.id), paySchema.parse(body(req)), actorOf(req))) })));

  // Aplazamientos
  r.get("/tax/deferrals", ...canRead, wrap(async (req, res) => {
    const q = z.object({ status: z.enum(DEFERRAL_STATUSES).optional(), obligationId: id.optional() }).strict().parse(req.query);
    res.json({ items: await deferralsDto(await tax.listDeferrals(q)) });
  }));
  r.post("/tax/deferrals", ...canPost, wrap(async (req, res) => {
    const b = z
      .object({
        obligationId: z.number().int().positive(),
        principalCents: z.number().int().positive(),
        interestCents: cents.optional(),
        reference: z.string().max(60).nullable().optional(),
        requestedOn: date,
        notes: z.string().max(500).nullable().optional(),
        installments: z.array(z.object({ n: z.number().int().positive(), dueDate: date, amountCents: z.number().int().positive() }).strict()).min(1).max(60),
      })
      .strict()
      .parse(body(req));
    res.status(201).json({ item: (await deferralsDto([await tax.createDeferral(b, actorOf(req))]))[0] });
  }));
  r.patch("/tax/deferrals/:id", ...canPost, wrap(async (req, res) => {
    const b = z.object({ status: z.enum(DEFERRAL_STATUSES).optional(), resolutionOn: date.nullable().optional(), reference: z.string().max(60).nullable().optional(), notes: z.string().max(500).nullable().optional() }).strict().parse(body(req));
    res.json({ item: (await deferralsDto([await tax.patchDeferral(id.parse(req.params.id), b, actorOf(req))]))[0] });
  }));
  r.post("/tax/deferrals/:id/installments/:n/pay", ...canPost, wrap(async (req, res) => {
    const d = await tax.payInstallment(id.parse(req.params.id), z.coerce.number().int().positive().parse(req.params.n), paySchema.parse(body(req)), actorOf(req));
    res.json({ item: (await deferralsDto([d]))[0] });
  }));

  // Expedientes
  r.get("/tax/dossiers", ...canRead, wrap(async (req, res) => {
    const q = z.object({ status: z.enum(DOSSIER_STATUSES).optional() }).strict().parse(req.query);
    res.json({ items: (await tax.listDossiers(q.status)).map(dossierDto) });
  }));
  const fullDossier = async (did: number) => {
    const d = await tax.dossier(did);
    return { ...dossierDto(d.dossier), log: d.log.map(dossierLogDto), documents: d.documents };
  };
  r.get("/tax/dossiers/:id", ...canRead, wrap(async (req, res) => void res.json({ item: await fullDossier(id.parse(req.params.id)) })));
  r.post("/tax/dossiers", ...canPost, wrap(async (req, res) => {
    const d = await tax.createDossier(dossierSchema.parse(body(req)), actorOf(req));
    res.status(201).json({ item: await fullDossier(d.id) });
  }));
  r.patch("/tax/dossiers/:id", ...canPost, wrap(async (req, res) => {
    const did = id.parse(req.params.id);
    await tax.patchDossier(did, dossierSchema.partial().parse(body(req)), actorOf(req));
    res.json({ item: await fullDossier(did) });
  }));
  r.post("/tax/dossiers/:id/log", ...canPost, wrap(async (req, res) => {
    const b = z.object({ note: z.string().max(2000) }).strict().parse(body(req));
    const did = id.parse(req.params.id);
    await tax.addDossierNote(did, b.note, actorOf(req));
    res.status(201).json({ item: await fullDossier(did) });
  }));

  // Exportación ZIP para la gestoría
  r.get("/tax/export.zip", ...canRead, wrap(async (req, res) => {
    const q = z.object({ from: date.optional(), to: date.optional() }).strict().parse(req.query);
    const out = await tax.exportZip(q.from, q.to);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="gestoria-${out.from}-${out.to}.zip"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(out.buffer);
  }));

  // Impuesto sobre Sociedades
  r.get("/tax/corporate/:year", ...canRead, wrap(async (req, res) => {
    const c = await tax.corporate(year.parse(req.params.year));
    const v = (box: string) => (c.draft.hasData ? (c.draft.boxes.find((b) => b.box === box)?.valueCents ?? null) : null);
    let negativeBases: Array<{ originYear: number; amountCents: number; appliedCents: number }> = [];
    try {
      negativeBases = typeof c.draft.extra.negativeBasesJson === "string" ? (JSON.parse(c.draft.extra.negativeBasesJson) as Array<{ originYear: number; amountCents: number; appliedCents: number }>).map((x) => ({ originYear: x.originYear, amountCents: x.amountCents, appliedCents: x.appliedCents })) : [];
    } catch {
      negativeBases = [];
    }
    const draft = draftDto(c.draft);
    res.json({
      item: {
        year: c.draft.year,
        accountingResultCents: v("00501"),
        adjustments: c.adjustments.filter((a) => a.status === "active").map(adjustmentDto),
        negativeBases,
        taxBaseCents: v("00552"),
        rateBp: typeof c.draft.extra.rateBp === "number" ? c.draft.extra.rateBp : null,
        grossQuotaCents: v("00562"),
        deductionsCents: v("deducciones"),
        withholdingsCents: v("00595"),
        installmentsCents: v("00598"),
        resultCents: c.draft.resultCents,
        warnings: draft.warnings,
        obligation: c.obligation ? obligationDto(c.obligation) : null,
        installments: c.installments.map(obligationDto),
        draft,
      },
    });
  }));
  r.post("/tax/corporate/:year/adjustments", ...canPost, wrap(async (req, res) => {
    const b = z.object({ id: z.number().int().positive().optional(), kind: z.enum(ADJUSTMENT_KINDS), description: z.string().max(300), amountCents: cents, originYear: z.number().int().min(1990).max(2100).nullable().optional() }).strict().parse(body(req));
    const a = await tax.saveAdjustment(year.parse(req.params.year), b, actorOf(req));
    res.status(a ? 201 : 200).json({ item: a ? adjustmentDto(a) : null });
  }));
}
