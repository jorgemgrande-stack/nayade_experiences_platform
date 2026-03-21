import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Phone, Mail, Clock, Users, ChevronRight,
  Send, Star, Shield, Zap, ArrowRight, CalendarDays
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Categorías fijas del selector ────────────────────────────────────────────
const STATIC_CATEGORIES = [
  { id: "Experiencias", label: "Experiencias Acuáticas" },
  { id: "Packs", label: "Packs Completos" },
  { id: "Hotel", label: "Hotel" },
  { id: "Spa", label: "SPA & Bienestar" },
  { id: "Pack colegios", label: "Pack Colegios" },
  { id: "Pack teambuilding", label: "Pack Teambuilding" },
];

const SPECIAL_OPTION = "__special__";

// ─── Productos estáticos por categoría (fallback + SPA/Hotel/Colegios/TB) ─────
const STATIC_PRODUCTS: Record<string, string[]> = {
  Hotel: ["Habitación Estándar", "Habitación Superior", "Suite Lago", "Suite Premium"],
  Spa: ["Circuito SPA", "Masaje Relajante", "Tratamiento Facial", "Pack Pareja SPA"],
  "Pack colegios": ["Pack Escolar Básico", "Pack Escolar Aventura", "Pack Escolar Náutico"],
  "Pack teambuilding": ["Teambuilding Básico", "Teambuilding Premium", "Jornada Corporativa Completa"],
};

// ─── Badges de confianza ───────────────────────────────────────────────────────
const TRUST_BADGES = [
  { icon: Zap, label: "Respuesta en 24h" },
  { icon: Shield, label: "Sin compromiso" },
  { icon: Star, label: "Propuesta personalizada" },
  { icon: Users, label: "Atención directa" },
];

