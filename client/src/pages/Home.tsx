import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Waves, MapPin, Star, Clock, Users, ChevronRight, ChevronLeft,
  ArrowRight, Phone, Mail, Anchor, Wind, Zap, Heart, Shield, Calendar
} from "lucide-react";
import PublicLayout from "@/components/PublicLayout";

// CDN images
const CDN = {
  hero1: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  hero2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg",
  hero3: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  hotel: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  blob: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg",
  banana: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/banana-ski_43cb68d6.jpg",
  paddle: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/paddle-surf_78ab1b6f.jpg",
};

const heroSlides: Array<{ img: string; badge: string; title: string; subtitle: string; desc: string; cta: string; ctaLink: string; reserveUrl: string }> = [
  {
    img: CDN.hero1,
    badge: "Temporada Abril — Octubre 2026",
    title: "El Lago te Espera",
    subtitle: "A solo 45 minutos de Madrid",
    desc: "Deportes acuáticos, hotel premium y gastronomía en el embalse de Los Ángeles de San Rafael, Segovia.",
    cta: "Explorar Experiencias",
    ctaLink: "/experiencias",
    reserveUrl: "",
  },
  {
    img: CDN.hero2,
    badge: "Actividad Estrella",
    title: "Cableski & Wakeboard",
    subtitle: "Para todos los niveles",
    desc: "Practica wakeboard y esquí acuático en nuestro sistema de cable aéreo. Material y chaleco incluidos.",
    cta: "Reservar Ahora",
    ctaLink: "/experiencias/cableski-wakeboard",
    reserveUrl: "/experiencias/cableski-wakeboard",
  },
  {
    img: CDN.hero3,
    badge: "Grupos y Familias",
    title: "Aventura en Grupo",
    subtitle: "Canoas, Kayaks y más",
    desc: "Rutas guiadas por el embalse, actividades para todas las edades y packs personalizados para grupos.",
    cta: "Ver Packs",
    ctaLink: "/packs",
    reserveUrl: "",
  },
];

const actividades = [
  { icon: "🚤", name: "Banana Ski", desc: "La más divertida para grupos", price: "15€/plaza", img: CDN.banana, slug: "banana-ski-donuts", badge: "Más Popular" },
  { icon: "🏄", name: "Cableski", desc: "Wakeboard sin embarcación", price: "35€ media jornada", img: CDN.hero2, slug: "cableski-wakeboard", badge: "Actividad Estrella" },
  { icon: "💥", name: "Blob Jump", desc: "Adrenalina pura en el lago", price: "6,50€/salto", img: CDN.blob, slug: "blob-jump", badge: "" },
  { icon: "🛶", name: "Canoas & Kayaks", desc: "Ruta guiada por el embalse", price: "25€/hora", img: CDN.canoa, slug: "canoas-kayaks", badge: "" },
  { icon: "🏄‍♀️", name: "Paddle Surf", desc: "Equilibrio sobre el agua", price: "20€/hora", img: CDN.paddle, slug: "paddle-surf", badge: "" },
  { icon: "🚢", name: "Paseos en Barco", desc: "Descubre el embalse", price: "Desde 110€/hora", img: CDN.hero1, slug: "paseos-barco", badge: "Premium" },
];

