import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  ChevronRight,
  Star,
  Users,
  Clock,
  MapPin,
  ArrowRight,
  Play,
  Award,
  Shield,
  Headphones,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// Hero slides data (will be replaced with CMS data)
const heroSlides = [
  {
    id: 1,
    imageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=1920&q=80",
    title: "Vive la Montaña",
    subtitle: "Experiencias de esquí y nieve únicas en los mejores destinos de España",
    ctaText: "Explorar Experiencias",
    ctaUrl: "/experiencias",
  },
  {
    id: 2,
    imageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=1920&q=80",
    title: "Aventura en el Agua",
    subtitle: "Descubre la emoción de los deportes acuáticos con nuestros expertos",
    ctaText: "Ver Actividades",
    ctaUrl: "/experiencias/aventura-acuatica",
  },
  {
    id: 3,
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80",
    title: "Multiaventura Extrema",
    subtitle: "Supera tus límites con actividades diseñadas para los más atrevidos",
    ctaText: "Descubrir Más",
    ctaUrl: "/experiencias/multiaventura",
  },
];

const categories = [
  {
    id: 1,
    name: "Nieve & Ski",
    slug: "nieve-ski",
    description: "Esquí, snowboard y actividades en la nieve",
    imageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=600&q=80",
    count: 12,
    icon: "⛷️",
  },
  {
    id: 2,
    name: "Aventura Acuática",
    slug: "aventura-acuatica",
    description: "Kayak, rafting, surf y deportes acuáticos",
    imageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=600&q=80",
    count: 8,
    icon: "🏄",
  },
  {
    id: 3,
    name: "Multiaventura",
    slug: "multiaventura",
    description: "Escalada, tirolina, senderismo y más",
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80",
    count: 15,
    icon: "🧗",
  },
  {
    id: 4,
    name: "Experiencias Premium",
    slug: "premium",
    description: "Vivencias exclusivas y personalizadas",
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80",
    count: 6,
    icon: "✨",
  },
];

const featuredExperiences = [
  {
    id: 1,
    title: "Esquí en los Pirineos",
    slug: "esqui-pirineos",
    category: "Nieve & Ski",
    location: "Pirineos, España",
    price: 89,
    duration: "1 día",
    persons: "2-10",
    rating: 4.9,
    reviews: 124,
    imageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=600&q=80",
    isFeatured: true,
    difficulty: "Moderado",
  },
  {
    id: 2,
    title: "Kayak en el Mediterráneo",
    slug: "kayak-mediterraneo",
    category: "Aventura Acuática",
    location: "Costa Brava",
    price: 65,
    duration: "Medio día",
    persons: "2-8",
    rating: 4.8,
    reviews: 89,
    imageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=600&q=80",
    isFeatured: true,
    difficulty: "Fácil",
  },
  {
    id: 3,
    title: "Escalada en Roca",
    slug: "escalada-roca",
    category: "Multiaventura",
    location: "Sierra de Guadarrama",
    price: 75,
    duration: "1 día",
    persons: "1-6",
    rating: 4.7,
    reviews: 67,
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80",
    isFeatured: true,
    difficulty: "Difícil",
  },
  {
    id: 4,
    title: "Ruta en Helicóptero",
    slug: "ruta-helicoptero",
    category: "Premium",
    location: "Sierra Nevada",
    price: 450,
    duration: "2 horas",
    persons: "2-4",
    rating: 5.0,
    reviews: 32,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80",
    isFeatured: true,
    difficulty: "Fácil",
  },
];

const stats = [
  { value: "5.000+", label: "Aventureros satisfechos" },
  { value: "50+", label: "Experiencias únicas" },
  { value: "15+", label: "Destinos en España" },
  { value: "10", label: "Años de experiencia" },
];

const testimonials = [
  {
    id: 1,
    name: "Carlos Martínez",
    role: "Aventurero",
    text: "Una experiencia increíble. Los monitores son profesionales y la organización impecable. Volveré sin duda.",
    rating: 5,
    avatar: "CM",
  },
  {
    id: 2,
    name: "Laura Sánchez",
    role: "Deportista",
    text: "El mejor día de esquí de mi vida. Las instalaciones son de primera y el trato personalizado hace la diferencia.",
    rating: 5,
    avatar: "LS",
  },
  {
    id: 3,
    name: "Miguel Torres",
    role: "Empresa",
    text: "Organizamos el team building de la empresa y fue un éxito total. Muy recomendable para eventos corporativos.",
    rating: 5,
    avatar: "MT",
  },
];

const difficultyColors: Record<string, string> = {
  Fácil: "bg-emerald-100 text-emerald-700",
  Moderado: "bg-amber-100 text-amber-700",
  Difícil: "bg-red-100 text-red-700",
  Experto: "bg-purple-100 text-purple-700",
};

