import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { toastError } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { EconomyTable, FormField, FormSection, RowActions, type EconomyColumn } from "./shared/EconomyUi";

export default function ExpenseCategoriesManager() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [showErrors, setShowErrors] = useState(false);

  const listQ = trpc.financial.categories.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.categories.create.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success(t("accountingConfig.categories.created")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const updateMut = trpc.financial.categories.update.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success(t("accountingConfig.categories.updated")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const deleteMut = trpc.financial.categories.delete.useMutation({
    onSuccess: () => { utils.financial.categories.list.invalidate(); toast.success(t("accountingConfig.categories.deleted")); },
    onError: (e) => toastError(e),
  });

  const items = listQ.data ?? [];

  function openCreate() { setEditingId(null); setForm({ name: "", description: "" }); setShowErrors(false); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) { setEditingId(item.id); setForm({ name: item.name, description: item.description ?? "" }); setShowErrors(false); setDialogOpen(true); }

  async function handleSave() {
    if (!form.name) { setShowErrors(true); toast.error(t("accountingConfig.categories.nameRequired")); return; }
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...form });
    } else {
      await createMut.mutateAsync(form);
    }
  }

  async function handleDelete(item: typeof items[number]) {
    if (await confirmAction({ description: t("accountingConfig.categories.confirmDelete", { name: item.name }), destructive: true })) deleteMut.mutate({ id: item.id });
  }

  const columns: EconomyColumn<typeof items[number]>[] = [
    { key: "name", header: t("accountingConfig.common.name"), mobile: "title", cell: (i) => <span className="font-medium text-foreground">{i.name}</span> },
    { key: "description", header: t("accountingConfig.common.description"), cell: (i) => <span className="text-muted-foreground">{i.description ?? "—"}</span> },
  ];

  return (
    <AdminLayout>
      <EconomyShell screen="categories"
        description={t("accountingConfig.categories.description", { count: items.length })}
        action={
            <>
              <Button variant="outline" onClick={() => setLocation("/admin/contabilidad/gastos")} className="gap-1.5"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.common.backToExpenses")}</Button>
              <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.categories.new")}</Button>
            </>
          }>
      <div className="space-y-6">

        <EconomyTable
          rows={items}
          columns={columns}
          rowKey={(i) => i.id}
          caption={t("accountingConfig.categories.title")}
          loading={listQ.isLoading}
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
          emptyTitle={t("accountingConfig.categories.emptyTitle")}
          emptyDescription={t("accountingConfig.categories.emptyHelp")}
          emptyAction={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.categories.new")}</Button>}
          actions={(i) => (
            <RowActions
              label={i.name}
              primary={{ label: t("common.edit"), icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => openEdit(i) }}
              menu={[{ label: t("common.delete"), icon: <Trash2 />, destructive: true, onSelect: () => void handleDelete(i) }]}
            />
          )}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("accountingConfig.categories.editTitle") : t("accountingConfig.categories.newTitle")}</DialogTitle>
            <DialogDescription>{t("accountingConfig.categories.dialogHelp")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
            <FormSection title={t("accountingConfig.common.dataSection")}>
              <FormField label={t("accountingConfig.common.name")} required error={showErrors && !form.name ? t("accountingConfig.categories.nameRequired") : null}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("accountingConfig.categories.namePlaceholder")} autoFocus autoComplete="off" />
              </FormField>
              <FormField label={t("accountingConfig.common.description")}>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("accountingConfig.common.optional")} autoComplete="off" />
              </FormField>
            </FormSection>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>{editingId ? t("common.save") : t("common.create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </EconomyShell>
    </AdminLayout>
  );
}
