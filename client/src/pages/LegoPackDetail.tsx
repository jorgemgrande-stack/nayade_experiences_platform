import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import { useMarketingConsent } from "@/hooks/useMarketingConsent";
import { trackEvent } from "@/lib/meta-pixel/client";
import PublicLayout from "@/components/PublicLayout";
import { ReviewSection } from "@/components/ReviewSection";
import { LegoPackLineSelector } from "@/components/LegoPackLineSelector";
import { trpc } from "@/lib/trpc";
import { usePublicPhone } from "@/hooks/usePublicPhone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/contexts/CartContext";
import { DiscountRibbon, getDiscountedPrice } from "@/components/DiscountRibbon";
import {
  Check, Clock, Users, Star, ShoppingCart,
  MessageCircle, Phone, Calendar, Info,
  Sun, GraduationCap, Building2, Layers, Package, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

const CATEGORY_META: Record<string, {
  label: string; href: string; gradient: string;
  text: string; bg: string; border: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  dia: {
    label: "Lego Packs de Día", href: "/lego-packs/dia",
    gradient: "from-sky-600 to-blue-800",
    text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200",
    icon: Sun,
  },
  escolar: {
    label: "Lego Packs Escolares", href: "/lego-packs/escolar",
    gradient: "from-emerald-600 to-teal-800",
    text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
    icon: GraduationCap,
  },
  empresa: {
    label: "Lego Packs Empresas", href: "/lego-packs/empresa",
    gradient: "from-violet-600 to-purple-800",
    text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200",
    icon: Building2,
  },
};

export default function LegoPackDetail() {
  const { category, slug } = useParams<{ category: string; slug: string }>();
  const { phone, phoneTel } = usePublicPhone();
  const [people, setPeople] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
  const [customPackPrice, setCustomPackPrice] = useState<number | null>(null);
  const [legoPackLinePeople, setLegoPackLinePeople] = useState<Record<number, number>>({});
  const [legoPackLineNames, setLegoPackLineNames] = useState<Record<number, string>>({});
  const { addItem, openCart } = useCart();
  const hasConsent = useMarketingConsent();

  const { data: pack, isLoading } = trpc.legoPacks.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug }
  );

  const catKeyForQuery = (category ?? "dia") as "dia" | "escolar" | "empresa" | "estancia";
  const { data: relatedPacks } = trpc.legoPacks.listPublicByCategory.useQuery(
    { category: catKeyForQuery },
    { enabled: !!pack }
  );

  const catKey = category ?? pack?.category ?? "dia";
  const meta = CATEGORY_META[catKey] ?? CATEGORY_META["dia"];

  // pricing viene del backend: { lines, totalOriginal, totalDiscount, totalFinal }
  const pricing = pack?.pricing as {
    lines: Array<{
      lineId: number;
      sourceName: string;
      internalName?: string | null;
      groupLabel?: string | null;
      isOptional: boolean;
      isClientVisible: boolean;
      isActiveInOperation: boolean;
      quantity: number;
      basePrice: number;
      discountAmount: number;
      finalPrice: number;
      // Visual-only override price for accommodation lines
      overridePrice?: number | null;
      overridePriceLabel?: string | null;
      frontendNote?: string | null;
    }>;
    totalOriginal: number;
    totalDiscount: number;
    totalFinal: number;
  } | undefined;

  // Precio base: usa customPackPrice si el cliente personalizó el pack
  const basePrice = customPackPrice ?? pricing?.totalFinal ?? 0;

  // Descuento activo a nivel de pack
  const discountedPrice = pack
    ? getDiscountedPrice(
        basePrice,
        (pack as any)?.discountPercent as string | number | null,
        (pack as any)?.discountExpiresAt as string | null
      )
    : null;

  const effectivePrice = discountedPrice ?? basePrice;
  const totalEstimado = effectivePrice * people;

  // Líneas visibles del pack (para "Qué incluye")
  const visibleLines = (pricing?.lines ?? []).filter((l) => l.isClientVisible);

  // Imagen principal
  const heroImage = pack?.coverImageUrl ?? (pack?.image1 ?? null);

  // ViewContent: se dispara cuando el pack carga y hay consentimiento
  useEffect(() => {
    if (!hasConsent || !pack?.id) return;
    trackEvent('ViewContent', {
      content_ids: [String(pack.id)],
      content_name: pack.title,
      content_type: 'product',
      value: basePrice,
      currency: 'EUR',
    }).catch(() => {});
  }, [hasConsent, pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <PublicLayout forcePublicLight>
        <div className="container max-w-6xl py-12 grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div><Skeleton className="h-80 w-full rounded-2xl" /></div>
        </div>
      </PublicLayout>
    );
  }

  if (!pack) {
    return (
      <PublicLayout forcePublicLight>
        <div className="container py-20 text-center text-slate-500">
          <p className="text-lg">Lego Pack no encontrado.</p>
          <Link href="/lego-packs">
            <Button className="mt-4">Volver a Lego Packs</Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout forcePublicLight>
      {/* Hero — foto de fondo como en PackDetail */}
      <section className="relative text-white overflow-hidden" style={{ minHeight: '420px' }}>
        <div className="absolute inset-0">
          {heroImage ? (
            <img src={heroImage} alt={pack.title} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${meta.gradient}`} />
          )}
          {/* Overlay oscuro para legibilidad */}
          <div className="absolute inset-0 bg-black/50" />
          {/* Banda de color de categoría en la parte inferior */}
          <div className={`absolute bottom-0 left-0 right-0 h-1.5 bg-gradient-to-r ${meta.gradient}`} />
        </div>
        <div className="relative container max-w-6xl pt-8 pb-12">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-white/70 mb-8 flex-wrap">
            <Link href="/" className="hover:text-white transition-colors">Inicio</Link>
            <span>/</span>
            <Link href="/lego-packs" className="hover:text-white transition-colors">Lego Packs</Link>
            <span>/</span>
            <Link href={meta.href} className="hover:text-white transition-colors">{meta.label}</Link>
            <span>/</span>
            <span className="text-white font-medium">{pack.title}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {pack.badge && (
              <Badge className="bg-orange-500 text-white border-0 text-sm px-3 py-1">{pack.badge}</Badge>
            )}
            {pack.isFeatured && (
              <Badge className="bg-yellow-400 text-yellow-900 border-0 flex items-center gap-1">
                <Star className="w-3 h-3" /> Destacado
              </Badge>
            )}
            <Badge className="bg-white/20 text-white border-0 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Lego Pack
            </Badge>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black mb-3 drop-shadow-lg">{pack.title}</h1>
          {pack.subtitle && <p className="text-xl text-white/90 drop-shadow">{pack.subtitle}</p>}
        </div>
      </section>

      {/* Contenido principal */}
      <section className="relative mt-8 pb-16 bg-slate-50">
        <div className="container max-w-6xl grid lg:grid-cols-3 gap-8 items-start">
          {/* Columna izquierda */}
          <div className="lg:col-span-2 space-y-6">
            {/* Descripción */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-xl font-black text-slate-900 mb-3">Descripción</h2>
              <p className="text-slate-600 leading-relaxed">
                {pack.description || pack.shortDescription}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-slate-100">
                {(pack as any).duration && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Clock className={`w-4 h-4 ${meta.text}`} />
                    <span>{(pack as any).duration}</span>
                  </div>
                )}
                {(pack as any).minPersons && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className={`w-4 h-4 ${meta.text}`} />
                    <span>
                      {(pack as any).maxPersons
                        ? `${(pack as any).minPersons}–${(pack as any).maxPersons} personas`
                        : `Mín. ${(pack as any).minPersons} personas`}
                    </span>
                  </div>
                )}
                {pack.targetAudience && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Star className={`w-4 h-4 ${meta.text}`} />
                    <span>{pack.targetAudience}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Qué incluye — Selector interactivo de líneas */}
            {visibleLines.length > 0 && (
              <div className={`${meta.bg} border ${meta.border} rounded-2xl p-5`}>
                <h3 className="font-black text-slate-900 mb-4 flex items-center gap-2">
                  <Check className={`w-5 h-5 ${meta.text}`} /> Personaliza tu pack
                </h3>
                <LegoPackLineSelector
                  packId={pack.id}
                  initialActiveLineIds={selectedLineIds.length > 0 ? selectedLineIds : undefined}
                  initialLines={pricing?.lines}
                  onConfirm={(activeIds, customPrice, linePeople, lineNames) => {
                    setSelectedLineIds(activeIds);
                    setCustomPackPrice(customPrice);
                    setLegoPackLinePeople(linePeople);
                    setLegoPackLineNames(lineNames);
                  }}
                  gradientClass={meta.gradient}
                  textColorClass={meta.text}
                />
              </div>
            )}

            {/* Horarios */}
            {(pack as any).schedule && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-black text-slate-900 mb-2 flex items-center gap-2">
                  <Calendar className={`w-5 h-5 ${meta.text}`} /> Disponibilidad y horarios
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed">{(pack as any).schedule}</p>
              </div>
            )}

            {/* Nota */}
            {(pack as any).note && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-amber-800 text-sm">{(pack as any).note}</p>
              </div>
            )}
          </div>

          {/* Widget de precio — idéntico a PackDetail */}
          <div className="sticky top-28">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6 relative overflow-hidden">
              {/* Ribbon de descuento */}
              <DiscountRibbon
                discountPercent={(pack as any)?.discountPercent}
                discountExpiresAt={(pack as any)?.discountExpiresAt}
                variant="card"
              />

              {/* Precio desde */}
              <div className="mb-4">
                <p className="text-sm text-slate-500 mb-1">
                  {pack.priceLabel || "Precio por persona desde"}
                </p>
                {discountedPrice ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-orange-500">
                      {discountedPrice.toFixed(0)}€
                    </span>
                    <span className="text-lg text-slate-400 line-through">
                      {basePrice.toFixed(0)}€
                    </span>
                    <span className="text-slate-500 text-sm">/persona</span>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-slate-900">
                      {basePrice > 0 ? `${basePrice.toFixed(0)}€` : "Consultar"}
                    </span>
                    {basePrice > 0 && (
                      <span className="text-slate-500 text-sm">/persona</span>
                    )}
                  </div>
                )}
              </div>

              {/* Badge de oferta */}
              {discountedPrice && (
                <div className="mb-4">
                  <DiscountRibbon
                    discountPercent={(pack as any)?.discountPercent}
                    discountExpiresAt={(pack as any)?.discountExpiresAt}
                    variant="detail"
                  />
                </div>
              )}

              {/* Selector de personas */}
              {pack.isOnlineSale && (
                <div className="mb-4">
                  <label className="text-sm font-semibold text-slate-700 block mb-2">
                    Número de personas
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPeople(Math.max(1, people - 1))}
                      className="w-9 h-9 rounded-full border border-slate-300 flex items-center justify-center text-lg font-bold hover:bg-slate-100 transition-colors"
                    >-</button>
                    <span className="text-xl font-black w-8 text-center">{people}</span>
                    <button
                      onClick={() => setPeople(people + 1)}
                      className="w-9 h-9 rounded-full border border-slate-300 flex items-center justify-center text-lg font-bold hover:bg-slate-100 transition-colors"
                    >+</button>
                  </div>
                </div>
              )}

              {/* Resumen de precio */}
              {pack.isOnlineSale && basePrice > 0 && (
                <div className="bg-slate-50 rounded-xl p-3 mb-5 text-sm">
                  <div className="flex justify-between text-slate-600 mb-1">
                    <span>{effectivePrice.toFixed(0)}€ × {people} personas</span>
                    <span>{totalEstimado.toFixed(0)}€</span>
                  </div>
                  <div className="flex justify-between font-black text-slate-900 text-base border-t border-slate-200 pt-2 mt-2">
                    <span>Total estimado</span>
                    <span className="text-orange-600">{totalEstimado.toFixed(0)}€</span>
                  </div>
                </div>
              )}

              {/* Selector de fecha preferida */}
              {pack.isOnlineSale && (
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    <Calendar className="w-4 h-4 inline mr-1 text-slate-500" />
                    Fecha preferida
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
              )}

              {/* Botón Añadir al carrito */}
              {pack.isOnlineSale ? (
                <Button
                  size="lg"
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base mb-3"
                  onClick={() => {
                    if (!selectedDate) {
                      toast.info("Selecciona una fecha antes de añadir al carrito");
                      return;
                    }
                    addItem({
                      productId: pack.id,
                      productName: pack.title,
                      productSlug: pack.slug ?? "",
                      productImage: heroImage ?? "",
                      bookingDate: selectedDate,
                      people,
                      minPersons: 1,
                      maxPersons: 999,
                      pricePerPerson: effectivePrice,
                      estimatedTotal: effectivePrice * people,
                      extras: [],
                      legoPackLineIds: selectedLineIds.length > 0 ? selectedLineIds : undefined,
                      legoPackLinePeople: Object.keys(legoPackLinePeople).length > 0 ? legoPackLinePeople : undefined,
                      legoPackLineNames: Object.keys(legoPackLineNames).length > 0 ? legoPackLineNames : undefined,
                    });
                    openCart();
                    toast.success("Lego Pack añadido al carrito");
                  }}
                >
                  <ShoppingCart className="w-5 h-5 mr-2" /> Añadir al carrito
                </Button>
              ) : null}

              <Link href={`/presupuesto?legoPack=${pack.slug ?? ""}`}>
                <Button variant="outline" size="lg" className="w-full font-semibold mb-4">
                  <MessageCircle className="w-4 h-4 mr-2" /> Solicitar Presupuesto
                </Button>
              </Link>

              <div className="border-t border-slate-100 pt-4 space-y-2">
                <a
                  href={phoneTel}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-orange-600 transition-colors"
                >
                  <Phone className="w-4 h-4" /> {phone}
                </a>
                <p className="text-xs text-slate-400">Cancelación gratuita hasta 48h antes</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Galería adicional — image1..4 del gestor */}
      {(() => {
        const galleryImgs = [
          (pack as any).image1,
          (pack as any).image2,
          (pack as any).image3,
          (pack as any).image4,
        ].filter((img): img is string => !!img);
        if (galleryImgs.length === 0) return null;
        return (
          <section className="py-10 bg-slate-50 border-t border-slate-100">
            <div className="container max-w-6xl">
              <h2 className="text-2xl font-black text-slate-900 mb-6">Galería</h2>
              <div className={`grid gap-3 ${galleryImgs.length === 1 ? "grid-cols-1 max-w-lg" : galleryImgs.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
                {galleryImgs.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`${pack.title} ${i + 1}`}
                    className="w-full aspect-square object-cover rounded-xl hover:opacity-90 transition-opacity cursor-pointer"
                  />
                ))}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Reseñas de clientes */}
      <section className="py-12 bg-white border-t border-slate-100">
        <div className="container max-w-5xl">
          <ReviewSection entityType="pack" entityId={pack.id} theme="auto" />
        </div>
      </section>

      {/* Más Lego Packs de la misma categoría */}
      {(() => {
        const others = (relatedPacks ?? [])
          .filter((p: any) => p.id !== pack.id)
          .slice(0, 3);
        if (others.length === 0) return null;
        return (
          <section className="py-12 bg-slate-50 border-t border-slate-100">
            <div className="container max-w-6xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-slate-900">
                  Más {meta.label}
                </h2>
                <Link href={meta.href} className={`text-sm font-semibold ${meta.text} hover:underline flex items-center gap-1`}>
                  Ver todos <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              <div className={`grid gap-5 ${others.length === 1 ? "grid-cols-1 max-w-sm" : others.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                {others.map((p: any) => {
                  const cardImg = p.image1 || p.coverImageUrl;
                  const minP = p.minPrice as number | null;
                  return (
                    <Link key={p.id} href={`/lego-packs/detalle/${p.slug}`}>
                      <div className="group rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col h-full">
                        <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                          {cardImg ? (
                            <img src={cardImg} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                              <Layers className="w-12 h-12 text-white/40" />
                            </div>
                          )}
                          {p.badge && (
                            <div className="absolute top-3 left-3">
                              <Badge className="bg-orange-500 text-white border-0 text-xs font-bold">{p.badge}</Badge>
                            </div>
                          )}
                          {minP && minP > 0 && (
                            <div className="absolute bottom-3 right-3">
                              <span className="text-xs font-black px-2.5 py-1 rounded-full bg-orange-500 text-white shadow">
                                Desde {minP.toFixed(0)}€
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <p className="font-black text-slate-900 text-sm leading-snug group-hover:text-orange-600 transition-colors">{p.title}</p>
                          {p.shortDescription && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.shortDescription}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })()}
    </PublicLayout>
  );
}


