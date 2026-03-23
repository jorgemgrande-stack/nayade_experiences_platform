/**
 * CartIcon — Icono del carrito con badge numérico para el navbar público
 */
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { cn } from "@/lib/utils";

interface CartIconProps {
  className?: string;
  /** Si true, usa colores claros (para navbar sobre imagen oscura) */
  light?: boolean;
}

export default function CartIcon({ className, light = false }: CartIconProps) {
  const { totalItems, toggleCart } = useCart();

  return (
    <button
      onClick={toggleCart}
      aria-label={`Carrito de la compra${totalItems > 0 ? ` (${totalItems} artículo${totalItems !== 1 ? "s" : ""})` : ""}`}
      className={cn(
        "relative flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
        light
          ? "text-white hover:bg-white/20"
          : "text-foreground hover:bg-muted",
        className
      )}
    >
      <ShoppingCart className="w-5 h-5" />
      {totalItems > 0 && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none bg-accent text-white shadow-sm"
          aria-hidden="true"
        >
          {totalItems > 99 ? "99+" : totalItems}
        </span>
      )}
    </button>
  );
}
