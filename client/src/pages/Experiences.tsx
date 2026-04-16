import { useState } from "react";
import { Link, useParams } from "wouter";
import { Search, Filter, Star, Clock, Users, MapPin, SlidersHorizontal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import AddToCartModal from "@/components/AddToCartModal";
import { DiscountRibbon, getDiscountedPrice } from "@/components/DiscountRibbon";

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



export default function Experiences() {
  const params = useParams<{ category?: string }>();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [cartProduct, setCartProduct] = useState<Record<string, unknown> | null>(null);

  const { data: dbExperiences } = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 });
  const { data: dbCategories } = trpc.public.getCategories.useQuery();

  const experiences = dbExperiences ?? [];
  const categories = dbCategories ?? [];

  const filtered = experiences.filter((exp) => {
    const matchSearch = !search || exp.title.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !selectedCategory || exp.categoryId === selectedCategory;
    const matchDifficulty = !selectedDifficulty || exp.difficulty === selectedDifficulty;
    return matchSearch && matchCategory && matchDifficulty;
  });

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/wakeboard_b574701d.jpg" alt="Experiencias Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Deportes Acuáticos
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Nuestras Experiencias
              </h1>
              <p className="text-xl text-white/85 font-display">
                Descubre nuestra colección de aventuras únicas diseñadas para cada tipo de explorador.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="container py-3">
          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar experiencias..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full h-9 text-sm"
              style={{ pointerEvents: 'auto', position: 'relative', zIndex: 1 }}
            />
          </div>

          {/* Categories + Difficulty — scroll horizontal en móvil, wrap en desktop */}
          <div
            className="md:flex md:flex-wrap md:items-center md:gap-2"
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              gap: '8px',
              alignItems: 'center',
              paddingBottom: '4px',
              marginLeft: '-16px',
              marginRight: '-16px',
              paddingLeft: '16px',
              paddingRight: '16px',
            }}
          >
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn(
                "transition-all font-medium",
                !selectedCategory
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
              style={{ flexShrink: 0, padding: '6px 12px', borderRadius: '999px', fontSize: '12px', whiteSpace: 'nowrap', border: 'none', cursor: 'pointer' }}
            >
              Todas
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                className={cn(
                  "transition-all font-medium",
                  selectedCategory === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
                style={{ flexShrink: 0, padding: '6px 12px', borderRadius: '999px', fontSize: '12px', whiteSpace: 'nowrap', border: 'none', cursor: 'pointer' }}
              >
                {(cat as any).iconName} {cat.name}
              </button>
            ))}

            {/* Separator */}
            <div style={{ flexShrink: 0, width: '1px', height: '20px', background: '#e5e7eb', margin: '0 4px' }} />

            {/* Difficulty inline */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" style={{ flexShrink: 0 } as any} />
              <select
                value={selectedDifficulty ?? ""}
                onChange={(e) => setSelectedDifficulty(e.target.value || null)}
                style={{ flexShrink: 0, fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '999px', padding: '6px 10px', background: 'white', whiteSpace: 'nowrap', cursor: 'pointer' }}
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
                  <Link href={`/experiencias/${exp.slug}`}>
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
                      <DiscountRibbon
                        discountPercent={(exp as any).discountPercent}
                        discountExpiresAt={(exp as any).discountExpiresAt}
                        variant="card"
                      />
                    </div>
                  </Link>

                  <div className="p-5 flex flex-col flex-1">
                    <Link href={`/experiencias/${exp.slug}`}>
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
                          {(() => {
                            const discounted = getDiscountedPrice(
                              exp.basePrice,
                              (exp as any).discountPercent,
                              (exp as any).discountExpiresAt
                            );
                            return discounted ? (
                              <>
                                <span className="text-xs text-muted-foreground">Desde</span>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-2xl font-display font-bold text-orange-500">{discounted.toFixed(0)}€</span>
                                  <span className="text-sm text-muted-foreground line-through">{parseFloat(exp.basePrice).toFixed(0)}€</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="text-xs text-muted-foreground">Desde</span>
                                <div className="text-2xl font-display font-bold text-foreground">
                                  {parseFloat(exp.basePrice).toFixed(0)}€
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <Link href={`/experiencias/${exp.slug}`}>
                          <Button size="sm" variant="outline" className="text-xs">
                            Ver detalles
                            <ChevronRight className="ml-1 w-3 h-3" />
                          </Button>
                        </Link>
                      </div>
                      {/* CTAs */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCartProduct(exp as any)}
                          style={{
                            flex: 1, padding: "0.6rem 0.75rem",
                            background: "linear-gradient(135deg, #f97316, #ea580c)",
                            border: "none", borderRadius: "0.5rem",
                            color: "#fff", fontWeight: 700, fontSize: "0.8rem",
                            cursor: "pointer", boxShadow: "0 3px 8px rgba(249,115,22,0.35)",
                          }}
                        >
                          🛒 Añadir al carrito
                        </button>
                        <Link href="/presupuesto">
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
      {/* AddToCartModal */}
      {cartProduct && (
        <AddToCartModal
          isOpen={!!cartProduct}
          onClose={() => setCartProduct(null)}
          product={{
            id: (cartProduct as any).id,
            title: (cartProduct as any).title,
            basePrice: (cartProduct as any).basePrice,
            image1: (cartProduct as any).image1 ?? (cartProduct as any).coverImageUrl,
            slug: (cartProduct as any).slug,
            minPersons: (cartProduct as any).minPersons ?? 1,
            maxPersons: (cartProduct as any).maxPersons ?? 100,
            discountPercent: (cartProduct as any).discountPercent,
            discountExpiresAt: (cartProduct as any).discountExpiresAt,
            pricingType: (cartProduct as any).pricingType,
            unitCapacity: (cartProduct as any).unitCapacity,
            maxUnits: (cartProduct as any).maxUnits,
          }}
        />
      )}
    </PublicLayout>
  );
}
