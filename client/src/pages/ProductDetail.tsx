/**
 * Ficha de producto de la tienda online de una pyme (`/tienda/:slug` y, en una web multidioma, `/:locale/tienda/:slug`):
 * nombre, imágenes, descripción, precio con IVA incluido, variantes y cantidad. Reutiliza el carrito y el pago actuales.
 * Solo muestra lo que el producto configura: ni reseñas inventadas, ni seguro, cancelación o dificultad. Lógica en
 * shared/storefront.ts. Textos fijos en el idioma de la página (shared/siteUiText.ts); el contenido, en el de su
 * traducción validada o, si falta, en el del principal con un aviso y su `lang` real.
 */
import { useEffect, useState } from "react";
import { applicableSupplements, supplementEuros, supplementTierFor, supplementsTotalEuros, type CartSupplement } from "../../../shared/supplementCart";
import { Link, Redirect, useParams } from "wouter";
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
import { purchaseState } from "@shared/purchaseState";
import { ProductRequestDialog } from "@/components/site/ProductRequestForm";
import { requestDatesOfProduct } from "@shared/requestDates";
import { ProductEditionsSection, type PublicEditionItem } from "@/components/site/Editions";
import { editionLocalDate } from "@shared/editionPurchase";
import { formatEditionDates } from "@shared/editions";
import { offerModeOf, requestCtaLabel, showsPrice } from "@shared/offerMode";
import { fillUiText, offerBadgeText, siteUiText, untranslatedNotice } from "@shared/siteUiText";
import { useSiteLocale } from "@/hooks/useSiteLocale";
import {
  buildGenericCartLine,
  clampQuantity,
  FALLBACK_GENERIC_STOREFRONT,
  formatEuros,
  fromPrice,
  isParticipantsProduct,
  MAX_QUANTITY,
  needsServiceDate,
  SHOP_PATH,
  variantUnitPrice,
} from "@shared/storefront";

type Row = Record<string, unknown>;

/** Periodo en el que el producto admite pedir una fecha de inicio (dato del producto; null = sin calendario) */
const requestDatesOf = requestDatesOfProduct;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Opción indicada en la dirección (`?opcion=<id>`), o ninguna. Pura. */
export function initialOption(search: string): number | undefined {
  const v = Number(new URLSearchParams(search).get("opcion"));
  return Number.isSafeInteger(v) && v > 0 ? v : undefined;
}

