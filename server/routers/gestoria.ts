// Gestoría e Impuestos — router del módulo (Fase 1).
//
// Espina dorsal: tax_obligations. Una fila por modelo fiscal + periodo.
// En esta fase el router cubre: configuración, alta automática de las
// obligaciones del ejercicio, cambio de estado con auditoría y dashboard.
// El motor de cálculo (303/390/111/190/200/202) llega en fases posteriores.

import { z } from "zod";
import { router, permissionProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, asc } from "drizzle-orm";
import {
  taxObligations,
  taxObligationLines,
  taxObligationLog,
  taxSettings,
  finCashAccounts,
} from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

const gestoriaView = permissionProcedure("gestoria.view", ["admin"]);
const gestoriaManage = permissionProcedure("gestoria.manage", ["admin"]);

const OBLIGATION_STATUSES = [
  "pendiente", "estimado", "revisado", "enviado_gestoria", "presentado", "pagado", "aplazado", "cerrado",
] as const;

type TaxModel = "303" | "390" | "111" | "190" | "200" | "202";
type ObligationSpec = {
  model: TaxModel;
  periodType: "trimestral" | "anual";
  periodKey: string;
  periodLabel: string;
  dueDate: string;
};

/**
 * Obligaciones estándar de un ejercicio según el calendario AEAT.
 * Trimestrales: 303 e 111. Anuales: 390, 190, 200. Pagos fraccionados: 202.
 */
function obligationSpecs(year: number): ObligationSpec[] {
  const ny = year + 1;
  const ord = ["1.º", "2.º", "3.º", "4.º"];
  const qDue = ["04-20", "07-20", "10-20"]; // T1, T2, T3 (mismo día para 303 e 111)
  const specs: ObligationSpec[] = [];

  for (let t = 1; t <= 4; t++) {
    specs.push({
      model: "303", periodType: "trimestral", periodKey: `${year}-T${t}`,
      periodLabel: `IVA · ${ord[t - 1]} trimestre ${year}`,
      dueDate: t < 4 ? `${year}-${qDue[t - 1]}` : `${ny}-01-30`,
    });
    specs.push({
      model: "111", periodType: "trimestral", periodKey: `${year}-T${t}`,
      periodLabel: `Retenciones IRPF · ${ord[t - 1]} trimestre ${year}`,
      dueDate: t < 4 ? `${year}-${qDue[t - 1]}` : `${ny}-01-20`,
    });
  }
  specs.push({
    model: "390", periodType: "anual", periodKey: `${year}`,
    periodLabel: `Resumen anual de IVA ${year}`, dueDate: `${ny}-01-30`,
  });
  specs.push({
    model: "190", periodType: "anual", periodKey: `${year}`,
    periodLabel: `Resumen anual de retenciones ${year}`, dueDate: `${ny}-01-31`,
  });
  for (const [p, d] of [["1P", "04-20"], ["2P", "10-20"], ["3P", "12-20"]] as const) {
    specs.push({
      model: "202", periodType: "trimestral", periodKey: `${year}-${p}`,
      periodLabel: `Pago fraccionado Sociedades · ${p} ${year}`, dueDate: `${year}-${d}`,
    });
  }
  specs.push({
    model: "200", periodType: "anual", periodKey: `${year}`,
    periodLabel: `Impuesto sobre Sociedades ${year}`, dueDate: `${ny}-07-25`,
  });
  return specs;
}

/**
 * Crea (idempotentemente) las obligaciones que falten para el ejercicio.
 * Devuelve cuántas se han creado.
 */
