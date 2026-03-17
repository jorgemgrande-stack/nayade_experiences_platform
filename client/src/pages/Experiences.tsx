import { useState } from "react";
import { Link, useParams } from "wouter";
import { Search, Filter, Star, Clock, Users, MapPin, SlidersHorizontal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import BookingModal from "@/components/BookingModal";

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

// Static fallback data
const staticExperiences = [
  { id: 1, slug: "esqui-pirineos", title: "Esquí en los Pirineos", shortDescription: "Una jornada completa de esquí en las mejores pistas", categoryId: 1, locationId: 1, coverImageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=600&q=80", basePrice: "89.00", duration: "1 día", minPersons: 2, maxPersons: 10, difficulty: "moderado", isFeatured: true, isActive: true },
  { id: 2, slug: "kayak-mediterraneo", title: "Kayak en el Mediterráneo", shortDescription: "Explora las calas más hermosas desde el agua", categoryId: 2, locationId: 2, coverImageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=600&q=80", basePrice: "65.00", duration: "Medio día", minPersons: 2, maxPersons: 8, difficulty: "facil", isFeatured: true, isActive: true },
  { id: 3, slug: "escalada-roca", title: "Escalada en Roca", shortDescription: "Aprende técnicas de escalada con instructores certificados", categoryId: 3, locationId: 3, coverImageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80", basePrice: "75.00", duration: "1 día", minPersons: 1, maxPersons: 6, difficulty: "dificil", isFeatured: false, isActive: true },
  { id: 4, slug: "ruta-helicoptero", title: "Ruta en Helicóptero", shortDescription: "Vistas panorámicas únicas desde las alturas", categoryId: 4, locationId: 4, coverImageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80", basePrice: "450.00", duration: "2 horas", minPersons: 2, maxPersons: 4, difficulty: "facil", isFeatured: true, isActive: true },
  { id: 5, slug: "rafting-noguera", title: "Rafting en el Noguera", shortDescription: "Adrenalina pura en las aguas bravas del Pirineo", categoryId: 2, locationId: 1, coverImageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=600&q=80", basePrice: "55.00", duration: "3 horas", minPersons: 4, maxPersons: 12, difficulty: "moderado", isFeatured: false, isActive: true },
  { id: 6, slug: "senderismo-guadarrama", title: "Senderismo en Guadarrama", shortDescription: "Rutas de montaña con guías expertos en la Sierra", categoryId: 3, locationId: 3, coverImageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80", basePrice: "45.00", duration: "1 día", minPersons: 2, maxPersons: 15, difficulty: "facil", isFeatured: false, isActive: true },
];

const staticCategories = [
  { id: 1, slug: "nieve-ski", name: "Nieve & Ski", iconName: "⛷️" },
  { id: 2, slug: "aventura-acuatica", name: "Aventura Acuática", iconName: "🏄" },
  { id: 3, slug: "multiaventura", name: "Multiaventura", iconName: "🧗" },
  { id: 4, slug: "premium", name: "Premium", iconName: "✨" },
];

export default function Experiences() {
  const params = useParams<{ category?: string }>();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [bookingProduct, setBookingProduct] = useState<(typeof staticExperiences)[0] | null>(null);

  const { data: dbExperiences } = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 });
  const { data: dbCategories } = trpc.public.getCategories.useQuery();

  const experiences = dbExperiences?.length ? dbExperiences : staticExperiences;
  const categories = dbCategories?.length ? dbCategories : staticCategories;

  const filtered = experiences.filter((exp) => {
    const matchSearch = !search || exp.title.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !selectedCategory || exp.categoryId === selectedCategory;
    const matchDifficulty = !selectedDifficulty || exp.difficulty === selectedDifficulty;
    return matchSearch && matchCategory && matchDifficulty;
  });

  return (
    <PublicLayout>
      {/* Page Header */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Experiencias</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
            Todas las Experiencias
          </h1>
          <p className="text-white/60 text-lg max-w-xl">
            Descubre nuestra colección de aventuras únicas diseñadas para cada tipo de explorador.
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="container py-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar experiencias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  !selectedCategory
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                Todas
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium transition-all",
                    selectedCategory === cat.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {(cat as any).iconName} {cat.name}
                </button>
              ))}
            </div>

            {/* Difficulty Filter */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
              <select
                value={selectedDifficulty ?? ""}
                onChange={(e) => setSelectedDifficulty(e.target.value || null)}
                className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Dificultad</option>
                <option value="facil">Fácil</option>
                <option value="moderado">Moderado</option>
                <option value="dificil">Difícil</option>
                <option value="experto">Experto</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="py-12">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <p className="text-muted-foreground text-sm">
              <span className="font-semibold text-foreground">{filtered.length}</span> experiencias encontradas
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-xl font-display font-semibold text-foreground mb-2">
                No se encontraron experiencias
              </h3>
              <p className="text-muted-foreground">Prueba con otros filtros o términos de búsqueda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((exp) => (
                <div key={exp.id} className="group bg-card rounded-2xl overflow-hidden border border-border/50 card-hover h-full flex flex-col">
                  <Link href={`/experiencia/${exp.slug}`}>
                    <div className="relative aspect-[16/10] overflow-hidden cursor-pointer">
                      <img
                        src={(exp as any).image1 ?? exp.coverImageUrl ?? "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80"}
                        alt={exp.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute top-3 left-3 flex gap-2">
                        {exp.difficulty && (
                          <Badge className={cn("text-xs font-medium", difficultyColors[exp.difficulty] ?? "bg-gray-100 text-gray-700")}>
                            {difficultyLabels[exp.difficulty] ?? exp.difficulty}
                          </Badge>
                        )}
                        {exp.isFeatured && (
                          <Badge className="bg-amber-500 text-white text-xs">★ Destacado</Badge>
                        )}
                      </div>
                    </div>
                  </Link>

                  <div className="p-5 flex flex-col flex-1">
                    <Link href={`/experiencia/${exp.slug}`}>
                      <h3 className="font-display font-semibold text-lg text-foreground mb-2 hover:text-accent transition-colors cursor-pointer">
                        {exp.title}
                      </h3>
                    </Link>
                    {exp.shortDescription && (
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{exp.shortDescription}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                      {exp.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {exp.duration}
                        </span>
                      )}
                      {exp.minPersons && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {exp.minPersons}{exp.maxPersons ? `-${exp.maxPersons}` : "+"} pers.
                        </span>
                      )}
                    </div>
                    <div className="mt-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-xs text-muted-foreground">Desde</span>
                          <div className="text-2xl font-display font-bold text-foreground">
                            {parseFloat(exp.basePrice).toFixed(0)}€
                          </div>
                        </div>
                        <Link href={`/experiencia/${exp.slug}`}>
                          <Button size="sm" variant="outline" className="text-xs">
                            Ver detalles
                            <ChevronRight className="ml-1 w-3 h-3" />
                          </Button>
                        </Link>
                      </div>
                      {/* Doble CTA */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setBookingProduct(exp as any)}
                          style={{
                            flex: 1, padding: "0.6rem 0.75rem",
                            background: "linear-gradient(135deg, #f97316, #ea580c)",
                            border: "none", borderRadius: "0.5rem",
                            color: "#fff", fontWeight: 700, fontSize: "0.8rem",
                            cursor: "pointer", boxShadow: "0 3px 8px rgba(249,115,22,0.35)",
                          }}
                        >
                          🎟️ Reservar ahora
                        </button>
                        <Link href="/contacto">
                          <button
                            style={{
                              flex: 1, padding: "0.6rem 0.75rem",
                              background: "transparent",
                              border: "1.5px solid #d1d5db", borderRadius: "0.5rem",
                              color: "#374151", fontWeight: 600, fontSize: "0.8rem",
                              cursor: "pointer",
                            }}
                          >
                            📋 Presupuesto
                          </button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      {/* BookingModal */}
      {bookingProduct && (
        <BookingModal
          isOpen={!!bookingProduct}
          onClose={() => setBookingProduct(null)}
          product={{
            id: bookingProduct.id,
            title: bookingProduct.title,
            basePrice: bookingProduct.basePrice,
            duration: bookingProduct.duration,
            minPersons: bookingProduct.minPersons ?? 1,
            maxPersons: bookingProduct.maxPersons ?? 100,
            image1: (bookingProduct as any).image1 ?? bookingProduct.coverImageUrl,
          }}
        />
      )}
    </PublicLayout>
  );
}
