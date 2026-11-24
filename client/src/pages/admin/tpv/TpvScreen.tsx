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
import { cashSaleDocument, exceedsSimplifiedInvoiceLimit, SIMPLIFIED_INVOICE_LIMIT_EUR, type TicketInvoiceRecipient } from "@shared/ticketInvoice";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TpvSessionReturns } from "./TpvBusiness";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LegoPackLineSelector } from "@/components/LegoPackLineSelector";
import { toast } from "sonner";
import {
  ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone,
  Layers, X, User, Calendar, Clock, Users, Tag, ChevronDown, ChevronUp,
  Zap, Waves, Baby, Sparkles, Star, Sun, Filter, LogOut, Settings,
  ArrowLeft, SplitSquareHorizontal, AlarmClock, PenLine, BarChart3,
  Package, Search, CheckCircle2, Store, MoreVertical, Wifi, WifiOff,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link, useLocation } from "wouter";
import TpvOpenSession from "./TpvOpenSession";
import TpvCloseSession from "./TpvCloseSession";
import TpvCashMovement from "./TpvCashMovement";
import TpvSplitPayment from "./TpvSplitPayment";
import TpvCashPayment from "./TpvCashPayment";
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

const EMPTY_RECIPIENT: TicketInvoiceRecipient = { name: "", nif: "", address: "", postalCode: "", city: "" };

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
  const [selectedClient, setSelectedClient] = useState<{ id: number; name: string; invoiceRecipient: TicketInvoiceRecipient } | null>(null);
  // Factura completa pedida en caja: datos del destinatario (sin ellos, la venta lleva solo ticket)
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [recipient, setRecipient] = useState<TicketInvoiceRecipient>(EMPTY_RECIPIENT);
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
  // Efectivo: antes de cobrar se indica lo entregado y se ve el cambio
  const [showCashPayment, setShowCashPayment] = useState(false);
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
  const catalogQ = trpc.tpv.getCatalog.useQuery(undefined, {
    enabled: !!sessionId,
  });
  const catalog = catalogQ.data;
  const licensed = !!catalog?.licensed;
  // Una venta de mostrador es de hoy: la fecha del servicio solo se pide con reservas y citas (o en la instalación propia)
  const { can } = usePanelSubscription();
  const askServiceDate = !licensed || can("bookings-generic");
  const categories = catalog?.categories ?? [];
  const filters = buildTpvFilters(catalog);

  // Estado de la conexión (solo informa: los cobros los sigue registrando el servidor)
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  // Resumen discreto del turno (cabecera): ventas, cobrado y efectivo de la sesión abierta
  const shiftQ = trpc.tpv.getSessionSummary.useQuery({ sessionId: sessionId ?? 0 }, { enabled: !!sessionId, retry: false, refetchInterval: 60_000 });
  useEffect(() => {
    if (lastSale && sessionId) shiftQ.refetch();
  }, [lastSale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Búsqueda de cliente existente (a partir de 3 caracteres)
  const clientQuery = clientSearch.trim();
  const clientResults = trpc.tpv.searchClients.useQuery(
    { q: clientQuery },
    { enabled: clientQuery.length >= 3 && !selectedClient, staleTime: 10_000 }
  );
  const pickClient = (c: { id: number; name: string; email: string; phone: string | null; invoiceRecipient: TicketInvoiceRecipient }) => {
    setSelectedClient({ id: c.id, name: c.name, invoiceRecipient: c.invoiceRecipient });
    setRecipient(c.invoiceRecipient);
    setCustomerName(c.name);
    setCustomerEmail(c.email);
    setCustomerPhone(c.phone ?? "");
    setClientSearch("");
  };
  const clearCustomer = () => {
    setSelectedClient(null);
    setWantsInvoice(false);
    setRecipient(EMPTY_RECIPIENT);
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
        // Factura completa emitida con la venta (cliente identificado), para mencionarla junto al ticket
        invoice: data.invoice ?? null,
      };
      setLastSale(normalized);
      setShowCashPayment(false);
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
      // Inventario (Business): artículos vendidos con la política «permitir» sin existencias suficientes
      if (data.stockWarnings?.length) {
        toast.warning(`Vendido sin existencias suficientes: ${data.stockWarnings.join(", ")}. Revisa el inventario.`, { duration: 8000 });
      }
      // Tokens internos (Social Token Net): puntos ganados por el cliente con esta venta
      if (data.loyalty?.applied && data.loyalty.points > 0) {
        toast.success(`El cliente gana ${data.loyalty.points.toLocaleString("es-ES")} ${data.loyalty.pointsName} (saldo: ${data.loyalty.balance.toLocaleString("es-ES")})`);
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

  // Reglas de precios de la empresa (Business): el servidor calcula el precio por unidad que cobrará createSale. La
  // caja envía siempre el precio de catálogo; sin reglas no cambia nada.
  const rulePreview = trpc.tpv.pricingPreview.useQuery(
    {
      serviceDate,
      items: cart.map((i) => ({ productType: i.product.productType, productId: i.product.id, unitPrice: i.unitPrice, quantity: i.quantity, participants: i.participants, eventDate: i.eventDate, isManual: i.isManual ?? false })),
    },
    { enabled: cart.length > 0, retry: false },
  );
  const ruleOf = (index: number) => (rulePreview.data && rulePreview.data.length === cart.length ? rulePreview.data[index] ?? null : null);
  const pricingPending = cart.length > 0 && rulePreview.isFetching;
  const unitOf = (item: CartItem, index: number) => ruleOf(index)?.unitPrice ?? item.unitPrice;
  const cartSubtotal = cart.reduce((acc, item, index) => {
    return acc + unitOf(item, index) * item.quantity * (1 - item.discountPercent / 100);
  }, 0);
  // Promo code discount applied on subtotal
  const promoDiscount = promoCodeData ? Math.round(cartSubtotal * promoCodeData.discountPercent) / 100 : 0;
  const cartTotal = Math.max(0, cartSubtotal - discountAmount - promoDiscount);

  // Documento de la venta: ticket (factura simplificada) o factura completa con destinatario identificado
  const clientForInvoice = selectedClient ? { ...selectedClient.invoiceRecipient, company: "" } : null;
  const clientInvoiceReady = !!clientForInvoice && cashSaleDocument({ total: 0, client: clientForInvoice }).kind === "factura";
  const overLimit = exceedsSimplifiedInvoiceLimit(cartTotal);
  const showRecipientForm = !clientInvoiceReady && (wantsInvoice || overLimit);
  const saleInvoiceRecipient = showRecipientForm ? recipient : undefined;
  const saleDocument = cashSaleDocument({ total: cartTotal, requested: saleInvoiceRecipient ?? null, client: clientForInvoice });
  // Datos del cliente: plegados salvo que la persona los abra
  const customerOpen = showCustomerForm;
  /** Antes de cobrar: por encima del límite del ticket, o con la factura pedida, hacen falta los datos del destinatario. */
  const checkSaleDocument = () => {
    if (saleDocument.kind !== "rechazo") return true;
    setCartOpen(true);
    toast.error(saleDocument.message);
    return false;
  };

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
  const handleQuickPay = (method: PaymentMethod, amountTendered?: number) => {
    if (!sessionId) return toast.error("No hay sesión de caja abierta");
    if (cart.length === 0) return toast.error("El carrito está vacío");
    if (pricingPending) return toast.error("Calculando los precios del carrito. Inténtalo de nuevo en un momento.");
    if (!checkSaleDocument()) return;

    createSaleMut.mutate({
      sessionId,
      idempotencyKey: saleAttemptKey,
      clientId: selectedClient?.id,
      invoiceRecipient: saleInvoiceRecipient,
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
        variantId: item.variantId || undefined,
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
      payments: [{ method, amount: cartTotal, ...(method === "cash" && amountTendered !== undefined ? { amountTendered } : {}) }],
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
            <Store className="w-10 h-10 text-primary-foreground" />
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
              <p className="text-muted-foreground">Caja: <span className="text-foreground font-medium">{currentRegister.name}</span></p>
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
      {/* ── Header: caja, sede, turno y conexión; acciones de la caja ── */}
      <header className="flex items-center justify-between gap-2 px-2 sm:px-4 h-14 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-primary-foreground" />
          </div>
          <button
            type="button"
            onClick={() => setChoosingRegister(true)}
            className="min-h-11 min-w-0 flex items-center gap-2 rounded-lg px-2 text-left hover:bg-gray-800"
            title="Cambiar de caja"
          >
            <span className="min-w-0">
              <span className="block font-bold text-white text-sm leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{currentRegister?.name ?? "Caja"}</span>
              <span className="hidden sm:block text-xs text-muted-foreground leading-tight overflow-hidden text-ellipsis whitespace-nowrap">
                {[currentRegister?.location, activeSession ? `Turno de ${activeSession.cashierName} desde las ${new Date(activeSession.openedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
          <span
            role="status"
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shrink-0 ${online ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}
          >
            {online ? <Wifi className="w-3.5 h-3.5" aria-hidden="true" /> : <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />}
            {online ? "En línea" : "Sin conexión"}
          </span>
          <span
            className={`sm:hidden inline-block w-2.5 h-2.5 rounded-full shrink-0 ${online ? "bg-success" : "bg-danger"}`}
            title={online ? "En línea" : "Sin conexión"}
            aria-label={online ? "En línea" : "Sin conexión"}
          />
        </div>

        {/* Resumen discreto del turno (solo con espacio) */}
        {shiftQ.data && (
          <div className="hidden xl:flex items-center gap-4 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-1 text-xs shrink-0" aria-label="Resumen del turno">
            <span className="text-muted-foreground">Turno <span className="ml-1 font-semibold tabular-nums text-white">{shiftQ.data.sales?.length ?? 0} ventas</span></span>
            <span className="text-muted-foreground">Cobrado <span className="ml-1 font-semibold tabular-nums text-primary">{formatEur(shiftQ.data.totalSales ?? 0)}</span></span>
            <span className="text-muted-foreground">Efectivo <span className="ml-1 font-semibold tabular-nums text-white">{formatEur(shiftQ.data.totalCash ?? 0)}</span></span>
          </div>
        )}

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <span className="hidden 2xl:inline text-xs text-muted-foreground">{user?.name}</span>
          {/* Escritorio y tableta: todas las acciones a la vista */}
          <div className="hidden md:flex items-center gap-1">
            <Link href="/admin/tpv/backoffice">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary hover:text-primary/80 h-11 px-2 text-xs gap-1"
                title={licensed ? "Ventas y cierres de caja" : "Historial de ventas y reservas del día"}
                aria-label={licensed ? "Ventas y cierres de caja" : "Backoffice"}
              >
                <Settings className="w-4 h-4" />
                <span className="hidden lg:inline">{licensed ? "Ventas" : "Backoffice"}</span>
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
                  <span className="hidden lg:inline">Control</span>
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-white h-11 px-2 gap-1 text-xs"
              onClick={() => setShowCashMovement("in")}
              title="Entrada de efectivo"
              aria-label="Entrada de efectivo"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden lg:inline">Entrada</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-white h-11 px-2 gap-1 text-xs"
              onClick={() => setShowCashMovement("out")}
              title="Salida de efectivo"
              aria-label="Salida de efectivo"
            >
              <Minus className="w-4 h-4" />
              <span className="hidden lg:inline">Salida</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-warning/50 bg-transparent text-warning hover:bg-warning/10 hover:text-warning h-11 px-3 text-xs"
              onClick={() => setShowCloseSession(true)}
            >
              Cerrar caja
            </Button>
          </div>
          {sessionId && <TpvSessionReturns sessionId={sessionId} />}
          {/* Móvil: las acciones de la caja, en un menú */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="md:hidden text-muted-foreground hover:text-white h-11 w-11 p-0" aria-label="Más acciones de la caja">
                <MoreVertical className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dark min-w-56 bg-gray-900 border-gray-700 text-white">
              <DropdownMenuItem className="min-h-11" onSelect={() => navigate("/admin/tpv/backoffice")}>
                <Settings className="w-4 h-4 mr-2" /> {licensed ? "Ventas y cierres de caja" : "Backoffice"}
              </DropdownMenuItem>
              {!licensed && (
                <DropdownMenuItem className="min-h-11" onSelect={() => navigate("/admin/contabilidad/control-diario")}>
                  <BarChart3 className="w-4 h-4 mr-2" /> Control diario
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="min-h-11" onSelect={() => setShowCashMovement("in")}>
                <Plus className="w-4 h-4 mr-2" /> Entrada de efectivo
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => setShowCashMovement("out")}>
                <Minus className="w-4 h-4 mr-2" /> Salida de efectivo
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 text-warning focus:text-warning" onSelect={() => setShowCloseSession(true)}>
                <LogOut className="w-4 h-4 mr-2" /> Cerrar caja
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-white h-11 w-11 p-0"
            onClick={() => navigate("/admin")}
            title="Volver al inicio"
            aria-label="Volver al inicio"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {!online && (
        <div role="alert" className="flex items-center gap-2 px-4 py-2 bg-danger/15 border-b border-danger/40 text-sm text-danger shrink-0">
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          Sin conexión. Los cobros no se podrán registrar hasta que vuelva internet; el ticket actual se conserva.
        </div>
      )}

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Catalog ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden md:border-r border-gray-800">
          {/* Búsqueda y categorías */}
          <div className="px-2 sm:px-4 pt-3 pb-2 bg-gray-900 border-b border-gray-800 shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <Input
                placeholder="Buscar producto..."
                aria-label="Buscar producto"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 pl-10 pr-11 text-base bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center text-muted-foreground hover:text-white"
                  aria-label="Borrar la búsqueda"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {filters.map((f) => {
                const count = allProducts.filter((p) => matchesTpvFilter(p, f.key)).length;
                return (
                  <Button
                    key={f.key}
                    size="sm"
                    variant={filter === f.key ? "default" : "ghost"}
                    aria-pressed={filter === f.key}
                    className={`h-11 px-4 text-sm gap-1.5 shrink-0 rounded-full border ${filter === f.key ? "border-primary" : "border-gray-700"} ${
                      filter === f.key
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "text-muted-foreground hover:text-white"
                    }`}
                    onClick={() => setFilter(f.key)}
                  >
                    {filterIcon(f.key, licensed)}
                    {f.label}
                    <span className={`text-xs tabular-nums ${filter === f.key ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{count}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Product grid */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3 p-2 sm:p-4 pb-24 md:pb-4">
              {catalogQ.isLoading && Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-36 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" aria-hidden="true" />
              ))}
              {catalogQ.isError && (
                <div role="alert" className="col-span-full rounded-xl border border-danger/40 bg-danger/10 p-6 text-center space-y-3">
                  <p className="text-danger font-medium">No se ha podido cargar el catálogo.</p>
                  <Button variant="outline" className="h-11 border-danger/40 text-danger" onClick={() => catalogQ.refetch()}>Reintentar</Button>
                </div>
              )}
              {/* Producto flexible — solo admin, siempre primero */}
              {user?.role === "admin" && !catalogQ.isLoading && (
                <button
                  onClick={() => { setManualConcept(""); setManualPrice(""); setShowManualModal(true); }}
                  className="group relative min-h-36 bg-gray-900/40 rounded-xl border-2 border-dashed border-primary/60 hover:border-primary hover:bg-primary/10 transition-all active:scale-[0.98] text-left p-3 flex flex-col justify-between"
                >
                  <PenLine className="w-8 h-8 text-primary" />
                  <span>
                    <span className="block text-sm font-semibold text-primary leading-tight">Producto flexible</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">Concepto + precio libre</span>
                  </span>
                </button>
              )}
              {filteredProducts.map((product) => {
                const price = parseFloat(String(product.basePrice ?? "0"));
                const discount = getActiveDiscountPercent(product);
                const finalPrice = discount > 0 ? price * (1 - discount / 100) : price;
                const inCart = cart.filter((i) => i.product.id === product.id && i.product.productType === product.productType).reduce((a, i) => a + i.quantity, 0);
                return (
                  <button
                    key={`${product.productType}-${product.id}`}
                    onClick={() => addToCart(product)}
                    aria-label={`Añadir ${product.title}, ${formatEur(finalPrice)}${inCart > 0 ? `, ${inCart} en el ticket` : ""}`}
                    className={`group relative min-h-36 bg-gray-900 rounded-xl overflow-hidden border transition-all hover:border-primary active:scale-[0.98] text-left flex flex-col ${inCart > 0 ? "border-primary ring-1 ring-primary/50" : "border-gray-800"}`}
                  >
                    {/* Imagen: solo si el producto la tiene (sin ella no se reserva el espacio) */}
                    {product.coverImageUrl && (
                      <div className="h-24 shrink-0 bg-gray-800 relative overflow-hidden">
                        <img src={product.coverImageUrl} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge className="text-xs bg-gray-800 text-muted-foreground border-0 font-normal max-w-full">
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{productBadge(product, licensed, categories)}</span>
                        </Badge>
                        {product.variants && product.variants.length > 0 && (
                          <Badge className="text-xs bg-primary/15 text-primary border-0 font-medium">
                            {product.variants.length} {product.variants.length === 1 ? "opción" : "opciones"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-white line-clamp-2 leading-snug">{product.title}</p>
                      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                        <div className="flex flex-col leading-tight">
                          {discount > 0 && <span className="text-xs text-muted-foreground line-through tabular-nums">{formatEur(price)}</span>}
                          <span className="text-lg font-bold text-primary tabular-nums">{formatEur(finalPrice)}</span>
                        </div>
                        <span className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${inCart > 0 ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary group-hover:bg-primary group-hover:text-primary-foreground"}`} aria-hidden="true">
                          {inCart > 0 ? <span className="text-sm font-bold tabular-nums">×{inCart}</span> : <Plus className="w-5 h-5" />}
                        </span>
                      </div>
                    </div>
                    {discount > 0 && (
                      <span className="absolute top-2 right-2 bg-destructive text-white text-xs font-bold px-1.5 py-0.5 rounded-full">-{discount.toFixed(0)}%</span>
                    )}
                  </button>
                );
              })}
              {!catalogQ.isLoading && !catalogQ.isError && filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-16 text-gray-500">
                  <ProductIcon licensed={licensed} className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  {searchQuery ? (
                    <>
                      <p>Ningún producto coincide con «{searchQuery}»</p>
                      <Button variant="outline" className="mt-3 h-11 border-gray-700 text-muted-foreground hover:text-white" onClick={() => { setSearchQuery(""); setFilter("all"); }}>
                        Quitar la búsqueda y los filtros
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>No hay productos disponibles</p>
                      {licensed && user?.role === "admin" && (
                        <p className="text-xs mt-2">
                          Activa «Vendible en caja» en la ficha de tus productos, en{" "}
                          <Link href="/admin/productos/experiencias" className="underline underline-offset-4 text-primary">Productos y servicios</Link>.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Ticket actual + cobro ── */}
        {cartOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setCartOpen(false)} aria-hidden="true" />}
        <div
          role={cartOpen ? "dialog" : undefined}
          aria-label="Carrito"
          className={`${cartOpen ? "flex" : "hidden"} md:flex flex-col bg-gray-900 overflow-hidden fixed inset-x-0 bottom-0 top-14 z-50 rounded-t-2xl md:static md:z-auto md:rounded-none md:w-80 lg:w-[22rem] xl:w-[26rem] md:shrink-0`}
        >
          {/* Cabecera del ticket */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              <span className="font-semibold">Carrito</span>
              {cart.length > 0 && (
                <Badge className="bg-primary text-primary-foreground text-xs tabular-nums">{cart.reduce((a, i) => a + i.quantity, 0)}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {cart.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger h-11 px-3 text-sm"
                  onClick={() => setCart([])}
                >
                  Vaciar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="md:hidden text-muted-foreground hover:text-white h-11 w-11 p-0"
                onClick={() => setCartOpen(false)}
                aria-label="Cerrar carrito"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* ── Líneas del ticket, descuentos y datos del cliente (con scroll) ── */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Carrito vacío</p>
                  <p className="text-sm mt-1">Toca un producto para añadirlo</p>
                </div>
              ) : (
                cart.map((item, index) => {
                  const rule = ruleOf(index);
                  const lineTotal = unitOf(item, index) * item.quantity * (1 - item.discountPercent / 100);
                  return (
                    <div key={item.id} className="bg-gray-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white line-clamp-2 leading-snug">{item.product.title}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {rule && <span className="line-through mr-1">{formatEur(rule.baseUnitPrice)}</span>}
                            {formatEur(unitOf(item, index))}/ud
                            {item.discountPercent > 0 && <span className="ml-1.5 rounded-full bg-destructive/20 px-1.5 py-0.5 font-semibold text-danger">-{item.discountPercent.toFixed(0)}%</span>}
                          </p>
                          {rule && <p className="text-xs text-success mt-0.5">{rule.rules.join(" + ")}</p>}
                          {item.variantName && (
                            <p className="text-xs text-info flex items-center gap-1 mt-0.5">
                              <Tag className="w-3 h-3" />
                              {item.variantName}
                            </p>
                          )}
                          {item.selectedTimeSlotLabel && (
                            <p className="text-xs text-primary flex items-center gap-1 mt-0.5">
                              <AlarmClock className="w-3 h-3" />
                              {item.selectedTimeSlotLabel}
                              {item.selectedTime && ` · ${item.selectedTime}`}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-muted-foreground hover:text-danger transition-colors w-11 h-11 -m-2 flex items-center justify-center shrink-0"
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
                            className="w-11 h-11 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-9 text-center text-base font-semibold tabular-nums">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item.id, 1)}
                            aria-label="Añadir una unidad"
                            className="w-11 h-11 rounded-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <span className="text-lg font-bold text-primary tabular-nums">{formatEur(lineTotal)}</span>
                      </div>

                      {/* Desglose de líneas para Lego Pack */}
                      {item.product.productType === 'legoPack' && item.legoPackLineIds && item.legoPackLineIds.length > 0 && (
                        <div className="text-xs text-muted-foreground border-t border-gray-700 pt-2 space-y-1">
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

            {/* Código promocional */}
            {cart.length > 0 && (
              <div className="px-3 pb-2 space-y-1 border-t border-gray-800 pt-2">
                {promoCodeData ? (
                  <div className="flex items-center justify-between bg-success/10 border border-success/40 rounded-lg px-3 py-1 min-h-11">
                    <span className="text-sm text-success font-mono font-bold">{promoCodeData.code}</span>
                    <span className="text-sm text-success tabular-nums">-{promoCodeData.discountPercent}% (-{formatEur(promoDiscount)})</span>
                    <button onClick={removePromoCode} aria-label="Quitar código" className="text-gray-500 hover:text-danger -mr-2 w-11 h-11 flex items-center justify-center"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Código promo"
                      aria-label="Código promocional"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && applyPromoCode()}
                      className="h-11 text-sm bg-gray-800 border-gray-700 text-white font-mono uppercase"
                    />
                    <Button
                      size="sm"
                      className="h-11 px-4 text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={applyPromoCode}
                      disabled={promoCodeLoading || !promoCodeInput.trim()}
                    >
                      {promoCodeLoading ? "..." : "OK"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Descuento manual */}
            {cart.length > 0 && (
              <div className="px-3 pb-2 space-y-1 border-t border-gray-800 pt-1">
                <button
                  className="w-full min-h-11 flex items-center justify-between text-sm text-muted-foreground hover:text-white py-1"
                  onClick={() => setShowDiscountForm(!showDiscountForm)}
                  aria-expanded={showDiscountForm}
                >
                  <span className="flex items-center gap-2">
                    <Tag className="w-4 h-4" />
                    {discountAmount > 0 ? `-${formatEur(discountAmount)}` : "Descuento manual"}
                  </span>
                  {showDiscountForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showDiscountForm && (
                  <div className="space-y-2 pb-1">
                    <Input
                      type="number"
                      placeholder="Importe descuento (€)"
                      aria-label="Importe del descuento"
                      value={discountAmount || ""}
                      onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                      className="h-11 text-sm bg-gray-800 border-gray-700 text-white"
                    />
                    <Input
                      placeholder="Motivo"
                      aria-label="Motivo del descuento"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="h-11 text-sm bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Datos del cliente (opcional): plegado salvo que haya algo que ver o rellenar ── */}
            <div className="px-3 pb-3 border-t border-gray-800 pt-1">
              <button
                type="button"
                className="w-full min-h-11 flex items-center justify-between gap-2 text-sm text-muted-foreground hover:text-white py-1"
                onClick={() => setShowCustomerForm(!showCustomerForm)}
                aria-expanded={customerOpen}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <User className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-medium text-gray-300 shrink-0">Datos del cliente</span>
                  <span className="text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                    {selectedClient ? selectedClient.name : customerName ? customerName : "(opcional)"}
                  </span>
                </span>
                {customerOpen ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
              </button>
              {customerOpen && (
                <div className="space-y-2 pt-1">
                  {/* Cliente existente: búsqueda por nombre, email o teléfono */}
                  {selectedClient ? (
                    <div className="flex items-center justify-between gap-2 bg-success/10 border border-success/40 rounded-lg px-2 py-1 min-h-11">
                      <span className="flex items-center gap-1 text-sm text-success min-w-0">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">Cliente existente: {selectedClient.name}</span>
                      </span>
                      <button type="button" onClick={clearCustomer} className="text-sm text-muted-foreground hover:text-white h-11 px-2 shrink-0">Quitar</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <Input
                        placeholder="Buscar cliente (nombre, email o teléfono)"
                        aria-label="Buscar cliente existente"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="h-11 pl-9 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                      />
                      {clientQuery.length >= 3 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                          {clientResults.isLoading ? (
                            <p className="text-sm text-muted-foreground px-3 py-2">Buscando…</p>
                          ) : (clientResults.data ?? []).length === 0 ? (
                            <p className="text-sm text-muted-foreground px-3 py-2">Sin coincidencias: escribe sus datos abajo y se dará de alta al cobrar.</p>
                          ) : (
                            (clientResults.data ?? []).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => pickClient(c)}
                                className="w-full text-left px-3 py-2 min-h-11 hover:bg-gray-700"
                              >
                                <span className="block text-sm text-white overflow-hidden text-ellipsis whitespace-nowrap">{c.name}</span>
                                <span className="block text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
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
                    className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Email"
                      aria-label="Email del cliente"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => { setCustomerEmail(e.target.value); setSelectedClient(null); }}
                      className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                    />
                    <Input
                      placeholder="Teléfono"
                      aria-label="Teléfono del cliente"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                    />
                  </div>
                </div>
              )}
              {/* Documento de la venta: ticket o factura completa (art. 4 y 6 del RD 1619/2012) */}
              {cart.length > 0 && (
                <div className="pt-1 space-y-2" aria-live="polite">
                  {clientInvoiceReady ? (
                    <p className="text-xs text-success">Factura completa a nombre de {selectedClient!.invoiceRecipient.name} (NIF {selectedClient!.invoiceRecipient.nif}).</p>
                  ) : overLimit ? (
                    <p role="alert" className="text-xs text-warning">Más de {SIMPLIFIED_INVOICE_LIMIT_EUR} € (IVA incluido): no basta con el ticket, hace falta factura completa. Indica los datos del destinatario.</p>
                  ) : (
                    <label className="flex items-center gap-2 min-h-11 text-sm text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={wantsInvoice} onChange={(e) => setWantsInvoice(e.target.checked)} className="w-5 h-5 accent-primary" />
                      El cliente quiere factura completa (con NIF)
                    </label>
                  )}
                  {showRecipientForm ? (
                    <div className="space-y-2" role="group" aria-label="Datos para la factura completa">
                      <Input placeholder="Nombre o razón social" aria-label="Nombre o razón social para la factura" value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="NIF" aria-label="NIF para la factura" value={recipient.nif} onChange={(e) => setRecipient({ ...recipient, nif: e.target.value })} className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600" />
                        <Input placeholder="Código postal" aria-label="Código postal para la factura" value={recipient.postalCode} onChange={(e) => setRecipient({ ...recipient, postalCode: e.target.value })} className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600" />
                      </div>
                      <Input placeholder="Dirección" aria-label="Dirección para la factura" value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600" />
                      <Input placeholder="Población" aria-label="Población para la factura" value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} className="h-11 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-600" />
                    </div>
                  ) : !clientInvoiceReady && (
                    <p className="text-xs text-gray-500">Se entregará ticket (factura simplificada). Si después pide factura completa, se canjea el ticket.</p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Fecha del servicio */}
          {askServiceDate && <div className="px-4 py-2 border-t border-gray-800 shrink-0 flex items-center gap-3">
            <label htmlFor="tpv-service-date" className="text-sm text-muted-foreground flex items-center gap-1.5 shrink-0">
              <Calendar className="w-4 h-4" /> {licensed ? "Fecha del servicio" : "Fecha de actividad"}
            </label>
            <input
              id="tpv-service-date"
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="flex-1 min-w-0 h-11 text-sm bg-gray-800 border border-gray-700 text-white rounded-lg px-2 focus:outline-none focus:border-primary"
            />
          </div>}

          {/* Totales — siempre visibles */}
          <div className="px-4 py-3 border-t border-gray-800 space-y-1 shrink-0 bg-gray-950/40">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatEur(cartSubtotal)}</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-sm text-success">
                <span>Promo {promoCodeData?.code}</span>
                <span className="tabular-nums">-{formatEur(promoDiscount)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-success">
                <span>Descuento manual</span>
                <span className="tabular-nums">-{formatEur(discountAmount)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between text-white pt-1">
              <span className="text-sm font-semibold tracking-wide">TOTAL</span>
              <span className="text-4xl font-extrabold text-primary tabular-nums leading-none">{formatEur(cartTotal)}</span>
            </div>
          </div>

          {/* Cobro */}
          <div className="px-3 pb-3 space-y-2 shrink-0">
            {pricingPending && <p className="text-xs text-muted-foreground text-center" aria-live="polite">Calculando precios…</p>}
            <div className="grid grid-cols-3 gap-2">
              <Button
                className="h-16 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-1 text-sm font-semibold rounded-xl"
                onClick={() => {
                  if (!sessionId) return toast.error("No hay sesión de caja abierta");
                  if (cart.length === 0) return toast.error("El carrito está vacío");
                  if (!checkSaleDocument()) return;
                  setShowCashPayment(true);
                }}
                disabled={createSaleMut.isPending || pricingPending || cart.length === 0}
              >
                <Banknote className="w-6 h-6" />
                Efectivo
              </Button>
              <Button
                className="h-16 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-1 text-sm font-semibold rounded-xl"
                onClick={() => handleQuickPay("card")}
                disabled={createSaleMut.isPending || cart.length === 0}
              >
                <CreditCard className="w-6 h-6" />
                Tarjeta
              </Button>
              <Button
                className="h-16 bg-primary hover:bg-primary/90 text-primary-foreground flex-col gap-1 text-sm font-semibold rounded-xl"
                onClick={() => handleQuickPay("bizum")}
                disabled={createSaleMut.isPending || cart.length === 0}
              >
                <Smartphone className="w-6 h-6" />
                Bizum
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full h-11 border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800 hover:text-white gap-2"
              onClick={() => { if (checkSaleDocument()) setShowSplitPayment(true); }}
              disabled={createSaleMut.isPending || pricingPending || cart.length === 0}
            >
              <SplitSquareHorizontal className="w-4 h-4" />
              Dividir cuenta
            </Button>
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
            <span className="tabular-nums">{formatEur(cartTotal)}</span>
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
          <TpvCashPayment
            open={showCashPayment}
            total={cartTotal}
            pending={createSaleMut.isPending}
            onClose={() => setShowCashPayment(false)}
            onConfirm={(amountTendered) => handleQuickPay("cash", amountTendered)}
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
              invoiceRecipient={saleInvoiceRecipient}
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
