/**
 * AddToCartModal — Mini-modal reutilizable para añadir un producto al carrito.
 *
 * Muestra solo los campos esenciales: fecha y número de personas.
 * No hace ningún pago — simplemente añade el artículo al CartContext.
 * El botón "Comprar ahora" delega en el BookingModal de Redsys (flujo existente).
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Zap, Calendar, Users, Minus, Plus } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { toast } from "sonner";

export interface AddToCartProduct {
  id: number;
  title: string;
  basePrice: string | number;
  image1?: string | null;
  slug?: string | null;
  minPersons?: number | null;
  maxPersons?: number | null;
}

interface AddToCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: AddToCartProduct;
  /** Callback para abrir el BookingModal de Redsys (flujo "Comprar ahora") */
  onBuyNow?: () => void;
}

export default function AddToCartModal({ isOpen, onClose, product, onBuyNow }: AddToCartModalProps) {
  const { addItem, openCart } = useCart();

  const today = new Date().toISOString().split("T")[0];
  const [bookingDate, setBookingDate] = useState(today);
  const [people, setPeople] = useState(Math.max(1, product.minPersons ?? 1));

  const minPeople = Math.max(1, product.minPersons ?? 1);
  const maxPeople = product.maxPersons ?? 20;
  const price = parseFloat(String(product.basePrice ?? 0));
  const estimatedTotal = price * people;

  function handleAddToCart() {
    if (!bookingDate) {
      toast.error("Selecciona una fecha para la actividad");
      return;
    }
    addItem({
      productId: product.id,
      productName: product.title,
      productImage: product.image1 ?? undefined,
      productSlug: product.slug ?? undefined,
      bookingDate,
      people,
      pricePerPerson: price,
      estimatedTotal,
      extras: [],
    });
    toast.success(`"${product.title}" añadido al carrito`, {
      description: `${bookingDate} · ${people} persona${people !== 1 ? "s" : ""} · ${estimatedTotal.toFixed(2)} €`,
      action: {
        label: "Ver carrito",
        onClick: () => openCart(),
      },
    });
    onClose();
    openCart();
  }

  function handleBuyNow() {
    onClose();
    onBuyNow?.();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl">
        {/* Cabecera con imagen */}
        {product.image1 && (
          <div className="relative h-32 overflow-hidden">
            <img
              src={product.image1}
              alt={product.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <p className="text-white font-bold text-base leading-tight line-clamp-2">{product.title}</p>
              <p className="text-orange-300 text-sm font-semibold mt-0.5">{price.toFixed(2)} € / persona</p>
            </div>
          </div>
        )}

        <div className="p-5">
          {!product.image1 && (
            <DialogHeader className="mb-4">
              <DialogTitle className="font-display text-lg">{product.title}</DialogTitle>
              <p className="text-orange-600 font-semibold text-sm">{price.toFixed(2)} € / persona</p>
            </DialogHeader>
          )}

          <div className="space-y-4">
            {/* Fecha */}
            <div>
              <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                <Calendar className="w-3.5 h-3.5 text-orange-500" /> Fecha de la actividad
              </Label>
              <Input
                type="date"
                value={bookingDate}
                min={today}
                onChange={(e) => setBookingDate(e.target.value)}
                className="h-10 text-sm"
              />
            </div>

            {/* Personas */}
            <div>
              <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                <Users className="w-3.5 h-3.5 text-orange-500" /> Personas
              </Label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPeople((p) => Math.max(minPeople, p - 1))}
                  disabled={people <= minPeople}
                  className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-xl font-bold text-slate-900 w-8 text-center">{people}</span>
                <button
                  onClick={() => setPeople((p) => Math.min(maxPeople, p + 1))}
                  disabled={people >= maxPeople}
                  className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-500 ml-1">
                  (máx. {maxPeople})
                </span>
              </div>
            </div>

            {/* Total estimado */}
            <div className="bg-orange-50 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-slate-600">Total estimado</span>
              <span className="text-lg font-black text-orange-600">{estimatedTotal.toFixed(2)} €</span>
            </div>

            {/* Botones */}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleAddToCart}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold h-11"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Añadir al carrito
              </Button>
              {onBuyNow && (
                <Button
                  onClick={handleBuyNow}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold h-11"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Comprar ya
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-400 text-center">
              El precio final se confirma al completar el pago
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
