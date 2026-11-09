/**
 * Venta multicanal (/admin/multicanal): canales externos de la empresa (marketplaces, OTA, agencias y canales de
 * entradas) con su comisión, publicación de productos del Core en cada canal, cupo por canal y día, ventas recibidas
 * (informe CSV, enlace de entrada o alta manual) que crean la reserva en el Core, y conciliación de lo vendido, las
 * comisiones y lo que paga cada canal. La autorización real (licencia `multichannel` y administración) la aplica el
 * servidor.
 */
import { useMemo, useState } from "react";
import { Ban, Copy, Download, Link2, Pencil, Plus, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  MC_CHANNEL_KINDS,
  MC_CHANNEL_KIND_LABELS,
  MC_CSV_FIELDS,
  MC_CSV_FIELD_LABELS,
  MC_PROVIDERS,
  MC_PROVIDER_LABELS,
  MC_SALE_STATUS_LABELS,
  MC_TARGET_KIND_LABELS,
  addDays,
  eur,
  todayMadrid,
  type McChannelKind,
  type McCsvField,
  type McProvider,
  type McSaleStatus,
  type McTargetKind,
} from "@shared/multichannel";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const STATUS_VARIANT: Record<McSaleStatus, "default" | "secondary" | "destructive" | "outline"> = { registrada: "default", cancelada: "outline", sin_cupo: "destructive", sin_plaza: "destructive", rechazada: "secondary" };
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

function useChannels() {
  return trpc.multichannel.channels.useQuery(undefined, { retry: false });
}

function ChannelSelect({ value, onChange, allowAll }: { value: number | null; onChange: (id: number | null) => void; allowAll?: boolean }) {
  const q = useChannels();
  return (
    <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowAll ? <option value="">Todos los canales</option> : <option value="">Elige un canal…</option>}
      {(q.data ?? []).map((c) => (
        <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (desactivado)"}</option>
      ))}
    </select>
  );
}

// ─── Canales ──────────────────────────────────────────────────────────────────

interface ChannelForm {
  id?: number;
  name: string;
  kind: McChannelKind;
  provider: McProvider;
  commissionPct: string;
  commissionFixed: string;
  settlementDays: string;
  notes: string;
  csvMapping: Partial<Record<McCsvField, string>>;
}
const emptyChannel: ChannelForm = { name: "", kind: "marketplace", provider: "generic", commissionPct: "0", commissionFixed: "0", settlementDays: "", notes: "", csvMapping: {} };
const toNumber = (s: string) => Number(String(s).replace(",", "."));

