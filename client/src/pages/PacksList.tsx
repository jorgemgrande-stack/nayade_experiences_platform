import { useParams, Link } from "wouter";
import { useState } from "react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Search,
  SlidersHorizontal,
  Clock,
  Users,
  ChevronRight,
  Check,
  ShoppingCart,
  MessageCircle,
  Star,
  Bed,
  Sun,
  GraduationCap,
  Building2,
} from "lucide-react";
import BookingModal from "@/components/BookingModal";

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
    title: "Packs de Día",
    subtitle: "Experiencias completas en el lago",
    description: "Combina actividades acuáticas, almuerzo y acceso al club en un solo pack. Reserva online al instante.",
    icon: Sun,
    gradient: "from-sky-600 to-blue-800",
    text: "text-sky-700",
    image: "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=70",
    breadcrumb: "Packs de Día",
    badgeOptions: ["Más Popular", "Recomendado", "Aventura", "Premium", "Novedad"],
  },
  escolar: {
    title: "Packs Escolares",
    subtitle: "Excursiones y viajes para colegios",
    description: "Programas adaptados por edades con monitores titulados y protocolo de seguridad certificado.",
    icon: GraduationCap,
    gradient: "from-emerald-600 to-teal-800",
    text: "text-emerald-700",
    image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600&q=70",
    breadcrumb: "Packs Escolares",
    badgeOptions: ["Primaria", "Secundaria", "Bachillerato", "Más Popular"],
  },
  empresa: {
    title: "Packs Empresas",
    subtitle: "Team building y eventos corporativos",
    description: "Gymkhanas acuáticas personalizadas, catering premium y espacio para reuniones. Hasta 200 personas.",
    icon: Building2,
    gradient: "from-violet-600 to-purple-800",
    text: "text-violet-700",
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=70",
    breadcrumb: "Packs Empresas",
    badgeOptions: ["Más Popular", "Premium", "Recomendado"],
  },
};