export default function ProductDetail() {
  // `locale` solo existe en la ruta localizada (la valida LocaleProductGate antes de llegar aquí)
  const { slug, locale: routeLocale } = useParams<{ slug: string; locale?: string }>();
  const site = useSiteLocale();
  const t = siteUiText(site.locale);
  const localeArg = routeLocale ? { locale: routeLocale } : {};
  const { phone, phoneTel, email } = usePublicContact();
  const { storefront } = useStorefront();
  const shop = storefront ?? FALLBACK_GENERIC_STOREFRONT;
  const { addItem, openCart } = useCart();
  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  // Opción elegida desde otra página (`/tienda/<producto>?opcion=<id>`: «Solicitar LIVE», «Solicitar Premium»…); solo
  // se usa si es una opción real de este producto (abajo)
  const [variantId, setVariantId] = useState<number | undefined>(() => initialOption(typeof window === "undefined" ? "" : window.location.search));
  const [date, setDate] = useState("");
  const [editionId, setEditionId] = useState<number | undefined>(undefined);
  const [requestOpen, setRequestOpen] = useState(false);
  const [pickedSupps, setPickedSupps] = useState<string[]>([]);

  const { data: product, isLoading } = trpc.public.getExperienceBySlug.useQuery({ slug: slug ?? "", ...localeArg }, { enabled: !!slug, retry: false });
  const { data: variants = [] } = trpc.public.getVariantsByExperience.useQuery({ experienceId: product?.id ?? 0, ...localeArg }, { enabled: !!product?.id });
  // Suplementos opcionales (alimentación…): aparte del programa; solo se ofrecen en la solicitud y siempre desmarcados
  const { data: supplements = [] } = trpc.public.getSupplementsByExperience.useQuery({ experienceId: product?.id ?? 0, ...localeArg }, { enabled: !!product?.id });
  // Convocatorias del producto: si las tiene, la compra exige elegir una fecha abierta (el servidor lo vuelve a validar)
  const { data: editionsData } = trpc.public.getExperiences.useQuery({ limit: 12, offset: 0, editions: { experienceId: product?.id ?? 0 } }, { enabled: !!product?.id, staleTime: 60_000, retry: false });
  const editions = ((editionsData ?? []) as unknown as PublicEditionItem[]).filter((e) => e.experienceId === product?.id);
  const openEditions = editions.filter((e) => e.state === "open");
  const pickedEdition = openEditions.find((e) => e.id === editionId);
  // Idioma de la ficha (solo en la ruta localizada): `contentLang` es el idioma real del contenido mostrado
  const i18n = product && "i18n" in product ? product.i18n : undefined;
  const contentLang = i18n ? (i18n.translated ? i18n.locale : i18n.contentLocale) : undefined;

  const p = (product ?? {}) as Row;
  useDocumentMeta(product && !i18n?.redirectTo ? { title: product.title, description: str(p.metaDescription) ?? str(p.shortDescription), image: str(p.coverImageUrl) ?? str(p.image1) } : null);
  // Idioma del documento: el de la URL (la interfaz sale en él); sin multidioma no se toca
  useEffect(() => {
    if (!i18n || i18n.redirectTo) return;
    const prev = document.documentElement.lang;
    document.documentElement.lang = i18n.locale;
    return () => {
      document.documentElement.lang = prev;
    };
  }, [i18n]);

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
          <h1 className="text-2xl font-bold mb-2">{t.productNotFound}</h1>
          <p className="text-muted-foreground mb-6">{t.productNotFoundHelp}</p>
          <Button asChild>
            <Link href={SHOP_PATH}>{t.viewShop}</Link>
          </Button>
        </div>
      </PublicLayout>
    );
  }

  // Slug del principal en una URL con slug traducido (o al revés): a la dirección de este idioma, con la opción elegida
  if (i18n?.redirectTo) return <Redirect to={i18n.redirectTo + (typeof window === "undefined" ? "" : window.location.search)} replace />;

  const images = [p.image1, p.image2, p.image3, p.image4].map(str).filter((x): x is string => !!x);
  const gallery = images.length ? images : list(p.gallery);
  if (!gallery.length && str(p.coverImageUrl)) gallery.push(str(p.coverImageUrl)!);
  const current = gallery[Math.min(imageIndex, gallery.length - 1)];

  const basePrice = Number(product.basePrice ?? 0);
  // E-6: «bajo petición» y «próximamente» no enseñan precio ni se compran: solo se pide información
  const offer = offerModeOf(product);
  const onRequest = offer !== "fixed";
  const hasPrice = showsPrice(product) && Number.isFinite(basePrice) && basePrice > 0;
  // Con «precio visible, solo por solicitud» se enseña el precio y las opciones, pero no hay compra
  const buyable = hasPrice && !onRequest;
  // Una opción de la dirección que no es de este producto (o ya no se ofrece) no se marca
  const variant = variants.find((v) => v.id === variantId);
  const unit = variantUnitPrice(basePrice, variant);
  const shownPrice = variant || !variants.length ? unit : fromPrice(basePrice, variants);
  const suppOffers = applicableSupplements(supplements as CartSupplement[], variant?.id);
  const chosenSupps = suppOffers.filter((s) => pickedSupps.includes(s.group));
  const suppTotal = supplementsTotalEuros(chosenSupps, clampQuantity(quantity));
  const total = unit * clampQuantity(quantity) + suppTotal;
  const dated = needsServiceDate(product, shop);
  const includes = list(product.includes);
  const excludes = list(product.excludes);
  const description = str(product.description) ?? str(product.shortDescription);
  const duration = str(product.duration);
  const requirements = str(product.requirements);

  // Publicado pero no a la venta: se enseña como agotado y no se puede añadir (el pago también lo rechaza)
  const soldOut = buyable && !isPurchasable(product);
  // Comprable pero la empresa aún no puede cobrar online (sin pasarela): estado honesto «Pronto disponible online»
  const soonOnline = buyable && !soldOut && purchaseState(product, variants, storefront?.payments) === "coming_soon_online";
  const needsEdition = buyable && editions.length > 0;

  const add = () => {
    if (soldOut || soonOnline) return;
    if (needsEdition && !pickedEdition) {
      toast.info(t.chooseDateBeforeCart);
      return;
    }
    const r = buildGenericCartLine({ product: { ...product, coverImageUrl: str(p.coverImageUrl), image1: str(p.image1) }, variant, quantity, date: pickedEdition ? editionLocalDate(pickedEdition.startsAt, pickedEdition.timezone) : date, storefront: shop }, variants);
    if (!r.ok) {
      if (r.reason === "variant_required") toast.info(t.chooseOptionBeforeCart);
      else if (r.reason === "date_required") toast.info(t.chooseDateBeforeCart);
      else toast.info(t.noOnlinePrice);
      return;
    }
    // Con convocatoria: la fecha y el precio son los de la edición (el servidor los recalcula)
    const unitEd = pickedEdition && pickedEdition.price != null && !variant ? pickedEdition.price : null;
    const withSupps = <L extends { estimatedTotal: number }>(line: L): L => (chosenSupps.length ? { ...line, supplements: chosenSupps, estimatedTotal: Math.round((line.estimatedTotal + suppTotal) * 100) / 100 } : line);
    addItem(withSupps(pickedEdition ? { ...r.line, bookingDate: editionLocalDate(pickedEdition.startsAt, pickedEdition.timezone), editionId: pickedEdition.id, editionLabel: pickedEdition.label, ...(unitEd != null ? { pricePerPerson: unitEd, estimatedTotal: Math.round(unitEd * r.line.people * 100) / 100 } : {}) } : r.line));
    openCart();
  };

  return (
    <PublicLayout>
      {/* Sin traducción a este idioma: se dice, en el idioma de la página, en qué idioma está el contenido */}
      {i18n && !i18n.translated && (
        <p role="note" className="container pt-4 text-sm text-muted-foreground" data-testid="aviso-sin-traducir">
          {untranslatedNotice(i18n.locale, i18n.contentLocale)}
        </p>
      )}
      <nav aria-label={t.breadcrumb} className="container py-4">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <li><Link href={site.home} className="hover:text-primary">{t.home}</Link></li>
          <li aria-hidden="true"><ChevronRight className="w-3.5 h-3.5" /></li>
          <li><Link href={SHOP_PATH} className="hover:text-primary">{t.shop}</Link></li>
          <li aria-hidden="true"><ChevronRight className="w-3.5 h-3.5" /></li>
          <li className="text-foreground min-w-0 break-words" lang={contentLang}>{product.title}</li>
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
                    <button type="button" aria-label={t.previousImage} onClick={() => setImageIndex((i) => (i - 1 + gallery.length) % gallery.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button type="button" aria-label={t.nextImage} onClick={() => setImageIndex((i) => (i + 1) % gallery.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {gallery.length > 1 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {gallery.map((img, i) => (
                  <button key={img + i} type="button" aria-label={fillUiText(t.imageN, { n: i + 1 })} onClick={() => setImageIndex(i)} className={cn("w-20 h-16 rounded-lg overflow-hidden border-2", i === imageIndex ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compra (en móvil, el botón flotante de WhatsApp se aparta para no taparla) */}
          <div className="lg:col-span-2 min-w-0" data-whatsapp-avoid="">
            <div className="lg:sticky lg:top-28 space-y-5">
              {onRequest && (
                <span data-testid="insignia-oferta" className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                  {offerBadgeText(t, offer)}
                </span>
              )}
              <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground break-words" lang={contentLang}>{product.title}</h1>
              {str(product.shortDescription) && str(product.description) && <p className="text-muted-foreground" lang={contentLang}>{product.shortDescription}</p>}

              {hasPrice ? (
                <div>
                  <p className="text-3xl font-bold text-foreground" data-testid="precio">
                    {variants.length > 0 && !variant && <span className="text-base font-medium text-muted-foreground mr-1">{t.from}</span>}{variants.length > 0 && !variant && " "}
                    {formatEuros(shownPrice)}
                  </p>
                  {buyable && <p className="text-xs text-muted-foreground mt-1">{t.vatIncluded}</p>}
                </div>
              ) : null}

              {duration && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" lang={contentLang}>
                  <Clock className="w-4 h-4 text-primary" /> {duration}
                </p>
              )}

              {hasPrice && variants.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-medium text-foreground mb-2">{t.options}</legend>
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
                  {buyable && variants.some((v) => v.isRequired) && !variant && <p className="text-xs text-muted-foreground mt-1.5">{t.chooseOptionToContinue}</p>}
                </fieldset>
              )}

              {buyable && (
                <div>
                  <label htmlFor="cantidad" className="text-sm font-medium text-foreground mb-2 block">{isParticipantsProduct(str(p.productType)) ? t.participants : t.quantity}</label>
                  <div className="flex items-center gap-3">
                    <button type="button" aria-label={t.removeUnit} disabled={quantity <= 1} onClick={() => setQuantity((q) => clampQuantity(q - 1))} className="w-10 h-10 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40">
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
                    <button type="button" aria-label={t.addUnit} disabled={quantity >= MAX_QUANTITY} onClick={() => setQuantity((q) => clampQuantity(q + 1))} className="w-10 h-10 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {needsEdition && (
                <div data-testid="elegir-convocatoria">
                  <label htmlFor="convocatoria" className="text-sm font-medium text-foreground mb-2 block">{t.serviceDate}</label>
                  {openEditions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay fechas abiertas ahora mismo. Solicita información para la próxima convocatoria.</p>
                  ) : (
                    <select id="convocatoria" value={editionId ?? ""} onChange={(e) => setEditionId(e.target.value ? Number(e.target.value) : undefined)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background">
                      <option value="">{t.chooseDateBeforeCart}</option>
                      {openEditions.map((e) => (
                        <option key={e.id} value={e.id}>{e.label} · {formatEditionDates(e.startsAt, e.endsAt, e.timezone)}{e.seatsLeft != null ? ` · ${e.seatsLeft}` : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {buyable && dated && !needsEdition && (
                <div>
                  <label htmlFor="fecha" className="text-sm font-medium text-foreground mb-2 block">{t.serviceDate}</label>
                  <input id="fecha" type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
              )}

              {buyable ? (
                <>
                  {suppOffers.map((o) => {
                    const cur = supplementTierFor(o, clampQuantity(quantity));
                    return (
                      <div key={o.group} className="rounded-lg border border-dashed p-3" data-testid="suplemento">
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" checked={pickedSupps.includes(o.group)} disabled={!cur} onChange={(e) => setPickedSupps(e.target.checked ? [...pickedSupps, o.group] : pickedSupps.filter((g) => g !== o.group))} className="mt-0.5 h-4 w-4" />
                          <span>
                            <span className="font-medium">{t.supplementOptional}: {o.name}</span>
                            {cur && <span className="ml-1 text-muted-foreground">· {formatEuros(supplementEuros(o, clampQuantity(quantity)))}</span>}
                          </span>
                        </label>
                        {o.description && <p className="mt-1 pl-6 text-xs text-muted-foreground">{o.description}</p>}
                        <p className="mt-1 pl-6 text-xs text-muted-foreground">{t.supplementAddsToTotal}</p>
                      </div>
                    );
                  })}
                  {(variant || !variants.some((v) => v.isRequired)) && (
                    <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3 font-semibold">
                      <span>{t.total}</span>
                      <span className="text-lg" data-testid="total">{formatEuros(total)}</span>
                    </div>
                  )}
                  {soldOut ? (
                    <>
                      <Button disabled className="w-full h-12 text-base font-semibold" data-testid="agotado">{t.soldOut}</Button>
                      <p className="text-sm text-muted-foreground">{t.soldOutHelp}</p>
                    </>
                  ) : soonOnline ? (
                    <>
                      <Button disabled className="w-full h-12 text-base font-semibold" data-testid="pronto-online">{t.soonOnline}</Button>
                      <p className="text-sm text-muted-foreground">{t.soonOnlineHelp}</p>
                      <Button variant="outline" onClick={() => setRequestOpen(true)} className="w-full h-12 text-base font-semibold" data-testid="solicitar-informacion">
                        {t.requestInfo}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={add} disabled={needsEdition && openEditions.length === 0} className="w-full h-12 text-base font-semibold">
                      <ShoppingCart className="mr-2 w-4 h-4" /> {t.addToCart}
                    </Button>
                  )}
                </>
              ) : onRequest ? (
                <Button onClick={() => setRequestOpen(true)} className="w-full h-12 text-base font-semibold" data-testid="solicitar-informacion">
                  {str(p.requestCtaLabel) ? requestCtaLabel(p) : t.requestInfo}
                </Button>
              ) : (
                <Button asChild variant="outline" className="w-full h-12">
                  <Link href={`/presupuesto?exp=${encodeURIComponent(product.slug)}`}>{t.requestQuote}</Link>
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

        {/* E-4: próximas fechas (convocatorias) de este producto; sin ellas, no se pinta nada */}
        <ProductEditionsSection productId={product.id} />

        {(description || includes.length > 0 || excludes.length > 0 || requirements) && (
          <div className="mt-10 max-w-3xl space-y-8" lang={contentLang}>
            {description && (
              <section>
                <h2 className="text-xl font-heading font-semibold text-foreground mb-3" lang={site.locale}>{t.description}</h2>
                <div className="text-muted-foreground leading-relaxed whitespace-pre-line break-words">{description}</div>
              </section>
            )}
            {(includes.length > 0 || excludes.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {includes.length > 0 && (
                  <section>
                    <h2 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-600" /> <span lang={site.locale}>{t.includes}</span></h2>
                    <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">{includes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </section>
                )}
                {excludes.length > 0 && (
                  <section>
                    <h2 className="font-heading font-semibold text-foreground mb-3 flex items-center gap-2"><XCircle className="w-5 h-5 text-red-500" /> <span lang={site.locale}>{t.excludes}</span></h2>
                    <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">{excludes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </section>
                )}
              </div>
            )}
            {requirements && (
              <section className="bg-muted/50 rounded-xl p-5">
                <h2 className="font-heading font-semibold text-foreground mb-2" lang={site.locale}>{t.requirements}</h2>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{requirements}</p>
              </section>
            )}
          </div>
        )}
      </div>

      {(onRequest || soonOnline) && <ProductRequestDialog target={{ productId: product.id, productTitle: product.title, variantId: variant?.id, requestDates: requestDatesOf(product), minPeople: Math.max(variant?.minQty ?? 1, product.minPersons ?? 1), maxPeople: [variant?.maxQty, product.maxPersons].filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b)[0], supplements: supplements.filter((o) => !o.forVariantIds?.length || (variant != null && o.forVariantIds.includes(variant.id))) }} open={requestOpen} onOpenChange={setRequestOpen} />}

      {/* Opiniones reales del producto (sin cifras fijas) */}
      <section className="py-12 bg-muted border-t border-border">
        <div className="container max-w-5xl">
          <ReviewSection entityType="experience" entityId={product.id} theme="auto" generic />
        </div>
      </section>
    </PublicLayout>
  );
}
