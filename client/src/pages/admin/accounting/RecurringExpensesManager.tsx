import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { toastError } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Play, ArrowLeft, CalendarClock, AlertTriangle, FileText } from "lucide-react";
import { TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { EconomySummary, EconomyTable, FormField, FormSection, RowActions, type EconomyColumn } from "./shared/EconomyUi";

type RecForm = {
  concept: string; amount: string; categoryId: string; costCenterId: string;
  supplierId: string; recurrenceType: string; nextExecutionDate: string;
  // Heredado por cada gasto que dispare este recurrente.
  isOperational: boolean;
};
const emptyForm: RecForm = {
  concept: "", amount: "", categoryId: "", costCenterId: "",
  supplierId: "", recurrenceType: "monthly",
  nextExecutionDate: new Date().toISOString().slice(0, 10),
  isOperational: true,
};

export default function RecurringExpensesManager() {
  const { t } = useI18n();
  const f = useFormat();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RecForm>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);

  const listQ = trpc.financial.recurring.list.useQuery();
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();
  const suppliersQ = trpc.financial.suppliers.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.recurring.create.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success(t("accountingConfig.recurring.created")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const updateMut = trpc.financial.recurring.update.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success(t("accountingConfig.recurring.updated")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const deleteMut = trpc.financial.recurring.delete.useMutation({
    onSuccess: () => { utils.financial.recurring.list.invalidate(); toast.success(t("accountingConfig.recurring.deleted")); },
    onError: (e) => toastError(e),
  });
  const triggerMut = trpc.financial.recurring.trigger.useMutation({
    onSuccess: (data) => {
      utils.financial.recurring.list.invalidate();
      utils.financial.expenses.list.invalidate();
      toast.success(t("accountingConfig.recurring.triggered", { date: day(data.nextExecutionDate) }));
    },
    onError: (e) => toastError(e),
  });

  const items = listQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  function day(iso: string | null | undefined): string {
    return iso ? f.date(new Date(iso + "T00:00:00")) : "—";
  }
  const recurrenceLabel = (r: string): string =>
    r === "weekly" ? t("accountingConfig.recurring.weekly") : r === "yearly" ? t("accountingConfig.recurring.yearly") : t("accountingConfig.recurring.monthly");

  const overdueCount = items.filter((i) => i.nextExecutionDate < today).length;
  const taxOnlyCount = items.filter((i) => (i as any).isOperational === false).length;

  function openCreate() { setEditingId(null); setForm(emptyForm); setShowErrors(false); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({
      concept: item.concept, amount: item.amount, categoryId: String(item.categoryId),
      costCenterId: String(item.costCenterId), supplierId: item.supplierId ? String(item.supplierId) : "",
      recurrenceType: item.recurrenceType, nextExecutionDate: item.nextExecutionDate,
      isOperational: (item as any).isOperational ?? true,
    });
    setShowErrors(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.concept || !form.amount || !form.categoryId || !form.costCenterId) {
      setShowErrors(true);
      toast.error(t("accountingConfig.recurring.requiredFields")); return;
    }
    const payload = {
      concept: form.concept, amount: form.amount, categoryId: Number(form.categoryId),
      costCenterId: Number(form.costCenterId), supplierId: form.supplierId ? Number(form.supplierId) : null,
      recurrenceType: form.recurrenceType as "monthly" | "weekly" | "yearly",
      nextExecutionDate: form.nextExecutionDate,
      isOperational: form.isOperational,
    };
    if (editingId) await updateMut.mutateAsync({ id: editingId, ...payload });
    else await createMut.mutateAsync(payload);
  }

  function getCategoryName(id: number) { return categories.find((c) => c.id === id)?.name ?? t("accountingConfig.recurring.categoryFallback", { id }); }
  function getCostCenterName(id: number) { return costCenters.find((c) => c.id === id)?.name ?? t("accountingConfig.recurring.costCenterFallback", { id }); }

  async function handleTrigger(item: typeof items[number]) {
    if (await confirmAction({ description: t("accountingConfig.recurring.confirmTrigger") })) triggerMut.mutate({ id: item.id });
  }
  async function handleDelete(item: typeof items[number]) {
    if (await confirmAction({ destructive: true, description: t("accountingConfig.recurring.confirmDelete") })) deleteMut.mutate({ id: item.id });
  }

  const columns: EconomyColumn<typeof items[number]>[] = [
    {
      key: "concept",
      header: t("accountingConfig.recurring.colConcept"),
      mobile: "title",
      cell: (i) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{i.concept}</span>
          {(i as any).isOperational === false && (
            <span title={t("accountingConfig.recurring.taxOnlyHint")}>
              <StatusBadge tone="warning">{t("accountingConfig.recurring.taxOnly")}</StatusBadge>
            </span>
          )}
        </span>
      ),
    },
    { key: "category", header: t("accountingConfig.recurring.colCategory"), priority: "md", cell: (i) => <span className="text-muted-foreground">{getCategoryName(i.categoryId)}</span> },
    { key: "recurrence", header: t("accountingConfig.recurring.colRecurrence"), cell: (i) => recurrenceLabel(i.recurrenceType) },
    { key: "amount", header: t("accountingConfig.recurring.colAmount"), align: "right", num: true, mobile: "amount", cell: (i) => f.currency(parseFloat(i.amount)) },
    {
      key: "next",
      header: t("accountingConfig.recurring.colNext"),
      cell: (i) => {
        const overdue = i.nextExecutionDate < today;
        return (
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", overdue && cn("font-medium", TONE_TEXT.danger))}>
            {overdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {day(i.nextExecutionDate)}
            {overdue && <span className="text-xs">{t("accountingConfig.recurring.overdueTag")}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PanelPageHeader
          icon={<RefreshCw />}
          title={t("accountingConfig.recurring.title")}
          description={t("accountingConfig.recurring.description")}
          actions={
            <>
              <Button variant="outline" onClick={() => setLocation("/admin/contabilidad/gastos")} className="gap-1.5"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.common.backToExpenses")}</Button>
              <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.recurring.new")}</Button>
            </>
          }
        />

        {items.length > 0 && (
          <EconomySummary>
            <MetricCard icon={<CalendarClock />} tone="info" label={t("accountingConfig.recurring.kpiScheduled")} value={String(items.length)} detail={t("accountingConfig.recurring.kpiScheduledDetail")} />
            <MetricCard icon={<AlertTriangle />} tone={overdueCount > 0 ? "danger" : "success"} label={t("accountingConfig.recurring.kpiOverdue")} value={String(overdueCount)} detail={overdueCount > 0 ? t("accountingConfig.recurring.kpiOverdueHint") : t("accountingConfig.recurring.kpiOverdueOk")} />
            <MetricCard icon={<FileText />} tone="warning" label={t("accountingConfig.recurring.kpiTaxOnly")} value={String(taxOnlyCount)} detail={t("accountingConfig.recurring.kpiTaxOnlyDetail")} />
          </EconomySummary>
        )}

        <EconomyTable
          rows={items}
          columns={columns}
          rowKey={(i) => i.id}
          caption={t("accountingConfig.recurring.title")}
          loading={listQ.isLoading}
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
          emptyTitle={t("accountingConfig.recurring.emptyTitle")}
          emptyDescription={t("accountingConfig.recurring.emptyHelp")}
          emptyAction={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.recurring.new")}</Button>}
          actions={(i) => (
            <RowActions
              label={i.concept}
              primary={{ label: t("accountingConfig.recurring.generateNow"), icon: <Play className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => void handleTrigger(i) }}
              menu={[
                { label: t("common.edit"), icon: <Pencil />, onSelect: () => openEdit(i) },
                { label: t("common.delete"), icon: <Trash2 />, destructive: true, onSelect: () => void handleDelete(i) },
              ]}
            />
          )}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("accountingConfig.recurring.editTitle") : t("accountingConfig.recurring.newTitle")}</DialogTitle>
            <DialogDescription>{t("accountingConfig.recurring.dialogHelp")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
            <FormSection title={t("accountingConfig.recurring.sectionExpense")}>
              <FormField label={t("accountingConfig.recurring.concept")} required error={showErrors && !form.concept ? t("accountingConfig.recurring.errConcept") : null}>
                <Input value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value })} autoFocus autoComplete="off" />
              </FormField>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("accountingConfig.recurring.amount")} required error={showErrors && !form.amount ? t("accountingConfig.recurring.errAmount") : null}>
                  <Input type="number" step="0.01" inputMode="decimal" className="tabular-nums" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </FormField>
                <FormField label={t("accountingConfig.recurring.supplier")}>
                  <Select value={form.supplierId || "none"} onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t("accountingConfig.recurring.noSupplier")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("accountingConfig.recurring.noSupplier")}</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection title={t("accountingConfig.recurring.sectionClassification")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("accountingConfig.recurring.category")} required error={showErrors && !form.categoryId ? t("accountingConfig.recurring.errCategory") : null}>
                  <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t("accountingConfig.recurring.select")} /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("accountingConfig.recurring.costCenter")} required error={showErrors && !form.costCenterId ? t("accountingConfig.recurring.errCostCenter") : null}>
                  <Select value={form.costCenterId} onValueChange={(v) => setForm({ ...form, costCenterId: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t("accountingConfig.recurring.select")} /></SelectTrigger>
                    <SelectContent>{costCenters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection title={t("accountingConfig.recurring.sectionSchedule")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("accountingConfig.recurring.recurrence")}>
                  <Select value={form.recurrenceType} onValueChange={(v) => setForm({ ...form, recurrenceType: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">{t("accountingConfig.recurring.monthly")}</SelectItem>
                      <SelectItem value="weekly">{t("accountingConfig.recurring.weekly")}</SelectItem>
                      <SelectItem value="yearly">{t("accountingConfig.recurring.yearly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("accountingConfig.recurring.nextRun")} required>
                  <Input type="date" value={form.nextExecutionDate} onChange={(e) => setForm({ ...form, nextExecutionDate: e.target.value })} />
                </FormField>
              </div>
            </FormSection>

            <div className={cn("flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors", form.isOperational ? "border-border bg-muted/20" : TONE_SURFACE.warning)}>
              <div className="min-w-0">
                <Label htmlFor="recurring-operational" className="flex cursor-pointer flex-wrap items-center gap-2">
                  {t("accountingConfig.recurring.operationalLabel")}
                  {!form.isOperational && <StatusBadge tone="warning">{t("accountingConfig.recurring.taxOnly")}</StatusBadge>}
                </Label>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{t("accountingConfig.recurring.operationalHint")}</p>
              </div>
              <Switch id="recurring-operational" checked={form.isOperational} onCheckedChange={(v) => setForm({ ...form, isOperational: v })} />
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>{editingId ? t("common.save") : t("common.create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
