/**
 * DiscountRibbon — Ribbon de descuento para fichas y tarjetas de producto.
 *
 * Props:
 *   discountPercent  — número (e.g. 10) o string decimal (e.g. "10.00")
 *   discountExpiresAt — Date | string | null
 *   variant          — "card" (esquina superior derecha de tarjeta) | "detail" (ficha de producto)
 */

interface DiscountRibbonProps {
  discountPercent: number | string | null | undefined;
  discountExpiresAt?: Date | string | null;
  variant?: "card" | "detail";
}

function getDaysLeft(expiresAt: Date | string | null | undefined): number | null {
  if (!expiresAt) return null;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (isNaN(exp.getTime())) return null;
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Verde semáforo: #16a34a (green-600) con gradiente a #22c55e (green-500)
const GREEN_GRADIENT = "#16a34a";
const GREEN_LIGHT = "#22c55e";

export function DiscountRibbon({ discountPercent, discountExpiresAt, variant = "card" }: DiscountRibbonProps) {
  const pct = discountPercent != null ? parseFloat(String(discountPercent)) : null;
  if (!pct || pct <= 0) return null;

  // Si hay fecha de caducidad y ya expiró, no mostrar
  const daysLeft = getDaysLeft(discountExpiresAt);
  if (daysLeft !== null && daysLeft < 0) return null;

  const daysLabel =
    daysLeft === null
      ? null
      : daysLeft === 0
      ? "Hoy"
      : daysLeft === 1
      ? "1 día"
      : `${daysLeft} días`;

  if (variant === "detail") {
    return (
      <div
        className="inline-flex items-center gap-2 text-white rounded-full px-4 py-2 shadow-lg"
        style={{ background: `linear-gradient(135deg, ${GREEN_GRADIENT}, ${GREEN_LIGHT})` }}
      >
        <span className="text-xl font-black tracking-tight leading-none">-{Math.round(pct)}%</span>
        {daysLabel && (
          <>
            <span className="opacity-60 text-sm">·</span>
            <span className="text-sm font-semibold">
              {daysLabel === "Hoy" ? "¡Oferta termina hoy!" : `Oferta: ${daysLabel}`}
            </span>
          </>
        )}
      </div>
    );
  }

  // variant === "card" — ribbon triangular en esquina superior derecha
  // Tamaño aumentado: 100×100 para que el texto sea más visible
  const SIZE = 100;
  return (
    <div className="absolute top-0 right-0 z-20 overflow-hidden" style={{ width: SIZE, height: SIZE }}>
      {/* Triángulo de fondo verde semáforo */}
      <div
        className="absolute top-0 right-0"
        style={{
          width: 0,
          height: 0,
          borderStyle: "solid",
          borderWidth: `0 ${SIZE}px ${SIZE}px 0`,
          borderColor: `transparent ${GREEN_GRADIENT} transparent transparent`,
          filter: "drop-shadow(-1px 2px 3px rgba(0,0,0,0.30))",
        }}
      />
      {/* Texto del ribbon rotado 45° */}
      <div
        className="absolute top-0 right-0 flex flex-col items-center justify-center text-white"
        style={{
          width: 70,
          height: 70,
          transform: "translate(5px, -5px) rotate(45deg) translate(0, 16px)",
        }}
      >
        {/* Porcentaje grande y llamativo */}
        <span
          className="font-black leading-none tracking-tight"
          style={{ fontSize: 18, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
        >
          -{Math.round(pct)}%
        </span>
        {daysLabel && (
          <span
            className="font-semibold leading-none mt-0.5 opacity-95"
            style={{ fontSize: 10, textShadow: "0 1px 1px rgba(0,0,0,0.3)" }}
          >
            {daysLabel === "Hoy" ? "¡Hoy!" : daysLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Calcula el precio con descuento aplicado.
 * Devuelve null si no hay descuento activo.
 */
export function getDiscountedPrice(
  basePrice: number | string,
  discountPercent: number | string | null | undefined,
  discountExpiresAt?: Date | string | null
): number | null {
  const pct = discountPercent != null ? parseFloat(String(discountPercent)) : null;
  if (!pct || pct <= 0) return null;

  const daysLeft = getDaysLeft(discountExpiresAt);
  if (daysLeft !== null && daysLeft < 0) return null;

  const base = parseFloat(String(basePrice));
  if (isNaN(base)) return null;

  return Math.round(base * (1 - pct / 100) * 100) / 100;
}
