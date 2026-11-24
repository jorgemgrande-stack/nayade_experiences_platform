import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { toastError } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Building2, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { EconomyTable, FormField, FormSection, RowActions, type EconomyColumn } from "./shared/EconomyUi";

type SupplierForm = {
  name: string; fiscalName: string; vatNumber: string;
  address: string; email: string; phone: string; iban: string;
};
const emptyForm: SupplierForm = { name: "", fiscalName: "", vatNumber: "", address: "", email: "", phone: "", iban: "" };

export default function ExpenseSuppliersManager() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);

  const listQ = trpc.financial.suppliers.list.useQuery();
  const utils = trpc.useUtils();

  const createMut = trpc.financial.suppliers.create.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success(t("accountingConfig.suppliers.created")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const updateMut = trpc.financial.suppliers.update.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success(t("accountingConfig.suppliers.updated")); setDialogOpen(false); },
    onError: (e) => toastError(e),
  });
  const deleteMut = trpc.financial.suppliers.delete.useMutation({
    onSuccess: () => { utils.financial.suppliers.list.invalidate(); toast.success(t("accountingConfig.suppliers.deleted")); },
    onError: (e) => toastError(e),
  });

  const items = listQ.data ?? [];

  function openCreate() { setEditingId(null); setForm(emptyForm); setShowErrors(false); setDialogOpen(true); }
  function openEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setForm({
      name: item.name, fiscalName: item.fiscalName ?? "", vatNumber: item.vatNumber ?? "",
      address: item.address ?? "", email: item.email ?? "", phone: item.phone ?? "", iban: item.iban ?? "",
    });
    setShowErrors(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name) { setShowErrors(true); toast.error(t("accountingConfig.suppliers.nameRequired")); return; }
    const payload = { ...form, email: form.email || undefined };
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...payload });
    } else {
      await createMut.mutateAsync(payload);
    }
  }

  async function handleDelete(item: typeof items[number]) {
    if (await confirmAction({ description: t("accountingConfig.suppliers.confirmDelete", { name: item.name }), destructive: true })) deleteMut.mutate({ id: item.id });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const columns: EconomyColumn<typeof items[number]>[] = [
    {
      key: "name",
      header: t("accountingConfig.suppliers.colName"),
      mobile: "title",
      cell: (i) => (
        <span>
          <span className="block font-medium text-foreground">{i.name}</span>
          {i.fiscalName && <span className="block text-xs font-normal text-muted-foreground">{i.fiscalName}</span>}
        </span>
      ),
    },
    { key: "vat", header: t("accountingConfig.suppliers.colVat"), cell: (i) => i.vatNumber ?? dash },
    { key: "email", header: t("accountingConfig.suppliers.colEmail"), priority: "md", cell: (i) => (i.email ? <span className="break-all">{i.email}</span> : dash) },
    { key: "phone", header: t("accountingConfig.suppliers.colPhone"), priority: "lg", cell: (i) => i.phone ?? dash },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Building2 />}
          title={t("accountingConfig.suppliers.title")}
          description={t("accountingConfig.suppliers.description", { count: items.length })}
          actions={
            <>
              <Button variant="outline" onClick={() => setLocation("/admin/contabilidad/gastos")} className="gap-1.5"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.common.backToExpenses")}</Button>
              <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.suppliers.new")}</Button>
            </>
          }
        />

        <EconomyTable
          rows={items}
          columns={columns}
          rowKey={(i) => i.id}
          caption={t("accountingConfig.suppliers.title")}
          loading={listQ.isLoading}
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
          emptyTitle={t("accountingConfig.suppliers.emptyTitle")}
          emptyDescription={t("accountingConfig.suppliers.emptyHelp")}
          emptyAction={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" /> {t("accountingConfig.suppliers.new")}</Button>}
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
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("accountingConfig.suppliers.editTitle") : t("accountingConfig.suppliers.newTitle")}</DialogTitle>
            <DialogDescription>{t("accountingConfig.suppliers.dialogHelp")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
            <FormSection title={t("accountingConfig.suppliers.sectionIdentity")}>
              <FormField label={t("accountingConfig.suppliers.tradeName")} required error={showErrors && !form.name ? t("accountingConfig.suppliers.nameRequired") : null}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus autoComplete="off" />
              </FormField>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("accountingConfig.suppliers.fiscalName")}><Input value={form.fiscalName} onChange={(e) => setForm({ ...form, fiscalName: e.target.value })} autoComplete="off" /></FormField>
                <FormField label={t("accountingConfig.suppliers.vat")}><Input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} autoComplete="off" /></FormField>
              </div>
              <FormField label={t("accountingConfig.suppliers.address")}><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="off" /></FormField>
            </FormSection>
            <FormSection title={t("accountingConfig.suppliers.sectionContact")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("accountingConfig.suppliers.email")}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></FormField>
                <FormField label={t("accountingConfig.suppliers.phone")}><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" /></FormField>
              </div>
              <FormField label={t("accountingConfig.suppliers.iban")} hint={t("accountingConfig.suppliers.ibanHint")}>
                <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES00 0000 0000 00 0000000000" className="tabular-nums" autoComplete="off" />
              </FormField>
            </FormSection>
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
