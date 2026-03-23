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
      <div className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-400 text-white rounded-full px-4 py-1.5 shadow-md">
        <span className="text-base font-bold">-{Math.round(pct)}%</span>
        {daysLabel && (
          <>
            <span className="opacity-70 text-xs">·</span>
            <span className="text-xs font-medium">
              {daysLabel === "Hoy" ? "¡Oferta termina hoy!" : `Oferta: ${daysLabel}`}
            </span>
          </>
        )}
      </div>
    );
  }

  // variant === "card" — ribbon en esquina superior derecha
  return (
    <div className="absolute top-0 right-0 z-20 overflow-hidden" style={{ width: 80, height: 80 }}>
      {/* Triángulo de fondo */}
      <div
        className="absolute top-0 right-0"
        style={{
          width: 0,
          height: 0,
          borderStyle: "solid",
          borderWidth: "0 80px 80px 0",
          borderColor: "transparent #f97316 transparent transparent",
          filter: "drop-shadow(-1px 1px 2px rgba(0,0,0,0.25))",
        }}
      />
      {/* Texto del ribbon */}
      <div
        className="absolute top-0 right-0 flex flex-col items-center justify-center text-white"
        style={{ width: 56, height: 56, transform: "translate(4px, -4px) rotate(45deg) translate(0, 12px)" }}
      >
        <span className="text-xs font-extrabold leading-none">-{Math.round(pct)}%</span>
        {daysLabel && (
          <span className="text-[9px] font-semibold leading-none mt-0.5 opacity-90">
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
