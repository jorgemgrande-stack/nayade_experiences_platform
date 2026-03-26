import React, { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Phone, Mail, Users, ChevronRight,
  Send, Star, Shield, Zap, ArrowRight, Waves,
  Sparkles, Heart, TreePine, SunMedium, Plus, X,
  ChevronLeft, Clock, Minus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Assets ───────────────────────────────────────────────────────────────────
const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774088145054-jpwq7l.png";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ActivityEntry {
  experienceId: number;
  experienceTitle: string;
  family: string;
  participants: number;
  details: Record<string, string | number>;
}

interface ModalState {
  open: boolean;
  experienceId: number;
  experienceTitle: string;
  family: string;
  slug: string;
}

// ─── Familias de actividad ────────────────────────────────────────────────────
// Mapeo de slug de experiencia → familia de preguntas contextuales (fallback cuando no hay variantes)
const FAMILY_MAP: Record<string, string> = {
  "blob-jump": "saltos",
  "banana-ski": "remolcado",
  "cableski": "cableski",
  "canoas": "alquiler",
  "paddle-surf": "alquiler",
  "hidrobicis": "alquiler",
  "minimotos": "alquiler",
  "paseos-barco": "barco",
  "aventura-hinchable": "alquiler",
  "circuito-spa": "spa",
  "donuts-ski": "remolcado",
};

// Obtiene la familia según el slug (búsqueda parcial)
function getFamilyForSlug(slug: string): string {
  for (const [key, fam] of Object.entries(FAMILY_MAP)) {
    if (slug.includes(key)) return fam;
  }
  return "generico";
}

