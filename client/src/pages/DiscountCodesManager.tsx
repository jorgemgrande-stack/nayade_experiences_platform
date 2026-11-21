import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelError } from "@/components/admin/PanelStates";
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
function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "active") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">{t("discounts.status.active")}</Badge>;
  if (status === "inactive") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">{t("discounts.status.inactive")}</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{t("discounts.status.expired")}</Badge>;
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
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <AdminLayout title={t("discounts.title")}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Tag className="w-6 h-6 text-violet-400" />
              {t("discounts.title")}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {voc.licensed
                ? t("discounts.descriptionLicensed")
                : t("discounts.description")}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
            <Plus className="w-4 h-4" /> {t("discounts.newCode")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t("discounts.stats.total"), value: total, icon: Tag, color: "text-violet-400" },
            { label: t("discounts.stats.active"), value: items.filter(i => i.status === "active").length, icon: ToggleRight, color: "text-green-400" },
            { label: t("discounts.stats.inactive"), value: items.filter(i => i.status === "inactive").length, icon: ToggleLeft, color: "text-yellow-400" },
            { label: t("discounts.stats.expired"), value: items.filter(i => i.status === "expired").length, icon: Calendar, color: "text-red-400" },
          ].map((stat) => (
            <Card key={stat.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className={`w-8 h-8 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("discounts.filter.searchPlaceholder")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("discounts.filter.statusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("discounts.filter.all")}</SelectItem>
                <SelectItem value="active">{t("discounts.filter.active")}</SelectItem>
                <SelectItem value="inactive">{t("discounts.filter.inactive")}</SelectItem>
                <SelectItem value="expired">{t("discounts.filter.expired")}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {listError ? (
              <PanelError className="m-4" title={t("discounts.loadError")} error={listError} onRetry={() => void refetch()} />
            ) : isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t("discounts.loading")}</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Tag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">{t("discounts.empty")}</p>
                <Button onClick={openCreate} variant="outline" className="mt-4 gap-2">
                  <Plus className="w-4 h-4" /> {t("discounts.createFirst")}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>{t("discounts.col.code")}</TableHead>
                    <TableHead>{t("discounts.col.name")}</TableHead>
                    <TableHead className="text-center">{t("discounts.col.discount")}</TableHead>
                    <TableHead className="text-center">{t("discounts.col.uses")}</TableHead>
                    <TableHead>{t("discounts.col.expires")}</TableHead>
                    <TableHead className="text-center">{t("discounts.col.status")}</TableHead>
                    <TableHead className="text-right">{t("discounts.col.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className="border-border hover:bg-muted/20">
                      <TableCell>
                        <span className="font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-sm">
                          {item.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground text-sm">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-bold text-emerald-400 text-lg">{item.discountPercent}%</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm text-foreground">
                          {item.currentUses}
                          {item.maxUses !== null && <span className="text-muted-foreground"> / {item.maxUses}</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.expiresAt ? (
                          <span className="text-sm text-muted-foreground">
                            {f.date(new Date(item.expiresAt))}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">{t("discounts.noExpiry")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon" title={t("discounts.action.viewUses")}
                            onClick={() => setShowUses(item.id)}
                          >
                            <Eye className="w-4 h-4 text-blue-400" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" title={t("discounts.action.edit")}
                            onClick={() => openEdit(item)}
                          >
                            <Edit2 className="w-4 h-4 text-yellow-400" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" title={t("discounts.action.duplicate")}
                            onClick={() => duplicateMutation.mutate({ id: item.id })}
                          >
                            <Copy className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            title={item.status === "active" ? t("discounts.action.deactivate") : t("discounts.action.activate")}
                            onClick={() => toggleMutation.mutate({ id: item.id, active: item.status !== "active" })}
                          >
                            {item.status === "active"
                              ? <ToggleRight className="w-4 h-4 text-green-400" />
                              : <ToggleLeft className="w-4 h-4 text-yellow-400" />
                            }
                          </Button>
                          <Button
                            variant="ghost" size="icon" title={t("discounts.action.delete")}
                            onClick={() => {
                              if (confirm(t("discounts.confirmDelete", { code: item.code }))) {
                                deleteMutation.mutate({ id: item.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("discounts.form.code")} <span className="text-red-400">*</span></Label>
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
                <Label>{t("discounts.form.percent")} <span className="text-red-400">*</span></Label>
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
              <Label>{t("discounts.form.name")} <span className="text-red-400">*</span></Label>
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
            <div className="grid grid-cols-2 gap-4">
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
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {editingId ? t("discounts.form.save") : t("discounts.form.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Uses Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={showUses !== null} onOpenChange={(open) => { if (!open) setShowUses(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" /> {t("discounts.uses.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
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
                      <TableCell className="text-right text-sm text-red-400">-{f.currency(parseFloat(use.discountAmount as unknown as string))}</TableCell>
                      <TableCell className="text-right text-sm font-bold text-green-400">{f.currency(parseFloat(use.finalAmount as unknown as string))}</TableCell>
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
