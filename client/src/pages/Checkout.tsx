/**
 * Checkout — Página de resumen de pedido antes de redirigir a Redsys
 *
 * Muestra todos los artículos del carrito, permite editar datos del cliente
 * y lanza el pago Redsys con un único formulario POST.
 */
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { useCart } from "@/contexts/CartContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Calendar, Users, Tag, Trash2, ArrowLeft,
  Lock, CreditCard, AlertCircle, CheckCircle2, ChevronRight,
  Phone, Mail, User, Shield, Clock,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export default function Checkout() {
  const { items, totalItems, totalEstimated, removeItem, clearCart } = useCart();
  const [, navigate] = useLocation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [comments, setComments] = useState("");
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
    if (items.length === 0 && !cartCheckout.isPending) {
      navigate("/experiencias");
    }
  }, [items.length, cartCheckout.isPending, navigate]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) errs.name = "Introduce tu nombre completo.";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Introduce un email válido.";
    if (phone.trim() && !/^[+\d\s\-()]{7,20}$/.test(phone)) errs.phone = "Teléfono no válido.";
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
        })),
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || undefined,
        origin: window.location.origin,
        discountCodeId: promoData?.id,
      });

      // Vaciar carrito antes de redirigir
      clearCart();

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
      const msg = err instanceof Error ? err.message : "Error al procesar el pago. Inténtalo de nuevo.";
      setSubmitError(msg);
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
              <Link href="/" className="hover:text-orange-600 transition-colors">Inicio</Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <Link href="/experiencias" className="hover:text-orange-600 transition-colors">Experiencias</Link>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-slate-900 font-medium">Finalizar compra</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-slate-900">Finalizar compra</h1>
                  <p className="text-xs text-slate-500">
                    {totalItems} {totalItems === 1 ? "experiencia" : "experiencias"} · Total estimado: <span className="font-bold text-orange-600">{totalEstimated.toFixed(2).replace(".", ",")} €</span>
                  </p>
                </div>
              </div>
              <Link href="/experiencias">
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
                    <ShoppingCart className="w-4 h-4 text-orange-500" />
                    Resumen del pedido
                  </h2>
                  <button
                    onClick={() => { clearCart(); navigate("/experiencias"); }}
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
                          <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-sky-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                            <ShoppingCart className="w-7 h-7 text-sky-400" />
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
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-orange-400" />
                              {formatDate(item.bookingDate)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3 text-orange-400" />
                              {item.people} {item.people === 1 ? "persona" : "personas"}
                            </span>
                          </div>

                          {item.extras.length > 0 && (
                            <div className="mt-2 space-y-0.5">
                              {item.extras.map((e, i) => (
                                <p key={i} className="text-xs text-slate-600">
                                  + {e.name} ×{e.quantity}
                                  <span className="ml-1 text-slate-700">({(e.price * e.quantity).toFixed(2).replace(".", ",")} €)</span>
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-3">
                            <span className="text-xs text-slate-600">
                              {item.pricePerPerson.toFixed(2).replace(".", ",")} €/persona
                              {extrasTotal > 0 && ` + ${extrasTotal.toFixed(2).replace(".", ",")} € extras`}
                            </span>
                            <span className="font-black text-base text-orange-600">
                              {item.estimatedTotal.toFixed(2).replace(".", ",")} €
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
                    <Tag className="w-3 h-3 text-orange-500" /> Código promocional
                  </label>
                  {promoData ? (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                      <div>
                        <span className="font-mono font-bold text-green-700 text-sm">{promoData.code}</span>
                        <span className="text-xs text-green-600 ml-2">
                          {promoData.discountType === "fixed"
                            ? `-${promoData.discountAmount.toFixed(2).replace(".", ",")} € aplicado`
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
                        placeholder="VERANO25"
                        className={`flex-1 px-3 py-2 text-sm border rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 ${errors.promo ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                      <button
                        onClick={() => validatePromo.mutate({ code: promoInput, amount: totalEstimated })}
                        disabled={validatePromo.isPending || !promoInput.trim()}
                        className="px-3 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl disabled:opacity-50 transition-colors"
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
                    <span>{totalEstimated.toFixed(2).replace(".", ",")} €</span>
                  </div>
                  {promoDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm text-green-600 mb-1">
                      <span>Descuento {promoData?.code}</span>
                      <span>-{promoDiscount.toFixed(2).replace(".", ",")} €</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-black text-lg text-slate-900 border-t border-slate-200 pt-2 mt-2">
                    <span>Total</span>
                    <span className="text-orange-600">{finalTotal.toFixed(2).replace(".", ",")} €</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">* El precio final se calculará en el servidor antes del pago.</p>
                </div>
              </div>

              {/* Garantías */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Shield, label: "Pago seguro", desc: "SSL + Redsys" },
                  { icon: Clock, label: "Cancelación", desc: "Hasta 48h antes" },
                  { icon: CheckCircle2, label: "Confirmación", desc: "Email inmediato" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                    <Icon className="w-5 h-5 text-green-500 mx-auto mb-1" />
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
                    <User className="w-4 h-4 text-orange-500" />
                    Tus datos de contacto
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">Para enviarte la confirmación de reserva.</p>
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
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-colors ${errors.name ? "border-red-400 bg-red-50" : "border-slate-300"}`}
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
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-colors ${errors.email ? "border-red-400 bg-red-50" : "border-slate-300"}`}
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
                        className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-colors ${errors.phone ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                      />
                    </div>
                    {errors.phone && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errors.phone}</p>}
                  </div>

                  {/* Comentarios */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Comentarios <span className="text-slate-500 font-normal">(opcional)</span>
                    </label>
                    <textarea
                      value={comments}
                      onChange={e => setComments(e.target.value)}
                      placeholder="Alergias, necesidades especiales, ocasión especial..."
                      rows={3}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition-colors resize-none"
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
                      <span className="text-2xl font-black text-orange-600">
                        {finalTotal.toFixed(2).replace(".", ",")} €
                      </span>
                    </div>

                    <Button
                      size="lg"
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base rounded-xl shadow-lg shadow-orange-200 transition-all"
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
                      Pago seguro con Redsys · Datos cifrados SSL
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
