import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Clock, Phone, Mail, MapPin, Loader2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ReviewSection } from "@/components/ReviewSection";

const FALLBACK_IMAGES: Record<string, string> = {
  "el-galeon": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  "nassau-bar": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  "la-cabana-del-lago": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  "arroceria-la-cabana": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
};

export default function RestauranteDetail() {
  const { slug } = useParams<{ slug: string }>();

  const { data: restaurant, isLoading, error } = trpc.restaurants.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug }
  );

  const { data: shifts } = trpc.restaurants.getShifts.useQuery(
    { restaurantId: restaurant?.id ?? 0 },
    { enabled: !!restaurant?.id }
  );

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      </PublicLayout>
    );
  }

  if (error || !restaurant) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="text-3xl font-heading font-bold text-foreground mb-4">Restaurante no encontrado</h1>
          <p className="text-muted-foreground font-display mb-8">El restaurante que buscas no existe o no está disponible.</p>
          <Link href="/restaurantes">
            <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8">
              <ArrowLeft className="w-4 h-4 mr-2" /> Ver todos los restaurantes
            </Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  const heroImg = restaurant.heroImage || FALLBACK_IMAGES[restaurant.slug] || "";
  const galleryImages = (restaurant.galleryImages as string[]) ?? [];

  // Formatear horarios desde los turnos
  const horarioTexto = shifts && shifts.length > 0
    ? shifts.map(s => `${s.name}: ${s.startTime}–${s.endTime}`).join(" · ")
    : "Consultar horarios";

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[55vh] min-h-[400px] overflow-hidden">
        <img src={heroImg} alt={restaurant.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/35 to-black/75" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <Link href="/restaurantes">
              <button className="flex items-center gap-1.5 text-white/80 hover:text-white font-display text-sm mb-6 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Todos los restaurantes
              </button>
            </Link>
            <div className="flex items-center gap-3 mb-3">
              {restaurant.badge && (
                <span className="bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full">
                  {restaurant.badge}
                </span>
              )}
            </div>
            <h1 className="text-5xl md:text-6xl font-heading font-bold text-white leading-tight mb-3">
              {restaurant.name}
            </h1>
            {restaurant.cuisine && (
              <p className="text-xl text-white/85 font-display">{restaurant.cuisine}</p>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Descripción y galería */}
            <div className="lg:col-span-2 space-y-10">
              {/* Descripción */}
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Sobre nosotros</h2>
                <p className="text-muted-foreground font-display text-lg leading-relaxed">
                  {restaurant.longDesc || restaurant.shortDesc || ""}
                </p>
              </div>

              {/* Turnos / horarios */}
              {shifts && shifts.length > 0 && (
                <div>
                  <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Horarios</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {shifts.map(s => (
                      <div key={s.id} className="bg-card rounded-xl border border-border/40 p-4">
                        <div className="font-heading font-bold text-foreground mb-1">{s.name}</div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground font-display">
                          <Clock className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span>{s.startTime} – {s.endTime}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground font-display mt-1">
                          <Users className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span>Capacidad: {s.maxCapacity} personas</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Galería */}
              {galleryImages.length > 1 && (
                <div>
                  <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Galería</h2>
                  <div className="grid grid-cols-2 gap-4">
                    {galleryImages.slice(1).map((img, i) => (
                      <div key={i} className="rounded-xl overflow-hidden aspect-video">
                        <img src={img} alt={`${restaurant.name} ${i + 2}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Política de cancelación */}
              {restaurant.cancellationPolicy && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
                  <h3 className="font-heading font-bold text-amber-800 dark:text-amber-300 mb-2">Política de cancelación</h3>
                  <p className="text-sm text-amber-700 dark:text-amber-400 font-display leading-relaxed">
                    {restaurant.cancellationPolicy}
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar de reserva */}
            <div>
              <div className="bg-card rounded-2xl shadow-lg border border-border/40 p-6 sticky top-24 space-y-5">
                {/* Depósito */}
                {restaurant.depositPerGuest && Number(restaurant.depositPerGuest) > 0 && (
                  <div className="bg-accent/5 rounded-xl p-4 text-center">
                    <div className="text-2xl font-heading font-bold text-accent">{restaurant.depositPerGuest}€</div>
                    <div className="text-xs text-muted-foreground font-display">depósito por comensal</div>
                    <div className="text-xs text-muted-foreground font-display mt-1">Se descuenta del total de la cuenta</div>
                  </div>
                )}

                {/* Horario */}
                <div>
                  <h3 className="font-heading font-bold text-foreground mb-2">Horario</h3>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground font-display">
                    <Clock className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <span>{horarioTexto}</span>
                  </div>
                </div>

                {/* Ubicación */}
                <div className="border-t border-border/40 pt-5">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground font-display mb-3">
                    <MapPin className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <span>{restaurant.location || "Los Ángeles de San Rafael, Segovia"}</span>
                  </div>
                </div>

                {/* Botón de reserva */}
                {restaurant.acceptsOnlineBooking && (
                  <Link href={`/restaurantes/${slug}/reservar`}>
                    <Button className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full py-3 text-base shadow-md mb-2">
                      Reservar Mesa <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}

                {/* Teléfono */}
                <a href={`tel:${restaurant.phone || "+34930347791"}`}>
                  <Button variant="outline" className="w-full font-display font-semibold rounded-full py-3 text-base border-primary/30 text-primary hover:bg-primary/5">
                    <Phone className="w-4 h-4 mr-2" /> {restaurant.phone || "+34 930 34 77 91"}
                  </Button>
                </a>

                {/* Email */}
                <a
                  href={`mailto:${restaurant.email || "reservas@nayadeexperiences.es"}`}
                  className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-accent font-display transition-colors pt-2"
                >
                  <Mail className="w-4 h-4" /> {restaurant.email || "reservas@nayadeexperiences.es"}
                </a>

                {/* Grupo máximo */}
                {restaurant.maxGroupSize && (
                  <div className="text-xs text-muted-foreground font-display text-center pt-2 border-t border-border/40">
                    Grupos de hasta {restaurant.maxGroupSize} personas
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reseñas de clientes */}
      <section className="py-12 bg-muted border-t border-border">
        <div className="container max-w-5xl">
          <ReviewSection entityType="restaurant" entityId={restaurant.id} theme="auto" />
        </div>
      </section>
    </PublicLayout>
  );
}
