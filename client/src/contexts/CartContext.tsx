/**
 * CartContext — Carrito de la compra multi-experiencia
 *
 * Persiste en localStorage. Cada artículo representa una experiencia/producto
 * con su fecha, personas, variante seleccionada, extras y precio calculado en
 * frontend (estimado). El precio real se calcula siempre en backend al hacer checkout.
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface CartExtra {
  name: string;
  price: number;
  quantity: number;
}

export interface CartItem {
  /** ID único del artículo en el carrito (uuid local) */
  cartItemId: string;
  /** ID del producto en la BD */
  productId: number;
  /** Nombre del producto */
  productName: string;
  /** Imagen del producto (URL CDN) */
  productImage?: string;
  /** Slug para enlazar a la ficha */
  productSlug?: string;
  /** Fecha de la actividad (YYYY-MM-DD) */
  bookingDate: string;
  /** Número de personas */
  people: number;
  /** Mínimo de personas permitido */
  minPersons?: number;
  /** Máximo de personas permitido */
  maxPersons?: number;
  /** ID de variante seleccionada (opcional) */
  variantId?: number;
  /** Nombre de la variante (para mostrar) */
  variantName?: string;
  /** Extras seleccionados */
  extras: CartExtra[];
  /** Precio por persona (estimado, calculado en frontend) */
  pricePerPerson: number;
  /** Total estimado del artículo (sin servidor) */
  estimatedTotal: number;
}

interface CartContextValue {
  items: CartItem[];
  totalItems: number;
  totalEstimated: number;
  isOpen: boolean;
  addItem: (item: Omit<CartItem, "cartItemId">) => void;
  removeItem: (cartItemId: string) => void;
  updateItem: (cartItemId: string, updates: Partial<Omit<CartItem, "cartItemId">>) => void;
  /** Actualiza el número de personas y recalcula el total estimado */
  updatePeople: (cartItemId: string, people: number) => void;
  /** Actualiza la variante seleccionada y recalcula el total estimado */
  updateVariant: (cartItemId: string, variantId: number | undefined, variantName: string | undefined, pricePerPerson: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "nayade_cart_v1";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadFromStorage(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

function saveToStorage(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage puede estar bloqueado en modo privado
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => loadFromStorage());
  const [isOpen, setIsOpen] = useState(false);

  // Persistir en localStorage cuando cambian los artículos
  useEffect(() => {
    saveToStorage(items);
  }, [items]);

  const addItem = useCallback((item: Omit<CartItem, "cartItemId">) => {
    const newItem: CartItem = { ...item, cartItemId: generateId() };
    setItems(prev => [...prev, newItem]);
    setIsOpen(true); // Abrir el drawer al añadir
  }, []);

  const removeItem = useCallback((cartItemId: string) => {
    setItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
  }, []);

  const updateItem = useCallback((cartItemId: string, updates: Partial<Omit<CartItem, "cartItemId">>) => {
    setItems(prev => prev.map(i => i.cartItemId === cartItemId ? { ...i, ...updates } : i));
  }, []);

  /** Cambia el número de personas y recalcula el total estimado */
  const updatePeople = useCallback((cartItemId: string, people: number) => {
    setItems(prev => prev.map(i => {
      if (i.cartItemId !== cartItemId) return i;
      const extrasTotal = i.extras.reduce((s, e) => s + e.price * e.quantity, 0);
      const estimatedTotal = i.pricePerPerson * people + extrasTotal;
      return { ...i, people, estimatedTotal };
    }));
  }, []);

  /** Cambia la variante y recalcula el total estimado */
  const updateVariant = useCallback((
    cartItemId: string,
    variantId: number | undefined,
    variantName: string | undefined,
    pricePerPerson: number
  ) => {
    setItems(prev => prev.map(i => {
      if (i.cartItemId !== cartItemId) return i;
      const extrasTotal = i.extras.reduce((s, e) => s + e.price * e.quantity, 0);
      const estimatedTotal = pricePerPerson * i.people + extrasTotal;
      return { ...i, variantId, variantName, pricePerPerson, estimatedTotal };
    }));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setIsOpen(false);
  }, []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const toggleCart = useCallback(() => setIsOpen(prev => !prev), []);

  const totalItems = items.reduce((sum) => sum + 1, 0);
  const totalEstimated = items.reduce((sum, i) => sum + i.estimatedTotal, 0);

  return (
    <CartContext.Provider value={{
      items,
      totalItems,
      totalEstimated,
      isOpen,
      addItem,
      removeItem,
      updateItem,
      updatePeople,
      updateVariant,
      clearCart,
      openCart,
      closeCart,
      toggleCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
