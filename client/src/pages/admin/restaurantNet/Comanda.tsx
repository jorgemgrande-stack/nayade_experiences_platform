/**
 * Restaurant Net · Comanda de una mesa (/admin/restaurant-net/sala/comanda/:id): carta por categorías para añadir
 * platos, líneas con unidades y anulación con motivo, totales con el desglose de IVA, pedir la cuenta, unir otra mesa,
 * cobrar con el TPV del Core (caja abierta, uno o varios pagos; el ticket es el del TPV) y liberar la mesa sin cobrar.
 * Inspirada en la pantalla de TPV de hostelería de la aplicación de origen; el cobro y el ticket son los del Core.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { BedDouble, ArrowLeft, Ban, ChefHat, Link2, Minus, Plus, Receipt, Search, Trash2, Unlink, Users, Utensils, Wallet } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { RoomChargeDialog } from "@/components/hotel/RoomChargeDialog";
import TpvTicket from "@/pages/admin/tpv/TpvTicket";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { HeroCard } from "@/components/admin/PanelVisual";
import { useI18n } from "@/i18n/I18nProvider";
import { TONE_BADGE } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import {
  ALLERGEN_LABEL,
  ORDER_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  formatEur,
  lineAmount,
  paymentsProblem,
  round2,
  tableStates,
  type OrderStatus,
  type PaymentMethod,
} from "@shared/restaurantNet";
import { KITCHEN_STATUS_LABELS } from "@shared/restaurantKds";
import { cashSaleDocument, exceedsSimplifiedInvoiceLimit, SIMPLIFIED_INVOICE_LIMIT_EUR, type TicketInvoiceRecipient } from "@shared/ticketInvoice";
import { CARTA_PATH, PillTabs, SALA_PATH, useRestaurantNetWrite } from "./RestaurantNetParts";

const ALL = "__todas";
const STATUS_TONE: Record<OrderStatus, keyof typeof TONE_BADGE> = { open: "warning", bill_requested: "info", paying: "info", paid: "success", room_charged: "brand", cancelled: "neutral" };

export default function Comanda() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const [, navigate] = useLocation();
  const { canWrite } = useRestaurantNetWrite();
  const utils = trpc.useUtils();
  const detail = trpc.restaurantNet.getOrder.useQuery({ orderId }, { enabled: orderId > 0, refetchInterval: 10_000 });
  const waiters = trpc.restaurantNet.listWaiters.useQuery({ restaurantId: detail.data?.order.restaurantId ?? 0 }, { enabled: detail.data != null, retry: false });
  const [course, setCourse] = useState(1);
  const restaurantId = detail.data?.order.restaurantId;
  const menu = trpc.restaurantNet.listMenu.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null });
  const floor = trpc.restaurantNet.getFloor.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null });
  const [cat, setCat] = useState(ALL);
  const [search, setSearch] = useState("");
  const [voiding, setVoiding] = useState<{ id: number; name: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeTable, setMergeTable] = useState("");
  const [paying, setPaying] = useState(false);
  // Cargo a habitación: solo si la empresa tiene Hotel Net (si no, la opción no aparece)
  const roomGuests = trpc.restaurantNet.roomGuests.useQuery(undefined, { retry: false });
  const [toRoom, setToRoom] = useState(false);
  const chargeToRoom = trpc.restaurantNet.chargeToRoom.useMutation({
    onSuccess: () => { toast.success("Cargada a la habitación"); setToRoom(false); utils.restaurantNet.getFloor.invalidate(); navigate(SALA_PATH); },
    onError: (e) => toastError(e),
  });
  const [ticketSaleId, setTicketSaleId] = useState<number | null>(null);

  const refresh = () => {
    utils.restaurantNet.getOrder.invalidate({ orderId });
    utils.restaurantNet.getFloor.invalidate();
  };
  const onErr = (e: unknown) => { toastError(e); refresh(); };
  const addItem = trpc.restaurantNet.addItem.useMutation({ onSuccess: refresh, onError: onErr });
  const setQty = trpc.restaurantNet.setItemQty.useMutation({ onSuccess: refresh, onError: onErr });
  const voidItem = trpc.restaurantNet.voidItem.useMutation({ onSuccess: () => { setVoiding(null); toast.success("Línea anulada"); refresh(); }, onError: onErr });
  const requestBill = trpc.restaurantNet.requestBill.useMutation({ onSuccess: () => { toast.success("La mesa pide la cuenta"); refresh(); }, onError: onErr });
  const reopen = trpc.restaurantNet.reopenOrder.useMutation({ onSuccess: refresh, onError: onErr });
  const release = trpc.restaurantNet.releaseTable.useMutation({ onSuccess: () => { toast.success("Mesa liberada"); utils.restaurantNet.getFloor.invalidate(); navigate(SALA_PATH); }, onError: onErr });
  const merge = trpc.restaurantNet.mergeTables.useMutation({ onSuccess: () => { setMerging(false); toast.success("Mesas unidas"); refresh(); }, onError: onErr });
  const unmerge = trpc.restaurantNet.unmergeTable.useMutation({ onSuccess: () => { toast.success("Mesa separada"); refresh(); }, onError: onErr });
  const updateOrder = trpc.restaurantNet.updateOrder.useMutation({ onSuccess: refresh, onError: onErr });
  const fire = trpc.restaurantNet.fireItems.useMutation({ onSuccess: (r) => { toast.success(r.fired === 1 ? "1 plato marchado a cocina" : `${r.fired} platos marchados a cocina`); refresh(); }, onError: onErr });
  const serveReady = trpc.restaurantNet.serveReady.useMutation({ onSuccess: refresh, onError: onErr });
  const assignWaiter = trpc.restaurantNet.assignWaiter.useMutation({ onSuccess: () => { toast.success("Camarero asignado"); refresh(); }, onError: onErr });

  const items = (menu.data ?? []).filter((m) => m.isActive);
  const categories = useMemo(() => Array.from(new Set(items.map((m) => m.category || "Sin categoría"))), [items]);
  const term = search.trim().toLowerCase();
  const shownMenu = items.filter((m) => (cat === ALL || (m.category || "Sin categoría") === cat) && (!term || m.name.toLowerCase().includes(term)));

  if (!(orderId > 0)) return <AdminLayout><p className="text-sm text-muted-foreground">Comanda no válida.</p></AdminLayout>;
  if (detail.isLoading) return <AdminLayout><PanelLoading label="Cargando la comanda…" /></AdminLayout>;
  if (detail.isError || !detail.data) {
    return (
      <AdminLayout>
        <div className="space-y-3">
          <PanelError error={detail.error} onRetry={() => detail.refetch()} />
          <Button asChild variant="outline"><Link href={SALA_PATH}><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />Volver a la sala</Link></Button>
        </div>
      </AdminLayout>
    );
  }

  const { order, totals, table, booking } = detail.data;
  const status = order.status as OrderStatus;
  const editable = canWrite && (status === "open" || status === "bill_requested");
  const lines = detail.data.items;
  const busy = addItem.isPending || setQty.isPending;
  const pendingCount = lines.filter((l) => l.status === "pending").length;
  const readyCount = lines.filter((l) => l.status === "ready").length;
  const pendingCourses = Array.from(new Set(lines.filter((l) => l.status === "pending").map((l) => l.course))).sort((a, b) => a - b);
  const states = tableStates(floor.data?.tables ?? [], floor.data?.openOrders ?? []);
  const mergeCandidates = (floor.data?.tables ?? []).filter((t) => t.id !== table?.id && t.mergedInto == null && !(floor.data?.tables ?? []).some((x) => x.mergedInto === t.id));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-4">
        <HeroCard>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm" className="h-10"><Link href={SALA_PATH}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Sala</Link></Button>
                <h1 className="break-words text-2xl font-bold text-foreground sm:text-3xl">{table ? `Mesa ${table.code}` : `Comanda ${order.id}`}</h1>
                {table?.merged.map((m) => (
                  <Badge key={m.id} variant="outline" className="gap-1">
                    <Link2 className="h-3 w-3" aria-hidden="true" />{m.code}
                    {editable && (
                      <button type="button" aria-label={`Separar la mesa ${m.code}`} className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted" onClick={() => unmerge.mutate({ tableId: m.id })}>
                        <Unlink className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </Badge>
                ))}
                <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_BADGE[STATUS_TONE[status] ?? "neutral"])}>{ORDER_STATUS_LABELS[status] ?? status}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" aria-label={t("restaurantNet.comanda.progress")}>
                <span className="rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs font-medium tabular-nums text-foreground">{t("restaurantNet.comanda.dishes", { count: totals.units })}</span>
                {pendingCount > 0 && <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums", TONE_BADGE.warning)}>{t("restaurantNet.comanda.toFire", { count: pendingCount })}</span>}
                {readyCount > 0 && <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums", TONE_BADGE.success)}>{t("restaurantNet.comanda.readyChip", { count: readyCount })}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Users className="h-4 w-4" aria-hidden="true" />
                {editable ? (
                  <Input
                    aria-label="Comensales"
                    type="number"
                    min={1}
                    max={50}
                    defaultValue={order.guests}
                    className="h-10 w-20 bg-card"
                    onBlur={(e) => { const g = Number(e.target.value); if (Number.isInteger(g) && g >= 1 && g <= 50 && g !== order.guests) updateOrder.mutate({ orderId, guests: g }); }}
                  />
                ) : (
                  <span className="font-medium text-foreground">{order.guests}</span>
                )}
                <span>comensales</span>
              </span>
              {order.customerName && <span className="break-words">{order.customerName}</span>}
              {editable && (waiters.data ?? []).length > 0 ? (
                <Select value={detail.data.waiter ? String(detail.data.waiter.id) : "__nadie"} onValueChange={(v) => assignWaiter.mutate({ orderId, userId: v === "__nadie" ? null : Number(v) })}>
                  <SelectTrigger className="h-10 w-48 bg-card" aria-label="Camarero"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nadie">Sin camarero</SelectItem>
                    {(waiters.data ?? []).map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name ?? `Usuario ${w.id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                detail.data.waiter && <span className="break-words">{detail.data.waiter.name}</span>
              )}
              {booking && <Badge variant="secondary">Reserva {booking.locator} · {booking.time}</Badge>}
            </div>
          </div>
        </HeroCard>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Carta */}
          <section id="rnet-carta" className="min-w-0 scroll-mt-4 space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4" aria-label="Carta">
            {!editable ? (
              <p className="text-sm text-muted-foreground">{status === "paying" ? "Se está cobrando esta comanda." : status === "paid" || status === "cancelled" ? "La comanda está cerrada." : "Tu plan está en solo lectura."}</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">La carta está vacía. <Link href={CARTA_PATH} className="underline">Añade platos</Link> para tomar la comanda.</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input aria-label="Buscar plato" placeholder="Buscar plato" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pase de los platos que añades">
                  <span className="text-sm text-muted-foreground">Pase</span>
                  {[1, 2, 3].map((c) => (
                    <Button key={c} variant={course === c ? "default" : "outline"} aria-pressed={course === c} className="h-11 w-11 p-0 text-base" onClick={() => setCourse(c)}>{c}</Button>
                  ))}
                </div>
                <PillTabs scroll label="Categorías" value={cat} onChange={setCat} options={[ALL, ...categories].map((c) => ({ value: c, label: c === ALL ? "Todas" : c }))} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
                  {shownMenu.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={busy}
                      onClick={() => addItem.mutate({ orderId, menuItemId: m.id, quantity: 1, course })}
                      className="flex min-h-[92px] min-w-0 flex-col justify-between rounded-lg border border-border bg-background p-3 text-left shadow-sm transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
                    >
                      <span className="break-words text-base font-medium leading-tight text-foreground">{m.name}</span>
                      <span className="mt-1 flex items-end justify-between gap-1">
                        <span className="text-xs text-muted-foreground">{m.allergens.length ? m.allergens.map((a) => ALLERGEN_LABEL[a]).join(", ") : ""}</span>
                        <span className="shrink-0 text-base font-semibold tabular-nums text-primary">{formatEur(m.price)}</span>
                      </span>
                    </button>
                  ))}
                  {shownMenu.length === 0 && <p className="col-span-full text-sm text-muted-foreground">Ningún plato coincide.</p>}
                </div>
              </>
            )}
          </section>

          {/* Ticket de la comanda */}
          <section className="order-first flex min-w-0 flex-col self-start rounded-xl border border-border bg-card shadow-sm lg:sticky lg:top-4 lg:order-none" aria-label="Comanda">
            <ul className="max-h-[50vh] flex-1 divide-y divide-border overflow-y-auto lg:max-h-[calc(100vh-26rem)] lg:min-h-40">
              {lines.length === 0 && <li className="flex flex-col items-center gap-1 px-4 py-8 text-center text-sm text-muted-foreground"><Utensils className="h-6 w-6" aria-hidden="true" />Aún no hay platos. Toca un plato de la carta para añadirlo.</li>}
              {lines.map((l) => {
                const isVoid = l.status === "void";
                return (
                  <li key={l.id} className="space-y-1 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className={cn("min-w-0 break-words text-base font-medium text-foreground", isVoid && "text-muted-foreground line-through")}>{l.name}</p>
                      <span className={cn("shrink-0 text-base font-semibold tabular-nums text-foreground", isVoid && "text-muted-foreground line-through")}>{formatEur(lineAmount(l))}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatEur(l.unitPrice)} · IVA {l.taxRate.toLocaleString("es-ES")} %{l.station ? ` · ${l.station}` : ""}
                      {l.notes ? ` · ${l.notes}` : ""}
                      {isVoid ? null : (
                        <span className={cn("ml-1.5 inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", l.status === "ready" ? TONE_BADGE.success : l.status === "pending" ? TONE_BADGE.neutral : l.status === "preparing" ? TONE_BADGE.warning : TONE_BADGE.info)}>
                          {KITCHEN_STATUS_LABELS[l.status] ?? l.status}{l.course > 1 ? ` · pase ${l.course}` : ""}
                        </span>
                      )}
                    </p>
                    {isVoid && <p className="text-xs text-danger">Anulada: {l.voidReason}</p>}
                    <div className="flex items-center justify-between gap-2">
                      {editable && !isVoid && l.status === "pending" ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button size="icon" variant="outline" className="h-11 w-11" aria-label={`Una menos de ${l.name}`} disabled={busy || l.quantity <= 1} onClick={() => setQty.mutate({ itemId: l.id, quantity: l.quantity - 1 })}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
                          <span className="w-8 text-center text-base font-semibold tabular-nums text-foreground">{l.quantity}</span>
                          <Button size="icon" variant="outline" className="h-11 w-11" aria-label={`Una más de ${l.name}`} disabled={busy || l.quantity >= 99} onClick={() => setQty.mutate({ itemId: l.id, quantity: l.quantity + 1 })}><Plus className="h-4 w-4" aria-hidden="true" /></Button>
                        </div>
                      ) : (
                        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">×{l.quantity}</span>
                      )}
                      {editable && !isVoid && (
                        <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0 text-muted-foreground hover:text-danger" aria-label={`Anular ${l.name}`} onClick={() => { setVoidReason(""); setVoiding({ id: l.id, name: l.name }); }}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {editable && items.length > 0 && (
              <div className="border-t border-border p-3 lg:hidden">
                <Button variant="outline" className="h-11 w-full" onClick={() => document.getElementById("rnet-carta")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Utensils className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("restaurantNet.comanda.addDishes")}</Button>
              </div>
            )}
            <div className="space-y-1 border-t border-border bg-muted/30 px-3 py-3 text-sm">
              {totals.taxBreakdown.map((t) => (
                <p key={t.rate} className="flex justify-between text-xs text-muted-foreground">
                  <span>Base {t.rate.toLocaleString("es-ES")} % · IVA</span>
                  <span className="tabular-nums">{formatEur(t.base)} · {formatEur(t.amount)}</span>
                </p>
              ))}
              <p className="flex justify-between text-2xl font-bold text-foreground"><span>Total</span><span className="tabular-nums">{formatEur(totals.total)}</span></p>
              <p className="text-xs text-muted-foreground">IVA incluido</p>
            </div>
            {editable && (pendingCount > 0 || readyCount > 0) && (
              <div className="flex flex-wrap gap-2 border-t border-border p-3">
                {pendingCount > 0 && (
                  <Button className="h-12 flex-1" disabled={fire.isPending} onClick={() => fire.mutate({ orderId })}>
                    <ChefHat className="mr-1.5 h-4 w-4" aria-hidden="true" />Marchar {pendingCount === 1 ? "1 plato" : `${pendingCount} platos`}
                  </Button>
                )}
                {pendingCourses.length > 1 && pendingCourses.map((c) => (
                  <Button key={c} variant="outline" className="h-12" disabled={fire.isPending} onClick={() => fire.mutate({ orderId, course: c })}>Marchar pase {c}</Button>
                ))}
                {readyCount > 0 && (
                  <Button variant="outline" className="h-12 flex-1" disabled={serveReady.isPending} onClick={() => serveReady.mutate({ orderId })}>Servir {readyCount === 1 ? "1 lista" : `${readyCount} listas`}</Button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
              {status === "paid" && order.tpvSaleId ? (
                <>
                  <Button className="col-span-2 h-12" onClick={() => setTicketSaleId(order.tpvSaleId)}><Receipt className="mr-1.5 h-4 w-4" aria-hidden="true" />Ver ticket</Button>
                  <Button asChild variant="outline" className="col-span-2"><Link href={SALA_PATH}>Volver a la sala</Link></Button>
                </>
              ) : editable ? (
                <>
                  {status === "open" ? (
                    <Button variant="outline" className="h-12" disabled={totals.units === 0 || requestBill.isPending} onClick={() => requestBill.mutate({ orderId })}><Receipt className="mr-1.5 h-4 w-4" aria-hidden="true" />Pedir cuenta</Button>
                  ) : (
                    <Button variant="outline" className="h-12" disabled={reopen.isPending} onClick={() => reopen.mutate({ orderId })}>Siguen pidiendo</Button>
                  )}
                  <Button className="h-12" disabled={totals.total <= 0} onClick={() => setPaying(true)}><Wallet className="mr-1.5 h-4 w-4" aria-hidden="true" />Cobrar</Button>
                  {roomGuests.data?.available && (
                    <Button variant="outline" className="col-span-2 h-11" disabled={totals.total <= 0} onClick={() => setToRoom(true)}><BedDouble className="mr-1.5 h-4 w-4" aria-hidden="true" />Cargar a la habitación</Button>
                  )}
                  <Button variant="ghost" className="h-11" disabled={!table} onClick={() => { setMergeTable(""); setMerging(true); }}><Link2 className="mr-1 h-4 w-4" aria-hidden="true" />Unir mesa</Button>
                  <Button variant="ghost" className="h-11" onClick={() => { setReleaseReason(""); setReleasing(true); }}><Ban className="mr-1 h-4 w-4" aria-hidden="true" />Liberar mesa</Button>
                </>
              ) : (
                <Button asChild variant="outline" className="col-span-2"><Link href={SALA_PATH}>Volver a la sala</Link></Button>
              )}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={voiding != null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Anular «{voiding?.name}»</DialogTitle>
            <DialogDescription>La línea queda tachada en la comanda con el motivo y deja de contar en el total.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rnet-void-reason">Motivo</Label>
            <Input id="rnet-void-reason" maxLength={255} value={voidReason} placeholder="Error al marcar, devuelto…" onChange={(e) => setVoidReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={voidReason.trim().length < 3 || voidItem.isPending} onClick={() => voidItem.mutate({ itemId: voiding!.id, reason: voidReason })}>Anular línea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releasing} onOpenChange={setReleasing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Liberar la mesa sin cobrar</DialogTitle>
            <DialogDescription>
              {totals.units > 0 ? `La comanda tiene ${formatEur(totals.total)} sin cobrar: queda cerrada sin venta y con el motivo.` : "La comanda no tiene platos: se cierra y la mesa queda libre."}
            </DialogDescription>
          </DialogHeader>
          {totals.units > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rnet-release-reason">Motivo</Label>
              <Textarea id="rnet-release-reason" rows={2} maxLength={200} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleasing(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={(totals.units > 0 && releaseReason.trim().length < 3) || release.isPending} onClick={() => release.mutate({ orderId, reason: releaseReason || null })}>Liberar mesa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={merging} onOpenChange={setMerging}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Unir otra mesa a la {table?.code}</DialogTitle>
            <DialogDescription>La comanda sigue en esta mesa; si la otra tenía platos, pasan aquí. Al cobrar, se separan solas.</DialogDescription>
          </DialogHeader>
          <Select value={mergeTable} onValueChange={setMergeTable}>
            <SelectTrigger aria-label="Mesa que se une" className="w-full min-w-0"><SelectValue placeholder="Elige la mesa" /></SelectTrigger>
            <SelectContent>
              {mergeCandidates.map((t) => {
                const s = states.get(t.id)?.state ?? "libre";
                return <SelectItem key={t.id} value={String(t.id)}>Mesa {t.code}{s !== "libre" ? " · con comanda" : ""}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(false)}>Cancelar</Button>
            <Button disabled={!mergeTable || !table || merge.isPending} onClick={() => merge.mutate({ primaryId: table!.id, secondaryId: Number(mergeTable) })}>Unir mesas</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toRoom && (
        <RoomChargeDialog
          title={table ? `Cargar la mesa ${table.code} a una habitación` : "Cargar a una habitación"}
          amountLabel={formatEur(totals.total)}
          guests={roomGuests.data?.guests ?? []}
          pending={chargeToRoom.isPending}
          onConfirm={(hotelReservationId) => chargeToRoom.mutate({ orderId, hotelReservationId })}
          onClose={() => setToRoom(false)}
        />
      )}
      {paying && (
        <CheckoutDialog
          orderId={orderId}
          total={totals.total}
          customerName={order.customerName}
          onClose={() => setPaying(false)}
          onPaid={(saleId) => { setPaying(false); refresh(); setTicketSaleId(saleId); }}
        />
      )}
      {ticketSaleId != null && <SaleTicket saleId={ticketSaleId} onClose={() => { setTicketSaleId(null); navigate(SALA_PATH); }} />}
    </AdminLayout>
  );
}

/** Cobro con el TPV del Core: caja abierta y uno o varios pagos que suman el total. */
function CheckoutDialog({ orderId, total, customerName, onClose, onPaid }: { orderId: number; total: number; customerName: string | null; onClose: () => void; onPaid: (saleId: number) => void }) {
  const registers = trpc.tpv.getRegisterStatus.useQuery(undefined, { retry: false });
  const open = (registers.data ?? []).filter((r) => r.openSession);
  const [sessionId, setSessionId] = useState<string>("");
  const [payments, setPayments] = useState<Array<{ method: PaymentMethod; amount: string; tendered: string }>>([{ method: "card", amount: total.toFixed(2), tendered: "" }]);
  const [email, setEmail] = useState("");
  // Factura completa con destinatario identificado: la misma regla que la caja (cashSaleDocument); obligatoria por encima
  // del límite de la factura simplificada, que el TPV no admite cobrar solo con ticket.
  const [wantsInvoice, setWantsInvoice] = useState(false);
  const [recipient, setRecipient] = useState<TicketInvoiceRecipient>({ name: "", nif: "", address: "", postalCode: "", city: "" });
  const overLimit = exceedsSimplifiedInvoiceLimit(total);
  const showRecipientForm = wantsInvoice || overLimit;
  const saleDocument = cashSaleDocument({ total, requested: showRecipientForm ? recipient : null });
  const documentProblem = saleDocument.kind === "rechazo" ? saleDocument.message : null;
  const chosen = sessionId || (open.length === 1 ? String(open[0].openSession!.id) : "");
  const parsed = payments.map((p) => ({ method: p.method, amount: round2(Number(p.amount.replace(",", "."))), tendered: Number(p.tendered.replace(",", ".")) }));
  const problem = paymentsProblem(total, parsed.map((p) => ({ amount: p.amount })));
  const paidSoFar = round2(parsed.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0));
  const checkout = trpc.restaurantNet.checkout.useMutation({
    onSuccess: (r) => { toast.success(r.replayed ? "Esta comanda ya estaba cobrada" : "Cobro registrado en el TPV"); onPaid(r.saleId); },
    onError: (e) => toastError(e),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar {formatEur(total)}</DialogTitle>
          <DialogDescription>Se registra como venta del TPV en la caja elegida, con su ticket y el IVA de cada plato.</DialogDescription>
        </DialogHeader>
        {registers.isLoading ? (
          <PanelLoading label="Buscando cajas abiertas…" className="py-4" />
        ) : registers.isError ? (
          <p className="text-sm text-foreground">Para cobrar necesitas acceso a la caja (TPV). Pide a la administración que te lo dé o que cobre la mesa.</p>
        ) : open.length === 0 ? (
          <div className="space-y-2 text-sm text-foreground">
            <p>No hay ninguna caja abierta. Abre la caja en el TPV y vuelve aquí para cobrar.</p>
            <Button asChild variant="outline" size="sm"><Link href="/admin/tpv">Abrir la caja</Link></Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rnet-pay-session">Caja</Label>
              <Select value={chosen} onValueChange={setSessionId}>
                <SelectTrigger id="rnet-pay-session" className="w-full min-w-0"><SelectValue placeholder="Elige la caja" /></SelectTrigger>
                <SelectContent>{open.map((r) => <SelectItem key={r.id} value={String(r.openSession!.id)}>{r.name}{r.openSession!.cashierName ? ` · ${r.openSession!.cashierName}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`rnet-pay-m-${i}`}>Pago {payments.length > 1 ? i + 1 : ""}</Label>
                  <Select value={p.method} onValueChange={(v) => setPayments(payments.map((x, j) => (j === i ? { ...x, method: v as PaymentMethod } : x)))}>
                    <SelectTrigger id={`rnet-pay-m-${i}`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`rnet-pay-a-${i}`}>Importe</Label>
                  <Input id={`rnet-pay-a-${i}`} inputMode="decimal" value={p.amount} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                </div>
                <Button variant="ghost" size="icon" aria-label="Quitar este pago" disabled={payments.length === 1} onClick={() => setPayments(payments.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                {p.method === "cash" && (
                  <div className="col-span-3 flex flex-wrap items-center gap-2 text-sm">
                    <Label htmlFor={`rnet-pay-t-${i}`} className="text-muted-foreground">Entrega</Label>
                    <Input id={`rnet-pay-t-${i}`} inputMode="decimal" className="w-28" value={p.tendered} onChange={(e) => setPayments(payments.map((x, j) => (j === i ? { ...x, tendered: e.target.value } : x)))} />
                    {parsed[i].tendered > parsed[i].amount && <span className="text-muted-foreground">Cambio: <strong className="text-foreground">{formatEur(parsed[i].tendered - parsed[i].amount)}</strong></span>}
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Button variant="outline" size="sm" onClick={() => setPayments([...payments, { method: "cash", amount: Math.max(0, round2(total - paidSoFar)).toFixed(2), tendered: "" }])}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Dividir el pago
              </Button>
              <span className="text-muted-foreground">Pendiente: <strong className="tabular-nums text-foreground">{formatEur(round2(total - paidSoFar))}</strong></span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rnet-pay-email">Correo para el ticket (opcional)</Label>
              <Input id="rnet-pay-email" type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5" aria-live="polite">
              {overLimit ? (
                <p role="alert" className="text-sm text-warning">Más de {SIMPLIFIED_INVOICE_LIMIT_EUR} € (IVA incluido): no basta con el ticket, hace falta factura completa. Indica los datos del destinatario.</p>
              ) : (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={wantsInvoice} onChange={(e) => setWantsInvoice(e.target.checked)} className="h-4 w-4 accent-primary" />
                  El cliente quiere factura completa (con NIF)
                </label>
              )}
              {showRecipientForm ? (
                <div className="space-y-1.5" role="group" aria-label="Datos para la factura completa">
                  <Input placeholder="Nombre o razón social" aria-label="Nombre o razón social para la factura" maxLength={256} value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input placeholder="NIF" aria-label="NIF para la factura" maxLength={32} value={recipient.nif} onChange={(e) => setRecipient({ ...recipient, nif: e.target.value })} />
                    <Input placeholder="Código postal" aria-label="Código postal para la factura" maxLength={16} value={recipient.postalCode} onChange={(e) => setRecipient({ ...recipient, postalCode: e.target.value })} />
                  </div>
                  <Input placeholder="Dirección" aria-label="Dirección para la factura" maxLength={512} value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} />
                  <Input placeholder="Población" aria-label="Población para la factura" maxLength={128} value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Se entregará ticket (factura simplificada). Si después pide factura completa, se canjea el ticket.</p>
              )}
            </div>
            {problem && <p className="text-sm text-danger" role="alert">{problem}</p>}
            {!problem && documentProblem && showRecipientForm && <p className="text-sm text-danger" role="alert">{documentProblem}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!chosen || !!problem || !!documentProblem || checkout.isPending}
            onClick={() =>
              checkout.mutate({
                orderId,
                sessionId: Number(chosen),
                payments: parsed.map((p) => ({ method: p.method, amount: p.amount, ...(p.method === "cash" && p.tendered > 0 ? { amountTendered: p.tendered } : {}) })),
                ...(customerName ? { customerName } : {}),
                ...(email.trim() ? { customerEmail: email.trim() } : {}),
                ...(saleDocument.kind === "factura" ? { invoiceRecipient: saleDocument.recipient } : {}),
              })
            }
          >
            {checkout.isPending ? "Cobrando…" : "Cobrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ticket de la venta del TPV (el mismo componente que la pantalla de caja). */
function SaleTicket({ saleId, onClose }: { saleId: number; onClose: () => void }) {
  const sale = trpc.tpv.getSale.useQuery({ saleId }, { retry: false });
  useEffect(() => {
    if (!sale.isError) return;
    toast.info("Cobro registrado. El ticket se consulta en el TPV.");
    onClose();
  }, [sale.isError]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sale.data?.sale) return null;
  const normalized = { sale: { ...sale.data.sale, items: sale.data.items ?? [], payments: sale.data.payments ?? [] }, invoice: sale.data.invoice ?? null };
  return <TpvTicket open sale={normalized as never} onClose={onClose} />;
}

