import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Phone, Mail, Users, ChevronRight,
  Send, Star, Shield, Zap, ArrowRight, Waves,
  Sparkles, Heart, TreePine, SunMedium
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Assets ───────────────────────────────────────────────────────────────────
const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774088145054-jpwq7l.png";
const STRIP_IMAGES = [
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/wakeboard_b574701d.jpg",
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/aventura_hinchable_7c004251.png",
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa4_0e502ffb.png",
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/31bc24b6-13c3-4ea1-a67f-16a927473c61_d7582ff1.png",
];

// ─── Categorías ───────────────────────────────────────────────────────────────
const STATIC_CATEGORIES = [
  { id: "Experiencias", label: "Experiencias Acuáticas", icon: "🌊" },
  { id: "Packs", label: "Packs Completos", icon: "⭐" },
  { id: "Hotel", label: "Hotel", icon: "🏨" },
  { id: "Spa", label: "SPA & Bienestar", icon: "🧖" },
  { id: "Pack colegios", label: "Pack Colegios", icon: "🎒" },
  { id: "Pack teambuilding", label: "Pack Teambuilding", icon: "🤝" },
];

const STATIC_PRODUCTS: Record<string, string[]> = {
  Hotel: ["Habitación Estándar", "Habitación Superior", "Suite Lago", "Suite Premium"],
  Spa: ["Circuito SPA", "Masaje Relajante", "Tratamiento Facial", "Pack Pareja SPA"],
  "Pack colegios": ["Pack Escolar Básico", "Pack Escolar Aventura", "Pack Escolar Náutico"],
  "Pack teambuilding": ["Teambuilding Básico", "Teambuilding Premium", "Jornada Corporativa Completa"],
};

const SPECIAL_OPTION = "__special__";

// ─── Experiencias de tipo ─────────────────────────────────────────────────────
const EXPERIENCE_TYPES = [
  { icon: Waves, label: "Deportes acuáticos", color: "text-sky-400" },
  { icon: TreePine, label: "Aventura & Naturaleza", color: "text-emerald-400" },
  { icon: Heart, label: "Parejas & Romántico", color: "text-rose-400" },
  { icon: Users, label: "Familias & Grupos", color: "text-amber-400" },
  { icon: SunMedium, label: "Relax & Bienestar", color: "text-violet-400" },
  { icon: Sparkles, label: "Eventos & Empresas", color: "text-orange-400" },
];

// ─── Hook de animación al scroll ──────────────────────────────────────────────
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