async function ensureYearObligations(year: number): Promise<number> {
  const specs = obligationSpecs(year);
  const existing = await db
    .select({ model: taxObligations.model, periodKey: taxObligations.periodKey })
    .from(taxObligations)
    .where(eq(taxObligations.year, year));
  const have = new Set(existing.map((e) => `${e.model}|${e.periodKey}`));
  const toInsert = specs.filter((s) => !have.has(`${s.model}|${s.periodKey}`));
  if (toInsert.length > 0) {
    await db.insert(taxObligations).values(
      toInsert.map((s) => ({
        model: s.model,
        year,
        periodType: s.periodType,
        periodKey: s.periodKey,
        periodLabel: s.periodLabel,
        dueDate: s.dueDate,
      }))
    );
  }
  return toInsert.length;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export const gestoriaRouter = router({
  // ─── Configuración ─────────────────────────────────────────────────────────
  settings: router({
    get: gestoriaView.query(async () => {
      const [row] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
      return row ?? null;
    }),
    update: gestoriaManage
      .input(z.object({
        corporateTaxRate: z.string().optional(),
        fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
        companyNif: z.string().optional(),
        companyName: z.string().optional(),
        companyAddress: z.string().optional(),
        gestoriaEmails: z.string().optional(),
        iaeEpigraphs: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.update(taxSettings).set({ ...input, updatedAt: new Date() }).where(eq(taxSettings.id, 1));
        return { ok: true };
      }),
  }),

  // ─── Obligaciones fiscales ─────────────────────────────────────────────────
  obligations: router({
    list: gestoriaView
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => {
        await ensureYearObligations(input.year);
        return db
          .select()
          .from(taxObligations)
          .where(eq(taxObligations.year, input.year))
          .orderBy(asc(taxObligations.dueDate), asc(taxObligations.model));
      }),

    get: gestoriaView
      .input(z.object({ id: z.number().int() }))
      .query(async ({ input }) => {
        const [obligation] = await db.select().from(taxObligations).where(eq(taxObligations.id, input.id));
        if (!obligation) throw new TRPCError({ code: "NOT_FOUND", message: "Obligación no encontrada" });
        const lines = await db.select().from(taxObligationLines)
          .where(eq(taxObligationLines.obligationId, input.id));
        const log = await db.select().from(taxObligationLog)
          .where(eq(taxObligationLog.obligationId, input.id))
          .orderBy(asc(taxObligationLog.createdAt));
        return { obligation, lines, log };
      }),

    /** Cambia el estado de una obligación y lo registra en la auditoría. */
    setStatus: gestoriaManage
      .input(z.object({
        id: z.number().int(),
        status: z.enum(OBLIGATION_STATUSES),
        note: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const [ob] = await db.select().from(taxObligations).where(eq(taxObligations.id, input.id));
        if (!ob) throw new TRPCError({ code: "NOT_FOUND", message: "Obligación no encontrada" });
        const patch: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
        if (input.status === "presentado" && !ob.presentedAt) patch.presentedAt = new Date();
        if (input.status === "pagado" && !ob.paidAt) patch.paidAt = new Date();
        await db.update(taxObligations).set(patch).where(eq(taxObligations.id, input.id));
        await db.insert(taxObligationLog).values({
          obligationId: input.id,
          fromStatus: ob.status,
          toStatus: input.status,
          userId: ctx.user.id,
          userName: ctx.user.name,
          note: input.note ?? null,
        });
        return { ok: true };
      }),

    /**
     * Asegura las obligaciones del ejercicio. En esta fase solo da de alta las
     * que falten; el cálculo de importes estimados llega en fases posteriores.
     */
    recalculate: gestoriaManage
      .input(z.object({ year: z.number().int() }))
      .mutation(async ({ input }) => {
        const created = await ensureYearObligations(input.year);
        return { ok: true, created };
      }),
  }),

  // ─── Dashboard fiscal ──────────────────────────────────────────────────────
  dashboard: router({
    summary: gestoriaView
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => {
        await ensureYearObligations(input.year);
        const obs = await db.select().from(taxObligations).where(eq(taxObligations.year, input.year));

        const byStatus: Record<string, number> = {};
        for (const o of obs) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

        const open = obs.filter((o) => o.status !== "pagado" && o.status !== "cerrado");
        const pendingEstimated = open.reduce((s, o) => s + Number(o.estimatedAmount ?? 0), 0);

        const today = todayISO();
        const upcoming = open
          .filter((o) => o.dueDate >= today)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .slice(0, 6);
        const overdue = open.filter((o) => o.dueDate < today).length;

        const accounts = await db.select().from(finCashAccounts).where(eq(finCashAccounts.isActive, true));
        const cashAvailable = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0);

        return {
          total: obs.length,
          byStatus,
          pendingCount: open.length,
          presentedCount: byStatus["presentado"] ?? 0,
          paidCount: byStatus["pagado"] ?? 0,
          overdue,
          pendingEstimated,
          cashAvailable,
          upcoming,
        };
      }),
  }),
});