function Channels() {
  const utils = trpc.useUtils();
  const q = useChannels();
  const [form, setForm] = useState<ChannelForm | null>(null);
  const [link, setLink] = useState<{ name: string; token: string; path: string; availabilityPath: string } | null>(null);
  const refresh = () => utils.multichannel.invalidate();
  const save = trpc.multichannel.upsertChannel.useMutation({ onSuccess: () => (toast.success("Canal guardado"), setForm(null), refresh()), onError: (e) => toastError(e) });
  const active = trpc.multichannel.setChannelActive.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  const rotate = trpc.multichannel.rotateInboundToken.useMutation({ onError: (e) => toastError(e) });
  const revoke = trpc.multichannel.revokeInboundToken.useMutation({ onSuccess: () => (toast.success("Enlace de entrada revocado"), refresh()), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data ?? [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setForm({ ...emptyChannel })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo canal</Button>
      </div>
      {list.length === 0 ? (
        <PanelEmpty title="Aún no tienes canales" description="Da de alta cada marketplace, OTA, agencia o canal de entradas en el que vendes, con su comisión." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((c) => (
            <div key={c.id} className={sectionClass}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-semibold text-foreground ${ellipsis}`}>{c.name}</p>
                  <p className="text-xs text-muted-foreground">{MC_CHANNEL_KIND_LABELS[c.kind]} · {MC_PROVIDER_LABELS[c.provider]}</p>
                </div>
                <Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "Activo" : "Desactivado"}</Badge>
              </div>
              <p className="text-sm text-foreground">Comisión: {c.commissionPct.toLocaleString("es-ES")} %{c.commissionFixedCents ? ` + ${eur(c.commissionFixedCents)} por venta` : ""}</p>
              <p className="text-sm text-muted-foreground">{c.listings} producto{c.listings === 1 ? "" : "s"} publicado{c.listings === 1 ? "" : "s"} · Enlace de entrada: {c.inboundEnabled ? `activo (…${c.inboundTokenHint})` : "sin generar"}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setForm({ id: c.id, name: c.name, kind: c.kind, provider: c.provider, commissionPct: String(c.commissionPct), commissionFixed: (c.commissionFixedCents / 100).toFixed(2), settlementDays: c.settlementDays == null ? "" : String(c.settlementDays), notes: c.notes ?? "", csvMapping: c.csvMapping })}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Editar
                </Button>
                <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => {
                  if (c.inboundEnabled && !window.confirm("El enlace actual dejará de funcionar. ¿Generar uno nuevo?")) return;
                  rotate.mutate({ id: c.id }, { onSuccess: (r) => (setLink({ name: c.name, ...r }), refresh()) });
                }}>
                  <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />{c.inboundEnabled ? "Cambiar enlace" : "Generar enlace"}
                </Button>
                {c.inboundEnabled && <Button size="sm" variant="outline" onClick={() => window.confirm("¿Revocar el enlace de entrada? El canal no podrá enviar más ventas por él.") && revoke.mutate({ id: c.id })}>Revocar enlace</Button>}
                <Button size="sm" variant="ghost" onClick={() => active.mutate({ id: c.id, active: !c.isActive })}>{c.isActive ? "Desactivar" : "Activar"}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar canal" : "Nuevo canal"}</DialogTitle>
            <DialogDescription>La comisión se aplica a cada venta si el canal no la informa en su informe.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <Field label="Nombre"><Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Por ejemplo, GetYourGuide" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tipo">
                  <select className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as McChannelKind })}>
                    {MC_CHANNEL_KINDS.map((k) => <option key={k} value={k}>{MC_CHANNEL_KIND_LABELS[k]}</option>)}
                  </select>
                </Field>
                <Field label="Plataforma">
                  <select className={selectClass} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as McProvider })}>
                    {MC_PROVIDERS.map((p) => <option key={p} value={p}>{MC_PROVIDER_LABELS[p]}</option>)}
                  </select>
                </Field>
                <Field label="Comisión (%)"><Input inputMode="decimal" value={form.commissionPct} onChange={(e) => setForm({ ...form, commissionPct: e.target.value })} /></Field>
                <Field label="Comisión fija por venta (€)"><Input inputMode="decimal" value={form.commissionFixed} onChange={(e) => setForm({ ...form, commissionFixed: e.target.value })} /></Field>
                <Field label="Días hasta que paga" hint="Opcional, para tu referencia."><Input inputMode="numeric" value={form.settlementDays} onChange={(e) => setForm({ ...form, settlementDays: e.target.value })} /></Field>
              </div>
              <Field label="Notas"><Textarea value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">Columnas del informe CSV (opcional)</summary>
                <p className="mt-2 text-xs text-muted-foreground">Se reconocen las columnas habituales en español e inglés. Si el informe de este canal usa otros nombres, escríbelos aquí tal como aparecen en su cabecera.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {MC_CSV_FIELDS.map((f) => (
                    <Field key={f} label={MC_CSV_FIELD_LABELS[f]}>
                      <Input value={form.csvMapping[f] ?? ""} maxLength={120} onChange={(e) => setForm({ ...form, csvMapping: { ...form.csvMapping, [f]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
              </details>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => {
              if (!form) return;
              const pct = toNumber(form.commissionPct);
              const fixed = Math.round(toNumber(form.commissionFixed || "0") * 100);
              if (!Number.isFinite(pct) || !Number.isFinite(fixed)) return toast.error("Revisa la comisión.");
              const mapping = Object.fromEntries(Object.entries(form.csvMapping).filter(([, v]) => v && v.trim()));
              save.mutate({ id: form.id, name: form.name, kind: form.kind, provider: form.provider, commissionPct: pct, commissionFixedCents: fixed, settlementDays: form.settlementDays ? Number(form.settlementDays) : null, notes: form.notes || null, csvMapping: mapping });
            }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Enlace de entrada de {link?.name}</DialogTitle>
            <DialogDescription>Cópialo ahora: por seguridad no se vuelve a mostrar. Si lo pierdes, genera otro.</DialogDescription>
          </DialogHeader>
          {link && (
            <div className="space-y-3 text-sm">
              {[["Ventas (POST, JSON)", origin + link.path], ["Disponibilidad (GET)", origin + link.availabilityPath]].map(([label, url]) => (
                <div key={label} className="space-y-1">
                  <p className="font-medium text-foreground">{label}</p>
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" />
                    <Button size="icon" variant="outline" aria-label="Copiar" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Copiado"))}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Cuerpo de cada venta: <code>{'{"ref":"A-1001","code":"KAYAK-2H","date":"2026-12-01","time":"10:00","units":2,"amount":59.90,"customer":{"name":"…","email":"…"}}'}</code>.
                Para cancelar, la misma referencia con <code>{'"event":"cancelacion"'}</code>. Se admiten hasta 100 en <code>{'{"sales":[…]}'}</code>. Repetir una venta no la duplica.
              </p>
            </div>
          )}
          <DialogFooter><Button onClick={() => setLink(null)}>Hecho</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Publicaciones y cupo ─────────────────────────────────────────────────────

interface ListingForm {
  id?: number;
  channelId: number;
  externalCode: string;
  label: string;
  target: string;
  timeSlotId: string;
  price: string;
}

function Listings() {
  const utils = trpc.useUtils();
  const [channelId, setChannelId] = useState<number | null>(null);
  const listings = trpc.multichannel.listings.useQuery(channelId ? { channelId } : undefined, { retry: false });
  const targets = trpc.multichannel.targets.useQuery(undefined, { retry: false });
  const [form, setForm] = useState<ListingForm | null>(null);
  const [quota, setQuota] = useState<{ listingId: number; name: string; from: string; to: string; quota: string; weekdays: number[] } | null>(null);
  const [from, setFrom] = useState(todayMadrid());
  const allocs = trpc.multichannel.allocations.useQuery({ channelId: channelId ?? undefined, from, to: addDays(from, 13) }, { retry: false });
  const refresh = () => utils.multichannel.invalidate();
  const save = trpc.multichannel.upsertListing.useMutation({ onSuccess: () => (toast.success("Publicación guardada"), setForm(null), refresh()), onError: (e) => toastError(e) });
  const active = trpc.multichannel.setListingActive.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  const setAlloc = trpc.multichannel.setAllocations.useMutation({
    onSuccess: (r) => {
      toast.success(`Cupo fijado en ${r.updated} día${r.updated === 1 ? "" : "s"}`);
      if (r.skipped.length) toast.warning(`${r.skipped.length} día(s) sin cambiar: ya tienen vendido más que el nuevo cupo.`);
      setQuota(null);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const targetList = targets.data ?? [];
  const selected = form ? targetList.find((t) => `${t.kind}:${t.id}` === form.target) : undefined;
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(from, i)), [from]);

  if (listings.isLoading) return <PanelLoading />;
  if (listings.error) return <PanelError error={listings.error} onRetry={() => listings.refetch()} />;
  const list = listings.data ?? [];
  const cell = (listingId: number, day: string) => (allocs.data ?? []).find((a) => a.listingId === listingId && a.day === day);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Field label="Canal"><ChannelSelect value={channelId} onChange={setChannelId} allowAll /></Field></div>
        <Field label="Cupo desde"><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Button disabled={!channelId} onClick={() => channelId && setForm({ channelId, externalCode: "", label: "", target: "", timeSlotId: "", price: "" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Publicar producto</Button>
      </div>
      {list.length === 0 ? (
        <PanelEmpty title="Sin productos publicados" description="Elige un canal y publica en él una experiencia, un tratamiento de spa o un tipo de habitación con el código que usa el canal." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Código del canal</th>
                <th className="p-2">Producto del Core</th>
                {days.map((d) => <th key={d} className="p-2 text-center font-normal">{d.slice(8)}/{d.slice(5, 7)}</th>)}
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} className={`border-t border-border ${l.isActive ? "" : "opacity-60"}`}>
                  <td className="p-2 font-mono text-xs">{l.externalCode}</td>
                  <td className="p-2"><span className="text-xs text-muted-foreground">{MC_TARGET_KIND_LABELS[l.targetKind]}</span><br />{l.targetName ?? "—"}</td>
                  {days.map((d) => {
                    const a = cell(l.id, d);
                    return (
                      <td key={d} className="p-1 text-center text-xs" title={a ? `Cupo ${a.quota} · vendido ${a.sold} · libre en el Core ${a.coreFree ?? "sin límite"}` : "Sin cupo"}>
                        {a ? <span className={a.sellable === 0 ? "text-destructive" : "text-foreground"}>{a.sold}/{a.quota}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap p-2">
                    <Button size="sm" variant="outline" onClick={() => setQuota({ listingId: l.id, name: l.externalCode, from, to: addDays(from, 29), quota: "10", weekdays: [] })}>Cupo</Button>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ id: l.id, channelId: l.channelId, externalCode: l.externalCode, label: l.label ?? "", target: `${l.targetKind}:${l.targetId}`, timeSlotId: l.timeSlotId ? String(l.timeSlotId) : "", price: l.unitPriceCents == null ? "" : (l.unitPriceCents / 100).toFixed(2) })}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => active.mutate({ id: l.id, active: !l.isActive })}>{l.isActive ? "Retirar" : "Reactivar"}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-xs text-muted-foreground">Cada celda: vendido / cupo del canal ese día (en hotel, por noche). En rojo, el canal ya no puede vender más (cupo agotado o el Core sin plaza).</p>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar publicación" : "Publicar producto en el canal"}</DialogTitle>
            <DialogDescription>El código debe coincidir con el que el canal pone en sus ventas (columna de producto, tipo de entrada o tarifa).</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <Field label="Código del producto en el canal"><Input value={form.externalCode} maxLength={80} onChange={(e) => setForm({ ...form, externalCode: e.target.value })} /></Field>
              <Field label="Producto del Core">
                <select className={selectClass} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value, timeSlotId: "" })}>
                  <option value="">Elige…</option>
                  {(["experience", "spa", "hotel"] as McTargetKind[]).map((k) => (
                    <optgroup key={k} label={MC_TARGET_KIND_LABELS[k]}>
                      {targetList.filter((t) => t.kind === k).map((t) => <option key={`${k}:${t.id}`} value={`${k}:${t.id}`}>{t.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {selected?.kind === "experience" && selected.slots.length > 0 && (
                <Field label="Franja" hint="Si no la fijas, se usa la hora que informe el canal.">
                  <select className={selectClass} value={form.timeSlotId} onChange={(e) => setForm({ ...form, timeSlotId: e.target.value })}>
                    <option value="">Según la hora de la venta</option>
                    {selected.slots.map((s) => <option key={s.id} value={s.id}>{s.label}{s.startTime ? ` · ${s.startTime}` : ""}{s.capacity ? ` (${s.capacity} plazas)` : ""}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Precio por unidad en el canal (€)" hint="Se usa si la venta llega sin importe."><Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
              <Field label="Descripción (opcional)"><Input value={form.label} maxLength={200} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => {
              if (!form) return;
              const [kind, tid] = form.target.split(":");
              if (!kind || !tid) return toast.error("Elige el producto del Core.");
              const price = form.price ? Math.round(toNumber(form.price) * 100) : null;
              save.mutate({ id: form.id, channelId: form.channelId, externalCode: form.externalCode, label: form.label || null, targetKind: kind as McTargetKind, targetId: Number(tid), timeSlotId: form.timeSlotId ? Number(form.timeSlotId) : null, unitPriceCents: price });
            }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!quota} onOpenChange={(o) => !o && setQuota(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cupo de {quota?.name}</DialogTitle>
            <DialogDescription>Plazas (o habitaciones por noche) que este canal puede vender cada día. Con 0 cierras la venta. Nunca baja de lo ya vendido.</DialogDescription>
          </DialogHeader>
          {quota && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desde"><Input type="date" value={quota.from} onChange={(e) => setQuota({ ...quota, from: e.target.value })} /></Field>
                <Field label="Hasta"><Input type="date" value={quota.to} onChange={(e) => setQuota({ ...quota, to: e.target.value })} /></Field>
              </div>
              <Field label="Cupo por día"><Input inputMode="numeric" value={quota.quota} onChange={(e) => setQuota({ ...quota, quota: e.target.value })} /></Field>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">Solo estos días de la semana (opcional)</p>
                <div className="flex gap-1">
                  {WEEKDAYS.map((w, i) => {
                    const on = quota.weekdays.includes(i + 1);
                    return <Button key={w} size="sm" variant={on ? "default" : "outline"} onClick={() => setQuota({ ...quota, weekdays: on ? quota.weekdays.filter((x) => x !== i + 1) : [...quota.weekdays, i + 1] })}>{w}</Button>;
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuota(null)}>Cancelar</Button>
            <Button disabled={setAlloc.isPending} onClick={() => quota && setAlloc.mutate({ listingId: quota.listingId, from: quota.from, to: quota.to, quota: Number(quota.quota), weekdays: quota.weekdays.length ? quota.weekdays : undefined })}>Fijar cupo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Ventas ───────────────────────────────────────────────────────────────────

function Sales() {
  const utils = trpc.useUtils();
  const [channelId, setChannelId] = useState<number | null>(null);
  const [status, setStatus] = useState<McSaleStatus | "pendientes" | "todas">("todas");
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState<{ channelId: number | null; ref: string; code: string; date: string; endDate: string; time: string; units: string; amount: string; customerName: string; customerEmail: string } | null>(null);
  const filter = { channelId: channelId ?? undefined, status, search: search || undefined, limit: 100 };
  const q = trpc.multichannel.sales.useQuery(filter, { retry: false });
  const refresh = () => utils.multichannel.invalidate();
  const outcome = (r: { status: string; duplicate: boolean; problem: string | null }) =>
    r.duplicate ? toast.info("Esa venta ya estaba registrada: no se ha duplicado.") : r.status === "registrada" ? toast.success("Venta registrada y reserva creada") : r.status === "cancelada" ? toast.success("Venta cancelada: cupo y plaza devueltos") : toast.warning(r.problem ?? MC_SALE_STATUS_LABELS[r.status as McSaleStatus]);
  const cancel = trpc.multichannel.cancelSale.useMutation({ onSuccess: (r) => (outcome(r), refresh()), onError: (e) => toastError(e) });
  const retry = trpc.multichannel.retrySale.useMutation({ onSuccess: (r) => (outcome(r), refresh()), onError: (e) => toastError(e) });
  const retryOps = trpc.multichannel.retryOperation.useMutation({
    onSuccess: (r) => (r.opsStatus === "hecho" ? toast.success("Contabilidad y Operaciones completadas") : toast.warning(r.problem ?? "No se ha podido completar"), refresh()),
    onError: (e) => toastError(e),
  });
  const record = trpc.multichannel.recordSale.useMutation({ onSuccess: (r) => (outcome(r), r.status === "registrada" && setManual(null), refresh()), onError: (e) => toastError(e) });
  const exportCsv = utils.multichannel.exportSales;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1"><Field label="Canal"><ChannelSelect value={channelId} onChange={setChannelId} allowAll /></Field></div>
        <Field label="Estado">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="todas">Todas</option>
            <option value="pendientes">Por revisar (sin cupo, sin plaza o rechazadas)</option>
            {(Object.keys(MC_SALE_STATUS_LABELS) as McSaleStatus[]).map((s) => <option key={s} value={s}>{MC_SALE_STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Buscar"><Input value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} placeholder="Referencia o cliente" /></Field>
        <Button variant="outline" onClick={async () => {
          try {
            const r = await exportCsv.fetch(filter);
            const blob = new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `ventas-multicanal-${todayMadrid()}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          } catch (e) {
            toastError(e);
          }
        }}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" />CSV</Button>
        <Button onClick={() => setManual({ channelId, ref: "", code: "", date: todayMadrid(), endDate: "", time: "", units: "1", amount: "", customerName: "", customerEmail: "" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Venta manual</Button>
      </div>
      {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : (q.data?.items.length ?? 0) === 0 ? (
        <PanelEmpty title="Sin ventas" description="Las ventas llegan por el enlace de entrada de cada canal, importando su informe CSV o con una venta manual." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Canal · referencia</th><th className="p-2">Servicio</th><th className="p-2 text-right">Importe</th><th className="p-2 text-right">Comisión</th><th className="p-2">Estado</th><th className="p-2">Reserva</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {q.data!.items.map((s) => (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="p-2"><span className="text-xs text-muted-foreground">{s.channelName}</span><br /><span className="font-mono text-xs">{s.externalRef}</span></td>
                  <td className="p-2">{s.externalCode ?? "—"}<br /><span className="text-xs text-muted-foreground">{s.serviceDay ?? "—"}{s.serviceEndDay ? ` → ${s.serviceEndDay}` : ""}{s.serviceTime ? ` · ${s.serviceTime}` : ""} · {s.units} ud.</span></td>
                  <td className="p-2 text-right">{eur(s.grossCents)}</td>
                  <td className="p-2 text-right">{eur(s.commissionCents)}</td>
                  <td className="p-2"><Badge variant={STATUS_VARIANT[s.status]}>{MC_SALE_STATUS_LABELS[s.status]}</Badge>{s.problem && <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">{s.problem}</p>}{s.status === "registrada" && s.opsStatus === "error" && <p className="mt-1 max-w-[260px] text-xs text-destructive">{s.opsError ?? "Contabilidad y Operaciones sin completar."}</p>}</td>
                  <td className="p-2 text-xs">{s.reservationNumber ?? "—"}{s.settlementId ? <><br /><span className="text-muted-foreground">Liquidada</span></> : null}</td>
                  <td className="whitespace-nowrap p-2">
                    {["sin_cupo", "sin_plaza", "rechazada"].includes(s.status) && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: s.id })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Reintentar</Button>}
                    {s.status === "registrada" && s.opsStatus === "error" && <Button size="sm" variant="outline" disabled={retryOps.isPending} onClick={() => retryOps.mutate({ id: s.id })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Completar contabilidad</Button>}
                    {s.status !== "cancelada" && <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => window.confirm("¿Cancelar esta venta? Se anula la reserva del Core y se devuelve el cupo.") && cancel.mutate({ id: s.id })}><Ban className="mr-1 h-4 w-4" aria-hidden="true" />Cancelar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-xs text-muted-foreground">{q.data!.total} venta{q.data!.total === 1 ? "" : "s"}{q.data!.total > q.data!.items.length ? ` (se muestran las ${q.data!.items.length} últimas)` : ""}.</p>
        </div>
      )}

      <Dialog open={!!manual} onOpenChange={(o) => !o && setManual(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Venta manual de un canal</DialogTitle>
            <DialogDescription>Para una venta que te llegó por correo o teléfono del canal. Consume su cupo y crea la reserva igual que las automáticas.</DialogDescription>
          </DialogHeader>
          {manual && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Canal"><ChannelSelect value={manual.channelId} onChange={(id) => setManual({ ...manual, channelId: id })} /></Field></div>
              <Field label="Referencia del canal"><Input value={manual.ref} maxLength={128} onChange={(e) => setManual({ ...manual, ref: e.target.value })} /></Field>
              <Field label="Código del producto"><Input value={manual.code} maxLength={80} onChange={(e) => setManual({ ...manual, code: e.target.value })} /></Field>
              <Field label="Fecha"><Input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></Field>
              <Field label="Salida (hotel)"><Input type="date" value={manual.endDate} onChange={(e) => setManual({ ...manual, endDate: e.target.value })} /></Field>
              <Field label="Hora"><Input placeholder="10:00" value={manual.time} maxLength={5} onChange={(e) => setManual({ ...manual, time: e.target.value })} /></Field>
              <Field label="Unidades"><Input inputMode="numeric" value={manual.units} onChange={(e) => setManual({ ...manual, units: e.target.value })} /></Field>
              <Field label="Importe (€)"><Input inputMode="decimal" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></Field>
              <Field label="Cliente"><Input value={manual.customerName} maxLength={200} onChange={(e) => setManual({ ...manual, customerName: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Correo del cliente"><Input type="email" value={manual.customerEmail} maxLength={255} onChange={(e) => setManual({ ...manual, customerEmail: e.target.value })} /></Field></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManual(null)}>Cancelar</Button>
            <Button disabled={record.isPending} onClick={() => {
              if (!manual?.channelId) return toast.error("Elige el canal.");
              record.mutate({ channelId: manual.channelId, ref: manual.ref, code: manual.code || null, date: manual.date, endDate: manual.endDate || null, time: manual.time || null, units: Number(manual.units), amount: manual.amount ? toNumber(manual.amount) : null, customerName: manual.customerName || null, customerEmail: manual.customerEmail || null });
            }}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Importar informe ─────────────────────────────────────────────────────────

function ImportReport() {
  const utils = trpc.useUtils();
  const [channelId, setChannelId] = useState<number | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const imports = trpc.multichannel.imports.useQuery(channelId ? { channelId } : undefined, { retry: false });
  const run = trpc.multichannel.importCsv.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.registered} registradas, ${r.cancelled} canceladas, ${r.duplicates} ya estaban, ${r.rejected} por revisar`);
      setFile(null);
      utils.multichannel.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const last = run.data;
  return (
    <div className="space-y-4">
      <div className={sectionClass}>
        <p className="text-sm text-muted-foreground">Descarga de tu canal (Fourvenues, Weezevent, GetYourGuide…) el informe de ventas o de participantes en CSV y súbelo aquí. Hacen falta las columnas de referencia y de fecha; se reconocen también producto, hora, cantidad, importe, comisión, cliente y estado (las filas canceladas o reembolsadas cancelan la venta). Puedes subir el mismo informe varias veces: lo ya importado no se duplica.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Canal"><ChannelSelect value={channelId} onChange={setChannelId} /></Field>
          <Field label="Fichero CSV">
            <Input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return setFile(null);
              if (f.size > 2 * 1024 * 1024) return toast.error("El fichero supera 2 MB: divídelo por fechas.");
              setFile({ name: f.name, text: await f.text() });
            }} />
          </Field>
        </div>
        <Button disabled={!channelId || !file || run.isPending} onClick={() => channelId && file && run.mutate({ channelId, fileName: file.name, text: file.text })}>
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />{run.isPending ? "Importando…" : "Importar ventas"}
        </Button>
        {last && last.problems.length > 0 && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium text-foreground">Filas por revisar</p>
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {last.problems.map((p, i) => <li key={i}>Línea {p.line}{p.ref ? ` (${p.ref})` : ""}: {p.problem}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className={sectionClass}>
        <p className="font-medium text-foreground">Últimas importaciones</p>
        {imports.isLoading ? <PanelLoading /> : imports.error ? <PanelError error={imports.error} /> : (imports.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Ninguna todavía.</p> : (
          <ul className="space-y-1 text-sm">
            {imports.data!.map((i) => <li key={i.id} className="text-foreground">{i.createdAt ? new Date(i.createdAt).toLocaleString("es-ES") : ""} · {i.channelName} · {i.fileName ?? "CSV"}: {i.rows} filas, {i.registered} registradas, {i.cancelled} canceladas, {i.duplicates} repetidas, {i.rejected} por revisar</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Conciliación ─────────────────────────────────────────────────────────────

function Reconciliation() {
  const utils = trpc.useUtils();
  const [channelId, setChannelId] = useState<number | null>(null);
  const [to, setTo] = useState(todayMadrid());
  const [from, setFrom] = useState(addDays(todayMadrid(), -30));
  const [settle, setSettle] = useState<{ channelId: number; name: string; reference: string; received: string } | null>(null);
  const q = trpc.multichannel.reconciliation.useQuery({ channelId: channelId ?? undefined, from, to }, { retry: false });
  const create = trpc.multichannel.createSettlement.useMutation({
    onSuccess: (r) => (toast.success(`Liquidación anotada: ${r.salesCount} ventas, neto esperado ${eur(r.expectedNetCents)}`), setSettle(null), utils.multichannel.invalidate()),
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1"><Field label="Canal"><ChannelSelect value={channelId} onChange={setChannelId} allowAll /></Field></div>
        <Field label="Servicio desde"><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <Button variant="outline" onClick={() => q.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Actualizar</Button>
      </div>
      {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {q.data!.totals.length === 0 ? <PanelEmpty title="Sin ventas en el periodo" /> : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="p-2">Canal</th><th className="p-2 text-right">Ventas</th><th className="p-2 text-right">Unidades</th><th className="p-2 text-right">Bruto</th><th className="p-2 text-right">Comisión</th><th className="p-2 text-right">Neto</th><th className="p-2 text-right">Neto sin liquidar</th><th className="p-2 text-right">Canceladas / por revisar</th><th className="p-2" /></tr>
                </thead>
                <tbody>
                  {q.data!.totals.map((t) => (
                    <tr key={t.channelId} className="border-t border-border">
                      <td className="p-2">{t.channelName}</td>
                      <td className="p-2 text-right">{t.registered}</td>
                      <td className="p-2 text-right">{t.units}</td>
                      <td className="p-2 text-right">{eur(t.grossCents)}</td>
                      <td className="p-2 text-right">{eur(t.commissionCents)}</td>
                      <td className="p-2 text-right">{eur(t.netCents)}</td>
                      <td className="p-2 text-right">{eur(t.pendingNetCents)} ({t.pendingSettlement})</td>
                      <td className="p-2 text-right">{t.cancelled} / {t.rejected}</td>
                      <td className="p-2">{t.pendingSettlement > 0 && <Button size="sm" variant="outline" onClick={() => setSettle({ channelId: t.channelId, name: t.channelName, reference: "", received: "" })}>Anotar pago</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.data!.mismatches.length > 0 && (
            <div className={sectionClass}>
              <p className="font-medium text-foreground">Desajustes con el Core</p>
              <p className="text-sm text-muted-foreground">Ventas registradas cuya reserva se ha anulado en el Core. El cupo del canal sigue consumido: cancela la venta aquí si el canal también la ha cancelado.</p>
              <ul className="space-y-1 text-sm">{q.data!.mismatches.map((s) => <li key={s.id}>{s.channelName} · <span className="font-mono text-xs">{s.externalRef}</span> · {s.serviceDay} · reserva {s.reservationNumber ?? "no encontrada"}</li>)}</ul>
            </div>
          )}
          {q.data!.opsFailed.length > 0 && (
            <div className={sectionClass}>
              <p className="font-medium text-foreground">Ventas sin contabilidad ni Operaciones</p>
              <p className="text-sm text-muted-foreground">La reserva está creada y pagada por el canal, pero falta su transacción de ingreso o su ficha en Operaciones. Complétalas en «Ventas» con «Completar contabilidad» (no se duplica nada).</p>
              <ul className="space-y-1 text-sm">{q.data!.opsFailed.map((s) => <li key={s.id}>{s.channelName} · <span className="font-mono text-xs">{s.externalRef}</span> · {s.serviceDay} · reserva {s.reservationNumber ?? "—"}{s.opsError ? `: ${s.opsError}` : ""}</li>)}</ul>
            </div>
          )}
          {q.data!.orphanIncome.length > 0 && (
            <div className={sectionClass}>
              <p className="font-medium text-foreground">Ingresos de ventas canceladas</p>
              <p className="text-sm text-muted-foreground">Ventas canceladas por el canal cuyo ingreso sigue vigente en Contabilidad. Revísalo en Contabilidad.</p>
              <ul className="space-y-1 text-sm">{q.data!.orphanIncome.map((s) => <li key={s.id}>{s.channelName} · <span className="font-mono text-xs">{s.externalRef}</span> · {s.serviceDay} · reserva {s.reservationNumber ?? "—"}</li>)}</ul>
            </div>
          )}
          {q.data!.pending.length > 0 && (
            <div className={sectionClass}>
              <p className="font-medium text-foreground">Ventas por revisar</p>
              <p className="text-sm text-muted-foreground">El canal las vendió pero no han entrado en el Core (sin cupo, sin plaza o con datos que no encajan). Amplía el cupo o corrige la publicación y reinténtalas en «Ventas», o avisa al canal.</p>
              <ul className="space-y-1 text-sm">{q.data!.pending.map((s) => <li key={s.id}>{s.channelName} · <span className="font-mono text-xs">{s.externalRef}</span> · {s.serviceDay ?? "sin fecha"} · {MC_SALE_STATUS_LABELS[s.status]}: {s.problem}</li>)}</ul>
            </div>
          )}
          <div className={sectionClass}>
            <p className="font-medium text-foreground">Liquidaciones anotadas</p>
            {q.data!.settlements.length === 0 ? <p className="text-sm text-muted-foreground">Ninguna todavía.</p> : (
              <ul className="space-y-1 text-sm">
                {q.data!.settlements.map((s) => (
                  <li key={s.id}>{s.channelName} · {s.periodFrom} a {s.periodTo}{s.reference ? ` · ${s.reference}` : ""}: {s.salesCount} ventas, neto esperado {eur(s.expectedNetCents)}{s.receivedCents != null && <> · recibido {eur(s.receivedCents)} · <span className={s.differenceCents ? "text-destructive" : "text-foreground"}>diferencia {eur(s.differenceCents ?? 0)}</span></>}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Dialog open={!!settle} onOpenChange={(o) => !o && setSettle(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pago de {settle?.name}</DialogTitle>
            <DialogDescription>Agrupa las ventas registradas sin liquidar con servicio del {from} al {to} y anota lo que te ha pagado el canal.</DialogDescription>
          </DialogHeader>
          {settle && (
            <div className="space-y-3">
              <Field label="Referencia del pago o de la factura del canal"><Input value={settle.reference} maxLength={120} onChange={(e) => setSettle({ ...settle, reference: e.target.value })} /></Field>
              <Field label="Importe recibido (€)" hint="Opcional: si lo indicas, verás la diferencia con el neto esperado."><Input inputMode="decimal" value={settle.received} onChange={(e) => setSettle({ ...settle, received: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettle(null)}>Cancelar</Button>
            <Button disabled={create.isPending} onClick={() => settle && create.mutate({ channelId: settle.channelId, from, to, reference: settle.reference || null, receivedCents: settle.received ? Math.round(toNumber(settle.received) * 100) : null })}>Anotar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Multicanal() {
  const [tab, setTab] = useState("canales");
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Extensión</p>
          <h1 className="text-2xl font-bold text-foreground">Venta multicanal</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Vende tus experiencias, tratamientos y habitaciones en marketplaces, agencias y canales de entradas con un cupo por canal. Cada venta del canal crea su reserva aquí, sin sobrevender, y la conciliación te dice cuánto has vendido, cuánta comisión pagas y qué te falta por cobrar.</p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="canales">Canales</TabsTrigger>
            <TabsTrigger value="cupo">Productos y cupo</TabsTrigger>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
            <TabsTrigger value="importar">Importar informe</TabsTrigger>
            <TabsTrigger value="conciliacion">Conciliación</TabsTrigger>
          </TabsList>
          <TabsContent value="canales" className="pt-4"><Channels /></TabsContent>
          <TabsContent value="cupo" className="pt-4"><Listings /></TabsContent>
          <TabsContent value="ventas" className="pt-4"><Sales /></TabsContent>
          <TabsContent value="importar" className="pt-4"><ImportReport /></TabsContent>
          <TabsContent value="conciliacion" className="pt-4"><Reconciliation /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
