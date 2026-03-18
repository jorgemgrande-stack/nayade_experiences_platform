import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ChevronRight, Star, Clock, Users, MapPin, Shield, CheckCircle,
  XCircle, Calendar, Phone, Mail, ArrowRight, ChevronLeft, ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import BookingModal from "@/components/BookingModal";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const staticExperience = {
  id: 1,
  slug: "esqui-pirineos",
  title: "Esquí en los Pirineos",
  shortDescription: "Una jornada completa de esquí en las mejores pistas del Pirineo español",
  description: `Vive una experiencia única en las impresionantes pistas del Pirineo. Nuestros monitores certificados te guiarán desde los primeros pasos hasta las pistas más emocionantes, adaptando siempre el nivel a tus capacidades.

La jornada incluye traslado desde el punto de encuentro, alquiler completo de material, clases con instructor y almuerzo en el refugio de montaña. Una experiencia completa para disfrutar de la nieve en familia, con amigos o en pareja.`,
  categoryId: 1,
  locationId: 1,
  coverImageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=1200&q=80",
  gallery: [
    "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&q=80",
    "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&q=80",
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80",
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
  ],
  basePrice: "89.00",
  duration: "1 día completo",
  minPersons: 2,
  maxPersons: 10,
  difficulty: "moderado",
  includes: ["Traslado incluido", "Alquiler de material completo", "Monitor certificado", "Almuerzo en refugio", "Seguro de actividad"],
  excludes: ["Forfait de esquí (opcional +35€)", "Bebidas adicionales", "Transporte desde tu ciudad"],
  requirements: "Se recomienda buena condición física. No es necesaria experiencia previa.",
  isFeatured: true,
  isActive: true,
};

const difficultyColors: Record<string, string> = {
  facil: "bg-emerald-100 text-emerald-700",
  moderado: "bg-amber-100 text-amber-700",
  dificil: "bg-red-100 text-red-700",
  experto: "bg-purple-100 text-purple-700",
};

const difficultyLabels: Record<string, string> = {
  facil: "Fácil",
  moderado: "Moderado",
  dificil: "Difícil",
  experto: "Experto",
};

