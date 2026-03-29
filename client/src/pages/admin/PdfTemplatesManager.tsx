import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Plus, Pencil, Trash2, RotateCcw, Save,
  ChevronLeft, Loader2, Eye, Monitor, Smartphone, Palette,
} from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  facturacion: "Facturación", presupuestos: "Presupuestos",
  tpv: "TPV", proveedores: "Proveedores", general: "General",
};
const CATEGORY_COLORS: Record<string, string> = {
  facturacion: "bg-blue-100 text-blue-800", presupuestos: "bg-purple-100 text-purple-800",
  tpv: "bg-green-100 text-green-800", proveedores: "bg-orange-100 text-orange-800",
  general: "bg-gray-100 text-gray-800",
};

interface EditForm {
  id: string; name: string; description: string; headerColor: string; accentColor: string;
  companyName: string; companyNif: string; companyAddress: string; companyPhone: string;
  companyEmail: string; footerText: string; legalText: string;
  showLogo: boolean; showWatermark: boolean; bodyHtml: string; isActive: boolean;
}
interface CreateForm {
  id: string; name: string; description: string; category: string;
  headerColor: string; accentColor: string; companyName: string; companyNif: string;
  companyAddress: string; companyPhone: string; companyEmail: string;
  footerText: string; legalText: string; showLogo: boolean; showWatermark: boolean; bodyHtml: string;
}

