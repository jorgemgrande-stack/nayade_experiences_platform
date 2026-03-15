import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Send, Phone, Mail, MapPin, Clock, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", subject: "", message: "" });

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
    });
  };

  return (
    <PublicLayout>
      {/* Header */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Contacto</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">Contáctanos</h1>
          <p className="text-white/60 text-lg max-w-xl">
            ¿Tienes alguna pregunta? Nuestro equipo está aquí para ayudarte a planificar tu próxima aventura.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Form */}
            <div className="lg:col-span-2">
              {submitted ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="w-10 h-10 text-emerald-500" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-3">¡Mensaje Enviado!</h2>
                  <p className="text-muted-foreground mb-6">Nos pondremos en contacto contigo en menos de 24 horas.</p>
                  <Button onClick={() => setSubmitted(false)} variant="outline">Enviar otro mensaje</Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Nombre completo *</Label>
                      <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="phone">Teléfono</Label>
                      <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="subject">Asunto *</Label>
                      <Input id="subject" value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} required className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="message">Mensaje *</Label>
                    <Textarea id="message" value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} required className="mt-1" rows={6} placeholder="¿En qué podemos ayudarte?" />
                  </div>
                  <Button type="submit" disabled={submitLead.isPending} className="bg-gold-gradient text-white hover:opacity-90 font-semibold h-12 px-8">
                    {submitLead.isPending ? "Enviando..." : "Enviar Mensaje"}
                    <Send className="ml-2 w-4 h-4" />
                  </Button>
                </form>
              )}
            </div>

            {/* Contact Info */}
            <div className="space-y-5">
              {[
                { icon: Phone, title: "Teléfono", lines: ["+34 000 000 000", "Lun-Vie: 9:00 - 19:00"] },
                { icon: Mail, title: "Email", lines: ["info@nayadeexperiences.es", "reservas@nayadeexperiences.es"] },
                { icon: MapPin, title: "Ubicación", lines: ["Nayade Experiences", "España"] },
                { icon: Clock, title: "Horario", lines: ["Lunes a Viernes: 9:00 - 19:00", "Sábados: 10:00 - 14:00"] },
              ].map((item) => (
                <div key={item.title} className="bg-card rounded-2xl border border-border/50 p-5 flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h4 className="font-display font-semibold text-foreground mb-1">{item.title}</h4>
                    {item.lines.map((line, i) => (
                      <p key={i} className="text-sm text-muted-foreground">{line}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
