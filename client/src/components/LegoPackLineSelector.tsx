/**
 * Componente reutilizable: Selector de líneas para Lego Packs
 * Permite al cliente/admin personalizar qué actividades incluir y cantidades
 * Usado en: LegoPackDetail (ecommerce) + TpvScreen (admin TPV)
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Minus, Check } from "lucide-react";
import { toast } from "sonner";

export interface LegoPackLineWithPricing {
  lineId: number;
  sourceName: string;
  internalName?: string | null;
  groupLabel?: string | null;
  isOptional: boolean;
  isClientVisible: boolean;
  isActiveInOperation: boolean;
  isQuantityEditable: boolean;
  quantity: number;
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  overridePrice?: number | null;
  overridePriceLabel?: string | null;
  frontendNote?: string | null;
}

export interface LegoPackLineSelectorProps {
  packId: number;
  initialActiveLineIds?: number[];
  onConfirm: (activeLineIds: number[], customPrice: number) => void;
  onCancel?: () => void;
  isModal?: boolean;
  gradientClass?: string;
  textColorClass?: string;
}

export function LegoPackLineSelector({
  packId,
  initialActiveLineIds,
  onConfirm,
  onCancel,
  isModal = false,
  gradientClass = "from-sky-600 to-blue-800",
  textColorClass = "text-sky-700",
}: LegoPackLineSelectorProps) {
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set(initialActiveLineIds ?? []));
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  // Calcular precio con líneas seleccionadas
  const { data: pricing, isLoading } = trpc.legoPacks.calculateLegoPackPrice.useQuery(
    { legoPackId: packId, activeLineIds: Array.from(selectedLineIds) },
    { staleTime: 5000 }
  );

  const lines = (pricing?.lines ?? []) as LegoPackLineWithPricing[];

  // Inicializar selección y cantidades
  useEffect(() => {
    if (!isInitialized && lines.length > 0) {
      const initialQty: Record<number, number> = {};
      const defaultSelected = new Set<number>();

      lines.forEach((line) => {
        initialQty[line.lineId] = line.quantity;
        // Seleccionar automáticamente líneas no-opcionales (obligatorias)
        if (!line.isOptional) {
          defaultSelected.add(line.lineId);
        }
      });

      setQuantities(initialQty);
      setSelectedLineIds(defaultSelected);
      setIsInitialized(true);
    }
  }, [lines, isInitialized]);

  const toggleLine = (lineId: number, isOptional: boolean) => {
    if (!isOptional) return; // Solo se puede toggle si es opcional
    const newSelected = new Set(selectedLineIds);
    if (newSelected.has(lineId)) {
      newSelected.delete(lineId);
    } else {
      newSelected.add(lineId);
    }
    setSelectedLineIds(newSelected);
  };

  const updateQuantity = (lineId: number, qty: number) => {
    if (qty < 1) return;
    setQuantities((prev) => ({ ...prev, [lineId]: qty }));
  };

  const handleConfirm = () => {
    if (selectedLineIds.size === 0) {
      toast.error("Selecciona al menos una actividad");
      return;
    }
    onConfirm(Array.from(selectedLineIds), pricing?.totalFinal ?? 0);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Calculando precio...
      </div>
    );
  }

  return (
    <div className={isModal ? "p-6" : "space-y-4"}>
      {/* Header */}
      {!isModal && (
        <div className="mb-4">
          <h3 className={`font-black ${textColorClass} mb-2`}>Personaliza tu pack</h3>
          <p className="text-sm text-slate-600">Activa o desactiva las actividades opcionales</p>
        </div>
      )}

      {/* Líneas */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {lines.map((line) => (
          <div
            key={line.lineId}
            className={`flex items-center gap-3 p-3 rounded-lg border ${
              selectedLineIds.has(line.lineId)
                ? "bg-slate-50 border-slate-300"
                : "bg-slate-100/50 border-slate-200 opacity-60"
            } ${!line.isActiveInOperation ? "opacity-50" : ""}`}
          >
            {/* Checkbox (solo si es opcional) */}
            {line.isOptional ? (
              <Checkbox
                checked={selectedLineIds.has(line.lineId)}
                onCheckedChange={() => toggleLine(line.lineId, true)}
                disabled={!line.isActiveInOperation}
                className="mt-1"
              />
            ) : (
              <div className="w-5 h-5 flex items-center justify-center">
                <Check className="w-4 h-4 text-green-600" />
              </div>
            )}

            {/* Info de la línea */}
            <div className="flex-1">
              <div className="font-semibold text-sm text-slate-900">
                {line.internalName || line.sourceName || "Actividad"}
              </div>
              {line.groupLabel && <p className="text-xs text-slate-500">{line.groupLabel}</p>}
              {!line.isActiveInOperation && (
                <p className="text-xs text-orange-600 font-medium">No disponible actualmente</p>
              )}
            </div>

            {/* Controles de cantidad */}
            {selectedLineIds.has(line.lineId) && line.isQuantityEditable && (
              <div className="flex items-center gap-1 bg-white rounded border border-slate-200 px-2 py-1">
                <button
                  onClick={() => updateQuantity(line.lineId, (quantities[line.lineId] ?? 1) - 1)}
                  className="p-0.5 hover:bg-slate-100 rounded"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <input
                  type="number"
                  min="1"
                  value={quantities[line.lineId] ?? line.quantity}
                  onChange={(e) => updateQuantity(line.lineId, parseInt(e.target.value) || 1)}
                  className="w-8 text-center text-sm border-0 focus:ring-0 p-0"
                />
                <button
                  onClick={() => updateQuantity(line.lineId, (quantities[line.lineId] ?? 1) + 1)}
                  className="p-0.5 hover:bg-slate-100 rounded"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Precio */}
            {selectedLineIds.has(line.lineId) && (
              <div className="text-right">
                {line.overridePrice != null && line.overridePrice > 0 ? (
                  <div className="text-sm">
                    <p className={`font-bold ${textColorClass}`}>{line.overridePrice.toFixed(2)} €</p>
                    {line.overridePriceLabel && (
                      <p className="text-xs text-slate-500">{line.overridePriceLabel}</p>
                    )}
                  </div>
                ) : (
                  <div className="text-sm">
                    {line.discountAmount > 0 ? (
                      <>
                        <p className={`font-bold ${textColorClass}`}>{line.finalPrice.toFixed(2)} €</p>
                        <p className="text-xs text-slate-400 line-through">{line.basePrice.toFixed(2)} €</p>
                      </>
                    ) : (
                      <p className="font-bold text-slate-700">{line.finalPrice.toFixed(2)} €</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Resumen de precio */}
      {pricing && (
        <div className={`mt-4 p-4 rounded-lg border-2 ${
          gradientClass.includes('sky') ? 'bg-sky-50 border-sky-200' :
          gradientClass.includes('emerald') ? 'bg-emerald-50 border-emerald-200' :
          gradientClass.includes('violet') ? 'bg-violet-50 border-violet-200' :
          'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-sm font-semibold text-slate-700">Precio total:</span>
            <span className={`text-2xl font-black ${textColorClass}`}>
              {pricing.totalFinal.toFixed(2)} €
            </span>
          </div>
          {pricing.totalDiscount > 0 && (
            <div className="text-xs text-green-700 font-medium">
              Ahorro: -{pricing.totalDiscount.toFixed(2)} €
            </div>
          )}
        </div>
      )}

      {/* Botones */}
      <div className="flex gap-2 mt-4 pt-4 border-t">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
        )}
        <Button
          onClick={handleConfirm}
          disabled={selectedLineIds.size === 0 || isLoading}
          className="flex-1"
        >
          Confirmar Selección
        </Button>
      </div>
    </div>
  );
}
