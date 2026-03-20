import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, MapPin, Phone, Utensils, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

const CDN_HERO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg";

// Fallback images por slug
const FALLBACK_IMAGES: Record<string, string> = {
  "el-galeon": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  "nassau-bar": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  "la-cabana-del-lago": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  "arroceria-la-cabana": "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
};

export default function Restaurantes() {
  const { data: restaurantes, isLoading } = trpc.restaurants.getAll.useQuery();

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[55vh] min-h-[420px] overflow-hidden">
        <img src={CDN_HERO} alt="Restaurantes Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-5">
                Gastronomía & Ocio
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Restaurantes Náyade
              </h1>
              <p className="text-xl text-white/85 font-display leading-relaxed">
                Cuatro espacios únicos para cada momento del día. Gastronomía de calidad con las mejores vistas al embalse.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="py-14 bg-white border-b border-border/30">
        <div className="container text-center max-w-3xl mx-auto">
          <p className="text-lg text-muted-foreground font-display leading-relaxed">
            Desde el restaurante principal con vistas panorámicas hasta el bar de cócteles junto al lago, cada espacio de Náyade tiene su propio carácter. Elige el que mejor encaje con tu momento.
          </p>
        </div>
      </section>

      {/* Restaurantes */}
      <section className="py-20 bg-white">
        <div className="container">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
          ) : !restaurantes || restaurantes.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-muted-foreground font-display">No hay restaurantes disponibles en este momento.</p>
            </div>
          ) : (
            <div className="space-y-20">
              {restaurantes.map((r, i) => {
                const heroImg = r.heroImage || FALLBACK_IMAGES[r.slug] || CDN_HERO;
                return (
                  <div key={r.slug} className={`grid lg:grid-cols-2 gap-14 items-center ${i % 2 === 1 ? "lg:grid-flow-dense" : ""}`}>
                    {/* Imagen */}
                    <div className={`rounded-2xl overflow-hidden shadow-2xl ${i % 2 === 1 ? "lg:col-start-2" : ""}`}>
                      <img
                        src={heroImg}
                        alt={r.name}
                        className="w-full h-[400px] object-cover hover:scale-105 transition-transform duration-700"
                      />
                    </div>

                    {/* Contenido */}
                    <div className={i % 2 === 1 ? "lg:col-start-1 lg:row-start-1" : ""}>
                      {r.badge && (
                        <span className="inline-block bg-accent/10 text-accent text-xs font-display font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
                          {r.badge}
                        </span>
                      )}
                      <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-2">{r.name}</h2>
                      {r.cuisine && (
                        <p className="text-accent font-display font-semibold text-lg mb-5">{r.cuisine}</p>
                      )}
                      {r.shortDesc && (
                        <p className="text-muted-foreground font-display text-lg leading-relaxed mb-6">{r.shortDesc}</p>
                      )}
                      <div className="flex flex-wrap gap-3">
                        {r.acceptsOnlineBooking && (
                          <Link href={`/restaurantes/${r.slug}`}>
                            <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-7 shadow-md shadow-accent/20">
                              Reservar Mesa <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                          </Link>
                        )}
                        <Link href={`/restaurantes/${r.slug}`}>
                          <Button variant="outline" className="font-display font-semibold rounded-full px-7 border-primary/30 text-primary hover:bg-primary/5">
                            <Utensils className="w-4 h-4 mr-2" /> Ver Carta
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Info */}
      <section className="py-14 bg-white border-t border-border/40">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Ubicación</h3>
              <p className="text-muted-foreground font-display text-sm">Los Ángeles de San Rafael, Segovia · A 45 min de Madrid</p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Phone className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Reservas telefónicas</h3>
              <a href="tel:+34930347791" className="text-accent font-display font-semibold hover:underline">+34 930 34 77 91</a>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Horario general</h3>
              <p className="text-muted-foreground font-display text-sm">Abierto todos los días · 10:00–23:00</p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
