import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useVocabulary } from "@/lib/vocabulary";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { localizeTemplateText } from "@shared/i18n/emailTemplatesDe";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Send, Monitor, Smartphone, Plus, Pencil, Trash2,
  RotateCcw, Save, ChevronLeft, Loader2, AlertTriangle, Eye, FileText, CheckCircle2, Sparkles, PauseCircle,
} from "lucide-react";

type Category = "all" | "reservas" | "presupuestos" | "anulaciones" | "tpv" | "ticketing" | "sistema";

/** Cada categoría y destinatario se distingue por un tono con significado del sistema (no por un color propio). */
const CATEGORY_TONES: Record<string, Tone> = {
  reservas: "info", presupuestos: "brand", anulaciones: "danger", tpv: "success", ticketing: "warning", sistema: "neutral", general: "neutral",
};
const RECIPIENT_TONES: Record<string, Tone> = { cliente: "success", admin: "warning", ambos: "brand" };

const DEFAULT_BODY = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0a1628">Titulo de la plantilla</h1>
  <p>Contenido del email. Puedes usar HTML completo aqui.</p>
  <a href="#" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:16px">Boton de accion</a>
</div>`;

interface EditForm {
  id: string; name: string; subject: string; description: string;
  headerTitle: string; headerSubtitle: string; bodyHtml: string; isActive: boolean;
}
interface CreateForm {
  id: string; name: string; subject: string; description: string;
  category: string; recipient: string; headerTitle: string; headerSubtitle: string; bodyHtml: string;
}

export default function EmailTemplatesManager() {
  // Nombres de categoría y ejemplos según el modo de la empresa (pedidos en una pyme, reservas en la instalación propia)
  const voc = useVocabulary();
  const { t, locale } = useI18n();
  const baseCategoryLabels: Record<string, string> = {
    reservas: t("emailTemplates.category.reservas"), presupuestos: t("emailTemplates.category.presupuestos"),
    anulaciones: t("emailTemplates.category.anulaciones"), tpv: t("emailTemplates.category.tpv"),
    ticketing: t("emailTemplates.category.ticketing"), sistema: t("emailTemplates.category.sistema"),
    general: t("emailTemplates.category.general"),
  };
  const recipientLabels: Record<string, string> = {
    cliente: t("emailTemplates.recipient.cliente"), admin: t("emailTemplates.recipient.admin"), ambos: t("emailTemplates.recipient.ambos"),
  };
  const categoryLabels: Record<string, string> = { ...baseCategoryLabels, reservas: voc.orders, ticketing: voc.licensed ? t("emailTemplates.category.coupons") : baseCategoryLabels.ticketing };
  const utils = trpc.useUtils();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [testEmail, setTestEmail] = useState("");
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    id: "", name: "", subject: "", description: "", category: "general",
    recipient: "cliente", headerTitle: "", headerSubtitle: "", bodyHtml: DEFAULT_BODY,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null);

  const { data: templates, isLoading: loadingList, error: listError, refetch: refetchList } = trpc.emailTemplates.list.useQuery();
  const { data: fullTemplate, isLoading: loadingFull } = trpc.emailTemplates.get.useQuery(
    { id: selectedId! }, { enabled: !!selectedId && mode === "edit" }
  );
  const { data: preview, isLoading: loadingPreview } = trpc.emailTemplates.preview.useQuery(
    { id: selectedId! }, { enabled: !!selectedId && mode === "view" }
  );

  const saveMutation = trpc.emailTemplates.save.useMutation({
    onSuccess: () => {
      toast.success(t("emailTemplates.toast.saved"));
      utils.emailTemplates.list.invalidate();
      if (selectedId) utils.emailTemplates.preview.invalidate({ id: selectedId });
      setMode("view");
    },
    onError: (err) => toast.error(t("emailTemplates.toast.saveError"), { description: err.message }),
  });
  const createMutation = trpc.emailTemplates.create.useMutation({
    onSuccess: (data) => {
      toast.success(t("emailTemplates.toast.created"));
      utils.emailTemplates.list.invalidate();
      setSelectedId(data.id);
      setMode("view");
    },
    onError: (err) => toast.error(t("emailTemplates.toast.createError"), { description: err.message }),
  });
  const deleteMutation = trpc.emailTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success(t("emailTemplates.toast.deleted"));
      utils.emailTemplates.list.invalidate();
      setSelectedId(null); setMode("view"); setShowDeleteConfirm(null);
    },
    onError: (err) => toast.error(t("emailTemplates.toast.deleteError"), { description: err.message }),
  });
  const restoreMutation = trpc.emailTemplates.restore.useMutation({
    onSuccess: () => {
      toast.success(t("emailTemplates.toast.restored"));
      utils.emailTemplates.list.invalidate();
      if (selectedId) utils.emailTemplates.preview.invalidate({ id: selectedId });
      setShowRestoreConfirm(null);
    },
    onError: (err) => toast.error(t("emailTemplates.toast.restoreError"), { description: err.message }),
  });
  const sendTestMutation = trpc.emailTemplates.sendTest.useMutation({
    onSuccess: (data) => toast.success(t("emailTemplates.toast.testSent"), { description: t("emailTemplates.toast.testSentTo", { email: data.sentTo }) }),
    onError: (err) => toast.error(t("emailTemplates.toast.sendError"), { description: err.message }),
  });
  const sendAllMutation = trpc.emailTemplates.sendAllTests.useMutation({
    onSuccess: (data) => {
      data.failed > 0
        ? toast.error(t("emailTemplates.toast.allSent", { sent: data.sent, total: data.total }), { description: t("emailTemplates.toast.allFailed", { failed: data.failed }) })
        : toast.success(t("emailTemplates.toast.allSent", { sent: data.sent, total: data.total }));
    },
    onError: (err) => toast.error(t("emailTemplates.toast.error"), { description: err.message }),
  });

  const filtered = templates?.filter(t => activeCategory === "all" || t.category === activeCategory) ?? [];
  const categories: { id: Category; label: string; count: number }[] = [
    { id: "all", label: t("emailTemplates.all"), count: templates?.length ?? 0 },
    ...["reservas","presupuestos","anulaciones","tpv","ticketing","sistema"].map(c => ({
      id: c as Category, label: categoryLabels[c] ?? c,
      count: templates?.filter(t => t.category === c).length ?? 0,
    })).filter(c => c.count > 0),
  ];
  const selectedTemplate = templates?.find(t => t.id === selectedId);
  const totals = {
    all: templates?.length ?? 0,
    active: templates?.filter((x) => (x as Record<string, unknown>).isActive !== false).length ?? 0,
    custom: templates?.filter((x) => !!(x as Record<string, unknown>).isCustom).length ?? 0,
    inactive: templates?.filter((x) => (x as Record<string, unknown>).isActive === false).length ?? 0,
  };
  const editDirty = !!(mode === "edit" && editForm && fullTemplate && (() => {
    const ft = fullTemplate as Record<string, unknown>;
    return editForm.name !== fullTemplate.name || editForm.subject !== fullTemplate.subject || editForm.description !== ((ft.description as string) ?? "")
      || editForm.headerTitle !== ((ft.headerTitle as string) ?? "") || editForm.headerSubtitle !== ((ft.headerSubtitle as string) ?? "")
      || editForm.bodyHtml !== ((ft.bodyHtml as string) ?? "") || editForm.isActive !== ((ft.isActive as boolean) ?? true);
  })());

  if (mode === "edit" && fullTemplate && (!editForm || editForm.id !== fullTemplate.id)) {
    const ft = fullTemplate as Record<string, unknown>;
    setEditForm({
      id: fullTemplate.id, name: fullTemplate.name, subject: fullTemplate.subject,
      description: (ft.description as string) ?? "",
      headerTitle: (ft.headerTitle as string) ?? "",
      headerSubtitle: (ft.headerSubtitle as string) ?? "",
      bodyHtml: (ft.bodyHtml as string) ?? "",
      isActive: (ft.isActive as boolean) ?? true,
    });
  }

  return (
    <AdminLayout>
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-background px-4 pt-4 sm:px-6">
        <PanelPageHeader
          className="mb-0 border-b-0 pb-4"
          icon={<Mail />}
          title={t("emailTemplates.title")}
          description={t("emailTemplates.subtitle", { count: templates?.length ?? 0 })}
          actions={<>
            <Input type="email" aria-label={t("emailTemplates.testEmailPlaceholder")} autoComplete="off" name="plantillas-correo-prueba" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder={t("emailTemplates.testEmailPlaceholder")} className="h-8 w-full text-sm sm:w-56" />
            <Button size="sm" variant="outline" onClick={() => sendAllMutation.mutate({ toEmail: testEmail })} disabled={sendAllMutation.isPending || !testEmail}>
              {sendAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              {t("emailTemplates.sendAll")}
            </Button>
            <Button size="sm" onClick={() => { setMode("create"); setSelectedId(null); setEditForm(null); }}>
              <Plus className="h-4 w-4 mr-1" /> {t("emailTemplates.newTemplate")}
            </Button>
          </>}
        />
      </div>
      <WorkplaceLocks place="comms" className="border-b bg-background px-4 py-3 shrink-0 sm:px-6" />
      {!listError && (templates?.length ?? 0) > 0 && (
        <div className="grid shrink-0 grid-cols-2 gap-3 border-b bg-background px-4 py-3 sm:px-6 lg:grid-cols-4">
          <MetricCard compact tone="brand" icon={<FileText />} label={t("emailTemplates.summary.all")} value={totals.all} className="bg-gradient-to-br from-primary/5 to-card" />
          <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("emailTemplates.summary.active")} value={totals.active} />
          <MetricCard compact tone="info" icon={<Sparkles />} label={t("emailTemplates.summary.custom")} value={totals.custom} />
          <MetricCard compact tone={totals.inactive ? "warning" : "neutral"} icon={<PauseCircle />} label={t("emailTemplates.summary.inactive")} value={totals.inactive} />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <div className="flex max-h-72 w-full shrink-0 flex-col overflow-hidden border-b bg-muted/20 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          <div className="flex flex-wrap gap-1 p-3 border-b shrink-0">
            {categories.map(cat => (
              <button key={cat.id} type="button" aria-pressed={activeCategory === cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeCategory === cat.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent"}`}>
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <PanelLoading />
            ) : listError ? (
              <PanelError className="m-3" error={listError} onRetry={() => void refetchList()} title={t("emailTemplates.loadError")} />
            ) : filtered.length === 0 ? (
              <PanelEmpty className="m-3" icon={<Mail />} title={t("emailTemplates.empty")} />
            ) : filtered.map(tpl => {
              const tplAny = tpl as Record<string, unknown>;
              return (
                <button key={tpl.id} type="button" aria-current={selectedId === tpl.id && mode !== "create"} onClick={() => { setSelectedId(tpl.id); setMode("view"); setEditForm(null); }}
                  className={`w-full border-b border-l-2 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === tpl.id && mode !== "create" ? "border-l-primary bg-accent" : "border-l-transparent"}`}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-medium leading-tight">{localizeTemplateText(tpl.name, locale)}</span>
                    {!!(tplAny.isCustom) && <StatusBadge tone="brand" className="shrink-0">{t("emailTemplates.custom")}</StatusBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{localizeTemplateText(tpl.description, locale)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <StatusBadge tone={CATEGORY_TONES[tpl.category] ?? "neutral"}>{categoryLabels[tpl.category] ?? tpl.category}</StatusBadge>
                    <StatusBadge tone={RECIPIENT_TONES[tpl.recipient] ?? "neutral"}>{recipientLabels[tpl.recipient] ?? tpl.recipient}</StatusBadge>
                    {!(tplAny.isActive as boolean) && <StatusBadge tone="danger">{t("emailTemplates.inactive")}</StatusBadge>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden md:min-h-0">
          {mode === "create" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setMode("view")}><ChevronLeft className="h-4 w-4 mr-1" /> {t("emailTemplates.create.back")}</Button>
                <h2 className="text-base font-semibold">{t("emailTemplates.create.title")}</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <h3 className="text-sm font-semibold text-foreground sm:col-span-2">{t("emailTemplates.sectionIdentity")}</h3>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.create.uniqueId")} <span className="text-danger">*</span></Label>
                  <Input placeholder={t("emailTemplates.create.idPlaceholder")} value={createForm.id} onChange={e => setCreateForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") }))} />
                  <p className="text-xs text-muted-foreground">{t("emailTemplates.create.idHint")}</p>
                </div>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.create.visibleName")} <span className="text-danger">*</span></Label>
                  <Input placeholder={t("emailTemplates.create.namePlaceholder")} value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("emailTemplates.create.subject")} <span className="text-danger">*</span></Label>
                  <Input placeholder={t("emailTemplates.create.subjectPlaceholder")} value={createForm.subject} onChange={e => setCreateForm(f => ({ ...f, subject: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.create.category")}</Label>
                  <Select value={createForm.category} onValueChange={v => setCreateForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(categoryLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.create.recipient")}</Label>
                  <Select value={createForm.recipient} onValueChange={v => setCreateForm(f => ({ ...f, recipient: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cliente">{t("emailTemplates.recipient.cliente")}</SelectItem>
                      <SelectItem value="admin">{t("emailTemplates.recipient.adminInternal")}</SelectItem>
                      <SelectItem value="ambos">{t("emailTemplates.recipient.ambos")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <h3 className="border-t pt-4 text-sm font-semibold text-foreground sm:col-span-2">{t("emailTemplates.sectionContent")}</h3>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.edit.headerTitle")}</Label>
                  <Input placeholder={t("emailTemplates.create.headerTitlePlaceholder")} value={createForm.headerTitle} onChange={e => setCreateForm(f => ({ ...f, headerTitle: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>{t("emailTemplates.edit.headerSubtitle")}</Label>
                  <Input placeholder={voc.licensed ? t("emailTemplates.create.headerSubtitleLicensed") : t("emailTemplates.create.headerSubtitleDefault")} value={createForm.headerSubtitle} onChange={e => setCreateForm(f => ({ ...f, headerSubtitle: e.target.value }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("emailTemplates.edit.description")}</Label>
                  <Input placeholder={t("emailTemplates.create.descriptionPlaceholder")} value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("emailTemplates.create.bodyHtml")} <span className="text-danger">*</span></Label>
                  <Textarea className="font-mono text-xs min-h-[300px]" value={createForm.bodyHtml} onChange={e => setCreateForm(f => ({ ...f, bodyHtml: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pb-6">
                <Button variant="outline" onClick={() => setMode("view")}>{t("emailTemplates.create.cancel")}</Button>
                <Button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.id || !createForm.name || !createForm.subject || !createForm.bodyHtml}>
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                  {t("emailTemplates.create.submit")}
                </Button>
              </div>
            </div>
          )}

          {mode === "edit" && selectedId && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setMode("view")}><ChevronLeft className="h-4 w-4 mr-1" /> {t("emailTemplates.create.back")}</Button>
                  <h2 className="min-w-0 break-words text-base font-semibold">{t("emailTemplates.edit.editing", { name: selectedTemplate?.name ?? "" })}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {editDirty && !saveMutation.isPending && <StatusBadge tone="warning">{t("emailTemplates.unsaved")}</StatusBadge>}
                  {!(selectedTemplate as Record<string,unknown>)?.isCustom && (
                    <Button variant="outline" size="sm" onClick={() => setShowRestoreConfirm(selectedId)}><RotateCcw className="h-4 w-4 mr-1" /> {t("emailTemplates.edit.restoreOriginal")}</Button>
                  )}
                  <Button size="sm" onClick={() => editForm && saveMutation.mutate(editForm)} disabled={saveMutation.isPending || !editForm}>
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    {saveMutation.isPending ? t("emailTemplates.saving") : t("emailTemplates.edit.saveChanges")}
                  </Button>
                </div>
              </div>
              {loadingFull || !editForm ? (
                <PanelLoading />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <h3 className="text-sm font-semibold text-foreground sm:col-span-2">{t("emailTemplates.sectionIdentity")}</h3>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>{t("emailTemplates.edit.visibleName")}</Label>
                    <Input value={editForm.name} onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>{t("emailTemplates.edit.subject")}</Label>
                    <Input value={editForm.subject} onChange={e => setEditForm(f => f ? { ...f, subject: e.target.value } : f)} />
                  </div>
                  <h3 className="border-t pt-4 text-sm font-semibold text-foreground sm:col-span-2">{t("emailTemplates.sectionContent")}</h3>
                  <div className="space-y-1">
                    <Label>{t("emailTemplates.edit.headerTitle")}</Label>
                    <Input value={editForm.headerTitle} onChange={e => setEditForm(f => f ? { ...f, headerTitle: e.target.value } : f)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("emailTemplates.edit.headerSubtitle")}</Label>
                    <Input value={editForm.headerSubtitle} onChange={e => setEditForm(f => f ? { ...f, headerSubtitle: e.target.value } : f)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>{t("emailTemplates.edit.description")}</Label>
                    <Input value={editForm.description} onChange={e => setEditForm(f => f ? { ...f, description: e.target.value } : f)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <Label>{t("emailTemplates.edit.bodyHtml")}</Label>
                      <span className="text-xs text-muted-foreground">{t("emailTemplates.edit.fullEditor")}</span>
                    </div>
                    <Textarea className="font-mono text-xs min-h-[400px]" value={editForm.bodyHtml} onChange={e => setEditForm(f => f ? { ...f, bodyHtml: e.target.value } : f)} />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:col-span-2">
                    <input type="checkbox" id="isActive" checked={editForm.isActive} onChange={e => setEditForm(f => f ? { ...f, isActive: e.target.checked } : f)} className="h-4 w-4" />
                    <Label htmlFor="isActive">{t("emailTemplates.edit.active")}</Label>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "view" && !selectedId && (
            <div className="flex flex-1 items-center justify-center p-6">
              <PanelEmpty className="w-full max-w-md" icon={<Eye />} title={t("emailTemplates.view.selectPrompt")} description={t("emailTemplates.view.orCreate")} />
            </div>
          )}

          {mode === "view" && selectedId && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 bg-background shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {selectedTemplate && (
                    <>
                      <span className="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap">{localizeTemplateText(selectedTemplate.name, locale)}</span>
                      <StatusBadge tone={CATEGORY_TONES[selectedTemplate.category] ?? "neutral"} className="shrink-0">{categoryLabels[selectedTemplate.category] ?? selectedTemplate.category}</StatusBadge>
                      <StatusBadge tone={RECIPIENT_TONES[selectedTemplate.recipient] ?? "neutral"} className="shrink-0">{recipientLabels[selectedTemplate.recipient] ?? selectedTemplate.recipient}</StatusBadge>
                      {(selectedTemplate as Record<string,unknown>).isCustom && <StatusBadge tone="brand" className="shrink-0">{t("emailTemplates.custom")}</StatusBadge>}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex rounded-md border overflow-hidden">
                    <button type="button" aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")} className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${previewMode === "desktop" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      <Monitor className="h-3 w-3" /> {t("emailTemplates.view.desktop")}
                    </button>
                    <button type="button" aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")} className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${previewMode === "mobile" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      <Smartphone className="h-3 w-3" /> {t("emailTemplates.view.mobile")}
                    </button>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => sendTestMutation.mutate({ id: selectedId, toEmail: testEmail })} disabled={sendTestMutation.isPending || !testEmail}>
                    {sendTestMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                    {t("emailTemplates.view.sendTest")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
                    <Pencil className="h-3 w-3 mr-1" /> {t("emailTemplates.view.edit")}
                  </Button>
                  {(selectedTemplate as Record<string,unknown>)?.isCustom ? (
                    <Button size="sm" variant="outline" className="text-danger hover:text-danger" onClick={() => setShowDeleteConfirm(selectedId)}>
                      <Trash2 className="h-3 w-3 mr-1" /> {t("emailTemplates.view.delete")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setShowRestoreConfirm(selectedId)}>
                      <RotateCcw className="h-3 w-3 mr-1" /> {t("emailTemplates.view.restore")}
                    </Button>
                  )}
                </div>
              </div>
              {preview && (
                <div className="border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground shrink-0">
                  <span className="font-medium text-foreground">{t("emailTemplates.view.subjectLabel")}</span> {preview.subject}
                </div>
              )}
              <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/20 p-4">
                {loadingPreview ? (
                  <div className="flex items-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">{t("emailTemplates.view.loading")}</span>
                  </div>
                ) : preview ? (
                  <div className={`bg-white shadow-md rounded-lg overflow-hidden transition-all ${previewMode === "mobile" ? "w-full max-w-[390px]" : "w-full max-w-[680px]"}`}>
                    <iframe srcDoc={preview.html} title={t("emailTemplates.view.iframeTitle")} className="w-full border-0" style={{ minHeight: "600px" }}
                      onLoad={e => {
                        const iframe = e.target as HTMLIFrameElement;
                        if (iframe.contentDocument) iframe.style.height = iframe.contentDocument.body.scrollHeight + 32 + "px";
                      }} />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-danger" /> {t("emailTemplates.deleteDialog.title")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("emailTemplates.deleteDialog.text")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>{t("emailTemplates.deleteDialog.cancel")}</Button>
            <Button variant="destructive" onClick={() => showDeleteConfirm && deleteMutation.mutate({ id: showDeleteConfirm })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} {t("emailTemplates.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showRestoreConfirm} onOpenChange={() => setShowRestoreConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-warning" /> {t("emailTemplates.restoreDialog.title")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("emailTemplates.restoreDialog.text")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreConfirm(null)}>{t("emailTemplates.restoreDialog.cancel")}</Button>
            <Button onClick={() => showRestoreConfirm && restoreMutation.mutate({ id: showRestoreConfirm })} disabled={restoreMutation.isPending}>
              {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />} {t("emailTemplates.restoreDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AdminLayout>
  );
}
