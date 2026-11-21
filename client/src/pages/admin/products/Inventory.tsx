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
import { useI18n } from "@/i18n/I18nProvider";
import type { Translate } from "@shared/i18n/core";
import { randomId } from "@shared/randomId";
import { MOVEMENT_KINDS, OVERSELL_POLICIES, type MovementKind, type OversellPolicy } from "@shared/inventory";

type Overview = inferRouterOutputs<AppRouter>["inventory"]["overview"];
type Item = Overview["items"][number];
type Site = Overview["sites"][number];

const newKey = () => randomId().replace(/[^A-Za-z0-9]/g, "");
const movementLabel = (t: Translate, k: MovementKind) => ({
  entrada: t("productsInventory.movement.entrada"),
  venta: t("productsInventory.movement.venta"),
  devolucion: t("productsInventory.movement.devolucion"),
  ajuste: t("productsInventory.movement.ajuste"),
  traspaso_salida: t("productsInventory.movement.traspaso_salida"),
  traspaso_entrada: t("productsInventory.movement.traspaso_entrada"),
})[k];
const oversellLabel = (t: Translate, p: OversellPolicy) => (p === "block" ? t("productsInventory.oversell.block") : t("productsInventory.oversell.allow"));
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
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const catalog = trpc.inventory.catalog.useQuery(undefined, { enabled: open });
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("0");
  const [policy, setPolicy] = useState<OversellPolicy>("block");
  const [min, setMin] = useState("0");
  const track = trpc.inventory.track.useMutation({
    onSuccess: () => {
      toast.success(t("productsInventory.track.done"));
      utils.inventory.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const product = catalog.data?.find((p) => String(p.id) === productId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = intOf(min);
    if (!product) return toast.error(t("productsInventory.track.pickProduct"));
    if (!(m >= 0)) return toast.error(t("productsInventory.common.minInt"));
    track.mutate({ productId: product.id, variantId: Number(variantId), policy, minStock: m });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("productsInventory.track.title")}</DialogTitle>
          <DialogDescription>{t("productsInventory.track.description")}</DialogDescription>
        </DialogHeader>
        {catalog.isLoading ? <PanelLoading label={t("productsInventory.track.loadingCatalog")} /> : catalog.isError ? <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title={t("productsInventory.track.catalogError")} /> : (
          <form onSubmit={submit} className="space-y-4">
            <FormField id="inv-product" label={t("productsInventory.common.product")} required>
              <select id="inv-product" className={selectClass} value={productId} onChange={(e) => { setProductId(e.target.value); setVariantId("0"); }}>
                <option value="">{t("productsInventory.track.pickOption")}</option>
                {catalog.data?.map((p) => <option key={p.id} value={p.id}>{p.title}{p.active ? "" : t("productsInventory.track.inactive")}</option>)}
              </select>
            </FormField>
            {product && product.variants.length > 0 && (
              <FormField id="inv-variant" label={t("productsInventory.track.whatToTrack")} hint={t("productsInventory.track.whatToTrackHint")}>
                <select id="inv-variant" className={selectClass} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="0">{t("productsInventory.track.wholeProduct")}{product.tracked ? t("productsInventory.track.alreadyTracked") : ""}</option>
                  {product.variants.map((v) => <option key={v.id} value={v.id}>{t("productsInventory.track.variantPrefix", { name: v.name })}{v.tracked ? t("productsInventory.track.variantAlreadyTracked") : ""}</option>)}
                </select>
              </FormField>
            )}
            <FormField id="inv-policy" label={t("productsInventory.common.oversellLabel")}>
              <select id="inv-policy" className={selectClass} value={policy} onChange={(e) => setPolicy(e.target.value as OversellPolicy)}>
                {OVERSELL_POLICIES.map((p) => <option key={p} value={p}>{oversellLabel(t, p)}</option>)}
              </select>
            </FormField>
            <FormField id="inv-min" label={t("productsInventory.common.minAlert")} hint={t("productsInventory.track.minHint")}>
              <Input id="inv-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>{t("productsInventory.common.cancel")}</Button>
              <Button type="submit" disabled={track.isPending}>{t("productsInventory.track.add")}</Button>
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
  const { t } = useI18n();
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
  const receive = trpc.inventory.receive.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? t("productsInventory.action.receiveDone", { n: r.onHand }) : t("productsInventory.action.receiveDup")) });
  const adjust = trpc.inventory.adjust.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? t("productsInventory.action.adjustDone", { n: r.onHand }) : t("productsInventory.action.adjustDup")) });
  const transfer = trpc.inventory.transfer.useMutation({ ...opts, onSuccess: (r) => done(r.applied ? t("productsInventory.action.transferDone", { from: r.fromOnHand, to: r.toOnHand }) : t("productsInventory.action.transferDup")) });
  const update = trpc.inventory.update.useMutation(opts);
  const setSiteMin = trpc.inventory.setSiteMin.useMutation(opts);
  const pending = receive.isPending || adjust.isPending || transfer.isPending || update.isPending || setSiteMin.isPending;
  const siteArg = (s: string) => (sites.length > 1 ? s : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = intOf(quantity);
    if (kind === "edit") {
      const m = intOf(min);
      if (!(m >= 0)) return toast.error(t("productsInventory.common.minInt"));
      try {
        await update.mutateAsync({ itemId: item.id, policy, minStock: m });
        for (const l of item.levels) {
          const raw = (siteMins[l.siteId] ?? "").trim();
          const next = raw === "" ? null : intOf(raw);
          if (next !== null && !(next >= 0)) return toast.error(t("productsInventory.action.siteMinsInt"));
          if (next !== l.minStock) await setSiteMin.mutateAsync({ itemId: item.id, siteId: siteArg(l.siteId), minStock: next });
        }
        done(t("productsInventory.action.saved"));
      } catch {
        /* el error ya se ha mostrado */
      }
      return;
    }
    if (kind === "adjust") {
      if (!Number.isInteger(q) || (mode === "set" ? q < 0 : q === 0)) return toast.error(mode === "set" ? t("productsInventory.action.countRequired") : t("productsInventory.action.deltaRequired"));
      if (reason.trim().length < 3) return toast.error(t("productsInventory.action.reasonRequired"));
      return adjust.mutate({ itemId: item.id, siteId: siteArg(site), mode, quantity: q, reason: reason.trim(), key });
    }
    if (!(q > 0)) return toast.error(t("productsInventory.action.qtyRequired"));
    if (kind === "receive") return receive.mutate({ itemId: item.id, siteId: siteArg(site), quantity: q, reason: reason.trim() || undefined, reference: reference.trim() || undefined, key });
    if (site === toSite) return toast.error(t("productsInventory.action.twoSites"));
    transfer.mutate({ itemId: item.id, fromSiteId: site, toSiteId: toSite, quantity: q, reason: reason.trim() || undefined, key });
  };

  const title = { receive: t("productsInventory.action.titleReceive"), adjust: t("productsInventory.action.titleAdjust"), transfer: t("productsInventory.action.titleTransfer"), edit: t("productsInventory.action.titleEdit") }[kind];
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
              <FormField id="act-policy" label={t("productsInventory.common.oversellLabel")}>
                <select id="act-policy" className={selectClass} value={policy} onChange={(e) => setPolicy(e.target.value as OversellPolicy)}>
                  {OVERSELL_POLICIES.map((p) => <option key={p} value={p}>{oversellLabel(t, p)}</option>)}
                </select>
              </FormField>
              <FormField id="act-min" label={t("productsInventory.common.minAlert")} hint={t("productsInventory.action.minHint")}>
                <Input id="act-min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
              </FormField>
              {sites.length > 1 && item.levels.map((l) => (
                <FormField key={l.siteId} id={`act-min-${l.siteId}`} label={t("productsInventory.action.minAt", { site: sites.find((s) => s.siteId === l.siteId)?.name ?? l.siteId })} hint={t("productsInventory.action.minAtHint")}>
                  <Input id={`act-min-${l.siteId}`} inputMode="numeric" value={siteMins[l.siteId] ?? ""} onChange={(e) => setSiteMins((m) => ({ ...m, [l.siteId]: e.target.value }))} />
                </FormField>
              ))}
            </>
          ) : (
            <>
              <SiteSelect id="act-site" sites={sites} value={site} onChange={setSite} label={kind === "transfer" ? t("productsInventory.action.fromSite") : t("productsInventory.common.site")} />
              {kind === "transfer" && <SiteSelect id="act-to" sites={sites} value={toSite} onChange={setToSite} label={t("productsInventory.action.toSite")} />}
              <p className="text-sm text-muted-foreground">{sites.length > 1 ? t("productsInventory.action.currentStockSite") : t("productsInventory.action.currentStock")}: <strong className="tabular-nums text-foreground">{onHandAt(site)}</strong></p>
              {kind === "adjust" && (
                <FormField id="act-mode" label={t("productsInventory.action.adjustType")}>
                  <select id="act-mode" className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as "delta" | "set")}>
                    <option value="delta">{t("productsInventory.action.modeDelta")}</option>
                    <option value="set">{t("productsInventory.action.modeSet")}</option>
                  </select>
                </FormField>
              )}
              <FormField id="act-qty" label={kind === "adjust" ? (mode === "set" ? t("productsInventory.action.count") : t("productsInventory.action.unitsPlusMinus")) : t("productsInventory.action.units")} required>
                <Input id="act-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={kind === "adjust" && mode === "delta" ? "-2" : "10"} />
              </FormField>
              {kind === "receive" && (
                <FormField id="act-ref" label={t("productsInventory.action.document")} hint={t("productsInventory.action.documentHint")}>
                  <Input id="act-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
                </FormField>
              )}
              <FormField id="act-reason" label={t("productsInventory.action.reason")} required={kind === "adjust"} hint={kind === "adjust" ? t("productsInventory.action.reasonHint") : undefined}>
                <Input id="act-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t("productsInventory.common.cancel")}</Button>
            <Button type="submit" disabled={pending}>{t("productsInventory.action.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Historial ───────────────────────────────────────────────────────────────

function History({ data }: { data: Overview }) {
  const { t, format } = useI18n();
  const fmtDateTime = (ms: number) => format.dateTime(new Date(ms), { dateStyle: "short", timeStyle: "short" });
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
  const siteName = (stored: string | null) => data.sites.find((s) => s.siteId === (stored ?? data.primarySiteId))?.name ?? stored ?? t("productsInventory.history.mainSite");
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / limit));
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await utils.inventory.exportCsv.fetch({ ...filter, what: "movimientos" });
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      toast.error(errorMessage(e, t("productsInventory.history.exportError")));
    } finally {
      setExporting(false);
    }
  };
  const reset = () => setPage(1);
  return (
    <section aria-labelledby="hist-title" className="space-y-3">
      <h2 id="hist-title" className="sr-only">{t("productsInventory.history.title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <FormField id="h-item" label={t("productsInventory.common.item")}>
          <select id="h-item" className={selectClass} value={itemId} onChange={(e) => { setItemId(e.target.value); reset(); }}>
            <option value="">{t("productsInventory.common.all")}</option>
            {data.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </FormField>
        {data.sites.length > 1 && (
          <FormField id="h-site" label={t("productsInventory.common.site")}>
            <select id="h-site" className={selectClass} value={siteId} onChange={(e) => { setSiteId(e.target.value); reset(); }}>
              <option value="">{t("productsInventory.common.allFem")}</option>
              {data.sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="h-kind" label={t("productsInventory.history.movement")}>
          <select id="h-kind" className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>
            <option value="">{t("productsInventory.common.all")}</option>
            {MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{movementLabel(t, k)}</option>)}
          </select>
        </FormField>
        <FormField id="h-from" label={t("productsInventory.history.from")}>
          <Input id="h-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); reset(); }} />
        </FormField>
        <FormField id="h-to" label={t("productsInventory.history.to")}>
          <Input id="h-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); reset(); }} />
        </FormField>
        <div className="flex items-end">
          <Button variant="outline" onClick={exportCsv} disabled={exporting} className="w-full">
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsInventory.common.exportCsv")}
          </Button>
        </div>
      </div>
      {list.isLoading ? <PanelLoading label={t("productsInventory.history.loading")} /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} title={t("productsInventory.history.loadError")} /> : !list.data?.items.length ? (
        <PanelEmpty icon={<Boxes className="h-6 w-6" />} title={t("productsInventory.history.emptyTitle")} description={t("productsInventory.history.emptyText")} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.history.colDate")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.common.item")}</th>
                {data.sites.length > 1 && <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.common.site")}</th>}
                <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.history.movement")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("productsInventory.history.colQty")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("productsInventory.history.colAfter")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.history.colReason")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.history.colUser")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.items.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2">{m.label}</td>
                  {data.sites.length > 1 && <td className="px-3 py-2">{siteName(m.siteId)}</td>}
                  <td className="px-3 py-2">
                    {MOVEMENT_KINDS.includes(m.kind as MovementKind) ? movementLabel(t, m.kind as MovementKind) : m.kind}
                    {m.shortfall && <span className="ml-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{t("productsInventory.history.shortfall")}</span>}
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
            <span>{t("productsInventory.history.count", { n: list.data.total })}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("productsInventory.history.prev")}</Button>
              <span>{t("productsInventory.history.page", { page, pages })}</span>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t("productsInventory.history.next")}</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { t } = useI18n();
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
      toast.success(t("productsInventory.page.untracked"));
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
      toast.error(errorMessage(e, t("productsInventory.page.exportError")));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("productsInventory.title")}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t("productsInventory.intro")}
            </p>
          </div>
          {data?.canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsInventory.addProduct")}
            </Button>
          )}
        </div>

        {overview.isLoading ? <PanelLoading label={t("productsInventory.loading")} /> : overview.isError || !data ? <PanelError error={overview.error} onRetry={() => overview.refetch()} title={t("productsInventory.loadError")} /> : (
          <Tabs defaultValue="existencias">
            <TabsList>
              <TabsTrigger value="existencias">{t("productsInventory.tabStock")}</TabsTrigger>
              <TabsTrigger value="historial">{t("productsInventory.tabHistory")}</TabsTrigger>
            </TabsList>
            <TabsContent value="existencias" className="space-y-3">
              {lowCount > 0 && (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  {lowCount === 1 ? t("productsInventory.page.lowOne") : t("productsInventory.page.lowMany", { n: lowCount })}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full max-w-xs">
                  <FormField id="inv-search" label={t("productsInventory.page.search")}>
                    <Input id="inv-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("productsInventory.page.searchPlaceholder")} />
                  </FormField>
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
                  <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> {t("productsInventory.page.onlyAlerts")}
                </label>
                <Button variant="outline" className="ml-auto" onClick={exportStock} disabled={exporting}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsInventory.common.exportCsv")}
                </Button>
              </div>
              {data.items.length === 0 ? (
                <PanelEmpty icon={<Boxes className="h-6 w-6" />} title={t("productsInventory.page.emptyTitle")} description={data.canManage ? t("productsInventory.page.emptyManage") : t("productsInventory.page.emptyReadonly")} />
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.common.item")}</th>
                        {data.sites.map((s) => <th key={s.siteId} scope="col" className="px-3 py-2 text-right font-medium">{data.sites.length > 1 ? s.name : t("productsInventory.page.colStock")}</th>)}
                        {data.sites.length > 1 && <th scope="col" className="px-3 py-2 text-right font-medium">{t("productsInventory.page.colTotal")}</th>}
                        <th scope="col" className="px-3 py-2 font-medium">{t("productsInventory.page.colOversell")}</th>
                        {data.canManage && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">{t("productsInventory.page.colActions")}</span></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((i) => (
                        <tr key={i.id}>
                          <td className="px-3 py-2 font-medium text-foreground">{i.label}</td>
                          {i.levels.map((l) => (
                            <td key={l.siteId} className={cn("px-3 py-2 text-right tabular-nums", l.low && "font-semibold text-destructive")}>
                              {l.onHand}
                              {l.effectiveMin > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("productsInventory.page.minShort", { n: l.effectiveMin })}</span>}
                              {l.low && <span className="sr-only">{t("productsInventory.page.inAlert")}</span>}
                            </td>
                          ))}
                          {data.sites.length > 1 && <td className="px-3 py-2 text-right tabular-nums">{i.total}</td>}
                          <td className="px-3 py-2 text-muted-foreground">{i.policy === "block" ? t("productsInventory.page.policyBlock") : t("productsInventory.page.policyAllow")}</td>
                          {data.canManage && (
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "receive", item: i })} aria-label={t("productsInventory.page.ariaReceive", { label: i.label })}><PackagePlus className="h-4 w-4" aria-hidden="true" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "adjust", item: i })} aria-label={t("productsInventory.page.ariaAdjust", { label: i.label })}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
                                {data.canTransfer && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "transfer", item: i })} aria-label={t("productsInventory.page.ariaTransfer", { label: i.label })}><ArrowLeftRight className="h-4 w-4" aria-hidden="true" /></Button>}
                                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "edit", item: i })} aria-label={t("productsInventory.page.ariaEdit", { label: i.label })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(i)} aria-label={t("productsInventory.page.ariaUntrack", { label: i.label })}><XCircle className="h-4 w-4" aria-hidden="true" /></Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr><td colSpan={99} className="px-3 py-6 text-center text-muted-foreground">{t("productsInventory.page.noMatch")}</td></tr>
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
            <AlertDialogTitle>{t("productsInventory.page.untrackTitle", { label: removing?.label })}</AlertDialogTitle>
            <AlertDialogDescription>{t("productsInventory.page.untrackText")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("productsInventory.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (removing) untrack.mutate({ itemId: removing.id }); }} disabled={untrack.isPending}>{t("productsInventory.page.untrackConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
