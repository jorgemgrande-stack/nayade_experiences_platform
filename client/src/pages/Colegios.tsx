import React, { useState } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Phone, Mail, Users, Send, ChevronDown, ChevronUp,
  GraduationCap, TreePine, Waves, Tent, Star, Shield, Clock,
  ArrowRight, MapPin, Heart,
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
import { trackEvent } from "@/lib/meta-pixel/client";

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

// ─── Componente FAQ ───────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="font-semibold text-white text-sm sm:text-base">{q}</span>
        {open ? (
          <ChevronUp className="w-5 h-5 text-orange-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-white/50 flex-shrink-0" />
        )}
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

  const setField = (field: string, value: string) => {
    setFormData((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) e.name = "Introduce tu nombre";
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = "Email no válido";
    if (!formData.phone.trim() || formData.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (!formData.organizationName.trim() || formData.organizationName.trim().length < 2)
      e.organizationName = "Nombre del colegio/entidad obligatorio";
    const children = parseInt(formData.childrenCount);
    if (!children || children < 1) e.childrenCount = "Introduce el número de participantes";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    const childrenCount = parseInt(formData.childrenCount) || 1;
    const monitorsCount = parseInt(formData.monitorsCount) || 0;

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
    });

    if (hasConsent) {
      const pricePerPerson: Record<string, number> = {
        "Pack Náutico Escolar": 25,
        "Pack Aventura Escolar": 20,
        "Campamento Residencial": 80,
        "Día de Convivencia": 18,
        "Programa personalizado": 30,
      };
      const unitPrice = pricePerPerson[formData.experienceType] ?? 22;
      const estimatedValue = (childrenCount + monitorsCount) * unitPrice;

      trackEvent("Lead", {
        content_name: "colegios",
        content_category: formData.groupType || "Grupo escolar",
        value: estimatedValue,
        currency: "EUR",
      }, {
        email: formData.email.trim(),
        phone: formData.phone.trim(),
      }).catch(() => {});
    }
  };

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="max-w-lg w-full text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              ¡Solicitud recibida!
            </h1>
            <p className="text-white/70 text-base sm:text-lg leading-relaxed">
              Hemos recibido vuestra consulta. Nuestro equipo os contactará en menos de 24 horas para
              preparar un programa adaptado a vuestro grupo.
            </p>
            <Link href="/">
              <Button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-8 py-3 text-base font-semibold mt-4">
                Volver al inicio
              </Button>
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="bg-[#0a0a0a] text-white">

        {/* ── HERO ──────────────────────────────────────────────────────────── */}
        <section className="relative min-h-[85vh] flex items-center overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${HERO_BG})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/30" />

          <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 bg-orange-500/20 border border-orange-500/30 rounded-full px-4 py-2 mb-6">
                <GraduationCap className="w-4 h-4 text-orange-400" />
                <span className="text-orange-300 text-sm font-medium">Colegios, AMPAs y Campamentos</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
                Experiencias que{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400">
                  marcan para siempre
                </span>
              </h1>

              <p className="text-lg sm:text-xl text-white/80 leading-relaxed mb-8">
                Llevamos años creando programas educativos y de aventura para grupos escolares en el
                entorno natural del Lago de Bolarque. Seguridad, aprendizaje y diversión en un solo lugar.
              </p>

              <div className="flex flex-wrap gap-3 mb-10">
                {["Kayak y piragua", "Escalada", "Senderismo", "Campamentos", "Tirolina"].map((tag) => (
                  <span
                    key={tag}
                    className="bg-white/10 border border-white/20 text-white/80 text-sm px-3 py-1.5 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <a href="#formulario">
                  <Button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-8 py-4 text-base font-bold shadow-lg shadow-orange-500/30 w-full sm:w-auto">
                    Solicitar presupuesto
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href={`tel:${phoneTel}`}>
                  <Button
                    variant="outline"
                    className="border-white/30 text-white hover:bg-white/10 rounded-xl px-8 py-4 text-base font-semibold w-full sm:w-auto"
                  >
                    <Phone className="w-4 h-4 mr-2" />
                    {phone}
                  </Button>
                </a>
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
                  <div className="text-3xl sm:text-4xl font-extrabold text-orange-400 mb-1">
                    {stat.value}
                  </div>
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
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400">
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
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/8 hover:border-white/20 transition-all duration-300"
                >
                  <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center mb-4">
                    <b.icon className="w-6 h-6 text-orange-400" />
                  </div>
                  <h3 className="font-bold text-white text-lg mb-2">{b.title}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PROGRAMAS ─────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28 bg-white/3">
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
                  className={`relative bg-gradient-to-br ${prog.color} border rounded-2xl p-7 flex flex-col gap-3`}
                >
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full w-fit ${prog.tagColor}`}>
                    <prog.icon className="w-3.5 h-3.5" />
                    {prog.tag}
                  </span>
                  <h3 className="text-xl font-bold text-white">{prog.title}</h3>
                  <p className="text-white/70 text-sm leading-relaxed">{prog.desc}</p>
                  <a
                    href="#formulario"
                    className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Consultar disponibilidad
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FORMULARIO ────────────────────────────────────────────────────── */}
        <section id="formulario" className="py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                Solicita tu presupuesto
              </h2>
              <p className="text-white/60 text-base sm:text-lg">
                Cuéntanos tu grupo y os preparamos un programa a medida sin compromiso.
                Respondemos en menos de 24 horas.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-10 space-y-6"
            >
              {/* Honeypot (oculto para bots) */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                value={formData.honeypot}
                onChange={(e) => setField("honeypot", e.target.value)}
              />

              {/* Datos de contacto */}
              <div>
                <h3 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">1</span>
                  Datos de contacto
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">
                      Nombre y apellidos <span className="text-orange-400">*</span>
                    </Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="Ej: Ana García"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                    {errors.name && <p className="text-red-400 text-xs">{errors.name}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">
                      Nombre del colegio / entidad <span className="text-orange-400">*</span>
                    </Label>
                    <Input
                      value={formData.organizationName}
                      onChange={(e) => setField("organizationName", e.target.value)}
                      placeholder="Ej: Colegio San Juan de la Cruz"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                    {errors.organizationName && <p className="text-red-400 text-xs">{errors.organizationName}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">
                      Email <span className="text-orange-400">*</span>
                    </Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setField("email", e.target.value)}
                      placeholder="tu@email.com"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                    {errors.email && <p className="text-red-400 text-xs">{errors.email}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">
                      Teléfono <span className="text-orange-400">*</span>
                    </Label>
                    <Input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                      placeholder="+34 600 000 000"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                    {errors.phone && <p className="text-red-400 text-xs">{errors.phone}</p>}
                  </div>
                </div>
              </div>

              {/* Detalles del grupo */}
              <div>
                <h3 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">2</span>
                  Detalles del grupo
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">Tipo de grupo</Label>
                    <select
                      value={formData.groupType}
                      onChange={(e) => setField("groupType", e.target.value)}
                      className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                    >
                      <option value="" className="bg-neutral-900">Selecciona...</option>
                      {GROUP_TYPES.map((g) => (
                        <option key={g} value={g} className="bg-neutral-900">{g}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">Rango de edad</Label>
                    <select
                      value={formData.ageRange}
                      onChange={(e) => setField("ageRange", e.target.value)}
                      className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                    >
                      <option value="" className="bg-neutral-900">Selecciona...</option>
                      {AGE_RANGES.map((r) => (
                        <option key={r} value={r} className="bg-neutral-900">{r}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">
                      Nº de alumnos / participantes <span className="text-orange-400">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={formData.childrenCount}
                      onChange={(e) => setField("childrenCount", e.target.value)}
                      placeholder="Ej: 60"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                    {errors.childrenCount && <p className="text-red-400 text-xs">{errors.childrenCount}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">Nº de monitores / adultos</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.monitorsCount}
                      onChange={(e) => setField("monitorsCount", e.target.value)}
                      placeholder="Ej: 4"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl"
                    />
                  </div>
                </div>
              </div>

              {/* Preferencias */}
              <div>
                <h3 className="text-white font-semibold text-base mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold">3</span>
                  Preferencias
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">Tipo de experiencia</Label>
                    <select
                      value={formData.experienceType}
                      onChange={(e) => setField("experienceType", e.target.value)}
                      className="w-full bg-white/10 border border-white/20 text-white placeholder:text-white/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                    >
                      <option value="" className="bg-neutral-900">Selecciona...</option>
                      {EXPERIENCE_TYPES.map((t) => (
                        <option key={t} value={t} className="bg-neutral-900">{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/80 text-sm">Fecha preferida</Label>
                    <Input
                      type="date"
                      value={formData.preferredDate}
                      onChange={(e) => setField("preferredDate", e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="bg-white/10 border-white/20 text-white rounded-xl [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>

              {/* Comentarios */}
              <div className="space-y-1.5">
                <Label className="text-white/80 text-sm">
                  Comentarios adicionales
                </Label>
                <Textarea
                  value={formData.comments}
                  onChange={(e) => setField("comments", e.target.value)}
                  placeholder="Cuéntanos cualquier detalle relevante: necesidades especiales, objetivos del grupo, restricciones alimentarias, etc."
                  rows={4}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30 rounded-xl resize-none"
                />
              </div>

              <Button
                type="submit"
                disabled={submitLead.isPending}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-4 text-base font-bold shadow-lg shadow-orange-500/20 disabled:opacity-50"
              >
                {submitLead.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Enviando...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Send className="w-5 h-5" />
                    Solicitar presupuesto gratuito
                  </span>
                )}
              </Button>

              <p className="text-center text-white/40 text-xs leading-relaxed">
                Al enviar este formulario aceptas nuestra{" "}
                <Link href="/privacidad" className="underline hover:text-white/70">
                  política de privacidad
                </Link>
                . Sin spam ni cesión de datos a terceros.
              </p>
            </form>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28 bg-white/3">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                Preguntas frecuentes
              </h2>
              <p className="text-white/60 text-base sm:text-lg">
                Todo lo que necesitas saber antes de reservar.
              </p>
            </div>
            <div className="space-y-3">
              {FAQS.map((faq) => (
                <FaqItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA FINAL ─────────────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="bg-gradient-to-br from-orange-500/20 to-amber-500/10 border border-orange-500/30 rounded-3xl p-10 sm:p-16">
              <Star className="w-10 h-10 text-orange-400 mx-auto mb-4" />
              <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
                ¿Listo para crear una experiencia{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400">
                  inolvidable?
                </span>
              </h2>
              <p className="text-white/70 text-base sm:text-lg mb-8 max-w-2xl mx-auto">
                Únete a los cientos de colegios que ya confían en Náyade cada año. Presupuesto
                personalizado sin compromiso en menos de 24 horas.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href="#formulario">
                  <Button className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-10 py-4 text-base font-bold shadow-lg shadow-orange-500/30 w-full sm:w-auto">
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
