import { useState } from "react";
import { Link } from "wouter";
import {
  ChevronRight, Send, Phone, Mail, MapPin, Clock,
  CheckCircle, MessageSquare, Waves,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "", email: "", phone: "", subject: "", message: "",
  });

  const submitLead = trpc.public.submitLead.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Error al enviar el mensaje. Inténtalo de nuevo."),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitLead.mutateAsync({
      name: formData.name,
      email: formData.email,
      phone: formData.phone || undefined,
      message: `Asunto: ${formData.subject}\n\n${formData.message}`,
      source: "web_contacto",
    });
  };

  const contactItems = [
    {
      icon: Phone,
      title: "Teléfono",
      lines: ["+34 930 34 77 91", "Lun-Vie: 9:00 - 19:00"],
      href: "tel:+34930347791",
      color: "from-orange-500/20 to-orange-600/10",
      iconColor: "text-orange-400",
    },
    {
      icon: Mail,
      title: "Email",
      lines: ["reservas@nayadeexperiences.es", "Respuesta en menos de 24h"],
      href: "mailto:reservas@nayadeexperiences.es",
      color: "from-blue-500/20 to-blue-600/10",
      iconColor: "text-blue-400",
    },
    {
      icon: MapPin,
      title: "Ubicación",
      lines: ["Los Ángeles de San Rafael, Segovia", "A 45 min de Madrid"],
      href: "https://maps.google.com/?q=Los+Angeles+de+San+Rafael+Segovia",
      color: "from-emerald-500/20 to-emerald-600/10",
      iconColor: "text-emerald-400",
    },
    {
      icon: Clock,
      title: "Horario",
      lines: ["Lunes a Viernes: 9:00 - 19:00", "Sábados: 10:00 - 14:00"],
      href: null,
      color: "from-purple-500/20 to-purple-600/10",
      iconColor: "text-purple-400",
    },
  ];

  return (
    <PublicLayout>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section
        className="relative py-20 overflow-hidden"
        style={{ background: "linear-gradient(135deg, oklch(0.12 0.04 240) 0%, oklch(0.16 0.05 250) 100%)" }}
      >
        {/* Decoración de fondo */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-10"
            style={{ background: "radial-gradient(circle, #f97316 0%, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full opacity-8"
            style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
          />
          <Waves className="absolute bottom-4 right-8 w-48 h-48 text-white/5" />
        </div>

        <div className="container relative">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-white/40 text-sm mb-6">
            <Link href="/" className="hover:text-orange-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/70">Contacto</span>
          </div>

          <div className="flex items-start gap-4 mb-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mt-1"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
            >
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
                Contáctanos
              </h1>
              <p className="text-white/60 text-lg max-w-xl">
                ¿Tienes alguna pregunta? Nuestro equipo está aquí para ayudarte a planificar tu próxima aventura acuática.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contenido principal ───────────────────────────────────────────── */}
      <section className="py-16 bg-background">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

            {/* ── Formulario ──────────────────────────────────────────────── */}
            <div className="lg:col-span-2">
              {submitted ? (
                /* Estado de éxito */
                <div
                  className="rounded-3xl p-12 text-center"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.14 0.03 240) 0%, oklch(0.18 0.04 250) 100%)",
                    border: "1px solid rgba(249,115,22,0.2)",
                  }}
                >
                  <div
                    className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                  >
                    <CheckCircle className="w-12 h-12 text-white" />
                  </div>
                  <h2 className="text-3xl font-display font-bold text-white mb-3">
                    ¡Mensaje Enviado!
                  </h2>
                  <p className="text-white/60 mb-8 text-lg">
                    Nos pondremos en contacto contigo en menos de 24 horas.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setFormData({ name: "", email: "", phone: "", subject: "", message: "" });
                    }}
                    style={{
                      padding: "0.75rem 2rem",
                      borderRadius: "0.75rem",
                      border: "1.5px solid rgba(249,115,22,0.5)",
                      background: "transparent",
                      color: "#f97316",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "0.95rem",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(249,115,22,0.1)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    Enviar otro mensaje
                  </button>
                </div>
              ) : (
                /* Formulario */
                <div
                  className="rounded-3xl p-8 md:p-10"
                  style={{
                    background: "linear-gradient(135deg, oklch(0.14 0.03 240) 0%, oklch(0.18 0.04 250) 100%)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 25px 50px rgba(0,0,0,0.3)",
                  }}
                >
                  {/* Cabecera del formulario */}
                  <div className="mb-8">
                    <h2 className="text-2xl font-display font-bold text-white mb-1">
                      Envíanos un mensaje
                    </h2>
                    <p className="text-white/50 text-sm">
                      Todos los campos marcados con * son obligatorios
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Nombre + Email */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="name" className="text-white/70 text-sm font-medium">
                          Nombre completo *
                        </Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                          placeholder="Tu nombre"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            color: "#fff",
                            borderRadius: "0.75rem",
                            height: "2.75rem",
                          }}
                          className="placeholder:text-white/30 focus:border-orange-500/60 focus:ring-orange-500/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-white/70 text-sm font-medium">
                          Email *
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          required
                          placeholder="tu@email.com"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            color: "#fff",
                            borderRadius: "0.75rem",
                            height: "2.75rem",
                          }}
                          className="placeholder:text-white/30 focus:border-orange-500/60 focus:ring-orange-500/20"
                        />
                      </div>
                    </div>

                    {/* Teléfono + Asunto */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="phone" className="text-white/70 text-sm font-medium">
                          Teléfono
                        </Label>
                        <Input
                          id="phone"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          placeholder="+34 600 000 000"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            color: "#fff",
                            borderRadius: "0.75rem",
                            height: "2.75rem",
                          }}
                          className="placeholder:text-white/30 focus:border-orange-500/60 focus:ring-orange-500/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="subject" className="text-white/70 text-sm font-medium">
                          Asunto *
                        </Label>
                        <Input
                          id="subject"
                          value={formData.subject}
                          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                          required
                          placeholder="¿En qué podemos ayudarte?"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            color: "#fff",
                            borderRadius: "0.75rem",
                            height: "2.75rem",
                          }}
                          className="placeholder:text-white/30 focus:border-orange-500/60 focus:ring-orange-500/20"
                        />
                      </div>
                    </div>

                    {/* Mensaje */}
                    <div className="space-y-1.5">
                      <Label htmlFor="message" className="text-white/70 text-sm font-medium">
                        Mensaje *
                      </Label>
                      <Textarea
                        id="message"
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        required
                        rows={5}
                        placeholder="Cuéntanos más sobre tu consulta, actividad que te interesa, número de personas, fechas aproximadas..."
                        style={{
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "#fff",
                          borderRadius: "0.75rem",
                          resize: "vertical",
                        }}
                        className="placeholder:text-white/30 focus:border-orange-500/60 focus:ring-orange-500/20"
                      />
                    </div>

                    {/* Separador */}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.25rem" }}>
                      {/* Botón de enviar — grande, naranja, prominente */}
                      <button
                        type="submit"
                        disabled={submitLead.isPending}
                        style={{
                          width: "100%",
                          padding: "1rem 2rem",
                          background: submitLead.isPending
                            ? "rgba(249,115,22,0.5)"
                            : "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                          border: "none",
                          borderRadius: "0.875rem",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: "1.05rem",
                          cursor: submitLead.isPending ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "0.6rem",
                          boxShadow: submitLead.isPending
                            ? "none"
                            : "0 8px 24px rgba(249,115,22,0.4)",
                          transition: "all 0.2s",
                          letterSpacing: "0.01em",
                        }}
                        onMouseEnter={(e) => {
                          if (!submitLead.isPending) {
                            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 12px 32px rgba(249,115,22,0.55)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(249,115,22,0.4)";
                        }}
                      >
                        {submitLead.isPending ? (
                          <>
                            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Enviando mensaje...
                          </>
                        ) : (
                          <>
                            <Send className="w-5 h-5" />
                            Enviar Mensaje
                          </>
                        )}
                      </button>

                      <p className="text-center text-white/30 text-xs mt-3">
                        Al enviar aceptas nuestra política de privacidad. Responderemos en menos de 24h.
                      </p>
                    </div>
                  </form>
                </div>
              )}
            </div>

            {/* ── Info de contacto ─────────────────────────────────────────── */}
            <div className="space-y-4">
              {/* Título de la columna */}
              <div className="mb-6">
                <h3 className="text-xl font-display font-bold text-foreground mb-1">
                  Información de contacto
                </h3>
                <p className="text-muted-foreground text-sm">
                  También puedes contactarnos directamente por cualquiera de estos canales.
                </p>
              </div>

              {contactItems.map((item) => {
                const Icon = item.icon;
                const content = (
                  <div
                    key={item.title}
                    className="rounded-2xl p-5 flex gap-4 transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      background: `linear-gradient(135deg, oklch(0.16 0.03 240) 0%, oklch(0.19 0.04 250) 100%)`,
                      border: "1px solid rgba(255,255,255,0.07)",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                      cursor: item.href ? "pointer" : "default",
                    }}
                  >
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `linear-gradient(135deg, ${item.color})`, border: "1px solid rgba(255,255,255,0.1)" }}
                    >
                      <Icon className={`w-5 h-5 ${item.iconColor}`} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground mb-1 text-sm">{item.title}</h4>
                      {item.lines.map((line, i) => (
                        <p key={i} className={`text-sm ${i === 0 ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                );

                return item.href ? (
                  <a key={item.title} href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="block no-underline">
                    {content}
                  </a>
                ) : (
                  <div key={item.title}>{content}</div>
                );
              })}

              {/* CTA adicional */}
              <div
                className="rounded-2xl p-5 mt-2"
                style={{
                  background: "linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(234,88,12,0.08) 100%)",
                  border: "1px solid rgba(249,115,22,0.25)",
                }}
              >
                <p className="text-sm text-foreground/80 font-medium mb-1">
                  ¿Prefieres hablar directamente?
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Llámanos y te ayudamos a diseñar tu experiencia perfecta.
                </p>
                <a
                  href="tel:+34930347791"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.5rem 1.25rem",
                    background: "linear-gradient(135deg, #f97316, #ea580c)",
                    borderRadius: "0.625rem",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    textDecoration: "none",
                    boxShadow: "0 4px 12px rgba(249,115,22,0.35)",
                  }}
                >
                  <Phone className="w-4 h-4" />
                  Llamar ahora
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
