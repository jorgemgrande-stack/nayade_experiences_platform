import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ChevronRight, Star, Clock, Users, MapPin, Shield, CheckCircle,
  XCircle, Calendar, Phone, Mail, ArrowRight, ChevronLeft, ChevronRight as ChevronRightIcon,
  ShoppingCart, Tag, ChevronDown,
} from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { DiscountRibbon, getDiscountedPrice } from "@/components/DiscountRibbon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [persons, setPersons] = useState(2);
  const [selectedDate, setSelectedDate] = useState("");
  const { addItem, openCart } = useCart();
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", date: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<number | undefined>(undefined);

  const { data: dbExp, isLoading: isLoadingExp } = trpc.public.getExperienceBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug, retry: false }
  );

  const { data: variants = [] } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: dbExp?.id ?? 0 },
    { enabled: !!dbExp?.id }
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

  const exp = dbExp;

  // Precio efectivo: variante seleccionada > precio base
  const selectedVariant = variants.find(v => v.id === selectedVariantId);
  const effectivePricePerPerson = selectedVariant
    ? parseFloat(String(selectedVariant.priceModifier ?? exp?.basePrice ?? "0"))
    : parseFloat(String(exp?.basePrice ?? "0"));

  // Precio "desde": mínimo de todas las variantes (o basePrice si no hay variantes)
  const minVariantPrice = variants.length > 0
    ? Math.min(...variants.map(v => parseFloat(String(v.priceModifier ?? exp.basePrice))))
    : parseFloat(String(exp?.basePrice ?? "0"));
  const displayFromPrice = Math.min(minVariantPrice, parseFloat(String(exp?.basePrice ?? "0")));

  // Construir galería desde image1..4 (BD) o gallery (legacy) o fallback estático
  const dbGallery = [
    (exp as Record<string, unknown> | undefined)?.image1,
    (exp as Record<string, unknown> | undefined)?.image2,
    (exp as Record<string, unknown> | undefined)?.image3,
    (exp as Record<string, unknown> | undefined)?.image4,
  ].filter((img): img is string => typeof img === "string" && img.length > 0);
  const gallery = dbGallery.length > 0
    ? dbGallery
    : ((exp as Record<string, unknown> | undefined)?.gallery as string[] | undefined) ?? [];
  const includes = (exp?.includes as string[] | undefined) ?? [];
  const excludes = (exp?.excludes as string[] | undefined) ?? [];
  const totalPrice = effectivePricePerPerson * persons;

  // Descuento activo en la experiencia
  const discountedFromPrice = getDiscountedPrice(
    displayFromPrice,
    (exp as Record<string, unknown> | undefined)?.discountPercent as string | number | null,
    (exp as Record<string, unknown> | undefined)?.discountExpiresAt as string | null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await submitLead.mutateAsync({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      message: formData.message,
      experienceId: exp?.id ?? 0,
      numberOfPersons: persons,
      preferredDate: formData.date,
      selectedCategory: "Experiencias",
      selectedProduct: exp?.title ?? "",
    });
    setIsSubmitting(false);
  };

  // Mostrar skeleton mientras carga
  if (isLoadingExp) {
    return (
      <PublicLayout>
        <div className="container py-20 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Cargando experiencia...</p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Mostrar 404 si el slug no existe en la BD
  if (!exp) {
    return (
      <PublicLayout>
        <div className="container py-20 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-6xl mb-4">🌊</div>
            <h1 className="text-2xl font-bold mb-2">Experiencia no encontrada</h1>
            <p className="text-muted-foreground mb-6">Esta experiencia no está disponible o ha sido eliminada del catálogo.</p>
            <Link href="/experiencias">
              <Button className="bg-accent hover:bg-accent/90">
                Ver todas las experiencias
              </Button>
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

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
              <div className="bg-card rounded-2xl border border-border/50 shadow-lg p-6 relative overflow-hidden">
                {/* Ribbon de descuento */}
                <DiscountRibbon
                  discountPercent={(exp as Record<string, unknown> | undefined)?.discountPercent as number | null}
                  discountExpiresAt={(exp as Record<string, unknown> | undefined)?.discountExpiresAt as string | null}
                  variant="card"
                />

                {/* Precio desde */}
                <div className="mb-4">
                  <span className="text-sm text-muted-foreground">Precio por persona desde</span>
                  {discountedFromPrice ? (
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-4xl font-display font-bold text-orange-500">{discountedFromPrice.toFixed(0)}€</span>
                      <span className="text-lg text-muted-foreground line-through">{displayFromPrice.toFixed(0)}€</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-4xl font-display font-bold text-foreground">{displayFromPrice.toFixed(0)}€</span>
                      {variants.length > 0 && (
                        <span className="text-xs text-muted-foreground">/ persona</span>
                      )}
                    </div>
                  )}
                </div>
                {/* Badge de oferta */}
                {discountedFromPrice && (
                  <div className="mb-4">
                    <DiscountRibbon
                      discountPercent={(exp as Record<string, unknown> | undefined)?.discountPercent as number | null}
                      discountExpiresAt={(exp as Record<string, unknown> | undefined)?.discountExpiresAt as string | null}
                      variant="detail"
                    />
                  </div>
                )}

                {/* Lista informativa de variantes */}
                {variants.length > 0 && (
                  <div className="mb-5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Tag className="w-3 h-3 text-orange-500" /> Modalidades disponibles
                    </p>
                    <div className="space-y-1.5">
                      {/* Opción estándar (precio base) si no hay variante requerida */}
                      {!variants.some(v => v.isRequired) && (
                        <button
                          type="button"
                          onClick={() => setSelectedVariantId(undefined)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition-all",
                            selectedVariantId === undefined
                              ? "border-orange-400 bg-orange-50 text-orange-700 font-semibold"
                              : "border-border text-muted-foreground hover:border-orange-200 hover:bg-orange-50/40"
                          )}
                        >
                          <span>Estándar</span>
                          <span className="font-bold">{parseFloat(String(exp?.basePrice ?? "0")).toFixed(0)}€/p.</span>
                        </button>
                      )}
                      {variants.map(v => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVariantId(v.id)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition-all",
                            selectedVariantId === v.id
                              ? "border-orange-400 bg-orange-50 text-orange-700 font-semibold"
                              : "border-border text-muted-foreground hover:border-orange-200 hover:bg-orange-50/40"
                          )}
                        >
                          <span className="text-left leading-tight">{v.name}</span>
                          <span className="font-bold ml-2 shrink-0">{parseFloat(String(v.priceModifier ?? 0)).toFixed(0)}€/p.</span>
                        </button>
                      ))}
                    </div>
                    {variants.some(v => v.isRequired) && selectedVariantId === undefined && (
                      <p className="text-xs text-orange-600 mt-1.5">Selecciona una modalidad para continuar</p>
                    )}
                  </div>
                )}

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
                    <span>
                      {effectivePricePerPerson.toFixed(0)}€ × {persons} personas
                      {selectedVariant && <span className="block text-xs text-orange-600">{selectedVariant.name}</span>}
                    </span>
                    <span>{totalPrice.toFixed(0)}€</span>
                  </div>
                  <div className="flex items-center justify-between font-display font-bold text-foreground">
                    <span>Total estimado</span>
                    <span className="text-xl text-accent">{totalPrice.toFixed(0)}€</span>
                  </div>
                </div>

                {/* Selector de fecha para el carrito */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Fecha preferida</label>
                  <input
                    type="date"
                    value={selectedDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {/* CTA principal: Añadir al carrito (único botón de compra) */}
                {exp.basePrice && parseFloat(String(exp?.basePrice ?? "0")) > 0 ? (
                  <Button
                    onClick={() => {
                      if (!selectedDate) {
                        toast.info("Selecciona una fecha antes de añadir al carrito");
                        return;
                      }
                      if (variants.some(v => v.isRequired) && selectedVariantId === undefined) {
                        toast.info("Selecciona una modalidad antes de añadir al carrito");
                        return;
                      }
                      addItem({
                        productId: exp.id,
                        productName: exp.title,
                        productSlug: exp.slug,
                        productImage: ((exp as Record<string, unknown>).coverImageUrl as string) ?? "",
                        bookingDate: selectedDate,
                        people: persons,
                        minPersons: exp.minPersons ?? 1,
                        maxPersons: exp.maxPersons ?? 20,
                        variantId: selectedVariant?.id,
                        variantName: selectedVariant?.name,
                        pricePerPerson: effectivePricePerPerson,
                        estimatedTotal: effectivePricePerPerson * persons,
                        extras: [],
                      });
                      openCart();
                    }}
                    className="w-full font-semibold h-12 text-base mb-2"
                    style={{ background: 'linear-gradient(135deg, #f97316, #f59e0b)', color: '#fff' }}
                  >
                    <ShoppingCart className="mr-2 w-4 h-4" />
                    Añadir al carrito
                  </Button>
                ) : null}
                {/* CTA secundario: Solicitar Presupuesto → /presupuesto */}
                <Link href={`/presupuesto?exp=${exp.slug}`}>
                  <Button
                    variant="outline"
                    className="w-full h-12 mb-0"
                  >
                    Solicitar Presupuesto
                  </Button>
                </Link>

                <div className="mt-5 pt-5 border-t border-border space-y-3">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4 text-accent shrink-0" />
                    <a href="tel:+34930347791" className="hover:text-accent transition-colors">+34 930 34 77 91</a>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Mail className="w-4 h-4 text-accent shrink-0" />
                    <a href="mailto:reservas@nayadeexperiences.es" className="hover:text-accent transition-colors">reservas@nayadeexperiences.es</a>
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


    </PublicLayout>
  );
}
