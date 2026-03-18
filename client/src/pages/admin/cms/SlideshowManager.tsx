import { useState, useRef } from "react";
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon, Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type SlideForm = {
  imageUrl: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  reserveUrl: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm: SlideForm = {
  imageUrl: "",
  badge: "",
  title: "",
  subtitle: "",
  description: "",
  ctaText: "",
  ctaUrl: "",
  reserveUrl: "",
  sortOrder: 0,
  isActive: true,
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  background: "linear-gradient(135deg, #f59e0b, #f97316)",
  color: "#ffffff",
  fontWeight: 600,
  padding: "0.55rem 1.2rem",
  borderRadius: "0.6rem",
  border: "none",
  cursor: "pointer",
  fontSize: "0.875rem",
  boxShadow: "0 2px 6px rgba(249,115,22,0.35)",
  whiteSpace: "nowrap" as const,
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  background: "transparent",
  color: "#6b7280",
  fontWeight: 500,
  padding: "0.55rem 1.2rem",
  borderRadius: "0.6rem",
  border: "1.5px solid #d1d5db",
  cursor: "pointer",
  fontSize: "0.875rem",
};

export default function SlideshowManager() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SlideForm>(emptyForm);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: slides, isLoading } = trpc.cms.getSlideshowItems.useQuery();

  const createMutation = trpc.cms.createSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide creado correctamente");
      utils.cms.getSlideshowItems.invalidate();
      closeModal();
    },
    onError: (e) => toast.error(`Error: ${e.message}`),
  });

  const updateMutation = trpc.cms.updateSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide actualizado");
      utils.cms.getSlideshowItems.invalidate();
      closeModal();
    },
    onError: (e) => toast.error(`Error: ${e.message}`),
  });

  const reorderMutation = trpc.cms.reorderSlideshowItems.useMutation({
    onSuccess: () => { utils.cms.getSlideshowItems.invalidate(); },
    onError: () => toast.error("Error al guardar el orden"),
  });

  const deleteMutation = trpc.cms.deleteSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide eliminado");
      utils.cms.getSlideshowItems.invalidate();
      setConfirmDeleteId(null);
    },
    onError: () => toast.error("Error al eliminar"),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, sortOrder: slides?.length ?? 0 });
    setPreviewUrl("");
    setShowModal(true);
  };

  const openEdit = (slide: NonNullable<typeof slides>[0]) => {
    setEditingId(slide.id);
    setForm({
      imageUrl: slide.imageUrl ?? "",
      badge: (slide as any).badge ?? "",
      title: slide.title ?? "",
      subtitle: slide.subtitle ?? "",
      description: (slide as any).description ?? "",
      ctaText: slide.ctaText ?? "",
      ctaUrl: slide.ctaUrl ?? "",
      reserveUrl: (slide as any).reserveUrl ?? "",
      sortOrder: slide.sortOrder ?? 0,
      isActive: slide.isActive ?? true,
    });
    setPreviewUrl(slide.imageUrl ?? "");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
    setPreviewUrl("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error al subir");
      const { url } = await res.json();
      setForm((p) => ({ ...p, imageUrl: url }));
      setPreviewUrl(url);
      toast.success("Imagen subida correctamente");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al subir");
      setPreviewUrl("");
      setForm((p) => ({ ...p, imageUrl: "" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl) { toast.error("Debes subir una imagen"); return; }
    const payload = {
      imageUrl: form.imageUrl,
      badge: form.badge || undefined,
      title: form.title || undefined,
      subtitle: form.subtitle || undefined,
      description: form.description || undefined,
      ctaText: form.ctaText || undefined,
      ctaUrl: form.ctaUrl || undefined,
      reserveUrl: form.reserveUrl || undefined,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const field = (
    id: keyof SlideForm,
    label: string,
    placeholder: string,
    hint?: string
  ) => (
    <div>
      <label htmlFor={id} style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", color: "#374151", marginBottom: "0.35rem" }}>
        {label}
      </label>
      {hint && <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.35rem" }}>{hint}</p>}
      <Input
        id={id}
        placeholder={placeholder}
        value={form[id] as string}
        onChange={(e) => setForm((p) => ({ ...p, [id]: e.target.value }))}
      />
    </div>
  );

  return (
    <AdminLayout title="Gestión del Slideshow">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          Gestiona las imágenes y contenido del slideshow de la página principal.
        </p>
        <button style={btnPrimary} onClick={openCreate}>
          <Plus style={{ width: "1rem", height: "1rem" }} />
          Nuevo Slide
        </button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "12rem" }}>
          <Loader2 style={{ width: "2rem", height: "2rem", color: "#9ca3af" }} className="animate-spin" />
        </div>
      ) : !slides || slides.length === 0 ? (
        <div style={{ border: "2px dashed #d1d5db", borderRadius: "1rem", padding: "3rem", textAlign: "center", background: "#f9fafb" }}>
          <ImageIcon style={{ width: "3rem", height: "3rem", color: "#9ca3af", margin: "0 auto 1rem" }} />
          <p style={{ fontWeight: 600, fontSize: "1rem", color: "#111827", marginBottom: "0.5rem" }}>No hay slides configurados</p>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Añade el primer slide para el slideshow de la home.</p>
          <button style={btnPrimary} onClick={openCreate}>
            <Plus style={{ width: "1rem", height: "1rem" }} />
            Añadir Primer Slide
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {(() => {
            const sorted = localOrder.length === slides.length && localOrder.length > 0
              ? (() => { const m = new Map(slides.map(s => [s.id, s])); return localOrder.map(id => m.get(id)).filter(Boolean) as typeof slides; })()
              : [...slides].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const moveSlide = (index: number, dir: "up" | "down") => {
              const cur = localOrder.length > 0 ? localOrder : sorted.map(s => s.id);
              const newOrd = [...cur];
              const swap = dir === "up" ? index - 1 : index + 1;
              if (swap < 0 || swap >= newOrd.length) return;
              [newOrd[index], newOrd[swap]] = [newOrd[swap], newOrd[index]];
              setLocalOrder(newOrd);
              reorderMutation.mutate({ items: newOrd.map((id, i) => ({ id, sortOrder: i })) });
            };
            return sorted.map((slide, idx) => (
            <div key={slide.id} style={{ display: "flex", alignItems: "stretch", border: "1px solid #e5e7eb", borderRadius: "1rem", overflow: "hidden", background: "#ffffff" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "0 0.75rem", color: "#d1d5db", cursor: "grab", borderRight: "1px solid #f3f4f6" }}>
                <GripVertical style={{ width: "1.25rem", height: "1.25rem" }} />
              </div>
              <div style={{ width: "9rem", height: "6rem", flexShrink: 0, background: "#f3f4f6" }}>
                {slide.imageUrl
                  ? <img src={slide.imageUrl} alt={slide.title ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><ImageIcon style={{ width: "2rem", height: "2rem", color: "#9ca3af" }} /></div>
                }
              </div>
              <div style={{ flex: 1, padding: "0.75rem 1rem", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af", fontFamily: "monospace" }}>#{slide.sortOrder ?? 0}</span>
                  {(slide as any).badge && <span style={{ fontSize: "0.7rem", background: "#fff7ed", color: "#ea580c", border: "1px solid #fed7aa", borderRadius: "999px", padding: "0.1rem 0.5rem" }}>{(slide as any).badge}</span>}
                  <Badge className={slide.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}>
                    {slide.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <p style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {slide.title || <span style={{ color: "#9ca3af", fontStyle: "italic" }}>Sin título</span>}
                </p>
                {slide.subtitle && <p style={{ fontSize: "0.875rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slide.subtitle}</p>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0 1rem", borderLeft: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", flexDirection: "column", marginRight: "0.25rem" }}>
                  <button onClick={() => moveSlide(idx, "up")} disabled={idx === 0 || reorderMutation.isPending} style={{ padding: "0.2rem", borderRadius: "0.3rem", border: "none", background: "transparent", cursor: "pointer", opacity: idx === 0 ? 0.3 : 1 }} title="Subir">
                    <ChevronUp style={{ width: "0.875rem", height: "0.875rem", color: "#6b7280" }} />
                  </button>
                  <button onClick={() => moveSlide(idx, "down")} disabled={idx === sorted.length - 1 || reorderMutation.isPending} style={{ padding: "0.2rem", borderRadius: "0.3rem", border: "none", background: "transparent", cursor: "pointer", opacity: idx === sorted.length - 1 ? 0.3 : 1 }} title="Bajar">
                    <ChevronDown style={{ width: "0.875rem", height: "0.875rem", color: "#6b7280" }} />
                  </button>
                </div>
                <button onClick={() => openEdit(slide)} style={{ padding: "0.4rem", borderRadius: "0.4rem", border: "none", background: "transparent", cursor: "pointer", color: "#6b7280" }} title="Editar">
                  <Pencil style={{ width: "0.875rem", height: "0.875rem" }} />
                </button>
                <button onClick={() => setConfirmDeleteId(slide.id)} style={{ padding: "0.4rem", borderRadius: "0.4rem", border: "none", background: "transparent", cursor: "pointer", color: "#ef4444" }} title="Eliminar">
                  <Trash2 style={{ width: "0.875rem", height: "0.875rem" }} />
                </button>
              </div>
            </div>
            ));
          })()}
        </div>
      )}

      {/* ── Modal Crear / Editar ──────────────────────────────────── */}
      <Dialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-2xl" style={{ maxHeight: "90vh", overflowY: "auto" }}>
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Editar Slide" : "Nuevo Slide"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem", paddingTop: "0.5rem" }}>

            {/* Upload imagen */}
            <div>
              <label style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", color: "#374151", marginBottom: "0.35rem" }}>
                Imagen del slide *
              </label>
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                style={{ border: "2px dashed #d1d5db", borderRadius: "0.75rem", overflow: "hidden", cursor: "pointer", minHeight: "150px", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb", position: "relative" }}
              >
                {previewUrl ? (
                  <>
                    <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "150px", objectFit: "cover", display: "block" }} />
                    {!uploading && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewUrl(""); setForm((p) => ({ ...p, imageUrl: "" })); }}
                        style={{ position: "absolute", top: "0.5rem", right: "0.5rem", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: "1.5rem", height: "1.5rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X style={{ width: "0.75rem", height: "0.75rem" }} />
                      </button>
                    )}
                    {uploading && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                        <Loader2 style={{ width: "1.5rem", height: "1.5rem", color: "#fff" }} className="animate-spin" />
                        <span style={{ color: "#fff", fontSize: "0.875rem" }}>Subiendo...</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "1.5rem", color: "#9ca3af" }}>
                    <Upload style={{ width: "2rem", height: "2rem", margin: "0 auto 0.5rem" }} />
                    <p style={{ fontWeight: 500, fontSize: "0.875rem", color: "#374151" }}>Haz clic para subir una imagen</p>
                    <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>JPEG, PNG, WebP — Máx. 10 MB</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: "none" }} onChange={handleFileChange} />
            </div>

            {/* Badge */}
            {field("badge", "Etiqueta (badge)", "Ej: Actividad Estrella", "Texto pequeño que aparece encima del título en el hero")}

            {/* Título y subtítulo */}
            {field("title", "Título principal", "Ej: Cableski & Wakeboard")}
            {field("subtitle", "Subtítulo", "Ej: Para todos los niveles")}

            {/* Descripción */}
            <div>
              <label htmlFor="description" style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", color: "#374151", marginBottom: "0.35rem" }}>
                Descripción
              </label>
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.35rem" }}>Texto descriptivo que aparece bajo el subtítulo</p>
              <textarea
                id="description"
                placeholder="Ej: Practica wakeboard y esquí acuático en nuestro sistema de cable aéreo. Material y chaleco incluidos."
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", fontSize: "0.875rem", resize: "vertical", outline: "none", fontFamily: "inherit" }}
              />
            </div>

            {/* Botón principal (CTA) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {field("ctaText", "Texto del botón principal", "Ej: Reservar Ahora")}
              {field("ctaUrl", "URL del botón principal", "Ej: /experiencias/cableski-wakeboard")}
            </div>

            {/* URL de reserva directa */}
            {field("reserveUrl", "URL de reserva directa (botón secundario)", "Ej: /experiencias/cableski-wakeboard", "Si se rellena, aparece el botón 'Reservar Ahora' con flecha. Si se deja vacío, solo aparece 'Solicitar Presupuesto'.")}

            {/* Orden y estado */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label htmlFor="sortOrder" style={{ display: "block", fontWeight: 500, fontSize: "0.875rem", color: "#374151", marginBottom: "0.35rem" }}>Orden de aparición</label>
                <Input id="sortOrder" type="number" min={0} value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", paddingTop: "1.6rem" }}>
                <Switch id="isActive" checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
                <Label htmlFor="isActive" style={{ cursor: "pointer" }}>{form.isActive ? "Slide activo" : "Slide inactivo"}</Label>
              </div>
            </div>

            {/* Botones del formulario */}
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", paddingTop: "0.75rem", borderTop: "1px solid #e5e7eb", marginTop: "0.5rem" }}>
              <button type="button" style={btnSecondary} onClick={closeModal} disabled={isSaving}>
                Cancelar
              </button>
              <button type="submit" disabled={isSaving || uploading}
                style={{ ...btnPrimary, opacity: isSaving || uploading ? 0.7 : 1, cursor: isSaving || uploading ? "not-allowed" : "pointer" }}>
                {isSaving
                  ? <><Loader2 style={{ width: "1rem", height: "1rem" }} className="animate-spin" /> Guardando...</>
                  : editingId !== null ? "Guardar cambios" : "Crear slide"
                }
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminación */}
      {confirmDeleteId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setConfirmDeleteId(null)}>
          <div style={{ background: "#fff", borderRadius: "1rem", padding: "2rem", maxWidth: "24rem", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", color: "#111827", marginBottom: "0.75rem" }}>¿Eliminar este slide?</h3>
            <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Esta acción no se puede deshacer.</p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button style={btnSecondary} onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
              <button style={{ ...btnPrimary, background: "#ef4444", boxShadow: "0 2px 6px rgba(239,68,68,0.35)" }} onClick={() => deleteMutation.mutate({ id: confirmDeleteId })}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
