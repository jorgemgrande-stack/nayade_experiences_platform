import React, { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Phone, Users, Send, ChevronDown, ChevronUp,
  GraduationCap, TreePine, Waves, Tent, Star, Shield, Clock,
  ArrowRight, Heart, Zap, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { usePublicPhone } from "@/hooks/usePublicPhone";
import { toast } from "sonner";
import { useMarketingConsent } from "@/hooks/useMarketingConsent";
import { generateEventId } from "@/lib/meta-pixel/client";
import { getFbp, getFbc } from "@/lib/meta-pixel/cookies";

// ─── Assets ───────────────────────────────────────────────────────────────────
const HERO_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774088145054-jpwq7l.png";

// ─── Datos estáticos ──────────────────────────────────────────────────────────
const BENEFITS = [
  {
    icon: Shield,
    title: "Seguridad certificada",
    desc: "Instalaciones homologadas, monitores titulados y protocolos de seguridad para todos los grupos.",
  },
  {
    icon: GraduationCap,
    title: "Valor educativo",
    desc: "Actividades diseñadas para el aprendizaje por experiencia: trabajo en equipo, respeto al medio y superación personal.",
  },
  {
    icon: Waves,
    title: "Entorno natural único",
    desc: "El Lago de Bolarque como escenario: deportes acuáticos, senderismo, orientación y mucho más.",
  },
  {
    icon: Users,
    title: "Grupos de todos los tamaños",
    desc: "Desde 20 hasta 300 participantes. Adaptamos el programa a vuestro número y necesidades.",
  },
  {
    icon: Clock,
    title: "Horarios flexibles",
    desc: "Excursiones de un día, jornadas de dos días con noche, o campamentos de larga estancia.",
  },
  {
    icon: Heart,
    title: "Atención personalizada",
    desc: "Un coordinador dedicado desde la primera llamada hasta el final de la actividad.",
  },
];

const PROGRAM_TYPES = [
  {
    icon: Waves,
    tag: "Deportes acuáticos",
    title: "Pack Náutico Escolar",
    desc: "Kayak, piragua, paddle surf y natación en aguas seguras. Ideal para edades de 8 a 18 años.",
    color: "from-sky-500/20 to-sky-600/10 border-sky-500/30",
    tagColor: "bg-sky-500/20 text-sky-300",
  },
  {
    icon: TreePine,
    tag: "Aventura & Naturaleza",
    title: "Pack Aventura Escolar",
    desc: "Tirolina, escalada, senderismo y actividades de orientación en plena naturaleza.",
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
    tagColor: "bg-emerald-500/20 text-emerald-300",
  },
  {
    icon: Tent,
    tag: "Campamento",
    title: "Campamento Residencial",
    desc: "Programa completo de varios días con alojamiento, comidas, actividades y veladas nocturnas.",
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
    tagColor: "bg-amber-500/20 text-amber-300",
  },
  {
    icon: GraduationCap,
    tag: "Jornada de convivencia",
    title: "Día de Convivencia",
    desc: "Una jornada completa con actividades mixtas, dinámica de grupo y tiempo libre vigilado.",
    color: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
    tagColor: "bg-violet-500/20 text-violet-300",
  },
];

const GROUP_TYPES = [
  "Colegio (Educación Primaria)",
  "Colegio (Educación Secundaria / Bachillerato)",
  "AMPA / Asociación de padres",
  "Campamento de verano",
  "Club deportivo juvenil",
  "Esplai / Agrupación de tiempo libre",
  "Colonia vacacional",
  "Otro",
];

const AGE_RANGES = [
  "6-8 años",
  "9-11 años",
  "12-14 años",
  "15-18 años",
  "Mixto (varias edades)",
];

const EXPERIENCE_TYPES = [
  "Pack Náutico Escolar",
  "Pack Aventura Escolar",
  "Campamento Residencial",
  "Día de Convivencia",
  "Programa personalizado",
];

const FAQS = [
  {
    q: "¿Con qué antelación hay que reservar?",
    a: "Recomendamos reservar con al menos 4-6 semanas de antelación, especialmente para fechas de temporada alta (mayo-junio y septiembre). Contacta cuanto antes para garantizar disponibilidad.",
  },
  {
    q: "¿Qué incluye el precio por alumno?",
    a: "El precio incluye monitores, material de actividades, seguro de accidentes y acceso a las instalaciones. El transporte y la alimentación se pueden contratar como servicio adicional.",
  },
  {
    q: "¿Es necesario que los alumnos sepan nadar para las actividades acuáticas?",
    a: "No es imprescindible. Todos los participantes usan chaleco salvavidas homologado y los grupos se adaptan al nivel de los alumnos. Nuestros monitores están formados en rescate acuático.",
  },
  {
    q: "¿Cuál es el número mínimo y máximo de participantes?",
    a: "El mínimo habitual es de 20 participantes. Para grupos grandes podemos acoger hasta 300 personas distribuyéndolos en subgrupos con actividades simultáneas.",
  },
  {
    q: "¿Ofrecéis descuentos para AMPAs y colegios concertados?",
    a: "Sí. Contamos con tarifas especiales para reservas anticipadas, grupos repetidores y colectivos sin ánimo de lucro. Pídenos presupuesto sin compromiso.",
  },
  {
    q: "¿Se puede visitar las instalaciones antes de reservar?",
    a: "Por supuesto. Podemos organizar una visita guiada para el equipo docente o los coordinadores del grupo. Contáctanos y lo preparamos.",
  },
];

// ─── Custom dark select (evita el dropdown blanco nativo del SO) ──────────────
function DarkSelect({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 flex items-center justify-between gap-2 px-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: value ? "white" : "rgba(255,255,255,0.25)",
        }}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-2xl"
          style={{
            background: "rgba(15,23,42,0.97)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(20px)",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm transition-colors"
              style={{
                color: opt === value ? "#fbbf24" : "rgba(255,255,255,0.75)",
                background: opt === value ? "rgba(251,191,36,0.10)" : "transparent",
              }}
              onMouseEnter={(e) => { if (opt !== value) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = opt === value ? "rgba(251,191,36,0.10)" : "transparent"; }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FAQ item ─────────────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="font-semibold text-white text-sm sm:text-base">{q}</span>
        {open
          ? <ChevronUp className="w-5 h-5 text-orange-400 flex-shrink-0" />
          : <ChevronDown className="w-5 h-5 text-white/50 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-6 pb-5 text-white/70 text-sm sm:text-base leading-relaxed border-t border-white/10">
          <p className="pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Colegios() {
  const { phone, phoneTel } = usePublicPhone();
  const [submitted, setSubmitted] = useState(false);
  const hasConsent = useMarketingConsent();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    organizationName: "",
    preferredDate: "",
    monitorsCount: "2",
    childrenCount: "30",
    ageRange: "",
    groupType: "",
    experienceType: "",
    comments: "",
    honeypot: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submitLead = trpc.public.submitColegiosLead.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Error al enviar. Por favor, inténtalo de nuevo."),
  });

  const set = (field: string, value: string) => {
    setFormData((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) e.name = "Introduce tu nombre";
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Email no válido";
    if (!formData.phone.trim() || formData.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (!formData.organizationName.trim() || formData.organizationName.trim().length < 2)
      e.organizationName = "Nombre de la entidad obligatorio";
    if (!parseInt(formData.childrenCount) || parseInt(formData.childrenCount) < 1)
      e.childrenCount = "Introduce el nº de participantes";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    const childrenCount = parseInt(formData.childrenCount) || 1;
    const monitorsCount = parseInt(formData.monitorsCount) || 0;

    // Generar event_id antes de la llamada — se comparte con el pixel y con CAPI server-side
    const eventId = generateEventId();
    const eventSourceUrl = typeof window !== "undefined" ? window.location.href : undefined;

    await submitLead.mutateAsync({
      name: formData.name.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      organizationName: formData.organizationName.trim(),
      preferredDate: formData.preferredDate || undefined,
      monitorsCount,
      childrenCount,
      ageRange: formData.ageRange || undefined,
      groupType: formData.groupType || undefined,
      experienceType: formData.experienceType || undefined,
      comments: formData.comments.trim() || undefined,
      honeypot: formData.honeypot || undefined,
      eventId,
      eventSourceUrl,
      fbp: getFbp(),
      fbc: getFbc(),
    });

    // Pixel cliente — mismo eventId que CAPI server-side para deduplicación en Meta
    if (hasConsent && typeof window !== "undefined" && typeof window.fbq === "function") {
      window.fbq("track", "Lead", {
        content_name: "Colegios y Campamentos",
        content_category: "B2B Escolar",
        content_ids: ["landing_colegios"],
        value: 26.00,
        currency: "EUR",
      }, { eventID: eventId });
    }
  };

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
            <h2 className="text-4xl sm:text-5xl font-heading font-bold text-white mb-4">¡Solicitud recibida!</h2>
            <p className="text-xl text-white/75 mb-3">Tu programa está en camino.</p>
            <p className="text-white/55 mb-10 leading-relaxed">
              Nuestro equipo os contactará en menos de{" "}
              <strong className="text-amber-400">24 horas</strong> para preparar un
              programa adaptado a vuestro grupo.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-10">
              {[
                { icon: Zap, label: "Respuesta rápida" },
                { icon: Star, label: "A tu medida" },
                { icon: Shield, label: "Sin compromiso" },
              ].map(({ icon: Icon, label }) => (
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
      <div className="bg-[#0a0a0a] text-white">

        {/* ── HERO SPLIT ────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex items-stretch overflow-hidden">
          <img
            src={HERO_BG}
            alt="Náyade Colegios"
            className="absolute inset-0 w-full h-full object-cover object-center"
            style={{ animation: "slowZoom 25s ease-in-out infinite alternate" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

          <div className="relative z-10 container flex flex-col lg:flex-row items-center gap-8 lg:gap-12 py-24 lg:py-0 min-h-screen">

            {/* ── Columna izquierda ─────────────────────────────────────────── */}
            <div className="flex-1 text-white lg:py-24">
              <span className="inline-flex items-center gap-2 bg-amber-500/90 text-white text-xs font-bold uppercase tracking-widest px-5 py-2 rounded-full mb-6 shadow-lg">
                <GraduationCap className="w-3.5 h-3.5" />
                Colegios, AMPAs y Campamentos
              </span>

              <h1 className="text-4xl md:text-5xl xl:text-6xl font-heading font-black leading-[1.05] mb-5">
                Experiencias que<br />
                <span className="text-amber-400">marcan para</span><br />
                siempre
              </h1>

              <p className="text-lg md:text-xl text-white/70 font-light mb-8 leading-relaxed max-w-md">
                Programas educativos y de aventura para grupos escolares en el entorno natural
                del Lago de Bolarque. Seguridad, aprendizaje y diversión en un solo lugar.
              </p>

              <div className="flex flex-wrap gap-2 mb-8">
                {["Kayak y piragua", "Escalada", "Senderismo", "Campamentos", "Tirolina"].map((tag) => (
                  <span key={tag} className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-xs text-white/75">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                {[
                  { icon: Zap, text: "Respuesta en menos de 24h" },
                  { icon: Star, text: "Programa 100% personalizado" },
                  { icon: Shield, text: "Monitores titulados · Sin compromiso" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-2 text-sm text-white/55">
                    <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    {text}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Columna derecha: formulario glass ────────────────────────── */}
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
                <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500" />

                <div className="px-7 pt-6 pb-4 border-b border-white/[0.07]">
                  <h2 className="text-white font-bold text-xl">Solicita tu presupuesto</h2>
                  <p className="text-white/45 text-sm mt-1">Recibirás una propuesta en menos de 24h</p>
                </div>

                <div className="overflow-y-auto max-h-[calc(100vh-260px)] lg:max-h-[calc(100vh-200px)]">
                  <form onSubmit={handleSubmit} className="px-7 py-5 space-y-4">
                    {/* Honeypot */}
                    <input type="text" name="website" value={formData.honeypot}
                      onChange={(e) => set("honeypot", e.target.value)}
                      style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

                    {/* Nombre + Entidad */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Nombre <span className="text-amber-400">*</span></Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => set("name", e.target.value)}
                          placeholder="Tu nombre"
                          className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.name ? "border-red-400/60" : ""}`}
                        />
                        {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Colegio / Entidad <span className="text-amber-400">*</span></Label>
                        <Input
                          value={formData.organizationName}
                          onChange={(e) => set("organizationName", e.target.value)}
                          placeholder="Nombre del centro"
                          className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.organizationName ? "border-red-400/60" : ""}`}
                        />
                        {errors.organizationName && <p className="text-red-400 text-xs mt-1">{errors.organizationName}</p>}
                      </div>
                    </div>

                    {/* Email + Teléfono */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Email <span className="text-amber-400">*</span></Label>
                        <Input
                          type="email" value={formData.email}
                          onChange={(e) => set("email", e.target.value)}
                          placeholder="tu@email.com"
                          className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.email ? "border-red-400/60" : ""}`}
                        />
                        {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Teléfono <span className="text-amber-400">*</span></Label>
                        <Input
                          type="tel" value={formData.phone}
                          onChange={(e) => set("phone", e.target.value)}
                          placeholder="+34 600 000 000"
                          className={`h-10 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-amber-500/50 ${errors.phone ? "border-red-400/60" : ""}`}
                        />
                        {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                      </div>
                    </div>

                    {/* Tipo grupo + Edad */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Tipo de grupo</Label>
                        <DarkSelect
                          value={formData.groupType}
                          onChange={(v) => set("groupType", v)}
                          options={GROUP_TYPES}
                          placeholder="Selecciona..."
                        />
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Rango de edad</Label>
                        <DarkSelect
                          value={formData.ageRange}
                          onChange={(v) => set("ageRange", v)}
                          options={AGE_RANGES}
                          placeholder="Selecciona..."
                        />
                      </div>
                    </div>

                    {/* Alumnos + Monitores */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1">
                          <Users className="w-3 h-3" /> Nº alumnos <span className="text-amber-400">*</span>
                        </Label>
                        <Input
                          type="number" min="1" value={formData.childrenCount}
                          onChange={(e) => set("childrenCount", e.target.value)}
                          className={`h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50 ${errors.childrenCount ? "border-red-400/60" : ""}`}
                        />
                        {errors.childrenCount && <p className="text-red-400 text-xs mt-1">{errors.childrenCount}</p>}
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1">
                          <Users className="w-3 h-3" /> Nº monitores
                        </Label>
                        <Input
                          type="number" min="0" value={formData.monitorsCount}
                          onChange={(e) => set("monitorsCount", e.target.value)}
                          className="h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50"
                        />
                      </div>
                    </div>

                    {/* Tipo experiencia + Fecha */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Tipo de programa</Label>
                        <DarkSelect
                          value={formData.experienceType}
                          onChange={(v) => set("experienceType", v)}
                          options={EXPERIENCE_TYPES}
                          placeholder="Selecciona..."
                        />
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Fecha preferida</Label>
                        <Input
                          type="date" value={formData.preferredDate}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => set("preferredDate", e.target.value)}
                          className="h-10 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-amber-500/50"
                          style={{ colorScheme: "dark" }}
                        />
                      </div>
                    </div>

                    {/* Comentarios */}
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Comentarios</Label>
                      <Textarea
                        value={formData.comments}
                        onChange={(e) => set("comments", e.target.value)}
                        placeholder="Necesidades especiales, objetivos del grupo, restricciones alimentarias..."
                        rows={3}
                        className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm resize-none focus:border-amber-500/50"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={submitLead.isPending}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-white font-bold h-12 rounded-2xl text-base shadow-lg shadow-amber-500/20 disabled:opacity-50"
                    >
                      {submitLead.isPending ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          Enviando...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <Send className="w-4 h-4" />
                          Solicitar presupuesto gratuito
                        </span>
                      )}
                    </Button>

                    <p className="text-center text-white/35 text-xs leading-relaxed pb-1">
                      Sin compromiso · Respuesta en menos de 24h ·{" "}
                      <Link href="/privacidad" className="underline hover:text-white/60">Privacidad</Link>
                    </p>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── STATS ─────────────────────────────────────────────────────────── */}
        <section className="py-12 border-y border-white/10 bg-white/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
              {[
                { value: "+500", label: "Grupos escolares" },
                { value: "+15.000", label: "Alumnos al año" },
                { value: "15+", label: "Años de experiencia" },
                { value: "100%", label: "Monitores titulados" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-3xl sm:text-4xl font-extrabold text-amber-400 mb-1">{stat.value}</div>
                  <div className="text-white/60 text-sm sm:text-base">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── BENEFICIOS ────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                ¿Por qué elegir{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                  Náyade
                </span>{" "}
                para tu grupo?
              </h2>
              <p className="text-white/60 text-base sm:text-lg max-w-2xl mx-auto">
                Nos adaptamos a cada grupo con programas seguros, educativos y diseñados para crear
                recuerdos que duran toda la vida.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-300"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center mb-4">
                    <b.icon className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="font-bold text-white text-lg mb-2">{b.title}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PROGRAMAS ─────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28 bg-white/[0.03]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                Nuestros programas escolares
              </h2>
              <p className="text-white/60 text-base sm:text-lg max-w-2xl mx-auto">
                Cada programa está diseñado con objetivos pedagógicos claros y adaptado al rango de edad
                de los participantes.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {PROGRAM_TYPES.map((prog) => (
                <div
                  key={prog.title}
                  className={`bg-gradient-to-br ${prog.color} border rounded-2xl p-7 flex flex-col gap-3`}
                >
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full w-fit ${prog.tagColor}`}>
                    <prog.icon className="w-3.5 h-3.5" />
                    {prog.tag}
                  </span>
                  <h3 className="text-xl font-bold text-white">{prog.title}</h3>
                  <p className="text-white/70 text-sm leading-relaxed">{prog.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">Preguntas frecuentes</h2>
              <p className="text-white/60 text-base sm:text-lg">Todo lo que necesitas saber antes de reservar.</p>
            </div>
            <div className="space-y-3">
              {FAQS.map((faq) => <FaqItem key={faq.q} q={faq.q} a={faq.a} />)}
            </div>
          </div>
        </section>

        {/* ── CTA FINAL ─────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 rounded-3xl p-10 sm:p-16">
              <Sparkles className="w-10 h-10 text-amber-400 mx-auto mb-4" />
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                ¿Listo para crear una experiencia{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                  inolvidable?
                </span>
              </h2>
              <p className="text-white/70 text-base sm:text-lg mb-8 max-w-2xl mx-auto">
                Únete a los cientos de colegios que ya confían en Náyade cada año.
                Presupuesto personalizado sin compromiso en menos de 24 horas.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  <Button className="bg-amber-500 hover:bg-amber-400 text-white rounded-xl px-10 py-4 text-base font-bold shadow-lg shadow-amber-500/30 w-full sm:w-auto">
                    Solicitar presupuesto
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href={`tel:${phoneTel}`}>
                  <Button
                    variant="outline"
                    className="border-white/30 text-white hover:bg-white/10 rounded-xl px-10 py-4 text-base font-semibold w-full sm:w-auto"
                  >
                    <Phone className="w-4 h-4 mr-2" />
                    Llamar ahora
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

      </div>
    </PublicLayout>
  );
}
