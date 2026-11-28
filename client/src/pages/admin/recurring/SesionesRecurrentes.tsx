/**
 * Sesiones recurrentes (/admin/productos/sesiones-recurrentes): ofertas de compra permanente con sesiones semanales (p. ej.
 * MORNING IMPULSE) y las participaciones de quienes han comprado. Aquí se ve qué compras siguen con «Zoom pendiente» y se envían
 * los datos de Zoom cuando el enlace real está configurado. Nunca se inventa un enlace. La autorización la aplica el servidor.
 */
import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { toastError } from "@/lib/errorMessage";
import { usePanelTag, usePanelText } from "@/i18n/usePanelText";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const NOTICE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pendiente", variant: "secondary" },
  sending: { label: "Enviando", variant: "secondary" },
  sent: { label: "Enviado", variant: "default" },
  failed: { label: "Fallido", variant: "destructive" },
};
const ZOOM: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Zoom pendiente", variant: "secondary" },
  sending: { label: "Enviando", variant: "secondary" },
  sent: { label: "Enviado", variant: "default" },
  failed: { label: "Fallido", variant: "destructive" },
};

type OfferForm = { id?: number; productId: number; variantId: number; title: string; weekday: number; startTime: string; timezone: string; timezoneConfirmed: boolean; durationMinutes: number; sessionsCount: number; leadMinutes: number; zoomUrl: string; active: boolean };
const EMPTY: OfferForm = { productId: 0, variantId: 0, title: "", weekday: 1, startTime: "07:30", timezone: "Europe/Madrid", timezoneConfirmed: false, durationMinutes: 30, sessionsCount: 4, leadMinutes: 60, zoomUrl: "", active: false };

