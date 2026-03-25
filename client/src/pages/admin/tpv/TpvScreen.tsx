/**
 * TPV Presencial Náyade — Pantalla principal kiosk
 * Diseño negro premium resort
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone,
  Layers, X, User, Calendar, Clock, Users, Tag, ChevronDown, ChevronUp,
  Zap, Waves, Baby, Sparkles, Star, Sun, Filter, LogOut, Settings,
  Receipt, ArrowLeft, SplitSquareHorizontal,
} from "lucide-react";
import { Link } from "wouter";
import TpvOpenSession from "./TpvOpenSession";
import TpvCloseSession from "./TpvCloseSession";
import TpvCashMovement from "./TpvCashMovement";
import TpvSplitPayment from "./TpvSplitPayment";
import TpvTicket from "./TpvTicket";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductType = "experience" | "pack" | "spa" | "hotel" | "restaurant" | "extra";

interface CatalogProduct {
  id: number;
  title: string;
  basePrice: string | null;
  coverImageUrl: string | null;
  discountPercent: string | null;
  productType: ProductType;
  categoryId?: number | null;
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
}

type PaymentMethod = "cash" | "card" | "bizum" | "other";

interface Payment {
  method: PaymentMethod;
  amount: number;
  amountTendered?: number;
  payerName?: string;
}

type Filter = "all" | "experience" | "pack" | "spa" | "hotel";

// ─── Category colors ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ProductType, string> = {
  experience: "from-cyan-600 to-blue-700",
  pack: "from-violet-600 to-purple-700",
  spa: "from-rose-600 to-pink-700",
  hotel: "from-amber-600 to-orange-700",
  restaurant: "from-green-600 to-emerald-700",
  extra: "from-gray-600 to-slate-700",
};

const TYPE_LABELS: Record<string, string> = {
  experience: "Experiencia",
  pack: "Pack",
  spa: "SPA",
  hotel: "Hotel",
  restaurant: "Restaurante",
  extra: "Extra",
};

const FILTER_ICONS: Record<string, React.ReactNode> = {
  all: <Filter className="w-3 h-3" />,
  experience: <Waves className="w-3 h-3" />,
  pack: <Layers className="w-3 h-3" />,
  spa: <Sparkles className="w-3 h-3" />,
  hotel: <Star className="w-3 h-3" />,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TpvScreen() {
  const { user } = useAuth();
  const [registerId] = useState(1); // default register
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
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

  // Check active session
  const { data: activeSession, refetch: refetchSession } = trpc.tpv.getActiveSession.useQuery(
    { registerId },
    { refetchInterval: 30000 }
  );

  useEffect(() => {
    if (activeSession) setSessionId(activeSession.id);
    else setSessionId(null);
  }, [activeSession]);

  // Catalog
  const { data: catalog } = trpc.tpv.getCatalog.useQuery(undefined, {
    enabled: !!sessionId,
  });

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
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPhone("");
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
  ];

  const filteredProducts = allProducts.filter((p) => {
    const matchesFilter = filter === "all" || p.productType === filter;
    const matchesSearch =
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // ── Cart helpers ────────────────────────────────────────────────────────────
  const addToCart = useCallback((product: CatalogProduct) => {
    const price = parseFloat(String(product.basePrice ?? "0"));
    const discount = parseFloat(String(product.discountPercent ?? "0"));
    const existing = cart.find(
      (i) => i.product.id === product.id && i.product.productType === product.productType
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
          id: `${product.productType}-${product.id}-${Date.now()}`,
          product,
          quantity: 1,
          unitPrice: price,
          discountPercent: discount,
          participants: 1,
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
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      discountAmount: discountAmount + promoDiscount,
      discountReason: promoCodeData ? `Código ${promoCodeData.code} (-${promoCodeData.discountPercent}%)${discountReason ? ` + ${discountReason}` : ""}` : discountReason || undefined,
      discountCodeId: promoCodeData?.id ?? undefined,
      items: cart.map((item) => ({
        productType: item.product.productType,
        productId: item.product.id,
        productName: item.product.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        eventDate: item.eventDate,
        eventTime: item.eventTime,
        participants: item.participants,
        notes: item.notes,
      })),
      payments: [{ method, amount: cartTotal }],
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!sessionId && !showOpenSession) {
    return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center z-50">
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center mx-auto shadow-2xl">
            <Receipt className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">TPV Náyade</h1>
          <p className="text-gray-400">Terminal Punto de Venta Presencial</p>
          <Button
            size="lg"
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold text-lg h-14 rounded-xl"
            onClick={() => setShowOpenSession(true)}
          >
            Abrir Caja
          </Button>
          <Button
            variant="ghost"
            className="text-gray-500 hover:text-gray-300"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Volver al Dashboard
          </Button>
        </div>

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
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col overflow-hidden z-50 text-white">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm">TPV Náyade</span>
          {activeSession && (
            <Badge variant="outline" className="text-green-400 border-green-700 text-xs">
              Caja abierta
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{user?.name}</span>
          <Link href="/admin/tpv/backoffice">
            <Button
              size="sm"
              variant="ghost"
              className="text-violet-400 hover:text-violet-300 h-8 px-2 text-xs gap-1"
              title="Historial de ventas y reservas del día"
            >
              <Settings className="w-3 h-3" />
              Backoffice
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-8 px-2"
            onClick={() => setShowCashMovement("in")}
            title="Entrada efectivo"
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-8 px-2"
            onClick={() => setShowCashMovement("out")}
            title="Salida efectivo"
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-amber-400 hover:text-amber-300 h-8 px-2 text-xs"
            onClick={() => setShowCloseSession(true)}
          >
            Cerrar caja
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white h-8 px-2"
            onClick={() => window.history.back()}
          >
            <LogOut className="w-3 h-3" />
          </Button>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Catalog ── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-800">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
            <Input
              placeholder="Buscar producto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-sm bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 max-w-48"
            />
            {(["all", "experience", "pack", "spa", "hotel"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "ghost"}
                className={`h-7 px-3 text-xs gap-1 ${
                  filter === f
                    ? "bg-violet-600 text-white hover:bg-violet-500"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => setFilter(f)}
              >
                {FILTER_ICONS[f]}
                {f === "all" ? "Todos" : TYPE_LABELS[f]}
              </Button>
            ))}
          </div>

          {/* Product grid */}
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 p-4">
              {filteredProducts.map((product) => {
                const price = parseFloat(String(product.basePrice ?? "0"));
                const discount = parseFloat(String(product.discountPercent ?? "0"));
                const finalPrice = discount > 0 ? price * (1 - discount / 100) : price;
                return (
                  <button
                    key={`${product.productType}-${product.id}`}
                    onClick={() => addToCart(product)}
                    className="group relative bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-violet-500 transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
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
                          <Waves className="w-8 h-8 text-white/40" />
                        </div>
                      )}
                      {discount > 0 && (
                        <div className="absolute top-1 right-1 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                          -{discount.toFixed(0)}%
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1">
                        <Badge className={`text-xs bg-black/50 text-white border-0`}>
                          {TYPE_LABELS[product.productType]}
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
                          <span className="text-xs text-gray-500 line-through">{price.toFixed(2)}€</span>
                        )}
                        <span className="text-sm font-bold text-violet-400">{finalPrice.toFixed(2)}€</span>
                      </div>
                    </div>
                    {/* Add overlay */}
                    <div className="absolute inset-0 bg-violet-600/0 group-hover:bg-violet-600/10 transition-colors flex items-center justify-center">
                      <Plus className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                    </div>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="col-span-full text-center py-16 text-gray-500">
                  <Waves className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No hay productos disponibles</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Cart + Payment ── */}
        <div className="w-80 xl:w-96 flex flex-col bg-gray-900 shrink-0 overflow-hidden">
          {/* Cart header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-violet-400" />
              <span className="font-semibold text-sm">Carrito</span>
              {cart.length > 0 && (
                <Badge className="bg-violet-600 text-white text-xs">{cart.reduce((a, i) => a + i.quantity, 0)}</Badge>
              )}
            </div>
            {cart.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-300 h-6 px-2 text-xs"
                onClick={() => setCart([])}
              >
                Vaciar
              </Button>
            )}
          </div>

          {/* ── Datos del cliente (siempre visible) ── */}
          <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/80">
            <div className="flex items-center gap-1.5 mb-2">
              <User className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs font-semibold text-gray-300">Datos del cliente</span>
              <span className="text-[10px] text-gray-600 ml-1">(opcional)</span>
            </div>
            <div className="space-y-1.5">
              <Input
                placeholder="Nombre"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-7 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  placeholder="Email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="h-7 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
                />
                <Input
                  placeholder="Teléfono"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="h-7 text-xs bg-gray-800 border-gray-700 text-white placeholder:text-gray-600"
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
                          <Waves className="w-3 h-3 text-white/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white line-clamp-1">{item.product.title}</p>
                          <p className="text-xs text-gray-400">{item.unitPrice.toFixed(2)}€/ud</p>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQty(item.id, -1)}
                            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item.id, 1)}
                            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <span className="text-sm font-bold text-violet-400">{lineTotal.toFixed(2)}€</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Código promocional (dentro del scroll) */}
            {cart.length > 0 && (
              <div className="px-0 pb-2 space-y-1 border-t border-gray-800 pt-2">
                {promoCodeData ? (
                  <div className="flex items-center justify-between bg-green-900/30 border border-green-700/40 rounded px-2 py-1">
                    <span className="text-xs text-green-400 font-mono font-bold">{promoCodeData.code}</span>
                    <span className="text-xs text-green-400">-{promoCodeData.discountPercent}% (-{promoDiscount.toFixed(2)}€)</span>
                    <button onClick={removePromoCode} className="text-gray-500 hover:text-red-400 ml-1"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Input
                      placeholder="Código promo"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && applyPromoCode()}
                      className="h-7 text-xs bg-gray-800 border-gray-700 text-white font-mono uppercase"
                    />
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs bg-violet-700 hover:bg-violet-600 text-white"
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
                  className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-white py-1"
                  onClick={() => setShowDiscountForm(!showDiscountForm)}
                >
                  <span className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {discountAmount > 0 ? `-${discountAmount.toFixed(2)}€` : "Descuento manual"}
                  </span>
                  {showDiscountForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showDiscountForm && (
                  <div className="space-y-1 pb-1">
                    <Input
                      type="number"
                      placeholder="Importe descuento (€)"
                      value={discountAmount || ""}
                      onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                      className="h-7 text-xs bg-gray-800 border-gray-700 text-white"
                    />
                    <Input
                      placeholder="Motivo"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      className="h-7 text-xs bg-gray-800 border-gray-700 text-white"
                    />
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Totals — siempre visible */}
          <div className="px-4 py-3 border-t border-gray-800 space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Subtotal</span>
              <span>{cartSubtotal.toFixed(2)}€</span>
            </div>
            {promoDiscount > 0 && (
              <div className="flex justify-between text-xs text-green-400">
                <span>Promo {promoCodeData?.code}</span>
                <span>-{promoDiscount.toFixed(2)}€</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-green-400">
                <span>Descuento manual</span>
                <span>-{discountAmount.toFixed(2)}€</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-white">
              <span>TOTAL</span>
              <span className="text-violet-400">{cartTotal.toFixed(2)}€</span>
            </div>
          </div>

          {/* Payment buttons */}
          <div className="px-3 pb-3 space-y-2">
            {cart.length > 0 && (
              <>
                <Button
                  className="w-full h-10 bg-violet-600 hover:bg-violet-500 text-white font-semibold gap-2"
                  onClick={() => setShowSplitPayment(true)}
                  disabled={createSaleMut.isPending}
                >
                  <SplitSquareHorizontal className="w-4 h-4" />
                  Dividir cuenta
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    className="h-12 bg-green-700 hover:bg-green-600 text-white flex-col gap-0.5 text-xs font-medium"
                    onClick={() => handleQuickPay("cash")}
                    disabled={createSaleMut.isPending}
                  >
                    <Banknote className="w-4 h-4" />
                    Efectivo
                  </Button>
                  <Button
                    className="h-12 bg-blue-700 hover:bg-blue-600 text-white flex-col gap-0.5 text-xs font-medium"
                    onClick={() => handleQuickPay("card")}
                    disabled={createSaleMut.isPending}
                  >
                    <CreditCard className="w-4 h-4" />
                    Tarjeta
                  </Button>
                  <Button
                    className="h-12 bg-cyan-700 hover:bg-cyan-600 text-white flex-col gap-0.5 text-xs font-medium"
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

      {/* ── Modals ── */}
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
              onClose={() => setShowSplitPayment(false)}
              onCompleted={(sale) => {
                setLastSale(sale);
                setShowSplitPayment(false);
                setShowTicket(true);
                setCart([]);
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
    </div>
  );
}
