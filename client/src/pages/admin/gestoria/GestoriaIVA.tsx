/**
 * Tributación de IVA — Gestoría e Impuestos (Fase 2).
 *
 * Estimación de los Modelos 303 (trimestral) y 390 (resumen anual).
 * IVA repercutido sobre facturas emitidas, REAV sobre margen aparte, IVA
 * soportado deducible desde los gastos. Es una estimación; la liquidación
 * oficial la realiza la gestoría.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, PanelEmpty, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Percent, RefreshCw } from "lucide-react";
import { useGestoriaLabels } from "./gestoriaLabels";
import { EstimateNotice, FiscalTable, FootNote, KeyValueRow, PeriodTabs, ResultBanner, SectionCard, YearSelect } from "./GestoriaParts";

type Tab = "T1" | "T2" | "T3" | "T4" | "anual";
const QUARTERS: Tab[] = ["T1", "T2", "T3", "T4"];

export default function GestoriaIVA() {
  const { t, money } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("T1");
  const utils = trpc.useUtils();

  const isAnnual = tab === "anual";
  const periodKey = isAnnual ? "" : `${year}-${tab}`;

  const q303 = trpc.gestoria.iva.preview303.useQuery({ periodKey }, { enabled: !isAnnual });
  const q390 = trpc.gestoria.iva.preview390.useQuery({ year }, { enabled: isAnnual });

  const recalcMut = trpc.gestoria.iva.recalculate.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.iva.recalculated"));
      utils.gestoria.iva.preview303.invalidate();
      utils.gestoria.iva.preview390.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const resultBanner = (result: number, annual: boolean) => {
    const toPay = result >= 0;
    return (
      <ResultBanner
        tone={toPay ? "warning" : "success"}
        label={annual ? t("gestoria.iva.resultAnnual") : t("gestoria.iva.resultQuarter")}
        hint={toPay ? t("gestoria.iva.toPay") : t("gestoria.iva.toOffset")}
        value={money(Math.abs(result))}
      />
    );
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Percent />}
          title={t("gestoria.iva.title")}
          description={t("gestoria.iva.description")}
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

        <EstimateNotice tone="info">{t("gestoria.iva.estimateNotice")}</EstimateNotice>

        <PeriodTabs
          label={t("gestoria.common.periodLabel")}
          value={tab}
          onChange={setTab}
          options={[...QUARTERS.map((q) => ({ value: q, label: q })), { value: "anual" as Tab, label: t("gestoria.iva.tabAnnual") }]}
        />

        {/* Detalle trimestral */}
        {!isAnnual &&
          (q303.isLoading ? (
            <PanelLoading />
          ) : q303.isError ? (
            <PanelError error={q303.error} onRetry={() => q303.refetch()} />
          ) : q303.data ? (
            <div className="space-y-4">
              {resultBanner(q303.data.result, false)}

              <SectionCard title={t("gestoria.iva.outputTitle")} description={t("gestoria.iva.outputHelp")}>
                {q303.data.outputByRate.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">{t("gestoria.iva.outputEmpty")}</p>
                ) : (
                  <FiscalTable
                    caption={t("gestoria.iva.outputTitle")}
                    rows={q303.data.outputByRate}
                    rowKey={(l) => l.rate}
                    totalLabel={t("gestoria.iva.outputTotal")}
                    columns={[
                      { key: "rate", header: t("gestoria.iva.colRate"), cell: (l) => `${l.rate} %`, total: t("gestoria.iva.outputTotal") },
                      { key: "base", header: t("gestoria.iva.colBase"), num: true, cell: (l) => money(l.base), total: money(q303.data.outputBase) },
                      { key: "amount", header: t("gestoria.iva.colQuota"), num: true, strong: true, cell: (l) => money(l.amount), total: money(q303.data.outputAmount) },
                    ]}
                  />
                )}
              </SectionCard>

              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title={t("gestoria.iva.reavTitle")} description={t("gestoria.iva.reavHelp")}>
                  <dl className="divide-y divide-border">
                    <KeyValueRow label={t("gestoria.iva.reavBase")} value={money(q303.data.reavBase)} />
                    <KeyValueRow label={t("gestoria.iva.reavQuota")} value={money(q303.data.reavAmount)} strong />
                  </dl>
                </SectionCard>
                <SectionCard title={t("gestoria.iva.inputTitle")} description={t("gestoria.iva.inputHelp")}>
                  <dl className="divide-y divide-border">
                    <KeyValueRow label={t("gestoria.iva.inputBase")} value={money(q303.data.inputBase)} />
                    <KeyValueRow label={t("gestoria.iva.inputQuota")} value={money(q303.data.inputAmount)} strong />
                  </dl>
                </SectionCard>
              </div>
            </div>
          ) : (
            <PanelEmpty title={t("gestoria.common.noData")} />
          ))}

        {/* Resumen anual 390 */}
        {isAnnual &&
          (q390.isLoading ? (
            <PanelLoading />
          ) : q390.isError ? (
            <PanelError error={q390.error} onRetry={() => q390.refetch()} />
          ) : q390.data ? (
            <div className="space-y-4">
              {resultBanner(q390.data.result, true)}
              <SectionCard title={t("gestoria.iva.annualTitle", { year })}>
                <FiscalTable
                  caption={t("gestoria.iva.annualTitle", { year })}
                  rows={q390.data.quarters.map((r, i) => ({ ...r, n: i + 1 }))}
                  rowKey={(r) => r.n}
                  columns={[
                    { key: "q", header: t("gestoria.common.colQuarter"), cell: (r) => t("gestoria.common.quarterN", { n: r.n }), total: t("gestoria.common.totalYear") },
                    { key: "out", header: t("gestoria.iva.colOutput"), num: true, cell: (r) => money(r.outputAmount), total: money(q390.data.outputAmount) },
                    { key: "reav", header: t("gestoria.iva.colReav"), num: true, cell: (r) => money(r.reavAmount), total: money(q390.data.reavAmount) },
                    { key: "in", header: t("gestoria.iva.colInput"), num: true, cell: (r) => money(r.inputAmount), total: money(q390.data.inputAmount) },
                    { key: "res", header: t("gestoria.iva.colResult"), num: true, strong: true, cell: (r) => money(r.result), total: money(q390.data.result) },
                  ]}
                />
              </SectionCard>
            </div>
          ) : (
            <PanelEmpty title={t("gestoria.common.noData")} />
          ))}

        <FootNote>{t("gestoria.iva.footNote")}</FootNote>
      </div>
    </AdminLayout>
  );
}
