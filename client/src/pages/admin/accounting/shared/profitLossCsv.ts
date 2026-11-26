/**
 * Cuenta de resultados › exportación CSV. Construye el fichero con los mismos números del informe (sin recalcular nada):
 * los importes salen del servidor con dos decimales y punto, formato de intercambio independiente del idioma de la pantalla.
 * Los rótulos del fichero siguen el idioma de la interfaz.
 */
import type { Translate } from "@shared/i18n/core";

export interface ProfitLossCsvInput {
  report: {
    summary: { totalRevenue: number; totalExpenses: number; reservationCount: number };
    revenueByChannel: Array<{ channel: string; amount: number; count: number; ticketMedio: number }>;
    revenueByProduct: Array<{ product: string; amount: number }>;
    expensesByCategory: Array<{ categoryId: number; amount: number }>;
    monthly: Array<{ month: string; revenue: number; expenses: number; profit: number }>;
  };
  prev?: { totalRevenue: number; totalExpenses: number; grossProfit: number } | null;
  ebitda: number;
  ebitdaMargin: number;
  dateFrom: string;
  dateTo: string;
  view: "operational" | "fiscal";
  conciliatedOnly: boolean;
  channelLabel: (channel: string) => string;
  categoryName: (id: number) => string;
  t: Translate;
}

export function buildProfitLossCsv(i: ProfitLossCsvInput): string {
  const { report, prev, ebitda, t } = i;
  const lines: string[] = [
    t("economyPl.csv.title"),
    `${t("economyPl.csv.period")}: ${i.dateFrom} — ${i.dateTo}`,
    `${t("economyPl.csv.view")}: ${i.view === "operational" ? t("economyPl.csv.viewOperational") : t("economyPl.csv.viewFiscal")}`,
    `${t("economyPl.csv.mode")}: ${i.conciliatedOnly ? t("economyPl.csv.modeReconciled") : t("economyPl.csv.modeAll")}`,
    "",
    t("economyPl.csv.summary"),
    `${t("economyPl.csv.revenue")},${report.summary.totalRevenue.toFixed(2)}`,
    `${t("economyPl.csv.expenses")},${report.summary.totalExpenses.toFixed(2)}`,
    `EBITDA,${ebitda.toFixed(2)}`,
    `${t("economyPl.csv.margin")},${i.ebitdaMargin.toFixed(1)}%`,
    `${t("economyPl.csv.reservations")},${report.summary.reservationCount}`,
    "",
    t("economyPl.csv.previous"),
    `${t("economyPl.csv.revenueShort")},${prev?.totalRevenue.toFixed(2) ?? "—"}`,
    `${t("economyPl.csv.expensesShort")},${prev?.totalExpenses.toFixed(2) ?? "—"}`,
    `${t("economyPl.csv.result")},${prev?.grossProfit.toFixed(2) ?? "—"}`,
    "",
    t("economyPl.csv.byChannel"),
    t("economyPl.csv.byChannelHead"),
    ...report.revenueByChannel.map((r) => `${i.channelLabel(r.channel)},${r.amount.toFixed(2)},${r.count},${r.ticketMedio.toFixed(2)}`),
    "",
    t("economyPl.csv.byProduct"),
    t("economyPl.csv.byProductHead"),
    ...report.revenueByProduct.map((r) => `"${r.product}",${r.amount.toFixed(2)}`),
    "",
    t("economyPl.csv.byCategory"),
    t("economyPl.csv.byCategoryHead"),
    ...report.expensesByCategory.map((r) => `${i.categoryName(r.categoryId)},${r.amount.toFixed(2)}`),
    "",
    t("economyPl.csv.monthly"),
    t("economyPl.csv.monthlyHead"),
    ...report.monthly.map((r) => `${r.month},${r.revenue.toFixed(2)},${r.expenses.toFixed(2)},${r.profit.toFixed(2)}`),
  ];
  return lines.join("\n");
}