const packs = [
  {
    name: "Day Pass Náyade",
    price: "19€",
    unit: "por persona",
    color: "bg-secondary text-secondary-foreground",
    items: ["Acceso a piscinas del club", "Zona de playa del lago", "Hamacas y chill out", "Acceso a bares y restaurantes"],
    slug: "day-pass-nayade",
    highlight: false,
  },
  {
    name: "Pack Discovery",
    price: "39€",
    unit: "por persona",
    color: "bg-primary text-primary-foreground",
    items: ["Ruta en canoas o paddle surf (1h)", "Banana Ski (20 min)", "Castillos hinchables acuáticos", "Acceso a piscina"],
    slug: "pack-discovery",
    highlight: false,
  },
  {
    name: "Pack Aventura ★",
    price: "55€",
    unit: "por persona",
    color: "bg-accent text-accent-foreground",
    items: ["Todo lo del Pack Discovery", "Blob Jump — 5 saltos", "Acceso a piscina todo el día", "Descuento 10% reserva online"],
    slug: "pack-aventura",
    highlight: true,
  },
  {
    name: "Pack Adrenalina",
    price: "69€",
    unit: "por persona",
    color: "bg-primary text-primary-foreground",
    items: ["Canoas + Banana Ski + Blob Jump", "Sesión de Cableski", "Castillos hinchables", "Acceso a piscina"],
    slug: "pack-adrenalina",
    highlight: false,
  },
  {
    name: "Pack Lago Gourmet",
    price: "79€",
    unit: "por persona",
    color: "bg-secondary text-secondary-foreground",
    items: ["Actividades acuáticas completas", "Blob Jump 5 saltos", "Paella en Arrocería La Cabaña", "Acceso a piscina"],
    slug: "pack-lago-gourmet",
    highlight: false,
  },
  {
    name: "Pack Cableski Experience",
    price: "89€",
    unit: "por persona",
    color: "bg-lago-dark text-white",
    items: ["Cableski jornada completa", "Equipamiento completo incluido", "Paella en Arrocería La Cabaña", "Zona de descanso junto al lago"],
    slug: "pack-cableski-experience",
    highlight: false,
  },
];

const habitaciones = [
  { tipo: "Doble Estándar", precio: "130€", rango: "110€ – 150€ / noche", icono: "🛏️", desc: "Confort y vistas al entorno natural" },
  { tipo: "Doble Superior / Vistas Lago", precio: "160€", rango: "140€ – 180€ / noche", icono: "🌊", desc: "Vistas directas al embalse" },
  { tipo: "Familiar (3-4 personas)", precio: "195€", rango: "170€ – 220€ / noche", icono: "👨‍👩‍👧‍👦", desc: "Espacio para toda la familia" },
  { tipo: "Junior Suite Premium", precio: "235€", rango: "210€ – 260€ / noche", icono: "⭐", desc: "Máximo confort y exclusividad" },
];

const restaurantes = [
  { nombre: "Restaurante El Galeón", tipo: "Desayunos & Cocina Regional", desc: "Ambientación pirata única. Desayunos buffet y cocina regional ideal para familias.", emoji: "⚓", reserva: true },
  { nombre: "La Cabaña del Lago", tipo: "Pizzería & Cocina Italiana", desc: "Auténtica pizzería y cocina italiana en un entorno relajado junto al agua.", emoji: "🍕", reserva: true },
  { nombre: "Nassau Bar & Music", tipo: "Cócteles & Hamburguesas Gourmet", desc: "Terraza chill-out, hamburguesas gourmet, cócteles y música en vivo.", emoji: "🍹", reserva: true },
  { nombre: "Arrocería La Cabaña", tipo: "Arroces & Cocina Mediterránea", desc: "Nuevo espacio especializado en arroces y cocina mediterránea. Próximamente.", emoji: "🥘", reserva: false },
];

const razones = [
  { icon: <MapPin className="w-6 h-6" />, titulo: "A 45 min de Madrid", desc: "Acceso directo por la AP-6" },
  { icon: <Waves className="w-6 h-6" />, titulo: "+10 Actividades", desc: "El mayor catálogo acuático de la Sierra" },
  { icon: <Heart className="w-6 h-6" />, titulo: "Hotel + SPA + Lago", desc: "Todo en un mismo enclave" },
  { icon: <Wind className="w-6 h-6" />, titulo: "Entorno Natural Único", desc: "Sierra de Guadarrama a 1.200m" },
  { icon: <Users className="w-6 h-6" />, titulo: "Para Todos", desc: "Familias, parejas, grupos y empresas" },
  { icon: <Shield className="w-6 h-6" />, titulo: "Monitores Certificados", desc: "Seguridad y profesionalidad" },
  { icon: <Calendar className="w-6 h-6" />, titulo: "Reserva Online 24h", desc: "Descuento del 10% online" },
  { icon: <Zap className="w-6 h-6" />, titulo: "Packs Personalizados", desc: "A medida para cada grupo" },
];

