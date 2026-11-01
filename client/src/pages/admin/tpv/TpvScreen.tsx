/**
 * Punto de venta presencial — pantalla principal (modo quiosco)
 * Usable en escritorio, tablet vertical y móvil: en pantallas estrechas el carrito se abre desde una barra inferior.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  buildTpvFilters, matchesTpvFilter, productBadge, pickInitialRegister, LAST_REGISTER_KEY, newSaleAttemptKey,
} from "./tpvScreenLogic";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LegoPackLineSelector } from "@/components/LegoPackLineSelector";
import { toast } from "sonner";
import {
  ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone,
  Layers, X, User, Calendar, Clock, Users, Tag, ChevronDown, ChevronUp,
  Zap, Waves, Baby, Sparkles, Star, Sun, Filter, LogOut, Settings,
  Receipt, ArrowLeft, SplitSquareHorizontal, AlarmClock, PenLine, BarChart3,
  Package, Search, CheckCircle2, Store,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import TpvOpenSession from "./TpvOpenSession";
import TpvCloseSession from "./TpvCloseSession";
import TpvCashMovement from "./TpvCashMovement";
import TpvSplitPayment from "./TpvSplitPayment";
import TpvTicket from "./TpvTicket";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductType = "experience" | "pack" | "spa" | "hotel" | "restaurant" | "extra" | "legoPack";

interface ProductVariant {
  id: number;
  name: string;
  priceModifier: string | null;
  priceType: "fixed" | "percentage" | "per_person";
  sortOrder: number;
}

interface CatalogProduct {
  id: number;
  title: string;
  basePrice: string | null;
  coverImageUrl: string | null;
  discountPercent: string | null;
  discountExpiresAt: Date | string | null;
  productType: ProductType;
  categoryId?: number | null;
  hasTimeSlots?: boolean | null;
  variants?: ProductVariant[];
}

interface CartItem {
  id: string; // unique cart line id
  product: CatalogProduct;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  eventDate?: string;
  eventTime?: string;
  participants: number;
  notes?: string;
  selectedTimeSlotId?: number;
  selectedTimeSlotLabel?: string;
  selectedTime?: string;
  isManual?: boolean;
  variantId?: number;
  variantName?: string;
  legoPackLineIds?: number[]; // Para Lego Packs personalizados
  legoPackLinePeople?: Record<number, number>; // Personas por línea
}

type PaymentMethod = "cash" | "card" | "bizum" | "other";

interface Payment {
  method: PaymentMethod;
  amount: number;
  amountTendered?: number;
  payerName?: string;
}

/** "all", un tipo de producto o "cat:<id>" (categoría propia de la empresa). */
type Filter = string;

function readLastRegister(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_REGISTER_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveLastRegister(id: number) {
  try {
    localStorage.setItem(LAST_REGISTER_KEY, String(id));
  } catch {
    /* sin almacenamiento local: se vuelve a preguntar */
  }
}

// ─── Category colors ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ProductType, string> = {
  experience: "from-primary/70 to-primary",
  pack: "from-primary/70 to-primary",
  spa: "from-primary/70 to-primary",
  hotel: "from-primary/70 to-primary",
  restaurant: "from-primary/70 to-primary",
  extra: "from-gray-600 to-slate-700",
  legoPack: "from-primary/70 to-primary",
};

const FILTER_ICONS: Record<string, React.ReactNode> = {
  all: <Filter className="w-3 h-3" />,
  experience: <Waves className="w-3 h-3" />,
  pack: <Layers className="w-3 h-3" />,
  spa: <Sparkles className="w-3 h-3" />,
  hotel: <Star className="w-3 h-3" />,
  legoPack: <Zap className="w-3 h-3" />,
};
const filterIcon = (key: string, licensed: boolean) =>
  key.startsWith("cat:") || (licensed && key === "experience") ? <Tag className="w-3 h-3" /> : FILTER_ICONS[key];

/** Icono de un producto sin imagen: el de siempre en la instalación original, uno genérico en una pyme. */
function ProductIcon({ licensed, className }: { licensed: boolean; className: string }) {
  return licensed ? <Package className={className} /> : <Waves className={className} />;
}

