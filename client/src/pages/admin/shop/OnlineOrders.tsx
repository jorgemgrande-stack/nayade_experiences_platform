/**
 * Pedidos de la tienda online (/admin/tienda/pedidos y /admin/tienda/pedidos/:pedido): listado con estados claros y
 * ficha del pedido con sus líneas, el comprador (enlace a su ficha del CRM), la factura y el cambio de estado.
 * Un pedido agrupa las líneas pagadas juntas (shared/shopOrders.ts).
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Mail, Package, Phone, Plus, Receipt, ShoppingBag, User } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { PanelDataList, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { CompactEmpty, SalesFamilyShell, SummaryStrip, ToolbarRow, type SummaryStripItem, type ToolbarChip } from "@/components/admin/SalesFamilyShell";
import { useVocabulary } from "@/lib/vocabulary";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { TONE_TEXT } from "@/lib/panelTones";
import { toastError } from "@/lib/errorMessage";
import { ORDER_STAGE_FLOW, STAGES_NOTIFIED, type OrderStage } from "@shared/shopOrders";
import { useFormat, useI18n } from "@/i18n/I18nProvider";

/** Importe en euros y fecha según el idioma de la interfaz. */
function useOrderFormat() {
  const f = useFormat();
  const eur = (cents: number) => f.currency(cents / 100);
  const fmtDate = (ms: number | null | undefined, withTime = false) => {
    if (!ms) return "—";
    return f.dateTime(ms, { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
  };
  return { eur, fmtDate };
}

const STAGE_TONE: Record<OrderStage, Tone> = {
  pending_payment: "warning",
  paid: "brand",
  prepared: "info",
  delivered: "success",
  cancelled: "neutral",
  failed: "danger",
};

export function StageBadge({ stage }: { stage: OrderStage }) {
  const { t } = useI18n();
  return <StatusBadge tone={STAGE_TONE[stage]}>{t(`shopOrders.stage.${stage}`)}</StatusBadge>;
}

const orderHref = (merchantOrder: string) => `/admin/tienda/pedidos/${encodeURIComponent(merchantOrder)}`;

const FILTERS: Array<OrderStage | "all"> = ["all", "pending_payment", "paid", "prepared", "delivered", "cancelled", "failed"];

export function OnlineOrdersList() {
  const { t } = useI18n();
  const voc = useVocabulary();
  const { eur, fmtDate } = useOrderFormat();
  const [stage, setStage] = useState<OrderStage | "all">("all");
  const [search, setSearch] = useState("");
  const q = trpc.reservations.onlineOrders.useQuery({ stage, search: search.trim() || undefined, limit: 100, offset: 0 }, { retry: false });
  const counts = q.data?.counts;
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  const toggleStage = (s: OrderStage) => setStage((cur) => (cur === s ? "all" : s));
  const strip: SummaryStripItem[] = [
    { key: "paid", label: t("shopOrders.stage.paid"), value: counts?.paid ?? 0, primary: true, tone: "brand", active: stage === "paid", onClick: () => toggleStage("paid") },
    { key: "pending_payment", label: t("shopOrders.stage.pending_payment"), value: counts?.pending_payment ?? 0, tone: "warning", active: stage === "pending_payment", onClick: () => toggleStage("pending_payment") },
    { key: "prepared", label: t("shopOrders.stage.prepared"), value: counts?.prepared ?? 0, tone: "info", active: stage === "prepared", onClick: () => toggleStage("prepared") },
    { key: "delivered", label: t("shopOrders.stage.delivered"), value: counts?.delivered ?? 0, tone: "success", active: stage === "delivered", onClick: () => toggleStage("delivered") },
  ];
  const chips: ToolbarChip[] = [
    ...(stage !== "all" ? [{ id: "stage", label: `${t("shopOrders.list.statusLabel")}: ${t(`shopOrders.stage.${stage}`)}`, onRemove: () => setStage("all") }] : []),
    ...(search.trim() ? [{ id: "search", label: `“${search.trim()}”`, onRemove: () => setSearch("") }] : []),
  ];
  const clearFilters = () => { setStage("all"); setSearch(""); };

  return (
    <AdminLayout title={voc.crmTitle}>
      <SalesFamilyShell
        active="reservations"
        action={<Button asChild><Link href="/admin/crm?tab=reservations&nuevo=1"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{voc.newOrder}</Link></Button>}
      >
        <h1 className="sr-only">{t("shopOrders.list.title")}</h1>
        <SummaryStrip items={strip} label={t("shopOrders.list.title")} />
        <ToolbarRow
          search={{ value: search, onChange: setSearch, placeholder: t("shopOrders.list.searchPlaceholder") }}
          filters={(
            <Select value={stage} onValueChange={(v) => setStage(v as OrderStage | "all")}>
              <SelectTrigger className="h-9 w-full bg-card text-sm sm:w-60" aria-label={t("shopOrders.list.filterByStatus")}><span className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-muted-foreground">{t("shopOrders.list.statusLabel")}:</span><SelectValue /></span></SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f} value={f}>{(f === "all" ? t("shopOrders.list.all") : t(`shopOrders.stage.${f}`)) + " (" + (f === "all" ? all : counts?.[f] ?? 0) + ")"}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          trailing={(
            <>
              <StatusBadge tone="brand" icon={<ShoppingBag />}>{t("salesShell.shopChannel")}</StatusBadge>
              <Button asChild variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground"><Link href="/admin/crm?tab=reservations">{t("salesShell.allOrders")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
            </>
          )}
          chips={chips}
          onClear={clearFilters}
          summary={chips.length > 0 && q.data ? t("shopOrders.list.showing", { shown: q.data.items.length, total: q.data.total }) : undefined}
        />
        {q.isLoading ? (
          <div className="flex justify-center rounded-xl border border-border bg-card py-12" role="status" aria-label={t("shopOrders.list.loading")}><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : q.error ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title={t("shopOrders.list.loadError")} />
        ) : !q.data?.items.length ? (
          <CompactEmpty
            icon={<ShoppingBag />}
            title={all === 0 ? t("shopOrders.list.emptyNone") : t("shopOrders.list.emptyFilter")}
            description={all === 0 ? t("shopOrders.list.emptyNoneText") : undefined}
            action={all > 0 ? <Button size="sm" variant="outline" onClick={clearFilters}>{t("shopOrders.list.seeAll")}</Button> : undefined}
          />
        ) : (
          <PanelDataList
            tableFrom="lg"
            className="shadow-sm [&_td]:py-2 [&_td]:align-middle"
            caption={t("shopOrders.list.title")}
            rows={q.data.items}
            rowKey={(o) => o.merchantOrder}
            columns={[
              { key: "pedido", header: t("shopOrders.list.colOrder"), cell: (o) => <Link href={orderHref(o.merchantOrder)} className="whitespace-nowrap font-mono font-medium text-primary hover:underline">{o.merchantOrder}</Link> },
              { key: "fecha", header: t("shopOrders.list.colDate"), cell: (o) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(o.createdAt)}</span> },
              { key: "cliente", header: t("shopOrders.list.colCustomer"), cell: (o) => <><div className="max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{o.customerName}</div><div className="max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{o.customerEmail}</div></> },
              { key: "articulos", header: t("shopOrders.list.colItems"), cell: (o) => <div className="max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">{o.productNames.join(", ")}</div> },
              { key: "total", header: t("shopOrders.list.colTotal"), align: "right", cell: (o) => <span className="font-medium tabular-nums text-foreground">{eur(o.totalCents)}</span> },
              { key: "estado", header: t("shopOrders.list.colStatus"), cell: (o) => <StageBadge stage={o.stage} /> },
            ]}
          />
        )}
        {q.data && q.data.total > q.data.items.length && <p className="text-xs text-muted-foreground">{t("shopOrders.list.showing", { shown: q.data.items.length, total: q.data.total })}</p>}
      </SalesFamilyShell>
    </AdminLayout>
  );
}

export function OnlineOrderDetail({ merchantOrder }: { merchantOrder: string }) {
  const { t } = useI18n();
  const f = useFormat();
  const { eur, fmtDate } = useOrderFormat();
  const utils = trpc.useUtils();
  const q = trpc.reservations.onlineOrder.useQuery({ merchantOrder }, { retry: false });
  const setStage = trpc.reservations.setOnlineOrderStage.useMutation({
    onSuccess: (r) => {
      const mailNote = !STAGES_NOTIFIED.includes(r.stage) ? "." : r.emailed ? t("shopOrders.detail.toastEmailed") : q.data?.buyerEmails ? t("shopOrders.detail.toastEmailFailed") : t("shopOrders.detail.toastTrial");
      toast.success(`${t("shopOrders.detail.toastBase", { stage: t(`shopOrders.stage.${r.stage}`).toLowerCase() })}${mailNote}`);
      utils.reservations.onlineOrder.invalidate({ merchantOrder });
      utils.reservations.onlineOrders.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const o = q.data;

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
        <Link href="/admin/tienda/pedidos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{t("shopOrders.detail.back")}</Link>
        {q.isLoading ? (
          <div className="flex justify-center py-16" role="status" aria-label={t("shopOrders.list.loading")}><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : q.isError ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title={t("shopOrders.list.loadError")} />
        ) : !o ? (
          <PanelEmpty icon={<ShoppingBag />} title={t("shopOrders.detail.notFound", { order: merchantOrder })}>
            <Button asChild size="sm" variant="outline"><Link href="/admin/tienda/pedidos">{t("shopOrders.detail.backToOrders")}</Link></Button>
          </PanelEmpty>
        ) : (
          <>
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-semibold text-foreground">{t("shopOrders.detail.orderTitle")} <span className="font-mono">{o.merchantOrder}</span></h1>
                <p className="text-sm text-muted-foreground">{t("shopOrders.detail.placedOn", { date: fmtDate(o.createdAt, true) })}{o.paidAt ? t("shopOrders.detail.paidOn", { date: fmtDate(o.paidAt, true) }) : ""}</p>
              </div>
              <StageBadge stage={o.stage} />
            </header>

            {/* Avance del pedido */}
            {o.stage !== "cancelled" && o.stage !== "failed" && (
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("shopOrders.detail.progress")}>
                {ORDER_STAGE_FLOW.map((s, i) => {
                  const done = ORDER_STAGE_FLOW.indexOf(o.stage) >= i;
                  return (
                    <li key={s} className={cn("rounded-lg border px-3 py-2 text-xs", done ? "border-primary/50 bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground")} aria-current={o.stage === s ? "step" : undefined}>
                      {i + 1}. {t(`shopOrders.stage.${s}`)}
                    </li>
                  );
                })}
              </ol>
            )}

            <section className="rounded-xl border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">{t("shopOrders.detail.changeStatus")}</h2>
              {o.stageChanges.length ? (
                <div className="flex flex-wrap gap-2">
                  {o.stageChanges.map((s) => (
                    <Button key={s} size="sm" variant={s === "cancelled" || ORDER_STAGE_FLOW.indexOf(s) < ORDER_STAGE_FLOW.indexOf(o.stage) ? "outline" : "default"} disabled={setStage.isPending} onClick={() => setStage.mutate({ merchantOrder: o.merchantOrder, stage: s })}>
                      {t(`shopOrders.action.${s}`)}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{o.stage === "failed" ? t("shopOrders.detail.failedNothing") : t("shopOrders.detail.closed")}</p>
              )}
              {(o.stage === "paid" || o.stage === "prepared" || o.stage === "delivered") && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {o.buyerEmails ? t("shopOrders.detail.notifyYes") : t("shopOrders.detail.notifyTrial")}{t("shopOrders.cancelPaidHint")}{" "}
                  <Link href={`/admin/crm?tab=reservations&resId=${o.firstLineId}`} className="font-medium text-primary hover:underline">{t("shopOrders.detail.openFull")}</Link>
                </p>
              )}
            </section>

            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-xl border border-border p-4 lg:col-span-2">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("shopOrders.detail.items")}</h2>
                <ul className="divide-y divide-border text-sm">
                  {o.lines.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0 break-words text-foreground">{l.productName}<span className="text-muted-foreground"> × {l.quantity}</span>{l.date && <span className="block text-xs text-muted-foreground">{t("shopOrders.detail.serviceDate", { date: f.date(new Date(l.date + "T00:00:00")) })}</span>}{l.participants.length > 0 && <span className="block text-xs text-muted-foreground break-words">{t("shopOrders.detail.participants", { names: l.participants.join(", ") })}</span>}</span>
                      <span className="shrink-0 tabular-nums text-foreground">{eur(l.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  {o.discountCents > 0 && <div className={cn("flex justify-between", TONE_TEXT.success)}><dt>{t("shopOrders.detail.discount")}</dt><dd>-{eur(o.discountCents)}</dd></div>}
                  <div className="flex justify-between font-semibold text-foreground"><dt>{o.paidCents > 0 ? t("shopOrders.detail.totalPaid") : t("shopOrders.detail.totalOrder")} <span className="font-normal text-muted-foreground">{t("shopOrders.detail.vatIncluded")}</span></dt><dd className="tabular-nums">{eur(o.totalCents)}</dd></div>
                </dl>
                {o.comments && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm text-foreground"><span className="block text-xs font-medium text-muted-foreground">{t("shopOrders.detail.customerComments")}</span>{o.comments}</p>}
              </section>

              <div className="space-y-5">
                <section className="rounded-xl border border-border p-4 text-sm">
                  <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("shopOrders.detail.customer")}</h2>
                  <p className="break-words font-medium text-foreground">{o.customerName}</p>
                  {o.customerEmail && <p className="mt-1 flex items-center gap-2 break-all text-muted-foreground"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><a href={`mailto:${o.customerEmail}`} className="hover:text-primary">{o.customerEmail}</a></p>}
                  {o.customerPhone && <p className="mt-1 flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><a href={`tel:${o.customerPhone.replace(/\s/g, "")}`} className="hover:text-primary">{o.customerPhone}</a></p>}
                  {o.billing && (
                    <div className="mt-3 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{t("shopOrders.detail.billingData")}</p>
                      <p>{t("shopOrders.detail.taxId", { nif: o.billing.nif })}</p>
                      {o.billing.name && <p className="break-words">{o.billing.name}</p>}
                      {o.billing.address && <p className="break-words">{o.billing.address}</p>}
                    </div>
                  )}
                  {o.consent && (
                    <div className="mt-3 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{t("shopOrders.detail.consentTitle")}</p>
                      <p className="break-words">{o.consent.text}</p>
                      <p>{t("shopOrders.detail.consentLine", { date: f.date(new Date(o.consent.acceptedAt)), hash: o.consent.textHash.slice(0, 10) })}</p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">{t("shopOrders.detail.buyerLanguage", { lang: o.buyerLocale })}</p>
                  {o.clientId ? (
                    <Link href={`/admin/crm/clientes/${o.clientId}`} className="mt-3 inline-block font-medium text-primary hover:underline">{t("shopOrders.detail.viewCustomer")}</Link>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">{t("shopOrders.detail.customerAdded")}</p>
                  )}
                </section>

                <section className="rounded-xl border border-border p-4 text-sm">
                  <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><Receipt className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("shopOrders.detail.invoice")}</h2>
                  {o.invoices.length ? (
                    <ul className="space-y-2">
                      {o.invoices.map((inv) => (
                        <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2">
                          <Link href={`/admin/crm?tab=invoices&search=${encodeURIComponent(inv.invoiceNumber)}`} className="whitespace-nowrap font-mono font-medium text-primary hover:underline">{inv.invoiceNumber}</Link>
                          <a href={inv.pdfUrl ?? `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">{t("shopOrders.detail.viewPdf")} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">{o.stage === "pending_payment" || o.stage === "failed" ? t("shopOrders.detail.invoiceAuto") : t("shopOrders.detail.noInvoice")}</p>
                  )}
                </section>
              </div>
            </div>

            {o.history.length > 0 && (
              <section className="rounded-xl border border-border p-4 text-sm">
                <h2 className="mb-3 font-semibold text-foreground">{t("shopOrders.detail.history")}</h2>
                <ol className="space-y-1 text-muted-foreground">
                  {o.history.map((h, i) => (
                    <li key={i}>{fmtDate(h.ts, true)} · {h.actor}: {h.from && h.from in STAGE_TONE ? t(`shopOrders.stage.${h.from as OrderStage}`) : h.from} → <span className="text-foreground">{h.to && h.to in STAGE_TONE ? t(`shopOrders.stage.${h.to as OrderStage}`) : h.to}</span></li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

export default OnlineOrdersList;
