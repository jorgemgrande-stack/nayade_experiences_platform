/**
 * Avisos de vencimientos fiscales (fase 3) en el ciclo de alertas administrativas del plano de control: alerta
 * `admin.tax_deadline` a 15, 7 y 3 días del vencimiento de cada obligación sin presentar. Cada umbral se avisa una sola
 * vez por obligación (`last_reminder_days`, también entre réplicas) y la clave del hecho evita duplicados en el registro
 * de alertas. Interruptor NUEVO y APAGADO: solo con `CP_FINANCE_TAX_REMINDERS_ENABLED=1`.
 */
import type { AlertFacts } from "../adminAlerts/catalog";
import { periodLabel } from "./taxRules";
import type { FinanceTaxService, TaxReminder } from "./taxService";
import { MODEL_NAMES } from "./taxTypes";

export const TAX_REMINDER_ALERT = "admin.tax_deadline";

export const taxRemindersEnabled = (env: NodeJS.ProcessEnv) => env.CP_FINANCE_TAX_REMINDERS_ENABLED === "1";

const esDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Alerta de un aviso (puro). */
export function taxReminderAlert(r: TaxReminder, now: number): { id: string; facts: AlertFacts } {
  const days = r.daysLeft === 1 ? "1 día" : `${r.daysLeft} días`;
  return {
    id: TAX_REMINDER_ALERT,
    facts: {
      key: `tax:${r.key}:${r.bucket}`,
      occurredAt: now,
      summary: `Vence el modelo ${r.model} (${MODEL_NAMES[r.model]}, ${periodLabel(r.year, r.period)}) el ${esDay(r.dueDate)}: quedan ${days} y aún no consta presentado. El sistema no presenta declaraciones.`,
      status: { label: r.bucket <= 3 ? "Vence en días" : "Próximo vencimiento", tone: r.bucket <= 3 ? "error" : "warning" },
      amount: r.amountCents !== null && r.amountCents > 0 ? { cents: r.amountCents, currency: "EUR" } : null,
      reference: `Modelo ${r.model} · ${r.period} ${r.year}`,
      link: "#/gestoria/calendario",
      intervention: true,
    },
  };
}

/** Paso del ciclo de alertas: avisa de lo que toca y devuelve cuántos avisos se lanzaron. */
export async function runTaxReminders(tax: Pick<FinanceTaxService, "dueReminders">, raise: (id: string, f: AlertFacts) => Promise<unknown>, now: () => number = Date.now): Promise<number> {
  const list = await tax.dueReminders();
  for (const r of list) {
    const a = taxReminderAlert(r, now());
    await raise(a.id, a.facts);
  }
  return list.length;
}
