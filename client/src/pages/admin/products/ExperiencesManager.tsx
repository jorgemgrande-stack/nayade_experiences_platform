import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { PanelError, PanelEmpty, errorMessage } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { SegmentedTabs } from "@/components/admin/PanelVisual";
import { ProductThumb } from "./ProductThumb";
import { validateProductForm } from "@shared/formValidation";
import { Package, Plus, Pencil, Trash2, Star, Eye, EyeOff, Search, ImageIcon, X, MoreVertical, Copy, PowerOff, Power, ChevronUp, ChevronDown, CalendarDays, Languages } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdminLayout from "@/components/AdminLayout";
import SupplierSelect from "@/components/SupplierSelect";
import { trpc } from "@/lib/trpc";
import { useImageUploadLimit } from "@/hooks/useImageUploadLimit";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import TimeSlotsPanel from "@/components/TimeSlotsPanel";
import { EditionsPanel, UpcomingEditionsView } from "./EditionsPanel";
import { SaleReadinessPanel } from "./SaleReadinessPanel";
import { ProductTranslationsPanel } from "./ProductTranslationsPanel";
import { isMultilingual } from "@shared/i18n";
import { TONE_BADGE, TONE_SURFACE } from "@/lib/panelTones";
import { newProductDefaults, presentialSaleAllowed } from "@shared/catalogDefaults";
import { DEFAULT_REQUEST_CTA, MAX_REQUEST_CTA_LENGTH, OFFER_MODES, offerModeOf, type OfferMode } from "@shared/offerMode";

const difficultyColors: Record<string, string> = {
  facil: TONE_BADGE.success,
  moderado: TONE_BADGE.warning,
  dificil: TONE_BADGE.danger,
  experto: TONE_BADGE.info,
};

type ExpForm = {
  slug: string; title: string; shortDescription: string; description: string;
  categoryId: string; locationId: string;
  image1: string; image2: string; image3: string; image4: string;
  basePrice: string; duration: string; minPersons: string; maxPersons: string;
  offerMode: OfferMode; requestCtaLabel: string;
  pricingType: string; unitCapacity: string; maxUnits: string;
  difficulty: string; isFeatured: boolean; isActive: boolean; isPublished: boolean; isPresentialSale: boolean;
  includes: string[]; excludes: string[];
  discountPercent: string; discountExpiresAt: string;
  fiscalRegime: string; taxRate: string; productType: string;
  providerPercent: string; agencyMarginPercent: string;
  supplierId: string;
  supplierCommissionPercent: string;
  supplierCostType: string;
  settlementFrequency: string;
  isSettlable: boolean;
  hasTimeSlots: boolean;
};

const emptyForm: ExpForm = {
  slug: "", title: "", shortDescription: "", description: "",
  categoryId: "", locationId: "",
  image1: "", image2: "", image3: "", image4: "",
  basePrice: "", duration: "", minPersons: "1", maxPersons: "",
  offerMode: "fixed", requestCtaLabel: "",
  pricingType: "per_person", unitCapacity: "", maxUnits: "",
  difficulty: "facil", isFeatured: false, isActive: true, isPublished: true, isPresentialSale: false,
  includes: [], excludes: [],
  discountPercent: "", discountExpiresAt: "",
  fiscalRegime: "general", taxRate: "21", productType: "actividad",
  providerPercent: "", agencyMarginPercent: "",
  supplierId: "", supplierCommissionPercent: "",
  supplierCostType: "comision_sobre_venta", settlementFrequency: "mensual",
  isSettlable: false,
  hasTimeSlots: false,
};

// ── Componente de zona de upload de imagen ──────────────────────────────────
function ImageUploadZone({
  label, value, onChange, index,
}: { label: string; value: string; onChange: (url: string) => void; index: number }) {
  const { t } = useI18n();
  const imageMax = useImageUploadLimit();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > imageMax.bytes) { toast.error(t("productsCatalog.image.tooBig", { mb: imageMax.mb })); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("productsCatalog.image.uploadFailed"));
      onChange(data.url);
      toast.success(t("productsCatalog.image.uploaded", { n: index }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("productsCatalog.image.uploadFailedImage"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl overflow-hidden cursor-pointer transition-all",
          "hover:border-primary/60 hover:bg-primary/5",
          value ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30",
          "h-28"
        )}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-cover" />
            <button
              type="button"
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-danger transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <ImageIcon className="w-6 h-6 opacity-40" />
                <span className="text-xs">{t("productsCatalog.image.dropHint")}</span>
              </>
            )}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