// Colores de chip por familia
const FAMILY_CHIP_COLORS: Record<string, { active: string; hover: string }> = {
  saltos:    { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",   hover: "hover:border-amber-500/30 hover:text-white/80" },
  cableski:  { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",         hover: "hover:border-sky-500/30 hover:text-white/80" },
  remolcado: { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",   hover: "hover:border-amber-500/30 hover:text-white/80" },
  alquiler:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",   hover: "hover:border-amber-500/30 hover:text-white/80" },
  barco:     { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",         hover: "hover:border-sky-500/30 hover:text-white/80" },
  spa:       { active: "bg-violet-500/20 text-violet-300 border-violet-500/50", hover: "hover:border-violet-500/30 hover:text-white/80" },
  generico:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",   hover: "hover:border-amber-500/30 hover:text-white/80" },
};

// ─── Categorías ───────────────────────────────────────────────────────────────
const STATIC_CATEGORIES = [
  { id: "Experiencias", label: "Experiencias", icon: "🌊" },
  { id: "Packs", label: "Packs", icon: "⭐" },
  { id: "LegoPacks", label: "Lego Packs", icon: "🧩" },
  { id: "Hotel", label: "Hotel", icon: "🏨" },
  { id: "Spa", label: "SPA", icon: "🧖" },
  { id: "Pack colegios", label: "Colegios", icon: "🎒" },
  { id: "Pack teambuilding", label: "Empresas", icon: "🤝" },
];

const STATIC_PRODUCTS: Record<string, string[]> = {
  Hotel: ["Habitación Estándar", "Habitación Superior", "Suite Lago", "Suite Premium"],
  Spa: ["Circuito SPA", "Masaje Relajante", "Tratamiento Facial", "Pack Pareja SPA"],
  "Pack colegios": ["Pack Escolar Básico", "Pack Escolar Aventura", "Pack Escolar Náutico"],
  "Pack teambuilding": ["Teambuilding Básico", "Teambuilding Premium", "Jornada Corporativa Completa"],
};

const SPECIAL_OPTION = "__special__";

// ─── Chips decorativos ────────────────────────────────────────────────────────
const EXP_CHIPS = [
  { icon: Waves, label: "Deportes acuáticos", color: "text-sky-300" },
  { icon: TreePine, label: "Aventura", color: "text-emerald-300" },
  { icon: Heart, label: "Parejas", color: "text-rose-300" },
  { icon: Users, label: "Familias", color: "text-amber-300" },
  { icon: SunMedium, label: "Relax & SPA", color: "text-violet-300" },
  { icon: Sparkles, label: "Empresas", color: "text-orange-300" },
];

// ─── Componente Modal de actividad ────────────────────────────────────────────
function ActivityModal({
  modal,
  totalPersons,
  onClose,
  onConfirm,
}: {
  modal: ModalState;
  totalPersons: number;
  onClose: () => void;
  onConfirm: (entry: ActivityEntry) => void;
}) {
  const [participants, setParticipants] = React.useState(totalPersons || 1);
  const [details, setDetails] = React.useState<Record<string, string | number>>({});

  // Cargar variantes reales del CRM para esta experiencia
  const { data: variants, isLoading: variantsLoading } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: modal.experienceId },
    { enabled: modal.open && modal.experienceId > 0 }
  );

  // Resetear detalles cuando cambia la experiencia
  const prevExpId = React.useRef(modal.experienceId);
  React.useEffect(() => {
    if (modal.experienceId !== prevExpId.current) {
      setDetails({});
      setParticipants(totalPersons || 1);
      prevExpId.current = modal.experienceId;
    }
  }, [modal.experienceId, totalPersons]);

  const handleConfirm = () => {
    const entry: ActivityEntry = {
      experienceId: modal.experienceId,
      experienceTitle: modal.experienceTitle,
      family: modal.family,
      participants,
      details,
    };
    onConfirm(entry);
  };

  const setDetail = (key: string, value: string | number) => {
    setDetails((prev) => ({ ...prev, [key]: value }));
  };

  const chipColors = FAMILY_CHIP_COLORS[modal.family] ?? FAMILY_CHIP_COLORS.generico;

  // ─── Sección dinámica: variantes del CRM ──────────────────────────────────────
  const renderVariantFields = () => {
    if (variantsLoading) {
      return (
        <div className="flex items-center gap-2 text-white/40 text-xs py-2">
          <div className="w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          Cargando opciones…
        </div>
      );
    }

    if (variants && variants.length > 0) {
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-white/60 text-xs mb-2 block">¿Qué formato prefieres?</Label>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDetail("variante", v.name)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                    details.variante === v.name
                      ? chipColors.active
                      : `border-white/15 text-white/50 bg-white/[0.04] ${chipColors.hover}`
                  }`}
                  title={v.description ?? undefined}
                >
                  {v.name}
                  {v.priceModifier && Number(v.priceModifier) > 0 && (
                    <span className="ml-1.5 opacity-60">
                      {v.priceType === "per_person" ? `${v.priceModifier}€/pax` : `${v.priceModifier}€`}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {details.variante && (() => {
              const sel = variants.find(v => v.name === details.variante);
              return sel?.description ? (
                <p className="text-white/30 text-xs mt-2">{sel.description}</p>
              ) : null;
            })()}
          </div>
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
            <Textarea
              value={String(details.notas || "")}
              onChange={(e) => setDetail("notas", e.target.value)}
              className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
              rows={2}
              placeholder="Preferencias, restricciones, nivel…"
            />
          </div>
        </div>
      );
    }

    // Sin variantes en CRM — mostrar campos contextuales por familia (fallback)
    return renderFamilyFallback();
  };

  // ─── Fallback por familia cuando no hay variantes en CRM ─────────────────────
  const renderFamilyFallback = () => {
    const chipCls = (key: string, val: string) =>
      `px-3 py-1.5 rounded-full text-xs border transition-all ${
        (details[key] as string) === val
          ? chipColors.active
          : `border-white/15 text-white/50 bg-white/[0.04] ${chipColors.hover}`
      }`;

    switch (modal.family) {
      case "cableski":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración preferida</Label>
              <div className="flex flex-wrap gap-2">
                {["30 minutos", "1 hora", "2 horas", "Día completo"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Nivel de experiencia</Label>
              <div className="flex flex-wrap gap-2">
                {["Principiante", "Intermedio", "Avanzado"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("nivel", opt)} className={chipCls("nivel", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "saltos":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Número de saltos en total (grupo)</Label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setDetail("saltos", Math.max(1, (Number(details.saltos) || 1) - 1))}
                  className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-white font-bold text-xl w-8 text-center">{details.saltos || 1}</span>
                <button type="button" onClick={() => setDetail("saltos", (Number(details.saltos) || 1) + 1)}
                  className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 hover:bg-amber-500/30 transition-colors">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <p className="text-white/30 text-xs mt-2">Ej: si sois 5 y cada uno quiere 2 saltos → 10 saltos</p>
            </div>
          </div>
        );
      case "remolcado":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración preferida</Label>
              <div className="flex flex-wrap gap-2">
                {["15 minutos", "30 minutos", "1 hora"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "alquiler":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración del alquiler</Label>
              <div className="flex flex-wrap gap-2">
                {["30 minutos", "1 hora", "2 horas", "Medio día", "Día completo"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
              <Textarea
                value={String(details.notas || "")}
                onChange={(e) => setDetail("notas", e.target.value)}
                className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
                rows={2}
                placeholder="Cuéntanos qué tienes en mente…"
              />
            </div>
          </div>
        );
      case "barco":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Tipo de embarcación</Label>
              <div className="flex flex-wrap gap-2">
                {["Barco pequeño (hasta 8 pax)", "Barco grande (hasta 20 pax)"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("tipo", opt)} className={chipCls("tipo", opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Duración</Label>
              <div className="flex flex-wrap gap-2">
                {["1 hora", "2 horas", "Medio día"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("duracion", opt)} className={chipCls("duracion", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      case "spa":
        return (
          <div className="space-y-4">
            <div>
              <Label className="text-white/60 text-xs mb-2 block">Tipo de circuito</Label>
              <div className="flex flex-wrap gap-2">
                {["Circuito básico (2h)", "Circuito premium (3h)", "Circuito pareja"].map((opt) => (
                  <button key={opt} type="button" onClick={() => setDetail("tipo", opt)} className={chipCls("tipo", opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Preferencias adicionales (opcional)</Label>
            <Textarea
              value={String(details.notas || "")}
              onChange={(e) => setDetail("notas", e.target.value)}
              className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none"
              rows={2}
              placeholder="Cuéntanos qué tienes en mente…"
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={modal.open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" style={{
        background: "rgba(10, 20, 40, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
      }}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Waves className="w-4 h-4 text-amber-400" />
            </div>
            <DialogTitle className="text-white text-base font-heading">{modal.experienceTitle}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Participantes — siempre fijo, no depende de variantes */}
          <div>
            <Label className="text-white/60 text-xs mb-2 block flex items-center gap-1">
              <Users className="w-3 h-3" /> ¿Cuántas personas participan en esta actividad?
            </Label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setParticipants(Math.max(1, participants - 1))}
                className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-white font-bold text-xl w-8 text-center">{participants}</span>
              <button type="button" onClick={() => setParticipants(participants + 1)}
                className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 hover:bg-amber-500/30 transition-colors">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {participants < (totalPersons || 1) && (
              <p className="text-amber-400/70 text-xs mt-1.5">
                De {totalPersons} personas del grupo, {participants} participan en esta actividad
              </p>
            )}
          </div>

          {/* Opciones dinámicas del CRM o fallback por familia */}
          {renderVariantFields()}
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:text-white hover:border-white/30 bg-transparent">
            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm}
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-0">
            Añadir actividad <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function BudgetRequest() {
  const [submitted, setSubmitted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedActivities, setSelectedActivities] = useState<ActivityEntry[]>([]);
  const [modalState, setModalState] = useState<ModalState>({ open: false, experienceId: 0, experienceTitle: "", family: "", slug: "" });
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", arrivalDate: "",
    adults: "1", children: "0", comments: "", honeypot: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const totalPersons = (parseInt(formData.adults) || 1) + (parseInt(formData.children) || 0);

  // ─── Cargar experiencias y packs ──────────────────────────────────────────
  const { data: experiencesList } = trpc.public.getExperiences.useQuery(
    { limit: 50 },
    { enabled: selectedCategory === "Experiencias" }
  );
  const { data: packsList } = trpc.packs.getByCategory.useQuery(
    {} as { category?: "dia" | "escolar" | "empresa" },
    { enabled: selectedCategory === "Packs" }
  );
  const { data: legoPacksList } = trpc.legoPacks.listPublic.useQuery(
    undefined, { enabled: selectedCategory === "LegoPacks" }
  );

  const products = useMemo(() => {
    if (selectedCategory === "Packs" && packsList) return packsList.map((p: any) => p.title);
    if (selectedCategory === "LegoPacks" && legoPacksList) return legoPacksList.map((p: any) => p.title);
    return STATIC_PRODUCTS[selectedCategory] ?? [];
  }, [selectedCategory, packsList, legoPacksList]);

  const submitBudget = trpc.public.submitBudget.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Error al enviar. Por favor, inténtalo de nuevo."),
  });

  // ─── Validación ───────────────────────────────────────────────────────────
  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) e.name = "Introduce tu nombre";
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Email no válido";
    if (!formData.phone.trim() || formData.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (!formData.arrivalDate) e.arrivalDate = "Selecciona una fecha";
    if (!selectedCategory) e.category = "Selecciona una categoría";
    if (selectedCategory === "Experiencias") {
      if (selectedActivities.length === 0) e.product = "Selecciona al menos una experiencia";
    } else {
      if (!selectedProduct) e.product = "Selecciona una opción";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    const productSummary = selectedCategory === "Experiencias"
      ? selectedActivities.map((a) => a.experienceTitle).join(", ")
      : (selectedProduct === SPECIAL_OPTION ? "Petición especial / Propuesta personalizada" : selectedProduct);

    await submitBudget.mutateAsync({
      name: formData.name.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      arrivalDate: formData.arrivalDate,
      adults: parseInt(formData.adults) || 1,
      children: parseInt(formData.children) || 0,
      selectedCategory,
      selectedProduct: productSummary,
      activitiesJson: selectedCategory === "Experiencias" ? selectedActivities : undefined,
      comments: formData.comments.trim() || undefined,
      honeypot: formData.honeypot || undefined,
    });
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    setSelectedProduct("");
    setSelectedActivities([]);
    setErrors((p) => ({ ...p, category: "", product: "" }));
  };

  // ─── Gestión de actividades ───────────────────────────────────────────────
  const openActivityModal = useCallback((exp: { id: number; title: string; slug: string }) => {
    const family = getFamilyForSlug(exp.slug);
    setModalState({ open: true, experienceId: exp.id, experienceTitle: exp.title, family, slug: exp.slug });
  }, []);

  const handleModalConfirm = useCallback((entry: ActivityEntry) => {
    setSelectedActivities((prev) => {
      // Si ya existe la misma experiencia, la reemplaza
      const exists = prev.findIndex((a) => a.experienceId === entry.experienceId);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = entry;
        return updated;
      }
      return [...prev, entry];
    });
    setModalState((s) => ({ ...s, open: false }));
    setErrors((p) => ({ ...p, product: "" }));
  }, []);

  const removeActivity = useCallback((experienceId: number) => {
    setSelectedActivities((prev) => prev.filter((a) => a.experienceId !== experienceId));
  }, []);

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
          <img src={HERO_BG} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative z-10 text-center max-w-xl mx-auto px-6 py-20">
            <div className="w-24 h-24 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mx-auto mb-8">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-5xl font-heading font-bold text-white mb-4">¡Perfecto!</h2>
            <p className="text-xl text-white/75 mb-3 font-display">Tu experiencia está en camino.</p>
            <p className="text-white/55 mb-10 leading-relaxed">
              Nuestro equipo te enviará una propuesta personalizada en
              <strong className="text-amber-400"> menos de 24 horas</strong>.
            </p>
            {selectedActivities.length > 0 && (
              <div className="bg-white/10 rounded-2xl p-4 mb-8 text-left border border-white/10">
                <p className="text-white/50 text-xs mb-3 font-display uppercase tracking-wider">Actividades solicitadas</p>
                {selectedActivities.map((a) => (
                  <div key={a.experienceId} className="flex items-center gap-2 text-sm text-white/70 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>{a.experienceTitle}</span>
                    <span className="text-white/35">· {a.participants} personas</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 mb-10">
              {[{ icon: Zap, label: "Respuesta rápida" }, { icon: Star, label: "A tu medida" }, { icon: Shield, label: "Sin compromiso" }].map(({ icon: Icon, label }) => (
                <div key={label} className="bg-white/10 rounded-2xl p-4 border border-white/10 text-center">
                  <Icon className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                  <span className="text-white/60 text-xs">{label}</span>
                </div>
              ))}
            </div>
            <Button asChild className="bg-amber-500 hover:bg-amber-400 text-white font-semibold h-12 px-8 rounded-full">
              <Link href="/">Explorar más experiencias <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* Modal de actividad */}
      {modalState.open && (
        <ActivityModal
          modal={modalState}
          totalPersons={totalPersons}
          onClose={() => setModalState((s) => ({ ...s, open: false }))}
          onConfirm={handleModalConfirm}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          HERO SPLIT — Pantalla completa: claim izquierda + formulario derecha
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-stretch overflow-hidden">

        {/* Fondo aspiracional */}
        <img
          src={HERO_BG}
          alt="Náyade Experiences"
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ animation: "slowZoom 25s ease-in-out infinite alternate" }}
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        {/* Contenido split */}
        <div className="relative z-10 container flex flex-col lg:flex-row items-center gap-8 lg:gap-12 py-24 lg:py-0 min-h-screen">

          {/* ── Columna izquierda: Claim ─────────────────────────────────── */}
          <div className="flex-1 text-white lg:py-24">
            <span className="inline-flex items-center gap-2 bg-amber-500/90 text-white text-xs font-display font-bold uppercase tracking-widest px-5 py-2 rounded-full mb-6 shadow-lg">
              <Sparkles className="w-3.5 h-3.5" />
              A 40 min de Madrid · Temporada 2026
            </span>

            <h1 className="text-4xl md:text-5xl xl:text-6xl font-heading font-black leading-[1.05] mb-5">
              Diseñamos<br />
              <span className="text-amber-400">tu experiencia</span><br />
              perfecta
            </h1>

            <p className="text-lg md:text-xl text-white/70 font-display font-light mb-8 leading-relaxed max-w-md">
              Actividades acuáticas, relax, escapadas y aventura en el embalse de Los Ángeles de San Rafael.
            </p>

            {/* Chips de tipos */}
            <div className="flex flex-wrap gap-2 mb-8">
              {EXP_CHIPS.map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-xs text-white/75">
                  <Icon className={`w-3 h-3 ${color}`} />
                  {label}
                </div>
              ))}
            </div>

            {/* Trust pills */}
            <div className="flex flex-col gap-2">
              {[
                { icon: Zap, text: "Respuesta en menos de 24h" },
                { icon: Star, text: "Propuesta 100% personalizada" },
                { icon: Shield, text: "Sin compromiso" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm text-white/55">
                  <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </div>

          {/* ── Columna derecha: Formulario glass flotante ───────────────── */}
          <div className="w-full lg:w-[480px] xl:w-[520px] shrink-0 lg:py-8">
            <div
              className="rounded-3xl overflow-hidden shadow-2xl"
              style={{
                background: "rgba(10, 20, 40, 0.82)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06) inset",
              }}
            >
              {/* Barra superior degradada */}
              <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500" />

              {/* Encabezado del formulario */}
              <div className="px-7 pt-6 pb-4 border-b border-white/[0.07]">
                <h2 className="text-white font-heading font-bold text-xl">Cuéntanos qué quieres vivir</h2>
                <p className="text-white/45 text-sm mt-1">Recibirás tu propuesta en menos de 24h</p>
              </div>

              {/* Formulario con scroll interno si es necesario */}
              <div className="overflow-y-auto max-h-[calc(100vh-260px)] lg:max-h-[calc(100vh-200px)]">
                <form onSubmit={handleSubmit} className="px-7 py-5 space-y-5">
                  {/* Honeypot */}
                  <input type="text" name="website" value={formData.honeypot} onChange={(e) => setFormData({ ...formData, honeypot: e.target.value })} style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

                  {/* Nombre + Email */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Nombre <span className="text-amber-400">*</span></Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setErrors({ ...errors, name: "" }); }}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.name ? "border-red-400/60" : ""}`}
                        placeholder="Tu nombre"
                      />
                      {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Email <span className="text-amber-400">*</span></Label>
                      <Input
                        type="email" value={formData.email}
                        onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setErrors({ ...errors, email: "" }); }}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.email ? "border-red-400/60" : ""}`}
                        placeholder="tu@email.com"
                      />
                      {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                    </div>
                  </div>

                  {/* Teléfono + Fecha */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Teléfono <span className="text-amber-400">*</span></Label>
                      <Input
                        type="tel" value={formData.phone}
                        onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setErrors({ ...errors, phone: "" }); }}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.phone ? "border-red-400/60" : ""}`}
                        placeholder="+34 600 000 000"
                      />
                      {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Fecha llegada <span className="text-amber-400">*</span></Label>
                      <Input
                        type="date" value={formData.arrivalDate}
                        min={new Date().toISOString().split("T")[0]}
                        onChange={(e) => { setFormData({ ...formData, arrivalDate: e.target.value }); setErrors({ ...errors, arrivalDate: "" }); }}
                        className={`h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50 ${errors.arrivalDate ? "border-red-400/60" : ""}`}
                        style={{ colorScheme: "dark" }}
                      />
                      {errors.arrivalDate && <p className="text-red-400 text-xs mt-1">{errors.arrivalDate}</p>}
                    </div>
                  </div>

                  {/* Personas */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1"><Users className="w-3 h-3" /> Adultos</Label>
                      <Input type="number" min="1" max="200" value={formData.adults}
                        onChange={(e) => setFormData({ ...formData, adults: e.target.value })}
                        className="h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50"
                        style={{ colorScheme: "dark" }}
                      />
                    </div>
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1"><Users className="w-3 h-3" /> Niños</Label>
                      <Input type="number" min="0" max="200" value={formData.children}
                        onChange={(e) => setFormData({ ...formData, children: e.target.value })}
                        className="h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50"
                        style={{ colorScheme: "dark" }}
                      />
                    </div>
                  </div>

                  {/* Selector de categoría */}
                  <div>
                    <Label className="text-white/50 text-xs mb-2 block">¿Qué quieres vivir? <span className="text-amber-400">*</span></Label>
                    <div className="flex flex-wrap gap-1.5">
                      {STATIC_CATEGORIES.map((cat) => (
                        <button key={cat.id} type="button" onClick={() => handleCategorySelect(cat.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                            selectedCategory === cat.id
                              ? "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20"
                              : "border-white/15 text-white/55 hover:border-amber-500/40 hover:text-white bg-white/[0.05]"
                          }`}
                        >
                          <span>{cat.icon}</span> {cat.label}
                        </button>
                      ))}
                    </div>
                    {errors.category && <p className="text-red-400 text-xs mt-1.5">{errors.category}</p>}
                  </div>

                  {/* ── Selector de experiencias (múltiple) ─────────────────── */}
                  {selectedCategory === "Experiencias" && (
                    <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-2xl space-y-3">
                      <p className="text-white/40 text-xs flex items-center gap-1">
                        <ChevronRight className="w-3 h-3 text-amber-400" />
                        Selecciona las actividades <span className="text-amber-400">*</span>
                        <span className="text-white/25 ml-1">— puedes elegir varias</span>
                      </p>

                      {/* Lista de experiencias */}
                      <div className="flex flex-wrap gap-1.5">
                        {(experiencesList ?? []).map((exp: any) => {
                          const isSelected = selectedActivities.some((a) => a.experienceId === exp.id);
                          return (
                            <button key={exp.id} type="button"
                              onClick={() => openActivityModal({ id: exp.id, title: exp.title, slug: exp.slug })}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
                                isSelected
                                  ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                  : "border-white/10 text-white/45 hover:border-sky-500/30 hover:text-white/75 bg-white/[0.03]"
                              }`}
                            >
                              {isSelected ? (
                                <><CheckCircle className="w-3 h-3" /> {exp.title}</>
                              ) : (
                                <><Plus className="w-3 h-3" /> {exp.title}</>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Resumen de actividades seleccionadas */}
                      {selectedActivities.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2.5">
                          <p className="text-white/30 text-xs mb-1.5">Actividades añadidas:</p>
                          {selectedActivities.map((act) => (
                            <div key={act.experienceId} className="flex items-center justify-between bg-white/[0.06] rounded-xl px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <span className="text-white/80 text-xs font-medium truncate block">{act.experienceTitle}</span>
                                <span className="text-white/35 text-xs">
                                  {act.participants} persona{act.participants !== 1 ? "s" : ""}
                                  {act.details.duracion ? ` · ${act.details.duracion}` : ""}
                                  {act.details.saltos ? ` · ${act.details.saltos} salto${Number(act.details.saltos) !== 1 ? "s" : ""}` : ""}
                                  {act.details.tipo ? ` · ${act.details.tipo}` : ""}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 ml-2 shrink-0">
                                <button type="button"
                                  onClick={() => openActivityModal({ id: act.experienceId, title: act.experienceTitle, slug: (experiencesList ?? []).find((e: any) => e.id === act.experienceId)?.slug ?? "" })}
                                  className="text-white/30 hover:text-amber-400 transition-colors p-1">
                                  <Clock className="w-3 h-3" />
                                </button>
                                <button type="button" onClick={() => removeActivity(act.experienceId)}
                                  className="text-white/30 hover:text-red-400 transition-colors p-1">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {errors.product && <p className="text-red-400 text-xs mt-1">{errors.product}</p>}
                    </div>
                  )}

                  {/* ── Selector de producto (para no-Experiencias) ──────────── */}
                  {selectedCategory && selectedCategory !== "Experiencias" && (
                    <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-2xl">
                      <p className="text-white/40 text-xs mb-2 flex items-center gap-1">
                        <ChevronRight className="w-3 h-3 text-amber-400" />
                        Opción <span className="text-amber-400">*</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {products.map((product: string) => (
                          <button key={product} type="button"
                            onClick={() => { setSelectedProduct(product); setErrors({ ...errors, product: "" }); }}
                            className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                              selectedProduct === product
                                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                : "border-white/10 text-white/45 hover:border-sky-500/30 hover:text-white/75 bg-white/[0.03]"
                            }`}
                          >
                            {product}
                          </button>
                        ))}
                        <button type="button"
                          onClick={() => { setSelectedProduct(SPECIAL_OPTION); setErrors({ ...errors, product: "" }); }}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                            selectedProduct === SPECIAL_OPTION
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : "border-amber-500/20 text-amber-400/60 hover:border-amber-500/40 bg-white/[0.03]"
                          }`}
                        >
                          <Star className="w-2.5 h-2.5" /> Propuesta personalizada
                        </button>
                      </div>
                      {errors.product && <p className="text-red-400 text-xs mt-1.5">{errors.product}</p>}
                    </div>
                  )}

                  {/* Comentarios */}
                  <div>
                    <Label className="text-white/50 text-xs mb-1.5 block">Comentarios (opcional)</Label>
                    <Textarea
                      value={formData.comments}
                      onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                      className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none focus:border-amber-500/50"
                      rows={2}
                      placeholder="Ocasión especial, preferencias, grupo grande…"
                    />
                  </div>

                  {/* CTA */}
                  <div className="pb-2">
                    <Button type="submit" disabled={submitBudget.isPending}
                      className="w-full h-12 text-sm font-bold rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-0 shadow-lg shadow-amber-500/20 transition-all duration-300"
                    >
                      {submitBudget.isPending ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Preparando tu propuesta…
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Send className="w-4 h-4" />
                          Quiero mi propuesta personalizada
                        </span>
                      )}
                    </Button>
                    <p className="text-white/25 text-xs text-center mt-2.5">
                      Sin compromiso · Respuesta en &lt;24h ·{" "}
                      <Link href="/privacidad" className="underline hover:text-amber-400">Privacidad</Link>
                    </p>
                  </div>
                </form>
              </div>

              {/* Footer del card: contacto directo */}
              <div className="px-7 py-4 border-t border-white/[0.07] flex flex-col sm:flex-row items-center justify-center gap-4 text-white/35 text-xs">
                <a href="tel:+34930347791" className="flex items-center gap-1.5 hover:text-amber-400 transition-colors">
                  <Phone className="w-3.5 h-3.5" /> +34 930 34 77 91
                </a>
                <span className="hidden sm:block text-white/15">·</span>
                <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-1.5 hover:text-amber-400 transition-colors">
                  <Mail className="w-3.5 h-3.5" /> reservas@nayadeexperiences.es
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECCIÓN LIGERA DE BENEFICIOS
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-14 bg-background border-t border-border/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: Zap, title: "Respuesta en 24h", desc: "Propuesta personalizada en menos de un día.", color: "text-amber-500", bg: "bg-amber-500/10" },
              { icon: Star, title: "100% personalizado", desc: "Diseñamos la experiencia según tus necesidades.", color: "text-sky-500", bg: "bg-sky-500/10" },
              { icon: Shield, title: "Sin compromiso", desc: "Solicita sin ninguna obligación.", color: "text-emerald-500", bg: "bg-emerald-500/10" },
              { icon: Heart, title: "Para todos", desc: "Parejas, familias, grupos y empresas.", color: "text-rose-500", bg: "bg-rose-500/10" },
            ].map(({ icon: Icon, title, desc, color, bg }) => (
              <div key={title} className="group">
                <div className={`w-12 h-12 ${bg} rounded-2xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h4 className="font-display font-semibold text-sm text-foreground mb-1">{title}</h4>
                <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
