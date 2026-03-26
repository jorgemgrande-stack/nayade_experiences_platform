import { useState } from "react";
import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Search,
  SlidersHorizontal,
  ChevronRight,
  MessageCircle,
  Star,
  Sun,
  GraduationCap,
  Building2,
  Layers,
  Check,
} from "lucide-react";

// ── Category metadata ──────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  text: string;
  image: string;
  breadcrumb: string;
  badgeOptions: string[];
}> = {
  dia: {
    title: "Lego Packs de Día",
    subtitle: "Experiencias completas personalizadas en el lago",
    description: "Combina actividades acuáticas, almuerzo y acceso al club en un Lego Pack a tu medida. Reserva online al instante.",
    icon: Sun,
    gradient: "from-sky-600 to-blue-800",
    text: "text-sky-700",
    image: "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=70",
    breadcrumb: "Lego Packs de Día",
    badgeOptions: ["Más Popular", "Recomendado", "Aventura", "Premium", "Novedad"],
  },
  escolar: {
    title: "Lego Packs Escolares",
    subtitle: "Excursiones y viajes a medida para colegios",
    description: "Programas adaptados por edades con monitores titulados y protocolo de seguridad certificado.",
    icon: GraduationCap,
    gradient: "from-emerald-600 to-teal-800",
    text: "text-emerald-700",
    image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600&q=70",
    breadcrumb: "Lego Packs Escolares",
    badgeOptions: ["Primaria", "Secundaria", "Bachillerato", "Más Popular"],
  },
  empresa: {
    title: "Lego Packs Empresas",
    subtitle: "Team building y eventos corporativos personalizados",
    description: "Gymkhanas acuáticas personalizadas, catering premium y espacio para reuniones. Hasta 200 personas.",
    icon: Building2,
    gradient: "from-violet-600 to-purple-800",
    text: "text-violet-700",
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=70",
    breadcrumb: "Lego Packs Empresas",
    badgeOptions: ["Más Popular", "Premium", "Recomendado"],
  },
};

