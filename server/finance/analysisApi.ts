/**
 * Finanzas corporativas, fase 4: rutas de control diario, informes y análisis bajo /cp/v1/finance (CRM 0038). Permisos
 * (./permissions.ts): lectura = finance:read; marcar la revisión diaria = finance:post + sesión de operador; CSV =
 * finance:export; la marca de coste directo de las categorías = finance:expenses (en PATCH /categories/:id, ./opsApi.ts).
 *
 *   GET  /overview                                                     lectura        panel: indicadores con estado
 *   GET  /daily?date                                                   lectura        control diario
 *   GET  /daily/reviews?from&to&limit&offset                           lectura        revisiones
 *   POST /daily/:date/review { note? }                                 operador       revisar (idempotente; edita la nota)
 *   GET  /reports/pnl?from&to&granularity&compare&costCenter           lectura        cuenta de resultados
 *   GET  /reports/balance?date                                         lectura        balance de situación
 *   GET  /reports/cashflow?from&to&forecastDays                        lectura        tesorería y previsión
 *   GET  /reports/aging?side=receivable|payable&date                   lectura        antigüedad de saldos
 *   GET  /reports/expenses?from&to&groupBy&compare                     lectura        gastos agrupados
 *   GET  /reports/:report.csv?…                                        exportar       CSV de cada informe (y del análisis)
 *   GET  /analytics/revenue-margin?year                                lectura        Revenue & Margin
 *   GET  /analytics/conversion-health?from&to                          lectura        Conversion Health
 *
 * Parametrización fiscal (CRM 0039; sin la migración no se montan → 404):
 *   GET   /analysis/settings                                           lectura        { item }
 *   PATCH /analysis/settings { stripeFeesTreatment?, bankFeeAccounts? } configuración  { item }
 */
import type { Request, Response, Router } from "express";
import { z } from "zod";
import { getAuth } from "../controlPlane/auth";
import { actorOf, wrap } from "./http";
import { canConfig, canExport, canPost, canRead } from "./permissions";
import { BANK_FEE_NATURES } from "./opsTypes";
import { STRIPE_FEES_TREATMENTS } from "./analysisTypes";
import { agingCsv, balanceCsv, cashflowCsv, COMPARE_KINDS, conversionCsv, dailyCsv, EXPENSE_GROUPS, expensesCsv, GRANULARITIES, pnlCsv, revenueMarginCsv } from "./analysisRules";
import type { CommercialSources, FinanceAnalysisService } from "./analysisService";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const range = { from: date.optional(), to: date.optional() };
const pnlQuery = z.object({ ...range, granularity: z.enum(GRANULARITIES).optional(), compare: z.enum(COMPARE_KINDS).optional(), costCenter: z.coerce.number().int().positive().optional() }).strict();
const balanceQuery = z.object({ date: date.optional() }).strict();
const cashflowQuery = z.object({ ...range, forecastDays: z.enum(["0", "30", "60", "90"]).optional() }).strict();
const agingQuery = z.object({ side: z.enum(["receivable", "payable"]), date: date.optional() }).strict();
const expensesQuery = z.object({ ...range, groupBy: z.enum(EXPENSE_GROUPS).optional(), compare: z.enum(COMPARE_KINDS).optional() }).strict();
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).strict();
const rangeQuery = z.object(range).strict();
export const CSV_REPORTS = ["pnl", "balance", "cashflow", "aging", "expenses", "daily", "revenue-margin", "conversion-health"] as const;

function sendCsv(res: Response, name: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}

/**
 * Métricas comerciales que puede ver quien pide: MRR/ARR exige además billing:read (como /revenue/metrics; la ruta solo
 * exige finance:read); la rentabilidad por empresa exige además usage:read (como /resources/profitability).
 */
function commercialFor(req: Request, c: CommercialSources | null | undefined): CommercialSources | null {
  if (!c) return null;
  const scopes = getAuth(req)?.scopes;
  return { metrics: scopes?.has("billing:read") ? (c.metrics ?? null) : null, profitability: scopes?.has("usage:read") ? (c.profitability ?? null) : null };
}

