/**
 * Restaurant Net · Cocina (KDS) (/admin/restaurant-net/cocina): comandas marchadas por partida, con el estado de cada
 * línea (pendiente → en preparación → lista → servida), semáforo por minutos desde la marcha y deshacer un paso. Las
 * incidencias (agotado, devuelto, rehacer…) se registran desde la línea. Se refresca sola cada pocos segundos (sin
 * conexiones abiertas). Ajustes, partidas y métricas: /admin/restaurant-net/cocina/ajustes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChefHat, Flame, Settings2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { TONE_BADGE, TONE_SURFACE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { INCIDENT_LABELS, INCIDENT_TYPES, KITCHEN_STATUS_LABELS, elapsedMin, trafficLight, type IncidentType, type KitchenStatus, type Light } from "@shared/restaurantKds";
import { CONFIG_PATH, NoRestaurants, PageHeader, RestaurantPicker, SALA_PATH, useRestaurantChoice, useRestaurantNetWrite } from "./RestaurantNetParts";

export const COCINA_PATH = "/admin/restaurant-net/cocina";
export const COCINA_AJUSTES_PATH = "/admin/restaurant-net/cocina/ajustes";
const ALL = "__todas";
const NONE = "__sin";
const LIGHT_TONE: Record<Light, Tone> = { green: "success", amber: "warning", red: "danger" };
const LIGHT_LABEL: Record<Light, string> = { green: "A tiempo", amber: "Se retrasa", red: "Retrasada" };
const NEXT: Record<string, { to: KitchenStatus; label: string } | null> = {
  sent: { to: "preparing", label: "Empezar" },
  preparing: { to: "ready", label: "Lista" },
  ready: { to: "served", label: "Servida" },
};
const PREV: Record<string, KitchenStatus | null> = { sent: null, preparing: "sent", ready: "preparing" };
const STATUS_TONE: Record<string, Tone> = { sent: "neutral", preparing: "warning", ready: "success" };

export default function Cocina() {
  const choice = useRestaurantChoice();
  const { canWrite, isAdmin } = useRestaurantNetWrite();
  const restaurantId = choice.restaurantId;
  const [station, setStation] = useState(ALL);
  const stationArg = station === ALL ? null : station === NONE ? "" : station;
  const board = trpc.restaurantNet.kdsBoard.useQuery({ restaurantId: restaurantId!, station: stationArg }, { enabled: restaurantId != null, refetchInterval: 8_000 });
  const utils = trpc.useUtils();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  // Hora del servidor como referencia (relojes de tablet desajustados)
  const skew = board.data ? board.data.now - board.dataUpdatedAt : 0;
  const now = clock + skew;
  const [incident, setIncident] = useState<{ orderId: number; itemId: number; name: string } | null>(null);
  const [incType, setIncType] = useState<IncidentType>("kitchen_error");
  const [incReason, setIncReason] = useState("");

  const refresh = () => utils.restaurantNet.kdsBoard.invalidate();
  const setStatus = trpc.restaurantNet.setKitchenStatus.useMutation({ onSuccess: refresh, onError: (e) => { toastError(e); refresh(); } });
  const serve = trpc.restaurantNet.serveReady.useMutation({ onSuccess: (r) => { toast.success(`${r.served} servidas`); refresh(); }, onError: (e) => toastError(e) });
  const createIncident = trpc.restaurantNet.createIncident.useMutation({ onSuccess: () => { toast.success("Incidencia registrada"); setIncident(null); }, onError: (e) => toastError(e) });

  const lines = board.data?.lines ?? [];
  const settings = board.data?.settings ?? { greenMaxMin: 10, amberMaxMin: 20 };
  const orders = useMemo(() => {
    const g = new Map<number, typeof lines>();
    for (const l of lines) g.set(l.orderId, [...(g.get(l.orderId) ?? []), l]);
    return Array.from(g.values());
  }, [lines]);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Cocina"
          description="Platos marchados desde la sala, de la comanda más antigua a la más reciente. El color avisa del tiempo desde que se marchó."
          actions={
            <>
              <RestaurantPicker choice={choice} />
              <Button asChild variant="outline" size="sm"><Link href={COCINA_AJUSTES_PATH}><Settings2 className="mr-1 h-4 w-4" aria-hidden="true" />Partidas y métricas</Link></Button>
            </>
          }
        />

        {choice.list.isLoading ? (
          <PanelLoading label="Cargando los restaurantes…" />
        ) : choice.list.isError ? (
          <PanelError error={choice.list.error} onRetry={() => choice.list.refetch()} />
        ) : restaurantId == null ? (
          <NoRestaurants isAdmin={isAdmin} />
        ) : board.isLoading ? (
          <PanelLoading label="Cargando la cocina…" />
        ) : board.isError ? (
          <PanelError error={board.error} onRetry={() => board.refetch()} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Partidas">
                {[{ k: ALL, l: "Todas" }, ...(board.data?.stations ?? []).map((s) => ({ k: s.name, l: s.name })), { k: NONE, l: "Sin partida" }].map((s) => (
                  <button
                    key={s.k}
                    type="button"
                    role="tab"
                    aria-selected={station === s.k}
                    onClick={() => setStation(s.k)}
                    className={cn("shrink-0 rounded-full border px-3 py-1 text-sm", station === s.k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}
                  >
                    {s.l}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Verde hasta {settings.greenMaxMin} min · ámbar hasta {settings.amberMaxMin} min · {lines.length} líneas</p>
            </div>

            {orders.length === 0 ? (
              <PanelEmpty icon={<ChefHat className="h-5 w-5" />} title="No hay nada en cocina" description="Cuando la sala marche platos de una comanda, aparecerán aquí por orden de llegada.">
                <Button asChild variant="outline"><Link href={SALA_PATH}>Ir a la sala</Link></Button>
                {(board.data?.stations ?? []).length === 0 && <Button asChild variant="outline"><Link href={COCINA_AJUSTES_PATH}>Crear partidas</Link></Button>}
              </PanelEmpty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {orders.map((ls) => {
                  const head = ls[0];
                  const oldest = Math.min(...ls.filter((l) => l.status !== "ready").map((l) => l.firedAt ?? now), now);
                  const light = trafficLight(oldest, now, settings);
                  const allReady = ls.every((l) => l.status === "ready");
                  return (
                    <article key={head.orderId} className={cn("flex min-w-0 flex-col rounded-2xl border-2 bg-card", TONE_SURFACE[allReady ? "success" : LIGHT_TONE[light]])} aria-label={`Mesa ${head.tableCode ?? head.orderId}`}>
                      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-lg font-bold text-foreground">
                            {head.tableCode ? `Mesa ${head.tableCode}` : `Comanda ${head.orderId}`}
                            {head.priority === "high" && <Flame className="ml-1 inline h-4 w-4 text-danger" aria-label="Prioridad alta" />}
                          </p>
                          <p className="text-xs text-muted-foreground">{head.guests} comensales{head.waiterName ? ` · ${head.waiterName}` : ""}</p>
                        </div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", TONE_BADGE[allReady ? "success" : LIGHT_TONE[light]])}>
                          {allReady ? "Lista" : `${LIGHT_LABEL[light]} · ${elapsedMin(oldest, now)} min`}
                        </span>
                      </header>
                      <ul className="flex-1 divide-y divide-border">
                        {ls.map((l) => {
                          const next = NEXT[l.status];
                          const prev = PREV[l.status];
                          return (
                            <li key={l.id} className="space-y-1.5 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 break-words text-sm text-foreground">
                                  <strong className="tabular-nums">{l.quantity}×</strong> {l.name}
                                  {l.course > 1 && <span className="text-xs text-muted-foreground"> · pase {l.course}</span>}
                                  {l.seat != null && <span className="text-xs text-muted-foreground"> · comensal {l.seat}</span>}
                                </p>
                                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px]", TONE_BADGE[STATUS_TONE[l.status] ?? "neutral"])}>{KITCHEN_STATUS_LABELS[l.status]}</span>
                              </div>
                              {l.notes && <p className="break-words text-xs font-medium text-warning">{l.notes}</p>}
                              <p className="text-[11px] text-muted-foreground">{l.station ?? "Sin partida"} · {elapsedMin(l.firedAt, now)} min</p>
                              {canWrite && (
                                <div className="flex flex-wrap gap-1.5">
                                  {next && <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ itemId: l.id, status: next.to })}>{next.label}</Button>}
                                  {prev && <Button size="sm" variant="ghost" aria-label={`Deshacer ${l.name}`} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ itemId: l.id, status: prev })}><Undo2 className="h-4 w-4" aria-hidden="true" /></Button>}
                                  <Button size="sm" variant="ghost" aria-label={`Incidencia en ${l.name}`} onClick={() => { setIncType("kitchen_error"); setIncReason(""); setIncident({ orderId: l.orderId, itemId: l.id, name: l.name }); }}>
                                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {canWrite && ls.some((l) => l.status === "ready") && (
                        <div className="border-t border-border p-2">
                          <Button size="sm" variant="outline" className="w-full" disabled={serve.isPending} onClick={() => serve.mutate({ orderId: head.orderId })}>Servir las listas</Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {(board.data?.stations ?? []).length === 0 && orders.length > 0 && (
              <p className="text-xs text-muted-foreground">Consejo: crea partidas (cocina, barra…) en <Link href={COCINA_AJUSTES_PATH} className="underline">Partidas y métricas</Link> para repartir los platos por pantalla. Las mesas se configuran en <Link href={CONFIG_PATH} className="underline">Salas y mesas</Link>.</p>
            )}
          </>
        )}
      </div>

      <Dialog open={incident != null} onOpenChange={(o) => !o && setIncident(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Incidencia en «{incident?.name}»</DialogTitle>
            <DialogDescription>Queda registrada en las métricas del día. Si el plato no se sirve, la sala debe anular la línea con su motivo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rnet-inc-type">Tipo</Label>
              <Select value={incType} onValueChange={(v) => setIncType(v as IncidentType)}>
                <SelectTrigger id="rnet-inc-type"><SelectValue /></SelectTrigger>
                <SelectContent>{INCIDENT_TYPES.map((x) => <SelectItem key={x} value={x}>{INCIDENT_LABELS[x]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rnet-inc-reason">Detalle (opcional)</Label>
              <Textarea id="rnet-inc-reason" rows={2} maxLength={255} value={incReason} onChange={(e) => setIncReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncident(null)}>Cancelar</Button>
            <Button disabled={createIncident.isPending} onClick={() => createIncident.mutate({ orderId: incident!.orderId, itemId: incident!.itemId, type: incType, reason: incReason || null })}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