export default function BudgetRequest() {
  const [submitted, setSubmitted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    arrivalDate: "",
    adults: "1",
    children: "0",
    comments: "",
    honeypot: "", // anti-spam
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── Cargar experiencias y packs dinámicamente ─────────────────────────────
  const { data: experiences } = trpc.public.getExperiences.useQuery(
    { limit: 100 },
    { enabled: selectedCategory === "Experiencias" }
  );
  const { data: packs } = trpc.packs.getByCategory.useQuery(
    { category: undefined },
    { enabled: selectedCategory === "Packs" }
  );

  // ─── Productos según categoría seleccionada ────────────────────────────────
  const products = useMemo(() => {
    if (selectedCategory === "Experiencias" && experiences) {
      return experiences.map((e: any) => e.title);
    }
    if (selectedCategory === "Packs" && packs) {
      return packs.map((p: any) => p.title);
    }
    return STATIC_PRODUCTS[selectedCategory] ?? [];
  }, [selectedCategory, experiences, packs]);

  const submitBudget = trpc.public.submitBudget.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Error al enviar la solicitud. Por favor, inténtalo de nuevo."),
  });

  // ─── Validación ───────────────────────────────────────────────────────────
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2)
      newErrors.name = "Introduce tu nombre completo";
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      newErrors.email = "Introduce un email válido";
    if (!formData.phone.trim() || formData.phone.trim().length < 6)
      newErrors.phone = "Introduce un teléfono válido";
    if (!formData.arrivalDate)
      newErrors.arrivalDate = "Selecciona el día de llegada";
    if (!selectedCategory)
      newErrors.category = "Selecciona una categoría";
    if (!selectedProduct)
      newErrors.product = "Selecciona una experiencia o elige propuesta personalizada";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    await submitBudget.mutateAsync({
      name: formData.name.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      arrivalDate: formData.arrivalDate,
      adults: parseInt(formData.adults) || 1,
      children: parseInt(formData.children) || 0,
      selectedCategory,
      selectedProduct: selectedProduct === SPECIAL_OPTION ? "Petición especial / Propuesta personalizada" : selectedProduct,
      comments: formData.comments.trim() || undefined,
      honeypot: formData.honeypot || undefined,
    });
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    setSelectedProduct("");
    setErrors((prev) => ({ ...prev, category: "", product: "" }));
  };

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-[70vh] flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
          <div className="text-center max-w-lg mx-auto px-6 py-16">
            <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-8 shadow-lg">
              <CheckCircle className="w-12 h-12 text-emerald-500" />
            </div>
            <h2 className="text-4xl font-heading font-bold text-foreground mb-4">
              ¡Solicitud enviada!
            </h2>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              Nuestro equipo te contactará muy pronto con una propuesta personalizada.
              Normalmente respondemos en <strong className="text-foreground">menos de 24 horas</strong>.
            </p>
            <div className="bg-card rounded-2xl border border-border/50 p-6 mb-8 text-left space-y-4">
              {[
                { icon: Clock, text: "Respuesta en menos de 24 horas" },
                { icon: Phone, text: "Te llamaremos al número proporcionado" },
                { icon: Mail, text: "Recibirás la propuesta por email" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Icon className="w-4 h-4 text-accent shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <Button asChild className="bg-gold-gradient text-white hover:opacity-90 font-semibold h-12 px-8">
              <Link href="/">Volver al inicio <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/31bc24b6-13c3-4ea1-a67f-16a927473c61_d7582ff1.png"
          alt="Solicitar Presupuesto"
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/75" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Propuesta personalizada
              </span>
              <h1 className="text-4xl md:text-5xl font-heading font-bold leading-tight mb-4">
                Organizamos tu experiencia<br />
                <span className="text-amber-400">a medida</span>
              </h1>
              <p className="text-lg text-white/85 font-display">
                Cuéntanos qué experiencia buscas y te preparamos tu propuesta personalizada en menos de 24h.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust badges ─────────────────────────────────────────────────── */}
      <section className="bg-[oklch(0.14_0.03_240)] py-5">
        <div className="container">
          <div className="flex flex-wrap justify-center gap-6 md:gap-10">
            {TRUST_BADGES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-white/80 text-sm">
                <Icon className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Formulario + sidebar ──────────────────────────────────────────── */}
      <section className="py-16 bg-gradient-to-b from-background to-muted/20">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">

            {/* ── Formulario principal ─────────────────────────────────── */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-3xl border border-border/50 shadow-sm p-8">
                <h2 className="text-2xl font-heading font-bold text-foreground mb-2">
                  Cuéntanos qué necesitas
                </h2>
                <p className="text-muted-foreground mb-8">
                  Respuesta rápida y sin compromiso. En menos de 24h recibirás tu propuesta.
                </p>

                <form onSubmit={handleSubmit} className="space-y-8">
                  {/* Honeypot anti-spam (oculto) */}
                  <input
                    type="text"
                    name="website"
                    value={formData.honeypot}
                    onChange={(e) => setFormData({ ...formData, honeypot: e.target.value })}
                    style={{ display: "none" }}
                    tabIndex={-1}
                    autoComplete="off"
                  />

                  {/* ── Datos de contacto ─────────────────────────────── */}
                  <div>
                    <h3 className="font-display font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-4">
                      Datos de contacto
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name" className="text-sm font-medium">
                          Nombre y apellidos <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setErrors({ ...errors, name: "" }); }}
                          className={`mt-1.5 h-11 ${errors.name ? "border-red-400" : ""}`}
                          placeholder="Tu nombre completo"
                        />
                        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
                      </div>
                      <div>
                        <Label htmlFor="email" className="text-sm font-medium">
                          Email <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setErrors({ ...errors, email: "" }); }}
                          className={`mt-1.5 h-11 ${errors.email ? "border-red-400" : ""}`}
                          placeholder="tu@email.com"
                        />
                        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                      </div>
                      <div>
                        <Label htmlFor="phone" className="text-sm font-medium">
                          Teléfono <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setErrors({ ...errors, phone: "" }); }}
                          className={`mt-1.5 h-11 ${errors.phone ? "border-red-400" : ""}`}
                          placeholder="+34 600 000 000"
                        />
                        {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                      </div>
                      <div>
                        <Label htmlFor="arrivalDate" className="text-sm font-medium">
                          Día de llegada <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="arrivalDate"
                          type="date"
                          value={formData.arrivalDate}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => { setFormData({ ...formData, arrivalDate: e.target.value }); setErrors({ ...errors, arrivalDate: "" }); }}
                          className={`mt-1.5 h-11 ${errors.arrivalDate ? "border-red-400" : ""}`}
                        />
                        {errors.arrivalDate && <p className="text-red-500 text-xs mt-1">{errors.arrivalDate}</p>}
                      </div>
                    </div>
                  </div>

                  {/* ── Personas ──────────────────────────────────────── */}
                  <div>
                    <h3 className="font-display font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-4">
                      Número de personas
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="adults" className="text-sm font-medium flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" /> Adultos
                        </Label>
                        <Input
                          id="adults"
                          type="number"
                          min="1"
                          max="200"
                          value={formData.adults}
                          onChange={(e) => setFormData({ ...formData, adults: e.target.value })}
                          className="mt-1.5 h-11"
                        />
                      </div>
                      <div>
                        <Label htmlFor="children" className="text-sm font-medium flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" /> Niños
                        </Label>
                        <Input
                          id="children"
                          type="number"
                          min="0"
                          max="200"
                          value={formData.children}
                          onChange={(e) => setFormData({ ...formData, children: e.target.value })}
                          className="mt-1.5 h-11"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── Selector jerárquico ───────────────────────────── */}
                  <div>
                    <h3 className="font-display font-semibold text-sm uppercase tracking-widest text-muted-foreground mb-4">
                      Selecciona la experiencia
                    </h3>

                    {/* Nivel 1: Categoría */}
                    <div className="mb-4">
                      <Label className="text-sm font-medium mb-2 block">
                        Categoría <span className="text-red-500">*</span>
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {STATIC_CATEGORIES.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => handleCategorySelect(cat.id)}
                            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                              selectedCategory === cat.id
                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                : "border-border text-muted-foreground hover:border-accent hover:text-accent bg-background"
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                      {errors.category && <p className="text-red-500 text-xs mt-2">{errors.category}</p>}
                    </div>

                    {/* Nivel 2: Producto (aparece al seleccionar categoría) */}
                    {selectedCategory && (
                      <div className="mt-4 p-4 bg-muted/40 rounded-2xl border border-border/50">
                        <Label className="text-sm font-medium mb-3 block flex items-center gap-1.5">
                          <ChevronRight className="w-3.5 h-3.5 text-accent" />
                          Experiencia específica <span className="text-red-500">*</span>
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          {products.map((product: string) => (
                            <button
                              key={product}
                              type="button"
                              onClick={() => { setSelectedProduct(product); setErrors({ ...errors, product: "" }); }}
                              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                                selectedProduct === product
                                  ? "bg-accent text-white border-accent shadow-sm"
                                  : "border-border text-muted-foreground hover:border-accent hover:text-accent bg-background"
                              }`}
                            >
                              {product}
                            </button>
                          ))}
                          {/* Opción especial */}
                          <button
                            type="button"
                            onClick={() => { setSelectedProduct(SPECIAL_OPTION); setErrors({ ...errors, product: "" }); }}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all flex items-center gap-1.5 ${
                              selectedProduct === SPECIAL_OPTION
                                ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                                : "border-amber-300 text-amber-600 hover:bg-amber-50 bg-background"
                            }`}
                          >
                            <Star className="w-3 h-3" />
                            Petición especial / Propuesta personalizada
                          </button>
                        </div>
                        {errors.product && <p className="text-red-500 text-xs mt-2">{errors.product}</p>}
                      </div>
                    )}
                  </div>

                  {/* ── Comentarios ───────────────────────────────────── */}
                  <div>
                    <Label htmlFor="comments" className="text-sm font-medium">
                      Comentarios adicionales
                    </Label>
                    <Textarea
                      id="comments"
                      value={formData.comments}
                      onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                      className="mt-1.5 resize-none"
                      rows={4}
                      placeholder="Cuéntanos qué necesitas: tipo de experiencia, número total de personas, ocasión especial o cualquier detalle importante."
                    />
                  </div>

                  {/* ── Botón de envío ────────────────────────────────── */}
                  <div>
                    <Button
                      type="submit"
                      disabled={submitBudget.isPending}
                      className="w-full bg-gold-gradient text-white hover:opacity-90 font-semibold h-13 text-base rounded-xl shadow-lg"
                    >
                      {submitBudget.isPending ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Enviando solicitud...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Send className="w-4 h-4" />
                          Solicitar mi propuesta personalizada
                        </span>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      Al enviar aceptas nuestra{" "}
                      <Link href="/privacidad" className="underline hover:text-accent">política de privacidad</Link>.
                      Respuesta garantizada en menos de 24h.
                    </p>
                  </div>
                </form>
              </div>
            </div>

            {/* ── Sidebar ──────────────────────────────────────────────── */}
            <div className="space-y-6">
              {/* Cómo funciona */}
              <div className="bg-card rounded-2xl border border-border/50 p-6">
                <h3 className="font-display font-semibold text-foreground mb-5">¿Cómo funciona?</h3>
                <div className="space-y-5">
                  {[
                    { step: "01", title: "Envía tu solicitud", desc: "Rellena el formulario con los detalles de tu experiencia ideal." },
                    { step: "02", title: "Analizamos tu petición", desc: "Nuestro equipo estudia tu solicitud y prepara una propuesta personalizada." },
                    { step: "03", title: "Recibe tu presupuesto", desc: "En menos de 24h recibirás un presupuesto detallado por email." },
                    { step: "04", title: "Confirma y disfruta", desc: "Acepta el presupuesto y prepárate para la aventura." },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-accent">{item.step}</span>
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contacto directo */}
              <div className="bg-[oklch(0.14_0.03_240)] rounded-2xl p-6 text-white">
                <h3 className="font-display font-semibold mb-4">¿Prefieres llamarnos?</h3>
                <p className="text-white/60 text-sm mb-4">Nuestro equipo está disponible para atenderte directamente.</p>
                <div className="space-y-3">
                  <a href="tel:+34930347791" className="flex items-center gap-3 text-sm text-white/70 hover:text-amber-400 transition-colors">
                    <Phone className="w-4 h-4 text-amber-400" />
                    +34 930 34 77 91
                  </a>
                  <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-3 text-sm text-white/70 hover:text-amber-400 transition-colors">
                    <Mail className="w-4 h-4 text-amber-400" />
                    reservas@nayadeexperiences.es
                  </a>
                  <div className="flex items-center gap-3 text-sm text-white/70">
                    <CalendarDays className="w-4 h-4 text-amber-400" />
                    Lun–Vie: 9:00 – 19:00
                  </div>
                </div>
              </div>

              {/* Grupos y empresas */}
              <div className="bg-accent/5 border border-accent/20 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-accent" />
                  <h3 className="font-display font-semibold text-foreground text-sm">Grupos y Empresas</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Para grupos de más de 20 personas o eventos corporativos, contamos con tarifas especiales y gestión personalizada.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
