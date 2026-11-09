/**
 * Contabilidad general (namespace `accountingGeneral`, licenciado con la capacidad `accounting-general` en
 * server/_core/capabilities/routeGuard.ts y comprobado también aquí: sin licencia, 403; en solo lectura, solo
 * consultas y exportaciones). Solo administración. Cada empresa trabaja en su propia BD.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import { ACC_CAPABILITY, ACC_MANUAL_JOURNALS, ACC_MAP_KEYS, ACC_ORIGINS, isAccCode, isAccDate } from "../../shared/accountingGeneral";
import * as svc from "./service";

const date = z.string().refine(isAccDate, "La fecha no es válida (AAAA-MM-DD).");
const code = z.string().refine(isAccCode, "El código de cuenta tiene de 3 a 12 dígitos.");
const period = z.object({ from: date, to: date });
const cents = z.number().int().min(0).max(1_000_000_000_000);
const accountMap = z.object(Object.fromEntries(ACC_MAP_KEYS.map((k) => [k, code])) as Record<(typeof ACC_MAP_KEYS)[number], typeof code>);

const licensed = adminProcedure.use(async ({ type, next }) => {
  const d = await getCapabilityAccess().check(ACC_CAPABILITY, { write: type === "mutation" });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "La contabilidad general no está incluida en tu plan" });
  return next();
});

export const accountingGeneralRouter = router({
  overview: licensed.query(() => svc.overview()),
  /** Genera o corrige los asientos automáticos de los documentos del Core (idempotente). */
  sync: licensed.mutation(({ ctx }) => svc.sync(ctx.user.id)),

  // ── Plan de cuentas ─────────────────────────────────────────────────────
  accounts: licensed.query(() => svc.accountsList()),
  createAccount: licensed.input(z.object({ code: z.string().regex(/^\d{4,12}$/, "La subcuenta tiene de 4 a 12 dígitos."), name: z.string().min(1).max(160) })).mutation(({ input }) => svc.createAccount(input)),
  updateAccount: licensed.input(z.object({ code, name: z.string().min(1).max(160), active: z.boolean() })).mutation(({ input }) => svc.updateAccount(input)),

  // ── Ajustes ─────────────────────────────────────────────────────────────
  settings: licensed.query(() => svc.settingsView()),
  saveSettings: licensed.input(z.object({ startDate: date, lockedUntil: date.nullable(), map: accountMap })).mutation(({ ctx, input }) => svc.saveSettings(input, ctx.user.id)),
  /** Confirma (o retira) el desglose de IVA de un gasto con su factura: solo para la contabilidad general. */
  confirmExpenseTax: licensed.input(z.object({ expenseId: z.number().int().positive(), confirmed: z.boolean() })).mutation(({ ctx, input }) => svc.confirmExpenseTax(input, ctx.user.id)),
  saveCategoryAccount: licensed.input(z.object({ categoryId: z.number().int().positive(), accountCode: code.nullable() })).mutation(({ ctx, input }) => svc.saveCategoryAccount(input, ctx.user.id)),

  // ── Asientos manuales ───────────────────────────────────────────────────
  createEntry: licensed
    .input(
      z.object({
        date,
        journal: z.enum(ACC_MANUAL_JOURNALS),
        description: z.string().min(1).max(500),
        lines: z.array(z.object({ accountCode: code, debitCents: cents, creditCents: cents, description: z.string().max(300).nullish() })).min(2).max(200),
      }),
    )
    .mutation(({ ctx, input }) => svc.createManualEntry(input, ctx.user.id)),
  reverseEntry: licensed.input(z.object({ id: z.number().int().positive(), date: date.nullish(), reason: z.string().min(1).max(300) })).mutation(({ ctx, input }) => svc.reverseManualEntry(input, ctx.user.id)),

  // ── Libros e informes ───────────────────────────────────────────────────
  journal: licensed
    .input(period.extend({ origin: z.enum(ACC_ORIGINS).nullish(), page: z.number().int().min(1).max(100_000).default(1), pageSize: z.number().int().min(10).max(200).default(50) }))
    .query(({ input }) => svc.journal(input)),
  ledger: licensed.input(period.extend({ account: code })).query(({ input }) => svc.ledgerView(input)),
  trialBalance: licensed.input(period).query(({ input }) => svc.trialBalanceView(input)),
  profitAndLoss: licensed.input(period).query(({ input }) => svc.profitAndLossView(input)),
  /** CSV (diario, mayor, sumas y saldos, pérdidas y ganancias) o Excel con los tres libros, para la gestoría. */
  export: licensed
    .input(period.extend({ kind: z.enum(["journal", "ledger", "trial", "pnl", "workbook"]), account: code.nullish() }))
    .query(({ input }) => svc.exportFile(input)),
});
