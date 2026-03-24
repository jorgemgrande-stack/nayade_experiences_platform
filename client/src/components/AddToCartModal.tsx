/**
 * AddToCartModal — Mini-modal reutilizable para añadir un producto al carrito.
 *
 * Muestra: selector de variante (si el producto tiene variantes), fecha y personas.
 * Al confirmar, añade el artículo al CartContext y abre el drawer automáticamente.
 * Un único flujo de compra: carrito → /checkout → Redsys.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Calendar, Users, Minus, Plus, Tag, ChevronDown } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export interface AddToCartProduct {
  id: number;
  title: string;
  basePrice: string | number;
  image1?: string | null;
  slug?: string | null;
  minPersons?: number | null;
  maxPersons?: number | null;
  discountPercent?: number | null;
  discountExpiresAt?: string | Date | null;
}

interface AddToCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: AddToCartProduct;
}

export default function AddToCartModal({ isOpen, onClose, product }: AddToCartModalProps) {
  const { addItem, openCart } = useCart();

  const today = new Date().toISOString().split("T")[0];
  const [bookingDate, setBookingDate] = useState(today);
  const [people, setPeople] = useState(Math.max(1, product.minPersons ?? 1));
  const [selectedVariantId, setSelectedVariantId] = useState<number | undefined>(undefined);

  const minPeople = Math.max(1, product.minPersons ?? 1);
  const maxPeople = product.maxPersons ?? 20;
  const basePrice = parseFloat(String(product.basePrice ?? 0));

  // Cargar variantes del producto
  const { data: variants = [] } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: product.id },
    { enabled: isOpen && product.id > 0 }
  );

  // Precio efectivo según variante seleccionada
  const selectedVariant = variants.find(v => v.id === selectedVariantId);
  const rawPrice = selectedVariant
    ? parseFloat(String(selectedVariant.priceModifier ?? basePrice))
    : basePrice;

  // Calcular descuento activo
  const discountPct = product.discountPercent ?? 0;
  const discountExpiry = product.discountExpiresAt ? new Date(product.discountExpiresAt as string) : null;
  const isDiscountActive = discountPct > 0 && (!discountExpiry || discountExpiry >= new Date());
  const effectivePrice = isDiscountActive ? rawPrice * (1 - discountPct / 100) : rawPrice;

  const estimatedTotal = effectivePrice * people;

  function handleAddToCart() {
    addItem({
      productId: product.id,
      productName: product.title,
      productImage: product.image1 ?? undefined,
      productSlug: product.slug ?? undefined,
      bookingDate,
      people,
      minPersons: minPeople,
      maxPersons: maxPeople,
      variantId: selectedVariant?.id,
      variantName: selectedVariant?.name,
      extras: [],
      pricePerPerson: effectivePrice,
      originalPricePerPerson: isDiscountActive ? rawPrice : undefined,
      discountPercent: isDiscountActive ? discountPct : undefined,
      estimatedTotal,
    });
    onClose();
    openCart();
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
              <div className="flex items-center gap-2 mt-0.5">
                {isDiscountActive && (
                  <span className="text-white/60 text-sm line-through">{rawPrice.toFixed(2)} €</span>
                )}
                <p className="text-orange-300 text-sm font-semibold">
                  {effectivePrice.toFixed(2)} € / persona
                  {isDiscountActive && <span className="ml-1 text-xs bg-green-500 text-white px-1.5 py-0.5 rounded-full">-{discountPct}%</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-5">
          {!product.image1 && (
            <DialogHeader className="mb-4">
              <DialogTitle className="font-display text-lg">{product.title}</DialogTitle>
              <div className="flex items-center gap-2">
            {isDiscountActive && (
              <span className="text-slate-400 text-sm line-through">{rawPrice.toFixed(2)} €</span>
            )}
            <p className="text-orange-600 font-semibold text-sm">
              {effectivePrice.toFixed(2)} € / persona
              {isDiscountActive && <span className="ml-1 text-xs bg-green-500 text-white px-1.5 py-0.5 rounded-full">-{discountPct}%</span>}
            </p>
          </div>
            </DialogHeader>
          )}

          <div className="space-y-4">

            {/* Selector de variante */}
            {variants.length > 0 && (
              <div>
                <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                  <Tag className="w-3.5 h-3.5 text-orange-500" /> Modalidad
                </Label>
                <div className="space-y-1.5">
                  {/* Opción "precio base" si no hay variante requerida */}
                  {!variants.some(v => v.isRequired) && (
                    <button
                      type="button"
                      onClick={() => setSelectedVariantId(undefined)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all",
                        selectedVariantId === undefined
                          ? "border-orange-400 bg-orange-50 text-orange-700 font-semibold"
                          : "border-slate-200 text-slate-600 hover:border-orange-200 hover:bg-orange-50/50"
                      )}
                    >
                      <span>Precio estándar</span>
                      <span className="font-bold">{basePrice.toFixed(2)} €/p.</span>
                    </button>
                  )}
                  {variants.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariantId(v.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all",
                        selectedVariantId === v.id
                          ? "border-orange-400 bg-orange-50 text-orange-700 font-semibold"
                          : "border-slate-200 text-slate-600 hover:border-orange-200 hover:bg-orange-50/50"
                      )}
                    >
                      <span>{v.name}</span>
                      <span className="font-bold">
                        {parseFloat(String(v.priceModifier ?? 0)).toFixed(2)} €/p.
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                  type="button"
                  onClick={() => setPeople((p) => Math.max(minPeople, p - 1))}
                  disabled={people <= minPeople}
                  className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-xl font-bold text-slate-900 w-8 text-center">{people}</span>
                <button
                  type="button"
                  onClick={() => setPeople((p) => Math.min(maxPeople, p + 1))}
                  disabled={people >= maxPeople}
                  className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-500 ml-1">(máx. {maxPeople})</span>
              </div>
            </div>

            {/* Total estimado */}
            <div className="bg-orange-50 rounded-xl px-4 py-3 flex justify-between items-center">
              <div>
                <span className="text-sm text-slate-600">Total estimado</span>
                {selectedVariant && (
                  <p className="text-xs text-orange-600 mt-0.5">{selectedVariant.name}</p>
                )}
              </div>
              <span className="text-lg font-black text-orange-600">{estimatedTotal.toFixed(2)} €</span>
            </div>

            {/* Botón único */}
            <div className="pt-1">
              <Button
                onClick={handleAddToCart}
                disabled={variants.length > 0 && variants.some(v => v.isRequired) && selectedVariantId === undefined}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold h-11 disabled:opacity-50"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Añadir al carrito
              </Button>
              {variants.length > 0 && variants.some(v => v.isRequired) && selectedVariantId === undefined && (
                <p className="text-xs text-red-500 text-center mt-1.5">Selecciona una modalidad para continuar</p>
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
