/**
 * CartDrawer — Panel lateral deslizante del carrito de la compra
 *
 * Muestra los artículos del carrito, subtotal estimado y botón de checkout.
 * El precio real se calcula en backend al hacer checkout.
 */
import { useState } from "react";
import { X, Trash2, ShoppingCart, Calendar, Users, Tag, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { useCart, type CartItem } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
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

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
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
                + {e.name} x{e.quantity} ({(e.price * e.quantity).toFixed(2).replace(".", ",")} €)
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

// ─── Formulario de datos del cliente ─────────────────────────────────────────

interface CustomerForm {
  name: string;
  email: string;
  phone: string;
}

// ─── CartDrawer ───────────────────────────────────────────────────────────────

export default function CartDrawer() {
  const { items, totalItems, totalEstimated, isOpen, closeCart, clearCart } = useCart();
  const [step, setStep] = useState<"cart" | "customer">("cart");
  const [customer, setCustomer] = useState<CustomerForm>({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);

  const cartCheckout = trpc.reservations.cartCheckout.useMutation();

  const handleCheckout = async () => {
    setError(null);
    if (!customer.name.trim() || customer.name.trim().length < 2) {
      setError("Por favor, introduce tu nombre completo.");
      return;
    }
    if (!customer.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      setError("Por favor, introduce un email válido.");
      return;
    }

    try {
      const result = await cartCheckout.mutateAsync({
        items: items.map(i => ({
          productId: i.productId,
          bookingDate: i.bookingDate,
          people: i.people,
          variantId: i.variantId,
          extras: i.extras,
        })),
        customerName: customer.name.trim(),
        customerEmail: customer.email.trim(),
        customerPhone: customer.phone.trim() || undefined,
        origin: window.location.origin,
      });

      // Enviar formulario Redsys automáticamente
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
      setError(msg);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

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
            <h2 className="font-display font-bold text-lg text-foreground">
              Tu carrito
            </h2>
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

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            /* Carrito vacío */
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
              <Button
                variant="outline"
                size="sm"
                onClick={closeCart}
                className="rounded-full"
              >
                Ver experiencias
              </Button>
            </div>
          ) : step === "cart" ? (
            /* Lista de artículos */
            <div className="px-5">
              <div className="flex items-center justify-between py-3">
                <p className="text-xs text-muted-foreground">
                  {totalItems} {totalItems === 1 ? "experiencia" : "experiencias"} seleccionadas
                </p>
                <button
                  onClick={() => { clearCart(); setStep("cart"); }}
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
          ) : (
            /* Formulario de datos del cliente */
            <div className="px-5 py-4 space-y-4">
              <div>
                <h3 className="font-display font-semibold text-base text-foreground mb-1">Tus datos de contacto</h3>
                <p className="text-xs text-muted-foreground">Necesitamos tus datos para enviarte la confirmación de reserva.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Nombre completo <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={customer.name}
                    onChange={e => setCustomer(p => ({ ...p, name: e.target.value }))}
                    placeholder="Carlos García López"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Email <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="email"
                    value={customer.email}
                    onChange={e => setCustomer(p => ({ ...p, email: e.target.value }))}
                    placeholder="carlos@ejemplo.com"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Teléfono <span className="text-muted-foreground">(opcional)</span>
                  </label>
                  <input
                    type="tel"
                    value={customer.phone}
                    onChange={e => setCustomer(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+34 600 000 000"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Resumen compacto */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Resumen del pedido</p>
                {items.map(item => (
                  <div key={item.cartItemId} className="flex justify-between text-xs text-muted-foreground">
                    <span className="line-clamp-1 flex-1 mr-2">{item.productName} × {item.people}p</span>
                    <span className="flex-shrink-0 font-medium text-foreground">
                      {item.estimatedTotal.toFixed(2).replace(".", ",")} €
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer con total y CTA */}
        {items.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3 bg-background">
            {/* Total estimado */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Total estimado</p>
                <p className="text-xs text-muted-foreground">El precio exacto se confirma al pagar</p>
              </div>
              <p className="text-2xl font-bold text-accent font-display">
                {totalEstimated.toFixed(2).replace(".", ",")} €
              </p>
            </div>

            {/* Botones */}
            {step === "cart" ? (
              <Button
                className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full shadow-md"
                onClick={() => { setStep("customer"); setError(null); }}
              >
                Continuar al pago
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <div className="space-y-2">
                <Button
                  className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full shadow-md"
                  onClick={handleCheckout}
                  disabled={cartCheckout.isPending}
                >
                  {cartCheckout.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      Pagar {totalEstimated.toFixed(2).replace(".", ",")} €
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full rounded-full text-muted-foreground"
                  onClick={() => { setStep("cart"); setError(null); }}
                  disabled={cartCheckout.isPending}
                >
                  ← Volver al carrito
                </Button>
              </div>
            )}

            {/* Seguridad */}
            <p className="text-center text-xs text-muted-foreground">
              🔒 Pago seguro con Redsys · SSL 256-bit
            </p>
          </div>
        )}
      </div>
    </>
  );
}
