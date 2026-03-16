import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Leaf, Droplets, Sparkles } from "lucide-react";

const CDN = {
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  lago: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
};

const tratamientos = [
  {
    icon: <Droplets className="w-6 h-6" />,
    nombre: "Circuito de Aguas",
    desc: "Jacuzzi, piscina de contrastes, sauna finlandesa y baño turco. Relax total en 90 minutos.",
    precio: "35€/persona",
    duracion: "90 min",
  },
  {
    icon: <Leaf className="w-6 h-6" />,
    nombre: "Masaje Relajante",
    desc: "Masaje de cuerpo completo con aceites esenciales naturales. Libera tensiones y recarga energía.",
    precio: "55€",
    duracion: "60 min",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    nombre: "Ritual Náyade",
    desc: "Exfoliación corporal + envoltura de barro + masaje relajante. La experiencia SPA completa.",
    precio: "95€",
    duracion: "120 min",
  },
  {
    icon: <Droplets className="w-6 h-6" />,
    nombre: "Masaje de Piedras Calientes",
    desc: "Técnica de termoterapia con piedras volcánicas. Profunda relajación muscular y mental.",
    precio: "70€",
    duracion: "75 min",
  },
  {
    icon: <Leaf className="w-6 h-6" />,
    nombre: "Facial Revitalizante",
    desc: "Tratamiento facial personalizado con productos naturales. Piel luminosa y revitalizada.",
    precio: "50€",
    duracion: "50 min",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    nombre: "Pack Pareja",
    desc: "Circuito de aguas + masaje en pareja + copa de cava. La escapada romántica perfecta.",
    precio: "150€/pareja",
    duracion: "150 min",
  },
];

export default function Spa() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[60vh] min-h-[420px] overflow-hidden">
        <img src={CDN.hero} alt="SPA Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Bienestar & Relax
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                SPA Náyade
              </h1>
              <p className="text-xl text-white/85 font-display mb-6">
                Un oasis de bienestar frente al lago. Circuito de aguas, masajes y tratamientos para reconectar contigo mismo.
              </p>
              <Link href="/presupuesto">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8 shadow-lg">
                  Reservar Tratamiento <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              <img src={CDN.lago} alt="SPA con vistas al lago" className="w-full h-[420px] object-cover" />
            </div>
            <div>
              <span className="text-accent font-display font-semibold text-sm uppercase tracking-widest">Tu momento de paz</span>
              <h2 className="text-4xl font-heading font-bold text-foreground mt-2 mb-5">
                Bienestar en plena naturaleza
              </h2>
              <p className="text-muted-foreground font-display text-lg leading-relaxed mb-5">
                El SPA Náyade es un espacio de bienestar diseñado para ofrecerte la máxima relajación en un entorno natural único. Situado a orillas del embalse de Los Ángeles de San Rafael, combina las propiedades terapéuticas del agua con tratamientos de belleza y bienestar de primer nivel.
              </p>
              <p className="text-muted-foreground font-display leading-relaxed mb-8">
                Nuestro equipo de terapeutas especializados te guiará en una experiencia personalizada, adaptada a tus necesidades. Desde el circuito de aguas hasta rituales completos de bienestar, cada visita al SPA Náyade es un viaje hacia el equilibrio interior.
              </p>
              <div className="grid grid-cols-3 gap-4 mb-8">
                {[
                  { label: "Jacuzzi", icon: "🌊" },
                  { label: "Sauna", icon: "🔥" },
                  { label: "Baño turco", icon: "💨" },
                  { label: "Piscina fría", icon: "❄️" },
                  { label: "Sala relax", icon: "🧘" },
                  { label: "Vestuarios", icon: "✨" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 bg-muted/50 rounded-xl p-3 text-center">
                    <span className="text-2xl">{item.icon}</span>
                    <span className="text-xs font-display text-foreground/70">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tratamientos */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-heading font-bold text-foreground mb-3">
              Nuestros <span className="text-accent">Tratamientos</span>
            </h2>
            <p className="text-muted-foreground font-display text-lg max-w-xl mx-auto">
              Desde el circuito de aguas hasta rituales completos. Todos nuestros tratamientos utilizan productos naturales de primera calidad.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tratamientos.map((t, i) => (
              <div key={i} className="bg-card rounded-2xl p-6 shadow-md border border-border/40 hover:shadow-lg transition-all hover:-translate-y-0.5 duration-300">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent mb-4">
                  {t.icon}
                </div>
                <h3 className="font-heading font-bold text-foreground text-lg mb-2">{t.nombre}</h3>
                <p className="text-muted-foreground font-display text-sm leading-relaxed mb-4">{t.desc}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xl font-heading font-bold text-accent">{t.precio}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground font-display mt-0.5">
                      <Clock className="w-3.5 h-3.5" />{t.duracion}
                    </div>
                  </div>
                  <Link href="/presupuesto">
                    <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-4">
                      Reservar
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary text-white">
        <div className="container text-center">
          <h2 className="text-3xl font-heading font-bold mb-3">Regala bienestar</h2>
          <p className="text-white/80 font-display text-lg mb-8 max-w-xl mx-auto">
            Los bonos regalo del SPA Náyade son el detalle perfecto para cualquier ocasión. Cumpleaños, aniversarios, San Valentín…
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/presupuesto">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-10 shadow-lg">
                Reservar Tratamiento <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="tel:+34919041947">
              <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 font-display font-semibold rounded-full px-10 bg-transparent">
                +34 919 041 947
              </Button>
            </a>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
