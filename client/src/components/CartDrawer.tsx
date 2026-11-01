/**
 * CartDrawer — Panel lateral deslizante del carrito de la compra
 *
 * Muestra los artículos del carrito con controles de edición inline:
 * - Selector de variante de precio (si el producto tiene variantes)
 * - Controles +/- para editar el número de personas
 * - Botón de eliminar artículo
 *
 * El botón "Finalizar compra" redirige a /checkout donde el usuario
 * introduce sus datos y confirma el pedido antes de Redsys.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { X, Trash2, ShoppingCart, Calendar, Users, Package, Tag, ArrowRight, Lock, Minus, Plus, ChevronDown, AlarmClock } from "lucide-react";
import { useCart, type CartItem } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { usePublicSite } from "@/hooks/usePublicSite";
import { cartItemDate } from "@shared/publicSite";
import { formatEuros, variantUnitPrice } from "@shared/storefront";

/** Importe en formato es-ES («1.234,50 €»). */
const eur = (n: number) => formatEuros(n) ?? "0,00 €";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fecha del artículo; null si no tiene (productos de la tienda sin fecha): no se muestra. */
function formatDate(dateStr: string): string | null {
  return cartItemDate(dateStr, { weekday: "short", day: "numeric", month: "short" });
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({ item }: { item: CartItem }) {
  const { removeItem, updatePeople, updateVariant } = useCart();
  const [showVariants, setShowVariants] = useState(false);
  // Cantidad en unidades en una pyme; en personas en la instalación propia
  const { features, text } = usePublicSite();
  // Tienda de una pyme: la opción (talla, color…) se elige en la ficha; aquí solo se muestra
  const generic = !features || features.licensed;
  const QtyIcon = generic ? Package : Users;
  const date = formatDate(item.bookingDate);

  const minPeople = item.minPersons ?? 1;
  const maxPeople = item.maxPersons ?? 20;
  const extrasTotal = item.extras.reduce((s, e) => s + e.price * e.quantity, 0);

  // Cargar variantes del producto (solo cuando se expande el selector)
  const { data: variants = [] } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: item.productId },
    { enabled: showVariants && !generic }
  );

  function handleVariantSelect(variantId: number, variantName: string, pricePerPerson: number) {
    updateVariant(item.cartItemId, variantId, variantName, pricePerPerson);
    setShowVariants(false);
  }

  function handleClearVariant() {
    // Restaurar al precio base — usamos pricePerPerson original del artículo
    // No tenemos el basePrice aquí, así que simplemente limpiamos la variante
    updateVariant(item.cartItemId, undefined, undefined, item.pricePerPerson);
    setShowVariants(false);
  }

  return (
    <div className="py-4 border-b border-border/60 last:border-0 space-y-3">
      {/* Fila superior: imagen + nombre + eliminar */}
      <div className="flex gap-3">
        {item.productImage ? (
          <img
            src={item.productImage}
            alt={item.productName}
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 shadow-sm"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center flex-shrink-0">
            <ShoppingCart className="w-5 h-5 text-primary/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm text-foreground leading-tight line-clamp-2">
              {item.productName}
            </p>
            <button
              onClick={() => removeItem(item.cartItemId)}
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label={`Eliminar ${item.productName} del carrito`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Fecha (solo si el artículo la tiene) */}
          {date && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {date}
            </div>
          )}
          {/* Horario seleccionado (time slot) */}
          {item.selectedTimeSlotLabel && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-primary font-medium">
              <AlarmClock className="w-3 h-3" />
              {item.selectedTimeSlotLabel}
              {item.selectedTime && ` · ${item.selectedTime}`}
            </div>
          )}
        </div>
      </div>

      {/* Opción elegida (tienda) o selector de modalidad (catálogo de siempre) */}
      {generic ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            {item.variantName && <Tag className="w-3 h-3 shrink-0 text-primary" aria-hidden="true" />}
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.variantName ?? "Precio por unidad"}</span>
          </span>
          <span className="shrink-0 font-semibold text-foreground">{eur(item.pricePerPerson)}{text.perUnitShort.replace("€", "")}</span>
        </div>
      ) : (
      <div>
        <button
          type="button"
          onClick={() => setShowVariants(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border text-xs hover:border-primary/40 hover:bg-primary/5 transition-all"
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Tag className="w-3 h-3 text-primary" />
            {item.variantName ?? "Modalidad / Tarifa"}
          </span>
          <span className="flex items-center gap-1 font-bold text-primary">
            {eur(item.pricePerPerson)}{text.perUnitShort.replace("€", "")}
            <ChevronDown className={cn("w-3 h-3 transition-transform", showVariants && "rotate-180")} />
          </span>
        </button>

        {showVariants && (
          <div className="mt-1.5 space-y-1 border border-primary/15 rounded-xl p-2 bg-primary/5">
            {/* Opción estándar (sin variante) */}
            <button
              type="button"
              onClick={handleClearVariant}
              className={cn(
                "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all",
                !item.variantId
                  ? "bg-primary/15 text-primary font-semibold"
                  : "hover:bg-background text-muted-foreground"
              )}
            >
              <span>Precio estándar</span>
              <span className="font-bold">{eur(item.pricePerPerson)}{text.perUnitShort.replace("€", "")}</span>
            </button>

            {variants.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-1">Sin otras opciones</p>
            )}

            {variants.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => handleVariantSelect(v.id, v.name, variantUnitPrice(item.pricePerPerson, v))}
                className={cn(
                  "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-all",
                  item.variantId === v.id
                    ? "bg-primary/15 text-primary font-semibold"
                    : "hover:bg-background text-muted-foreground"
                )}
              >
                <span>{v.name}</span>
                <span className="font-bold">{eur(variantUnitPrice(item.pricePerPerson, v))}{text.perUnitShort.replace("€", "")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Controles de personas + total */}
      <div className="flex items-center justify-between">
        {/* +/- personas */}
        <div className="flex items-center gap-2">
          <QtyIcon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          <button
            type="button"
            onClick={() => updatePeople(item.cartItemId, Math.max(minPeople, item.people - 1))}
            disabled={item.people <= minPeople}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            aria-label={`Reducir ${text.quantityNoun}`}
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-sm font-bold text-foreground w-5 text-center">{item.people}</span>
          <button
            type="button"
            onClick={() => updatePeople(item.cartItemId, Math.min(maxPeople, item.people + 1))}
            disabled={item.people >= maxPeople}
            className="w-7 h-7 rounded-full border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 transition-colors"
            aria-label={`Aumentar ${text.quantityNoun}`}
          >
            <Plus className="w-3 h-3" />
          </button>
          <span className="text-xs text-muted-foreground">{text.quantityShort}</span>
          {item.pricingType === "per_unit" && item.unitCapacity && item.unitCapacity > 0 && (
            <span className="text-xs text-primary font-medium ml-1">
              → {Math.ceil(item.people / item.unitCapacity)} unid.
            </span>
          )}
        </div>

        {/* Total artículo */}
        <div className="flex flex-col items-end">
          {item.discountPercent && item.originalPricePerPerson && (
            <span className="text-xs text-muted-foreground line-through">
              {eur(item.originalPricePerPerson * item.people)}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {item.discountPercent && (
              <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded-full font-semibold">-{item.discountPercent}%</span>
            )}
            <span className="font-black text-sm text-foreground">
              {eur(item.estimatedTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Extras (si los hay) */}
      {item.extras.length > 0 && (
        <div className="space-y-0.5 pl-1">
          {item.extras.map((e, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              + {e.name} ×{e.quantity} ({eur(e.price * e.quantity)})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CartDrawer ───────────────────────────────────────────────────────────────

export default function CartDrawer() {
  const { items, totalItems, totalEstimated, isOpen, closeCart, clearCart } = useCart();
  const [, navigate] = useLocation();
  // Textos de la empresa: genéricos en una pyme («productos o servicios», «tienda»), los de siempre en la instalación propia
  const { features, text } = usePublicSite();

  function browse() {
    closeCart();
    if (features?.licensed && features.store) navigate(text.shopHref);
  }

  function goToCheckout() {
    closeCart();
    navigate("/checkout");
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={closeCart}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col transition-[transform,visibility] duration-300 ease-in-out",
          // Cerrado: fuera de la pantalla y oculto (ni se lee ni recibe el foco)
          isOpen ? "translate-x-0 visible" : "translate-x-full invisible"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de la compra"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-accent/5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <h2 className="font-display font-bold text-lg text-foreground">Tu carrito</h2>
            {totalItems > 0 && (
              <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                {totalItems}
              </span>
            )}
          </div>
          <button
            onClick={closeCart}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cerrar carrito"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido — lista de artículos */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <ShoppingCart className="w-9 h-9 text-muted-foreground/50" />
              </div>
              <div>
                <p className="font-display font-semibold text-foreground text-lg">Tu carrito está vacío</p>
                <p className="text-muted-foreground text-sm mt-1">
                  {text.cartEmpty}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={browse} className="rounded-full">
                {text.cartBrowse}
              </Button>
            </div>
          ) : (
            <div className="px-5">
              <div className="flex items-center justify-between py-3">
                <p className="text-xs text-muted-foreground">
                  {text.cartCount(totalItems)}
                </p>
                <button
                  onClick={clearCart}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Vaciar
                </button>
              </div>
              {items.map(item => (
                <CartItemRow key={item.cartItemId} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Footer — total + botón checkout */}
        {items.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3 bg-background">
            {/* Desglose */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Subtotal estimado</span>
              <span className="font-semibold text-foreground">
                {eur(totalEstimated)}
              </span>
            </div>
            <div className="flex items-center justify-between font-black text-base text-foreground border-t border-border pt-2">
              <span>Total</span>
              <span className="text-foreground text-lg">{eur(totalEstimated)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {features?.licensed ? "IVA incluido. Los descuentos se aplican en el siguiente paso." : "* El precio final se confirma en el siguiente paso."}
            </p>

            {/* Botón principal */}
            <Button
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-black rounded-xl shadow-lg transition-all"
              onClick={goToCheckout}
            >
              <span className="flex items-center gap-2">
                Finalizar compra
                <ArrowRight className="w-4 h-4" />
              </span>
            </Button>

            {/* Seguridad */}
            <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Lock className="w-3 h-3" />
              {text.securePayment}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