/** Descuento vigente del producto (0 si no hay descuento o ya caducó). */
function getActiveDiscountPercent(product: CatalogProduct): number {
  const pct = parseFloat(String(product.discountPercent ?? "0"));
  if (!pct || pct <= 0) return 0;
  if (product.discountExpiresAt) {
    const exp = new Date(product.discountExpiresAt);
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) return 0;
  }
  return pct;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TpvScreen() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  // Caja: la última elegida en este dispositivo (si sigue existiendo) o la que elija el cajero
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [choosingRegister, setChoosingRegister] = useState(false);
  const [newRegisterName, setNewRegisterName] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  // Cliente existente elegido en la búsqueda (su email lo vincula en el CRM al cobrar)
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<{ id: number; name: string } | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // Una clave por carrito: un doble clic o un reintento del mismo carrito no graba dos ventas
  const saleAttemptKey = useMemo(() => newSaleAttemptKey(), [cart]);
  const [filter, setFilter] = useState<Filter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  // Promo code
  const [promoCode, setPromoCode] = useState("");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoCodeData, setPromoCodeData] = useState<{ id: number; discountPercent: number; code: string } | null>(null);
  const [promoCodeLoading, setPromoCodeLoading] = useState(false);
  const [showOpenSession, setShowOpenSession] = useState(false);
  const [showCloseSession, setShowCloseSession] = useState(false);
  const [showCashMovement, setShowCashMovement] = useState<"in" | "out" | null>(null);
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  // Modal de variantes y time slots
  const [pendingProduct, setPendingProduct] = useState<CatalogProduct | null>(null);
  const [showVariantsModal, setShowVariantsModal] = useState(false);
  const [pendingVariantId, setPendingVariantId] = useState<number | undefined>(undefined);
  const [pendingVariantName, setPendingVariantName] = useState<string | undefined>(undefined);
  const [pendingVariantPrice, setPendingVariantPrice] = useState<number | undefined>(undefined);
  const [showTimeSlotsModal, setShowTimeSlotsModal] = useState(false);
  const [tpvSelectedSlotId, setTpvSelectedSlotId] = useState<number | null>(null);
  const [tpvSelectedTime, setTpvSelectedTime] = useState("");
  // Modal de selector Lego Packs
  const [showLegoPackSelector, setShowLegoPackSelector] = useState(false);
  const [pendingLegoPackId, setPendingLegoPackId] = useState<number | null>(null);
  const [pendingLegoPackLineIds, setPendingLegoPackLineIds] = useState<number[]>([]);
  const [pendingLegoPackLinePeople, setPendingLegoPackLinePeople] = useState<Record<number, number>>({});
  const [pendingLegoPackLineNames, setPendingLegoPackLineNames] = useState<Record<number, string>>({});
  // Modal de concepto libre (solo admin)
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualConcept, setManualConcept] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const utils = trpc.useUtils();
  const registersQ = trpc.tpv.getRegisterStatus.useQuery(undefined, { refetchInterval: 30000 });
  const registers = registersQ.data ?? [];
  const currentRegister = registers.find((r) => r.id === registerId) ?? null;

  useEffect(() => {
    if (!registersQ.data || registerId !== null) return;
    setRegisterId(pickInitialRegister(registersQ.data, readLastRegister()));
  }, [registersQ.data, registerId]);

  const chooseRegister = (id: number) => {
    if (id !== registerId) setSessionId(null);
    setRegisterId(id);
    saveLastRegister(id);
    setChoosingRegister(false);
  };

  const createRegisterMut = trpc.tpv.createRegister.useMutation({
    onSuccess: (r) => {
      toast.success(`Caja «${r?.name ?? ""}» creada`);
      setNewRegisterName("");
      utils.tpv.getRegisterStatus.invalidate();
      if (r) chooseRegister(r.id);
    },
    onError: (err) => toast.error(err.message),
  });

  // Check active session
  const { data: activeSession, refetch: refetchSessionQ } = trpc.tpv.getActiveSession.useQuery(
    { registerId: registerId ?? 0 },
    { refetchInterval: 30000, enabled: registerId !== null }
  );
  const refetchSession = () => {
    refetchSessionQ();
    utils.tpv.getRegisterStatus.invalidate();
  };

  useEffect(() => {
    if (activeSession) setSessionId(activeSession.id);
    else setSessionId(null);
  }, [activeSession]);

  // Catalog
  const { data: catalog } = trpc.tpv.getCatalog.useQuery(undefined, {
    enabled: !!sessionId,
  });
  const licensed = !!catalog?.licensed;
  // Una venta de mostrador es de hoy: la fecha del servicio solo se pide con reservas y citas (o en la instalación propia)
  const { can } = usePanelSubscription();
  const askServiceDate = !licensed || can("bookings-generic");
  const categories = catalog?.categories ?? [];
  const filters = buildTpvFilters(catalog);

  // Búsqueda de cliente existente (a partir de 3 caracteres)
  const clientQuery = clientSearch.trim();
  const clientResults = trpc.tpv.searchClients.useQuery(
    { q: clientQuery },
    { enabled: clientQuery.length >= 3 && !selectedClient, staleTime: 10_000 }
  );
  const pickClient = (c: { id: number; name: string; email: string; phone: string | null }) => {
    setSelectedClient({ id: c.id, name: c.name });
    setCustomerName(c.name);
    setCustomerEmail(c.email);
    setCustomerPhone(c.phone ?? "");
    setClientSearch("");
  };
  const clearCustomer = () => {
    setSelectedClient(null);
    setClientSearch("");
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
  };

  // Create sale mutation
  const createSaleMut = trpc.tpv.createSale.useMutation({
    onSuccess: (data) => {
      // Normalize: TpvTicket expects { sale: { ...saleFields, items, payments } }
      const normalized = {
        sale: {
          ...data.sale,
          items: data.items ?? [],
          payments: data.payments ?? [],
        },
      };
      setLastSale(normalized);
      setShowTicket(true);
      setCart([]);
      setCartOpen(false);
      clearCustomer();
      setDiscountAmount(0);
      setDiscountReason("");
      setPromoCode("");
      setPromoCodeInput("");
      setPromoCodeData(null);
      if (data.reavExpedientNumber) {
        toast.success(`Venta ${data.sale.ticketNumber} completada · Expediente REAV ${data.reavExpedientNumber} creado`, { duration: 6000 });
      } else {
        toast.success(`Venta ${data.sale.ticketNumber} completada`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Catalog products flat list ──────────────────────────────────────────────
  const allProducts: CatalogProduct[] = [
    ...(catalog?.experiences ?? []),
    ...(catalog?.packs ?? []),
    ...(catalog?.spa ?? []),
    ...(catalog?.hotel ?? []),
    ...(catalog?.legoPacks ?? []),
  ];

  const filteredProducts = allProducts.filter((p) => {
    const matchesFilter = matchesTpvFilter(p, filter);
    const matchesSearch =
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // ── Cart helpers ────────────────────────────────────────────────────────────
  const addToCart = useCallback((product: CatalogProduct) => {
    // Si es un Lego Pack, abrimos el selector de líneas
    if (product.productType === "legoPack") {
      setPendingLegoPackId(product.id);
      setShowLegoPackSelector(true);
      return;
    }
    // Si tiene variantes, abrimos ese modal primero
    if (product.variants && product.variants.length > 0) {
      setPendingProduct(product);
      setPendingVariantId(undefined);
      setPendingVariantName(undefined);
      setPendingVariantPrice(undefined);
      setShowVariantsModal(true);
      return;
    }
    // Si tiene time slots (sin variantes), abrimos el modal de horarios
    if (product.hasTimeSlots) {
      setPendingProduct(product);
      setTpvSelectedSlotId(null);
      setTpvSelectedTime("");
      setShowTimeSlotsModal(true);
      return;
    }
    _addToCartDirect(product);
  }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  const _addToCartDirect = useCallback((
    product: CatalogProduct,
    slotId?: number,
    slotLabel?: string,
    slotTime?: string,
    variantId?: number,
    variantName?: string,
    variantPrice?: number,
    legoPackLineIds?: number[],
    legoPackLinePeople?: Record<number, number>,
  ) => {
    const basePrice = parseFloat(String(product.basePrice ?? "0"));
    const price = variantPrice !== undefined ? variantPrice : basePrice;
    const discount = getActiveDiscountPercent(product);
    const existing = cart.find(
      (i) => i.product.id === product.id && i.product.productType === product.productType
        && i.selectedTimeSlotId === slotId && i.variantId === variantId
    );
    if (existing) {
      setCart((prev) =>
        prev.map((i) =>
          i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: `${product.productType}-${product.id}-${variantId ?? 0}-${Date.now()}`,
          product,
          quantity: 1,
          unitPrice: price,
          discountPercent: discount,
          participants: 1,
          selectedTimeSlotId: slotId,
          selectedTimeSlotLabel: slotLabel,
          selectedTime: slotTime,
          variantId,
          variantName,
          legoPackLineIds,
          legoPackLinePeople,
        },
      ]);
    }
  }, [cart]);

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const removeItem = (id: string) => setCart((prev) => prev.filter((i) => i.id !== id));

  const cartSubtotal = cart.reduce((acc, item) => {
    return acc + item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
  }, 0);
  // Promo code discount applied on subtotal
  const promoDiscount = promoCodeData ? Math.round(cartSubtotal * promoCodeData.discountPercent) / 100 : 0;
  const cartTotal = Math.max(0, cartSubtotal - discountAmount - promoDiscount);

  // ── Promo code validation ────────────────────────────────────────────────────
  const validatePromoMut = trpc.discounts.validate.useMutation({
    onSuccess: (data) => {
      setPromoCodeData({ id: data.id, discountPercent: data.discountPercent, code: data.code });
      setPromoCode(data.code);
      toast.success(`Código ${data.code} aplicado: -${data.discountPercent}%`);
      setPromoCodeLoading(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setPromoCodeLoading(false);
    },
  });

  const applyPromoCode = () => {
    if (!promoCodeInput.trim()) return;
    setPromoCodeLoading(true);
    validatePromoMut.mutate({ code: promoCodeInput.trim(), amount: cartSubtotal });
  };

  const removePromoCode = () => {
    setPromoCode("");
    setPromoCodeInput("");
    setPromoCodeData(null);
  };

  // ── Payment ─────────────────────────────────────────────────────────────────
  const handleQuickPay = (method: PaymentMethod) => {
    if (!sessionId) return toast.error("No hay sesión de caja abierta");
    if (cart.length === 0) return toast.error("El carrito está vacío");

    createSaleMut.mutate({
      sessionId,
      idempotencyKey: saleAttemptKey,
      clientId: selectedClient?.id,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      serviceDate,
      discountAmount: discountAmount + promoDiscount,
      discountReason: promoCodeData ? `Código ${promoCodeData.code} (-${promoCodeData.discountPercent}%)${discountReason ? ` + ${discountReason}` : ""}` : discountReason || undefined,
      discountCodeId: promoCodeData?.id ?? undefined,
      items: cart.map((item) => ({
        productType: item.product.productType,
        productId: item.product.id,
        productName: item.variantName
          ? `${item.product.title} — ${item.variantName}`
          : item.product.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        eventDate: item.eventDate,
        // eventTime debe ser SOLO la hora (HH:MM) — la columna BD es varchar(10).
        // El nombre del slot (selectedTimeSlotLabel, ej. "Salida Colectiva") va en
        // notes, NUNCA en eventTime, porque excede los 10 chars y rompe el INSERT.
        eventTime: item.eventTime ?? item.selectedTime ?? undefined,
        participants: item.participants,
        notes: [
          item.variantName ? `Variante: ${item.variantName}` : null,
          item.selectedTimeSlotLabel ? `Horario: ${item.selectedTimeSlotLabel}${item.selectedTime ? ` (${item.selectedTime})` : ""}` : null,
          item.product.productType === 'legoPack' && item.legoPackLineIds
            ? `Líneas: ${item.legoPackLineIds.map(id => {
                const name = pendingLegoPackLineNames[id] || `Línea${id}`;
                const people = item.legoPackLinePeople?.[id] ?? 1;
                return `${name}(${people}p)`;
              }).join(', ')}`
            : null,
          item.notes ?? null,
        ].filter(Boolean).join(" · ") || undefined,
        isManual: item.isManual ?? false,
        conceptText: item.isManual ? item.product.title : undefined,
        legoPackLineIds: item.product.productType === 'legoPack' ? item.legoPackLineIds : undefined,
        legoPackLinePeople: item.product.productType === 'legoPack' ? item.legoPackLinePeople : undefined,
      })),
      payments: [{ method, amount: cartTotal }],
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!sessionId || choosingRegister || registerId === null) {
    const isAdmin = user?.role === "admin";
    const noRegisters = registersQ.isSuccess && registers.length === 0;
    const mustChoose = choosingRegister || (registerId === null && registers.length > 0);
    return (
      <div className="dark fixed inset-0 bg-gray-950 flex flex-col items-center justify-center z-50 overflow-y-auto py-8">
        <div className="text-center space-y-6 w-full max-w-md px-4">
          <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mx-auto shadow-2xl">
            <Receipt className="w-10 h-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Punto de venta</h1>

          {registersQ.isLoading && <p className="text-gray-400">Cargando cajas…</p>}
          {registersQ.isError && (
            <p role="alert" className="text-danger">No se han podido cargar las cajas. Comprueba la conexión e inténtalo de nuevo.</p>
          )}

          {/* Sin ninguna caja: guiar a crearla */}
          {noRegisters && (
            <div className="space-y-4 text-left">
              <p className="text-gray-300 text-center">Todavía no tienes ninguna caja. Crea la primera para empezar a cobrar.</p>
              {isAdmin ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newRegisterName.trim()) createRegisterMut.mutate({ name: newRegisterName.trim() });
                  }}
                >
                  <Label htmlFor="tpv-new-register" className="text-gray-300">Nombre de la caja</Label>
                  <Input
                    id="tpv-new-register"
                    value={newRegisterName}
                    onChange={(e) => setNewRegisterName(e.target.value)}
                    placeholder="Por ejemplo, Mostrador"
                    maxLength={100}
                    className="h-12 bg-gray-800 border-gray-700 text-white"
                  />
                  <Button type="submit" disabled={!newRegisterName.trim() || createRegisterMut.isPending} className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground">
                    Crear caja
                  </Button>
                </form>
              ) : (
                <p className="text-gray-400 text-sm text-center">Pide a una persona administradora que cree una caja.</p>
              )}
            </div>
          )}

          {/* Elegir caja */}
          {mustChoose && (
            <div className="space-y-2 text-left">
              <p className="text-gray-300 text-center">Elige la caja en la que vas a cobrar</p>
              {registers.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => chooseRegister(r.id)}
                  className={`w-full min-h-14 flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    r.id === registerId ? "border-primary bg-primary/15" : "border-gray-700 bg-gray-900 hover:border-primary"
                  }`}
                >
                  <Store className="w-5 h-5 text-primary shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-white font-medium overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
                    {r.location && <span className="block text-xs text-gray-400 overflow-hidden text-ellipsis whitespace-nowrap">{r.location}</span>}
                  </span>
                  {r.openSession ? (
                    <Badge variant="outline" className="text-success border-success/40 text-xs shrink-0">Abierta · {r.openSession.cashierName}</Badge>
                  ) : (
                    <span className="text-xs text-gray-500 shrink-0">Cerrada</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Caja elegida y cerrada: abrirla */}
          {!mustChoose && currentRegister && !sessionId && (
            <div className="space-y-3">
              <p className="text-gray-400">Caja: <span className="text-white font-medium">{currentRegister.name}</span></p>
              <Button
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg h-14 rounded-xl"
                onClick={() => setShowOpenSession(true)}
              >
                Abrir caja
              </Button>
              {registers.length > 1 && (
                <Button variant="ghost" className="w-full h-11 text-primary hover:text-foreground" onClick={() => setChoosingRegister(true)}>
                  Cambiar de caja
                </Button>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            className="h-11 text-gray-500 hover:text-gray-300"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Volver al inicio
          </Button>
        </div>

        {registerId !== null && (
          <TpvOpenSession
            open={showOpenSession}
            registerId={registerId}
            onClose={() => setShowOpenSession(false)}
            onOpened={(id) => {
              setSessionId(id);
              setShowOpenSession(false);
              refetchSession();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="dark fixed inset-0 bg-gray-950 flex flex-col overflow-hidden z-50 text-white">
      {/* ── Header ── */}
      <header className="flex items-center justify-between gap-2 px-2 sm:px-4 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Receipt className="w-4 h-4 text-primary-foreground" />
          </div>
          <button
            type="button"
            onClick={() => setChoosingRegister(true)}
            className="min-h-11 min-w-0 flex items-center gap-2 rounded-lg px-2 hover:bg-gray-800"
            title="Cambiar de caja"
          >
            <span className="font-bold text-white text-sm overflow-hidden text-ellipsis whitespace-nowrap">{currentRegister?.name ?? "Caja"}</span>
            {activeSession && (
              <Badge variant="outline" className="hidden sm:inline-flex text-success border-success/40 text-xs">
                Caja abierta
              </Badge>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <span className="hidden lg:inline text-xs text-gray-400">{user?.name}</span>
          <Link href="/admin/tpv/backoffice">
            <Button
              size="sm"
              variant="ghost"
              className="text-primary hover:text-primary/80 h-11 px-2 text-xs gap-1"
              title={licensed ? "Ventas y cierres de caja" : "Historial de ventas y reservas del día"}
              aria-label={licensed ? "Ventas y cierres de caja" : "Backoffice"}
            >
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">{licensed ? "Ventas" : "Backoffice"}</span>
            </Button>
          </Link>
          {!licensed && (
            <Link href="/admin/contabilidad/control-diario">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary hover:text-primary/80 h-11 px-2 text-xs gap-1"
                title="Control de operaciones diario"
                aria-label="Control de operaciones diario"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden md:inline">Control</span>
              </Button>
            </Link>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-11 w-11 p-0"
            onClick={() => setShowCashMovement("in")}
            title="Entrada de efectivo"
            aria-label="Entrada de efectivo"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-11 w-11 p-0"
            onClick={() => setShowCashMovement("out")}
            title="Salida de efectivo"
            aria-label="Salida de efectivo"
          >
            <Minus className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-warning hover:text-warning h-11 px-2 text-xs"
            onClick={() => setShowCloseSession(true)}
          >
            Cerrar caja
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-11 w-11 p-0"
            onClick={() => navigate("/admin")}
            title="Volver al inicio"
            aria-label="Volver al inicio"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Catalog ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden md:border-r border-gray-800">
          {/* Filters */}
          <div className="flex items-center gap-2 px-2 sm:px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 overflow-x-auto">
            <Input
              placeholder="Buscar producto..."
              aria-label="Buscar producto"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 w-40 sm:w-48 shrink-0"
            />
            {filters.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "ghost"}
                aria-pressed={filter === f.key}
                className={`h-11 px-3 text-xs gap-1 shrink-0 ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => setFilter(f.key)}
              >
                {filterIcon(f.key, licensed)}
                {f.label}
              </Button>
            ))}
          </div>

          {/* Product grid */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3 p-2 sm:p-4 pb-24 md:pb-4">
              {/* Producto flexible — solo admin, siempre primero */}
              {user?.role === "admin" && (
                <button
                  onClick={() => { setManualConcept(""); setManualPrice(""); setShowManualModal(true); }}
                  className="group relative bg-gray-900 rounded-xl overflow-hidden border border-dashed border-primary hover:border-primary transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
                >
                  <div className="h-28 bg-primary/15 flex items-center justify-center">
                    <PenLine className="w-10 h-10 text-primary group-hover:text-primary/80 transition-colors" />
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium text-primary line-clamp-2 leading-tight mb-1">Producto flexible</p>
                    <p className="text-[10px] text-gray-500">Concepto + precio libre</p>
                  </div>
                </button>
              )}
              {filteredProducts.map((product) => {
                const price = parseFloat(String(product.basePrice ?? "0"));
                const discount = getActiveDiscountPercent(product);
                const finalPrice = discount > 0 ? price * (1 - discount / 100) : price;
                return (
                  <button
                    key={`${product.productType}-${product.id}`}
                    onClick={() => addToCart(product)}
                    className="group relative bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-primary transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
                  >
                    {/* Image */}
                    <div className={`h-28 bg-gradient-to-br ${TYPE_COLORS[product.productType]} relative overflow-hidden`}>
                      {product.coverImageUrl ? (
                        <img
                          src={product.coverImageUrl}
                          alt={product.title}
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ProductIcon licensed={licensed} className="w-8 h-8 text-white/40" />
                        </div>
                      )}
                      {discount > 0 && (
                        <div className="absolute top-1 right-1 bg-destructive text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                          -{discount.toFixed(0)}%
                        </div>
                      )}
                      {product.variants && product.variants.length > 0 && (
                        <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          {product.variants.length} opciones
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1">
                        <Badge className={`text-xs bg-black/50 text-white border-0`}>
                          {productBadge(product, licensed, categories)}
                        </Badge>
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-2">
                      <p className="text-xs font-medium text-white line-clamp-2 leading-tight mb-1">
                        {product.title}
                      </p>
                      <div className="flex items-center gap-1">
                        {discount > 0 && (
                          <span className="text-xs text-gray-500 line-through">{formatEur(price)}</span>
                        )}
                        <span className="text-sm font-bold text-primary">{formatEur(finalPrice)}</span>
                      </div>
                    </div>
                    {/* Add overlay */}
                    <div className="absolute inset-0 bg-transparent group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                      <Plus className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-16 text-gray-500">
                  <ProductIcon licensed={licensed} className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No hay productos disponibles</p>
                  {licensed && user?.role === "admin" && (
                    <p className="text-xs mt-2">
                      Activa «Vendible en TPV» en la ficha de tus productos, en{" "}
                      <Link href="/admin/productos/experiencias" className="underline underline-offset-4 text-primary">Productos y servicios</Link>.
                    </p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Cart + Payment ── */}
        {cartOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setCartOpen(false)} aria-hidden="true" />}
        <div
          role={cartOpen ? "dialog" : undefined}
          aria-label="Carrito"
          className={`${cartOpen ? "flex" : "hidden"} md:flex flex-col bg-gray-900 overflow-hidden fixed inset-x-0 bottom-0 top-12 z-50 rounded-t-2xl md:static md:z-auto md:rounded-none md:w-72 lg:w-80 xl:w-96 md:shrink-0`}
        >
          {/* Cart header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Carrito</span>
              {cart.length > 0 && (
                <Badge className="bg-primary text-primary-foreground text-xs">{cart.reduce((a, i) => a + i.quantity, 0)}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {cart.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger h-11 px-3 text-xs"
                  onClick={() => setCart([])}
                >
                  Vaciar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="md:hidden text-gray-400 hover:text-white h-11 w-11 p-0"
                onClick={() => setCartOpen(false)}
                aria-label="Cerrar carrito"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* ── Datos del cliente (siempre visible) ── */}
          <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/80">
            <div className="flex items-center gap-1.5 mb-2">
              <User className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-gray-300">Datos del cliente</span>
              <span className="text-[10px] text-gray-600 ml-1">(opcional)</span>
            </div>
            <div className="space-y-1.5">
              {/* Cliente existente: búsqueda por nombre, email o teléfono */}
              {selectedClient ? (
                <div className="flex items-center justify-between gap-2 bg-success/10 border border-success/40 rounded px-2 py-1 min-h-11">
                  <span className="flex items-center gap-1 text-xs text-success min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">Cliente existente: {selectedClient.name}</span>
                  </span>
                  <button type="button" onClick={clearCustomer} className="text-xs text-gray-400 hover:text-white h-11 px-2 shrink-0">Quitar</button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <Input
                    placeholder="Buscar cliente (nombre, email o teléfono)"
                    aria-label="Buscar cliente existente"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="h-11 md:h-8 pl-7 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                  />
                  {clientQuery.length >= 3 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                      {clientResults.isLoading ? (
                        <p className="text-xs text-gray-400 px-3 py-2">Buscando…</p>
                      ) : (clientResults.data ?? []).length === 0 ? (
                        <p className="text-xs text-gray-400 px-3 py-2">Sin coincidencias: escribe sus datos abajo y se dará de alta al cobrar.</p>
                      ) : (
                        (clientResults.data ?? []).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => pickClient(c)}
                            className="w-full text-left px-3 py-2 min-h-11 hover:bg-gray-700"
                          >
                            <span className="block text-xs text-white overflow-hidden text-ellipsis whitespace-nowrap">{c.name}</span>
                            <span className="block text-[11px] text-gray-400 overflow-hidden text-ellipsis whitespace-nowrap">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              <Input
                placeholder="Nombre"
                aria-label="Nombre del cliente"
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setSelectedClient(null); }}
                className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  placeholder="Email"
                  aria-label="Email del cliente"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => { setCustomerEmail(e.target.value); setSelectedClient(null); }}
                  className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                />
                <Input
                  placeholder="Teléfono"
                  aria-label="Teléfono del cliente"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                />
              </div>
            </div>
          </div>

          {/* Cart items + promo + discount (scrollable) */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="text-center py-12 text-gray-600">
                  <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Carrito vacío</p>
                  <p className="text-xs mt-1">Toca un producto para añadirlo</p>
                </div>
              ) : (
                cart.map((item) => {
                  const lineTotal = item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
                  return (
                    <div key={item.id} className="bg-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${TYPE_COLORS[item.product.productType]} shrink-0 flex items-center justify-center`}>
                          <ProductIcon licensed={licensed} className="w-3 h-3 text-white/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white line-clamp-1">{item.product.title}</p>
                          <p className="text-xs text-gray-400">{formatEur(item.unitPrice)}/ud</p>
                          {item.variantName && (
                            <p className="text-xs text-info flex items-center gap-0.5 mt-0.5">
                              <Tag className="w-2.5 h-2.5" />
                              {item.variantName}
                            </p>
                          )}
                          {item.selectedTimeSlotLabel && (
                            <p className="text-xs text-primary flex items-center gap-0.5 mt-0.5">
                              <AlarmClock className="w-2.5 h-2.5" />
                              {item.selectedTimeSlotLabel}
                              {item.selectedTime && ` · ${item.selectedTime}`}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-500 hover:text-danger transition-colors w-11 h-11 -m-2 flex items-center justify-center shrink-0"
                          aria-label={`Quitar ${item.product.title}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQty(item.id, -1)}
                            aria-label="Quitar una unidad"
                            className="w-11 h-11 md:w-8 md:h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item.id, 1)}
                            aria-label="Añadir una unidad"
                            className="w-11 h-11 md:w-8 md:h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <span className="text-sm font-bold text-primary">{formatEur(lineTotal)}</span>
                      </div>

                      {/* Desglose de líneas para Lego Pack */}
                      {item.product.productType === 'legoPack' && item.legoPackLineIds && item.legoPackLineIds.length > 0 && (
                        <div className="text-xs text-gray-400 border-t border-gray-700 pt-2 space-y-1">
                          <p className="font-semibold text-gray-300">Líneas personalizadas:</p>
                          {item.legoPackLineIds.map((lineId) => {
                            const peopleCount = item.legoPackLinePeople?.[lineId] ?? 1;
                            // Usar el nombre guardado o el ID como fallback
                            const lineName = pendingLegoPackLineNames[lineId] || `Línea ${lineId}`;
                            return (
                              <p key={lineId} className="text-gray-500 ml-2">
                                {lineName}: {peopleCount} {peopleCount === 1 ? 'persona' : 'personas'}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Código promocional (dentro del scroll) */}
            {cart.length > 0 && (
              <div className="px-0 pb-2 space-y-1 border-t border-gray-800 pt-2">
                {promoCodeData ? (
                  <div className="flex items-center justify-between bg-success/10 border border-success/40 rounded px-2 py-1">
                    <span className="text-xs text-success font-mono font-bold">{promoCodeData.code}</span>
                    <span className="text-xs text-success">-{promoCodeData.discountPercent}% (-{formatEur(promoDiscount)})</span>
                    <button onClick={removePromoCode} aria-label="Quitar código" className="text-gray-500 hover:text-danger ml-1 w-11 h-11 -my-2 flex items-center justify-center"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Input
                      placeholder="Código promo"
                      aria-label="Código promocional"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && applyPromoCode()}
                      className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white font-mono uppercase"
                    />
                    <Button
                      size="sm"
                      className="h-11 md:h-8 px-3 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={applyPromoCode}
                      disabled={promoCodeLoading || !promoCodeInput.trim()}
                    >
                      {promoCodeLoading ? "..." : "OK"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Descuento manual (dentro del scroll) */}
            {cart.length > 0 && (
              <div className="pb-2 space-y-1 border-t border-gray-800 pt-2">
                <button
                  className="w-full min-h-11 flex items-center justify-between text-xs text-gray-400 hover:text-white py-1"
                  onClick={() => setShowDiscountForm(!showDiscountForm)}
                >
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {discountAmount > 0 ? `-${formatEur(discountAmount)}` : "Descuento manual"}
                  </span>
                  {showDiscountForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showDiscountForm && (
                  <div className="space-y-1 pb-1">
                    <Input
                      type="number"
                      placeholder="Importe descuento (€)"
                      aria-label="Importe del descuento"
                      value={discountAmount || ""}
                      onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                      className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white"
                    />
                    <Input
                      placeholder="Motivo"
                      aria-label="Motivo del descuento"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="h-11 md:h-8 text-xs bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Fecha del servicio */}
          {askServiceDate && <div className="px-4 py-2 border-t border-gray-800">
            <label htmlFor="tpv-service-date" className="text-xs text-gray-400 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {licensed ? "Fecha del servicio" : "Fecha de actividad"}
            </label>
            <input
              id="tpv-service-date"
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="w-full h-11 md:h-8 text-xs bg-gray-800 border border-gray-700 text-white rounded px-2 focus:outline-none focus:border-primary"
            />
          </div>}

          {/* Totals — siempre visible */}
          <div className="px-4 py-3 border-t border-gray-800 space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Subtotal</span>
              <span>{formatEur(cartSubtotal)}</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-xs text-success">
                <span>Promo {promoCodeData?.code}</span>
                <span>-{formatEur(promoDiscount)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-success">
                <span>Descuento manual</span>
                <span>-{formatEur(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-white">
              <span>TOTAL</span>
              <span className="text-primary">{formatEur(cartTotal)}</span>
            </div>
          </div>

          {/* Payment buttons */}
          <div className="px-3 pb-3 space-y-2">
            {cart.length > 0 && (
              <>
                <Button
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
                  onClick={() => setShowSplitPayment(true)}
                  disabled={createSaleMut.isPending}
                >
                  <SplitSquareHorizontal className="w-4 h-4" />
                  Dividir cuenta
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-0.5 text-xs font-medium"
                    onClick={() => handleQuickPay("cash")}
                    disabled={createSaleMut.isPending}
                  >
                    <Banknote className="w-4 h-4" />
                    Efectivo
                  </Button>
                  <Button
                    className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-0.5 text-xs font-medium"
                    onClick={() => handleQuickPay("card")}
                    disabled={createSaleMut.isPending}
                  >
                    <CreditCard className="w-4 h-4" />
                    Tarjeta
                  </Button>
                  <Button
                    className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-0.5 text-xs font-medium"
                    onClick={() => handleQuickPay("bizum")}
                    disabled={createSaleMut.isPending}
                  >
                    <Smartphone className="w-4 h-4" />
                    Bizum
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Barra inferior (móvil y tablet estrecha): abre el carrito con el total a la vista */}
      {!cartOpen && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-30 p-2 bg-gray-950/95 border-t border-gray-800">
          <Button
            className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base justify-between px-4"
            onClick={() => setCartOpen(true)}
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Carrito{cart.length > 0 ? ` (${cart.reduce((a, i) => a + i.quantity, 0)})` : ""}
            </span>
            <span>{formatEur(cartTotal)}</span>
          </Button>
        </div>
      )}

      {/* ── Modals ── */}
      <TpvOpenSession
        open={showOpenSession}
        registerId={registerId ?? 0}
        onClose={() => setShowOpenSession(false)}
        onOpened={(id) => {
          setSessionId(id);
          setShowOpenSession(false);
          refetchSession();
        }}
      />

      {sessionId && (
        <>
          <TpvCloseSession
            open={showCloseSession}
            sessionId={sessionId}
            onClose={() => setShowCloseSession(false)}
            onClosed={() => {
              setSessionId(null);
              setShowCloseSession(false);
              refetchSession();
            }}
          />
          <TpvCashMovement
            open={!!showCashMovement}
            type={showCashMovement ?? "out"}
            sessionId={sessionId}
            onClose={() => setShowCashMovement(null)}
          />
          {showSplitPayment && (
            <TpvSplitPayment
              open={showSplitPayment}
              total={cartTotal}
              sessionId={sessionId}
              cart={cart}
              customerName={customerName}
              customerEmail={customerEmail}
              customerPhone={customerPhone}
              discountAmount={discountAmount}
              discountReason={discountReason}
              idempotencyKey={saleAttemptKey}
              clientId={selectedClient?.id}
              onClose={() => setShowSplitPayment(false)}
              onCompleted={(sale) => {
                setLastSale(sale);
                setShowSplitPayment(false);
                setShowTicket(true);
                setCart([]);
                setCartOpen(false);
                clearCustomer();
              }}
            />
          )}
        </>
      )}

      {showTicket && lastSale && (
        <TpvTicket
          open={showTicket}
          sale={lastSale}
          onClose={() => setShowTicket(false)}
        />
      )}

      {/* Modal de concepto libre (solo admin) */}
      <Dialog open={showManualModal} onOpenChange={setShowManualModal}>
        <DialogContent className="dark bg-gray-900 border border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <PenLine className="w-4 h-4 text-primary" />
              Producto flexible
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-300">Concepto *</Label>
              <Input
                autoFocus
                placeholder="Ej: Entrada especial, Servicio extra…"
                value={manualConcept}
                onChange={(e) => setManualConcept(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("manual-price-input")?.focus()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-300">Precio (€) *</Label>
              <Input
                id="manual-price-input"
                type="number"
                min={0.01}
                max={10000}
                step={0.01}
                placeholder="0.00"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const price = parseFloat(manualPrice);
                    if (manualConcept.trim() && price >= 0.01 && price <= 10000) {
                      setCart(prev => [...prev, {
                        id: `manual-${Date.now()}`,
                        product: { id: 0, title: manualConcept.trim(), basePrice: String(price), coverImageUrl: null, discountPercent: null, discountExpiresAt: null, productType: "extra" as const },
                        quantity: 1, unitPrice: price, discountPercent: 0, participants: 1, isManual: true,
                      }]);
                      setShowManualModal(false);
                    }
                  }
                }}
              />
              <p className="text-[10px] text-gray-500">Mín 0.01 € · Máx 10.000 €</p>
            </div>
            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={!manualConcept.trim() || parseFloat(manualPrice) < 0.01 || parseFloat(manualPrice) > 10000 || isNaN(parseFloat(manualPrice))}
              onClick={() => {
                const price = parseFloat(manualPrice);
                if (!manualConcept.trim() || isNaN(price) || price < 0.01 || price > 10000) return;
                setCart(prev => [...prev, {
                  id: `manual-${Date.now()}`,
                  product: { id: 0, title: manualConcept.trim(), basePrice: String(price), coverImageUrl: null, discountPercent: null, discountExpiresAt: null, productType: "extra" as const },
                  quantity: 1, unitPrice: price, discountPercent: 0, participants: 1, isManual: true,
                }]);
                setShowManualModal(false);
              }}
            >
              Añadir al carrito
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de selección de variante */}
      {showVariantsModal && pendingProduct && (
        <TpvVariantsModal
          product={pendingProduct}
          onConfirm={(variantId, variantName, variantPrice) => {
            setShowVariantsModal(false);
            if (pendingProduct.hasTimeSlots) {
              // Guardar variante y abrir time slots
              setPendingVariantId(variantId);
              setPendingVariantName(variantName);
              setPendingVariantPrice(variantPrice);
              setTpvSelectedSlotId(null);
              setTpvSelectedTime("");
              setShowTimeSlotsModal(true);
            } else {
              _addToCartDirect(pendingProduct, undefined, undefined, undefined, variantId, variantName, variantPrice);
              setPendingProduct(null);
            }
          }}
          onCancel={() => {
            setShowVariantsModal(false);
            setPendingProduct(null);
          }}
        />
      )}

      {/* Modal de selección de horario (time slots) para el TPV */}
      {showTimeSlotsModal && pendingProduct && (
        <TpvTimeSlotsModal
          product={pendingProduct}
          onConfirm={(slotId, slotLabel, slotTime) => {
            _addToCartDirect(pendingProduct, slotId, slotLabel, slotTime, pendingVariantId, pendingVariantName, pendingVariantPrice);
            setShowTimeSlotsModal(false);
            setPendingProduct(null);
            setPendingVariantId(undefined);
            setPendingVariantName(undefined);
            setPendingVariantPrice(undefined);
          }}
          onCancel={() => {
            setShowTimeSlotsModal(false);
            setPendingProduct(null);
            setPendingVariantId(undefined);
            setPendingVariantName(undefined);
            setPendingVariantPrice(undefined);
          }}
        />
      )}

      {/* Modal de selector de líneas para Lego Packs */}
      {showLegoPackSelector && pendingLegoPackId && (
        <Dialog open={showLegoPackSelector} onOpenChange={setShowLegoPackSelector}>
          <DialogContent className="max-w-2xl max-h-96 overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Personalizar Lego Pack</DialogTitle>
            </DialogHeader>
            <LegoPackLineSelector
              packId={pendingLegoPackId}
              onConfirm={(activeLineIds, customPrice, linePeople, lineNames) => {
                // Obtener el producto pendiente para añadir al carrito
                const legoPackProduct = allProducts.find(p => p.id === pendingLegoPackId);
                if (legoPackProduct) {
                  _addToCartDirect(legoPackProduct, undefined, undefined, undefined, undefined, undefined, customPrice, activeLineIds, linePeople);
                  setPendingLegoPackLineIds(activeLineIds);
                  setPendingLegoPackLinePeople(linePeople);
                  setPendingLegoPackLineNames(lineNames);
                }
                setShowLegoPackSelector(false);
                setPendingLegoPackId(null);
              }}
              onCancel={() => {
                setShowLegoPackSelector(false);
                setPendingLegoPackId(null);
              }}
              gradientClass="from-primary/70 to-primary"
              textColorClass="text-success"
              isModal={true}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Sub-componente: Modal de selección de variante ──────────────────────────

function computeVariantPrice(basePrice: number, variant: ProductVariant): number {
  const mod = parseFloat(String(variant.priceModifier ?? "0"));
  if (variant.priceType === "percentage") return basePrice + basePrice * mod / 100;
  return mod; // fixed y per_person: priceModifier ES el precio total (no un offset)
}

function TpvVariantsModal({
  product,
  onConfirm,
  onCancel,
}: {
  product: CatalogProduct;
  onConfirm: (variantId: number, variantName: string, variantPrice: number) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const basePrice = parseFloat(String(product.basePrice ?? "0"));
  const variants = product.variants ?? [];

  const handleConfirm = () => {
    const variant = variants.find(v => v.id === selected);
    if (!variant) { toast.error("Selecciona una opción"); return; }
    onConfirm(variant.id, variant.name, computeVariantPrice(basePrice, variant));
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="dark max-w-sm bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Layers className="w-5 h-5 text-primary" />
            Seleccionar opción
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{product.title}</p>
          <div className="grid grid-cols-1 gap-2">
            {variants.map(variant => {
              const price = computeVariantPrice(basePrice, variant);
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => setSelected(variant.id)}
                  className={`px-4 py-3 rounded-xl border text-sm transition-all text-left flex items-center justify-between ${
                    selected === variant.id
                      ? "border-primary bg-primary/15 text-foreground font-semibold"
                      : "border-gray-700 text-gray-300 hover:border-primary/50 hover:bg-gray-800"
                  }`}
                >
                  <span className="font-medium">{variant.name}</span>
                  <span className={`text-base font-bold ${selected === variant.id ? "text-primary" : "text-primary"}`}>
                    {formatEur(price)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleConfirm}
              disabled={selected === null}
            >
              Añadir al carrito
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-componente: Modal de selección de horario ───────────────────────────

function TpvTimeSlotsModal({
  product,
  onConfirm,
  onCancel,
}: {
  product: CatalogProduct;
  onConfirm: (slotId: number, slotLabel: string, slotTime?: string) => void;
  onCancel: () => void;
}) {
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState("");

  const { data: timeSlots = [] } = trpc.timeSlots.getByProduct.useQuery(
    { productId: product.id },
    { enabled: true }
  );

  const slotType = timeSlots[0]?.type ?? "fixed";

  const handleConfirm = () => {
    if (!selectedSlotId) {
      toast.error("Selecciona un horario");
      return;
    }
    if (slotType === "flexible" && !selectedTime) {
      toast.error("Indica la hora preferida");
      return;
    }
    const slot = timeSlots.find(s => s.id === selectedSlotId);
    // Para slots "fixed", la hora real está en slot.startTime (ej. "12:00").
    // Para slots "flexible", la hora la introduce el usuario (selectedTime).
    // selectedTime se usa luego como `eventTime` (varchar(10) — HH:MM, no el label).
    const slotTime = slotType === "flexible" ? selectedTime : (slot?.startTime ?? undefined);
    onConfirm(selectedSlotId, slot?.label ?? "", slotTime);
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="dark max-w-sm bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <AlarmClock className="w-5 h-5 text-primary" />
            Seleccionar horario
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{product.title}</p>
          {timeSlots.length === 0 ? (
            <p className="text-sm text-gray-500">No hay horarios configurados.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {timeSlots.map(slot => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`px-3 py-2.5 rounded-xl border text-sm transition-all text-left ${
                    selectedSlotId === slot.id
                      ? "border-primary bg-primary/15 text-foreground font-semibold"
                      : "border-gray-700 text-gray-300 hover:border-primary/50 hover:bg-gray-800"
                  }`}
                >
                  <span className="block text-xs font-medium">{slot.label}</span>
                  {slot.startTime && (
                    <span className="text-xs opacity-60">
                      {slot.startTime}{slot.endTime ? `–${slot.endTime}` : ""}
                    </span>
                  )}
                  {slot.priceOverride && (
                    <span className="block text-xs text-primary font-bold mt-0.5">
                      {parseFloat(slot.priceOverride).toFixed(0)}€
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {slotType === "flexible" && selectedSlotId && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Hora preferida</label>
              <input
                type="time"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full h-8 text-sm bg-gray-800 border border-gray-700 text-white rounded px-2 focus:outline-none focus:border-primary"
              />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={onCancel}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleConfirm}
              disabled={!selectedSlotId}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
