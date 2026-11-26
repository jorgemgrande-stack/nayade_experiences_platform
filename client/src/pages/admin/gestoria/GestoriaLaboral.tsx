/**
 * Obligaciones Laborales — Gestoría e Impuestos (Fase 3).
 *
 * Estimación de los Modelos 111 (retenciones trimestrales) y 190 (resumen
 * anual). Federa las retenciones del trabajo del módulo RRHH (hr_irpf_ledger)
 * y las retenciones a profesionales practicadas en los gastos.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, PanelEmpty, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, RefreshCw } from "lucide-react";
import { useGestoriaLabels } from "./gestoriaLabels";
import { EstimateNotice, FiscalTable, FootNote, KeyValueRow, PeriodTabs, ResultBanner, SectionCard, YearSelect } from "./GestoriaParts";

type Tab = "T1" | "T2" | "T3" | "T4" | "anual";
const QUARTERS: Tab[] = ["T1", "T2", "T3", "T4"];

export default function GestoriaLaboral() {
  const { t, money } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("T1");
  const utils = trpc.useUtils();

  const isAnnual = tab === "anual";
  const periodKey = isAnnual ? "" : `${year}-${tab}`;

  const q111 = trpc.gestoria.labor.preview111.useQuery({ periodKey }, { enabled: !isAnnual });
  const q190 = trpc.gestoria.labor.preview190.useQuery({ year }, { enabled: isAnnual });

  const recalcMut = trpc.gestoria.labor.recalculate.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.labor.recalculated"));
      utils.gestoria.labor.preview111.invalidate();
      utils.gestoria.labor.preview190.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Users />}
          title={t("gestoria.labor.title")}
          description={t("gestoria.labor.description")}
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

        <EstimateNotice tone="info">{t("gestoria.labor.estimateNotice")}</EstimateNotice>

        <PeriodTabs
          label={t("gestoria.common.periodLabel")}
          value={tab}
          onChange={setTab}
          options={[...QUARTERS.map((q) => ({ value: q, label: q })), { value: "anual" as Tab, label: t("gestoria.labor.tabAnnual") }]}
        />

        {/* Trimestre */}
        {!isAnnual &&
          (q111.isLoading ? (
            <PanelLoading />
          ) : q111.isError ? (
            <PanelError error={q111.error} onRetry={() => q111.refetch()} />
          ) : q111.data ? (
            <div className="space-y-4">
              <ResultBanner tone="warning" label={t("gestoria.labor.totalToPay")} hint={t("gestoria.labor.totalToPayHint")} value={money(q111.data.totalRetention)} />
              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title={t("gestoria.labor.workTitle")} description={t("gestoria.labor.workHelp")}>
                  <dl className="divide-y divide-border">
                    <KeyValueRow label={t("gestoria.labor.workBase", { count: q111.data.workerCount })} value={money(q111.data.workerBase)} />
                    <KeyValueRow label={t("gestoria.labor.withheld")} value={money(q111.data.workerRetention)} strong />
                  </dl>
                </SectionCard>
                <SectionCard title={t("gestoria.labor.proTitle")} description={t("gestoria.labor.proHelp")}>
                  <dl className="divide-y divide-border">
                    <KeyValueRow label={t("gestoria.labor.proBase", { count: q111.data.professionalCount })} value={money(q111.data.professionalBase)} />
                    <KeyValueRow label={t("gestoria.labor.withheld")} value={money(q111.data.professionalRetention)} strong />
                  </dl>
                </SectionCard>
              </div>
            </div>
          ) : (
            <PanelEmpty title={t("gestoria.common.noData")} />
          ))}

        {/* Anual */}
        {isAnnual &&
          (q190.isLoading ? (
            <PanelLoading />
          ) : q190.isError ? (
            <PanelError error={q190.error} onRetry={() => q190.refetch()} />
          ) : q190.data ? (
            <div className="space-y-4">
              <ResultBanner tone="info" label={t("gestoria.labor.totalYear")} value={money(q190.data.totalRetention)} />
              <SectionCard title={t("gestoria.labor.annualTitle", { year })}>
                <FiscalTable
                  caption={t("gestoria.labor.annualTitle", { year })}
                  rows={q190.data.quarters.map((r, i) => ({ ...r, n: i + 1 }))}
                  rowKey={(r) => r.n}
                  columns={[
                    { key: "q", header: t("gestoria.common.colQuarter"), cell: (r) => t("gestoria.common.quarterN", { n: r.n }), total: t("gestoria.common.totalYear") },
                    { key: "work", header: t("gestoria.labor.colWork"), num: true, cell: (r) => money(r.workerRetention), total: money(q190.data.workerRetention) },
                    { key: "pro", header: t("gestoria.labor.colPro"), num: true, cell: (r) => money(r.professionalRetention), total: money(q190.data.professionalRetention) },
                    { key: "total", header: t("gestoria.labor.colTotal"), num: true, strong: true, cell: (r) => money(r.totalRetention), total: money(q190.data.totalRetention) },
                  ]}
                />
              </SectionCard>
            </div>
          ) : (
            <PanelEmpty title={t("gestoria.common.noData")} />
          ))}

        <FootNote>{t("gestoria.labor.footNote")}</FootNote>
      </div>
    </AdminLayout>
  );
}