function Participations() {
  const px = usePanelText();
  const tag = usePanelTag();
  const utils = trpc.useUtils();
  const summary = trpc.recurringSessions.summary.useQuery(undefined, { retry: false });
  const offers = trpc.recurringSessions.offers.useQuery(undefined, { retry: false });
  const [onlyZoom, setOnlyZoom] = useState(false);
  const list = trpc.recurringSessions.entitlements.useQuery({ zoomPending: onlyZoom || undefined }, { retry: false });
  const refresh = () => (void utils.recurringSessions.entitlements.invalidate(), void utils.recurringSessions.summary.invalidate());
  const fmt = (ms: number | null | undefined, tz?: string) => (ms ? new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(ms)) : "—");
  const retry = trpc.recurringSessions.retryNotice.useMutation({ onSuccess: (r) => (r.result === "sent" ? toast.success(px("Aviso enviado")) : toast.error(px("El aviso no salió: revisa el motivo")), refresh()), onError: (e) => toastError(e) });
  const zoom = trpc.recurringSessions.sendZoom.useMutation({
    onSuccess: (r) => (r.result === "sent" ? toast.success(px("Datos de Zoom enviados")) : r.result === "no_link" ? toast.error(px("Configura primero el enlace de Zoom de la oferta")) : toast.error(px("No se enviaron los datos de Zoom")), refresh()),
    onError: (e) => toastError(e),
  });
  const zoomAll = trpc.recurringSessions.sendZoomToPending.useMutation({ onSuccess: (r) => (toast.success(`${px("Enviados")}: ${r.sent} · ${px("Fallidos")}: ${r.failed}`), refresh()), onError: (e) => toastError(e) });
  const s = summary.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          [px("Participaciones activas"), s?.total],
          [px("Zoom pendiente"), s?.zoomPending],
          [px("Avisos fallidos"), s?.noticeFailed],
        ].map(([l, v]) => (
          <Card key={String(l)}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{v ?? "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyZoom} onCheckedChange={setOnlyZoom} />{px("Solo con Zoom pendiente")}</label>
        {(offers.data ?? []).filter((o) => o.active && o.zoomUrl).map((o) => (
          <Button key={o.id} size="sm" variant="outline" disabled={zoomAll.isPending} onClick={() => zoomAll.mutate({ offerId: o.id })}>{px("Enviar Zoom a las pendientes")} · {o.title || o.productTitle}</Button>
        ))}
      </div>
      {list.isLoading ? <PanelLoading /> : list.error ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : !list.data?.length ? (
        <PanelEmpty icon={<CalendarClock className="h-5 w-5" />} title={px("Sin participaciones")} description={px("Cuando alguien compre una oferta de sesiones recurrentes, aparecerá aquí con sus fechas.")} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{px("Persona")}</TableHead><TableHead>{px("Plazas")}</TableHead><TableHead>{px("Primera sesión")}</TableHead><TableHead>{px("Aviso")}</TableHead><TableHead>Zoom</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><div className="font-medium">{e.customerName || "—"}</div><div className="text-xs text-muted-foreground">{e.customerEmail}</div></TableCell>
                    <TableCell>{e.seats}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(e.firstSessionAt, e.timezone)}<div className="text-xs text-muted-foreground">{e.timezone}</div></TableCell>
                    <TableCell>
                      <Badge variant={(NOTICE[e.noticeStatus] ?? NOTICE.pending).variant}>{px((NOTICE[e.noticeStatus] ?? NOTICE.pending).label)}</Badge>
                      {e.noticeError && <div className="mt-1 max-w-[220px] text-xs text-destructive">{e.noticeError}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={(ZOOM[e.zoomStatus] ?? ZOOM.pending).variant}>{px((ZOOM[e.zoomStatus] ?? ZOOM.pending).label)}</Badge>
                      {e.zoomError && <div className="mt-1 max-w-[220px] text-xs text-destructive">{e.zoomError}</div>}
                    </TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      {e.noticeStatus === "failed" && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: e.id })}>{px("Reintentar aviso")}</Button>}
                      {e.noticeStatus === "sent" && e.zoomStatus !== "sent" && <Button size="sm" variant="outline" disabled={zoom.isPending} onClick={() => zoom.mutate({ id: e.id })}>{px("Enviar Zoom")}</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OfferEditor({ initial, onDone }: { initial: OfferForm; onDone: () => void }) {
  const px = usePanelText();
  const utils = trpc.useUtils();
  const products = trpc.products.getAll.useQuery(undefined, { retry: false });
  const [f, setF] = useState<OfferForm>(initial);
  useEffect(() => setF(initial), [initial]);
  const save = trpc.recurringSessions.saveOffer.useMutation({
    onSuccess: () => (toast.success(px("Oferta guardada")), void utils.recurringSessions.invalidate(), onDone()),
    onError: (e) => toastError(e),
  });
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Producto")}</span>
            <select className={selectClass} value={f.productId} disabled={!!f.id} onChange={(e) => set("productId", Number(e.target.value))}>
              <option value={0}>{px("Elige un producto")}</option>
              {(products.data ?? []).map((p: { id: number; title: string }) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Variante (0 = todas)")}</span><Input type="number" min={0} value={f.variantId} disabled={!!f.id} onChange={(e) => set("variantId", num(e.target.value))} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Nombre en los avisos (opcional)")}</span><Input value={f.title} maxLength={160} onChange={(e) => set("title", e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Día de la semana")}</span>
            <select className={selectClass} value={f.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{px(d)}</option>)}</select>
          </label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Hora de inicio")}</span><Input value={f.startTime} placeholder="07:30" maxLength={5} onChange={(e) => set("startTime", e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Zona horaria")}</span><Input value={f.timezone} onChange={(e) => set("timezone", e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Duración (minutos)")}</span><Input type="number" min={5} value={f.durationMinutes} onChange={(e) => set("durationMinutes", num(e.target.value))} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Sesiones por compra")}</span><Input type="number" min={1} max={52} value={f.sessionsCount} onChange={(e) => set("sessionsCount", num(e.target.value))} /></label>
          <label className="space-y-1 text-sm"><span className="text-muted-foreground">{px("Antelación mínima (minutos)")}</span><Input type="number" min={0} value={f.leadMinutes} onChange={(e) => set("leadMinutes", num(e.target.value))} /></label>
          <label className="space-y-1 text-sm sm:col-span-2"><span className="text-muted-foreground">{px("Enlace de Zoom (solo https; déjalo vacío si aún no existe)")}</span><Input value={f.zoomUrl} placeholder="https://" onChange={(e) => set("zoomUrl", e.target.value)} /></label>
        </div>
        <label className="flex items-center justify-between gap-3"><span><span className="font-medium text-foreground">{px("Zona horaria confirmada")}</span><span className="block text-sm text-muted-foreground">{px("Márcalo cuando la titular haya validado la zona horaria de la hora de inicio.")}</span></span><Switch checked={f.timezoneConfirmed} onCheckedChange={(v) => set("timezoneConfirmed", v)} /></label>
        <label className="flex items-center justify-between gap-3"><span><span className="font-medium text-foreground">{px("Oferta activa")}</span><span className="block text-sm text-muted-foreground">{px("Con la oferta activa, cada compra pagada genera su participación y su aviso.")}</span></span><Switch checked={f.active} onCheckedChange={(v) => set("active", v)} /></label>
        {f.active && !f.zoomUrl && <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">{px("Sin enlace de Zoom: los avisos dirán que los datos de acceso llegarán más tarde y las compras quedarán como «Zoom pendiente».")}</p>}
        {f.active && !f.timezoneConfirmed && <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">{px("La zona horaria todavía no está confirmada por la titular.")}</p>}
        <div className="flex gap-2">
          <Button disabled={save.isPending || f.productId < 1} onClick={() => save.mutate({ productId: f.productId, variantId: f.variantId, title: f.title, weekday: f.weekday, startTime: f.startTime, timezone: f.timezone, timezoneConfirmed: f.timezoneConfirmed, durationMinutes: f.durationMinutes, sessionsCount: f.sessionsCount, leadMinutes: f.leadMinutes, zoomUrl: f.zoomUrl.trim() || null, active: f.active })}>{px("Guardar oferta")}</Button>
          <Button variant="outline" onClick={onDone}>{px("Cancelar")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Offers() {
  const px = usePanelText();
  const offers = trpc.recurringSessions.offers.useQuery(undefined, { retry: false });
  const [editing, setEditing] = useState<OfferForm | null>(null);
  if (offers.isLoading) return <PanelLoading />;
  if (offers.error) return <PanelError error={offers.error} onRetry={() => offers.refetch()} />;
  return (
    <div className="space-y-4">
      {editing ? <OfferEditor initial={editing} onDone={() => setEditing(null)} /> : <Button onClick={() => setEditing({ ...EMPTY })}>{px("Nueva oferta")}</Button>}
      {(offers.data ?? []).map((o) => (
        <Card key={o.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div>
              <div className="font-medium text-foreground">{o.title || o.productTitle}</div>
              <div className="text-muted-foreground">{px(WEEKDAYS[o.weekday - 1] ?? "")} {o.startTime} · {o.timezone} · {o.durationMinutes} min · {o.sessionsCount} {px("sesiones por compra")}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant={o.active ? "default" : "outline"}>{o.active ? px("Activa") : px("Inactiva")}</Badge>
                <Badge variant={o.timezoneConfirmed ? "default" : "secondary"}>{o.timezoneConfirmed ? px("Zona horaria confirmada") : px("Zona horaria sin confirmar")}</Badge>
                <Badge variant={o.zoomUrl ? "default" : "secondary"}>{o.zoomUrl ? px("Zoom configurado") : px("Zoom pendiente")}</Badge>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing({ id: o.id, productId: o.productId, variantId: o.variantId, title: o.title, weekday: o.weekday, startTime: o.startTime, timezone: o.timezone, timezoneConfirmed: o.timezoneConfirmed, durationMinutes: o.durationMinutes, sessionsCount: o.sessionsCount, leadMinutes: o.leadMinutes, zoomUrl: o.zoomUrl ?? "", active: o.active })}>{px("Editar")}</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SesionesRecurrentes() {
  const px = usePanelText();
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PanelPageHeader icon={<CalendarClock />} title={px("Sesiones recurrentes")} description={px("Ofertas de compra permanente con sesiones semanales y las participaciones de quienes las compran. Telegram no se automatiza: las invitaciones las envía la titular.")} />
        <Tabs defaultValue="participaciones">
          <TabsList>
            <TabsTrigger value="participaciones">{px("Participaciones")}</TabsTrigger>
            <TabsTrigger value="ofertas">{px("Ofertas")}</TabsTrigger>
          </TabsList>
          <TabsContent value="participaciones" className="mt-4"><Participations /></TabsContent>
          <TabsContent value="ofertas" className="mt-4"><Offers /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
