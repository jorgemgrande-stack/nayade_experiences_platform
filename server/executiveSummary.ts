// Resumen ejecutivo — foto económica consolidada de la empresa.
//
// Une en un solo cálculo el resultado (P&L), el coste laboral y la carga
// fiscal del ejercicio, llegando al RESULTADO NETO estimado (EBITDA − IS).
// Reutiliza los motores ya existentes; no introduce datos nuevos.
//
// Nota: las nóminas ya están dentro de los gastos (`expenses`), por lo que el
// coste laboral se expone como COMPOSICIÓN del gasto, no como una resta extra.
// La única resta sobre el EBITDA es el Impuesto de Sociedades.

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, like, ne, and } from "drizzle-orm";
import {
  hrPayslips, taxSettings, taxObligations, taxDeferralInstallments, finCashAccounts,
} from "../drizzle/schema";
import { computeCorporate, compute390, compute190 } from "./gestoriaTax";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const db = drizzle(_pool);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ExecutiveSummary = {
  year: number;
  // Resultado
  income: number;
  expenses: number;
  ebitda: number;
  ebitdaMargin: number;
  // Coste laboral (composición del gasto, no resta adicional)
  laborCost: number;
  laborPctOfRevenue: number;
  // Carga fiscal estimada
  vatResult: number;
  irpfRetained: number;
  corporateTax: number;
  fiscalTotal: number;
  // Resultado neto = EBITDA − Impuesto de Sociedades
  netResult: number;
  // Tesorería (horizonte 60 días)
  cashAvailable: number;
  due60: number;
  projected60: number;
  // Alertas
  overdueObligations: number;
};

/**
 * Foto económica consolidada del ejercicio. Es una estimación: el IVA, el IRPF
 * y el Impuesto de Sociedades son cálculos del módulo, no liquidaciones
 * oficiales.
 */
export async function computeExecutiveSummary(year: number): Promise<ExecutiveSummary> {
  const [settings] = await db.select().from(taxSettings).where(eq(taxSettings.id, 1));
  const rate = Number(settings?.corporateTaxRate ?? 25);

  // P&L del ejercicio + Impuesto de Sociedades (computeCorporate ya devuelve
  // ingresos, gastos, resultado=EBITDA y cuota=IS).
  const corp = await computeCorporate(year, rate);
  const ebitda = corp.result;
  const corporateTax = corp.quota;

  // Carga fiscal: IVA anual (390), retenciones IRPF (190) e IS.
  const [vat, irpf] = await Promise.all([compute390(year), compute190(year)]);

  // Coste laboral del ejercicio: salario bruto + SS empresa de las nóminas del
  // año no anuladas. Ya está incluido en `corp.expenses`.
  const yearPayslips = await db
    .select({ grossSalary: hrPayslips.grossSalary, ssCompanyEstimated: hrPayslips.ssCompanyEstimated })
    .from(hrPayslips)
    .where(and(like(hrPayslips.period, `${year}-%`), ne(hrPayslips.status, "anulada")));
  const laborCost = round2(yearPayslips.reduce(
    (s, p) => s + Number(p.grossSalary ?? 0) + Number(p.ssCompanyEstimated ?? 0), 0));

  // Tesorería a 60 días.
  const today = new Date().toISOString().slice(0, 10);
  const limit60 = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();
  const obs = await db.select().from(taxObligations);
  const isOpen = (s: string) => s !== "pagado" && s !== "cerrado" && s !== "aplazado";
  const obDue = obs
    .filter((o) => isOpen(o.status) && o.dueDate >= today && o.dueDate <= limit60)
    .reduce((s, o) => s + Number(o.estimatedAmount ?? 0), 0);
  const insts = await db.select().from(taxDeferralInstallments).where(eq(taxDeferralInstallments.status, "pendiente"));
  const instDue = insts
    .filter((i) => i.dueDate >= today && i.dueDate <= limit60)
    .reduce((s, i) => s + Number(i.amount ?? 0) + Number(i.interest ?? 0), 0);
  const due60 = round2(obDue + instDue);
  const accounts = await db.select().from(finCashAccounts).where(eq(finCashAccounts.isActive, true));
  const cashAvailable = round2(accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0));
  const overdueObligations = obs.filter((o) => isOpen(o.status) && o.dueDate < today).length;

  return {
    year,
    income: corp.income,
    expenses: corp.expenses,
    ebitda,
    ebitdaMargin: corp.income > 0 ? round2((ebitda / corp.income) * 100) : 0,
    laborCost,
    laborPctOfRevenue: corp.income > 0 ? round2((laborCost / corp.income) * 100) : 0,
    vatResult: vat.result,
    irpfRetained: irpf.totalRetention,
    corporateTax,
    fiscalTotal: round2(vat.result + irpf.totalRetention + corporateTax),
    netResult: round2(ebitda - corporateTax),
    cashAvailable,
    due60,
    projected60: round2(cashAvailable - due60),
    overdueObligations,
  };
}
