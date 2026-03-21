import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Waves, MapPin, Star, Clock, Users, ChevronRight, ChevronLeft,
  ArrowRight, Phone, Mail, Anchor, Wind, Zap, Heart, Shield, Calendar
} from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import BookingModal from "@/components/BookingModal";
import HotelSearchBar, { type HotelSearchParams } from "@/components/HotelSearchBar";

// CDN images
const CDN = {
  hero1: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  hero2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg",
  hero3: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  hotel: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/d049863d-3421-411f-a64f-64eb34408da9_145ab8b4.png",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  blob: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg",
  banana: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/banana-ski_43cb68d6.jpg",
  paddle: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/paddle-surf_78ab1b6f.jpg",
  spa1: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa4_0e502ffb.png",
  spa2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa2_f1c857bc.png",
  wakeboard: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/wakeboard_b574701d.jpg",
  hinchable: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/aventura_hinchable_7c004251.png",
  kayak2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/31bc24b6-13c3-4ea1-a67f-16a927473c61_d7582ff1.png",
  tubing: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/060194d5-9574-409c-b5a1-a367eb93bc7f_49e240ae.png",
  barco: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/28d8f7b8-1454-4060-b6de-0a399da63a69_4e751661.png",
  panoramica: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/5f23cf10-be16-424a-a48f-031f5b74e35f_843d3fb3.png",
  cableski2: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/Cableski_ce1b5e0c.png",
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
  { tipo: "Doble Estándar", precio: "130€", rango: "110€ – 150€ / noche", iconSvg: "bed", desc: "Confort y vistas al entorno natural" },
  { tipo: "Doble Superior / Vistas Lago", precio: "160€", rango: "140€ – 180€ / noche", iconSvg: "waves", desc: "Vistas directas al embalse" },
  { tipo: "Familiar (3-4 personas)", precio: "195€", rango: "170€ – 220€ / noche", iconSvg: "users", desc: "Espacio para toda la familia" },
  { tipo: "Junior Suite Premium", precio: "235€", rango: "210€ – 260€ / noche", iconSvg: "star", desc: "Máximo confort y exclusividad" },
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
  const [, navigate] = useLocation();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [bookingProduct, setBookingProduct] = useState<{ id: number; title: string; basePrice: string | number; image1?: string } | null>(null);

  function todayStr() { return new Date().toISOString().split("T")[0]; }
  function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; }

  const [hotelSearch, setHotelSearch] = useState<HotelSearchParams>({
    checkIn: todayStr(),
    checkOut: tomorrowStr(),
    adults: 2,
    children: 0,
    childrenAges: [],
  });

  function handleHotelSearch() {
    const { checkIn, checkOut, adults, children, childrenAges } = hotelSearch;
    navigate(`/hotel?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=${children}&childrenAges=${childrenAges.join(",")}`);
  }
  const { data: featuredExperiences } = trpc.public.getFeaturedExperiences.useQuery();
  const { data: slideshowItemsRaw } = trpc.public.getSlideshowItems.useQuery();
  const { data: homeExperiences } = trpc.homeModules.getModule.useQuery({ moduleKey: "experiences_featured" });
  const { data: homePacks } = trpc.homeModules.getModule.useQuery({ moduleKey: "packs_day" });
  const restaurantsQuery = trpc.restaurants.getAll.useQuery();

  function isRestaurantOpenNow(shifts: Array<{ startTime: string; endTime: string; daysOfWeek?: number[] }> | undefined): boolean {
    if (!shifts || shifts.length === 0) return false;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return shifts.some((shift) => {
      const days = shift.daysOfWeek ?? [0,1,2,3,4,5,6];
      if (!days.includes(dayOfWeek)) return false;
      const [sh, sm] = shift.startTime.split(":").map(Number);
      const [eh, em] = shift.endTime.split(":").map(Number);
      return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em;
    });
  }

  function getNextShift(shifts: Array<{ name: string; startTime: string; endTime: string }> | undefined): string {
    if (!shifts || shifts.length === 0) return "";
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = shifts
      .map((s) => { const [h, m] = s.startTime.split(":").map(Number); return { ...s, startMin: h * 60 + m }; })
      .filter((s) => s.startMin > currentMinutes)
      .sort((a, b) => a.startMin - b.startMin);
    return upcoming.length > 0 ? `Abre a las ${upcoming[0].startTime}` : "";
  }
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
                { icon: <Phone className="w-4 h-4" />, label: "+34 930 34 77 91" },
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
              <div key={act.slug} className="group relative bg-card rounded-2xl overflow-hidden shadow-sm border border-border card-hover">
                <Link href={`/experiencias/${act.slug}`}>
                  <div className="relative h-52 overflow-hidden cursor-pointer">
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
                </Link>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-display font-bold text-lg text-foreground">{act.title}</h3>
                    <span className="text-accent font-display font-bold text-sm whitespace-nowrap ml-2">
                      {act.currency ? `${act.basePrice}€` : act.basePrice}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-4">{act.shortDescription}</p>
                  <div className="flex items-center gap-3">
                    <Link href={`/experiencias/${act.slug}`}>
                      <span className="flex items-center text-primary text-sm font-display font-medium hover:gap-2 transition-all cursor-pointer">
                        Ver detalles <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </span>
                    </Link>
                    {act.basePrice && (
                      <button
                        onClick={() => setBookingProduct({ id: act.experienceId || 0, title: act.title, basePrice: act.basePrice, image1: act.image1 })}
                        className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-display font-bold bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
                      >
                        <Calendar className="w-3.5 h-3.5" /> Reservar
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1628 0%, #0d2240 50%, #0a1628 100%)" }}>
        <div className="absolute inset-0 opacity-5">
          <img src={CDN.panoramica} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="relative z-10 container">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-display font-bold uppercase tracking-widest mb-4">
              <Anchor className="w-3 h-3" /> Visita de Día · Abril — Octubre
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              Packs de <span className="text-accent">Día Completo</span>
            </h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto">
              Elige tu combinación perfecta. Reserva online y obtén un{" "}
              <span className="text-accent font-bold">10% de descuento</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {packs.map((pack, idx) => {
              const packImgs = [CDN.wakeboard, CDN.kayak2, CDN.hinchable, CDN.tubing, CDN.barco, CDN.banana];
              const bg = packImgs[idx % packImgs.length];
              return (
                <Link key={pack.slug} href={`/packs/${pack.slug}`}>
                  <div
                    className={`group relative rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${
                      pack.highlight ? "ring-2 ring-accent shadow-accent/20 shadow-xl" : "shadow-lg"
                    }`}
                    style={{ minHeight: 400 }}
                  >
                    <img src={bg} alt={pack.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(5,15,35,0.96) 45%, rgba(5,15,35,0.25) 100%)" }} />
                    {pack.highlight && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-accent text-accent-foreground text-xs font-display font-bold uppercase tracking-widest whitespace-nowrap">
                        ★ Más Popular
                      </div>
                    )}
                    <div className="relative z-10 flex flex-col justify-end h-full p-6" style={{ minHeight: 400 }}>
                      <div className="mb-3">
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-4xl font-display font-extrabold text-white">{pack.price}</span>
                          <span className="text-white/60 text-sm">{pack.unit}</span>
                        </div>
                        <h3 className="font-heading font-bold text-xl text-white mb-3">{pack.name}</h3>
                      </div>
                      <ul className="space-y-1.5 mb-5">
                        {pack.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-white/75">
                            <span className="text-accent mt-0.5 flex-shrink-0">✓</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-between pt-4 border-t border-white/15">
                        <span className="font-display font-semibold text-sm text-white/70">Ver detalles</span>
                        <span className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-accent-foreground text-xs font-display font-bold transition-all group-hover:gap-2.5">
                          Reservar <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="text-center mt-12">
            <Link href="/packs">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-10 shadow-lg">
                Ver Todos los Packs <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── HOTEL NÁYADE ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[640px]">
          {/* Columna imagen */}
          <div className="relative overflow-hidden" style={{ minHeight: 400 }}>
            <img src={CDN.hotel} alt="Hotel Náyade" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 55%, rgba(248,250,252,1) 100%)" }} />
            {/* Badge flotante */}
            <div className="absolute bottom-8 left-8 bg-white rounded-2xl px-5 py-4 shadow-xl border border-gray-100">
              <div className="text-2xl font-heading font-bold text-amber-500">★★★</div>
              <div className="font-display text-sm font-semibold text-gray-800">Hotel Náyade</div>
              <div className="font-display text-xs text-gray-500">117 habitaciones</div>
            </div>
          </div>
          {/* Columna contenido — fondo blanco a gris claro */}
          <div className="flex flex-col justify-center px-8 py-16 lg:px-14" style={{ background: "linear-gradient(160deg, #f8fafc 0%, #e8eef5 100%)" }}>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-display font-bold uppercase tracking-widest mb-5 w-fit">
              Alojamiento Premium
            </span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-gray-900 mb-4">
              Hotel <span className="text-primary">Náyade</span>
            </h2>
            <p className="text-gray-600 text-lg mb-8 leading-relaxed">
              Ubicado frente al embalse en Los Ángeles de San Rafael. Un refugio de confort diseñado para descansar tras un día de aventura, combinando servicios de calidad con un entorno natural inigualable.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {habitaciones.map((hab) => {
                const svgIcons: Record<string, React.ReactNode> = {
                  bed: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-primary"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M2 12V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
                  waves: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-primary"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/></svg>,
                  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-primary"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
                  star: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5 text-primary"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
                };
                return (
                  <div key={hab.tipo} className="rounded-2xl p-4 border border-gray-200 hover:border-primary/40 hover:shadow-md transition-all bg-white">
                    <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-2" style={{ background: "rgba(14,165,233,0.08)" }}>
                      {svgIcons[hab.iconSvg]}
                    </div>
                    <div className="font-display font-bold text-sm text-gray-800 mb-0.5">{hab.tipo}</div>
                    <div className="text-primary font-display font-bold text-lg">{hab.precio}</div>
                    <div className="text-gray-400 text-xs">{hab.rango}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 mb-6 flex-wrap">
              <Link href="/hotel">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white font-display font-semibold rounded-full px-8 shadow-md">
                  Ver Habitaciones <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link href="/presupuesto">
                <Button size="lg" variant="outline" className="border-primary/30 text-primary hover:bg-primary/5 font-display font-semibold rounded-full px-8 bg-white">
                  Solicitar Precio
                </Button>
              </Link>
            </div>
            <HotelSearchBar
              params={hotelSearch}
              onChange={setHotelSearch}
              onSearch={handleHotelSearch}
              buttonLabel="Ver disponibilidad"
            />
          </div>
        </div>
      </section>

      {/* ─── SPA ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[620px]">
          {/* Columna contenido */}
          <div className="flex flex-col justify-center px-8 py-16 lg:px-14 order-2 lg:order-1" style={{ background: "linear-gradient(135deg, #0d1f1a 0%, #0a2a20 100%)" }}>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-white/70 text-xs font-display font-bold uppercase tracking-widest mb-5 w-fit">
              Bienestar & Relax
            </span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-white mb-4">
              SPA <span className="text-accent">Náyade</span>
            </h2>
            <p className="text-white/65 text-lg mb-8 leading-relaxed">
              Un santuario de paz donde el cuerpo recupera su equilibrio. Disfruta de nuestras instalaciones termales y tratamientos exclusivos con vistas al lago.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {[
                { label: "Circuito SPA", precio: "25€/persona", desc: "Piscinas termales + chorros" },
                { label: "Pack Pareja", precio: "40€/2 pax", desc: "Experiencia romántica" },
                { label: "Huéspedes Hotel", precio: "20€/persona", desc: "Precio especial hotel" },
                { label: "Niños (<12 años)", precio: "10€", desc: "Diversión en familia" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl p-4 border border-white/10 hover:border-accent/40 transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="font-display font-bold text-white text-sm mb-0.5">{item.label}</div>
                  <div className="text-accent font-display font-bold text-xl">{item.precio}</div>
                  <div className="text-white/50 text-xs">{item.desc}</div>
                </div>
              ))}
            </div>
            <Link href="/spa">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-8 w-fit">
                Reservar SPA <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
          {/* Columna imagen doble */}
          <div className="relative order-1 lg:order-2 grid grid-rows-2 gap-0 overflow-hidden" style={{ minHeight: 400 }}>
            <div className="relative overflow-hidden">
              <img src={CDN.spa1} alt="SPA Náyade tratamientos" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30" />
            </div>
            <div className="relative overflow-hidden">
              <img src={CDN.spa2} alt="SPA Náyade noche" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-transparent to-black/30" />
              {/* Servicios overlay */}
              <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2">
                {[
                  { emoji: "🌊", titulo: "Circuito Hidrotermal" },
                  { emoji: "🧖", titulo: "Masajes Terapéuticos" },
                  { emoji: "🧖‍♀️", titulo: "Sauna & Baño Turco" },
                  { emoji: "✨", titulo: "Clinic SPA" },
                ].map((item) => (
                  <div key={item.titulo} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(10,22,40,0.75)", backdropFilter: "blur(8px)" }}>
                    <span className="text-lg">{item.emoji}</span>
                    <span className="text-white text-xs font-display font-semibold">{item.titulo}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── RESTAURANTES ───────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #1a0f05 0%, #2a1a08 50%, #1a0f05 100%)" }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-display font-bold uppercase tracking-widest mb-4">
              Gastronomía
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              Sabores del <span className="text-accent">Lago</span>
            </h2>
            <p className="text-white/55 text-lg max-w-xl mx-auto">
              Desde desayunos con vistas hasta cenas temáticas. Cocina internacional y sabores locales en espacios únicos
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {(restaurantsQuery.data ?? []).map((rest) => {
              const heroImg = rest.heroImage && !rest.heroImage.includes("unsplash") ? rest.heroImage : CDN.barco;
              const isOpen = isRestaurantOpenNow((rest as any).shifts);
              const nextShift = getNextShift((rest as any).shifts);
              return (
                <Link key={rest.slug} href={`/restaurantes/${rest.slug}`}>
                  <div className="group relative rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl shadow-lg" style={{ minHeight: 360 }}>
                    <img src={heroImg} alt={rest.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(15,8,2,0.97) 40%, rgba(15,8,2,0.15) 100%)" }} />
                    {/* Banda abierto/cerrado */}
                    <div className="absolute top-4 right-4 z-20">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-white text-xs font-display font-bold shadow-lg">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Abierto
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700/80 text-white/70 text-xs font-display font-bold backdrop-blur-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/40" /> Cerrado
                        </span>
                      )}
                    </div>
                    <div className="relative z-10 flex flex-col justify-end h-full p-6" style={{ minHeight: 360 }}>
                      {rest.badge && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs font-display font-semibold mb-2 w-fit">{rest.badge}</span>
                      )}
                      <h3 className="font-heading font-bold text-lg text-white mb-1">{rest.name}</h3>
                      <p className="text-accent font-display text-xs font-semibold uppercase tracking-wide mb-2">{rest.cuisine}</p>
                      <p className="text-white/65 text-sm leading-relaxed mb-3 line-clamp-2">{rest.shortDesc}</p>
                      {/* Horario */}
                      {!isOpen && nextShift && (
                        <div className="flex items-center gap-1.5 text-white/50 text-xs mb-3">
                          <Clock className="w-3 h-3" /> {nextShift}
                        </div>
                      )}
                      {rest.acceptsOnlineBooking ? (
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-accent-foreground text-xs font-display font-bold transition-all group-hover:gap-2.5 w-fit">
                          <Calendar className="w-3.5 h-3.5" /> Reservar Mesa
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/10 text-white/50 text-xs font-display border border-white/10">Próximamente</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            {/* Skeleton mientras carga */}
            {restaurantsQuery.isLoading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-3xl bg-white/5 animate-pulse" style={{ minHeight: 360 }} />
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/restaurantes">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-10 shadow-lg">
                Ver Todos los Restaurantes <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── POR QUÉ NAYADE ─────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #0a1628 0%, #0d2240 50%, #061020 100%)" }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(14,165,233,0.3) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(249,115,22,0.2) 0%, transparent 50%)" }} />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-display font-bold uppercase tracking-widest mb-5">
              ¿Por qué Náyade?
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              10 Razones para <span className="text-accent">Elegirnos</span>
            </h2>
            <p className="text-white/55 text-lg max-w-2xl mx-auto">
              Un destino único donde la naturaleza, el deporte y el bienestar se fusionan a solo 45 minutos de Madrid.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {razones.map((r, i) => (
              <div
                key={i}
                className="group relative text-center p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-default"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}
              >
                {/* Línea acento top al hover */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-accent rounded-full transition-all duration-300 group-hover:w-3/4" />
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 transition-all duration-300 group-hover:scale-110" style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.25)" }}>
                  <span className="text-accent">{r.icon}</span>
                </div>
                <h4 className="font-display font-bold text-sm text-white mb-1.5">{r.titulo}</h4>
                <p className="text-white/50 text-xs leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/presupuesto">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground font-display font-semibold rounded-full px-10 shadow-lg shadow-accent/20">
                Diseña tu Experiencia <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIOS ────────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1628 0%, #0d2240 50%, #0a1628 100%)" }}>
        <div className="absolute inset-0 opacity-5">
          <img src={CDN.hero3} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-display font-bold uppercase tracking-widest mb-4">
              <Star className="w-3 h-3 fill-accent" /> Opiniones Verificadas
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              Lo que Dicen <span className="text-accent">Nuestros Clientes</span>
            </h2>
            <p className="text-white/55 text-lg max-w-xl mx-auto">
              Más de 10.000 experiencias vividas. Estas son algunas de sus historias.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonios.map((t, i) => (
              <div
                key={i}
                className="group relative rounded-3xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(12px)" }}
              >
                {/* Línea de acento superior */}
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-accent to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="p-8">
                  <div className="flex gap-1 mb-5">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-accent text-accent" />
                    ))}
                  </div>
                  <p className="text-white/80 text-base leading-relaxed mb-6 italic">
                    "{t.texto}"
                  </p>
                  <div className="flex items-center gap-3 pt-5 border-t border-white/10">
                    <div className="w-10 h-10 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent font-display font-bold text-sm flex-shrink-0">
                      {t.autor.charAt(0)}
                    </div>
                    <div>
                      <div className="font-display font-bold text-white text-sm">{t.autor}</div>
                      <div className="text-white/45 text-xs">{t.tipo}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Métricas de confianza */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { num: "10.000+", label: "Clientes satisfechos" },
              { num: "4.8★", label: "Valoración media" },
              { num: "15+", label: "Años de experiencia" },
              { num: "10", label: "Actividades acuáticas" },
            ].map((stat) => (
              <div key={stat.label} className="text-center py-6 px-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-3xl font-heading font-bold text-accent mb-1">{stat.num}</div>
                <div className="text-white/55 text-sm font-display">{stat.label}</div>
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
            <span className="flex items-center gap-2"><Phone className="w-4 h-4 text-accent" /> +34 930 34 77 91</span>
            <span className="flex items-center gap-2"><Mail className="w-4 h-4 text-accent" /> reservas@nayadeexperiences.es</span>
            <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-accent" /> Los Ángeles de San Rafael, Segovia</span>
          </div>
        </div>
      </section>

      {/* BookingModal — se activa desde las tarjetas de experiencias */}
      {bookingProduct && (
        <BookingModal
          isOpen={!!bookingProduct}
          onClose={() => setBookingProduct(null)}
          product={bookingProduct}
        />
      )}
    </PublicLayout>
  );
}
