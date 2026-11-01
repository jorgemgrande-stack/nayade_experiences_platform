/**
 * Ficha de producto de la tienda online de una pyme (`/tienda/:slug`): nombre, imágenes, descripción, precio con
 * IVA incluido, variantes y cantidad. Reutiliza el carrito y el pago actuales. Solo muestra lo que el producto
 * configura: ni reseñas inventadas, ni seguro, cancelación o dificultad. Lógica en shared/storefront.ts.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { ChevronLeft, ChevronRight, CheckCircle, Clock, Mail, Minus, Phone, Plus, ShoppingCart, XCircle } from "lucide-react";
import { toast } from "sonner";
import PublicLayout from "@/components/PublicLayout";
import { ReviewSection } from "@/components/ReviewSection";
import { useStorefront } from "@/components/StorefrontRoute";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { isPurchasable } from "@shared/shopOrders";
import {
  buildGenericCartLine,
  clampQuantity,
  FALLBACK_GENERIC_STOREFRONT,
  formatEuros,
  fromPrice,
  MAX_QUANTITY,
  needsServiceDate,
  SHOP_PATH,
  variantUnitPrice,
} from "@shared/storefront";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProductDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { phone, phoneTel, email } = usePublicContact();
  const { storefront } = useStorefront();
  const shop = storefront ?? FALLBACK_GENERIC_STOREFRONT;
  const { addItem, openCart } = useCart();
  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState<number | undefined>(undefined);
  const [date, setDate] = useState("");

  const { data: product, isLoading } = trpc.public.getExperienceBySlug.useQuery({ slug: slug ?? "" }, { enabled: !!slug, retry: false });
  const { data: variants = [] } = trpc.public.getVariantsByExperience.useQuery({ experienceId: product?.id ?? 0 }, { enabled: !!product?.id });

  const p = (product ?? {}) as Row;
  useDocumentMeta(product ? { title: product.title, description: str(p.metaDescription) ?? str(p.shortDescription), image: str(p.coverImageUrl) ?? str(p.image1) } : null);

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="container py-20 flex items-center justify-center" role="status" aria-label="Cargando">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </PublicLayout>
    );
  }

  if (!product) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-md mx-auto">
          <h1 className="text-2xl font-bold mb-2">Producto no encontrado</h1>
          <p className="text-muted-foreground mb-6">Este producto no está disponible o se ha retirado de la tienda.</p>
          <Button asChild>
            <Link href={SHOP_PATH}>Ver la tienda</Link>
          </Button>
        </div>
      </PublicLayout>
    );
  }

  const images = [p.image1, p.image2, p.image3, p.image4].map(str).filter((x): x is string => !!x);
  const gallery = images.length ? images : list(p.gallery);
  if (!gallery.length && str(p.coverImageUrl)) gallery.push(str(p.coverImageUrl)!);
  const current = gallery[Math.min(imageIndex, gallery.length - 1)];

  const basePrice = Number(product.basePrice ?? 0);
  const hasPrice = Number.isFinite(basePrice) && basePrice > 0;
  const variant = variants.find((v) => v.id === variantId);
  const unit = variantUnitPrice(basePrice, variant);
  const shownPrice = variant || !variants.length ? unit : fromPrice(basePrice, variants);
  const total = unit * clampQuantity(quantity);
  const dated = needsServiceDate(product, shop);
  const includes = list(product.includes);
  const excludes = list(product.excludes);
  const description = str(product.description) ?? str(product.shortDescription);
  const duration = str(product.duration);
  const requirements = str(product.requirements);

  // Publicado pero no a la venta: se enseña como agotado y no se puede añadir (el pago también lo rechaza)
  const soldOut = !isPurchasable(product);

  const add = () => {
    if (soldOut) return;
    const r = buildGenericCartLine({ product: { ...product, coverImageUrl: str(p.coverImageUrl), image1: str(p.image1) }, variant, quantity, date, storefront: shop }, variants);
    if (!r.ok) {
      if (r.reason === "variant_required") toast.info("Elige una opción antes de añadir al carrito");
      else if (r.reason === "date_required") toast.info("Elige una fecha antes de añadir al carrito");
      else toast.info("Este producto no tiene precio para comprarlo online");
      return;
    }
    addItem(r.line);
    openCart();
  };

  return (
    <PublicLayout>
      <nav aria-label="Ruta de navegación" className="container py-4">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <li><Link href="/" className="hover:text-primary">Inicio</Link></li>
          <li aria-hidden="true"><ChevronRight className="w-3.5 h-3.5" /></li>
          <li><Link href={SHOP_PATH} className="hover:text-primary">Tienda</Link></li>
          <li aria-hidden="true"><ChevronRight className="w-3.5 h-3.5" /></li>
          <li className="text-foreground min-w-0 break-words">{product.title}</li>
        </ol>
      </nav>

      <div className="container pb-16 text-foreground">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10">
          {/* Imágenes */}
          <div className="lg:col-span-3 min-w-0">
            {current ? (
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3] bg-muted">
                <img src={current} alt={product.title} className="w-full h-full object-cover" />
                {gallery.length > 1 && (
                  <>
                    <button type="button" aria-label="Imagen anterior" onClick={() => setImageIndex((i) => (i - 1 + gallery.length) % gallery.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button type="button" aria-label="Imagen siguiente" onClick={() => setImageIndex((i) => (i + 1) % gallery.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {gallery.length > 1 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {gallery.map((img, i) => (
                  <button key={img + i} type="button" aria-label={`Imagen ${i + 1}`} onClick={() => setImageIndex(i)} className={cn("w-20 h-16 rounded-lg overflow-hidden border-2", i === imageIndex ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compra (en móvil, el botón flotante de WhatsApp se aparta para no taparla) */}
          <div className="lg:col-span-2 min-w-0" data-whatsapp-avoid="">
            <div className="lg:sticky lg:top-28 space-y-5">
              <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground break-words">{product.title}</h1>
              {str(product.shortDescription) && str(product.description) && <p className="text-muted-foreground">{product.shortDescription}</p>}

              {hasPrice ? (
                <div>
                  <p className="text-3xl font-bold text-foreground" data-testid="precio">
                    {variants.length > 0 && !variant && <span className="text-base font-medium text-muted-foreground mr-1">Desde</span>}{variants.length > 0 && !variant && " "}
                    {formatEuros(shownPrice)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">IVA incluido</p>
                </div>
              ) : null}

              {duration && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4 text-primary" /> {duration}
                </p>
              )}

              {hasPrice && variants.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-medium text-foreground mb-2">Opciones</legend>
                  <div className="space-y-2">
                    {variants.map((v) => {
                      const price = variantUnitPrice(basePrice, v);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          aria-pressed={variantId === v.id}
                          onClick={() => setVariantId(variantId === v.id ? undefined : v.id)}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors",
                            variantId === v.id ? "border-primary bg-primary/10 font-semibold text-foreground" : "border-border text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          <span className="min-w-0 break-words">{v.name}</span>
                          {price > 0 && <span className="shrink-0 font-semibold">{formatEuros(price)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {variants.some((v) => v.isRequired) && !variant && <p className="text-xs text-muted-foreground mt-1.5">Elige una opción para continuar</p>}
                </fieldset>
              )}

              {hasPrice && (
                <div>
                  <label htmlFor="cantidad" className="text-sm font-medium text-foreground mb-2 block">Cantidad</label>
                  <div className="flex items-center gap-3">
                    <button type="button" aria-label="Quitar una unidad" disabled={quantity <= 1} onClick={() => setQuantity((q) => clampQuantity(q - 1))} className="w-10 h-10 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40">
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      id="cantidad"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_QUANTITY}
                      value={quantity}
                      onChange={(e) => setQuantity(clampQuantity(e.target.value))}
                      className="w-16 h-10 text-center border border-border rounded-lg bg-background text-lg font-semibold"
                    />
                    <button type="button" aria-label="Añadir una unidad" disabled={quantity >= MAX_QUANTITY} onClick={() => setQuantity((q) => clampQuantity(q + 1))} className="w-10 h-10 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {hasPrice && dated && (
                <div>
                  <label htmlFor="fecha" className="text-sm font-medium text-foreground mb-2 block">Fecha del servicio</label>
                  <input id="fecha" type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
              )}

              {hasPrice ? (
                <>
                  {(variant || !variants.some((v) => v.isRequired)) && (
                    <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3 font-semibold">
                      <span>Total</span>
                      <span className="text-lg" data-testid="total">{formatEuros(total)}</span>
                    </div>
                  )}
                  {soldOut ? (
                    <>
                      <Button disabled className="w-full h-12 text-base font-semibold" data-testid="agotado">Agotado</Button>
                      <p className="text-sm text-muted-foreground">Ahora mismo no está a la venta. Escríbenos si quieres saber cuándo vuelve.</p>
                    </>
                  ) : (
                    <Button onClick={add} className="w-full h-12 text-base font-semibold">
                      <ShoppingCart className="mr-2 w-4 h-4" /> Añadir al carrito
                    </Button>
                  )}
                </>
              ) : (
                <Button asChild variant="outline" className="w-full h-12">
                  <Link href={`/presupuesto?exp=${encodeURIComponent(product.slug)}`}>Solicitar presupuesto</Link>
                </Button>
              )}

              {(phone || email) && (
                <div className="pt-4 border-t border-border space-y-2 text-sm text-muted-foreground">
                  {phone && (
                    <p className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary shrink-0" /><a href={phoneTel} className="hover:text-primary">{phone}</a></p>
                  )}
                  {email && (
                    <p className="flex items-center gap-2 min-w-0"><Mail className="w-4 h-4 text-primary shrink-0" /><a href={`mailto:${email}`} className="hover:text-primary break-all">{email}</a></p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {(description || includes.length > 0 || excludes.length > 0 || requirements) && (
          <div className="mt-10 max-w-3xl space-y-8">
            {description && (
              <section>
                <h2 className="text-xl font-heading font-semibold text-foreground mb-3">Descripción</h2>
                <div className="text-muted-foreground leading-relaxed whitespace-pre-line break-words">{description}</div>
              </section>
            )}
            {(includes.length > 0 || excludes.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {includes.length > 0 && (
                  <section>
                    <h2 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-600" /> Incluye</h2>
                    <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">{includes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </section>
                )}
                {excludes.length > 0 && (
                  <section>
                    <h2 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2"><XCircle className="w-5 h-5 text-red-500" /> No incluye</h2>
                    <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">{excludes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </section>
                )}
              </div>
            )}
            {requirements && (
              <section className="bg-muted/50 rounded-xl p-5">
                <h2 className="font-heading font-semibold text-foreground mb-2">Requisitos</h2>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{requirements}</p>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Opiniones reales del producto (sin cifras fijas) */}
      <section className="py-12 bg-muted border-t border-border">
        <div className="container max-w-5xl">
          <ReviewSection entityType="experience" entityId={product.id} theme="auto" generic />
        </div>
      </section>
    </PublicLayout>
  );
}
