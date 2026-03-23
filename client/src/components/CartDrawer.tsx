/**
 * CartDrawer — Panel lateral deslizante del carrito de la compra
 *
 * Muestra los artículos del carrito y el subtotal estimado.
 * El botón "Ir al pago" redirige a /checkout donde el usuario
 * introduce sus datos y confirma el pedido antes de Redsys.
 */
import { useLocation } from "wouter";
import { X, Trash2, ShoppingCart, Calendar, Users, Tag, ArrowRight, Lock } from "lucide-react";
import { useCart, type CartItem } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({ item }: { item: CartItem }) {
  const { removeItem } = useCart();
  const extrasTotal = item.extras.reduce((s, e) => s + e.price * e.quantity, 0);

  return (
    <div className="flex gap-3 py-4 border-b border-border/60 last:border-0">
      {/* Imagen */}
      {item.productImage ? (
        <img
          src={item.productImage}
          alt={item.productName}
          className="w-16 h-16 rounded-lg object-cover flex-shrink-0 shadow-sm"
        />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center flex-shrink-0">
          <ShoppingCart className="w-6 h-6 text-primary/40" />
        </div>
      )}

      {/* Detalles */}
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

        {item.variantName && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            {item.variantName}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(item.bookingDate)}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {item.people} {item.people === 1 ? "persona" : "personas"}
          </span>
        </div>

        {item.extras.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {item.extras.map((e, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                + {e.name} ×{e.quantity} ({(e.price * e.quantity).toFixed(2).replace(".", ",")} €)
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            {item.pricePerPerson.toFixed(2).replace(".", ",")} €/persona
            {extrasTotal > 0 && ` + ${extrasTotal.toFixed(2).replace(".", ",")} € extras`}
          </span>
          <span className="font-bold text-sm text-accent">
            {item.estimatedTotal.toFixed(2).replace(".", ",")} €
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── CartDrawer ───────────────────────────────────────────────────────────────

export default function CartDrawer() {
  const { items, totalItems, totalEstimated, isOpen, closeCart, clearCart } = useCart();
  const [, navigate] = useLocation();

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
          "fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
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
              <span className="bg-accent text-white text-xs font-bold px-2 py-0.5 rounded-full">
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
                  Añade experiencias desde el catálogo para reservarlas juntas en un solo pago.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={closeCart} className="rounded-full">
                Ver experiencias
              </Button>
            </div>
          ) : (
            <div className="px-5">
              <div className="flex items-center justify-between py-3">
                <p className="text-xs text-muted-foreground">
                  {totalItems} {totalItems === 1 ? "experiencia" : "experiencias"} seleccionadas
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
                {totalEstimated.toFixed(2).replace(".", ",")} €
              </span>
            </div>
            <div className="flex items-center justify-between font-black text-base text-foreground border-t border-border pt-2">
              <span>Total</span>
              <span className="text-accent text-lg">{totalEstimated.toFixed(2).replace(".", ",")} €</span>
            </div>
            <p className="text-xs text-muted-foreground/70">
              * El precio final se confirma en el siguiente paso.
            </p>

            {/* Botón principal */}
            <Button
              size="lg"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl shadow-lg shadow-orange-200/60 transition-all"
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
              Pago seguro con Redsys · SSL
            </p>
          </div>
        )}
      </div>
    </>
  );
}
