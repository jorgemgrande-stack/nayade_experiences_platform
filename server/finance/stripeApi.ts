/**
 * Finanzas corporativas, fase 2: rutas de Stripe y conciliación bajo /cp/v1/finance (CRM 0036). Permisos
 * (./permissions.ts): lectura = billing:read; importar = billing:write; contabilizar, vincular y revisar = billing:write
 * + sesión de operador; configuración de Stripe = además rol admin|superadmin.
 *
 *   GET   /stripe/settings                                   lectura         configuración
 *   PATCH /stripe/settings                                   configuración   { stripeFeeVat?, feeVatRateBp?, stripePayoutBankAccountId?, disputeAccountCode? }
 *   POST  /stripe/imports                                    gestión         { kind: balance|payouts, filename, contentBase64 }
 *   GET   /stripe/imports                                    lectura         últimas importaciones
 *   GET   /stripe/transactions?type&from&to&payout&status&issue&q&limit&offset   lectura
 *   POST  /stripe/post                                       contabilizar    { until? } → { posted, skipped, errors, truncated }
 *   GET   /stripe/payouts?status&from&to&limit&offset        lectura
 *   GET   /stripe/summary                                    lectura
 *   GET   /reconciliation/invoices?status&from&to&q&limit&offset   lectura
 *   GET   /reconciliation/payouts/:id                        lectura
 *   POST  /reconciliation/payouts/:id/link-bank              contabilizar    { bankMovementId } (sin asiento)
 *   POST  /reconciliation/payouts/:id/unlink-bank            contabilizar
 *   POST  /reconciliation/transactions/:id/review            contabilizar    { note } (incidencia revisada)
 *
 * El fichero llega en base64 dentro del JSON: la ruta de importación lee su cuerpo con un límite propio DESPUÉS de
 * comprobar el permiso (ver FINANCE_UPLOAD_PATHS).
 */
import type { Router } from "express";
import { z } from "zod";
import { actorOf, wrap } from "./http";
import { bigJson } from "./opsApi";
import { canClose, canOperate, canPost, canRead } from "./permissions";
import type { FinanceStripeService } from "./stripeService";
import { RECONCILIATION_STATUSES } from "./stripeRules";
import { FEE_VAT_MODES, PAYOUT_STATUSES, STRIPE_IMPORT_KINDS, STRIPE_TXN_STATUSES, STRIPE_TXN_TYPES } from "./stripeTypes";

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const limit = z.coerce.number().int().min(1).max(500).optional();
const offset = z.coerce.number().int().min(0).optional();
const body = (req: { body?: unknown }) => req.body ?? {};

export function mountFinanceStripeRoutes(r: Router, stripe: FinanceStripeService): void {
  r.get("/stripe/settings", ...canRead, wrap(async (_req, res) => void res.json({ item: await stripe.settings() })));
  r.patch("/stripe/settings", ...canClose, wrap(async (req, res) => {
    const b = z
      .object({
        stripeFeeVat: z.enum(FEE_VAT_MODES).optional(),
        feeVatRateBp: z.number().int().min(0).max(10_000).optional(),
        stripePayoutBankAccountId: z.number().int().positive().nullable().optional(),
        disputeAccountCode: z.string().regex(/^\d{3,12}$/).optional(),
      })
      .strict()
      .parse(body(req));
    res.json({ item: await stripe.saveSettings(b, actorOf(req)) });
  }));

  r.post("/stripe/imports", ...canOperate, bigJson, wrap(async (req, res) => {
    const b = z.object({ kind: z.enum(STRIPE_IMPORT_KINDS), filename: z.string().min(1).max(255), contentBase64: z.string().min(1) }).strict().parse(body(req));
    res.status(201).json({ item: await stripe.importFile(b, actorOf(req)) });
  }));
  r.get("/stripe/imports", ...canRead, wrap(async (_req, res) => {
    const items = await stripe.imports();
    res.json({ items, total: items.length });
  }));

  r.get("/stripe/transactions", ...canRead, wrap(async (req, res) => {
    const q = z
      .object({
        type: z.enum(STRIPE_TXN_TYPES).optional(),
        status: z.enum(STRIPE_TXN_STATUSES).optional(),
        from: date.optional(),
        to: date.optional(),
        payout: z.string().trim().max(80).optional(),
        issue: z.enum(["open"]).optional(),
        q: z.string().trim().max(100).optional(),
        limit,
        offset,
      })
      .strict()
      .parse(req.query);
    const { issue, ...rest } = q;
    res.json(await stripe.transactions({ ...rest, payout: rest.payout || undefined, q: rest.q || undefined, openIssue: issue === "open" }));
  }));
  r.post("/stripe/post", ...canPost, wrap(async (req, res) => {
    const b = z.object({ until: date.optional() }).strict().parse(body(req));
    res.json(await stripe.post(b.until, actorOf(req)));
  }));
  r.get("/stripe/payouts", ...canRead, wrap(async (req, res) => {
    const q = z.object({ status: z.enum(PAYOUT_STATUSES).optional(), from: date.optional(), to: date.optional(), limit, offset }).strict().parse(req.query);
    res.json(await stripe.payouts(q));
  }));
  r.get("/stripe/summary", ...canRead, wrap(async (_req, res) => void res.json(await stripe.summary())));

  r.get("/reconciliation/invoices", ...canRead, wrap(async (req, res) => {
    const q = z.object({ status: z.enum(RECONCILIATION_STATUSES).optional(), from: date.optional(), to: date.optional(), q: z.string().trim().max(100).optional(), limit, offset }).strict().parse(req.query);
    res.json(await stripe.reconciliationInvoices({ ...q, q: q.q || undefined }));
  }));
  r.get("/reconciliation/payouts/:id", ...canRead, wrap(async (req, res) => void res.json({ item: await stripe.reconciliationPayout(id.parse(req.params.id)) })));
  r.post("/reconciliation/payouts/:id/link-bank", ...canPost, wrap(async (req, res) => {
    const b = z.object({ bankMovementId: z.number().int().positive() }).strict().parse(body(req));
    res.json({ item: await stripe.linkBank(id.parse(req.params.id), b.bankMovementId, actorOf(req)) });
  }));
  r.post("/reconciliation/payouts/:id/unlink-bank", ...canPost, wrap(async (req, res) => void res.json({ item: await stripe.unlinkBank(id.parse(req.params.id), actorOf(req)) })));
  r.post("/reconciliation/transactions/:id/review", ...canPost, wrap(async (req, res) => {
    const b = z.object({ note: z.string().max(300) }).strict().parse(body(req));
    res.json({ item: await stripe.reviewTransaction(id.parse(req.params.id), b.note, actorOf(req)) });
  }));
}
