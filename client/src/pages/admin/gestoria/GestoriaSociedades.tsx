/**
 * Impuesto sobre Sociedades — Gestoría e Impuestos (Fase 4).
 *
 * Estimación del Modelo 200 (cuota anual) y del Modelo 202 (pagos
 * fraccionados, modalidad base). La base imponible se estima como
 * ingresos devengados − gastos deducibles, SIN ajustes extracontables ni
 * amortizaciones formales: es una aproximación, no la liquidación oficial.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, RefreshCw, Download, Landmark, Receipt } from "lucide-react";
import { EconomySummary } from "../accounting/shared/EconomyUi";
import { useGestoriaLabels } from "./gestoriaLabels";
import { EstimateNotice, FiscalTable, FootNote, KeyValueRow, SectionCard, YearSelect } from "./GestoriaParts";

export default function GestoriaSociedades() {
  const { t, money } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const utils = trpc.useUtils();

  const previewQ = trpc.gestoria.corporate.preview.useQuery({ year });
  const recalcMut = trpc.gestoria.corporate.recalculate.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.corporate.recalculated"));
      utils.gestoria.corporate.preview.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  // Exportación dual (operativo / solo fiscal) para gestoría.
  const exportExpensesQ = trpc.gestoria.expenses.exportCsv.useQuery(
    { year },
    { enabled: false }, // se dispara on-demand al pulsar el botón
  );

  async function handleExportExpenses() {
    try {
      const res = await exportExpensesQ.refetch();
      if (res.error || !res.data) {
        toast.error(t("gestoria.corporate.exportFailed", { message: res.error?.message ?? t("gestoria.corporate.unknownError") }));
        return;
      }
      const { fileName, mimeType, contentBase64, counts, totals } = res.data;
      const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        t("gestoria.corporate.exported", {
          total: counts.total,
          operational: counts.operational,
          operationalAmount: money(totals.operational),
          taxOnly: counts.taxOnly,
          taxOnlyAmount: money(totals.taxOnly),
        }),
      );
    } catch (e: any) {
      toast.error(t("gestoria.corporate.exportError", { message: e?.message ?? t("gestoria.corporate.unknownError") }));
    }
  }

  const c = previewQ.data;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Building2 />}
          title={t("gestoria.corporate.title")}
          description={t("gestoria.corporate.description")}
          actions={
            <>
              <YearSelect year={year} onChange={setYear} />
              <Button onClick={() => recalcMut.mutate({ year })} disabled={recalcMut.isPending} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${recalcMut.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                {t("gestoria.common.recalc")}
              </Button>
            </>
          }
        />

        <EstimateNotice>{t("gestoria.corporate.estimateNotice")}</EstimateNotice>

        {previewQ.isError ? (
          <PanelError error={previewQ.error} onRetry={() => previewQ.refetch()} />
        ) : previewQ.isLoading || !c ? (
          <PanelLoading />
        ) : (
          <>
            {/* Resumen */}
            <EconomySummary>
              <MetricCard icon={<Landmark />} tone="warning" label={t("gestoria.corporate.kpiQuota")} value={money(c.quota)} detail={t("gestoria.corporate.kpiQuotaDetail", { rate: c.taxRate })} />
              <MetricCard icon={<Receipt />} tone={c.result >= 0 ? "brand" : "danger"} label={t("gestoria.corporate.kpiResult")} value={money(c.result)} detail={t("gestoria.corporate.kpiResultDetail")} />
            </EconomySummary>
            {c.result <= 0 && <p className="text-xs text-muted-foreground">{t("gestoria.corporate.negativeResult", { result: money(c.result) })}</p>}

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Cuenta de resultados */}
              <SectionCard
                title={t("gestoria.corporate.pnlTitle", { year })}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExpenses}
                    disabled={exportExpensesQ.isFetching}
                    className="gap-2 text-xs"
                    title={t("gestoria.corporate.exportHint")}
                  >
                    {exportExpensesQ.isFetching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                    {t("gestoria.corporate.exportExpenses", { year })}
                  </Button>
                }
              >
                <dl className="divide-y divide-border">
                  <KeyValueRow label={t("gestoria.corporate.income")} value={money(c.income)} />
                  <KeyValueRow label={t("gestoria.corporate.opExpenses")} value={"− " + money(c.expensesOperational)} />
                  {c.expenses - c.expensesOperational !== 0 && <KeyValueRow label={t("gestoria.corporate.taxOnlyExpenses")} value={"− " + money(c.expenses - c.expensesOperational)} muted />}
                  <KeyValueRow label={t("gestoria.corporate.totalDeductible")} value={"− " + money(c.expenses)} />
                  <KeyValueRow label={t("gestoria.corporate.opResult")} value={money(c.resultOperational)} muted />
                  <KeyValueRow label={t("gestoria.corporate.taxResult")} value={money(c.result)} strong />
                </dl>
              </SectionCard>


              {/* Modelo 202 */}
            <SectionCard title={t("gestoria.corporate.m202Title")} description={t("gestoria.corporate.m202Help")}>
              <FiscalTable
                caption={t("gestoria.corporate.m202Title")}
                rows={c.installments}
                rowKey={(i) => i.period}
                columns={[
                  { key: "period", header: t("gestoria.corporate.colPayment"), cell: (i) => i.period },
                  { key: "base", header: t("gestoria.corporate.colBase"), num: true, cell: (i) => money(i.cumulativeBase) },
                  { key: "pay", header: t("gestoria.corporate.colPay"), num: true, strong: true, cell: (i) => money(i.payment) },
                ]}
              />
              </SectionCard>
            </div>
          </>
        )}

        <FootNote>{t("gestoria.corporate.footNote")}</FootNote>
      </div>
    </AdminLayout>
  );
}
