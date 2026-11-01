/**
 * Checkout — Página de resumen de pedido antes de redirigir a Redsys
 *
 * Muestra todos los artículos del carrito, permite editar datos del cliente
 * y lanza el pago Redsys con un único formulario POST.
 */
import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { useCart } from "@/contexts/CartContext";
import { useMarketingConsent } from "@/hooks/useMarketingConsent";
import { trackEvent } from "@/lib/meta-pixel/client";
import { getFbp, getFbc } from "@/lib/meta-pixel/cookies";
import { trpc } from "@/lib/trpc";
import { usePublicSite } from "@/hooks/usePublicSite";
import { cartItemDate } from "@shared/publicSite";
import { usePageTitle } from "@/components/TenantTheme";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Calendar, Users, Tag, Trash2, ArrowLeft,
  Lock, CreditCard, AlertCircle, CheckCircle2, ChevronRight,
  Phone, Mail, User, Shield, Clock, Package, Receipt,
} from "lucide-react";
import { formatEuros } from "@shared/storefront";
import { checkoutErrorMessage, validateBuyer } from "@shared/shopOrders";
import { useStorefront } from "@/components/StorefrontRoute";

/** Importe en formato es-ES («1.234,50 €»). */
const eur = (n: number) => formatEuros(n) ?? "0,00 €";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fecha del artículo; null si no tiene (productos de la tienda sin fecha): no se muestra. */
function formatDate(dateStr: string): string | null {
  return cartItemDate(dateStr, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export default function Checkout() {
  const { items, totalItems, totalEstimated, removeItem, clearCart } = useCart();
  const [, navigate] = useLocation();
  // Textos de la empresa: genéricos en una pyme (tienda, pedido), los de siempre en la instalación propia
  const { features: site, text } = usePublicSite();
  const shopHref = site?.licensed && !site.store ? "/" : text.shopHref;
  usePageTitle("Finalizar compra");
  const hasConsent = useMarketingConsent();
  const initiateCheckoutFired = useRef(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [comments, setComments] = useState("");
  // Factura con datos fiscales (opcional)
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [nif, setNif] = useState("");
  const [billingName, setBillingName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  // La confirmación por correo solo se promete si llega al comprador (no en la prueba gratuita)
  const { storefront } = useStorefront();
  const buyerEmails = site?.licensed ? storefront?.buyerEmails === true : true;
  const QtyIcon = site?.licensed ? Package : Users;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [promoData, setPromoData] = useState<{ id: number; code: string; discountType: "percent" | "fixed"; discountPercent: number; discountAmount: number } | null>(null);
  const validatePromo = trpc.discounts.validate.useMutation({
    onSuccess: (data) => {
      setPromoData({ id: data.id, code: data.code, discountType: data.discountType, discountPercent: data.discountPercent, discountAmount: data.discountAmount });
    },
    onError: (e) => {
      setPromoData(null);
      setErrors(p => ({ ...p, promo: e.message }));
    },
  });
  const promoDiscount = promoData
    ? promoData.discountType === "fixed"
      ? promoData.discountAmount
      : Math.round(totalEstimated * promoData.discountPercent) / 100
    : 0;
  const finalTotal = Math.max(0, totalEstimated - promoDiscount);

  const cartCheckout = trpc.reservations.cartCheckout.useMutation();

  // Redirigir si el carrito está vacío
  useEffect(() => {
    // Se espera a saber qué web es (la tienda de una pyme o el catálogo de la instalación propia)
    if (items.length === 0 && !cartCheckout.isPending && site) {
      navigate(shopHref);
    }
  }, [items.length, cartCheckout.isPending, navigate, shopHref, site]);

  // InitiateCheckout — page mount, una sola vez
  useEffect(() => {
    if (!hasConsent || items.length === 0 || initiateCheckoutFired.current) return;
    initiateCheckoutFired.current = true;
    trackEvent('InitiateCheckout', {
      content_ids: items.map(i => String(i.productId)),
      contents: items.map(i => ({ id: String(i.productId), quantity: i.people, item_price: i.pricePerPerson })),
      num_items: items.length,
      value: finalTotal,
      currency: 'EUR',
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConsent]);

  function validate(): boolean {
    const errs: Record<string, string> = { ...validateBuyer({ name, email, phone, wantsInvoice, nif, billingName, billingAddress }) };
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handlePay() {
    setSubmitError(null);
    if (!validate()) return;

    try {
      const result = await cartCheckout.mutateAsync({
        items: items.map(i => ({
          productId: i.productId,
          bookingDate: i.bookingDate,
          people: i.people,
          variantId: i.variantId,
          extras: i.extras,
          legoPackLineIds: i.legoPackLineIds,
          legoPackLinePeople: i.legoPackLinePeople,
        })),
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || undefined,
        origin: window.location.origin,
        discountCodeId: promoData?.id,
          discountCode: promoData?.code,
        // Meta CAPI attribution — solo si el usuario aceptó marketing consent
        fbp: hasConsent ? getFbp() : undefined,
        fbc: hasConsent ? getFbc() : undefined,
        comments: comments.trim() || undefined,
        billing: wantsInvoice ? { nif: nif.trim(), name: billingName.trim() || undefined, address: billingAddress.trim() || undefined } : undefined,
      });

      // AddPaymentInfo — el backend confirmó la sesión Redsys, el usuario va
      // a introducir su tarjeta. Se dispara ANTES de clearCart para tener items.
      if (hasConsent) {
        await trackEvent('AddPaymentInfo', {
          content_ids: items.map(i => String(i.productId)),
          contents: items.map(i => ({ id: String(i.productId), quantity: i.people, item_price: i.pricePerPerson })),
          num_items: items.length,
          value: finalTotal,
          currency: 'EUR',
        }, { email: email.trim() });
      }

      // Vaciar carrito antes de redirigir. En la tienda de una pyme se conserva hasta que el pago se confirma
      // (página de pago correcto): si el banco lo rechaza, el comprador lo reintenta sin volver a llenarlo
      if (!site?.licensed) clearCart();

      // Enviar formulario Redsys
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.redsysForm.url;
      form.style.display = "none";

      const fields = {
        Ds_SignatureVersion: result.redsysForm.Ds_SignatureVersion,
        Ds_MerchantParameters: result.redsysForm.Ds_MerchantParameters,
        Ds_Signature: result.redsysForm.Ds_Signature,
      };
      for (const [k, v] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (err: unknown) {
      const e = err as { message?: string; data?: { code?: string } | null } | null;
      setSubmitError(checkoutErrorMessage({ code: e?.data?.code ?? null, message: e?.message ?? null }));
    }
  }

  if (items.length === 0 && !cartCheckout.isPending) {
    return null; // useEffect redirige
  }

  return (
    <PublicLayout forcePublicLight>
      <div className="min-h-screen bg-slate-50">
        {/* Breadcrumb / Header */}
        <div className="bg-white border-b border-slate-200">
          <div className="container max-w-5xl py-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
              <Link href="/" className="hover:text-primary transition-colors">Inicio</Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <Link href={shopHref} className="hover:text-primary transition-colors">{text.shopLabel}</Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-slate-900 font-medium">Finalizar compra</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-slate-900">Finalizar compra</h1>
                  <p className="text-xs text-slate-500">
                    {site?.licensed ? `${totalItems} ${totalItems === 1 ? "artículo" : "artículos"}` : `${totalItems} ${totalItems === 1 ? "experiencia" : "experiencias"}`} · Total estimado: <span className="font-bold text-primary">{eur(totalEstimated)}</span>
                  </p>
                </div>
              </div>
              <Link href={shopHref}>
                <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                  Seguir comprando
                </button>
              </Link>
            </div>
          </div>
        </div>

        {/* Contenido principal */}
        <div className="container max-w-5xl py-8">
          <div className="grid lg:grid-cols-5 gap-8">

            {/* ── Columna izquierda: Resumen del pedido ── */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <h2 className="font-bold text-slate-900 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    Resumen del pedido
                  </h2>
                  <button
                    onClick={() => { clearCart(); navigate(shopHref); }}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Vaciar carrito
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const extrasTotal = item.extras.reduce((s, e) => s + e.price * e.quantity, 0);
                    return (
                      <div key={item.cartItemId} className="flex gap-4 p-5">
                        {/* Imagen */}
                        {item.productImage ? (
                          <img
                            src={item.productImage}
                            alt={item.productName}
                            className="w-20 h-20 rounded-xl object-cover flex-shrink-0 shadow-sm"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center flex-shrink-0">
                            <ShoppingCart className="w-7 h-7 text-primary/50" />
                          </div>
                        )}

                        {/* Detalles */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-bold text-slate-900 text-sm leading-tight">{item.productName}</h3>
                              {item.variantName && (
                                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                                  <Tag className="w-3 h-3" />
                                  {item.variantName}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => removeItem(item.cartItemId)}
                              className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              aria-label={`Eliminar ${item.productName}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
                            {formatDate(item.bookingDate) && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-primary" />
                                {formatDate(item.bookingDate)}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <QtyIcon className="w-3 h-3 text-primary" aria-hidden="true" />
                              {text.quantity(item.people)}
                            </span>
                          </div>

                          {item.extras.length > 0 && (
                            <div className="mt-2 space-y-0.5">
                              {item.extras.map((e, i) => (
                                <p key={i} className="text-xs text-slate-600">
                                  + {e.name} ×{e.quantity}
                                  <span className="ml-1 text-slate-700">({eur(e.price * e.quantity)})</span>
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-3">
                            <span className="text-xs text-slate-600">
                              {eur(item.pricePerPerson)}{text.perUnitLong.replace("€", "")}
                              {extrasTotal > 0 && ` + ${eur(extrasTotal)} extras`}
                            </span>
                            <span className="font-black text-base text-primary">
                              {eur(item.estimatedTotal)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Código promocional */}
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Tag className="w-3 h-3 text-primary" /> Código promocional
                  </label>
                  {promoData ? (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                      <div>
                        <span className="font-mono font-bold text-green-700 text-sm">{promoData.code}</span>
                        <span className="text-xs text-green-600 ml-2">
                          {promoData.discountType === "fixed"
                            ? `-${eur(promoData.discountAmount)} aplicado`
                            : `-${promoData.discountPercent}% aplicado`}
                        </span>
                      </div>
                      <button
                        onClick={() => { setPromoData(null); setPromoInput(""); }}
                        className="text-slate-400 hover:text-red-500 transition-colors ml-2"
                      >
                        <span className="text-xs">× Quitar</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={promoInput}
                        onChange={e => { setPromoInput(e.target.value.toUpperCase()); setErrors(p => ({ ...p, promo: "" })); }}
                        onKeyDown={e => e.key === "Enter" && validatePromo.mutate({ code: promoInput, amount: totalEstimated })}
                        placeholder={text.promoPlaceholder}
                        className={`flex-1 px-3 py-2 text-sm border rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.promo ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                      <button
                        onClick={() => validatePromo.mutate({ code: promoInput, amount: totalEstimated })}
                        disabled={validatePromo.isPending || !promoInput.trim()}
                        className="px-3 py-2 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl disabled:opacity-50 transition-colors"
                      >
                        {validatePromo.isPending ? "..." : "Aplicar"}
                      </button>
                    </div>
                  )}
                  {errors.promo && <p className="text-xs text-red-500 mt-1">{errors.promo}</p>}
                </div>

                {/* Subtotal */}
                <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
                  <div className="flex items-center justify-between text-sm text-slate-600 mb-1">
                    <span>Subtotal ({totalItems} {totalItems === 1 ? "artículo" : "artículos"})</span>
                    <span>{eur(totalEstimated)}</span>
                  </div>
                  {promoDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm text-green-600 mb-1">
                      <span>Descuento {promoData?.code}</span>
                      <span>-{eur(promoDiscount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-black text-lg text-slate-900 border-t border-slate-200 pt-2 mt-2">
                    <span>Total</span>
                    <span className="text-primary">{eur(finalTotal)}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">{site?.licensed ? "Precios con IVA incluido. El importe definitivo se comprueba antes de pagar." : "* El precio final se calculará en el servidor antes del pago."}</p>
                </div>
              </div>

              {/* Garantías */}
              <div className={`grid gap-3 ${text.showCancellationBadge ? "grid-cols-3" : "grid-cols-2"}`}>
                {[
                  { icon: Shield, label: "Pago seguro", desc: text.secureBadge },
                  // Política de cancelación de la instalación propia: una pyme tiene la suya (no se inventa)
                  ...(text.showCancellationBadge ? [{ icon: Clock, label: "Cancelación", desc: "Hasta 48h antes" }] : []),
                  buyerEmails
                    ? { icon: CheckCircle2, label: "Confirmación", desc: site?.licensed ? "Por correo al pagar" : "Email inmediato" }
                    : { icon: CheckCircle2, label: "Confirmación", desc: "Número de pedido al pagar" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                    <Icon className="w-5 h-5 text-primary mx-auto mb-1" />
                    <p className="text-xs font-bold text-slate-800">{label}</p>
                    <p className="text-xs text-slate-600">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Columna derecha: Datos del cliente + Pago ── */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden sticky top-24">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-bold text-slate-900 flex items-center gap-2">
                    <User className="w-4 h-4 text-primary" />
                    Tus datos de contacto
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">{buyerEmails ? text.contactHint : "Para identificar tu pedido y poder contactarte."}</p>
                </div>

                <div className="px-5 py-5 space-y-4">
                  {/* Nombre */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Nombre completo <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={name}
                        onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: "" })); }}
                        placeholder="Carlos García López"
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors ${errors.name ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                    </div>
                    {errors.name && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.name}</p>}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: "" })); }}
                        placeholder="carlos@ejemplo.com"
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors ${errors.email ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.email}</p>}
                  </div>

                  {/* Teléfono */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Teléfono <span className="text-slate-500 font-normal">(opcional)</span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => { setPhone(e.target.value); setErrors(p => ({ ...p, phone: "" })); }}
                        placeholder="+34 600 000 000"
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors ${errors.phone ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                    </div>
                    {errors.phone && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.phone}</p>}
                  </div>

                  {/* Factura con NIF (opcional) */}
                  <div className="rounded-xl border border-slate-200 p-3">
                    <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={wantsInvoice} onChange={e => { setWantsInvoice(e.target.checked); setErrors(p => ({ ...p, nif: "" })); }} className="mt-0.5 h-4 w-4 accent-primary" />
                      <span className="flex items-center gap-1.5"><Receipt className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />Quiero la factura con mi NIF o el de mi empresa</span>
                    </label>
                    {wantsInvoice && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label htmlFor="checkout-nif" className="block text-xs font-semibold text-slate-700 mb-1.5">NIF, NIE o CIF <span className="text-red-500">*</span></label>
                          <input id="checkout-nif" type="text" value={nif} autoComplete="off" onChange={e => { setNif(e.target.value.toUpperCase()); setErrors(p => ({ ...p, nif: "" })); }} placeholder="12345678Z" className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors ${errors.nif ? "border-red-400 bg-red-50" : "border-slate-300"}`} />
                          {errors.nif && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.nif}</p>}
                        </div>
                        <div>
                          <label htmlFor="checkout-billing-name" className="block text-xs font-semibold text-slate-700 mb-1.5">Nombre o razón social <span className="text-slate-500 font-normal">(si es distinto)</span></label>
                          <input id="checkout-billing-name" type="text" value={billingName} onChange={e => setBillingName(e.target.value)} placeholder="Mi Empresa, S.L." className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors" />
                        </div>
                        <div>
                          <label htmlFor="checkout-billing-address" className="block text-xs font-semibold text-slate-700 mb-1.5">Dirección fiscal <span className="text-slate-500 font-normal">(opcional)</span></label>
                          <input id="checkout-billing-address" type="text" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} placeholder="Calle, número, código postal y ciudad" className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Comentarios */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Comentarios <span className="text-slate-500 font-normal">(opcional)</span>
                    </label>
                    <textarea
                      value={comments}
                      onChange={e => setComments(e.target.value)}
                      placeholder={text.commentsPlaceholder}
                      rows={3}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors resize-none"
                    />
                  </div>

                  {/* Error de envío */}
                  {submitError && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  {/* Total + botón pagar */}
                  <div className="border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-semibold text-slate-700">Total a pagar</span>
                      <span className="text-2xl font-black text-primary">
                        {eur(finalTotal)}
                      </span>
                    </div>

                    <Button
                      size="lg"
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-black text-base rounded-xl transition-all"
                      onClick={handlePay}
                      disabled={cartCheckout.isPending}
                    >
                      {cartCheckout.isPending ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          Procesando...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <CreditCard className="w-5 h-5" />
                          Pagar con tarjeta
                          <Lock className="w-4 h-4 ml-1 opacity-70" />
                        </span>
                      )}
                    </Button>

                    <p className="text-center text-xs text-slate-500 mt-3 flex items-center justify-center gap-1">
                      <Lock className="w-3 h-3" />
                      {text.securePaymentLong}
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
