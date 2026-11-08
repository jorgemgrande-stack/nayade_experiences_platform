/**
 * Hotel Net · Canales iCal: exportación (enlace secreto por tipología o habitación y canal) e importación (URL iCal de
 * cada canal) de la disponibilidad, con el estado de cada sincronización. El «Channel Manager» mínimo que aceptan
 * Booking, Airbnb, Vrbo y Google. Incluido en Hotel Net, sin extensión de pago.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarDays, Copy, Link2, Plus, RefreshCw } from "lucide-react";
import { EmptyStep, PmsNotInstalled, isPmsNotInstalled, shortDate } from "./pmsShared";

type Kind = "room_type" | "room";
type Channel = "booking" | "airbnb" | "vrbo" | "google" | "otro";
const CHANNEL_LABEL: Record<Channel, string> = { booking: "Booking.com", airbnb: "Airbnb", vrbo: "Vrbo", google: "Google", otro: "Otro canal" };
const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");

function syncToast(r: { ok: boolean; error?: string; added?: number; updated?: number; cancelled?: number } | null | undefined) {
  if (!r) return;
  if (r.ok) toast.success(`Sincronizado: ${r.added ?? 0} nuevos, ${r.updated ?? 0} cambiados, ${r.cancelled ?? 0} cancelados`);
  else toast.error(r.error ?? "No se ha podido sincronizar");
}

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <Input readOnly value={value} className="font-mono text-xs min-w-0" onFocus={(e) => e.currentTarget.select()} />
      <Button type="button" size="icon" variant="outline" aria-label="Copiar URL" onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.success("URL copiada"), () => toast.error("No se ha podido copiar"))}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Destination({ kind, id, name, data }: { kind: Kind; id: number; name: string; data: any }) {
  const utils = trpc.useUtils();
  const refresh = () => void utils.hotel.adminIcalPanel.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);
  const issue = trpc.hotel.adminIcalIssueExport.useMutation({ onSuccess: () => { toast.success("Enlace listo: pégalo en el canal"); refresh(); }, onError });
  const revoke = trpc.hotel.adminIcalRevokeExport.useMutation({ onSuccess: () => { toast.success("Enlace revocado"); refresh(); }, onError });
  const add = trpc.hotel.adminIcalAddFeed.useMutation({ onSuccess: (r) => { syncToast(r.sync); setUrl(""); setLabel(""); refresh(); }, onError });
  const status = trpc.hotel.adminIcalSetFeedStatus.useMutation({ onSuccess: (r) => { syncToast(r.sync); refresh(); }, onError });
  const sync = trpc.hotel.adminIcalSyncNow.useMutation({ onSuccess: (r) => { syncToast(r[0]); refresh(); }, onError });
  const [exportChannel, setExportChannel] = useState<Channel>("booking");
  const [feedChannel, setFeedChannel] = useState<Channel>("booking");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const exports = (data.exports as any[]).filter((e) => e.targetKind === kind && e.targetId === id);
  const feeds = (data.feeds as any[]).filter((f) => f.targetKind === kind && f.targetId === id);
  const free = CHANNELS.filter((c) => !exports.some((e) => e.channel === c));

  return (
    <div className="rounded-lg border border-border p-3 space-y-4 min-w-0">
      <div className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">{name}</div>

      <div className="space-y-2">
        <div className="text-sm font-medium flex items-center gap-1"><Link2 className="h-4 w-4" /> Exportar a los canales</div>
        {exports.length === 0 && <p className="text-xs text-muted-foreground">Sin enlaces. Crea uno por canal y pégalo en su apartado de «Importar calendario».</p>}
        {exports.map((e) => (
          <div key={e.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{CHANNEL_LABEL[e.channel as Channel]}</Badge>
              <span className="text-muted-foreground">{e.fetchCount} consultas · última {when(e.lastFetchedAt)}</span>
            </div>
            {e.url ? <CopyField value={e.url} /> : <p className="text-xs text-amber-700 dark:text-amber-400">La clave del servidor ha cambiado: rota el enlace y vuelve a pegarlo en el canal.</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => { if (confirm("El enlace actual dejará de funcionar y tendrás que pegar el nuevo en el canal. ¿Rotar?")) issue.mutate({ targetKind: kind, targetId: id, channel: e.channel }); }}>Rotar</Button>
              <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => { if (confirm("El canal dejará de recibir la disponibilidad. ¿Revocar el enlace?")) revoke.mutate({ id: e.id }); }}>Revocar</Button>
            </div>
          </div>
        ))}
        {free.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={free.includes(exportChannel) ? exportChannel : free[0]} onValueChange={(v) => setExportChannel(v as Channel)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{free.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate({ targetKind: kind, targetId: id, channel: free.includes(exportChannel) ? exportChannel : free[0] })}><Plus className="h-4 w-4 mr-1" /> Crear enlace</Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Importar de los canales</div>
        {feeds.length === 0 && <p className="text-xs text-muted-foreground">Sin URLs. Copia la URL de «Exportar calendario» del canal y pégala aquí.</p>}
        {feeds.map((f) => (
          <div key={f.id} className={`rounded-md border border-border p-2 space-y-1 ${f.status === "paused" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{CHANNEL_LABEL[f.channel as Channel]}</Badge>
              {f.label && <span className="font-medium">{f.label}</span>}
              {f.status === "paused" ? <Badge variant="secondary">En pausa</Badge> : f.lastStatus === "error" ? <Badge variant="destructive">Error</Badge> : f.lastStatus === "ok" ? <Badge className="bg-emerald-600 text-white dark:bg-emerald-700">Al día</Badge> : <Badge variant="secondary">Pendiente</Badge>}
            </div>
            <div className="text-xs text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap">{f.url}</div>
            <div className="text-xs text-muted-foreground">
              Última sincronización correcta: {when(f.lastSuccessAt)} · {f.upcoming} bloqueo{f.upcoming === 1 ? "" : "s"} próximo{f.upcoming === 1 ? "" : "s"}{f.nextStart ? ` (desde ${shortDate(f.nextStart)})` : ""}
              {f.lastStatus === "ok" && ` · último cambio: ${f.lastAdded} nuevos, ${f.lastUpdated} cambiados, ${f.lastCancelled} cancelados`}
            </div>
            {f.lastStatus === "error" && f.lastError && <p className="text-xs text-red-700 dark:text-red-400">{f.lastError}{f.consecutiveFailures > 1 ? ` (${f.consecutiveFailures} intentos seguidos; se conservan los bloqueos anteriores)` : ""}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={sync.isPending || f.status !== "active"} onClick={() => sync.mutate({ feedId: f.id })}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Sincronizar ahora</Button>
              <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => status.mutate({ id: f.id, status: f.status === "paused" ? "active" : "paused" })}>{f.status === "paused" ? "Reanudar" : "Pausar"}</Button>
              <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => { if (confirm("Se quitan sus bloqueos y deja de sincronizarse. ¿Archivar la URL?")) status.mutate({ id: f.id, status: "archived" }); }}>Archivar</Button>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2">
          <Select value={feedChannel} onValueChange={(v) => setFeedChannel(v as Channel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={url} maxLength={2000} placeholder="https://… (URL iCal del canal)" onChange={(e) => setUrl(e.target.value)} />
          <Input value={label} maxLength={120} placeholder="Nombre (opcional), p. ej. «Anuncio doble»" onChange={(e) => setLabel(e.target.value)} className="sm:col-start-2" />
        </div>
        <Button size="sm" disabled={add.isPending || !url.trim()} onClick={() => add.mutate({ targetKind: kind, targetId: id, channel: feedChannel, url: url.trim(), label: label.trim() || null })}>
          <Plus className="h-4 w-4 mr-1" /> {add.isPending ? "Añadiendo y sincronizando…" : "Añadir URL"}
        </Button>
      </div>
    </div>
  );
}

export default function HotelIcal() {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminIcalPanel.useQuery(undefined, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const auto = trpc.hotel.adminIcalSetAutoSync.useMutation({ onSuccess: () => void utils.hotel.adminIcalPanel.invalidate(), onError: (e) => toast.error(e.message) });
  const syncAll = trpc.hotel.adminIcalSyncNow.useMutation({
    onSuccess: (r) => {
      const bad = r.filter((x) => !x.ok).length;
      if (!r.length) toast.info("No hay URLs activas que sincronizar");
      else if (bad) toast.error(`${r.length - bad} sincronizadas, ${bad} con error (detalle en cada URL)`);
      else toast.success(`${r.length} URL${r.length === 1 ? "" : "s"} sincronizada${r.length === 1 ? "" : "s"}`);
      void utils.hotel.adminIcalPanel.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const data = q.data;
  const feedName = (id: number) => {
    const f = data?.feeds.find((x: any) => x.id === id);
    if (!f) return "";
    const target = f.targetKind === "room_type" ? data?.types.find((t: any) => t.id === f.targetId)?.name : data?.rooms.find((r: any) => r.id === f.targetId)?.code;
    return `${CHANNEL_LABEL[f.channel as Channel]} · ${target ?? ""}`;
  };

  return (
    <AdminLayout title="Canales iCal">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="h-6 w-6 shrink-0" /> Canales iCal</h1>
          <p className="text-muted-foreground text-sm">
            Sincroniza la disponibilidad con Booking.com, Airbnb, Vrbo, Google y cualquier calendario que acepte iCal. Exporta un enlace por tipología o habitación y canal
            (solo dice «No disponible», nunca datos del huésped) e importa la URL iCal de cada canal: lo vendido allí bloquea la disponibilidad aquí, sin tocar tus reservas.
            iCal sincroniza disponibilidad, no tarifas, y los canales lo leen cada cierto tiempo (de minutos a horas).
          </p>
        </div>
        {isPmsNotInstalled(q.error) ? <PmsNotInstalled /> : q.error ? (
          <Card><CardContent className="p-6 text-sm text-red-700 dark:text-red-400">{q.error.message}</CardContent></Card>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : data.types.length === 0 ? (
          <Card><CardContent className="p-0"><EmptyStep title="Crea primero una tipología" text="Los calendarios iCal son de cada tipología o habitación." href="/admin/hotel" action="Ir a tipologías" /></CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm min-w-0">
                  <Switch checked={data.autoSync} disabled={auto.isPending} onCheckedChange={(v) => auto.mutate({ enabled: v })} />
                  <span>Sincronización automática cada {data.syncEveryMinutes} minutos{data.autoSync ? "" : " (apagada)"}</span>
                </label>
                <Button variant="outline" disabled={syncAll.isPending || !data.feeds.some((f: any) => f.status === "active")} onClick={() => syncAll.mutate({ feedId: null })}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncAll.isPending ? "animate-spin" : ""}`} /> Sincronizar todo ahora
                </Button>
              </CardContent>
            </Card>

            {data.types.map((t: any) => {
              const rooms = data.rooms.filter((r: any) => r.roomTypeId === t.id);
              return (
                <Card key={t.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t.name} <span className="text-xs font-normal text-muted-foreground">· {t.totalUnits} unidad{t.totalUnits === 1 ? "" : "es"}{t.isActive ? "" : " · inactiva"}</span></CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Label className="text-xs text-muted-foreground">Tipología completa: se exporta «No disponible» cuando no queda ninguna unidad libre.</Label>
                    <Destination kind="room_type" id={t.id} name={`${t.name} (tipología)`} data={data} />
                    {rooms.length > 0 && (
                      <details className="rounded-lg border border-dashed border-border p-3">
                        <summary className="cursor-pointer text-sm font-medium">Por habitación ({rooms.length}) · para anunciar cada unidad por separado</summary>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
                          {rooms.map((r: any) => <Destination key={r.id} kind="room" id={r.id} name={`Habitación ${r.code}${r.name ? ` · ${r.name}` : ""}`} data={data} />)}
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Próximos bloqueos importados</CardTitle></CardHeader>
              <CardContent>
                {data.blocks.length === 0 ? <p className="text-sm text-muted-foreground">Ningún canal ha bloqueado fechas próximas.</p> : (
                  <ul className="divide-y divide-border text-sm">
                    {data.blocks.map((b: any, i: number) => (
                      <li key={i} className="py-1.5 flex flex-wrap justify-between gap-2"><span>{shortDate(b.start)} → {shortDate(b.end)}</span><span className="text-muted-foreground">{feedName(b.feedId)}</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
