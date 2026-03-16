import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, MapPin, Phone } from "lucide-react";

const CDN = {
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  lago: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  kayak: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
};

const restaurantes = [
  {
    slug: "el-galeon",
    nombre: "El Galeón",
    tipo: "Cocina Tradicional & Parrilla",
    desc: "Nuestro restaurante principal con vistas panorámicas al embalse. Especializado en carnes a la parrilla, pescados frescos y cocina tradicional castellana. El lugar perfecto para celebrar ocasiones especiales.",
    img: CDN.lago,
    horario: "13:00–16:00 y 20:00–23:00",
    reserva: true,
    badge: "Vistas al lago",
    emoji: "⚓",
    especialidad: "Carnes a la parrilla · Pescados frescos · Cocina castellana",
  },
  {
    slug: "la-cabana",
    nombre: "Arrocería La Cabaña",
    tipo: "Arroces & Cocina Mediterránea",
    desc: "Nuevo espacio especializado en arroces y cocina mediterránea de autor. Un ambiente íntimo y acogedor junto al lago, perfecto para disfrutar de una gastronomía cuidada con los mejores ingredientes de temporada.",
    img: CDN.canoa,
    horario: "13:00–16:30",
    reserva: true,
    badge: "Nuevo",
    emoji: "🥘",
    especialidad: "Arroces · Cocina mediterránea · Producto de temporada",
  },
  {
    slug: "nassau-bar",
    nombre: "Nassau Bar & Music",
    tipo: "Cócteles, Tapas & Música en Vivo",
    desc: "El punto de encuentro del resort. Cócteles artesanales, tapas creativas y música en vivo los fines de semana. El lugar ideal para el aperitivo, el after-beach o simplemente disfrutar del atardecer sobre el lago.",
    img: CDN.kayak,
    horario: "11:00–02:00 (fines de semana hasta 03:00)",
    reserva: false,
    badge: "Música en vivo",
    emoji: "🎵",
    especialidad: "Cócteles artesanales · Tapas creativas · Música en vivo",
  },
];

export default function Restaurantes() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img src={CDN.hero} alt="Restaurantes Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Gastronomía & Ocio
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Restaurantes Náyade
              </h1>
              <p className="text-xl text-white/85 font-display">
                Tres espacios únicos para cada momento del día. Gastronomía de calidad con las mejores vistas al embalse.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Restaurantes */}
      <section className="py-20 bg-background">
        <div className="container space-y-16">
          {restaurantes.map((r, i) => (
            <div key={r.slug} className={`grid lg:grid-cols-2 gap-12 items-center ${i % 2 === 1 ? "lg:grid-flow-dense" : ""}`}>
              <div className={`rounded-2xl overflow-hidden shadow-xl ${i % 2 === 1 ? "lg:col-start-2" : ""}`}>
                <img src={r.img} alt={r.nombre} className="w-full h-[380px] object-cover hover:scale-105 transition-transform duration-500" />
              </div>
              <div className={i % 2 === 1 ? "lg:col-start-1 lg:row-start-1" : ""}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{r.emoji}</span>
                  <span className="bg-accent/10 text-accent text-xs font-display font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                    {r.badge}
                  </span>
                </div>
                <h2 className="text-3xl font-heading font-bold text-foreground mb-1">{r.nombre}</h2>
                <p className="text-accent font-display font-semibold mb-4">{r.tipo}</p>
                <p className="text-muted-foreground font-display text-lg leading-relaxed mb-4">{r.desc}</p>
                <p className="text-sm text-muted-foreground font-display italic mb-6">{r.especialidad}</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-display mb-6">
                  <Clock className="w-4 h-4 text-accent shrink-0" />
                  <span>{r.horario}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {r.reserva && (
                    <Link href="/presupuesto">
                      <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-7">
                        Reservar Mesa <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  )}
                  <Link href={`/restaurantes/${r.slug}`}>
                    <Button variant="outline" className="font-display font-semibold rounded-full px-7 border-primary/30 text-primary hover:bg-primary/5">
                      Ver Carta
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Info */}
      <section className="py-14 bg-muted/30 border-t border-border/40">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <MapPin className="w-6 h-6 text-accent" />
              <h3 className="font-heading font-bold text-foreground">Ubicación</h3>
              <p className="text-muted-foreground font-display text-sm">Los Ángeles de San Rafael, Segovia · A 45 min de Madrid</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Phone className="w-6 h-6 text-accent" />
              <h3 className="font-heading font-bold text-foreground">Reservas</h3>
              <a href="tel:+34919041947" className="text-accent font-display font-semibold hover:underline">+34 919 041 947</a>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Clock className="w-6 h-6 text-accent" />
              <h3 className="font-heading font-bold text-foreground">Horario general</h3>
              <p className="text-muted-foreground font-display text-sm">Lunes a Domingo · 10:00–23:00</p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