export default function BudgetRequest() {
  const [submitted, setSubmitted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", arrivalDate: "",
    adults: "1", children: "0", comments: "", honeypot: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const heroFade = useFadeIn();
  const formFade = useFadeIn();
  const benefitsFade = useFadeIn();

  // ─── Cargar productos dinámicos ──────────────────────────────────────────
  const { data: experiences } = trpc.public.getExperiences.useQuery(
    { limit: 100 },
    { enabled: selectedCategory === "Experiencias" }
  );
  const { data: packs } = trpc.packs.getByCategory.useQuery(
    { category: undefined },
    { enabled: selectedCategory === "Packs" }
  );

  const products = useMemo(() => {
    if (selectedCategory === "Experiencias" && experiences) return experiences.map((e: any) => e.title);
    if (selectedCategory === "Packs" && packs) return packs.map((p: any) => p.title);
    return STATIC_PRODUCTS[selectedCategory] ?? [];
  }, [selectedCategory, experiences, packs]);

  const submitBudget = trpc.public.submitBudget.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Error al enviar. Por favor, inténtalo de nuevo."),
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) e.name = "Introduce tu nombre";
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Email no válido";
    if (!formData.phone.trim() || formData.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (!formData.arrivalDate) e.arrivalDate = "Selecciona una fecha";
    if (!selectedCategory) e.category = "Selecciona una categoría";
    if (!selectedProduct) e.product = "Selecciona una experiencia";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    await submitBudget.mutateAsync({
      name: formData.name.trim(), email: formData.email.trim(), phone: formData.phone.trim(),
      arrivalDate: formData.arrivalDate,
      adults: parseInt(formData.adults) || 1, children: parseInt(formData.children) || 0,
      selectedCategory, selectedProduct: selectedProduct === SPECIAL_OPTION ? "Petición especial / Propuesta personalizada" : selectedProduct,
      comments: formData.comments.trim() || undefined,
      honeypot: formData.honeypot || undefined,
    });
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat); setSelectedProduct("");
    setErrors((p) => ({ ...p, category: "", product: "" }));
  };

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0">
            <img src={HERO_BG} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
          </div>
          <div className="relative z-10 text-center max-w-xl mx-auto px-6 py-20">
            <div className="w-28 h-28 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-8">
              <CheckCircle className="w-14 h-14 text-emerald-400" />
            </div>
            <h2 className="text-5xl font-heading font-bold text-white mb-4">¡Perfecto!</h2>
            <p className="text-xl text-white/80 mb-3 font-display">Tu experiencia está en camino.</p>
            <p className="text-white/60 mb-10 leading-relaxed">
              Nuestro equipo revisará tu solicitud y te enviará una propuesta personalizada en
              <strong className="text-amber-400"> menos de 24 horas</strong>.
            </p>
            <div className="grid grid-cols-3 gap-4 mb-10">
              {[
                { icon: Zap, label: "Respuesta rápida" },
                { icon: Star, label: "Propuesta a medida" },
                { icon: Shield, label: "Sin compromiso" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10 text-center">
                  <Icon className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                  <span className="text-white/70 text-xs">{label}</span>
                </div>
              ))}
            </div>
            <Button asChild className="bg-amber-500 hover:bg-amber-400 text-white font-semibold h-12 px-8 rounded-full shadow-lg">
              <Link href="/">Explorar más experiencias <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO — Pantalla completa aspiracional
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Fondo */}
        <img src={HERO_BG} alt="Náyade Experiences" className="absolute inset-0 w-full h-full object-cover object-center scale-105" style={{ animation: "slowZoom 20s ease-in-out infinite alternate" }} />
        {/* Overlay degradado */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="relative z-10 container py-32">
          <div className="max-w-2xl">
            {/* Badge */}
            <div
              ref={heroFade.ref}
              className="transition-all duration-1000"
              style={{ opacity: heroFade.visible ? 1 : 0, transform: heroFade.visible ? "translateY(0)" : "translateY(30px)" }}
            >
              <span className="inline-flex items-center gap-2 bg-amber-500/90 text-white text-xs font-display font-bold uppercase tracking-widest px-5 py-2 rounded-full mb-8 shadow-lg">
                <Sparkles className="w-3.5 h-3.5" />
                Experiencias únicas · A 40 min de Madrid
              </span>

              {/* Claim principal */}
              <h1 className="text-5xl md:text-7xl font-heading font-black text-white leading-[1.05] mb-6">
                Diseñamos<br />
                <span className="text-amber-400">tu experiencia</span><br />
                perfecta
              </h1>

              {/* Subclaim */}
              <p className="text-xl md:text-2xl text-white/75 font-display font-light mb-10 leading-relaxed max-w-lg">
                Actividades acuáticas, relax, escapadas y aventura en el embalse de Los Ángeles de San Rafael.
              </p>

              {/* Tipos de experiencia */}
              <div className="flex flex-wrap gap-3 mb-12">
                {EXPERIENCE_TYPES.map(({ icon: Icon, label, color }) => (
                  <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/15 rounded-full px-4 py-2 text-sm text-white/80">
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                    {label}
                  </div>
                ))}
              </div>

              {/* CTA scroll */}
              <a href="#formulario" className="inline-flex items-center gap-3 text-white/60 text-sm hover:text-amber-400 transition-colors group">
                <span>Cuéntanos qué quieres vivir</span>
                <span className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center group-hover:border-amber-400 transition-colors">
                  <ChevronRight className="w-4 h-4 rotate-90" />
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Strip de miniaturas en la parte inferior */}
        <div className="absolute bottom-0 right-0 w-full md:w-1/2 h-32 hidden md:flex overflow-hidden">
          {STRIP_IMAGES.map((src, i) => (
            <div key={i} className="flex-1 relative overflow-hidden">
              <img src={src} alt="" className="w-full h-full object-cover opacity-60 hover:opacity-90 transition-opacity duration-500" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FORMULARIO PREMIUM
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="formulario" className="relative py-24 bg-gradient-to-b from-[oklch(0.10_0.03_240)] to-[oklch(0.14_0.04_240)] overflow-hidden">
        {/* Decoración de fondo */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, oklch(0.7 0.2 220) 0%, transparent 50%), radial-gradient(circle at 80% 20%, oklch(0.8 0.15 50) 0%, transparent 40%)" }} />

        <div className="relative z-10 container">
          {/* Encabezado de sección */}
          <div className="text-center mb-16">
            <p className="text-amber-400 font-display text-sm uppercase tracking-widest mb-3">Propuesta personalizada</p>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-white mb-4">
              Cuéntanos qué te gustaría vivir…<br />
              <span className="text-amber-400">nosotros lo hacemos realidad</span>
            </h2>
            <p className="text-white/50 max-w-lg mx-auto text-lg">
              Rellena el formulario y en menos de 24h recibirás una propuesta diseñada especialmente para ti.
            </p>
          </div>

          <div
            ref={formFade.ref}
            className="transition-all duration-1000 delay-200"
            style={{ opacity: formFade.visible ? 1 : 0, transform: formFade.visible ? "translateY(0)" : "translateY(40px)" }}
          >
            <div className="max-w-3xl mx-auto">
              {/* Card flotante del formulario */}
              <div className="bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
                {/* Barra superior decorativa */}
                <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500" />

                <form onSubmit={handleSubmit} className="p-8 md:p-12 space-y-10">
                  {/* Honeypot */}
                  <input type="text" name="website" value={formData.honeypot} onChange={(e) => setFormData({ ...formData, honeypot: e.target.value })} style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

                  {/* ── Bloque 1: ¿Quién eres? ─────────────────────────── */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                        <span className="text-amber-400 text-sm font-bold">1</span>
                      </div>
                      <h3 className="text-white font-display font-semibold text-lg">¿Quién eres?</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <Label htmlFor="name" className="text-white/60 text-sm mb-2 block">Nombre y apellidos <span className="text-amber-400">*</span></Label>
                        <Input
                          id="name" value={formData.name}
                          onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setErrors({ ...errors, name: "" }); }}
                          className={`h-13 bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-500/50 focus:ring-amber-500/20 text-base ${errors.name ? "border-red-400/60" : ""}`}
                          placeholder="Tu nombre completo"
                        />
                        {errors.name && <p className="text-red-400 text-xs mt-1.5">{errors.name}</p>}
                      </div>
                      <div>
                        <Label htmlFor="email" className="text-white/60 text-sm mb-2 block">Email <span className="text-amber-400">*</span></Label>
                        <Input
                          id="email" type="email" value={formData.email}
                          onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setErrors({ ...errors, email: "" }); }}
                          className={`h-13 bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-500/50 text-base ${errors.email ? "border-red-400/60" : ""}`}
                          placeholder="tu@email.com"
                        />
                        {errors.email && <p className="text-red-400 text-xs mt-1.5">{errors.email}</p>}
                      </div>
                      <div>
                        <Label htmlFor="phone" className="text-white/60 text-sm mb-2 block">Teléfono <span className="text-amber-400">*</span></Label>
                        <Input
                          id="phone" type="tel" value={formData.phone}
                          onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setErrors({ ...errors, phone: "" }); }}
                          className={`h-13 bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-amber-500/50 text-base ${errors.phone ? "border-red-400/60" : ""}`}
                          placeholder="+34 600 000 000"
                        />
                        {errors.phone && <p className="text-red-400 text-xs mt-1.5">{errors.phone}</p>}
                      </div>
                      <div>
                        <Label htmlFor="arrivalDate" className="text-white/60 text-sm mb-2 block">Fecha de llegada <span className="text-amber-400">*</span></Label>
                        <Input
                          id="arrivalDate" type="date" value={formData.arrivalDate}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => { setFormData({ ...formData, arrivalDate: e.target.value }); setErrors({ ...errors, arrivalDate: "" }); }}
                          className={`h-13 bg-white/[0.06] border-white/10 text-white rounded-xl focus:border-amber-500/50 text-base ${errors.arrivalDate ? "border-red-400/60" : ""}`}
                          style={{ colorScheme: "dark" }}
                        />
                        {errors.arrivalDate && <p className="text-red-400 text-xs mt-1.5">{errors.arrivalDate}</p>}
                      </div>
                    </div>
                  </div>

                  {/* ── Bloque 2: ¿Cuántos sois? ──────────────────────── */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                        <span className="text-amber-400 text-sm font-bold">2</span>
                      </div>
                      <h3 className="text-white font-display font-semibold text-lg">¿Cuántos sois?</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <Label htmlFor="adults" className="text-white/60 text-sm mb-2 block flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" /> Adultos
                        </Label>
                        <Input id="adults" type="number" min="1" max="200" value={formData.adults}
                          onChange={(e) => setFormData({ ...formData, adults: e.target.value })}
                          className="h-13 bg-white/[0.06] border-white/10 text-white rounded-xl focus:border-amber-500/50 text-base"
                          style={{ colorScheme: "dark" }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="children" className="text-white/60 text-sm mb-2 block flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" /> Niños
                        </Label>
                        <Input id="children" type="number" min="0" max="200" value={formData.children}
                          onChange={(e) => setFormData({ ...formData, children: e.target.value })}
                          className="h-13 bg-white/[0.06] border-white/10 text-white rounded-xl focus:border-amber-500/50 text-base"
                          style={{ colorScheme: "dark" }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── Bloque 3: ¿Qué quieres vivir? ────────────────── */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                        <span className="text-amber-400 text-sm font-bold">3</span>
                      </div>
                      <h3 className="text-white font-display font-semibold text-lg">¿Qué quieres vivir?</h3>
                    </div>

                    {/* Selector de categoría */}
                    <div className="mb-5">
                      <p className="text-white/50 text-sm mb-3">Elige una categoría <span className="text-amber-400">*</span></p>
                      <div className="flex flex-wrap gap-2.5">
                        {STATIC_CATEGORIES.map((cat) => (
                          <button key={cat.id} type="button" onClick={() => handleCategorySelect(cat.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                              selectedCategory === cat.id
                                ? "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/20"
                                : "border-white/15 text-white/60 hover:border-amber-500/40 hover:text-white bg-white/[0.04]"
                            }`}
                          >
                            <span>{cat.icon}</span> {cat.label}
                          </button>
                        ))}
                      </div>
                      {errors.category && <p className="text-red-400 text-xs mt-2">{errors.category}</p>}
                    </div>

                    {/* Selector de producto */}
                    {selectedCategory && (
                      <div className="mt-5 p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
                        <p className="text-white/50 text-sm mb-3 flex items-center gap-1.5">
                          <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                          Experiencia específica <span className="text-amber-400">*</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {products.map((product: string) => (
                            <button key={product} type="button"
                              onClick={() => { setSelectedProduct(product); setErrors({ ...errors, product: "" }); }}
                              className={`px-3.5 py-2 rounded-full text-sm border transition-all duration-200 ${
                                selectedProduct === product
                                  ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                  : "border-white/10 text-white/50 hover:border-sky-500/30 hover:text-white/80 bg-white/[0.03]"
                              }`}
                            >
                              {product}
                            </button>
                          ))}
                          <button type="button"
                            onClick={() => { setSelectedProduct(SPECIAL_OPTION); setErrors({ ...errors, product: "" }); }}
                            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm border transition-all duration-200 ${
                              selectedProduct === SPECIAL_OPTION
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                : "border-amber-500/20 text-amber-400/70 hover:border-amber-500/40 hover:text-amber-300 bg-white/[0.03]"
                            }`}
                          >
                            <Star className="w-3 h-3" /> Propuesta personalizada
                          </button>
                        </div>
                        {errors.product && <p className="text-red-400 text-xs mt-2">{errors.product}</p>}
                      </div>
                    )}
                  </div>

                  {/* ── Bloque 4: Algo más que quieras contarnos ──────── */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                        <span className="text-amber-400 text-sm font-bold">4</span>
                      </div>
                      <h3 className="text-white font-display font-semibold text-lg">¿Algo más que quieras contarnos?</h3>
                    </div>
                    <Textarea value={formData.comments}
                      onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                      className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/25 rounded-xl focus:border-amber-500/50 resize-none text-base"
                      rows={4}
                      placeholder="Ocasión especial, preferencias, número de personas concreto, fechas alternativas… cuéntanos todo lo que necesites."
                    />
                  </div>

                  {/* ── CTA ───────────────────────────────────────────── */}
                  <div>
                    <Button type="submit" disabled={submitBudget.isPending}
                      className="w-full h-16 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-300 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-0"
                    >
                      {submitBudget.isPending ? (
                        <span className="flex items-center gap-3">
                          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Preparando tu propuesta…
                        </span>
                      ) : (
                        <span className="flex items-center gap-3">
                          <Send className="w-5 h-5" />
                          Quiero mi propuesta personalizada
                        </span>
                      )}
                    </Button>
                    <p className="text-white/30 text-xs text-center mt-4">
                      Sin compromiso · Respuesta en menos de 24h ·{" "}
                      <Link href="/privacidad" className="underline hover:text-amber-400">Política de privacidad</Link>
                    </p>
                  </div>
                </form>
              </div>

              {/* Datos de contacto bajo el formulario */}
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-6 text-white/40 text-sm">
                <a href="tel:+34930347791" className="flex items-center gap-2 hover:text-amber-400 transition-colors">
                  <Phone className="w-4 h-4" /> +34 930 34 77 91
                </a>
                <span className="hidden sm:block text-white/20">·</span>
                <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-2 hover:text-amber-400 transition-colors">
                  <Mail className="w-4 h-4" /> reservas@nayadeexperiences.es
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          BENEFICIOS — Iconos experienciales
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 bg-gradient-to-b from-[oklch(0.14_0.04_240)] to-background overflow-hidden">
        <div
          ref={benefitsFade.ref}
          className="container transition-all duration-1000 delay-300"
          style={{ opacity: benefitsFade.visible ? 1 : 0, transform: benefitsFade.visible ? "translateY(0)" : "translateY(30px)" }}
        >
          {/* Separador visual */}
          <div className="flex items-center gap-4 mb-16">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-white/10" />
            <span className="text-white/30 text-xs uppercase tracking-widest font-display">Por qué elegirnos</span>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-white/10" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">
            {[
              { icon: Zap, title: "Respuesta en 24h", desc: "Recibirás tu propuesta personalizada en menos de un día.", color: "text-amber-400", bg: "bg-amber-500/10" },
              { icon: Star, title: "100% personalizado", desc: "Cada experiencia se diseña según tus necesidades.", color: "text-sky-400", bg: "bg-sky-500/10" },
              { icon: Shield, title: "Sin compromiso", desc: "Solicita tu presupuesto sin ninguna obligación.", color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { icon: Heart, title: "Parejas, familias y empresas", desc: "Experiencias para todo tipo de grupos.", color: "text-rose-400", bg: "bg-rose-500/10" },
            ].map(({ icon: Icon, title, desc, color, bg }) => (
              <div key={title} className="text-center group">
                <div className={`w-16 h-16 ${bg} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className={`w-7 h-7 ${color}`} />
                </div>
                <h4 className="text-white font-display font-semibold text-sm mb-2">{title}</h4>
                <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Strip de fotos */}
          <div className="grid grid-cols-4 gap-3 rounded-2xl overflow-hidden h-40">
            {STRIP_IMAGES.map((src, i) => (
              <div key={i} className="relative overflow-hidden group">
                <img src={src} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors duration-300" />
              </div>
            ))}
          </div>

          {/* Mini refuerzo de confianza */}
          <div className="mt-12 text-center">
            <p className="text-white/30 text-sm font-display">
              Más de <span className="text-amber-400 font-semibold">10.000 experiencias</span> vividas en el embalse de Los Ángeles de San Rafael
            </p>
          </div>
        </div>
      </section>

      {/* Animación CSS para el zoom lento del hero */}
      <style>{`
        @keyframes slowZoom {
          from { transform: scale(1.05); }
          to   { transform: scale(1.12); }
        }
      `}</style>
    </PublicLayout>
  );
}
