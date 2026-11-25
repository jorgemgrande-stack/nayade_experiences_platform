/**
 * Aplazamientos y Fraccionamientos — Gestoría e Impuestos (Fase 6).
 *
 * Registra aplazamientos de obligaciones ante la AEAT, genera el calendario
 * de cuotas y permite registrar los pagos parciales.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormField, FormSection } from "../accounting/shared/EconomyUi";
import { useGestoriaLabels } from "./gestoriaLabels";
import { FiscalTable, SectionCard, YearSelect } from "./GestoriaParts";

const DEFERRAL_STATUSES = ["solicitado", "concedido", "denegado", "fraccionado"] as const;
const DEFERRAL_TONE: Record<string, Tone> = { solicitado: "info", concedido: "success", denegado: "danger", fraccionado: "brand" };

export default function GestoriaAplazamientos() {
  const { t, modelShort, money, day } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedObligationId, setSelectedObligationId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const deferralLabel = (s: string): string => {
    switch (s) {
      case "solicitado": return t("gestoria.deferrals.statusRequested");
      case "concedido": return t("gestoria.deferrals.statusGranted");
      case "denegado": return t("gestoria.deferrals.statusDenied");
      case "fraccionado": return t("gestoria.deferrals.statusSplit");
      default: return s;
    }
  };

  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });
  const deferralsQ = trpc.gestoria.deferrals.list.useQuery({ year });
  const detailQ = trpc.gestoria.deferrals.get.useQuery(
    { obligationId: selectedObligationId ?? 0 },
    { enabled: selectedObligationId != null },
  );

  const [form, setForm] = useState({
    obligationId: "", principal: "", interestRate: "", installmentCount: "1",
    firstDueDate: "", requestedAt: new Date().toISOString().slice(0, 10),
    status: "solicitado",
  });
  const [showErrors, setShowErrors] = useState(false);

  const createMut = trpc.gestoria.deferrals.create.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.deferrals.created"));
      setForm({ ...form, obligationId: "", principal: "", interestRate: "", installmentCount: "1", firstDueDate: "" });
      setShowErrors(false);
      utils.gestoria.deferrals.list.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const payMut = trpc.gestoria.deferrals.payInstallment.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.deferrals.installmentPaid"));
      utils.gestoria.deferrals.get.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const obligations = obligationsQ.data ?? [];
  const deferrals = deferralsQ.data ?? [];
  // Obligaciones aplazables: sin aplazamiento previo y no pagadas/cerradas.
  const deferrable = obligations.filter(
    (o) => !o.deferralId && o.status !== "pagado" && o.status !== "cerrado",
  );

  function submit() {
    if (!form.obligationId || !form.principal || !form.firstDueDate) {
      setShowErrors(true);
      toast.error(t("gestoria.deferrals.missingFields"));
      return;
    }
    createMut.mutate({
      obligationId: Number(form.obligationId),
      status: form.status as "solicitado" | "concedido" | "denegado" | "fraccionado",
      requestedAt: form.requestedAt || undefined,
      principal: form.principal,
      interestRate: form.interestRate || undefined,
      installmentCount: Number(form.installmentCount) || 1,
      firstDueDate: form.firstDueDate,
    });
  }

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PanelPageHeader
          icon={<CalendarClock />}
          title={t("gestoria.deferrals.title")}
          description={t("gestoria.deferrals.description")}
          actions={<YearSelect year={year} onChange={setYear} />}
        />

        <div className="grid items-start gap-4 lg:grid-cols-5">
          {/* Nuevo aplazamiento */}
          <SectionCard className="lg:col-span-3" title={t("gestoria.deferrals.newTitle")} description={t("gestoria.deferrals.requiredNote")}>
            <div className="space-y-4">
              <FormSection title={t("gestoria.deferrals.sectionWhat")}>
                <FormField
                  label={t("gestoria.deferrals.obligation")}
                  required
                  error={showErrors && !form.obligationId ? t("gestoria.deferrals.errObligation") : null}
                  hint={deferrable.length === 0 ? t("gestoria.deferrals.noneDeferrable") : undefined}
                >
                  <Select value={form.obligationId} onValueChange={(v) => setForm({ ...form, obligationId: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t("gestoria.deferrals.obligationPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {deferrable.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {modelShort(o.model)} · {o.periodLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label={t("gestoria.deferrals.principal")} required error={showErrors && !form.principal ? t("gestoria.deferrals.errPrincipal") : null}>
                    <Input type="number" step="0.01" inputMode="decimal" className="tabular-nums" value={form.principal}
                      onChange={(e) => setForm({ ...form, principal: e.target.value })} placeholder="0.00" />
                  </FormField>
                  <FormField label={t("gestoria.deferrals.installments")}>
                    <Input type="number" min="1" max="60" className="tabular-nums" value={form.installmentCount}
                      onChange={(e) => setForm({ ...form, installmentCount: e.target.value })} />
                  </FormField>
                  <FormField label={t("gestoria.deferrals.interest")}>
                    <Input type="number" step="0.01" inputMode="decimal" className="tabular-nums" value={form.interestRate}
                      onChange={(e) => setForm({ ...form, interestRate: e.target.value })} placeholder="0" />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={t("gestoria.deferrals.sectionWhen")}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label={t("gestoria.deferrals.firstDue")} required error={showErrors && !form.firstDueDate ? t("gestoria.deferrals.errFirstDue") : null}>
                    <Input type="date" value={form.firstDueDate}
                      onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} />
                  </FormField>
                  <FormField label={t("gestoria.deferrals.requestedAt")}>
                    <Input type="date" value={form.requestedAt}
                      onChange={(e) => setForm({ ...form, requestedAt: e.target.value })} />
                  </FormField>
                  <FormField label={t("gestoria.deferrals.status")}>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DEFERRAL_STATUSES.map((k) => <SelectItem key={k} value={k}>{deferralLabel(k)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              </FormSection>

              <div className="flex justify-end">
                <Button onClick={submit} disabled={createMut.isPending} className="gap-2">
                  {createMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}
                  {t("gestoria.deferrals.register")}
                </Button>
              </div>
            </div>
          </SectionCard>

          {/* Aplazamientos existentes */}
          <SectionCard className="lg:col-span-2" title={t("gestoria.deferrals.listTitle")} description={deferrals.length > 0 ? t("gestoria.deferrals.listHelp") : undefined}>
            {deferralsQ.isLoading ? (
              <PanelLoading className="py-4" />
            ) : deferrals.length === 0 ? (
              <PanelEmpty icon={<CalendarClock className="h-5 w-5" />} title={t("gestoria.deferrals.emptyTitle")} description={t("gestoria.deferrals.emptyHelp")} className="border-0" />
            ) : (
              <ul className="space-y-2">
                {deferrals.map((r) => {
                  const selected = selectedObligationId === r.deferral.obligationId;
                  return (
                    <li key={r.deferral.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedObligationId(selected ? null : r.deferral.obligationId)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected ? "border-primary bg-primary/5" : "border-border",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {r.obligation ? `${modelShort(r.obligation.model)} · ${r.obligation.periodLabel}` : t("gestoria.deferrals.obligationFallback")}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <StatusBadge tone={DEFERRAL_TONE[r.deferral.status] ?? "neutral"}>{deferralLabel(r.deferral.status)}</StatusBadge>
                            {t("gestoria.deferrals.installmentCount", { count: r.deferral.installmentCount })}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums text-foreground">
                          {money(r.deferral.principal)}
                          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", selected && "rotate-90")} aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Calendario de cuotas del aplazamiento seleccionado */}
        {selectedObligationId != null && detailQ.data && (
          <SectionCard title={t("gestoria.deferrals.scheduleTitle")} description={t("gestoria.deferrals.scheduleHelp")}>
            <FiscalTable
              caption={t("gestoria.deferrals.scheduleTitle")}
              rows={detailQ.data.installments}
              rowKey={(i) => i.id}
              columns={[
                { key: "n", header: t("gestoria.deferrals.colNumber"), cell: (i) => t("gestoria.deferrals.installmentN", { n: i.number }) },
                { key: "due", header: t("gestoria.deferrals.colDue"), cell: (i) => day(i.dueDate) },
                { key: "amount", header: t("gestoria.deferrals.colAmount"), num: true, cell: (i) => money(i.amount) },
                { key: "interest", header: t("gestoria.deferrals.colInterest"), num: true, cell: (i) => money(i.interest) },
                {
                  key: "state",
                  header: t("gestoria.deferrals.colState"),
                  cell: (i) =>
                    i.status === "pagada" ? (
                      <StatusBadge tone="success" icon={<CheckCircle2 />}>{t("gestoria.deferrals.paid")}</StatusBadge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => payMut.mutate({ installmentId: i.id })}
                        disabled={payMut.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("gestoria.deferrals.pay")}
                      </Button>
                    ),
                },
              ]}
            />
          </SectionCard>
        )}
      </div>
    </AdminLayout>
  );
}
