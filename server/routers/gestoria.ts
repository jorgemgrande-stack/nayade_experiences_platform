// Gestoría e Impuestos — router del módulo (Fase 1).
//
// Espina dorsal: tax_obligations. Una fila por modelo fiscal + periodo.
// En esta fase el router cubre: configuración, alta automática de las
// obligaciones del ejercicio, cambio de estado con auditoría y dashboard.
// El motor de cálculo (303/390/111/190/200/202) llega en fases posteriores.

import { z } from "zod";
import { router, permissionProcedure, publicProcedure, gestoriaProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { randomBytes } from "crypto";
import { eq, asc, desc } from "drizzle-orm";
import {
  taxObligations,
  taxObligationLines,
  taxObligationLog,
  taxSettings,
  taxDossiers,
  taxDeferrals,
  taxDeferralInstallments,
  finCashAccounts,
  users,
} from "../../drizzle/schema";
import { buildDossierZip } from "../gestoriaDossier";
import { storagePut } from "../storage";
import { getUserByInviteToken, setUserPassword } from "../db";
import { sendEmail } from "../mailer";
import { runTaxReminderJob } from "../taxReminderJob";
import { computeExecutiveSummary } from "../executiveSummary";
import {
  compute303, compute390, lines303, type Vat303,
  compute111, compute190, lines111, type Labor111,
  computeCorporate, lines200,
} from "../gestoriaTax";

/** Línea de desglose para persistir en tax_obligation_lines. */
type EstimateLine = { concept: string; base: string; rate: string | null; amount: string; sourceType: string };

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
function addMonthsISO(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Vuelca una estimación a una obligación: reescribe sus líneas de desglose y su
 * `estimatedAmount`. NO toca `presentedAmount` ni el estado, salvo el salto
 * automático pendiente → estimado (nunca pisa lo que la gestoría ya marcó).
 */
async function persistObligationEstimate(
  obs: { id: number; model: string; periodKey: string; status: string }[],
  model: TaxModel,
  periodKey: string,
  estimated: number,
  lines: EstimateLine[],
): Promise<void> {
  const ob = obs.find((o) => o.model === model && o.periodKey === periodKey);
  if (!ob) return;
  await db.delete(taxObligationLines).where(eq(taxObligationLines.obligationId, ob.id));
  if (lines.length > 0) {
    await db.insert(taxObligationLines).values(lines.map((l) => ({ obligationId: ob.id, ...l })));
  }
  const patch: Record<string, unknown> = { estimatedAmount: estimated.toFixed(2), updatedAt: new Date() };
  if (ob.status === "pendiente") patch.status = "estimado";
  await db.update(taxObligations).set(patch).where(eq(taxObligations.id, ob.id));
}

export const gestoriaRouter = router({
  /**
   * Resumen ejecutivo: foto económica consolidada del ejercicio (resultado,
   * coste laboral, carga fiscal, resultado neto y tesorería). Consumido por el
   * Dashboard de Contabilidad y la Cuenta de Resultados.
   */
  executiveSummary: gestoriaView
    .input(z.object({ year: z.number().int() }))
    .query(async ({ input }) => computeExecutiveSummary(input.year)),

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

    /** Previsión de tesorería fiscal a 30/60/90 días. */
    treasury: gestoriaView.query(async () => {
      const today = todayISO();
      const obs = await db.select().from(taxObligations);
      const openObs = obs.filter((o) => !["pagado", "cerrado", "aplazado"].includes(o.status));
      const insts = await db.select().from(taxDeferralInstallments)
        .where(eq(taxDeferralInstallments.status, "pendiente"));
      const accounts = await db.select().from(finCashAccounts).where(eq(finCashAccounts.isActive, true));
      const cashAvailable = round2(accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0));

      const buckets = [30, 60, 90].map((days) => {
        const limit = addDaysISO(today, days);
        const obDue = openObs
          .filter((o) => o.dueDate >= today && o.dueDate <= limit)
          .reduce((s, o) => s + Number(o.estimatedAmount ?? 0), 0);
        const instDue = insts
          .filter((i) => i.dueDate >= today && i.dueDate <= limit)
          .reduce((s, i) => s + Number(i.amount ?? 0) + Number(i.interest ?? 0), 0);
        const due = round2(obDue + instDue);
        return { days, due, balance: round2(cashAvailable - due) };
      });
      return { cashAvailable, buckets };
    }),

    /** Dispara manualmente el envío de avisos de vencimiento (cron diario). */
    sendReminders: gestoriaManage.mutation(async () => {
      return runTaxReminderJob();
    }),
  }),

  // ─── Tributación de IVA (Modelos 303 y 390) ────────────────────────────────
  iva: router({
    /** Estimación del Modelo 303 de un trimestre. periodKey = 'YYYY-TX'. */
    preview303: gestoriaView
      .input(z.object({ periodKey: z.string() }))
      .query(async ({ input }) => compute303(input.periodKey)),

    /** Estimación del Modelo 390 (resumen anual). */
    preview390: gestoriaView
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => compute390(input.year)),

    /**
     * Recalcula el IVA del ejercicio y vuelca la estimación a las obligaciones
     * 303 (×4) y 390. No pisa `presentedAmount` ni el estado salvo el salto
     * automático pendiente → estimado.
     */
    recalculate: gestoriaManage
      .input(z.object({ year: z.number().int() }))
      .mutation(async ({ input }) => {
        const year = input.year;
        await ensureYearObligations(year);
        const obs = await db.select().from(taxObligations).where(eq(taxObligations.year, year));

        const quarters: Vat303[] = [];
        for (let q = 1; q <= 4; q++) {
          const r = await compute303(`${year}-T${q}`);
          quarters.push(r);
          await persistObligationEstimate(obs, "303", `${year}-T${q}`, r.result, lines303(r));
        }
        const annualResult = Number(quarters.reduce((s, q) => s + q.result, 0).toFixed(2));
        const annualLines: EstimateLine[] = quarters.map((r, i) => ({
          concept: `Resultado ${i + 1}.º trimestre`,
          base: r.outputBase.toFixed(2),
          rate: null,
          amount: r.result.toFixed(2),
          sourceType: "303",
        }));
        await persistObligationEstimate(obs, "390", `${year}`, annualResult, annualLines);

        return { ok: true, quarters, annualResult };
      }),
  }),

  // ─── Obligaciones laborales (Modelos 111 y 190) ────────────────────────────
  labor: router({
    /** Estimación del Modelo 111 de un trimestre. periodKey = 'YYYY-TX'. */
    preview111: gestoriaView
      .input(z.object({ periodKey: z.string() }))
      .query(async ({ input }) => compute111(input.periodKey)),

    /** Estimación del Modelo 190 (resumen anual de retenciones). */
    preview190: gestoriaView
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => compute190(input.year)),

    /**
     * Recalcula las retenciones del ejercicio y vuelca la estimación a las
     * obligaciones 111 (×4) y 190.
     */
    recalculate: gestoriaManage
      .input(z.object({ year: z.number().int() }))
      .mutation(async ({ input }) => {
        const year = input.year;
        await ensureYearObligations(year);
        const obs = await db.select().from(taxObligations).where(eq(taxObligations.year, year));

        const quarters: Labor111[] = [];
        for (let q = 1; q <= 4; q++) {
          const r = await compute111(`${year}-T${q}`);
          quarters.push(r);
          await persistObligationEstimate(obs, "111", `${year}-T${q}`, r.totalRetention, lines111(r));
        }
        const annualResult = Number(quarters.reduce((s, q) => s + q.totalRetention, 0).toFixed(2));
        const annualLines: EstimateLine[] = quarters.map((r, i) => ({
          concept: `Retenciones ${i + 1}.º trimestre`,
          base: r.workerBase.toFixed(2),
          rate: null,
          amount: r.totalRetention.toFixed(2),
          sourceType: "111",
        }));
        await persistObligationEstimate(obs, "190", `${year}`, annualResult, annualLines);

        return { ok: true, quarters, annualResult };
      }),
  }),

  // ─── Impuesto de Sociedades (Modelos 200 y 202) ────────────────────────────
  corporate: router({
    /** Estimación del Impuesto de Sociedades y los pagos fraccionados. */
    preview: gestoriaView
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => {
        const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
        const rate = Number(settings?.corporateTaxRate ?? 25);
        return computeCorporate(input.year, rate);
      }),

    /**
     * Recalcula el Impuesto de Sociedades del ejercicio y vuelca la estimación
     * a las obligaciones 200 (cuota anual) y 202 (×3 pagos fraccionados).
     */
    recalculate: gestoriaManage
      .input(z.object({ year: z.number().int() }))
      .mutation(async ({ input }) => {
        const year = input.year;
        const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
        const rate = Number(settings?.corporateTaxRate ?? 25);
        const c = await computeCorporate(year, rate);

        await ensureYearObligations(year);
        const obs = await db.select().from(taxObligations).where(eq(taxObligations.year, year));

        await persistObligationEstimate(obs, "200", `${year}`, c.quota, lines200(c));
        for (const inst of c.installments) {
          await persistObligationEstimate(obs, "202", `${year}-${inst.period}`, inst.payment, [{
            concept: `Pago fraccionado ${inst.period} (modalidad base)`,
            base: String(inst.cumulativeBase),
            rate: null,
            amount: String(inst.payment),
            sourceType: "calc",
          }]);
        }

        return { ok: true, corporate: c };
      }),
  }),

  // ─── Expedientes para la gestoría ──────────────────────────────────────────
  dossiers: router({
    list: gestoriaView
      .input(z.object({ year: z.number().int().optional() }).optional())
      .query(async ({ input }) => {
        const rows = await db.select().from(taxDossiers).orderBy(desc(taxDossiers.createdAt));
        return input?.year ? rows.filter((r) => r.year === input.year) : rows;
      }),

    /** Genera el ZIP del expediente del ejercicio y lo almacena. */
    generate: gestoriaManage
      .input(z.object({ year: z.number().int() }))
      .mutation(async ({ input, ctx }) => {
        const { buffer, fileCount } = await buildDossierZip(input.year);
        const key = `gestoria/dossiers/Expediente_${input.year}_${Date.now()}.zip`;
        const stored = await storagePut(key, buffer, "application/zip");
        const [res] = await db.insert(taxDossiers).values({
          year: input.year,
          scope: "global",
          periodKey: String(input.year),
          title: `Expediente fiscal ${input.year}`,
          fileUrl: stored.url,
          fileKey: stored.key,
          fileSize: buffer.length,
          fileCount,
          generatedBy: ctx.user.id,
        });
        return { ok: true, id: (res as { insertId: number }).insertId, url: stored.url };
      }),
  }),

  // ─── Gestión de accesos al Portal de Gestoría (admin) ──────────────────────
  access: router({
    list: gestoriaView.query(async () => {
      return db
        .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, inviteAccepted: users.inviteAccepted })
        .from(users)
        .where(eq(users.role, "gestoria"));
    }),

    /** Crea (o reutiliza) un usuario con rol gestoria y envía el enlace de activación. */
    createPortalAccess: gestoriaManage
      .input(z.object({ email: z.string().email(), name: z.string().min(2) }))
      .mutation(async ({ input }) => {
        const token = randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
        if (existing) {
          await db.update(users).set({
            role: "gestoria",
            inviteToken: token,
            inviteTokenExpiry: expiry,
            inviteAccepted: false,
          } as any).where(eq(users.id, existing.id));
        } else {
          await db.insert(users).values({
            openId: `invite_${token.slice(0, 16)}`,
            name: input.name,
            email: input.email,
            role: "gestoria",
            inviteToken: token,
            inviteTokenExpiry: expiry,
            inviteAccepted: false,
            isActive: false,
            lastSignedIn: new Date(),
          } as any);
        }

        const origin = process.env.APP_URL ?? "https://www.nayadeexperiences.es";
        const inviteUrl = `${origin}/gestoria/activar?token=${token}`;
        try {
          await sendEmail({
            to: input.email,
            subject: "Acceso al Portal de Gestoría — Náyade Experiences",
            html: `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
                <h2 style="color:#ea580c">Portal de Gestoría</h2>
                <p>Hola <strong>${input.name}</strong>,</p>
                <p>Náyade Experiences le da acceso a su Portal de Gestoría, donde podrá consultar
                las obligaciones fiscales, descargar los expedientes del ejercicio y marcar los
                modelos como presentados.</p>
                <p style="margin:24px 0">
                  <a href="${inviteUrl}" style="background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                    Activar mi cuenta
                  </a>
                </p>
                <p style="color:#666;font-size:13px">El enlace caduca en 7 días.<br>${inviteUrl}</p>
              </div>`,
          });
        } catch (e) {
          console.warn("[gestoria.createPortalAccess] Email no enviado:", e);
        }
        return { ok: true, inviteUrl };
      }),
  }),

  // ─── Portal de Gestoría (acceso de la gestoría externa) ────────────────────
  portal: router({
    /** Activación de cuenta por token (pública — el usuario aún no tiene sesión). */
    activate: publicProcedure
      .input(z.object({
        token: z.string(),
        password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
      }))
      .mutation(async ({ input }) => {
        const user = await getUserByInviteToken(input.token);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Enlace inválido o ya utilizado" });
        if (user.inviteTokenExpiry && new Date() > user.inviteTokenExpiry) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace ha expirado. Solicita uno nuevo." });
        }
        if (user.role !== "gestoria") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Este enlace no corresponde al Portal de Gestoría" });
        }
        const bcrypt = await import("bcryptjs");
        const passwordHash = await bcrypt.hash(input.password, 12);
        await setUserPassword(user.id, passwordHash);
        await db.update(users).set({ isActive: true } as any).where(eq(users.id, user.id));
        return { ok: true, name: user.name };
      }),

    /** Obligaciones del ejercicio visibles para la gestoría. */
    obligations: gestoriaProcedure
      .input(z.object({ year: z.number().int() }))
      .query(async ({ input }) => {
        await ensureYearObligations(input.year);
        return db.select().from(taxObligations)
          .where(eq(taxObligations.year, input.year))
          .orderBy(asc(taxObligations.dueDate), asc(taxObligations.model));
      }),

    /** Expedientes disponibles para descarga. */
    dossiers: gestoriaProcedure.query(async () => {
      return db.select().from(taxDossiers).orderBy(desc(taxDossiers.createdAt));
    }),

    /** La gestoría marca un modelo como presentado. */
    markPresented: gestoriaProcedure
      .input(z.object({ id: z.number().int(), note: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const [ob] = await db.select().from(taxObligations).where(eq(taxObligations.id, input.id));
        if (!ob) throw new TRPCError({ code: "NOT_FOUND", message: "Obligación no encontrada" });
        await db.update(taxObligations).set({
          status: "presentado",
          presentedAt: ob.presentedAt ?? new Date(),
          updatedAt: new Date(),
        }).where(eq(taxObligations.id, input.id));
        await db.insert(taxObligationLog).values({
          obligationId: input.id,
          fromStatus: ob.status,
          toStatus: "presentado",
          userId: ctx.user.id,
          userName: `${ctx.user.name} (gestoría)`,
          note: input.note ?? null,
        });
        return { ok: true };
      }),
  }),

  // ─── Aplazamientos y fraccionamientos ──────────────────────────────────────
  deferrals: router({
    /** Aplazamientos del ejercicio con la obligación asociada. */
    list: gestoriaView
      .input(z.object({ year: z.number().int().optional() }).optional())
      .query(async ({ input }) => {
        const rows = await db
          .select({ deferral: taxDeferrals, obligation: taxObligations })
          .from(taxDeferrals)
          .leftJoin(taxObligations, eq(taxDeferrals.obligationId, taxObligations.id))
          .orderBy(desc(taxDeferrals.createdAt));
        return input?.year ? rows.filter((r) => r.obligation?.year === input.year) : rows;
      }),

    /** Aplazamiento (si existe) de una obligación, con su calendario de cuotas. */
    get: gestoriaView
      .input(z.object({ obligationId: z.number().int() }))
      .query(async ({ input }) => {
        const [obl] = await db.select().from(taxObligations).where(eq(taxObligations.id, input.obligationId));
        if (!obl?.deferralId) return null;
        const [deferral] = await db.select().from(taxDeferrals).where(eq(taxDeferrals.id, obl.deferralId));
        const installments = await db.select().from(taxDeferralInstallments)
          .where(eq(taxDeferralInstallments.deferralId, obl.deferralId))
          .orderBy(asc(taxDeferralInstallments.number));
        return { deferral, installments };
      }),

    /**
     * Registra un aplazamiento de una obligación y genera su calendario de
     * cuotas (mensuales). Marca la obligación como `aplazado`.
     */
    create: gestoriaManage
      .input(z.object({
        obligationId: z.number().int(),
        status: z.enum(["solicitado", "concedido", "denegado", "fraccionado"]).default("solicitado"),
        requestedAt: z.string().optional(),
        principal: z.string(),
        interestRate: z.string().optional(),
        installmentCount: z.number().int().min(1).max(60).default(1),
        firstDueDate: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const [res] = await db.insert(taxDeferrals).values({
          obligationId: input.obligationId,
          status: input.status,
          requestedAt: input.requestedAt ?? null,
          principal: input.principal,
          interestRate: input.interestRate ?? null,
          installmentCount: input.installmentCount,
          notes: input.notes ?? null,
        });
        const deferralId = (res as { insertId: number }).insertId;

        const principal = parseFloat(input.principal) || 0;
        const rate = input.interestRate ? parseFloat(input.interestRate) || 0 : 0;
        const count = input.installmentCount;
        const totalInterest = round2((principal * rate) / 100);
        const baseAmount = Math.floor((principal / count) * 100) / 100;
        const baseInterest = Math.floor((totalInterest / count) * 100) / 100;
        let allocAmt = 0;
        let allocInt = 0;
        const installments = [];
        for (let i = 1; i <= count; i++) {
          const isLast = i === count;
          const amount = isLast ? round2(principal - allocAmt) : baseAmount;
          const interest = isLast ? round2(totalInterest - allocInt) : baseInterest;
          allocAmt += amount;
          allocInt += interest;
          installments.push({
            deferralId,
            number: i,
            dueDate: addMonthsISO(input.firstDueDate, i - 1),
            amount: String(amount),
            interest: String(interest),
          });
        }
        await db.insert(taxDeferralInstallments).values(installments);

        await db.update(taxObligations)
          .set({ deferralId, status: "aplazado", updatedAt: new Date() })
          .where(eq(taxObligations.id, input.obligationId));

        return { ok: true, deferralId };
      }),

    /** Actualiza el estado de un aplazamiento (resolución de la AEAT). */
    updateStatus: gestoriaManage
      .input(z.object({
        id: z.number().int(),
        status: z.enum(["solicitado", "concedido", "denegado", "fraccionado"]),
        resolutionAt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.update(taxDeferrals).set({
          status: input.status,
          resolutionAt: input.resolutionAt ?? null,
          updatedAt: new Date(),
        }).where(eq(taxDeferrals.id, input.id));
        return { ok: true };
      }),

    /** Marca una cuota del aplazamiento como pagada. */
    payInstallment: gestoriaManage
      .input(z.object({ installmentId: z.number().int() }))
      .mutation(async ({ input }) => {
        await db.update(taxDeferralInstallments)
          .set({ status: "pagada", paidAt: todayISO() })
          .where(eq(taxDeferralInstallments.id, input.installmentId));
        return { ok: true };
      }),
  }),
});
