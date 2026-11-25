/**
 * Configuración Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Parámetros del módulo: tipo de Impuesto de Sociedades, cierre del ejercicio,
 * datos fiscales de la empresa y correos de la gestoría. Singleton (tax_settings).
 */
import { useState, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Settings2, Save } from "lucide-react";
import { FormField, FormSection } from "../accounting/shared/EconomyUi";
import { useGestoriaLabels } from "./gestoriaLabels";

export default function GestoriaConfiguracion() {
  const { t, f } = useGestoriaLabels();
  const utils = trpc.useUtils();
  const settingsQ = trpc.gestoria.settings.get.useQuery();

  const [form, setForm] = useState({
    corporateTaxRate: "25",
    fiscalYearEndMonth: 12,
    companyNif: "",
    companyName: "",
    companyAddress: "",
    gestoriaEmails: "",
    iaeEpigraphs: "",
  });

  useEffect(() => {
    const d = settingsQ.data;
    if (d) {
      setForm({
        corporateTaxRate: d.corporateTaxRate != null ? String(d.corporateTaxRate) : "25",
        fiscalYearEndMonth: d.fiscalYearEndMonth ?? 12,
        companyNif: d.companyNif ?? "",
        companyName: d.companyName ?? "",
        companyAddress: d.companyAddress ?? "",
        gestoriaEmails: d.gestoriaEmails ?? "",
        iaeEpigraphs: d.iaeEpigraphs ?? "",
      });
    }
  }, [settingsQ.data]);

  const updateMut = trpc.gestoria.settings.update.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.settings.saved"));
      utils.gestoria.settings.get.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const monthName = (i: number) => {
    const name = f.date(new Date(2000, i, 1), { month: "long" });
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <PanelPageHeader icon={<Settings2 />} title={t("gestoria.settings.title")} description={t("gestoria.settings.description")} />

        {settingsQ.isLoading ? (
          <PanelLoading />
        ) : settingsQ.isError ? (
          <PanelError error={settingsQ.error} onRetry={() => void settingsQ.refetch()} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateMut.mutate({
                corporateTaxRate: form.corporateTaxRate,
                fiscalYearEndMonth: form.fiscalYearEndMonth,
                companyNif: form.companyNif,
                companyName: form.companyName,
                companyAddress: form.companyAddress,
                gestoriaEmails: form.gestoriaEmails,
                iaeEpigraphs: form.iaeEpigraphs,
              });
            }}
          >
            <FormSection title={t("gestoria.settings.companyTitle")} description={t("gestoria.settings.companyHelp")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("gestoria.settings.nif")}>
                  <Input value={form.companyNif} onChange={(e) => setForm({ ...form, companyNif: e.target.value })} placeholder="B12345678" autoComplete="off" />
                </FormField>
                <FormField label={t("gestoria.settings.companyName")}>
                  <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} autoComplete="off" />
                </FormField>
              </div>
              <FormField label={t("gestoria.settings.address")}>
                <Input value={form.companyAddress} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} autoComplete="off" />
              </FormField>
              <FormField label={t("gestoria.settings.iae")} hint={t("gestoria.settings.iaeHint")}>
                <Input value={form.iaeEpigraphs} onChange={(e) => setForm({ ...form, iaeEpigraphs: e.target.value })} placeholder={t("gestoria.settings.iaePlaceholder")} autoComplete="off" />
              </FormField>
            </FormSection>

            <FormSection title={t("gestoria.settings.yearTitle")} description={t("gestoria.settings.yearHelp")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("gestoria.settings.taxRate")} hint={t("gestoria.settings.taxRateHint")}>
                  <Input
                    type="number" step="0.01" min="0" inputMode="decimal" className="tabular-nums"
                    value={form.corporateTaxRate}
                    onChange={(e) => setForm({ ...form, corporateTaxRate: e.target.value })}
                  />
                </FormField>
                <FormField label={t("gestoria.settings.yearEnd")}>
                  <Select value={String(form.fiscalYearEndMonth)} onValueChange={(v) => setForm({ ...form, fiscalYearEndMonth: Number(v) })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i} value={String(i + 1)}>{monthName(i)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection title={t("gestoria.settings.gestoriaTitle")} description={t("gestoria.settings.gestoriaHelp")}>
              <FormField label={t("gestoria.settings.emails")} hint={t("gestoria.settings.emailsHint")}>
                <Input
                  value={form.gestoriaEmails}
                  onChange={(e) => setForm({ ...form, gestoriaEmails: e.target.value })}
                  placeholder="gestoria@ejemplo.com, contacto@gestoria.com"
                  autoComplete="off"
                />
              </FormField>
            </FormSection>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateMut.isPending} className="gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                {updateMut.isPending ? t("common.saving") : t("gestoria.settings.save")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
