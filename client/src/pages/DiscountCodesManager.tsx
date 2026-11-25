import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, PanelDataList, StatusBadge, type PanelColumn } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Plus, Search, Edit2, Trash2, Copy, ToggleLeft, ToggleRight,
  Tag, Calendar, Users, Percent, Eye,
} from "lucide-react";
import { toastError } from "@/lib/errorMessage";
import { useVocabulary } from "@/lib/vocabulary";
import { useFormat, useI18n } from "@/i18n/I18nProvider";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DiscountCode {
  id: number;
  code: string;
  name: string;
  description: string | null;
  discountPercent: string;
  expiresAt: Date | null;
  status: "active" | "inactive" | "expired";
  maxUses: number | null;
  currentUses: number;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  discountPercent: string;
  expiresAt: string;
  maxUses: string;
  observations: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  discountPercent: "",
  expiresAt: "",
  maxUses: "",
  observations: "",
};

// ─── Status badge ─────────────────────────────────────────────────────────────
function DiscountStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "active") return <StatusBadge tone="success">{t("discounts.status.active")}</StatusBadge>;
  if (status === "inactive") return <StatusBadge tone="warning">{t("discounts.status.inactive")}</StatusBadge>;
  return <StatusBadge tone="danger">{t("discounts.status.expired")}</StatusBadge>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DiscountCodesManager() {
  const voc = useVocabulary();
  const { t } = useI18n();
  const f = useFormat();
  const utils = trpc.useUtils();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "expired">("all");
  const [page, setPage] = useState(1);

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showUses, setShowUses] = useState<number | null>(null);

  // Queries
  const { data, isLoading, error: listError, refetch } = trpc.discounts.list.useQuery({
    search: search || undefined,
    status: statusFilter,
    page,
    pageSize: 20,
  });

  const { data: usesData } = trpc.discounts.getUses.useQuery(
    { discountCodeId: showUses! },
    { enabled: showUses !== null }
  );

  // Mutations
  const createMutation = trpc.discounts.create.useMutation({
    onSuccess: () => { toast.success(t("discounts.toast.created")); utils.discounts.list.invalidate(); closeForm(); },
    onError: (e) => toastError(e),
  });
  const updateMutation = trpc.discounts.update.useMutation({
    onSuccess: () => { toast.success(t("discounts.toast.updated")); utils.discounts.list.invalidate(); closeForm(); },
    onError: (e) => toastError(e),
  });
  const toggleMutation = trpc.discounts.toggleStatus.useMutation({
    onSuccess: () => { utils.discounts.list.invalidate(); },
    onError: (e) => toastError(e),
  });
  const deleteMutation = trpc.discounts.delete.useMutation({
    onSuccess: (res) => {
      if (res.softDeleted) toast.info(t("discounts.toast.softDeleted"));
      else toast.success(t("discounts.toast.deleted"));
      utils.discounts.list.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const duplicateMutation = trpc.discounts.duplicate.useMutation({
    onSuccess: () => { toast.success(t("discounts.toast.duplicated")); utils.discounts.list.invalidate(); },
    onError: (e) => toastError(e),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(code: DiscountCode) {
    setEditingId(code.id);
    setForm({
      code: code.code,
      name: code.name,
      description: code.description ?? "",
      discountPercent: code.discountPercent,
      expiresAt: code.expiresAt ? new Date(code.expiresAt).toISOString().slice(0, 10) : "",
      maxUses: code.maxUses !== null ? String(code.maxUses) : "",
      observations: code.observations ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    const percent = parseFloat(form.discountPercent);
    if (!form.code.trim()) return toast.error(t("discounts.toast.codeRequired"));
    if (!form.name.trim()) return toast.error(t("discounts.toast.nameRequired"));
    if (isNaN(percent) || percent < 1 || percent > 100) return toast.error(t("discounts.toast.percentRange"));

    const payload = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      discountPercent: percent,
      expiresAt: form.expiresAt || null,
      maxUses: form.maxUses ? parseInt(form.maxUses) : null,
      observations: form.observations || undefined,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const items: DiscountCode[] = (data?.items as DiscountCode[]) ?? [];
  const columns: PanelColumn<DiscountCode>[] = [
    {
      key: "code",
      header: t("discounts.col.code"),
      cell: (item) => (
        <div className="space-y-0.5">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-sm font-bold text-primary">{item.code}</span>
          <p className="pt-1 text-sm font-medium text-foreground md:hidden">{item.name}</p>
        </div>
      ),
    },
    {
      key: "name",
      header: t("discounts.col.name"),
      hideOnMobile: true,
      cell: (item) => (
        <div>
          <p className="text-sm font-medium text-foreground">{item.name}</p>
          {item.description && <p className="line-clamp-1 max-w-[220px] text-xs font-normal text-muted-foreground">{item.description}</p>}
        </div>
      ),
    },
    { key: "discount", header: t("discounts.col.discount"), cell: (item) => <span className="text-lg font-bold text-success">{item.discountPercent}%</span> },
    {
      key: "uses",
      header: t("discounts.col.uses"),
      cell: (item) => (
        <span className="text-sm text-foreground">
          {item.currentUses}
          {item.maxUses !== null && <span className="text-muted-foreground"> / {item.maxUses}</span>}
        </span>
      ),
    },
    {
      key: "expires",
      header: t("discounts.col.expires"),
      cell: (item) => item.expiresAt
        ? <span className="text-sm text-muted-foreground">{f.date(new Date(item.expiresAt))}</span>
        : <span className="text-xs text-muted-foreground">{t("discounts.noExpiry")}</span>,
    },
    { key: "status", header: t("discounts.col.status"), cell: (item) => <DiscountStatusBadge status={item.status} /> },
    {
      key: "actions",
      header: t("discounts.col.actions"),
      align: "right",
      cell: (item) => (
        <div className="flex flex-wrap items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-9 w-9" title={t("discounts.action.viewUses")} aria-label={t("discounts.action.viewUses")} onClick={() => setShowUses(item.id)}>
            <Eye className="h-4 w-4 text-info" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title={t("discounts.action.edit")} aria-label={t("discounts.action.edit")} onClick={() => openEdit(item)}>
            <Edit2 className="h-4 w-4 text-warning" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title={t("discounts.action.duplicate")} aria-label={t("discounts.action.duplicate")} onClick={() => duplicateMutation.mutate({ id: item.id })}>
            <Copy className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9"
            title={item.status === "active" ? t("discounts.action.deactivate") : t("discounts.action.activate")}
            aria-label={item.status === "active" ? t("discounts.action.deactivate") : t("discounts.action.activate")}
            onClick={() => toggleMutation.mutate({ id: item.id, active: item.status !== "active" })}>
            {item.status === "active" ? <ToggleRight className="h-4 w-4 text-success" /> : <ToggleLeft className="h-4 w-4 text-warning" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" title={t("discounts.action.delete")} aria-label={t("discounts.action.delete")}
            onClick={async () => {
              if (await confirmAction({ description: t("discounts.confirmDelete", { code: item.code }), destructive: true })) {
                deleteMutation.mutate({ id: item.id });
              }
            }}>
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </div>
      ),
    },
  ];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <AdminLayout title={t("discounts.title")}>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <PanelPageHeader
          icon={<Tag />}
          title={t("discounts.title")}
          description={voc.licensed ? t("discounts.descriptionLicensed") : t("discounts.description")}
          actions={
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> {t("discounts.newCode")}
            </Button>
          }
        />

        {/* Resumen */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard tone="brand" icon={<Tag />} label={t("discounts.stats.total")} value={total} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard tone="success" icon={<ToggleRight />} label={t("discounts.stats.active")} value={items.filter((i) => i.status === "active").length} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard tone="warning" icon={<ToggleLeft />} label={t("discounts.stats.inactive")} value={items.filter((i) => i.status === "inactive").length} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard tone="danger" icon={<Calendar />} label={t("discounts.stats.expired")} value={items.filter((i) => i.status === "expired").length} className="bg-gradient-to-br from-primary/5 to-card" />
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                aria-label={t("discounts.filter.searchPlaceholder")}
                placeholder={t("discounts.filter.searchPlaceholder")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <SegmentedTabs<"all" | "active" | "inactive" | "expired">
              label={t("discounts.filter.statusPlaceholder")}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPage(1); }}
              options={[
                { value: "all", label: t("discounts.filter.all") },
                { value: "active", label: t("discounts.filter.active") },
                { value: "inactive", label: t("discounts.filter.inactive") },
                { value: "expired", label: t("discounts.filter.expired") },
              ]}
            />
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {listError ? (
              <PanelError className="m-4" title={t("discounts.loadError")} error={listError} onRetry={() => void refetch()} />
            ) : isLoading ? (
              <PanelLoading />
            ) : items.length === 0 ? (
              <PanelEmpty className="m-4" icon={<Tag />} title={t("discounts.empty")}>
                <Button onClick={openCreate} variant="outline" className="gap-2">
                  <Plus className="w-4 h-4" /> {t("discounts.createFirst")}
                </Button>
              </PanelEmpty>
            ) : (
              <PanelDataList className="rounded-none border-0" rows={items} columns={columns} rowKey={(i) => i.id} caption={t("discounts.title")} />
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t("discounts.prev")}</Button>
            <span className="text-sm text-muted-foreground self-center">{t("discounts.pageOf", { page, total: totalPages })}</span>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>{t("discounts.next")}</Button>
          </div>
        )}
      </div>

      {/* ── Form Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t("discounts.form.editTitle") : t("discounts.form.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <h3 className="text-sm font-semibold text-foreground">{t("discounts.sections.identity")}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("discounts.form.code")} <span className="text-danger">*</span></Label>
                <Input
                  placeholder="VERANO25"
                  value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  disabled={!!editingId}
                  className="font-mono uppercase"
                />
                <p className="text-xs text-muted-foreground">{t("discounts.form.codeHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("discounts.form.percent")} <span className="text-danger">*</span></Label>
                <div className="relative">
                  <Input
                    type="number" min="1" max="100" step="0.5"
                    placeholder="10"
                    value={form.discountPercent}
                    onChange={(e) => setForm(f => ({ ...f, discountPercent: e.target.value }))}
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("discounts.form.name")} <span className="text-danger">*</span></Label>
              <Input
                placeholder={t("discounts.form.namePlaceholder")}
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("discounts.form.description")}</Label>
              <Input
                placeholder={t("discounts.form.descriptionPlaceholder")}
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <h3 className="border-t border-border pt-4 text-sm font-semibold text-foreground">{t("discounts.sections.validity")}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("discounts.form.expiresAt")}</Label>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{t("discounts.form.expiresHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("discounts.form.maxUses")}</Label>
                <Input
                  type="number" min="1"
                  placeholder={t("discounts.form.maxUsesPlaceholder")}
                  value={form.maxUses}
                  onChange={(e) => setForm(f => ({ ...f, maxUses: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{t("discounts.form.maxUsesHint")}</p>
              </div>
            </div>
            <h3 className="border-t border-border pt-4 text-sm font-semibold text-foreground">{t("discounts.sections.notes")}</h3>
            <div className="space-y-1.5">
              <Label>{t("discounts.form.observations")}</Label>
              <Textarea
                placeholder={t("discounts.form.observationsPlaceholder")}
                value={form.observations}
                onChange={(e) => setForm(f => ({ ...f, observations: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>{t("discounts.form.cancel")}</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? t("discounts.saving") : editingId ? t("discounts.form.save") : t("discounts.form.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Uses Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showUses !== null} onOpenChange={(open) => { if (!open) setShowUses(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-info" /> {t("discounts.uses.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            {!usesData || usesData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t("discounts.uses.none")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("discounts.uses.date")}</TableHead>
                    <TableHead>{t("discounts.uses.channel")}</TableHead>
                    <TableHead className="text-right">{t("discounts.uses.original")}</TableHead>
                    <TableHead className="text-right">{t("discounts.uses.discount")}</TableHead>
                    <TableHead className="text-right">{t("discounts.uses.final")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usesData.map((use) => (
                    <TableRow key={use.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {f.dateTime(new Date(use.appliedAt))}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{use.channel}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{f.currency(parseFloat(use.originalAmount as unknown as string))}</TableCell>
                      <TableCell className="text-right text-sm text-danger">-{f.currency(parseFloat(use.discountAmount as unknown as string))}</TableCell>
                      <TableCell className="text-right text-sm font-bold text-success">{f.currency(parseFloat(use.finalAmount as unknown as string))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUses(null)}>{t("discounts.uses.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
