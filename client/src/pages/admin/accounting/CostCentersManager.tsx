import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Layers, ArrowLeft, CheckCircle, XCircle, Info } from "lucide-react";
import { TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { EconomyTable, FormField, FormSection, RowActions, type EconomyColumn } from "./shared/EconomyUi";

export default function CostCentersManager() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", active: true });
  const [showErrors, setShowErrors] = useState(false);

  const listQ = trpc.financial.costCenters.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.costCenters.create.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success(t("accountingConfig.costCenters.created")); setDialogOpen(false); },
    onError: () => toast.error(t("accountingConfig.costCenters.createError")),
  });
  const updateMut = trpc.financial.costCenters.update.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success(t("accountingConfig.costCenters.updated")); setDialogOpen(false); },
    onError: () => toast.error(t("accountingConfig.costCenters.updateError")),
  });
  const deleteMut = trpc.financial.costCenters.delete.useMutation({
    onSuccess: () => { utils.financial.costCenters.list.invalidate(); toast.success(t("accountingConfig.costCenters.deleted")); },
    onError: () => toast.error(t("accountingConfig.costCenters.deleteError")),
  });

  const items = listQ.data ?? [];
  const activeCount = items.filter((i) => i.active !== false).length;

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", description: "", active: true });
    setShowErrors(false);
    setDialogOpen(true);
  }

  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({ name: item.name, description: item.description ?? "", active: item.active !== false });
    setShowErrors(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setShowErrors(true); toast.error(t("accountingConfig.costCenters.nameRequired")); return; }
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...form });
    } else {
      await createMut.mutateAsync({ name: form.name, description: form.description || undefined });
    }
  }

  function handleToggleActive(item: typeof items[number]) {
    updateMut.mutate({ id: item.id, name: item.name, active: item.active === false });
  }

  async function handleDelete(item: typeof items[number]) {
    if (await confirmAction({ description: t("accountingConfig.costCenters.confirmDelete", { name: item.name }), destructive: true })) deleteMut.mutate({ id: item.id });
  }

  const columns: EconomyColumn<typeof items[number]>[] = [
    { key: "name", header: t("accountingConfig.common.name"), mobile: "title", cell: (i) => <span className="font-medium text-foreground">{i.name}</span> },
    { key: "description", header: t("accountingConfig.common.description"), cell: (i) => <span className="text-muted-foreground">{i.description ?? "—"}</span> },
    {
      key: "status",
      header: t("accountingConfig.common.status"),
      mobile: "amount",
      cell: (i) => (i.active !== false ? <StatusBadge tone="success">{t("common.active")}</StatusBadge> : <StatusBadge tone="neutral">{t("common.inactive")}</StatusBadge>),
    },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Layers />}
          title={t("accountingConfig.costCenters.title")}
          description={t("accountingConfig.costCenters.description", { active: activeCount, total: items.length })}
          actions={
            <>
              <Button variant="outline" onClick={() => setLocation("/admin/contabilidad/gastos")} className="gap-1.5"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.common.backToExpenses")}</Button>
              <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.costCenters.new")}</Button>
            </>
          }
        />

        {/* Qué es un centro de coste */}
        <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm", TONE_SURFACE.info)}>
          <Info className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_TEXT.info)} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">{t("accountingConfig.costCenters.infoTitle")}</p>
            <p className="mt-0.5 text-muted-foreground">{t("accountingConfig.costCenters.infoBody")}</p>
          </div>
        </div>

        <EconomyTable
          rows={items}
          columns={columns}
          rowKey={(i) => i.id}
          caption={t("accountingConfig.costCenters.title")}
          loading={listQ.isLoading}
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
          emptyTitle={t("accountingConfig.costCenters.emptyTitle")}
          emptyDescription={t("accountingConfig.costCenters.emptyHelp")}
          emptyAction={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.costCenters.new")}</Button>}
          rowClassName={(i) => (i.active === false ? "opacity-60" : undefined)}
          actions={(i) => (
            <RowActions
              label={i.name}
              primary={{ label: t("common.edit"), icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => openEdit(i) }}
              menu={[
                i.active !== false
                  ? { label: t("accountingConfig.common.deactivate"), icon: <XCircle />, onSelect: () => handleToggleActive(i) }
                  : { label: t("accountingConfig.common.activate"), icon: <CheckCircle />, onSelect: () => handleToggleActive(i) },
                { label: t("common.delete"), icon: <Trash2 />, destructive: true, onSelect: () => void handleDelete(i) },
              ]}
            />
          )}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("accountingConfig.costCenters.editTitle") : t("accountingConfig.costCenters.newTitle")}</DialogTitle>
            <DialogDescription>{t("accountingConfig.costCenters.dialogHelp")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
            <FormSection title={t("accountingConfig.common.dataSection")}>
              <FormField label={t("accountingConfig.common.name")} required error={showErrors && !form.name.trim() ? t("accountingConfig.costCenters.nameRequired") : null}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("accountingConfig.costCenters.namePlaceholder")}
                  autoFocus
                  autoComplete="off"
                />
              </FormField>
              <FormField label={t("accountingConfig.common.description")} hint={t("accountingConfig.costCenters.descriptionHint")}>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("accountingConfig.common.optional")} autoComplete="off" />
              </FormField>
            </FormSection>
            {editingId && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <Label htmlFor="cost-center-active" className="cursor-pointer">{t("accountingConfig.costCenters.activeLabel")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("accountingConfig.costCenters.activeHint")}</p>
                </div>
                <Switch id="cost-center-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {editingId ? t("accountingConfig.costCenters.saveChanges") : t("accountingConfig.costCenters.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