export default function ExperienceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showBookingModal, setShowBookingModal] = useState(false); // lead modal
  const [showRedsysModal, setShowRedsysModal] = useState(false);   // Redsys payment modal
  const [persons, setPersons] = useState(2);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", date: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: dbExp } = trpc.public.getExperienceBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug, retry: false }
  );

  const submitLead = trpc.public.submitLead.useMutation({
    onSuccess: () => {
      toast.success("¡Solicitud enviada! Nos pondremos en contacto contigo pronto.");
      setShowBookingModal(false);
      setFormData({ name: "", email: "", phone: "", date: "", message: "" });
    },
    onError: () => {
      toast.error("Error al enviar la solicitud. Por favor, inténtalo de nuevo.");
    },
  });

  const exp = dbExp ?? staticExperience;
  // Construir galería desde image1..4 (BD) o gallery (legacy) o fallback estático
  const dbGallery = [
    (exp as Record<string, unknown>).image1,
    (exp as Record<string, unknown>).image2,
    (exp as Record<string, unknown>).image3,
    (exp as Record<string, unknown>).image4,
  ].filter((img): img is string => typeof img === "string" && img.length > 0);
  const gallery = dbGallery.length > 0
    ? dbGallery
    : ((exp as Record<string, unknown>).gallery as string[] | undefined) ?? staticExperience.gallery;
  const includes = (exp.includes as string[]) ?? staticExperience.includes;
  const excludes = (exp.excludes as string[]) ?? staticExperience.excludes;
  const totalPrice = parseFloat(exp.basePrice) * persons;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await submitLead.mutateAsync({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      message: formData.message,
      experienceId: exp.id,
      numberOfPersons: persons,
      preferredDate: formData.date,
    });
    setIsSubmitting(false);
  };

  return (
    <PublicLayout>
      {/* Breadcrumb */}
      <div className="container py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-accent transition-colors">Inicio</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/experiencias" className="hover:text-accent transition-colors">Experiencias</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-foreground">{exp.title}</span>
        </div>
      </div>

      <div className="container pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left: Content */}
          <div className="lg:col-span-2">
            {/* Gallery */}
            <div className="relative rounded-2xl overflow-hidden aspect-[16/9] mb-4">
              <img
                src={gallery[galleryIndex] ?? exp.coverImageUrl ?? ""}
                alt={exp.title}
                className="w-full h-full object-cover"
              />
              {gallery.length > 1 && (
                <>
                  <button
                    onClick={() => setGalleryIndex((i) => (i - 1 + gallery.length) % gallery.length)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setGalleryIndex((i) => (i + 1) % gallery.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition-all"
                  >
                    <ChevronRightIcon className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail Gallery */}
            {gallery.length > 1 && (
              <div className="flex gap-2 mb-8">
                {gallery.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setGalleryIndex(i)}
                    className={cn(
                      "w-20 h-14 rounded-lg overflow-hidden border-2 transition-all",
                      i === galleryIndex ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"
                    )}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Title & Badges */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              {exp.difficulty && (
                <Badge className={cn("font-medium", difficultyColors[exp.difficulty] ?? "")}>
                  {difficultyLabels[exp.difficulty] ?? exp.difficulty}
                </Badge>
              )}
              {exp.isFeatured && (
                <Badge className="bg-amber-500 text-white">★ Destacado</Badge>
              )}
            </div>

            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
              {exp.title}
            </h1>

            {/* Quick Info */}
            <div className="flex flex-wrap gap-5 text-sm text-muted-foreground mb-8 pb-8 border-b border-border">
              {exp.duration && (
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-accent" />
                  {exp.duration}
                </span>
              )}
              {exp.minPersons && (
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" />
                  {exp.minPersons}{exp.maxPersons ? `–${exp.maxPersons}` : "+"} personas
                </span>
              )}
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-accent" />
                Seguro incluido
              </span>
              <span className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                4.9 (124 reseñas)
              </span>
            </div>

            {/* Description */}
            <div className="mb-8">
              <h2 className="text-xl font-display font-semibold text-foreground mb-4">Descripción</h2>
              <div className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {exp.description ?? exp.shortDescription}
              </div>
            </div>

            {/* Includes / Excludes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div>
                <h3 className="font-display font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                  Incluye
                </h3>
                <ul className="space-y-2">
                  {includes.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-display font-semibold text-foreground mb-3 flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-400" />
                  No incluye
                </h3>
                <ul className="space-y-2">
                  {excludes.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Requirements */}
            {exp.requirements && (
              <div className="bg-muted/50 rounded-xl p-5 mb-8">
                <h3 className="font-display font-semibold text-foreground mb-2">Requisitos</h3>
                <p className="text-sm text-muted-foreground">{exp.requirements}</p>
              </div>
            )}
          </div>

          {/* Right: Booking Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-28">
              <div className="bg-card rounded-2xl border border-border/50 shadow-lg p-6">
                <div className="mb-5">
                  <span className="text-sm text-muted-foreground">Precio por persona desde</span>
                  <div className="text-4xl font-display font-bold text-foreground mt-1">
                    {parseFloat(exp.basePrice).toFixed(0)}€
                  </div>
                </div>

                {/* Persons Selector */}
                <div className="mb-5">
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Número de personas
                  </Label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPersons(Math.max(exp.minPersons ?? 1, persons - 1))}
                      className="w-9 h-9 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors font-bold"
                    >
                      −
                    </button>
                    <span className="text-xl font-display font-semibold w-8 text-center">{persons}</span>
                    <button
                      onClick={() => setPersons(Math.min(exp.maxPersons ?? 99, persons + 1))}
                      className="w-9 h-9 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Total */}
                <div className="bg-muted/50 rounded-xl p-4 mb-5">
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                    <span>{parseFloat(exp.basePrice).toFixed(0)}€ × {persons} personas</span>
                    <span>{totalPrice.toFixed(0)}€</span>
                  </div>
                  <div className="flex items-center justify-between font-display font-bold text-foreground">
                    <span>Total estimado</span>
                    <span className="text-xl text-accent">{totalPrice.toFixed(0)}€</span>
                  </div>
                </div>

                 {/* CTA principal: Reservar Ahora con pago Redsys (solo si tiene precio fijo) */}
                {exp.basePrice && parseFloat(String(exp.basePrice)) > 0 ? (
                  <Button
                    onClick={() => setShowRedsysModal(true)}
                    className="w-full bg-gold-gradient text-white hover:opacity-90 font-semibold h-12 text-base mb-3"
                    style={{ background: 'linear-gradient(135deg, #f97316, #f59e0b)', color: '#fff' }}
                  >
                    Reservar Ahora
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                ) : null}
                {/* CTA secundario: Solicitar Presupuesto (lead) */}
                <Button
                  onClick={() => setShowBookingModal(true)}
                  variant="outline"
                  className="w-full h-12 mb-0"
                >
                  Solicitar Presupuesto
                </Button>

                <div className="mt-5 pt-5 border-t border-border space-y-3">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4 text-accent shrink-0" />
                    <span>+34 000 000 000</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Mail className="w-4 h-4 text-accent shrink-0" />
                    <span>reservas@nayadeexperiences.es</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Shield className="w-4 h-4 text-accent shrink-0" />
                    <span>Cancelación gratuita hasta 48h antes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Modal */}
      <Dialog open={showBookingModal} onOpenChange={setShowBookingModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Reservar: {exp.title}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Nombre completo *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="mt-1"
                />
              </div>
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
              />
            </div>
            <div>
              <Label htmlFor="date">Fecha preferida</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="message">Mensaje adicional</Label>
              <Textarea
                id="message"
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Cuéntanos más sobre tu grupo o necesidades especiales..."
                className="mt-1"
                rows={3}
              />
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <div className="flex justify-between font-semibold">
                <span>Total estimado ({persons} personas)</span>
                <span className="text-accent">{totalPrice.toFixed(0)}€</span>
              </div>
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gold-gradient text-white hover:opacity-90 font-semibold"
            >
              {isSubmitting ? "Enviando..." : "Confirmar Solicitud"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Recibirás confirmación por email. Nuestro equipo se pondrá en contacto contigo.
            </p>
          </form>
        </DialogContent>
      </Dialog>

      {/* BookingModal Redsys — Reservar Ahora con pago */}
      <BookingModal
        isOpen={showRedsysModal}
        onClose={() => setShowRedsysModal(false)}
        product={{
          id: exp.id,
          title: exp.title,
          basePrice: exp.basePrice,
          duration: exp.duration ?? undefined,
          minPersons: exp.minPersons ?? undefined,
          maxPersons: exp.maxPersons ?? undefined,
          image1: (exp as Record<string, unknown>).image1 as string | undefined,
        }}
      />
    </PublicLayout>
  );
}