export default function PacksList() {
  const { category } = useParams<{ category: string }>();
  const [search, setSearch] = useState("");
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null); // "online" | "presupuesto"
  const [bookingPack, setBookingPack] = useState<{
    id: number; title: string; basePrice: string;
    duration?: string | null; minPersons?: number | null; maxPersons?: number | null; image1?: string | null;
  } | null>(null);

  const meta = CATEGORY_META[category ?? ""] ?? CATEGORY_META["dia"];
  const Icon = meta.icon;

  const { data: packs, isLoading } = trpc.packs.getByCategory.useQuery({
    category: (category as "dia" | "escolar" | "empresa") ?? "dia",
  });

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = (packs ?? []).filter((pack) => {
    const matchSearch = !search ||
      pack.title.toLowerCase().includes(search.toLowerCase()) ||
      (pack.shortDescription ?? "").toLowerCase().includes(search.toLowerCase());
    const matchBadge = !selectedBadge || pack.badge === selectedBadge;
    const matchType = !selectedType ||
      (selectedType === "online" ? pack.isOnlinePurchase : !pack.isOnlinePurchase);
    return matchSearch && matchBadge && matchType;
  });

  return (
    <PublicLayout>
      {/* ── Hero de categoría (mismo estilo que Experiences header) ─────────── */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16 relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={meta.image} alt={meta.title} className="w-full h-full object-cover opacity-30" />
          <div className={`absolute inset-0 bg-gradient-to-r ${meta.gradient} opacity-60`} />
        </div>
        <div className="relative container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href="/packs" className="hover:text-amber-400 transition-colors">Packs</Link>
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

      {/* ── Barra de filtros sticky (idéntica a Experiences) ─────────────────── */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="container py-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={`Buscar ${meta.breadcrumb.toLowerCase()}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
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

            {/* Type filter */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
              <select
                value={selectedType ?? ""}
                onChange={(e) => setSelectedType(e.target.value || null)}
                className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Tipo de reserva</option>
                <option value="online">Reserva online</option>
                <option value="presupuesto">Solicitar presupuesto</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* ── Resultados ───────────────────────────────────────────────────────── */}
      <section className="py-12">
        <div className="container">
          <div className="flex items-center justify-between mb-6">
            <p className="text-muted-foreground text-sm">
              <span className="font-semibold text-foreground">{isLoading ? "..." : filtered.length}</span> packs encontrados
            </p>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-card rounded-2xl overflow-hidden border border-border/50">
                  <div className="aspect-[16/10] bg-muted animate-pulse" />
                  <div className="p-5 space-y-3">
                    <div className="h-5 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                    <div className="h-10 bg-muted animate-pulse rounded mt-4" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-xl font-display font-semibold text-foreground mb-2">
                No se encontraron packs
              </h3>
              <p className="text-muted-foreground">Prueba con otros filtros o términos de búsqueda.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((pack) => {
                const includes = Array.isArray(pack.includes) ? pack.includes as string[] : [];
                return (
                  <div
                    key={pack.id}
                    className="group bg-card rounded-2xl overflow-hidden border border-border/50 card-hover h-full flex flex-col"
                  >
                    {/* Imagen — mismo aspect ratio que Experiences */}
                    <Link href={`/packs/${category}/${pack.slug}`}>
                      <div className="relative aspect-[16/10] overflow-hidden cursor-pointer bg-muted">
                        {pack.image1 ? (
                          <img
                            src={pack.image1}
                            alt={pack.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                            <Icon className="w-16 h-16 text-white/40" />
                          </div>
                        )}
                        {/* Badges */}
                        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                          {pack.badge && (
                            <Badge className="bg-orange-500 text-white text-xs font-bold">
                              {pack.badge}
                            </Badge>
                          )}
                          {pack.hasStay && (
                            <Badge className="bg-blue-600 text-white text-xs font-bold flex items-center gap-1">
                              <Bed className="w-3 h-3" /> Con estancia
                            </Badge>
                          )}
                          {pack.isFeatured && (
                            <Badge className="bg-amber-500 text-white text-xs font-bold">
                              ★ Destacado
                            </Badge>
                          )}
                        </div>
                        {/* Precio superpuesto (igual que en Experiences) */}
                        <div className="absolute bottom-3 right-3 bg-white/95 rounded-lg px-3 py-1.5 shadow-md">
                          <span className="text-orange-600 font-black text-lg leading-none">
                            {parseFloat(pack.basePrice).toFixed(0)}€
                          </span>
                          <span className="text-muted-foreground text-xs ml-1">
                            {pack.priceLabel?.includes("alumno") ? "/alumno" : "/persona"}
                          </span>
                        </div>
                      </div>
                    </Link>

                    {/* Contenido */}
                    <div className="p-5 flex flex-col flex-1">
                      <Link href={`/packs/${category}/${pack.slug}`}>
                        <h3 className="font-display font-semibold text-lg text-foreground mb-1 hover:text-accent transition-colors cursor-pointer">
                          {pack.title}
                        </h3>
                      </Link>
                      {pack.subtitle && (
                        <p className={cn("text-sm font-semibold mb-2", meta.text)}>{pack.subtitle}</p>
                      )}
                      {pack.shortDescription && (
                        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                          {pack.shortDescription}
                        </p>
                      )}

                      {/* Meta info — idéntico a Experiences */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                        {pack.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {pack.duration}
                          </span>
                        )}
                        {pack.minPersons && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {pack.maxPersons
                              ? `${pack.minPersons}–${pack.maxPersons} pers.`
                              : `Desde ${pack.minPersons} pers.`}
                          </span>
                        )}
                      </div>

                      {/* Includes preview */}
                      {includes.length > 0 && (
                        <ul className="space-y-1 mb-4">
                          {includes.slice(0, 3).map((item: string) => (
                            <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <Check className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", meta.text)} />
                              {item}
                            </li>
                          ))}
                          {includes.length > 3 && (
                            <li className="text-xs text-muted-foreground/60 pl-5">
                              +{includes.length - 3} más incluidos
                            </li>
                          )}
                        </ul>
                      )}

                      {/* CTAs — mismo estilo doble que Experiences */}
                      <div className="mt-auto">
                        <div className="flex gap-2">
                          {pack.isOnlinePurchase ? (
                            <button
                              onClick={() => setBookingPack({
                                id: pack.id,
                                title: pack.title,
                                basePrice: pack.basePrice,
                                duration: pack.duration,
                                minPersons: pack.minPersons,
                                maxPersons: pack.maxPersons,
                                image1: pack.image1,
                              })}
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
                          ) : (
                            <Link href="/contacto" style={{ flex: 1 }}>
                              <button
                                style={{
                                  width: "100%", padding: "0.6rem 0.75rem",
                                  background: "linear-gradient(135deg, #f97316, #ea580c)",
                                  border: "none", borderRadius: "0.5rem",
                                  color: "#fff", fontWeight: 700, fontSize: "0.8rem",
                                  cursor: "pointer", boxShadow: "0 3px 8px rgba(249,115,22,0.35)",
                                }}
                              >
                                📋 Presupuesto
                              </button>
                            </Link>
                          )}
                          <Link href={`/packs/${category}/${pack.slug}`}>
                            <button
                              style={{
                                flex: 1, padding: "0.6rem 0.75rem",
                                background: "transparent",
                                border: "1.5px solid #d1d5db", borderRadius: "0.5rem",
                                color: "#374151", fontWeight: 600, fontSize: "0.8rem",
                                cursor: "pointer",
                              }}
                            >
                              Ver detalles
                            </button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────────────────────── */}
      <section className="py-12 bg-muted/30 border-t border-border/50 text-center">
        <div className="container max-w-xl">
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">
            ¿Necesitas algo diferente?
          </h2>
          <p className="text-muted-foreground mb-5">
            Diseñamos packs a medida para grupos y eventos especiales.
          </p>
          <Link href="/contacto">
            <Button
              size="lg"
              style={{
                background: "linear-gradient(135deg, #f97316, #ea580c)",
                color: "#fff", fontWeight: 700,
              }}
              className="px-8"
            >
              Solicitar Presupuesto Personalizado
            </Button>
          </Link>
        </div>
      </section>

      {/* BookingModal */}
      {bookingPack && (
        <BookingModal
          product={{
            id: bookingPack.id,
            title: bookingPack.title,
            basePrice: bookingPack.basePrice,
            duration: bookingPack.duration ?? undefined,
            minPersons: bookingPack.minPersons ?? 1,
            maxPersons: bookingPack.maxPersons ?? 100,
            image1: bookingPack.image1 ?? undefined,
          }}
          isOpen={!!bookingPack}
          onClose={() => setBookingPack(null)}
        />
      )}
    </PublicLayout>
  );
}