export default function LegoPacksList() {
  const { category } = useParams<{ category: string }>();
  const [search, setSearch] = useState("");
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);

  const validCategory = (["dia", "escolar", "empresa"].includes(category ?? "") ? category : "dia") as "dia" | "escolar" | "empresa";
  const meta = CATEGORY_META[validCategory] ?? CATEGORY_META["dia"];
  const Icon = meta.icon;

  const { data: legoPacks, isLoading } = trpc.legoPacks.listPublicByCategory.useQuery({
    category: validCategory,
  });

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = (legoPacks ?? []).filter((pack) => {
    const matchSearch = !search ||
      pack.title.toLowerCase().includes(search.toLowerCase()) ||
      (pack.shortDescription ?? "").toLowerCase().includes(search.toLowerCase());
    const matchBadge = !selectedBadge || pack.badge === selectedBadge;
    return matchSearch && matchBadge;
  });

  return (
    <PublicLayout>
      {/* ── Hero de categoría ─────────────────────────────────────────────────── */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16 relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={meta.image} alt={meta.title} className="w-full h-full object-cover opacity-30" />
          <div className={`absolute inset-0 bg-gradient-to-r ${meta.gradient} opacity-60`} />
        </div>
        <div className="relative container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href="/lego-packs" className="hover:text-amber-400 transition-colors">Lego Packs</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">{meta.breadcrumb}</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <Icon className="w-8 h-8 text-white/80" />
            <h1 className="text-4xl md:text-5xl font-display font-bold text-white">{meta.title}</h1>
          </div>
          <p className="text-white/80 text-lg mb-1">{meta.subtitle}</p>
          <p className="text-white/60 max-w-xl">{meta.description}</p>
        </div>
      </section>

      {/* ── Barra de filtros sticky ───────────────────────────────────────────── */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="container py-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            {/* Search */}
            <div className="relative w-full md:w-64 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={`Buscar ${meta.breadcrumb.toLowerCase()}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full"
              />
            </div>

            {/* Badge filter pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelectedBadge(null)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
                  !selectedBadge
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                Todos
              </button>
              {meta.badgeOptions.map((badge) => (
                <button
                  key={badge}
                  onClick={() => setSelectedBadge(selectedBadge === badge ? null : badge)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium transition-all",
                    selectedBadge === badge
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {badge}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Resultados ───────────────────────────────────────────────────────── */}
      <section className="py-12">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <p className="text-muted-foreground text-sm">
              <span className="font-semibold text-foreground">{isLoading ? "..." : filtered.length}</span> Lego Packs encontrados
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-2xl bg-muted animate-pulse h-80" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <Layers className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
              <p className="text-xl font-semibold text-muted-foreground mb-2">
                No hay Lego Packs disponibles
              </p>
              <p className="text-muted-foreground mb-6">
                Próximamente añadiremos nuevos Lego Packs en esta categoría.
              </p>
              <Link href="/presupuesto">
                <Button variant="outline">
                  Solicitar Presupuesto Personalizado
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((pack) => {
                const coverImage = pack.image1 || pack.coverImageUrl;
                const discountPct = pack.discountPercent ? parseFloat(String(pack.discountPercent)) : null;
                const isDiscountActive = discountPct && discountPct > 0 &&
                  (!pack.discountExpiresAt || new Date(pack.discountExpiresAt) > new Date());

                return (
                  <Link key={pack.id} href={`/lego-packs/detalle/${pack.slug}`}>
                    <div className="group rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer flex flex-col h-full">
                      {/* Imagen */}
                      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                        {coverImage ? (
                          <img
                            src={coverImage}
                            alt={pack.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                            <Layers className="w-16 h-16 text-white/40" />
                          </div>
                        )}
                        <div className={`absolute inset-0 bg-gradient-to-t ${meta.gradient} opacity-20 group-hover:opacity-30 transition-opacity`} />

                        {/* Badge */}
                        {pack.badge && (
                          <div className="absolute top-3 left-3">
                            <Badge className="bg-orange-500 text-white border-0 text-xs font-bold">
                              {pack.badge}
                            </Badge>
                          </div>
                        )}

                        {/* Descuento */}
                        {isDiscountActive && (
                          <div className="absolute top-3 right-3">
                            <Badge className="bg-red-500 text-white border-0 text-xs font-bold">
                              -{discountPct}%
                            </Badge>
                          </div>
                        )}

                        {/* Lego Pack label */}
                        <div className="absolute bottom-3 left-3">
                          <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-indigo-600/90 text-white backdrop-blur-sm">
                            <Layers className="w-3 h-3" />
                            Lego Pack
                          </span>
                        </div>
                      </div>

                      {/* Contenido */}
                      <div className="p-5 flex flex-col flex-1">
                        <h3 className="font-bold text-lg text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                          {pack.title}
                        </h3>
                        {pack.subtitle && (
                          <p className={`text-sm font-medium ${meta.text} mb-2`}>{pack.subtitle}</p>
                        )}
                        {pack.shortDescription && (
                          <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-1">
                            {pack.shortDescription}
                          </p>
                        )}

                        {/* Precio */}
                        <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/50">
                          <div>
                            {pack.priceLabel ? (
                              <span className="text-sm font-semibold text-foreground">{pack.priceLabel}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">Consultar precio</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {pack.isOnlineSale ? (
                              <Badge variant="outline" className="text-xs border-sky-300 text-sky-700 bg-sky-50">
                                Reserva online
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50">
                                Solicitar presupuesto
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* CTA final */}
      <section className="py-14 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-center">
        <div className="container max-w-2xl">
          <Star className="w-10 h-10 mx-auto mb-4 text-indigo-200" />
          <h2 className="text-3xl font-black mb-3">
            ¿Quieres un Lego Pack a medida?
          </h2>
          <p className="text-indigo-100 mb-6 text-lg">
            Cuéntanos qué buscas y te preparamos un presupuesto personalizado
            sin compromiso.
          </p>
          <Link href="/presupuesto">
            <Button
              size="lg"
              className="bg-white text-indigo-600 hover:bg-indigo-50 font-bold px-8"
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Solicitar Presupuesto Personalizado
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