export default function ExperiencesManager() {
  const { t } = useI18n();
  const f = useFormat();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmReadiness, setConfirmReadiness] = useState(false);
  const [form, setForm] = useState<ExpForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [cloneModal, setCloneModal] = useState<{ id: number; originalName: string } | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [localOrder, setLocalOrder] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "unpublished" | "inactive">("all");
  // Vista tabla/tarjetas: se recuerda durante la sesión del navegador (sin tocar el servidor)
  const [layout, setLayout] = useState<"table" | "grid">(() => {
    const narrow = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches;
    try {
      const saved = window.sessionStorage.getItem("catalog.layout");
      if (saved === "grid" || saved === "table") return saved;
    } catch { /* sin almacenamiento */ }
    return narrow ? "grid" : "table";
  });
  const changeLayout = (v: "table" | "grid") => {
    setLayout(v);
    try { window.sessionStorage.setItem("catalog.layout", v); } catch { /* sin almacenamiento: solo no se recuerda */ }
  };
  // E-4: convocatorias de un producto y vista de las próximas de toda la tienda
  const [editionsFor, setEditionsFor] = useState<{ id: number; title: string } | null>(null);
  const [view, setView] = useState<"productos" | "convocatorias">("productos");
  // E-1: traducciones de un producto («Idiomas»), solo si la web tiene idiomas adicionales
  const [translationsFor, setTranslationsFor] = useState<{ id: number; title: string } | null>(null);
  const i18nCfg = trpc.cms.i18nConfig.useQuery(undefined, { retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
  const multilingual = !!i18nCfg.data && isMultilingual(i18nCfg.data);

  const { data: experiences, refetch, isLoading: listLoading, isError: listIsError, error: listError } = trpc.products.getAll.useQuery();

  // Empresas con licencias por capacidad: vocabulario genérico y sin los campos que no aplican a su plan
  const sub = usePanelSubscription();
  const isNewCompany = sub.isLicensed;
  // Textos que dependen de si se vende «producto» o «experiencia» (concordancia incluida)
  const tn = (k: string) => t(`productsCatalog.${isNewCompany ? "p" : "e"}.${k}`);
  const voc = useVocabulary();
  const productTypeOptions = voc.productTypes.some((o) => o.value === form.productType)
    ? voc.productTypes
    : [...voc.productTypes, { value: form.productType, label: form.productType }];
  const showSuppliers = sub.can("supplier-settlements");
  const showReav = sub.can("travel-net") || form.fiscalRegime === "reav";
  const showDifficulty = !isNewCompany;
  const locationLabel = isNewCompany ? t("productsCatalog.modal.locationLicensed") : t("productsCatalog.modal.locationOriginal");

  // Errores por campo (tras el primer intento) y error del servidor; ante un error no se cierra ni se vacía el formulario
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Sincronizar orden local cuando llegan datos
  const utils = trpc.useUtils();
  const { data: categories } = trpc.products.getCategories.useQuery();
  const { data: locations } = trpc.products.getLocations.useQuery();

  // Acceso directo «Nuevo producto» (inicio del panel): ?nuevo=1
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("nuevo") !== "1") return;
    openCreate();
    url.searchParams.delete("nuevo");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enlace a las convocatorias de un producto (p. ej. desde la ficha de un lead del CRM): ?convocatorias=<id>
  useEffect(() => {
    if (!experiences) return;
    const url = new URL(window.location.href);
    const id = Number(url.searchParams.get("convocatorias"));
    if (!Number.isInteger(id) || id <= 0) return;
    const exp = experiences.find((e) => e.id === id);
    if (exp) setEditionsFor({ id: exp.id, title: exp.title });
    url.searchParams.delete("convocatorias");
    window.history.replaceState({}, "", url.toString());
  }, [experiences]);

  // Valores de un producto nuevo según el plan (las licencias pueden llegar después de abrir el formulario): solo se
  // ajustan si siguen siendo los de partida, nunca encima de lo que haya elegido el usuario
  useEffect(() => {
    if (!showModal || editingId || !isNewCompany) return;
    setForm((f) => (f.productType === emptyForm.productType && f.pricingType === emptyForm.pricingType && f.isPresentialSale === emptyForm.isPresentialSale
      ? { ...f, ...newProductDefaults({ licensed: true, can: sub.can }) }
      : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, editingId, isNewCompany, sub.data]);

  // Si solo hay una categoría o una ubicación, se preselecciona al crear
  useEffect(() => {
    if (!showModal || editingId) return;
    setForm((f) => ({
      ...f,
      categoryId: f.categoryId || (categories?.length === 1 ? String(categories[0].id) : ""),
      locationId: f.locationId || (locations?.length === 1 ? String(locations[0].id) : ""),
    }));
  }, [showModal, editingId, categories, locations]);

  const createMutation = trpc.products.create.useMutation({
    onSuccess: () => { toast.success(tn("created")); refetch(); setShowModal(false); setForm(emptyForm); setSubmitted(false); },
    onError: (e) => { setServerError(errorMessage(e, e.message || tn("createFailed"))); toast.error(tn("createFailedToast")); },
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => { toast.success(tn("updated")); refetch(); setShowModal(false); setEditingId(null); setSubmitted(false); },
    onError: (e) => { setServerError(errorMessage(e, e.message || t("productsCatalog.toast.updateFailedDefault"))); toast.error(t("productsCatalog.toast.updateFailed")); },
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: () => { toast.success(tn("deactivated")); refetch(); },
    onError: () => toast.error(t("productsCatalog.toast.deleteFailed")),
  });
  const hardDeleteMutation = trpc.products.hardDelete.useMutation({
    onSuccess: () => { toast.success(tn("hardDeleted")); refetch(); },
    onError: () => toast.error(t("productsCatalog.toast.deleteFailed")),
  });
  const toggleActiveMutation = trpc.products.toggleActive.useMutation({
    onSuccess: (_, vars) => { toast.success(vars.isActive ? tn("activated") : tn("deactivated")); refetch(); },
    onError: () => toast.error(t("productsCatalog.toast.toggleFailed")),
  });
  const cloneMutation = trpc.products.clone.useMutation({
    onSuccess: () => { toast.success(tn("cloned")); refetch(); setCloneModal(null); setCloneName(""); },
    onError: () => toast.error(t("productsCatalog.toast.cloneFailed")),
  });
  const reorderMutation = trpc.products.reorder.useMutation({
    onSuccess: () => { utils.products.getAll.invalidate(); },
    onError: () => toast.error(t("productsCatalog.toast.reorderFailed")),
  });

  const openCreate = () => { setEditingId(null); setForm({ ...emptyForm, ...newProductDefaults({ licensed: isNewCompany, can: sub.can }) }); setSubmitted(false); setServerError(null); setShowModal(true); };
  const openEdit = (exp: Record<string, unknown>) => {
    setEditingId(Number(exp.id)); setConfirmReadiness(false);
    setForm({
      slug: String(exp.slug ?? ""), title: String(exp.title ?? ""),
      shortDescription: String(exp.shortDescription ?? ""),
      description: String(exp.description ?? ""),
      categoryId: String(exp.categoryId ?? ""),
      locationId: String(exp.locationId ?? ""),
      image1: String(exp.image1 ?? exp.coverImageUrl ?? ""),
      image2: String(exp.image2 ?? ""),
      image3: String(exp.image3 ?? ""),
      image4: String(exp.image4 ?? ""),
      basePrice: String(exp.basePrice ?? ""),
      offerMode: offerModeOf(exp),
      requestCtaLabel: String((exp as Record<string, unknown>).requestCtaLabel ?? ""),
      duration: String(exp.duration ?? ""),
      minPersons: String(exp.minPersons ?? "1"),
      maxPersons: String(exp.maxPersons ?? ""),
      pricingType: String((exp as Record<string,unknown>).pricingType ?? "per_person"),
      unitCapacity: (exp as Record<string,unknown>).unitCapacity != null ? String((exp as Record<string,unknown>).unitCapacity) : "",
      maxUnits: (exp as Record<string,unknown>).maxUnits != null ? String((exp as Record<string,unknown>).maxUnits) : "",
      difficulty: String(exp.difficulty ?? "facil"),
      isFeatured: Boolean(exp.isFeatured),
      isActive: Boolean(exp.isActive),
      isPublished: (exp as Record<string,unknown>).isPublished !== undefined ? Boolean((exp as Record<string,unknown>).isPublished) : true,
      includes: Array.isArray(exp.includes) ? (exp.includes as string[]) : [],
      excludes: Array.isArray(exp.excludes) ? (exp.excludes as string[]) : [],
      discountPercent: exp.discountPercent != null ? String(exp.discountPercent) : "",
      discountExpiresAt: exp.discountExpiresAt
        ? new Date(exp.discountExpiresAt as string | number | Date).toISOString().slice(0, 10)
        : "",
      fiscalRegime: String(exp.fiscalRegime ?? "general"),
      taxRate: exp.taxRate != null ? String(exp.taxRate) : "21",
      productType: String(exp.productType ?? "actividad"),
      providerPercent: exp.providerPercent != null ? String(exp.providerPercent) : "",
      agencyMarginPercent: exp.agencyMarginPercent != null ? String(exp.agencyMarginPercent) : "",
      supplierId: exp.supplierId != null ? String(exp.supplierId) : "",
      supplierCommissionPercent: exp.supplierCommissionPercent != null ? String(exp.supplierCommissionPercent) : "",
      supplierCostType: String(exp.supplierCostType ?? "comision_sobre_venta"),
      settlementFrequency: String(exp.settlementFrequency ?? "mensual"),
      isSettlable: Boolean(exp.isSettlable),
      isPresentialSale: Boolean((exp as Record<string,unknown>).isPresentialSale),
      hasTimeSlots: Boolean((exp as Record<string,unknown>).hasTimeSlots),
    });
    setSubmitted(false);
    setServerError(null);
    setShowModal(true);
  };

  const formErrors = validateProductForm(form, { location: isNewCompany ? "el lugar de servicio o venta" : "la ubicación" });
  const err = (k: keyof typeof formErrors) => (submitted ? formErrors[k] : undefined);
  const errProps = (k: keyof typeof formErrors, id: string) =>
    err(k) ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  const ErrorText = ({ k, id }: { k: keyof typeof formErrors; id: string }) =>
    err(k) ? <p id={`${id}-error`} className="text-xs text-destructive mt-1">{err(k)}</p> : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const firstError = (["title", "basePrice", "categoryId", "locationId", "minPersons", "maxPersons", "unitCapacity", "discountPercent"] as const).find((k) => formErrors[k]);
    if (firstError) {
      document.getElementById(firstError)?.focus();
      return;
    }
    const data = {
      slug: form.slug || form.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      title: form.title,
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      categoryId: parseInt(form.categoryId),
      locationId: parseInt(form.locationId),
      image1: form.image1 || undefined,
      image2: form.image2 || undefined,
      image3: form.image3 || undefined,
      image4: form.image4 || undefined,
      // E-6: sin precio fijo no se manda precio (el servidor guarda 0)
      basePrice: form.offerMode === "fixed" || form.offerMode === "priced_request" ? form.basePrice : "",
      offerMode: form.offerMode,
      requestCtaLabel: form.offerMode === "fixed" ? "" : form.requestCtaLabel.trim(),
      duration: form.duration || undefined,
      minPersons: form.minPersons ? parseInt(form.minPersons) : undefined,
      maxPersons: form.maxPersons ? parseInt(form.maxPersons) : undefined,
      pricingType: form.pricingType as "per_person" | "per_unit",
      unitCapacity: form.unitCapacity ? parseInt(form.unitCapacity) : undefined,
      maxUnits: form.maxUnits ? parseInt(form.maxUnits) : undefined,
      difficulty: form.difficulty as "facil" | "moderado" | "dificil" | "experto",
      isFeatured: form.isFeatured,
      isActive: form.isActive,
      isPublished: form.isPublished,
      includes: form.includes.filter(s => s.trim() !== ""),
      excludes: form.excludes.filter(s => s.trim() !== ""),
      discountPercent: form.discountPercent ? form.discountPercent : undefined,
      discountExpiresAt: form.discountExpiresAt ? form.discountExpiresAt : undefined,
      fiscalRegime: form.fiscalRegime as "general" | "reav",
      taxRate: form.fiscalRegime === "reav" ? "0" : form.taxRate,
      productType: form.productType,
      providerPercent: form.providerPercent ? form.providerPercent : undefined,
      agencyMarginPercent: form.agencyMarginPercent ? form.agencyMarginPercent : undefined,
      supplierId: form.supplierId ? parseInt(form.supplierId) : undefined,
      supplierCommissionPercent: form.supplierCommissionPercent ? form.supplierCommissionPercent : undefined,
      supplierCostType: form.supplierCostType || undefined,
      settlementFrequency: form.settlementFrequency || undefined,
      isSettlable: form.isSettlable,
      isPresentialSale: form.isPresentialSale,
      // hasTimeSlots is managed separately via TimeSlotsPanel toggle
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data, confirmReadiness });
    } else {
      createMutation.mutate(data);
    }
  };

  // Mantener orden local: inicializar cuando llegan datos
  const sortedExperiences = (() => {
    const list = experiences ?? [];
    if (localOrder.length === list.length && localOrder.length > 0) {
      const map = new Map(list.map(e => [e.id, e]));
      return localOrder.map(id => map.get(id)).filter(Boolean) as typeof list;
    }
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  })();

  const isPublishedOf = (e: (typeof sortedExperiences)[number]) => (e as Record<string, unknown>).isPublished !== false;
  const counts = {
    all: sortedExperiences.length,
    published: sortedExperiences.filter(isPublishedOf).length,
    unpublished: sortedExperiences.filter((e) => !isPublishedOf(e)).length,
    inactive: sortedExperiences.filter((e) => !e.isActive).length,
  };
  const filtered = sortedExperiences.filter((e) =>
    (!search || e.title.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === "all" || (statusFilter === "published" ? isPublishedOf(e) : statusFilter === "unpublished" ? !isPublishedOf(e) : !e.isActive))
  );
  const filtersActive = !!search.trim() || statusFilter !== "all";

  const moveItem = (index: number, direction: "up" | "down") => {
    const current = localOrder.length > 0 ? localOrder : sortedExperiences.map(e => e.id);
    const newOrder = [...current];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    setLocalOrder(newOrder);
    const items = newOrder.map((id, i) => ({ id, sortOrder: i }));
    reorderMutation.mutate({ items });
  };

  // Presentación del listado (solo lectura de datos que ya llegan del servidor)
  const thumbOf = (exp: (typeof sortedExperiences)[number]) => {
    const r = exp as Record<string, unknown>;
    const src = r.image1 || exp.coverImageUrl;
    return src ? String(src) : null;
  };
  const categoryNameOf = (exp: (typeof sortedExperiences)[number]) =>
    (categories ?? []).find((c) => c.id === exp.categoryId)?.name ?? t("productsCatalog.list.noCategory");
  const priceOf = (exp: (typeof sortedExperiences)[number]) =>
    offerModeOf(exp) === "fixed"
      ? <span className="font-semibold text-foreground">{f.currency(parseFloat(exp.basePrice), "EUR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
      : <StatusBadge tone="info">{t(`productsCatalog.offerMode.${offerModeOf(exp)}.label`)}</StatusBadge>;
  const statusBadges = (exp: (typeof sortedExperiences)[number]) => (
    <>
      <StatusBadge tone={exp.isActive ? "success" : "neutral"}>
        {voc.licensed ? (exp.isActive ? t("productsCatalog.list.onSale") : t("productsCatalog.list.soldOut")) : exp.isActive ? t("productsCatalog.list.active") : t("productsCatalog.list.inactive")}
      </StatusBadge>
      <StatusBadge tone={isPublishedOf(exp) ? "info" : "warning"} icon={isPublishedOf(exp) ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}>
        {isPublishedOf(exp) ? t("productsCatalog.list.published") : t("productsCatalog.list.notPublished")}
      </StatusBadge>
    </>
  );
  const rowMenu = (exp: (typeof sortedExperiences)[number]) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("productsCatalog.list.rowActions", { title: exp.title })}>
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => openEdit(exp)}>
          <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {t("productsCatalog.list.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => toggleActiveMutation.mutate({ id: exp.id, isActive: !exp.isActive })}>
          {exp.isActive
            ? <><PowerOff className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {voc.licensed ? t("productsCatalog.list.markSoldOut") : t("productsCatalog.list.deactivate")}</>
            : <><Power className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {voc.licensed ? t("productsCatalog.list.putOnSale") : t("productsCatalog.list.activate")}</>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setCloneModal({ id: exp.id, originalName: exp.title }); setCloneName(""); }}>
          <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {t("productsCatalog.list.clone")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setEditionsFor({ id: exp.id, title: exp.title })}>
          <CalendarDays className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {t("productsCatalog.list.editions")}
        </DropdownMenuItem>
        {multilingual && (
          <DropdownMenuItem onClick={() => setTranslationsFor({ id: exp.id, title: exp.title })}>
            <Languages className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {t("productsCatalog.list.languages")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger focus:text-danger" onClick={() => setDeleteTarget({ id: exp.id, title: exp.title })}>
          <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {t("productsCatalog.list.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <PanelPageHeader
        icon={<Package />}
        title={isNewCompany ? t("productsCatalog.title.licensed") : t("productsCatalog.title.original")}
        description={isNewCompany ? t("productsCatalog.list.pageDescP") : t("productsCatalog.list.pageDescE")}
        actions={view === "productos" ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {isNewCompany ? t("productsCatalog.list.newP") : t("productsCatalog.list.newE")}
          </Button>
        ) : undefined}
      />
      <SegmentedTabs
        className="mb-4"
        label={t("productsCatalog.view.label")}
        value={view}
        onChange={setView}
        options={[
          { value: "productos", label: isNewCompany ? t("productsCatalog.view.products") : t("productsCatalog.view.experiences") },
          { value: "convocatorias", label: t("productsCatalog.view.editions") },
        ]}
      />
      {view === "convocatorias" && <UpcomingEditionsView onManage={(id, title) => setEditionsFor({ id, title })} />}

      {view === "productos" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder={isNewCompany ? t("productsCatalog.list.searchPlaceholderP") : t("productsCatalog.list.searchPlaceholderE")}
                aria-label={isNewCompany ? t("productsCatalog.list.searchLabelP") : t("productsCatalog.list.searchLabelE")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9"
              />
            </div>
            <SegmentedTabs
              label={t("productsCatalog.list.filterLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: t("productsCatalog.list.filterAll"), count: counts.all },
                { value: "published", label: t("productsCatalog.list.published"), count: counts.published },
                { value: "unpublished", label: t("productsCatalog.list.notPublished"), count: counts.unpublished },
                { value: "inactive", label: voc.licensed ? t("productsCatalog.list.soldOut") : t("productsCatalog.list.inactive"), count: counts.inactive },
              ]}
            />
            <SegmentedTabs
              className="sm:ml-auto"
              label={t("productsCatalog.list.viewLabel")}
              value={layout}
              onChange={changeLayout}
              options={[
                { value: "table", label: t("productsCatalog.list.viewTable") },
                { value: "grid", label: t("productsCatalog.list.viewGrid") },
              ]}
            />
          </div>

          {listLoading ? (
            <div role="status" className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">{t("productsCatalog.list.loading")}</div>
          ) : listIsError ? (
            <PanelError error={listError} onRetry={() => refetch()} title={isNewCompany ? t("productsCatalog.list.loadErrorP") : t("productsCatalog.list.loadErrorE")} />
          ) : filtered.length === 0 ? (
            <PanelEmpty
              icon={<ImageIcon />}
              title={filtersActive ? t("productsCatalog.list.noMatch", { q: search.trim() || "…" }) : isNewCompany ? t("productsCatalog.list.emptyP") : t("productsCatalog.list.emptyE")}
              description={!filtersActive && isNewCompany ? (
                <>
                  {t("productsCatalog.list.emptyHelpPre")}
                  {(categories?.length ?? 0) === 0 && <>{t("productsCatalog.list.emptyNeedCategoryPre")}<Link href="/admin/productos/categorias" className="underline underline-offset-4">{t("productsCatalog.list.emptyNeedCategoryLink")}</Link>{t("productsCatalog.list.emptyNeedCategoryPost")}</>}
                </>
              ) : undefined}
            >
              {filtersActive ? (
                <Button type="button" variant="outline" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); }}>{t("productsCatalog.list.clearSearch")}</Button>
              ) : (
                <Button type="button" size="sm" onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {isNewCompany ? t("productsCatalog.list.createFirstP") : t("productsCatalog.list.createFirstE")}
                </Button>
              )}
            </PanelEmpty>
          ) : layout === "grid" ? (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={isNewCompany ? t("productsCatalog.list.captionP") : t("productsCatalog.list.captionE")}>
              {filtered.map((exp) => (
                <li key={exp.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                  <button type="button" onClick={() => openEdit(exp)} className="relative block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t("productsCatalog.list.edit")}: ${exp.title}`}>
                    <ProductThumb src={thumbOf(exp)} alt={exp.title} noImageLabel={t("productsCatalog.list.noImage")} className="w-full rounded-none" />
                    {exp.isFeatured && (
                      <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-card/90 p-1 text-warning shadow-sm">
                        <Star className="h-3.5 w-3.5 fill-current" aria-label={voc.catalog.featured} />
                      </span>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-semibold leading-snug text-foreground">{exp.title}</p>
                        <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{categoryNameOf(exp)}</p>
                      </div>
                      {rowMenu(exp)}
                    </div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="text-base">{priceOf(exp)}</div>
                      <div className="flex flex-wrap items-center gap-1.5">{statusBadges(exp)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <caption className="sr-only">{isNewCompany ? t("productsCatalog.list.captionP") : t("productsCatalog.list.captionE")}</caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th scope="col" className="w-16 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsCatalog.list.colOrder")}</th>
                      <th scope="col" className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tn("noun")}</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsCatalog.list.colPrice")}</th>
                      {showDifficulty && <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsCatalog.list.colDifficulty")}</th>}
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsCatalog.list.colStatus")}</th>
                      <th scope="col" className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productsCatalog.list.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((exp) => {
                      const full = sortedExperiences.findIndex((e) => e.id === exp.id);
                      return (
                        <tr key={exp.id} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                          <td className="px-3 py-4">
                            <div className="flex flex-col items-center gap-0.5" title={filtersActive ? t("productsCatalog.list.reorderBlocked") : undefined}>
                              <button
                                type="button"
                                onClick={() => moveItem(full, "up")}
                                disabled={filtersActive || full === 0 || reorderMutation.isPending}
                                className="rounded p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label={`${t("productsCatalog.list.moveUp")}: ${exp.title}`}
                                title={t("productsCatalog.list.moveUp")}
                              >
                                <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              </button>
                              <span className="w-5 text-center font-mono text-xs text-muted-foreground">{full + 1}</span>
                              <button
                                type="button"
                                onClick={() => moveItem(full, "down")}
                                disabled={filtersActive || full === sortedExperiences.length - 1 || reorderMutation.isPending}
                                className="rounded p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label={`${t("productsCatalog.list.moveDown")}: ${exp.title}`}
                                title={t("productsCatalog.list.moveDown")}
                              >
                                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <ProductThumb src={thumbOf(exp)} alt={exp.title} noImageLabel={t("productsCatalog.list.noImage")} className="w-16" />
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold text-foreground">{exp.title}</p>
                                <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{categoryNameOf(exp)}</p>
                              </div>
                              {exp.isFeatured && (
                                <Star className="h-3.5 w-3.5 shrink-0 fill-current text-warning" aria-label={voc.catalog.featured} />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4">{priceOf(exp)}</td>
                          {showDifficulty && (
                            <td className="px-4 py-4">
                              {exp.difficulty && (
                                <Badge className={cn("text-xs", difficultyColors[exp.difficulty] ?? "")}>
                                  {["facil", "moderado", "dificil", "experto"].includes(exp.difficulty) ? t(`productsCatalog.difficulty.${exp.difficulty}`) : exp.difficulty}
                                </Badge>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-4"><div className="flex flex-col items-start gap-1">{statusBadges(exp)}</div></td>
                          <td className="px-5 py-4"><div className="flex items-center justify-end gap-1">{rowMenu(exp)}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      </div>

      <EditionsPanel experienceId={editionsFor?.id ?? null} title={editionsFor?.title ?? ""} open={!!editionsFor} onOpenChange={(o) => !o && setEditionsFor(null)} />
      <ProductTranslationsPanel experienceId={translationsFor?.id ?? null} title={translationsFor?.title ?? ""} open={!!translationsFor} onOpenChange={(o) => !o && setTranslationsFor(null)} />

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{editingId ? tn("editTitle") : isNewCompany ? t("productsCatalog.modal.newTitleP") : t("productsCatalog.modal.newTitleE")}</DialogTitle>
          </DialogHeader>
          {editingId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("productsCatalog.modal.editionsHint")}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditionsFor({ id: editingId, title: form.title })}>
                <CalendarDays className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> {t("productsCatalog.list.editions")}
              </Button>
            </div>
          )}
          {editingId && multilingual && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{tn("translationsHint")}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setTranslationsFor({ id: editingId, title: form.title })}>
                <Languages className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> {t("productsCatalog.list.languages")}
              </Button>
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate className="space-y-5 mt-2">
            <p className="text-xs text-muted-foreground">{t("productsCatalog.modal.requiredNote")}</p>
            {serverError && (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground">
                {serverError} {t("productsCatalog.modal.serverErrorTail")}
              </div>
            )}
            {submitted && Object.keys(formErrors).length > 0 && (
              <p role="alert" className="text-sm text-destructive">{t("productsCatalog.modal.reviewFields")}</p>
            )}
            {/* 4 zonas de upload de imágenes */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">{t("productsCatalog.modal.imagesTitle")}</Label>
              <div className="grid grid-cols-2 gap-3">
                <ImageUploadZone label={t("productsCatalog.image.n1")} value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} index={1} />
                <ImageUploadZone label={t("productsCatalog.image.n2")} value={form.image2} onChange={(url) => setForm(f => ({ ...f, image2: url }))} index={2} />
                <ImageUploadZone label={t("productsCatalog.image.n3")} value={form.image3} onChange={(url) => setForm(f => ({ ...f, image3: url }))} index={3} />
                <ImageUploadZone label={t("productsCatalog.image.n4")} value={form.image4} onChange={(url) => setForm(f => ({ ...f, image4: url }))} index={4} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="title">{isNewCompany ? t("productsCatalog.modal.name") : t("productsCatalog.modal.titleField")} *</Label>
                <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-required="true" className="mt-1" {...errProps("title", "title")} />
                <ErrorText k="title" id="title" />
              </div>
              <div>
                <Label htmlFor="slug">{isNewCompany ? t("productsCatalog.modal.slugWebAddress") : t("productsCatalog.modal.slugLabel")}</Label>
                <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1" placeholder={t("productsCatalog.modal.slugPlaceholder")} aria-describedby="slug-hint" />
                <p id="slug-hint" className="text-xs text-muted-foreground mt-1">{t("productsCatalog.modal.slugHint")}</p>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="offerMode">{t("productsCatalog.modal.offerMode")}</Label>
                <Select value={form.offerMode} onValueChange={(v) => setForm({ ...form, offerMode: v as OfferMode })}>
                  <SelectTrigger id="offerMode" className="mt-1" aria-describedby="offerMode-hint"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OFFER_MODES.map((m) => <SelectItem key={m} value={m}>{t(`productsCatalog.offerMode.${m}.label`)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p id="offerMode-hint" className="text-xs text-muted-foreground mt-1">{t(`productsCatalog.offerMode.${form.offerMode}.help`)}</p>
              </div>
              {editingId && <SaleReadinessPanel experienceId={editingId} targetMode={form.offerMode} confirmed={confirmReadiness} onConfirmChange={setConfirmReadiness} />}
              {form.offerMode === "fixed" || form.offerMode === "priced_request" ? (
                <div>
                  <Label htmlFor="basePrice">{isNewCompany ? t("productsCatalog.modal.priceLicensed") : t("productsCatalog.modal.priceOriginal")} *</Label>
                  <Input id="basePrice" type="number" inputMode="decimal" min="0" step="0.01" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} aria-required="true" className="mt-1" {...errProps("basePrice", "basePrice")} />
                  <ErrorText k="basePrice" id="basePrice" />
                  {form.offerMode === "priced_request" && (
                    <div className="mt-3">
                      <Label htmlFor="requestCtaLabel">{t("productsCatalog.modal.ctaLabel")}</Label>
                      <Input id="requestCtaLabel" value={form.requestCtaLabel} maxLength={MAX_REQUEST_CTA_LENGTH} onChange={(e) => setForm({ ...form, requestCtaLabel: e.target.value })} className="mt-1" placeholder={DEFAULT_REQUEST_CTA} />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <Label htmlFor="requestCtaLabel">{t("productsCatalog.modal.ctaLabel")}</Label>
                  <Input id="requestCtaLabel" value={form.requestCtaLabel} maxLength={MAX_REQUEST_CTA_LENGTH} onChange={(e) => setForm({ ...form, requestCtaLabel: e.target.value })} className="mt-1" placeholder={DEFAULT_REQUEST_CTA} aria-describedby="requestCta-hint" />
                  <p id="requestCta-hint" className="text-xs text-muted-foreground mt-1">{t("productsCatalog.modal.ctaHint")}</p>
                </div>
              )}
              <div>
                <Label htmlFor="categoryId">{t("productsCatalog.modal.category")} *</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger id="categoryId" className="mt-1" aria-required="true" {...errProps("categoryId", "categoryId")}><SelectValue placeholder={t("productsCatalog.modal.select")} /></SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <ErrorText k="categoryId" id="categoryId" />
                {(categories?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("productsCatalog.modal.noCategories")}<Link href="/admin/productos/categorias" className="underline underline-offset-4">{t("productsCatalog.modal.createCategory")}</Link>{t("productsCatalog.modal.createCategoryTail")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="locationId">{locationLabel} *</Label>
                <Select value={form.locationId} onValueChange={(v) => setForm({ ...form, locationId: v })}>
                  <SelectTrigger id="locationId" className="mt-1" aria-required="true" {...errProps("locationId", "locationId")}><SelectValue placeholder={t("productsCatalog.modal.select")} /></SelectTrigger>
                  <SelectContent>
                    {(locations ?? []).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <ErrorText k="locationId" id="locationId" />
                {(locations?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("productsCatalog.modal.noLocations")}<Link href="/admin/productos/ubicaciones" className="underline underline-offset-4">{t("productsCatalog.modal.addLocation")}</Link>{t("productsCatalog.modal.addLocationTail")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="duration">{t("productsCatalog.modal.duration")}</Label>
                <Input id="duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="mt-1" placeholder={isNewCompany ? t("productsCatalog.modal.durationPlaceholderP") : t("productsCatalog.modal.durationPlaceholderE")} />
              </div>
              {showDifficulty && (
                <div>
                  <Label htmlFor="difficulty">{t("productsCatalog.modal.difficulty")}</Label>
                  <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v })}>
                    <SelectTrigger id="difficulty" className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facil">{t("productsCatalog.difficulty.facil")}</SelectItem>
                      <SelectItem value="moderado">{t("productsCatalog.difficulty.moderado")}</SelectItem>
                      <SelectItem value="dificil">{t("productsCatalog.difficulty.dificil")}</SelectItem>
                      <SelectItem value="experto">{t("productsCatalog.difficulty.experto")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="minPersons">{isNewCompany ? t("productsCatalog.modal.minP") : t("productsCatalog.modal.minE")}</Label>
                <Input id="minPersons" type="number" inputMode="numeric" min="1" value={form.minPersons} onChange={(e) => setForm({ ...form, minPersons: e.target.value })} className="mt-1" {...errProps("minPersons", "minPersons")} />
                <ErrorText k="minPersons" id="minPersons" />
              </div>
              <div>
                <Label htmlFor="maxPersons">{isNewCompany ? t("productsCatalog.modal.maxP") : t("productsCatalog.modal.maxE")}</Label>
                <Input id="maxPersons" type="number" inputMode="numeric" min="1" value={form.maxPersons} onChange={(e) => setForm({ ...form, maxPersons: e.target.value })} className="mt-1" placeholder={isNewCompany ? t("productsCatalog.modal.noLimit") : undefined} {...errProps("maxPersons", "maxPersons")} />
                <ErrorText k="maxPersons" id="maxPersons" />
              </div>

              {/* Tipo de Pricing */}
              <div className="sm:col-span-2">
                <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-lg border text-xs font-bold", TONE_BADGE.brand)} aria-hidden="true">€</span>
                    <span className="text-sm font-semibold text-foreground">{t("productsCatalog.modal.pricingModel")}</span>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">{t("productsCatalog.modal.pricingType")}</Label>
                    <Select value={form.pricingType} onValueChange={(v) => setForm({ ...form, pricingType: v, unitCapacity: "", maxUnits: "" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {/* En una pyme, «per_person» es el precio de cada unidad que se compra (precio × cantidad) */}
                        <SelectItem value="per_person">{isNewCompany ? t("productsCatalog.modal.perUnitLicensed") : t("productsCatalog.modal.perPerson")}</SelectItem>
                        {/* Precio por unidad con capacidad (varias personas por unidad): solo con reservas o si ya lo usa */}
                        {(!isNewCompany || sub.can("bookings-generic") || form.pricingType === "per_unit") && (
                          <SelectItem value="per_unit">{isNewCompany ? t("productsCatalog.modal.perGroup") : t("productsCatalog.modal.perUnitOriginal")}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.pricingType === "per_unit" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="unitCapacity" className="text-xs text-muted-foreground mb-1 block">{t("productsCatalog.modal.personsPerUnit")} *</Label>
                          <Input id="unitCapacity" type="number" min="1" value={form.unitCapacity}
                            onChange={(e) => setForm({ ...form, unitCapacity: e.target.value })} placeholder={t("productsCatalog.modal.example2")} {...errProps("unitCapacity", "unitCapacity")} />
                          <ErrorText k="unitCapacity" id="unitCapacity" />
                        </div>
                        <div>
                          <Label htmlFor="maxUnits" className="text-xs text-muted-foreground mb-1 block">{t("productsCatalog.modal.maxUnits")}</Label>
                          <Input id="maxUnits" type="number" min="1" value={form.maxUnits}
                            onChange={(e) => setForm({ ...form, maxUnits: e.target.value })} placeholder={t("productsCatalog.modal.noLimit")} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground bg-background/60 border border-border/60 rounded-lg px-3 py-2">
                        {t("productsCatalog.modal.unitNoteBasePre")}<strong className="text-foreground">{t("productsCatalog.modal.unitNoteBaseBold")}</strong>.
                        {form.unitCapacity ? <>{t("productsCatalog.modal.unitNoteAdmitsPre")}<strong className="text-foreground">{t("productsCatalog.modal.unitNotePersons", { n: parseInt(form.unitCapacity) })}</strong>.</> : ""}
                        {" "}{t("productsCatalog.modal.unitNoteAuto")}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="shortDescription">{t("productsCatalog.modal.shortDescription")}</Label>
                <Input id="shortDescription" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="description">{t("productsCatalog.modal.fullDescription")}</Label>
                <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" rows={4} />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isFeatured} onCheckedChange={(v) => setForm({ ...form, isFeatured: v })} />
                <Label>{voc.catalog.featured}</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                <Label>{voc.licensed ? t("productsCatalog.list.onSale") : t("productsCatalog.list.active")}</Label>
              </div>
              {voc.licensed && <p className="-mt-2 text-xs text-muted-foreground">{t("productsCatalog.modal.soldOutHint")}</p>}
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.isPublished}
                  onCheckedChange={(v) => setForm({ ...form, isPublished: v })}
                  className={form.isPublished ? "data-[state=checked]:bg-success" : ""}
                />
                <Label className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${form.isPublished ? 'bg-success' : 'bg-muted-foreground'}`} />
                  {form.isPublished ? t("productsCatalog.list.published") : t("productsCatalog.list.notPublished")}
                  <span className="text-xs text-muted-foreground font-normal">{t("productsCatalog.modal.publicVisible")}</span>
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isPresentialSale && presentialSaleAllowed(form.productType)} disabled={!presentialSaleAllowed(form.productType)} onCheckedChange={(v) => setForm({ ...form, isPresentialSale: v })} />
                <Label className="flex items-center gap-1.5"><span className="text-primary font-bold" aria-hidden="true">&#9679;</span> {voc.licensed ? t("productsCatalog.modal.sellableCashier") : t("productsCatalog.modal.sellableTpv")}</Label>
              </div>

              {/* Descuento */}
              <div className="col-span-2">
                <div className={cn("border rounded-xl p-4", TONE_SURFACE.warning)}>
                  <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                    <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs font-bold", TONE_BADGE.warning)} aria-hidden="true">%</span>
                    {t("productsCatalog.modal.promoDiscount")}
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="discountPercent" className="text-xs text-foreground">{t("productsCatalog.modal.discountPercent")}</Label>
                      <div className="relative mt-1">
                        <Input
                          id="discountPercent"
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={form.discountPercent}
                          onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                          placeholder={t("productsCatalog.modal.discountExample")}
                          className="pr-8"
                          {...errProps("discountPercent", "discountPercent")}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm" aria-hidden="true">%</span>
                      </div>
                      <ErrorText k="discountPercent" id="discountPercent" />
                    </div>
                    <div>
                      <Label htmlFor="discountExpiresAt" className="text-xs text-foreground">{t("productsCatalog.modal.validUntil")}</Label>
                      <Input
                        id="discountExpiresAt"
                        type="date"
                        value={form.discountExpiresAt}
                        onChange={(e) => setForm({ ...form, discountExpiresAt: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  {form.discountPercent && (
                    <p className="text-xs text-foreground mt-2">
                      {t("productsCatalog.modal.discountAuto")}
                      {!form.discountExpiresAt && t("productsCatalog.modal.discountNoExpiry")}
                    </p>
                  )}
                </div>
              </div>

              {/* Régimen Fiscal */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                  <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs font-bold", TONE_BADGE.info)} aria-hidden="true">€</span>
                  {t("productsCatalog.modal.taxes")}
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.taxRegime")}</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      value={form.fiscalRegime === "reav" ? "reav" : ({ "10": "iva10", "4": "iva4", "0": "iva0" } as Record<string, string>)[String(Number(form.taxRate))] ?? "iva21"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "reav") setForm({ ...form, fiscalRegime: "reav", taxRate: "0" });
                        else if (v === "iva10") setForm({ ...form, fiscalRegime: "general", taxRate: "10" });
                        else if (v === "iva4") setForm({ ...form, fiscalRegime: "general", taxRate: "4" });
                        else if (v === "iva0") setForm({ ...form, fiscalRegime: "general", taxRate: "0" });
                        else setForm({ ...form, fiscalRegime: "general", taxRate: "21" });
                      }}
                    >
                      <option value="iva21">{t("productsCatalog.modal.vat21")}</option>
                      <option value="iva10">{t("productsCatalog.modal.vat10")}</option>
                      <option value="iva4">{t("productsCatalog.modal.vat4")}</option>
                      <option value="iva0">{t("productsCatalog.modal.vat0")}</option>
                      {showReav && <option value="reav">{t("productsCatalog.modal.reav")}</option>}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">{t("productsCatalog.modal.pvpNote")}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.productType")}</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      value={form.productType}
                      onChange={(e) => setForm({ ...form, productType: e.target.value, isPresentialSale: presentialSaleAllowed(e.target.value) ? form.isPresentialSale : false })}
                    >
                      {productTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                {form.fiscalRegime === "reav" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.providerCost")}</Label>
                      <Input
                        type="number" min="0" max="100" step="0.01"
                        placeholder={t("productsCatalog.modal.example70")}
                        value={form.providerPercent}
                        onChange={(e) => setForm({ ...form, providerPercent: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.agencyMargin")}</Label>
                      <Input
                        type="number" min="0" max="100" step="0.01"
                        placeholder={t("productsCatalog.modal.example30")}
                        value={form.agencyMarginPercent}
                        onChange={(e) => setForm({ ...form, agencyMarginPercent: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
                {form.fiscalRegime === "reav" && (
                  <p className={cn("text-xs text-foreground mt-2 border rounded-lg px-3 py-2", TONE_SURFACE.info)}>
                    {t("productsCatalog.modal.reavWarning")}
                  </p>
                )}
              </div>

              {/* Proveedor y Liquidaciones (solo con el módulo de proveedores contratado) */}
              {showSuppliers && (
              <div className="sm:col-span-2">
                <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                  <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs", TONE_BADGE.brand)} aria-hidden="true">🏢</span>
                  {t("productsCatalog.modal.supplierSection")}
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.supplier")}</Label>
                    <SupplierSelect
                      value={form.supplierId}
                      onChange={(v) => setForm({ ...form, supplierId: v != null ? String(v) : "" })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.costType")}</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      value={form.supplierCostType}
                      onChange={(e) => setForm({ ...form, supplierCostType: e.target.value })}
                    >
                      <option value="comision_sobre_venta">{t("productsCatalog.modal.costCommission")}</option>
                      <option value="precio_neto">{t("productsCatalog.modal.costNet")}</option>
                      <option value="precio_neto_variable">{t("productsCatalog.modal.costNetVariable")}</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.commission")}</Label>
                    <Input
                      type="number" min="0" max="100" step="0.01"
                      placeholder={t("productsCatalog.modal.example20")}
                      value={form.supplierCommissionPercent}
                      onChange={(e) => setForm({ ...form, supplierCommissionPercent: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("productsCatalog.modal.settlementFrequency")}</Label>
                    <select
                      className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      value={form.settlementFrequency}
                      onChange={(e) => setForm({ ...form, settlementFrequency: e.target.value })}
                    >
                      <option value="mensual">{t("productsCatalog.modal.freqMonthly")}</option>
                      <option value="quincenal">{t("productsCatalog.modal.freqBiweekly")}</option>
                      <option value="semanal">{t("productsCatalog.modal.freqWeekly")}</option>
                      <option value="por_reserva">{t("productsCatalog.modal.freqPerBooking")}</option>
                      <option value="manual">{t("productsCatalog.modal.freqManual")}</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <Switch
                    checked={form.isSettlable}
                    onCheckedChange={(v) => setForm({ ...form, isSettlable: v })}
                  />
                  <Label className="text-sm text-slate-600">{t("productsCatalog.modal.autoSettle")}</Label>
                </div>
              </div>
              )}

              {/* Time Slots Panel */}
              {editingId && (
                <TimeSlotsPanel
                  productId={editingId}
                  hasTimeSlots={form.hasTimeSlots}
                  onToggle={(enabled) => setForm(f => ({ ...f, hasTimeSlots: enabled }))}
                />
              )}

              {/* Incluye */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                  <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs", TONE_BADGE.success)} aria-hidden="true">✓</span>
                  {t("productsCatalog.modal.includes")}
                </Label>
                <div className="space-y-2">
                  {form.includes.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...form.includes];
                          next[i] = e.target.value;
                          setForm(f => ({ ...f, includes: next }));
                        }}
                        placeholder={t("productsCatalog.modal.line", { n: i + 1 })}
                        className="flex-1 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-danger hover:bg-danger/10"
                        onClick={() => setForm(f => ({ ...f, includes: f.includes.filter((_, idx) => idx !== i) }))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-success/40 text-foreground hover:bg-success/10"
                    onClick={() => setForm(f => ({ ...f, includes: [...f.includes, ""] }))}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t("productsCatalog.modal.addLine")}
                  </Button>
                </div>
              </div>

              {/* No incluye */}
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                  <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs", TONE_BADGE.danger)} aria-hidden="true">✕</span>
                  {t("productsCatalog.modal.excludes")}
                </Label>
                <div className="space-y-2">
                  {form.excludes.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const next = [...form.excludes];
                          next[i] = e.target.value;
                          setForm(f => ({ ...f, excludes: next }));
                        }}
                        placeholder={t("productsCatalog.modal.line", { n: i + 1 })}
                        className="flex-1 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-danger hover:bg-danger/10"
                        onClick={() => setForm(f => ({ ...f, excludes: f.excludes.filter((_, idx) => idx !== i) }))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-danger/40 text-foreground hover:bg-danger/10"
                    onClick={() => setForm(f => ({ ...f, excludes: [...f.excludes, ""] }))}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t("productsCatalog.modal.addLine")}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)} className="flex-1">{t("productsCatalog.modal.cancel")}</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="flex-1 font-semibold">
                {editingId ? t("productsCatalog.modal.saveChanges") : isNewCompany ? t("productsCatalog.modal.createP") : t("productsCatalog.modal.createE")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de clonación con nombre */}
      <Dialog open={!!cloneModal} onOpenChange={(open) => { if (!open) { setCloneModal(null); setCloneName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5 text-primary" /> {tn("cloneTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t("productsCatalog.clone.cloning")}<strong>{cloneModal?.originalName}</strong>
            </p>
            <div>
              <Label htmlFor="cloneName">{tn("cloneNameLabel")}</Label>
              <Input
                id="cloneName"
                autoFocus
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cloneName.trim() && cloneModal)
                    cloneMutation.mutate({ id: cloneModal.id, newName: cloneName.trim() });
                }}
                placeholder={isNewCompany ? t("productsCatalog.clone.namePlaceholderP") : t("productsCatalog.clone.namePlaceholderE")}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("productsCatalog.clone.slugHint")}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setCloneModal(null); setCloneName(""); }} className="flex-1">
              {t("productsCatalog.clone.cancel")}
            </Button>
            <Button
              onClick={() => { if (cloneModal && cloneName.trim()) cloneMutation.mutate({ id: cloneModal.id, newName: cloneName.trim() }); }}
              disabled={!cloneName.trim() || cloneMutation.isPending}
              className="flex-1 font-semibold"
            >
              {cloneMutation.isPending ? t("productsCatalog.clone.busy") : t("productsCatalog.clone.action")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title ? <>{t("productsCatalog.delete.willDeletePre", { title: deleteTarget.title })}</> : null}{t("productsCatalog.delete.irreversible")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("productsCatalog.delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => { if (deleteTarget) hardDeleteMutation.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
            >
              {t("productsCatalog.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
