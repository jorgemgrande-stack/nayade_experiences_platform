/**
 * Restaurant Net · Partidas y métricas de cocina (/admin/restaurant-net/cocina/ajustes): partidas (cocina, barra…)
 * con su tiempo objetivo, a qué partida va cada categoría de la carta, semáforo de la pantalla de cocina, métricas de
 * tiempos del día e incidencias. Archivar una partida no borra nada.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Archive, ArrowLeft, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { TONE_BADGE } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { INCIDENT_LABELS, STATION_TONES, STATION_TONE_LABELS, kdsSettingsProblem, type StationTone } from "@shared/restaurantKds";
import { madridToday } from "@shared/restaurantNet";
import { NoRestaurants, PageHeader, RestaurantPicker, useRestaurantChoice, useRestaurantNetWrite } from "./RestaurantNetParts";

const NO_ROUTE = "__plato";
type StationForm = { id?: number; name: string; tone: StationTone; sla: string };

export default function CocinaAjustes() {
  const choice = useRestaurantChoice();
  const { canWrite, isAdmin } = useRestaurantNetWrite();
  const restaurantId = choice.restaurantId;
  const enabled = restaurantId != null;
  const utils = trpc.useUtils();
  const stations = trpc.restaurantNet.listStations.useQuery({ restaurantId: restaurantId!, includeArchived: true }, { enabled });
  const routing = trpc.restaurantNet.listRouting.useQuery({ restaurantId: restaurantId! }, { enabled });
  const menu = trpc.restaurantNet.listMenu.useQuery({ restaurantId: restaurantId! }, { enabled });
  const settings = trpc.restaurantNet.getKdsSettings.useQuery({ restaurantId: restaurantId! }, { enabled });
  const [date, setDate] = useState(madridToday());
  const metrics = trpc.restaurantNet.kitchenMetrics.useQuery({ restaurantId: restaurantId!, date }, { enabled });
  const incidents = trpc.restaurantNet.listIncidents.useQuery({ restaurantId: restaurantId!, date }, { enabled });
  const [form, setForm] = useState<StationForm | null>(null);
  const [green, setGreen] = useState("10");
  const [amber, setAmber] = useState("20");
  useEffect(() => {
    if (settings.data) {
      setGreen(String(settings.data.greenMaxMin));
      setAmber(String(settings.data.amberMaxMin));
    }
  }, [settings.data]);

  const upsert = trpc.restaurantNet.upsertStation.useMutation({
    onSuccess: () => { toast.success("Partida guardada"); setForm(null); utils.restaurantNet.listStations.invalidate(); utils.restaurantNet.listRouting.invalidate(); },
    onError: (e) => toastError(e),
  });
  const setRoute = trpc.restaurantNet.setRouting.useMutation({ onSuccess: () => utils.restaurantNet.listRouting.invalidate(), onError: (e) => toastError(e) });
  const saveSettings = trpc.restaurantNet.setKdsSettings.useMutation({ onSuccess: () => { toast.success("Semáforo guardado"); utils.restaurantNet.getKdsSettings.invalidate(); }, onError: (e) => toastError(e) });

  const active = (stations.data ?? []).filter((s) => s.isActive);
  const archived = (stations.data ?? []).filter((s) => !s.isActive);
  const categories = useMemo(() => Array.from(new Set((menu.data ?? []).map((m) => m.category).filter((c): c is string => !!c))).sort(), [menu.data]);
  const routeOf = new Map((routing.data ?? []).map((r) => [r.category, r.station] as const));

  const saveStation = () => {
    if (!form || !restaurantId) return;
    const sla = Number(form.sla);
    if (!form.name.trim()) return toast.error("Indica el nombre de la partida");
    if (!Number.isInteger(sla) || sla < 1 || sla > 180) return toast.error("El tiempo objetivo debe estar entre 1 y 180 minutos");
    upsert.mutate({ id: form.id, restaurantId, name: form.name, tone: form.tone, slaMinutes: sla });
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Partidas y métricas de cocina"
          description="Reparte los platos entre las pantallas de cocina, ajusta el semáforo y revisa los tiempos y las incidencias del día."
          actions={
            <>
              <RestaurantPicker choice={choice} />
              <Button asChild variant="outline" size="sm"><Link href="/admin/restaurant-net/cocina"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Cocina</Link></Button>
            </>
          }
        />
        {choice.list.isLoading ? (
          <PanelLoading label="Cargando los restaurantes…" />
        ) : choice.list.isError ? (
          <PanelError error={choice.list.error} onRetry={() => choice.list.refetch()} />
        ) : restaurantId == null ? (
          <NoRestaurants isAdmin={isAdmin} />
        ) : stations.isError ? (
          <PanelError error={stations.error} onRetry={() => stations.refetch()} />
        ) : (
          <>
            <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="rnet-st-t">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="rnet-st-t" className="text-lg font-bold text-foreground">Partidas</h2>
                {canWrite && <Button size="sm" onClick={() => setForm({ name: "", tone: "neutral", sla: "15" })}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Partida</Button>}
              </div>
              {stations.isLoading ? (
                <PanelLoading className="py-4" />
              ) : active.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin partidas, todos los platos van a la misma pantalla. Crea, por ejemplo, «Cocina» y «Barra».</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {active.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TONE_BADGE[s.tone])}>{s.name}</span>
                        objetivo {s.slaMinutes} min
                      </span>
                      {canWrite && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => setForm({ id: s.id, name: s.name, tone: s.tone, sla: String(s.slaMinutes) })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Archivar ${s.name}`} onClick={() => upsert.mutate({ id: s.id, restaurantId, name: s.name, tone: s.tone, slaMinutes: s.slaMinutes, isActive: false })}><Archive className="h-4 w-4" aria-hidden="true" /></Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {archived.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Archivadas ({archived.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {archived.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{s.name}</span>
                        {canWrite && <Button size="sm" variant="ghost" onClick={() => upsert.mutate({ id: s.id, restaurantId, name: s.name, tone: s.tone, slaMinutes: s.slaMinutes, isActive: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="rnet-rt-t">
              <h2 id="rnet-rt-t" className="text-lg font-bold text-foreground">Qué partida prepara cada categoría</h2>
              <p className="text-sm text-muted-foreground">Se aplica a los platos que se pidan desde ahora. Sin elegir, cada plato va a la partida indicada en la carta.</p>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">La carta aún no tiene categorías.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {categories.map((c) => (
                    <li key={c} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                      <span className="min-w-0 break-words text-sm text-foreground">{c}</span>
                      <Select disabled={!canWrite || active.length === 0} value={routeOf.get(c) ?? NO_ROUTE} onValueChange={(v) => setRoute.mutate({ restaurantId, category: c, station: v === NO_ROUTE ? null : v })}>
                        <SelectTrigger className="w-40 shrink-0" aria-label={`Partida de ${c}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ROUTE}>La del plato</SelectItem>
                          {active.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="rnet-sm-t">
              <h2 id="rnet-sm-t" className="text-lg font-bold text-foreground">Semáforo</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-green">Verde hasta (min)</Label>
                  <Input id="rnet-green" type="number" min={1} max={120} className="w-28" value={green} onChange={(e) => setGreen(e.target.value)} disabled={!canWrite} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-amber">Ámbar hasta (min)</Label>
                  <Input id="rnet-amber" type="number" min={2} max={240} className="w-28" value={amber} onChange={(e) => setAmber(e.target.value)} disabled={!canWrite} />
                </div>
                {canWrite && (
                  <Button
                    disabled={saveSettings.isPending}
                    onClick={() => {
                      const g = Number(green);
                      const a = Number(amber);
                      const p = kdsSettingsProblem(g, a);
                      if (p) return toast.error(p);
                      saveSettings.mutate({ restaurantId, greenMaxMin: g, amberMaxMin: a });
                    }}
                  >
                    Guardar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Después del ámbar, la comanda se ve en rojo.</p>
            </section>

            <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="rnet-mt-t">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="rnet-mt-t" className="text-lg font-bold text-foreground">Tiempos del día</h2>
                <Input type="date" aria-label="Día" className="w-44" value={date} max={madridToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              {metrics.isLoading ? (
                <PanelLoading className="py-4" />
              ) : metrics.isError ? (
                <PanelError error={metrics.error} onRetry={() => metrics.refetch()} />
              ) : metrics.data && metrics.data.totals.lines === 0 ? (
                <p className="text-sm text-muted-foreground">Ese día no se marchó ningún plato.</p>
              ) : metrics.data ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Platos", metrics.data.totals.plates],
                      ["Preparación media", `${metrics.data.totals.avgCookMin.toLocaleString("es-ES")} min`],
                      ["Pase medio", `${metrics.data.totals.avgServeMin.toLocaleString("es-ES")} min`],
                      ["Fuera de tiempo", metrics.data.totals.lateCount],
                      ["Incidencias", metrics.data.totals.incidents],
                    ].map(([k, v]) => (
                      <div key={String(k)} className="rounded-xl border border-border p-3">
                        <dt className="text-xs text-muted-foreground">{k}</dt>
                        <dd className="text-lg font-bold tabular-nums text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="min-w-0">
                      <h3 className="mb-1 text-sm font-semibold text-foreground">Por partida</h3>
                      <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                        {metrics.data.byStation.map((s) => (
                          <li key={s.station} className="flex justify-between gap-2 px-3 py-1.5"><span className="min-w-0 break-words text-foreground">{s.station}</span><span className="shrink-0 tabular-nums text-muted-foreground">{s.plates} platos · {s.avgCookMin.toLocaleString("es-ES")} min · {s.lateCount} tarde</span></li>
                        ))}
                      </ul>
                    </div>
                    <div className="min-w-0">
                      <h3 className="mb-1 text-sm font-semibold text-foreground">Platos más lentos</h3>
                      <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                        {metrics.data.slowest.map((s) => (
                          <li key={s.name} className="flex justify-between gap-2 px-3 py-1.5"><span className="min-w-0 break-words text-foreground">{s.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{s.avgCookMin.toLocaleString("es-ES")} min</span></li>
                        ))}
                        {metrics.data.slowest.length === 0 && <li className="px-3 py-1.5 text-muted-foreground">Aún ningún plato terminado.</li>}
                      </ul>
                    </div>
                  </div>
                </>
              ) : null}
              <div className="min-w-0">
                <h3 className="mb-1 text-sm font-semibold text-foreground">Incidencias</h3>
                {(incidents.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin incidencias ese día.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {(incidents.data ?? []).map((i) => (
                      <li key={i.id} className="px-3 py-1.5">
                        <span className="text-foreground">{new Date(i.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })} · {INCIDENT_LABELS[i.type] ?? i.type}</span>
                        <span className="text-muted-foreground"> · {i.tableCode ? `mesa ${i.tableCode}` : `comanda ${i.orderId}`}{i.itemName ? ` · ${i.itemName}` : ""}{i.reason ? ` · ${i.reason}` : ""}{i.byName ? ` · ${i.byName}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar partida" : "Nueva partida"}</DialogTitle>
            <DialogDescription>Al renombrarla, la carta y el enrutado la siguen.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rnet-st-name">Nombre</Label>
                <Input id="rnet-st-name" maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-st-sla">Objetivo (min)</Label>
                  <Input id="rnet-st-sla" type="number" min={1} max={180} value={form.sla} onChange={(e) => setForm({ ...form, sla: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-st-tone">Color</Label>
                  <Select value={form.tone} onValueChange={(v) => setForm({ ...form, tone: v as StationTone })}>
                    <SelectTrigger id="rnet-st-tone" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATION_TONES.map((t) => <SelectItem key={t} value={t}>{STATION_TONE_LABELS[t]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={upsert.isPending} onClick={saveStation}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
