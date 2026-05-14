import { useState } from "react";
import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { trackCTAClick } from "@/lib/ga4";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Search,
  ChevronRight,
  MessageCircle,
  Star,
  Sun,
  GraduationCap,
  Building2,
  Layers,
} from "lucide-react";
import AddToCartModal from "@/components/AddToCartModal";

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
  estancia: {
    title: "Hotel + Actividades",
    subtitle: "Packs con alojamiento y actividades acuáticas incluidas",
    description: "Combina tu estancia en el Hotel Náyade con las mejores actividades del lago. Pack completo para 2 personas con 10% de descuento.",
    icon: Layers,
    gradient: "from-amber-600 to-orange-800",
    text: "text-amber-700",
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=70",
    breadcrumb: "Hotel + Actividades",
    badgeOptions: ["Más Popular", "Premium", "Recomendado", "Pareja", "Novedad"],
  },
};

export default function LegoPacksList() {
  const { category } = useParams<{ category: string }>();
  const [search, setSearch] = useState("");
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const [cartPack, setCartPack] = useState<{
    id: number; title: string; basePrice: number;
    image1?: string | null; slug?: string | null;
    discountPercent?: number | null; discountExpiresAt?: string | Date | null;
  } | null>(null);

  const validCategory = (["dia", "escolar", "empresa", "estancia"].includes(category ?? "") ? category : "dia") as "dia" | "escolar" | "empresa" | "estancia";
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

      {/* ── Banner colegios — sólo visible en la categoría escolar ─────────── */}
      {validCategory === "escolar" && (
        <>
          {/* Transición curva: el bloque claro surge del hero oscuro */}
          <div
            className="relative z-10 pointer-events-none overflow-hidden"
            style={{ marginTop: -64, height: 64 }}
          >
            <svg
              viewBox="0 0 1440 64"
              xmlns="http://www.w3.org/2000/svg"
              className="absolute bottom-0 w-full block"
              preserveAspectRatio="none"
              style={{ height: 64 }}
            >
              <path d="M0,64 C360,8 1080,8 1440,64 L1440,64 L0,64 Z" fill="#F8FAFC" />
            </svg>
          </div>

          <section className="relative overflow-hidden" style={{ background: "#F8FAFC" }}>
            {/* Decoración radial sutil */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)", transform: "translate(30%, -30%)" }} />
              <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full" style={{ background: "radial-gradient(circle, rgba(5,150,105,0.05) 0%, transparent 70%)", transform: "translate(-30%, 30%)" }} />
            </div>

            <div className="relative z-10 container py-14 lg:py-20">
              <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

                {/* Info */}
                <div className="flex-1">
                  <div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5"
                    style={{ background: "#ECFDF5", border: "1.5px solid #6EE7B7", color: "#065F46" }}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    Programa Escolar Personalizado
                  </div>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-heading font-bold leading-tight mb-4" style={{ color: "#0F172A" }}>
                    ¿Buscas algo a medida<br />
                    <span style={{ color: "#059669" }}>para tu grupo?</span>
                  </h2>
                  <p className="text-base sm:text-lg leading-relaxed max-w-xl mb-7" style={{ color: "#475569" }}>
                    Los Lego Packs son perfectos para reservas individuales. Para grupos escolares de
                    más de 20 alumnos diseñamos un programa completo con actividades, monitores y
                    logística adaptada a vuestra fecha y edad.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    {[
                      "De 20 a 300 participantes",
                      "Monitores titulados incluidos",
                      "Seguro de accidentes",
                      "Respuesta en 24h",
                    ].map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5"
                        style={{ color: "#065F46", background: "#ECFDF5", border: "1px solid #A7F3D0" }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#10B981" }} />
                        {f}
                      </span>
                    ))}
                  </div>
                </div>

                {/* CTA card */}
                <div className="w-full lg:w-80 xl:w-96 flex-shrink-0">
                  <div
                    className="rounded-3xl overflow-hidden"
                    style={{
                      background: "#FFFFFF",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 16px 40px rgba(16,185,129,0.14), 0 0 0 1px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ height: 6, background: "linear-gradient(90deg, #10b981, #34d399, #10b981)" }} />
                    <div className="p-7">
                      <h3 className="text-xl font-heading font-bold mb-1.5" style={{ color: "#0F172A" }}>Excursión Escolar</h3>
                      <p className="text-sm mb-6" style={{ color: "#64748B" }}>
                        Presupuesto gratuito · Sin compromiso · &lt;24h de respuesta
                      </p>
                      <Link href="/colegios">
                        <button
                          onClick={() => trackCTAClick('solicitar_programa_escolar', 'lego_escolar_banner')}
                          className="w-full py-3.5 rounded-2xl font-display font-bold text-white text-sm transition-all duration-200 hover:opacity-90 active:scale-[0.98] mb-3"
                          style={{
                            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                            boxShadow: "0 6px 20px rgba(16,185,129,0.35)",
                          }}
                        >
                          Solicitar Programa Escolar →
                        </button>
                      </Link>
                      <p className="text-center text-xs" style={{ color: "#94A3B8" }}>
                        También puedes llamarnos para consultar
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </section>
        </>
      )}

      {/* ── Barra de filtros sticky ───────────────────────────────────────────── */}
      <section className="sticky top-20 z-30 bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm">
        <div className="container py-3">
          {/* Search — always full width */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={`Buscar ${meta.breadcrumb.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full h-9 text-sm"
            />
          </div>

          {/* Badge pills — single scrollable row on mobile */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
            <button
              onClick={() => setSelectedBadge(null)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
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
                  "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
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

                        {/* Banda de precio mínimo */}
                        {(pack.minPrice || pack.priceLabel) && (
                          <div className="absolute bottom-3 right-3">
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.2rem",
                                background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
                                color: "#fff",
                                fontWeight: 800,
                                fontSize: "0.82rem",
                                padding: "0.3rem 0.75rem",
                                borderRadius: "999px",
                                boxShadow: "0 2px 10px rgba(249,115,22,0.55)",
                                letterSpacing: "0.01em",
                                backdropFilter: "blur(4px)",
                                border: "1.5px solid rgba(255,255,255,0.25)",
                              }}
                            >
                              <span style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.9 }}>Desde</span>
                              {pack.minPrice
                                ? <><strong style={{ fontSize: "0.95rem" }}>{Math.round(pack.minPrice)}</strong><span style={{ fontSize: "0.8rem" }}>€</span></>
                                : <strong>{pack.priceLabel}</strong>
                              }
                            </span>
                          </div>
                        )}
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

                        {/* Precio en el área de contenido */}
                        {(pack.minPrice || pack.priceLabel) && (
                          <div className="flex items-baseline gap-1.5 mb-3">
                            <span className="text-xs text-muted-foreground font-medium">Desde</span>
                            <span className="text-2xl font-extrabold text-orange-500">
                              {pack.minPrice
                                ? `${Math.round(pack.minPrice)}€`
                                : pack.priceLabel
                              }
                            </span>
                            {pack.minPrice && (
                              <span className="text-xs text-muted-foreground">/ persona</span>
                            )}
                          </div>
                        )}

                        {/* CTAs */}
                        <div className="mt-auto pt-3 border-t border-border/50 flex gap-2">
                          {pack.isOnlineSale ? (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCartPack({
                                  id: pack.id,
                                  title: pack.title,
                                  // Usar minPrice calculado si está disponible, si no parsear priceLabel
                                  basePrice: pack.minPrice ?? (pack.priceLabel ? parseFloat(pack.priceLabel.replace(/[^0-9.,]/g, "").replace(",", ".")) || 0 : 0),
                                  image1: pack.image1 || pack.coverImageUrl,
                                  slug: pack.slug,
                                  discountPercent: pack.discountPercent ? parseFloat(String(pack.discountPercent)) : null,
                                  discountExpiresAt: pack.discountExpiresAt ?? null,
                                });
                              }}
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
                          ) : (
                            <Link href="/presupuesto" style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
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
                          <Link href={`/lego-packs/detalle/${pack.slug}`} onClick={(e) => e.stopPropagation()}>
                            <button
                              style={{
                                padding: "0.6rem 0.75rem",
                                background: "transparent",
                                border: "1.5px solid #d1d5db", borderRadius: "0.5rem",
                                color: "#374151", fontWeight: 600, fontSize: "0.8rem",
                                cursor: "pointer",
                              }}
                            >
                              Ver más
                            </button>
                          </Link>
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
      {/* AddToCartModal */}
      {cartPack && (
        <AddToCartModal
          isOpen={!!cartPack}
          onClose={() => setCartPack(null)}
          product={{
            id: cartPack.id,
            title: cartPack.title,
            basePrice: cartPack.basePrice,
            image1: cartPack.image1 ?? undefined,
            slug: cartPack.slug ?? undefined,
            discountPercent: cartPack.discountPercent ?? undefined,
            discountExpiresAt: cartPack.discountExpiresAt ?? undefined,
          }}
        />
      )}
    </PublicLayout>
  );
}
