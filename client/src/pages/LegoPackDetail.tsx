import { useState } from "react";
import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Layers,
  Check,
  MessageCircle,
  Star,
  ShoppingCart,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Package,
  Users,
  Clock,
} from "lucide-react";

export default function LegoPackDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [activeImage, setActiveImage] = useState(0);

  const { data: pack, isLoading } = trpc.legoPacks.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug }
  );

  const { data: pricing } = trpc.legoPacks.calculatePrice.useQuery(
    { legoPackId: pack?.id ?? 0 },
    { enabled: !!pack?.id }
  );

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="container py-24 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando Lego Pack...</p>
        </div>
      </PublicLayout>
    );
  }

  if (!pack) {
    return (
      <PublicLayout>
        <div className="container py-24 text-center">
          <Layers className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Lego Pack no encontrado</h1>
          <p className="text-muted-foreground mb-6">
            El Lego Pack que buscas no existe o no está disponible.
          </p>
          <Link href="/lego-packs">
            <Button variant="outline">Ver todos los Lego Packs</Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  const images = [pack.image1, pack.image2, pack.image3, pack.image4]
    .filter(Boolean) as string[];
  if (pack.coverImageUrl && !images.includes(pack.coverImageUrl)) {
    images.unshift(pack.coverImageUrl);
  }

  const discountPct = pack.discountPercent ? parseFloat(String(pack.discountPercent)) : null;
  const isDiscountActive = discountPct && discountPct > 0 &&
    (!pack.discountExpiresAt || new Date(pack.discountExpiresAt) > new Date());

  const categoryHref = `/lego-packs/${pack.category}`;
  const categoryLabel = pack.category === "dia" ? "Lego Packs de Día"
    : pack.category === "escolar" ? "Lego Packs Escolares"
    : "Lego Packs Empresas";

  return (
    <PublicLayout>
      {/* ── Breadcrumb ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-50 border-b border-border/50">
        <div className="container py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-primary transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href="/lego-packs" className="hover:text-primary transition-colors">Lego Packs</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href={categoryHref} className="hover:text-primary transition-colors">{categoryLabel}</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-foreground font-medium truncate max-w-[200px]">{pack.title}</span>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <section className="py-12">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* ── Galería ─────────────────────────────────────────────────────── */}
            <div className="space-y-4">
              {/* Imagen principal */}
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-muted">
                {images.length > 0 ? (
                  <img
                    src={images[activeImage]}
                    alt={pack.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-indigo-600 to-purple-800 flex items-center justify-center">
                    <Layers className="w-24 h-24 text-white/30" />
                  </div>
                )}
                {isDiscountActive && (
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-red-500 text-white border-0 text-sm font-bold px-3 py-1">
                      -{discountPct}% DESCUENTO
                    </Badge>
                  </div>
                )}
                {pack.badge && (
                  <div className="absolute top-4 left-4">
                    <Badge className="bg-orange-500 text-white border-0 text-sm font-bold">
                      {pack.badge}
                    </Badge>
                  </div>
                )}
                {/* Navegación galería */}
                {images.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImage((i) => (i - 1 + images.length) % images.length)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setActiveImage((i) => (i + 1) % images.length)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <ChevronRightIcon className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>

              {/* Miniaturas */}
              {images.length > 1 && (
                <div className="flex gap-2">
                  {images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImage(i)}
                      className={`w-20 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        i === activeImage ? "border-indigo-500 opacity-100" : "border-transparent opacity-60 hover:opacity-80"
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Info ─────────────────────────────────────────────────────────── */}
            <div className="space-y-6">
              {/* Categoría + Lego Pack badge */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs border-indigo-300 text-indigo-700 bg-indigo-50">
                  <Layers className="w-3 h-3 mr-1" />
                  Lego Pack
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {categoryLabel}
                </Badge>
              </div>

              <div>
                <h1 className="text-3xl md:text-4xl font-black text-foreground mb-2">
                  {pack.title}
                </h1>
                {pack.subtitle && (
                  <p className="text-lg text-indigo-600 font-semibold">{pack.subtitle}</p>
                )}
              </div>

              {pack.shortDescription && (
                <p className="text-muted-foreground leading-relaxed">{pack.shortDescription}</p>
              )}

              {/* Precio */}
              <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                {pricing ? (
                  <div>
                    <p className="text-sm text-indigo-600 font-medium mb-1">Precio total del pack</p>
                    {isDiscountActive && pricing.totalOriginal > pricing.totalFinal ? (
                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl font-black text-indigo-700">
                          {pricing.totalFinal.toFixed(2)} €
                        </span>
                        <span className="text-lg text-muted-foreground line-through">
                          {pricing.totalOriginal.toFixed(2)} €
                        </span>
                        <Badge className="bg-red-500 text-white border-0">
                          -{discountPct}%
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-3xl font-black text-indigo-700">
                        {pricing.totalFinal.toFixed(2)} €
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Precio calculado con todas las líneas activas
                    </p>
                  </div>
                ) : pack.priceLabel ? (
                  <div>
                    <p className="text-sm text-indigo-600 font-medium mb-1">Precio</p>
                    <p className="text-2xl font-black text-indigo-700">{pack.priceLabel}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-indigo-600 font-medium mb-1">Precio</p>
                    <p className="text-xl font-bold text-indigo-700">Consultar presupuesto</p>
                  </div>
                )}
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3">
                {pack.isOnlineSale ? (
                  <Button
                    size="lg"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                  >
                    <ShoppingCart className="w-5 h-5 mr-2" />
                    Reservar Online
                  </Button>
                ) : null}
                <Link href={`/presupuesto?producto=${encodeURIComponent(pack.title)}&tipo=lego-pack`} className="flex-1">
                  <Button
                    size="lg"
                    variant={pack.isOnlineSale ? "outline" : "default"}
                    className={`w-full font-bold ${!pack.isOnlineSale ? "bg-indigo-600 hover:bg-indigo-700 text-white" : ""}`}
                  >
                    <MessageCircle className="w-5 h-5 mr-2" />
                    Solicitar Presupuesto
                  </Button>
                </Link>
              </div>

              {/* Highlights */}
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-indigo-500" />
                  Precio desglosado por línea
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-indigo-500" />
                  Composición modular
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-indigo-500" />
                  Cancelación gratuita 48h
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Descripción completa ─────────────────────────────────────────────── */}
      {pack.description && (
        <section className="py-12 bg-slate-50 border-t border-border/50">
          <div className="container max-w-3xl">
            <h2 className="text-2xl font-black mb-6 text-foreground">Descripción</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {pack.description}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── Líneas del pack ─────────────────────────────────────────────────── */}
      {pricing && pricing.lines.length > 0 && (
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="flex items-center gap-3 mb-6">
              <Layers className="w-6 h-6 text-indigo-600" />
              <h2 className="text-2xl font-black text-foreground">Qué incluye este Lego Pack</h2>
            </div>
            <div className="space-y-3">
              {pricing.lines.filter((l) => l.isClientVisible).map((line) => (
                <div
                  key={line.lineId}
                  className={`flex items-center justify-between p-4 rounded-xl border ${
                    line.isActiveInOperation
                      ? "bg-white border-indigo-100"
                      : "bg-slate-50 border-slate-200 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      line.isActiveInOperation ? "bg-indigo-100" : "bg-slate-200"
                    }`}>
                      <Package className={`w-4 h-4 ${line.isActiveInOperation ? "text-indigo-600" : "text-slate-400"}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">
                        {line.internalName || line.sourceName}
                      </p>
                      {line.groupLabel && (
                        <p className="text-xs text-muted-foreground">{line.groupLabel}</p>
                      )}
                      {!line.isActiveInOperation && (
                        <p className="text-xs text-orange-600 font-medium">No disponible actualmente</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {line.discountAmount > 0 ? (
                      <div>
                        <p className="text-sm font-bold text-indigo-700">{line.finalPrice.toFixed(2)} €</p>
                        <p className="text-xs text-muted-foreground line-through">{line.basePrice.toFixed(2)} €</p>
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-foreground">{line.finalPrice.toFixed(2)} €</p>
                    )}
                    {line.quantity > 1 && (
                      <p className="text-xs text-muted-foreground">x{line.quantity}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Total */}
            {pricing.totalDiscount > 0 && (
              <div className="mt-4 p-4 rounded-xl bg-green-50 border border-green-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-green-700">Ahorro total</span>
                <span className="text-lg font-black text-green-700">-{pricing.totalDiscount.toFixed(2)} €</span>
              </div>
            )}
            <div className="mt-2 p-4 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-indigo-700">Total Lego Pack</span>
              <span className="text-2xl font-black text-indigo-700">{pricing.totalFinal.toFixed(2)} €</span>
            </div>
          </div>
        </section>
      )}

      {/* CTA final */}
      <section className="py-14 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-center">
        <div className="container max-w-2xl">
          <Star className="w-10 h-10 mx-auto mb-4 text-indigo-200" />
          <h2 className="text-3xl font-black mb-3">
            ¿Te interesa este Lego Pack?
          </h2>
          <p className="text-indigo-100 mb-6 text-lg">
            Solicita tu presupuesto personalizado sin compromiso.
          </p>
          <Link href={`/presupuesto?producto=${encodeURIComponent(pack.title)}&tipo=lego-pack`}>
            <Button
              size="lg"
              className="bg-white text-indigo-600 hover:bg-indigo-50 font-bold px-8"
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Solicitar Presupuesto
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