const DEFAULT_BODY = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/>
<style>
  body { font-family:'Helvetica Neue',Arial,sans-serif; margin:0; padding:0; background:#f8f9fa; }
  .page { max-width:800px; margin:0 auto; background:#fff; padding:48px; }
  .header { border-bottom:3px solid {{headerColor}}; padding-bottom:24px; margin-bottom:32px; }
  .footer { margin-top:48px; padding-top:20px; border-top:1px solid #e5e7eb; text-align:center; font-size:11px; color:#9ca3af; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1 style="color:{{headerColor}};margin:0;">{{companyName}}</h1>
  </div>
  <p>Contenido del documento PDF. Puedes usar HTML completo con estilos inline.</p>
  <div class="footer"><p>{{footerText}}</p></div>
</div>
</body>
</html>`;

export default function PdfTemplatesManager() {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    id: "", name: "", description: "", category: "general",
    headerColor: "#0a1628", accentColor: "#f97316",
    companyName: "Náyade Experiences S.L.", companyNif: "B-XXXXXXXX",
    companyAddress: "Embalse de Los Ángeles, Ávila",
    companyPhone: "+34 930 34 77 91", companyEmail: "reservas@nayadeexperiences.es",
    footerText: "Náyade Experiences · www.nayadeexperiences.es",
    legalText: "", showLogo: true, showWatermark: false, bodyHtml: DEFAULT_BODY,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const { data: templates, isLoading: loadingList } = trpc.pdfTemplates.list.useQuery();
  const { data: fullTemplate, isLoading: loadingFull } = trpc.pdfTemplates.get.useQuery(
    { id: selectedId! }, { enabled: !!selectedId && (mode === "edit" || mode === "view") }
  );

  const saveMutation = trpc.pdfTemplates.save.useMutation({
    onSuccess: () => {
      toast.success("Plantilla PDF guardada");
      utils.pdfTemplates.list.invalidate();
      if (selectedId) utils.pdfTemplates.get.invalidate({ id: selectedId });
      setMode("view");
    },
    onError: (err) => toast.error("Error al guardar", { description: err.message }),
  });
  const createMutation = trpc.pdfTemplates.create.useMutation({
    onSuccess: (data) => {
      toast.success("Plantilla PDF creada");
      utils.pdfTemplates.list.invalidate();
      setSelectedId(data.id);
      setMode("view");
    },
    onError: (err) => toast.error("Error al crear", { description: err.message }),
  });
  const deleteMutation = trpc.pdfTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success("Plantilla eliminada");
      utils.pdfTemplates.list.invalidate();
      setSelectedId(null); setMode("view"); setShowDeleteConfirm(null);
    },
    onError: (err) => toast.error("Error al eliminar", { description: err.message }),
  });
  const restoreMutation = trpc.pdfTemplates.restore.useMutation({
    onSuccess: () => {
      toast.success("Plantilla restaurada a valores originales");
      utils.pdfTemplates.list.invalidate();
      if (selectedId) utils.pdfTemplates.get.invalidate({ id: selectedId });
      setShowRestoreConfirm(null);
    },
    onError: (err) => toast.error("Error al restaurar", { description: err.message }),
  });

  const filtered = templates?.filter(t => activeCategory === "all" || t.category === activeCategory) ?? [];
  const categories = [
    { id: "all", label: "Todas", count: templates?.length ?? 0 },
    ...["facturacion","presupuestos","tpv","proveedores","general"].map(c => ({
      id: c, label: CATEGORY_LABELS[c] ?? c,
      count: templates?.filter(t => t.category === c).length ?? 0,
    })).filter(c => c.count > 0),
  ];

  if (mode === "edit" && fullTemplate && (!editForm || editForm.id !== fullTemplate.id)) {
    const ft = fullTemplate as Record<string, unknown>;
    setEditForm({
      id: fullTemplate.id, name: fullTemplate.name,
      description: (ft.description as string) ?? "",
      headerColor: (ft.headerColor as string) ?? "#0a1628",
      accentColor: (ft.accentColor as string) ?? "#f97316",
      companyName: (ft.companyName as string) ?? "",
      companyNif: (ft.companyNif as string) ?? "",
      companyAddress: (ft.companyAddress as string) ?? "",
      companyPhone: (ft.companyPhone as string) ?? "",
      companyEmail: (ft.companyEmail as string) ?? "",
      footerText: (ft.footerText as string) ?? "",
      legalText: (ft.legalText as string) ?? "",
      showLogo: (ft.showLogo as boolean) ?? true,
      showWatermark: (ft.showWatermark as boolean) ?? false,
      bodyHtml: (ft.bodyHtml as string) ?? "",
      isActive: (ft.isActive as boolean) ?? true,
    });
  }

  const handleSave = () => {
    if (!editForm) return;
    saveMutation.mutate(editForm);
  };

  const handleCreate = () => {
    if (!createForm.id || !createForm.name || !createForm.bodyHtml) {
      toast.error("ID, nombre y HTML son obligatorios");
      return;
    }
    createMutation.mutate(createForm);
  };

  return (
    <AdminLayout>
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Plantillas PDF</h1>
            <p className="text-xs text-muted-foreground">{templates?.length ?? 0} plantillas &middot; Facturas, Presupuestos, Tickets, Liquidaciones</p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setMode("create"); setSelectedId(null); setEditForm(null); }}>
          <Plus className="h-4 w-4 mr-1" /> Nueva plantilla PDF
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar list */}
        <div className="flex w-72 shrink-0 flex-col border-r bg-muted/20 overflow-hidden">
          <div className="flex flex-wrap gap-1 p-3 border-b shrink-0">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${activeCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}>
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin plantillas</p>
            ) : filtered.map(tpl => {
              const tplAny = tpl as Record<string, unknown>;
              return (
                <button key={tpl.id} onClick={() => { setSelectedId(tpl.id); setMode("view"); setEditForm(null); }}
                  className={`w-full text-left px-4 py-3 border-b transition-colors hover:bg-accent/50 ${selectedId === tpl.id && mode !== "create" ? "bg-accent" : ""}`}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-medium leading-tight">{tpl.name}</span>
                    {!!(tplAny.isCustom) && <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Custom</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[tpl.category] ?? "bg-gray-100 text-gray-700"}`}>{CATEGORY_LABELS[tpl.category] ?? tpl.category}</span>
                    {!(tplAny.isActive as boolean) && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Inactiva</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* CREATE mode */}
          {mode === "create" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setMode("view")}><ChevronLeft className="h-4 w-4 mr-1" /> Volver</Button>
                <h2 className="text-base font-semibold">Nueva Plantilla PDF Personalizada</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>ID único <span className="text-red-500">*</span></Label>
                  <Input value={createForm.id} onChange={e => setCreateForm(p => ({ ...p, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} placeholder="mi_plantilla_pdf" />
                  <p className="text-xs text-muted-foreground">Solo minúsculas, números y guiones bajos</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Nombre <span className="text-red-500">*</span></Label>
                  <Input value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="Nombre de la plantilla" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Descripción</Label>
                  <Input value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} placeholder="Descripción breve del documento" />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Select value={createForm.category} onValueChange={v => setCreateForm(p => ({ ...p, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Empresa</Label>
                  <Input value={createForm.companyName} onChange={e => setCreateForm(p => ({ ...p, companyName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>NIF/CIF</Label>
                  <Input value={createForm.companyNif} onChange={e => setCreateForm(p => ({ ...p, companyNif: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email empresa</Label>
                  <Input value={createForm.companyEmail} onChange={e => setCreateForm(p => ({ ...p, companyEmail: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Color cabecera</Label>
                  <div className="flex gap-2">
                    <input type="color" value={createForm.headerColor} onChange={e => setCreateForm(p => ({ ...p, headerColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border" />
                    <Input value={createForm.headerColor} onChange={e => setCreateForm(p => ({ ...p, headerColor: e.target.value }))} className="font-mono text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Color acento</Label>
                  <div className="flex gap-2">
                    <input type="color" value={createForm.accentColor} onChange={e => setCreateForm(p => ({ ...p, accentColor: e.target.value }))} className="h-9 w-12 cursor-pointer rounded border" />
                    <Input value={createForm.accentColor} onChange={e => setCreateForm(p => ({ ...p, accentColor: e.target.value }))} className="font-mono text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Texto del pie</Label>
                  <Input value={createForm.footerText} onChange={e => setCreateForm(p => ({ ...p, footerText: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Texto legal</Label>
                  <Input value={createForm.legalText} onChange={e => setCreateForm(p => ({ ...p, legalText: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>HTML del documento <span className="text-red-500">*</span></Label>
                <p className="text-xs text-muted-foreground">HTML completo con estilos inline. Usa {"{{variable}}"} para variables dinámicas.</p>
                <Textarea value={createForm.bodyHtml} onChange={e => setCreateForm(p => ({ ...p, bodyHtml: e.target.value }))} rows={20} className="font-mono text-xs" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Crear plantilla
                </Button>
                <Button variant="outline" onClick={() => setMode("view")}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* EDIT mode */}
          {mode === "edit" && selectedId && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => { setMode("view"); setEditForm(null); }}><ChevronLeft className="h-4 w-4 mr-1" /> Volver</Button>
                  <h2 className="text-base font-semibold">Editar Plantilla PDF</h2>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowRestoreConfirm(selectedId)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Restaurar original
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Guardar cambios
                  </Button>
                </div>
              </div>
              {loadingFull ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : editForm ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Nombre</Label>
                      <Input value={editForm.name} onChange={e => setEditForm(p => p ? { ...p, name: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Descripción</Label>
                      <Input value={editForm.description} onChange={e => setEditForm(p => p ? { ...p, description: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Empresa</Label>
                      <Input value={editForm.companyName} onChange={e => setEditForm(p => p ? { ...p, companyName: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>NIF/CIF</Label>
                      <Input value={editForm.companyNif} onChange={e => setEditForm(p => p ? { ...p, companyNif: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Dirección</Label>
                      <Input value={editForm.companyAddress} onChange={e => setEditForm(p => p ? { ...p, companyAddress: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Teléfono</Label>
                      <Input value={editForm.companyPhone} onChange={e => setEditForm(p => p ? { ...p, companyPhone: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email empresa</Label>
                      <Input value={editForm.companyEmail} onChange={e => setEditForm(p => p ? { ...p, companyEmail: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Texto del pie</Label>
                      <Input value={editForm.footerText} onChange={e => setEditForm(p => p ? { ...p, footerText: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Texto legal</Label>
                      <Input value={editForm.legalText} onChange={e => setEditForm(p => p ? { ...p, legalText: e.target.value } : p)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Color cabecera</Label>
                      <div className="flex gap-2">
                        <input type="color" value={editForm.headerColor} onChange={e => setEditForm(p => p ? { ...p, headerColor: e.target.value } : p)} className="h-9 w-12 cursor-pointer rounded border" />
                        <Input value={editForm.headerColor} onChange={e => setEditForm(p => p ? { ...p, headerColor: e.target.value } : p)} className="font-mono text-sm" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Color acento</Label>
                      <div className="flex gap-2">
                        <input type="color" value={editForm.accentColor} onChange={e => setEditForm(p => p ? { ...p, accentColor: e.target.value } : p)} className="h-9 w-12 cursor-pointer rounded border" />
                        <Input value={editForm.accentColor} onChange={e => setEditForm(p => p ? { ...p, accentColor: e.target.value } : p)} className="font-mono text-sm" />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 col-span-2">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={editForm.showLogo} onChange={e => setEditForm(p => p ? { ...p, showLogo: e.target.checked } : p)} className="rounded" />
                        Mostrar logo
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={editForm.showWatermark} onChange={e => setEditForm(p => p ? { ...p, showWatermark: e.target.checked } : p)} className="rounded" />
                        Marca de agua
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(p => p ? { ...p, isActive: e.target.checked } : p)} className="rounded" />
                        Activa
                      </label>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>HTML del documento</Label>
                    <p className="text-xs text-muted-foreground">HTML completo con estilos inline. Usa {"{{variable}}"} para variables dinámicas.</p>
                    <Textarea value={editForm.bodyHtml} onChange={e => setEditForm(p => p ? { ...p, bodyHtml: e.target.value } : p)} rows={24} className="font-mono text-xs" />
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* VIEW mode */}
          {mode === "view" && selectedId && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b px-6 py-3 shrink-0 bg-muted/10">
                <div className="flex items-center gap-2">
                  <button onClick={() => setPreviewMode("desktop")} className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${previewMode === "desktop" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                    <Monitor className="h-3.5 w-3.5" /> Desktop
                  </button>
                  <button onClick={() => setPreviewMode("mobile")} className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${previewMode === "mobile" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                    <Smartphone className="h-3.5 w-3.5" /> Móvil
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setMode("edit"); }}>
                    <Pencil className="h-4 w-4 mr-1" /> Editar
                  </Button>
                  {templates?.find(t => t.id === selectedId) && !!(templates.find(t => t.id === selectedId) as Record<string, unknown>).isCustom && (
                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setShowDeleteConfirm(selectedId)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setShowRestoreConfirm(selectedId)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> Restaurar
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-muted/20 p-6 flex justify-center">
                {loadingFull ? (
                  <div className="flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : fullTemplate ? (
                  <div className={`bg-white shadow-lg overflow-hidden transition-all ${previewMode === "mobile" ? "w-[390px]" : "w-full max-w-4xl"}`}>
                    <div className="p-3 border-b bg-gray-50 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{fullTemplate.name}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[(fullTemplate as Record<string, unknown>).category as string] ?? "bg-gray-100 text-gray-700"}`}>
                        {CATEGORY_LABELS[(fullTemplate as Record<string, unknown>).category as string] ?? (fullTemplate as Record<string, unknown>).category as string}
                      </span>
                    </div>
                    <div className="p-4 border-b bg-gray-50/50">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><span className="text-muted-foreground">Empresa:</span> <strong>{(fullTemplate as Record<string, unknown>).companyName as string}</strong></div>
                        <div><span className="text-muted-foreground">NIF:</span> <strong>{(fullTemplate as Record<string, unknown>).companyNif as string}</strong></div>
                        <div><span className="text-muted-foreground">Email:</span> {(fullTemplate as Record<string, unknown>).companyEmail as string}</div>
                        <div><span className="text-muted-foreground">Teléfono:</span> {(fullTemplate as Record<string, unknown>).companyPhone as string}</div>
                        <div className="col-span-2"><span className="text-muted-foreground">Dirección:</span> {(fullTemplate as Record<string, unknown>).companyAddress as string}</div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">Color cabecera:</span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-4 w-4 rounded border" style={{ background: (fullTemplate as Record<string, unknown>).headerColor as string }}></span>
                            <code className="text-xs">{(fullTemplate as Record<string, unknown>).headerColor as string}</code>
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">Color acento:</span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-4 w-4 rounded border" style={{ background: (fullTemplate as Record<string, unknown>).accentColor as string }}></span>
                            <code className="text-xs">{(fullTemplate as Record<string, unknown>).accentColor as string}</code>
                          </span>
                        </div>
                      </div>
                    </div>
                    <iframe
                      srcDoc={(fullTemplate as Record<string, unknown>).bodyHtml as string}
                      className="w-full border-0"
                      style={{ height: previewMode === "mobile" ? "600px" : "800px" }}
                      sandbox="allow-same-origin"
                      title="Vista previa PDF"
                    />
                    <div className="p-3 border-t bg-gray-50 text-xs text-muted-foreground">
                      <strong>Pie:</strong> {(fullTemplate as Record<string, unknown>).footerText as string}
                      {!!(fullTemplate as Record<string, unknown>).legalText && <> &nbsp;·&nbsp; <strong>Legal:</strong> {(fullTemplate as Record<string, unknown>).legalText as string}</>}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Empty state */}
          {mode === "view" && !selectedId && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <FileText className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Selecciona una plantilla PDF</p>
                <p className="text-xs text-muted-foreground max-w-xs">Elige una plantilla del panel izquierdo para ver su previsualización, editar su contenido o crear una nueva.</p>
                <Button size="sm" onClick={() => { setMode("create"); setSelectedId(null); }}>
                  <Plus className="h-4 w-4 mr-1" /> Nueva plantilla PDF
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-base">¿Eliminar plantilla?</h3>
            <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer. Solo se pueden eliminar plantillas personalizadas.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(null)}>Cancelar</Button>
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate({ id: showDeleteConfirm })} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirmation dialog */}
      {showRestoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-base">¿Restaurar plantilla original?</h3>
            <p className="text-sm text-muted-foreground">Se perderán todos los cambios personalizados y se restaurará el diseño original del sistema.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowRestoreConfirm(null)}>Cancelar</Button>
              <Button size="sm" onClick={() => restoreMutation.mutate({ id: showRestoreConfirm })} disabled={restoreMutation.isPending}>
                {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                Restaurar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