export default function Home() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Fetch featured experiences from DB (falls back to static data if empty)
  const { data: dbExperiences } = trpc.public.getFeaturedExperiences.useQuery();

  const slides = heroSlides;
  const experiences = dbExperiences?.length ? dbExperiences : featuredExperiences;

  useEffect(() => {
    const timer = setInterval(() => {
      nextSlide();
    }, 6000);
    return () => clearInterval(timer);
  }, [currentSlide]);

  const nextSlide = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
      setIsTransitioning(false);
    }, 300);
  };

  const prevSlide = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
      setIsTransitioning(false);
    }, 300);
  };

  const slide = slides[currentSlide];

  return (
    <PublicLayout fullWidthHero>
      {/* ─── HERO SLIDESHOW ─────────────────────────────────────────────────── */}
      <section className="relative h-screen min-h-[600px] max-h-[900px] overflow-hidden">
        {/* Background Image */}
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
        >
          <img
            src={slide.imageUrl}
            alt={slide.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-hero-gradient" />
        </div>

        {/* Content */}
        <div className="relative h-full flex items-center">
          <div className="container">
            <div className="max-w-2xl">
              <div
                className={cn(
                  "transition-all duration-700",
                  isTransitioning ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
                )}
              >
                <Badge className="mb-5 bg-amber-500/20 text-amber-300 border-amber-500/30 backdrop-blur-sm">
                  ✦ Experiencias Únicas en España
                </Badge>
                <h1 className="text-5xl md:text-7xl font-display font-bold text-white leading-tight mb-5">
                  {slide.title}
                </h1>
                <p className="text-lg md:text-xl text-white/80 leading-relaxed mb-8 max-w-xl">
                  {slide.subtitle}
                </p>
                <div className="flex flex-wrap gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="bg-gold-gradient text-white hover:opacity-90 shadow-lg font-semibold px-8 h-13"
                  >
                    <Link href={slide.ctaUrl}>
                      {slide.ctaText}
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="border-white/40 text-white bg-white/10 hover:bg-white/20 backdrop-blur-sm font-semibold px-8 h-13"
                  >
                    <Link href="/presupuesto">
                      <Play className="mr-2 w-4 h-4" />
                      Solicitar Presupuesto
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Slide Controls */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <button
            onClick={prevSlide}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center text-white transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={cn(
                  "rounded-full transition-all duration-300",
                  i === currentSlide
                    ? "w-8 h-2 bg-amber-400"
                    : "w-2 h-2 bg-white/50 hover:bg-white/80"
                )}
              />
            ))}
          </div>
          <button
            onClick={nextSlide}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center text-white transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 right-8 hidden md:flex flex-col items-center gap-2">
          <span className="text-white/50 text-xs uppercase tracking-widest rotate-90 origin-center">Scroll</span>
          <div className="w-px h-12 bg-gradient-to-b from-white/50 to-transparent" />
        </div>
      </section>

      {/* ─── STATS BAR ──────────────────────────────────────────────────────── */}
      <section className="bg-[oklch(0.18_0.04_240)] py-8">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl md:text-3xl font-display font-bold text-amber-400 mb-1">
                  {stat.value}
                </div>
                <div className="text-sm text-white/60">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CATEGORIES ─────────────────────────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-accent/10 text-accent border-accent/20">
              Nuestras Categorías
            </Badge>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
              Elige tu Aventura
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Desde la montaña nevada hasta las aguas cristalinas, tenemos la experiencia perfecta para cada tipo de aventurero.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {categories.map((cat) => (
              <Link key={cat.id} href={`/experiencias/${cat.slug}`}>
                <div className="group relative rounded-2xl overflow-hidden aspect-[3/4] cursor-pointer card-hover">
                  <img
                    src={cat.imageUrl}
                    alt={cat.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 overlay-dark" />
                  <div className="absolute inset-0 p-5 flex flex-col justify-end">
                    <div className="text-3xl mb-2">{cat.icon}</div>
                    <h3 className="font-display font-bold text-xl text-white mb-1">{cat.name}</h3>
                    <p className="text-sm text-white/70 mb-3">{cat.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-400 font-medium">{cat.count} experiencias</span>
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 group-hover:bg-amber-500 flex items-center justify-center transition-all">
                        <ArrowRight className="w-3.5 h-3.5 text-amber-400 group-hover:text-white" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURED EXPERIENCES ───────────────────────────────────────────── */}
      <section className="py-20 bg-[oklch(0.97_0.005_240)]">
        <div className="container">
          <div className="flex items-end justify-between mb-12">
            <div>
              <Badge className="mb-4 bg-accent/10 text-accent border-accent/20">
                Más Populares
              </Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">
                Experiencias Destacadas
              </h2>
            </div>
            <Button asChild variant="outline" className="hidden md:flex">
              <Link href="/experiencias">
                Ver todas
                <ChevronRight className="ml-1 w-4 h-4" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(experiences as typeof featuredExperiences).map((exp) => (
              <Link key={exp.id} href={`/experiencia/${exp.slug}`}>
                <div className="group bg-card rounded-2xl overflow-hidden border border-border/50 card-hover cursor-pointer h-full flex flex-col">
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={exp.imageUrl}
                      alt={exp.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3">
                      <Badge className={cn("text-xs font-medium", difficultyColors[exp.difficulty] || "bg-gray-100 text-gray-700")}>
                        {exp.difficulty}
                      </Badge>
                    </div>
                    {exp.isFeatured && (
                      <div className="absolute top-3 right-3">
                        <Badge className="bg-amber-500 text-white text-xs">★ Destacado</Badge>
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <MapPin className="w-3 h-3" />
                      <span>{exp.location}</span>
                    </div>
                    <h3 className="font-display font-semibold text-base text-foreground mb-2 group-hover:text-accent transition-colors">
                      {exp.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {exp.duration}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {exp.persons} pers.
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between">
                      <div>
                        <span className="text-xs text-muted-foreground">Desde</span>
                        <div className="text-xl font-display font-bold text-foreground">
                          {exp.price}€
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-semibold">{exp.rating}</span>
                        <span className="text-xs text-muted-foreground">({exp.reviews})</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center mt-8 md:hidden">
            <Button asChild variant="outline">
              <Link href="/experiencias">
                Ver todas las experiencias
                <ChevronRight className="ml-1 w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── WHY US ─────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <Badge className="mb-4 bg-accent/10 text-accent border-accent/20">
                ¿Por qué elegirnos?
              </Badge>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6">
                La Excelencia en Cada Aventura
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Con más de 10 años de experiencia, somos el referente en experiencias de aventura en España. Nuestro equipo de profesionales certificados garantiza seguridad, calidad y momentos inolvidables.
              </p>
              <div className="space-y-5">
                {[
                  {
                    icon: Shield,
                    title: "Seguridad Garantizada",
                    desc: "Todos nuestros monitores están certificados y el material cumple los más altos estándares.",
                  },
                  {
                    icon: Award,
                    title: "Experiencia Premium",
                    desc: "Diseñamos cada actividad para que sea una experiencia única y memorable.",
                  },
                  {
                    icon: Headphones,
                    title: "Atención Personalizada",
                    desc: "Nuestro equipo está disponible para adaptar cada experiencia a tus necesidades.",
                  },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h4 className="font-display font-semibold text-foreground mb-1">{item.title}</h4>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="grid grid-cols-2 gap-4">
                <img
                  src="https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&q=80"
                  alt="Ski"
                  className="rounded-2xl w-full aspect-square object-cover"
                />
                <img
                  src="https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=400&q=80"
                  alt="Kayak"
                  className="rounded-2xl w-full aspect-square object-cover mt-8"
                />
                <img
                  src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80"
                  alt="Escalada"
                  className="rounded-2xl w-full aspect-square object-cover -mt-8"
                />
                <img
                  src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80"
                  alt="Montaña"
                  className="rounded-2xl w-full aspect-square object-cover"
                />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-amber-500 text-white rounded-2xl p-5 shadow-xl">
                <div className="text-3xl font-display font-bold">10+</div>
                <div className="text-sm font-medium">Años de experiencia</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS ───────────────────────────────────────────────────── */}
      <section className="py-20 bg-[oklch(0.14_0.03_240)]">
        <div className="container">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-amber-500/20 text-amber-400 border-amber-500/30">
              Testimonios
            </Badge>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
              Lo que Dicen Nuestros Aventureros
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.id} className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-white/80 text-sm leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">{t.name}</div>
                    <div className="text-white/50 text-xs">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA BANNER ─────────────────────────────────────────────────────── */}
      <section className="py-20 bg-gold-gradient">
        <div className="container text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
            ¿Listo para tu Próxima Aventura?
          </h2>
          <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
            Cuéntanos qué tipo de experiencia buscas y crearemos un presupuesto personalizado para ti.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button
              asChild
              size="lg"
              className="bg-white text-amber-600 hover:bg-white/90 font-semibold px-8 shadow-lg"
            >
              <Link href="/presupuesto">
                Solicitar Presupuesto Gratis
                <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/50 text-white bg-transparent hover:bg-white/10 font-semibold px-8"
            >
              <Link href="/experiencias">Ver Experiencias</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