export function mountFinanceAnalysisRoutes(r: Router, svc: FinanceAnalysisService, commercial?: CommercialSources | null, fiscal = false) {
  if (fiscal) {
    // Configuración del análisis: tratamiento de las comisiones de Stripe y cuenta de cada naturaleza bancaria
    r.get("/analysis/settings", ...canRead, wrap(async (_req, res) => void res.json({ item: await svc.analysisSettings() })));
    r.patch("/analysis/settings", ...canConfig, wrap(async (req, res) => {
      const account = z.string().regex(/^\d{3,12}$/, "código de cuenta de 3 a 12 dígitos");
      const b = z
        .object({
          stripeFeesTreatment: z.enum(STRIPE_FEES_TREATMENTS).optional(),
          bankFeeAccounts: z.object(Object.fromEntries(BANK_FEE_NATURES.map((n) => [n, account.optional()])) as Record<(typeof BANK_FEE_NATURES)[number], z.ZodOptional<z.ZodString>>).strict().optional(),
        })
        .strict()
        .parse(req.body ?? {});
      res.json({ item: await svc.saveAnalysisSettings(b, actorOf(req)) });
    }));
  }
  // Panel financiero con el estado de cada indicador
  r.get("/overview", ...canRead, wrap(async (_req, res) => void res.json(await svc.overview())));
  // Control diario
  r.get("/daily",...canRead, wrap(async (req, res) => void res.json(await svc.daily(z.object({ date: date.optional() }).strict().parse(req.query).date))));
  r.get("/daily/reviews", ...canRead, wrap(async (req, res) => {
    const q = z.object({ ...range, limit: z.coerce.number().int().min(1).max(366).optional(), offset: z.coerce.number().int().min(0).optional() }).strict().parse(req.query);
    res.json(await svc.reviews(q));
  }));
  r.post("/daily/:date/review", ...canPost, wrap(async (req, res) => {
    const b = z.object({ note: z.string().max(1000).nullable().optional() }).strict().parse(req.body ?? {});
    const out = await svc.review(date.parse(req.params.date), b.note, actorOf(req));
    res.status(out.created ? 201 : 200).json(out);
  }));

  // Informes
  r.get("/reports/:report.csv", ...canExport, wrap(async (req, res) => {
    const report = z.enum(CSV_REPORTS).parse(req.params.report);
    switch (report) {
      case "pnl": {
        const q = pnlQuery.parse(req.query);
        const out = await svc.pnl(q);
        return sendCsv(res, `cuenta-de-resultados-${out.from}-${out.to}.csv`, pnlCsv(out));
      }
      case "balance": {
        const out = await svc.balance(balanceQuery.parse(req.query).date);
        return sendCsv(res, `balance-${out.date}.csv`, balanceCsv(out));
      }
      case "cashflow": {
        const q = cashflowQuery.parse(req.query);
        const out = await svc.cashflow({ from: q.from, to: q.to, forecastDays: q.forecastDays ? (Number(q.forecastDays) as 0 | 30 | 60 | 90) : undefined });
        return sendCsv(res, `tesoreria-${out.from}-${out.to}.csv`, cashflowCsv(out));
      }
      case "aging": {
        const q = agingQuery.parse(req.query);
        const out = await svc.aging(q.side, q.date);
        return sendCsv(res, `antiguedad-${q.side === "receivable" ? "cobros" : "pagos"}-${out.date}.csv`, agingCsv(out));
      }
      case "expenses": {
        const out = await svc.expenses(expensesQuery.parse(req.query));
        return sendCsv(res, `gastos-${out.groupBy}-${out.from}-${out.to}.csv`, expensesCsv(out));
      }
      case "daily": {
        const out = await svc.daily(z.object({ date: date.optional() }).strict().parse(req.query).date);
        return sendCsv(res, `control-diario-${out.date}.csv`, dailyCsv(out));
      }
      case "revenue-margin": {
        const out = await svc.revenueMargin(yearQuery.parse(req.query).year);
        return sendCsv(res, `revenue-margin-${out.year}.csv`, revenueMarginCsv(out));
      }
      case "conversion-health": {
        const out = await svc.conversion(rangeQuery.parse(req.query));
        return sendCsv(res, `conversion-health-${out.from}-${out.to}.csv`, conversionCsv(out));
      }
    }
  }));
  r.get("/reports/pnl", ...canRead, wrap(async (req, res) => void res.json(await svc.pnl(pnlQuery.parse(req.query)))));
  r.get("/reports/balance", ...canRead, wrap(async (req, res) => void res.json(await svc.balance(balanceQuery.parse(req.query).date))));
  r.get("/reports/cashflow", ...canRead, wrap(async (req, res) => {
    const q = cashflowQuery.parse(req.query);
    res.json(await svc.cashflow({ from: q.from, to: q.to, forecastDays: q.forecastDays ? (Number(q.forecastDays) as 0 | 30 | 60 | 90) : undefined }));
  }));
  r.get("/reports/aging", ...canRead, wrap(async (req, res) => {
    const q = agingQuery.parse(req.query);
    res.json(await svc.aging(q.side, q.date));
  }));
  r.get("/reports/expenses", ...canRead, wrap(async (req, res) => void res.json(await svc.expenses(expensesQuery.parse(req.query)))));

  // Análisis
  r.get("/analytics/revenue-margin", ...canRead, wrap(async (req, res) => void res.json(await svc.revenueMargin(yearQuery.parse(req.query).year, commercialFor(req, commercial)))));
  r.get("/analytics/conversion-health", ...canRead, wrap(async (req, res) => void res.json(await svc.conversion(rangeQuery.parse(req.query)))));
}
