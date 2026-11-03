/**
 * Inventario (Business, `inventory-basic`): existencias por sede de los productos y variantes marcados como
 * inventariables, alertas de mínimo, entradas, ajustes con motivo, traspasos entre sedes (con `multi-site`), historial
 * filtrable y exportación CSV. Administración ajusta; el resto del equipo con acceso consulta. Las ventas del TPV y los
 * pedidos pagados de la tienda descuentan solos, y las anulaciones reponen. Essential no llega a esta pantalla (el
 * guardián de rutas muestra «No incluido en tu plan») y sus ventas funcionan como siempre.
 */
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { AlertTriangle, ArrowLeftRight, Boxes, Download, Minus, PackagePlus, Pencil, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { errorMessage, toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { randomId } from "@shared/randomId";
import { MOVEMENT_KINDS, MOVEMENT_LABELS, OVERSELL_LABELS, OVERSELL_POLICIES, type MovementKind, type OversellPolicy } from "@shared/inventory";

type Overview = inferRouterOutputs<AppRouter>["inventory"]["overview"];
type Item = Overview["items"][number];
type Site = Overview["sites"][number];

const newKey = () => randomId().replace(/[^A-Za-z0-9]/g, "");
const fmtDateTime = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
const intOf = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SiteSelect({ id, sites, value, onChange, label }: { id: string; sites: Site[]; value: string; onChange: (v: string) => void; label: string }) {
  if (sites.length <= 1) return null;
  return (
    <FormField id={id} label={label}>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
      </select>
    </FormField>
  );
}

// ─── Alta de artículo ────────────────────────────────────────────────────────

function TrackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const catalog = trpc.inventory.catalog.useQuery(undefined, { enabled: open });
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("0");
  const [policy, setPolicy] = useState<OversellPolicy>("block");
  const [min, setMin] = useState("0");
  const track = trpc.inventory.track.useMutation({
    onSuccess: () => {
      toast.success("Artículo añadido al inventario");
      utils.inventory.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const product = catalog.data?.find((p) => String(p.id) === productId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = intOf(min);
    if (!product) return toast.error("Elige un producto");
    if (!(m >= 0)) return toast.error("El mínimo debe ser un número entero, 0 o más");
    track.mutate({ productId: product.id, variantId: Number(variantId), policy, minStock: m });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Controlar existencias de un producto</DialogTitle>
          <DialogDescription>Elige el producto entero o una de sus variantes (por ejemplo, una talla). Lo que no controles se vende como siempre.</DialogDescription>
        </DialogHeader>
        {catalog.isLoading ? <PanelLoading label="Cargando el catálogo…" /> : catalog.isError ? <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar el catálogo" /> : (
          <form onSubmit={submit} className="space-y-4">
            <FormField id="inv-product" label="Producto" required>
              <select id="inv-product" className={selectClass} value={productId} onChange={(e) => { setProductId(e.target.value); setVariantId("0"); }}>
                <option value="">Elige un producto…</option>
                {catalog.data?.map((p) => <option key={p.id} value={p.id}>{p.title}{p.active ? "" : " (no activo)"}</option>)}
              </select>
            </FormField>
            {product && product.variants.length > 0 && (
              <FormField id="inv-variant" label="Qué controlar" hint="Por variante, cada opción tiene sus propias existencias.">
                <select id="inv-variant" className={selectClass} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="0">El producto entero{product.tracked ? " (ya controlado)" : ""}</option>
                  {product.variants.map((v) => <option key={v.id} value={v.id}>Variante: {v.name}{v.tracked ? " (ya controlada)" : ""}</option>)}
                </select>
              </FormField>
            )}
            <FormField id="inv-policy" label="Venta sin existencias">
              <select id="inv-policy" className={selectClass} value={policy} onChange={(e) => setPolicy(e.target.value as OversellPolicy)}>
                {OVERSELL_POLICIES.map((p) => <option key={p} value={p}>{OVERSELL_LABELS[p]}</option>)}
              </select>
            </FormField>
            <FormField id="inv-min" label="Mínimo de alerta" hint="Avisa cuando las existencias de una sede bajan a este número o menos (0 = sin aviso).">
              <Input id="inv-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={track.isPending}>Añadir</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Entradas, ajustes y traspasos ───────────────────────────────────────────

type Action = { kind: "receive" | "adjust" | "transfer" | "edit"; item: Item };

function ActionDialog({ action, sites, primarySiteId, onClose }: { action: Action; sites: Site[]; primarySiteId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { item, kind } = action;
  const [key] = useState(newKey);
  const [site, setSite] = useState(primarySiteId);
  const [toSite, setToSite] = useState(sites.find((s) => s.siteId !== primarySiteId)?.siteId ?? primarySiteId);
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [policy, setPolicy] = useState<OversellPolicy>(item.policy);
  const [min, setMin] = useState(String(item.minStock));
  const [siteMins, setSiteMins] = useState<Record<string, string>>(() => Object.fromEntries(item.levels.map((l) => [l.siteId, l.minStock == null ? "" : String(l.minStock)])));
  const done = (msg: string) => {
    toast.success(msg);
    utils.inventory.invalidate();
    onClose();
  };
  const opts = { onError: (e: unknown) => toastError(e) };
  const receive = trpc.inventory.receive.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? `Entrada registrada. Existencias: ${r.onHand}` : "Esta entrada ya estaba registrada") });
  const adjust = trpc.inventory.adjust.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? `Ajuste registrado. Existencias: ${r.onHand}` : "Este ajuste ya estaba registrado") });
  const transfer = trpc.inventory.transfer.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? `Traspaso registrado. Origen: ${r.fromOnHand} · destino: ${r.toOnHand}` : "Este traspaso ya estaba registrado") });
  const update = trpc.inventory.update.useMutation(opts);
  const setSiteMin = trpc.inventory.setSiteMin.useMutation(opts);
  const pending = receive.isPending || adjust.isPending || transfer.isPending || update.isPending || setSiteMin.isPending;
  const siteArg = (s: string) => (sites.length > 1 ? s : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = intOf(quantity);
    if (kind === "edit") {
      const m = intOf(min);
      if (!(m >= 0)) return toast.error("El mínimo debe ser un número entero, 0 o más");
      try {
        await update.mutateAsync({ itemId: item.id, policy, minStock: m });
        for (const l of item.levels) {
          const raw = (siteMins[l.siteId] ?? "").trim();
          const next = raw === "" ? null : intOf(raw);
          if (next !== null && !(next >= 0)) return toast.error("Los mínimos por sede deben ser números enteros, 0 o más");
          if (next !== l.minStock) await setSiteMin.mutateAsync({ itemId: item.id, siteId: siteArg(l.siteId), minStock: next });
        }
        done("Artículo guardado");
      } catch {
        /* el error ya se ha mostrado */
      }
      return;
    }
    if (kind === "adjust") {
      if (!Number.isInteger(q) || (mode === "set" ? q < 0 : q === 0)) return toast.error(mode === "set" ? "Indica el recuento (0 o más)" : "Indica cuántas unidades sumar (+) o restar (-)");
      if (reason.trim().length < 3) return toast.error("Indica el motivo del ajuste");
      return adjust.mutate({ itemId: item.id, siteId: siteArg(site), mode, quantity: q, reason: reason.trim(), key });
    }
    if (!(q > 0)) return toast.error("Indica un número entero de unidades, mayor que 0");
    if (kind === "receive") return receive.mutate({ itemId: item.id, siteId: siteArg(site), quantity: q, reason: reason.trim() || undefined, reference: reference.trim() || undefined, key });
    if (site === toSite) return toast.error("Elige dos sedes distintas");
    transfer.mutate({ itemId: item.id, fromSiteId: site, toSiteId: toSite, quantity: q, reason: reason.trim() || undefined, key });
  };

  const title = { receive: "Entrada de unidades", adjust: "Ajuste de existencias", transfer: "Traspaso entre sedes", edit: "Editar artículo" }[kind];
  const onHandAt = (s: string) => item.levels.find((l) => l.siteId === s)?.onHand ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{item.label}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {kind === "edit" ? (
            <>
              <FormField id="act-policy" label="Venta sin existencias">
                <select id="act-policy" className={selectClass} value={policy} onChange={(e) => setPolicy(e.target.value as OversellPolicy)}>
                  {OVERSELL_POLICIES.map((p) => <option key={p} value={p}>{OVERSELL_LABELS[p]}</option>)}
                </select>
              </FormField>
              <FormField id="act-min" label="Mínimo de alerta" hint="0 = sin aviso. Cada sede puede tener el suyo.">
                <Input id="act-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
              </FormField>
              {sites.length > 1 && item.levels.map((l) => (
                <FormField key={l.siteId} id={`act-min-${l.siteId}`} label={`Mínimo en ${sites.find((s) => s.siteId === l.siteId)?.name ?? l.siteId}`} hint="Vacío = el del artículo.">
                  <Input id={`act-min-${l.siteId}`} inputMode="numeric" value={siteMins[l.siteId] ?? ""} onChange={(e) => setSiteMins((m) => ({ ...m, [l.siteId]: e.target.value }))} />
                </FormField>
              ))}
            </>
          ) : (
            <>
              <SiteSelect id="act-site" sites={sites} value={site} onChange={setSite} label={kind === "transfer" ? "Desde la sede" : "Sede"} />
              {kind === "transfer" && <SiteSelect id="act-to" sites={sites} value={toSite} onChange={setToSite} label="A la sede" />}
              <p className="text-sm text-muted-foreground">Existencias actuales{sites.length > 1 ? " en esta sede" : ""}: <strong className="tabular-nums text-foreground">{onHandAt(site)}</strong></p>
              {kind === "adjust" && (
                <FormField id="act-mode" label="Tipo de ajuste">
                  <select id="act-mode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "delta" | "set")}>
                    <option value="delta">Sumar o restar unidades</option>
                    <option value="set">Fijar el recuento</option>
                  </select>
                </FormField>
              )}
              <FormField id="act-qty" label={kind === "adjust" ? (mode === "set" ? "Recuento" : "Unidades (+ o -)") : "Unidades"} required>
                <Input id="act-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={kind === "adjust" && mode === "delta" ? "-2" : "10"} />
              </FormField>
              {kind === "receive" && (
                <FormField id="act-ref" label="Documento" hint="Albarán, factura del proveedor o pedido (opcional).">
                  <Input id="act-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
                </FormField>
              )}
              <FormField id="act-reason" label="Motivo" required={kind === "adjust"} hint={kind === "adjust" ? "Por ejemplo: rotura, recuento, merma." : undefined}>
                <Input id="act-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending}>Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Historial ───────────────────────────────────────────────────────────────

function History({ data }: { data: Overview }) {
  const utils = trpc.useUtils();
  const [itemId, setItemId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [kind, setKind] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const filter = {
    ...(itemId ? { itemId: Number(itemId) } : {}),
    ...(siteId ? { siteId } : {}),
    ...(kind ? { kind: kind as MovementKind } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
  const limit = 50;
  const list = trpc.inventory.movements.useQuery({ ...filter, page, limit });
  const siteName = (stored: string | null) => data.sites.find((s) => s.siteId === (stored ?? data.primarySiteId))?.name ?? stored ?? "Sede principal";
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / limit));
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await utils.inventory.exportCsv.fetch({ ...filter, what: "movimientos" });
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se ha podido exportar el historial."));
    } finally {
      setExporting(false);
    }
  };
  const reset = () => setPage(1);
  return (
    <section aria-labelledby="hist-title" className="space-y-3">
      <h2 id="hist-title" className="sr-only">Historial de movimientos</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <FormField id="h-item" label="Artículo">
          <select id="h-item" className={selectClass} value={itemId} onChange={(e) => { setItemId(e.target.value); reset(); }}>
            <option value="">Todos</option>
            {data.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </FormField>
        {data.sites.length > 1 && (
          <FormField id="h-site" label="Sede">
            <select id="h-site" className={selectClass} value={siteId} onChange={(e) => { setSiteId(e.target.value); reset(); }}>
              <option value="">Todas</option>
              {data.sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="h-kind" label="Movimiento">
          <select id="h-kind" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>
            <option value="">Todos</option>
            {MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{MOVEMENT_LABELS[k]}</option>)}
          </select>
        </FormField>
        <FormField id="h-from" label="Desde">
          <Input id="h-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); reset(); }} />
        </FormField>
        <FormField id="h-to" label="Hasta">
          <Input id="h-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); reset(); }} />
        </FormField>
        <div className="flex items-end">
          <Button variant="outline" onClick={exportCsv} disabled={exporting} className="w-full">
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Exportar CSV
          </Button>
        </div>
      </div>
      {list.isLoading ? <PanelLoading label="Cargando el historial…" /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} title="No se ha podido cargar el historial" /> : !list.data?.items.length ? (
        <PanelEmpty icon={<Boxes className="h-6 w-6" />} title="Sin movimientos" description="Las entradas, ventas, devoluciones, ajustes y traspasos aparecerán aquí." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                <th scope="col" className="px-3 py-2 font-medium">Artículo</th>
                {data.sites.length > 1 && <th scope="col" className="px-3 py-2 font-medium">Sede</th>}
                <th scope="col" className="px-3 py-2 font-medium">Movimiento</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cantidad</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Después</th>
                <th scope="col" className="px-3 py-2 font-medium">Motivo y documento</th>
                <th scope="col" className="px-3 py-2 font-medium">Usuario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.items.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2">{m.label}</td>
                  {data.sites.length > 1 && <td className="px-3 py-2">{siteName(m.siteId)}</td>}
                  <td className="px-3 py-2">
                    {MOVEMENT_LABELS[m.kind as MovementKind] ?? m.kind}
                    {m.shortfall && <span className="ml-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">sin existencias</span>}
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", m.quantity < 0 ? "text-destructive" : "text-success")}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.balanceAfter ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{[m.reason, [m.sourceLabel, m.sourceRef].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{m.userName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>{list.data.total} {list.data.total === 1 ? "movimiento" : "movimientos"}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <span>Página {page} de {pages}</span>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const utils = trpc.useUtils();
  const overview = trpc.inventory.overview.useQuery();
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const untrack = trpc.inventory.untrack.useMutation({
    onSuccess: () => {
      toast.success("El artículo ya no controla existencias. Se vende como siempre.");
      utils.inventory.invalidate();
      setRemoving(null);
    },
    onError: (e) => toastError(e),
  });
  const data = overview.data;
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (!q || i.label.toLowerCase().includes(q)) && (!onlyLow || i.low));
  }, [data, search, onlyLow]);
  const lowCount = data?.items.filter((i) => i.low).length ?? 0;
  const exportStock = async () => {
    setExporting(true);
    try {
      const r = await utils.inventory.exportCsv.fetch({ what: "existencias" });
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se han podido exportar las existencias."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Existencias en unidades de tus productos y artículos, por sede. Las ventas del TPV y los pedidos pagados de la tienda online descuentan solos; las
              anulaciones y devoluciones reponen. Lo que no marques como inventariable se vende como siempre.
            </p>
          </div>
          {data?.canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Añadir producto
            </Button>
          )}
        </div>

        {overview.isLoading ? <PanelLoading label="Cargando el inventario…" /> : overview.isError || !data ? <PanelError error={overview.error} onRetry={() => overview.refetch()} title="No se ha podido cargar el inventario" /> : (
          <Tabs defaultValue="existencias">
            <TabsList>
              <TabsTrigger value="existencias">Existencias</TabsTrigger>
              <TabsTrigger value="historial">Historial</TabsTrigger>
            </TabsList>
            <TabsContent value="existencias" className="space-y-3">
              {lowCount > 0 && (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  {lowCount === 1 ? "1 artículo está" : `${lowCount} artículos están`} en el mínimo de alerta o por debajo en alguna sede.
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full max-w-xs">
                  <FormField id="inv-search" label="Buscar">
                    <Input id="inv-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre del producto" />
                  </FormField>
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
                  <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo alertas
                </label>
                <Button variant="outline" className="ml-auto" onClick={exportStock} disabled={exporting}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Exportar CSV
                </Button>
              </div>
              {data.items.length === 0 ? (
                <PanelEmpty icon={<Boxes className="h-6 w-6" />} title="Todavía no controlas existencias" description={data.canManage ? "Añade los productos o variantes de los que quieras llevar existencias. El resto del catálogo se vende como siempre." : "Administración decide qué productos llevan control de existencias."} />
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th scope="col" className="px-3 py-2 font-medium">Artículo</th>
                        {data.sites.map((s) => <th key={s.siteId} scope="col" className="px-3 py-2 text-right font-medium">{data.sites.length > 1 ? s.name : "Existencias"}</th>)}
                        {data.sites.length > 1 && <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>}
                        <th scope="col" className="px-3 py-2 font-medium">Sin existencias</th>
                        {data.canManage && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Acciones</span></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td className="px-3 py-2 font-medium text-foreground">{i.label}</td>
                          {i.levels.map((l) => (
                            <td key={l.siteId} className={cn("px-3 py-2 text-right tabular-nums", l.low && "font-semibold text-destructive")}>
                              {l.onHand}
                              {l.effectiveMin > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">/ mín. {l.effectiveMin}</span>}
                              {l.low && <span className="sr-only"> (en alerta)</span>}
                            </td>
                          ))}
                          {data.sites.length > 1 && <td className="px-3 py-2 text-right tabular-nums">{i.total}</td>}
                          <td className="px-3 py-2 text-muted-foreground">{i.policy === "block" ? "Bloquea" : "Permite con aviso"}</td>
                          {data.canManage && (
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "receive", item: i })} aria-label={`Entrada de ${i.label}`}><PackagePlus className="h-4 w-4" aria-hidden="true" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "adjust", item: i })} aria-label={`Ajustar ${i.label}`}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
                                {data.canTransfer && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "transfer", item: i })} aria-label={`Traspasar ${i.label}`}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" /></Button>}
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "edit", item: i })} aria-label={`Editar ${i.label}`}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(i)} aria-label={`Dejar de controlar ${i.label}`}><XCircle className="h-4 w-4" aria-hidden="true" /></Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr><td colSpan={99} className="px-3 py-6 text-center text-muted-foreground">Ningún artículo coincide con el filtro.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="historial">
              <History data={data} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {adding && <TrackDialog open={adding} onClose={() => setAdding(false)} />}
      {action && data && <ActionDialog action={action} sites={data.sites} primarySiteId={data.primarySiteId} onClose={() => setAction(null)} />}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dejar de controlar «{removing?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>Se venderá como siempre, sin descontar ni bloquear. Las existencias y el historial se conservan por si vuelves a activarlo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (removing) untrack.mutate({ itemId: removing.id }); }} disabled={untrack.isPending}>Dejar de controlar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