const testimonios = [
  { texto: "Una experiencia increíble para toda la familia. Los niños no paraban de hablar del Blob Jump durante semanas. El hotel es precioso y el personal muy atento.", autor: "María G.", tipo: "Familia · Madrid", stars: 5 },
  { texto: "Organizamos el team building de empresa aquí y fue un éxito total. Las actividades de cableski y la gymkhana acuática superaron todas las expectativas del equipo.", autor: "Carlos M.", tipo: "Empresa · Barcelona", stars: 5 },
  { texto: "El fin de semana romántico fue perfecto. Actividades de día, spa por la tarde y cena con vistas al lago. No podíamos pedir más. Volveremos sin duda.", autor: "Laura & Javi", tipo: "Pareja · Segovia", stars: 5 },
];

export default function Home() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const { data: featuredExperiences } = trpc.public.getFeaturedExperiences.useQuery();
  const { data: slideshowItemsRaw } = trpc.public.getSlideshowItems.useQuery();
  const { data: homeExperiences } = trpc.homeModules.getModule.useQuery({ moduleKey: "experiences_featured" });
  const { data: homePacks } = trpc.homeModules.getModule.useQuery({ moduleKey: "packs_day" });
  // Use DB slides if available, otherwise fall back to hardcoded
  const activeSlides = slideshowItemsRaw && slideshowItemsRaw.length > 0
    ? slideshowItemsRaw.map((s: any) => ({
        img: s.imageUrl,
        badge: s.badge ?? "",
        title: s.title ?? "",
        subtitle: s.subtitle ?? "",
        desc: s.description ?? "",
        cta: s.ctaText ?? "",
        ctaLink: s.ctaUrl ?? "/experiencias",
        reserveUrl: s.reserveUrl ?? "",
      }))
    : heroSlides;
  // Auto-advance slideshow
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % activeSlides.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [activeSlides.length]);
  const slide = activeSlides[Math.min(currentSlide, activeSlides.length - 1)];

  return (
    <PublicLayout>
      {/* ─── HERO SLIDESHOW ─────────────────────────────────────────── */}
      <section className="relative h-[92vh] min-h-[600px] overflow-hidden">
        {activeSlides.map((s, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-opacity duration-1000 ${i === currentSlide ? "opacity-100" : "opacity-0"}`}
          >
            <img src={s.img} alt={s.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-hero-gradient" />
          </div>
        ))}

        {/* Contenido hero */}
        <div className="relative z-10 h-full flex items-center">
          <div className="container">
            <div className="max-w-2xl">
              <Badge className="mb-4 bg-accent/90 text-accent-foreground border-0 font-display text-xs uppercase tracking-widest px-4 py-1.5">
                <Anchor className="w-3 h-3 mr-1.5" />
                {slide.badge}
              </Badge>
              <h1 className="text-5xl md:text-7xl font-heading font-bold text-white leading-tight mb-3">
                {slide.title}
              </h1>
              <p className="text-xl md:text-2xl text-white/80 font-display font-medium mb-3">
                {slide.subtitle}
              </p>
              <p className="text-base md:text-lg text-white/70 mb-8 max-w-lg leading-relaxed">
                {slide.desc}
              </p>
              <div className="flex flex-wrap gap-3">
                {slide.reserveUrl && (
                  <Link href={slide.reserveUrl}>
                    <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-8 text-base shadow-lg">
                      Reservar Ahora <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}
                {slide.cta && slide.ctaLink && (
                  <Link href={slide.ctaLink}>
                    <Button size="lg" className={slide.reserveUrl ? "border-white/50 text-white hover:bg-white/15 font-display font-semibold rounded-full px-8 text-base bg-transparent border" : "bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-8 text-base shadow-lg"}>
                      {slide.cta} <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}
                <Link href="/presupuesto">
                  <Button size="lg" variant="outline" className="border-white/50 text-white hover:bg-white/15 font-display font-semibold rounded-full px-8 text-base bg-transparent">
                    Solicitar Presupuesto
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Controles slideshow */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3">
          <button onClick={() => setCurrentSlide((p) => (p - 1 + activeSlides.length) % activeSlides.length)}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all">
            <ChevronLeft className="w-4 h-4" />
          </button>
          {activeSlides.map((_, i) => (
            <button key={i} onClick={() => setCurrentSlide(i)}
              className={`rounded-full transition-all duration-300 ${i === currentSlide ? "w-8 h-2.5 bg-accent" : "w-2.5 h-2.5 bg-white/40 hover:bg-white/70"}`} />
          ))}
          <button onClick={() => setCurrentSlide((p) => (p + 1) % activeSlides.length)}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Info rápida */}
        <div className="absolute bottom-0 left-0 right-0 z-10">
          <div className="container">
            <div className="grid grid-cols-3 md:grid-cols-3 gap-px bg-white/10 rounded-t-2xl overflow-hidden backdrop-blur-sm">
              {[
                { icon: <MapPin className="w-4 h-4" />, label: "Los Ángeles de San Rafael, Segovia" },
                { icon: <Clock className="w-4 h-4" />, label: "Abierto Lun–Dom · 10:00–20:00" },
                { icon: <Phone className="w-4 h-4" />, label: "+34 919 041 947" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-3 bg-white/10 text-white/90 text-sm">
                  <span className="text-accent">{item.icon}</span>
                  <span className="hidden sm:inline font-display text-xs">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── ACTIVIDADES ACUÁTICAS ──────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-secondary text-secondary-foreground border-0 font-display text-xs uppercase tracking-widest">
              <Waves className="w-3 h-3 mr-1.5" /> Temporada 2026
            </Badge>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-4">
              Nuestras <span className="text-gradient-lago">Experiencias</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Más de 10 actividades acuáticas diseñadas para todos los públicos en el embalse de Los Ángeles de San Rafael
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(homeExperiences && homeExperiences.length > 0 ? homeExperiences : actividades.map((a) => ({
              experienceId: 0,
              slug: a.slug,
              title: a.name,
              shortDescription: a.desc,
              basePrice: a.price,
              currency: "",
              image1: a.img,
              difficulty: null,
              isFeatured: false,
              isActive: true,
            }))).map((act: any) => (
              <Link key={act.slug} href={`/experiencias/${act.slug}`}>
                <div className="group relative bg-card rounded-2xl overflow-hidden shadow-sm border border-border card-hover cursor-pointer">
                  <div className="relative h-52 overflow-hidden">
                    <img
                      src={act.image1 || CDN.hero1}
                      alt={act.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 overlay-lago" />
                    {act.isFeatured && (
                      <Badge className="absolute top-3 left-3 bg-accent text-accent-foreground border-0 text-xs font-display">
                        Destacado
                      </Badge>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-display font-bold text-lg text-foreground">{act.title}</h3>
                      <span className="text-accent font-display font-bold text-sm whitespace-nowrap ml-2">
                        {act.currency ? `${act.basePrice}€` : act.basePrice}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-sm mb-3">{act.shortDescription}</p>
                    <div className="flex items-center text-primary text-sm font-display font-medium group-hover:gap-2 transition-all">
                      Ver detalles <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link href="/experiencias">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-display font-semibold rounded-full px-10">
                Ver Todas las Experiencias <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── PACKS DE DÍA ───────────────────────────────────────────── */}
      <section className="py-20 bg-lago-light">
        <div className="container">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-primary/10 text-primary border-0 font-display text-xs uppercase tracking-widest">
              Visita de Día · Abril — Octubre
            </Badge>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-4">
              Packs de <span className="text-gradient-sol">Día Completo</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Elige tu combinación perfecta. Reserva online y obtén un <strong>10% de descuento</strong>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {packs.map((pack) => (
              <Link key={pack.slug} href={`/packs/${pack.slug}`}>
                <div className={`relative rounded-2xl overflow-hidden card-hover cursor-pointer border-2 ${pack.highlight ? "border-accent shadow-lg scale-[1.02]" : "border-transparent shadow-sm"}`}>
                  {pack.highlight && (
                    <div className="absolute top-0 left-0 right-0 bg-accent text-accent-foreground text-center text-xs font-display font-bold py-1.5 uppercase tracking-widest">
                      ★ Más Popular
                    </div>
                  )}
                  <div className={`p-6 ${pack.highlight ? "pt-10" : ""} ${pack.color}`}>
                    <h3 className="font-heading font-bold text-xl mb-1">{pack.name}</h3>
                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-4xl font-display font-extrabold">{pack.price}</span>
                      <span className="text-sm opacity-80">{pack.unit}</span>
                    </div>
                    <ul className="space-y-2">
                      {pack.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm opacity-90">
                          <span className="mt-0.5 flex-shrink-0">✓</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 pt-4 border-t border-current/20">
                      <span className="font-display font-semibold text-sm flex items-center gap-1">
                        Reservar ahora <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOTEL NÁYADE ───────────────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="relative">
              <div className="rounded-3xl overflow-hidden shadow-xl">
                <img src={CDN.hotel} alt="Hotel Náyade" className="w-full h-[480px] object-cover" />
              </div>
              <div className="absolute -bottom-6 -right-6 bg-accent text-accent-foreground rounded-2xl p-5 shadow-lg hidden md:block">
                <div className="text-3xl font-heading font-bold">★★★</div>
                <div className="font-display text-sm font-semibold">Hotel Náyade</div>
                <div className="font-display text-xs opacity-80">117 habitaciones</div>
              </div>
            </div>
            <div>
              <Badge className="mb-4 bg-secondary text-secondary-foreground border-0 font-display text-xs uppercase tracking-widest">
                Alojamiento Premium
              </Badge>
              <h2 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-4">
                Hotel <span className="text-gradient-lago">Náyade</span>
              </h2>
              <p className="text-muted-foreground text-lg mb-6 leading-relaxed">
                Ubicado frente al embalse en el complejo Los Ángeles de San Rafael. Un refugio de confort diseñado para descansar tras un día de aventura, combinando servicios de calidad con un entorno natural inigualable.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-8">
                {habitaciones.map((hab) => (
                  <div key={hab.tipo} className="bg-muted rounded-xl p-4 border border-border">
                    <div className="text-2xl mb-1">{hab.icono}</div>
                    <div className="font-display font-bold text-sm text-foreground mb-0.5">{hab.tipo}</div>
                    <div className="text-accent font-display font-bold text-lg">{hab.precio}€</div>
                    <div className="text-muted-foreground text-xs">{hab.rango}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Link href="/hotel">
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-display font-semibold rounded-full px-8">
                    Ver Habitaciones <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <Link href="/presupuesto">
                  <Button size="lg" variant="outline" className="border-primary text-primary hover:bg-primary/5 font-display font-semibold rounded-full px-8">
                    Solicitar Precio
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SPA ────────────────────────────────────────────────────── */}
      <section className="py-20 bg-lago-dark text-white">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="mb-4 bg-white/15 text-white border-0 font-display text-xs uppercase tracking-widest">
                Bienestar & Relax
              </Badge>
              <h2 className="text-4xl md:text-5xl font-heading font-bold text-white mb-4">
                SPA <span className="text-accent">Náyade</span>
              </h2>
              <p className="text-white/70 text-lg mb-8 leading-relaxed">
                Un santuario de paz donde el cuerpo recupera su equilibrio. Disfruta de nuestras instalaciones termales y tratamientos exclusivos con vistas al lago.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-8">
                {[
                  { label: "Circuito SPA", precio: "25€/persona", desc: "Piscinas termales + chorros" },
                  { label: "Pack Pareja", precio: "40€/2 pax", desc: "Experiencia romántica" },
                  { label: "Huéspedes Hotel", precio: "20€/persona", desc: "Precio especial hotel" },
                  { label: "Niños (<12 años)", precio: "10€", desc: "Diversión en familia" },
                ].map((item) => (
                  <div key={item.label} className="bg-white/10 rounded-xl p-4 border border-white/15">
                    <div className="font-display font-bold text-white text-sm mb-0.5">{item.label}</div>
                    <div className="text-accent font-display font-bold text-xl">{item.precio}</div>
                    <div className="text-white/60 text-xs">{item.desc}</div>
                  </div>
                ))}
              </div>
              <Link href="/spa">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-8">
                  Reservar SPA <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { emoji: "🌊", titulo: "Circuito Hidrotermal", desc: "Piscinas a diferentes temperaturas, chorros cervicales y lumbares" },
                { emoji: "🧖", titulo: "Masajes", desc: "Relajantes, deportivos y descontracturantes con terapeutas certificados" },
                { emoji: "🧖‍♀️", titulo: "Zona Wellness", desc: "Sauna finlandesa, baño turco y duchas de contrastes" },
                { emoji: "✨", titulo: "Clinic SPA", desc: "Tratamientos faciales y corporales de última generación" },
              ].map((item) => (
                <div key={item.titulo} className="bg-white/8 rounded-2xl p-5 border border-white/12">
                  <div className="text-3xl mb-3">{item.emoji}</div>
                  <h4 className="font-display font-bold text-white text-sm mb-1">{item.titulo}</h4>
                  <p className="text-white/60 text-xs leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── RESTAURANTES ───────────────────────────────────────────── */}
      <section className="py-20 bg-arena">
        <div className="container">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-accent/15 text-accent border-0 font-display text-xs uppercase tracking-widest">
              Gastronomía
            </Badge>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-4">
              Sabores del <span className="text-gradient-sol">Lago</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Desde desayunos con vistas hasta cenas temáticas. Cocina internacional y sabores locales en espacios únicos
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {restaurantes.map((rest) => (
              <div key={rest.nombre} className="bg-card rounded-2xl p-6 border border-border shadow-sm card-hover">
                <div className="text-4xl mb-4">{rest.emoji}</div>
                <h3 className="font-heading font-bold text-lg text-foreground mb-1">{rest.nombre}</h3>
                <p className="text-accent font-display text-xs font-semibold uppercase tracking-wide mb-3">{rest.tipo}</p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">{rest.desc}</p>
                {rest.reserva ? (
                  <Link href={`/restaurantes/${rest.nombre.toLowerCase().replace(/\s+/g, '-')}`}>
                    <Button size="sm" className="w-full bg-primary/10 hover:bg-primary/20 text-primary font-display font-semibold rounded-full border-0">
                      <Calendar className="w-3.5 h-3.5 mr-1.5" /> Reservar Mesa
                    </Button>
                  </Link>
                ) : (
                  <Badge className="bg-muted text-muted-foreground border-0 font-display text-xs">Próximamente</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── POR QUÉ NAYADE ─────────────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-4">
              10 Razones para <span className="text-gradient-lago">Elegirnos</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {razones.map((r, i) => (
              <div key={i} className="text-center p-6 rounded-2xl bg-muted border border-border hover:border-primary/30 hover:bg-secondary/30 transition-all duration-200">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-3">
                  {r.icon}
                </div>
                <h4 className="font-display font-bold text-sm text-foreground mb-1">{r.titulo}</h4>
                <p className="text-muted-foreground text-xs">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIOS ────────────────────────────────────────────── */}
      <section className="py-20 bg-lago-light">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-heading font-bold text-foreground mb-3">
              Lo que Dicen <span className="text-gradient-lago">Nuestros Clientes</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonios.map((t, i) => (
              <div key={i} className="bg-card rounded-2xl p-7 border border-border shadow-sm">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-accent text-accent" />
                  ))}
                </div>
                <p className="text-foreground/80 text-sm leading-relaxed mb-5 italic">"{t.texto}"</p>
                <div>
                  <div className="font-display font-bold text-foreground text-sm">{t.autor}</div>
                  <div className="text-muted-foreground text-xs">{t.tipo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA FINAL ──────────────────────────────────────────────── */}
      <section className="py-24 bg-lago-dark text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img src={CDN.hero1} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="relative z-10 container text-center">
          <Anchor className="w-12 h-12 text-accent mx-auto mb-6 animate-wave" />
          <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
            ¿Listo para Vivir<br />la <span className="text-accent">Aventura</span>?
          </h2>
          <p className="text-white/70 text-xl mb-10 max-w-xl mx-auto">
            Reserva online con un 10% de descuento. Temporada Abril — Octubre 2026.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/experiencias">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-10 text-base shadow-lg">
                Explorar Experiencias <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link href="/presupuesto">
              <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/15 font-display font-semibold rounded-full px-10 text-base bg-transparent">
                Solicitar Presupuesto
              </Button>
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-8 text-white/60 text-sm font-display">
            <span className="flex items-center gap-2"><Phone className="w-4 h-4 text-accent" /> +34 919 041 947</span>
            <span className="flex items-center gap-2"><Mail className="w-4 h-4 text-accent" /> hola@nayadeexperiences.es</span>
            <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-accent" /> Los Ángeles de San Rafael, Segovia</span>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
