import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Send, CheckCircle, Phone, Mail, Clock, Users, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const experienceTypes = [
  "Esquí y Nieve",
  "Aventura Acuática",
  "Multiaventura",
  "Experiencia Premium",
  "Evento Corporativo",
  "Celebración Especial",
  "Otro",
];

const budgetRanges = [
  "Menos de 500€",
  "500€ - 1.000€",
  "1.000€ - 2.500€",
  "2.500€ - 5.000€",
  "Más de 5.000€",
  "A consultar",
];

export default function BudgetRequest() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    experienceType: "",
    numberOfPersons: "",
    preferredDate: "",
    budget: "",
    message: "",
  });

  const submitLead = trpc.public.submitLead.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: () => {
      toast.error("Error al enviar la solicitud. Por favor, inténtalo de nuevo.");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitLead.mutateAsync({
      name: formData.name,
      email: formData.email,
      phone: formData.phone || undefined,
      company: formData.company || undefined,
      message: `Tipo de experiencia: ${formData.experienceType}\n\n${formData.message}`,
      numberOfPersons: formData.numberOfPersons ? parseInt(formData.numberOfPersons) : undefined,
      preferredDate: formData.preferredDate || undefined,
      budget: formData.budget || undefined,
    });
  };

  if (submitted) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-3xl font-display font-bold text-foreground mb-3">
              ¡Solicitud Recibida!
            </h2>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              Hemos recibido tu solicitud de presupuesto. Nuestro equipo se pondrá en contacto contigo en menos de 24 horas con una propuesta personalizada.
            </p>
            <div className="bg-muted/50 rounded-xl p-5 mb-6 text-left space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Clock className="w-4 h-4 text-accent" />
                <span className="text-muted-foreground">Respuesta en menos de 24 horas</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-accent" />
                <span className="text-muted-foreground">Te llamaremos al número proporcionado</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-accent" />
                <span className="text-muted-foreground">Recibirás el presupuesto por email</span>
              </div>
            </div>
            <Button asChild className="bg-gold-gradient text-white hover:opacity-90 font-semibold">
              <Link href="/">Volver al Inicio</Link>
            </Button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* Header */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Solicitar Presupuesto</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
            Solicita tu Presupuesto
          </h1>
          <p className="text-white/60 text-lg max-w-xl">
            Cuéntanos qué tipo de experiencia buscas y te enviaremos una propuesta personalizada en menos de 24 horas.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Form */}
            <div className="lg:col-span-2">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Personal Info */}
                <div>
                  <h3 className="font-display font-semibold text-lg text-foreground mb-4 pb-2 border-b border-border">
                    Datos de Contacto
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Nombre completo *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className="mt-1"
                        placeholder="Tu nombre y apellidos"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                        className="mt-1"
                        placeholder="tu@email.com"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Teléfono</Label>
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="mt-1"
                        placeholder="+34 600 000 000"
                      />
                    </div>
                    <div>
                      <Label htmlFor="company">Empresa / Organización</Label>
                      <Input
                        id="company"
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        className="mt-1"
                        placeholder="Nombre de tu empresa (opcional)"
                      />
                    </div>
                  </div>
                </div>

                {/* Experience Details */}
                <div>
                  <h3 className="font-display font-semibold text-lg text-foreground mb-4 pb-2 border-b border-border">
                    Detalles de la Experiencia
                  </h3>

                  <div className="mb-4">
                    <Label className="mb-2 block">Tipo de experiencia *</Label>
                    <div className="flex flex-wrap gap-2">
                      {experienceTypes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormData({ ...formData, experienceType: type })}
                          className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                            formData.experienceType === type
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="persons">Número de personas</Label>
                      <Input
                        id="persons"
                        type="number"
                        min="1"
                        value={formData.numberOfPersons}
                        onChange={(e) => setFormData({ ...formData, numberOfPersons: e.target.value })}
                        className="mt-1"
                        placeholder="Ej: 10"
                      />
                    </div>
                    <div>
                      <Label htmlFor="date">Fecha preferida</Label>
                      <Input
                        id="date"
                        type="date"
                        value={formData.preferredDate}
                        onChange={(e) => setFormData({ ...formData, preferredDate: e.target.value })}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <Label className="mb-2 block">Presupuesto aproximado</Label>
                    <div className="flex flex-wrap gap-2">
                      {budgetRanges.map((range) => (
                        <button
                          key={range}
                          type="button"
                          onClick={() => setFormData({ ...formData, budget: range })}
                          className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                            formData.budget === range
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                          }`}
                        >
                          {range}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Message */}
                <div>
                  <Label htmlFor="message">Cuéntanos más sobre tu experiencia ideal *</Label>
                  <Textarea
                    id="message"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    required
                    className="mt-1"
                    rows={5}
                    placeholder="Describe qué tipo de actividad buscas, para qué ocasión, si hay necesidades especiales, etc."
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitLead.isPending}
                  className="w-full bg-gold-gradient text-white hover:opacity-90 font-semibold h-12 text-base"
                >
                  {submitLead.isPending ? "Enviando..." : "Enviar Solicitud"}
                  <Send className="ml-2 w-4 h-4" />
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Al enviar este formulario aceptas nuestra{" "}
                  <Link href="/privacidad" className="underline hover:text-accent">política de privacidad</Link>.
                </p>
              </form>
            </div>

            {/* Sidebar Info */}
            <div className="space-y-6">
              <div className="bg-card rounded-2xl border border-border/50 p-6">
                <h3 className="font-display font-semibold text-foreground mb-4">¿Cómo funciona?</h3>
                <div className="space-y-4">
                  {[
                    { step: "01", title: "Envía tu solicitud", desc: "Rellena el formulario con los detalles de tu experiencia ideal." },
                    { step: "02", title: "Analizamos tu petición", desc: "Nuestro equipo estudia tu solicitud y prepara una propuesta personalizada." },
                    { step: "03", title: "Recibe tu presupuesto", desc: "En menos de 24h recibirás un presupuesto detallado por email." },
                    { step: "04", title: "Confirma y disfruta", desc: "Acepta el presupuesto con un clic y prepárate para la aventura." },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-accent">{item.step}</span>
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[oklch(0.14_0.03_240)] rounded-2xl p-6 text-white">
                <h3 className="font-display font-semibold mb-4">Contacto Directo</h3>
                <div className="space-y-3">
                  <a href="tel:+34000000000" className="flex items-center gap-3 text-sm text-white/70 hover:text-amber-400 transition-colors">
                    <Phone className="w-4 h-4 text-amber-400" />
                    +34 000 000 000
                  </a>
                  <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-3 text-sm text-white/70 hover:text-amber-400 transition-colors">
                    <Mail className="w-4 h-4 text-amber-400" />
                    reservas@nayadeexperiences.es
                  </a>
                  <div className="flex items-center gap-3 text-sm text-white/70">
                    <Clock className="w-4 h-4 text-amber-400" />
                    Lun-Vie: 9:00 - 19:00
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <MessageSquare className="w-5 h-5 text-accent" />
                  <h3 className="font-display font-semibold text-foreground">Grupos y Empresas</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Para grupos de más de 20 personas o eventos corporativos, contamos con tarifas especiales y atención personalizada.
                </p>
                <Badge className="bg-accent/10 text-accent border-accent/20">
                  <Users className="w-3 h-3 mr-1" />
                  Descuentos para grupos
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
