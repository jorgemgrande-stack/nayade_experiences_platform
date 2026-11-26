/**
 * Centro de gestión de la suscripción (/admin/suscripcion) para empresas con contratación formalizada.
 *
 * Solo presenta lo que calcula el servidor (`subscription.billingCenter`, contrato en shared/billingCenter.ts): no se
 * calcula ningún importe ni se decide ninguna acción económica aquí. Conceptos que NO se mezclan:
 *  - factura de 0 € (documento sin cobro) y cobro (factura pagada con importe > 0);
 *  - método de pago autorizado y mensualidad pagada;
 *  - plan de prueba y plan contratado;
 *  - «facturas emitidas» (ya existen) y «próximos importes previstos» (previsión).
 * El cliente nunca decide un identificador de Stripe: de la lista solo envía el `id` opaco de la factura.
 */
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarClock, CreditCard, Download, FileText, Layers, Lock, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { BillingCenterHero } from "./BillingCenterHero";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import type {
  BillingCenterInvoice,
  BillingCenterPayment,
  BillingInvoiceLinks,
  BillingInvoiceState,
  BillingPaymentStatus,
  BillingStage,
  TenantBillingCenter,
} from "@shared/billingCenter";

/** Centro de suscripción de ESTA empresa (el servidor lo resuelve desde la sesión; null sin canal con el plano de control). */
export function useBillingCenter(enabled = true) {
  return trpc.subscription.billingCenter.useQuery(undefined, { retry: false, staleTime: 60_000, enabled });
}

function useInvoiceLinks() {
  return trpc.subscription.billingInvoiceLinks.useMutation();
}

export const STAGE_TONE: Record<BillingStage, Tone> = {
  no_contract: "neutral",
  contract_pending_payment: "warning",
  trial_authorized: "info",
  active: "success",
  payment_issue: "danger",
  suspended: "danger",
  canceled: "neutral",
};

const PAYMENT_TONE: Record<BillingPaymentStatus, Tone> = {
  paid: "success",
  failed: "danger",
  pending: "warning",
  free: "neutral",
  refunded: "info",
  partially_refunded: "info",
  disputed: "danger",
};

const INVOICE_TONE: Record<BillingInvoiceState, Tone> = { paid: "success", open: "warning", free: "neutral", void: "neutral", uncollectible: "danger" };

/** Visor del documento imprimible de una factura del sistema (HTML aislado: sin scripts ni mismo origen). */
function DocumentDialog({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("subscription.center.invoices.docTitle")}</DialogTitle>
        </DialogHeader>
        <iframe title={t("subscription.center.invoices.docTitle")} sandbox="" srcDoc={html} className="h-[70vh] w-full rounded-md border border-border bg-white" />
      </DialogContent>
    </Dialog>
  );
}

/** Como PanelDataList, pero la tabla solo desde 1024 px: con 7-8 columnas, en tableta se lee mejor como tarjetas. */
function RowsList<T>({ rows, columns, rowKey, caption }: { rows: T[]; columns: PanelColumn<T>[]; rowKey: (r: T) => string; caption: string }) {
  const [first, ...rest] = columns;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/40">
      <table className="hidden w-full text-sm lg:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-medium", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2.5 align-top", c.align === "right" && "text-right", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border lg:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="space-y-1.5 p-4 text-sm">
            <div className="min-w-0 break-words font-medium text-foreground">{first.cell(r)}</div>
            {rest.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-xs text-muted-foreground">{c.header}</span>
                <span className="min-w-0 break-words text-right">{c.cell(r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ id, title, text, children, tone = "solid", icon }: { id?: string; title: string; text?: string; children: ReactNode; tone?: "solid" | "forecast"; icon?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn("scroll-mt-4 min-w-0 space-y-5 p-5 sm:p-7", tone === "forecast" ? "bc-card-forecast" : "bc-card")}>
      <div className="flex items-start gap-3.5">
        {icon && (
          <span className="bc-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="min-w-0 pt-0.5">
          <h2 id={id ? `${id}-h` : undefined} className="text-lg font-bold tracking-tight text-foreground">
            {title}
          </h2>
          {text && <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Stat({ icon, label, value, detail, tone, small }: { icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode; tone?: Tone; small?: boolean }) {
  return (
    <div className="bc-stat flex min-w-0 items-start gap-4 p-5">
      <span className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", tone ? `${TONE_ICON[tone]}` : "bc-chip")} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={cn("mt-0.5 break-words font-extrabold leading-tight tracking-tight tabular-nums text-foreground", small ? "text-xl" : "text-2xl sm:text-3xl")}>{value}</p>
        {detail && <p className="mt-1 break-words text-sm text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

const TONE_ICON: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
  neutral: "bg-muted text-muted-foreground",
  brand: "bc-chip",
};

export function BillingCenterView({ center, onPortal, portalBusy, children }: { center: TenantBillingCenter; onPortal: () => void; portalBusy: boolean; children?: ReactNode }) {
  const { t, format: f } = useI18n();
  const links = useInvoiceLinks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const date = (ms: number | null | undefined) => (ms ? f.date(ms, { day: "numeric", month: "short", year: "numeric" }) : null);
  const money = (cents: number | null | undefined, currency: string) => (cents == null ? "—" : f.currency(cents / 100, currency));
  const planName = center.contracted?.planName ?? null;
  const interval = center.fee?.interval ?? center.contracted?.interval ?? null;
  const intervalLabel = interval === "year" ? t("subscription.center.plan.perYear") : interval === "month" ? t("subscription.center.plan.perMonth") : "";
  const trialDiffers = !!center.trial?.planName && !!planName && center.trial.planName !== planName;

  const openInvoice = async (inv: BillingCenterInvoice) => {
    setBusyId(inv.id);
    try {
      const r = await links.mutateAsync({ id: inv.id });
      if (inv.source === "crm" && r.documentHtml) setDocHtml(r.documentHtml);
      else if (r.pdfUrl || r.hostedUrl) window.open((r.pdfUrl ?? r.hostedUrl) as string, "_blank", "noopener,noreferrer");
      else if (r.documentHtml) setDocHtml(r.documentHtml);
      else toast.error(t("subscription.center.invoices.noLinks"));
    } catch {
      toast.error(t("subscription.center.invoices.linksError"));
    } finally {
      setBusyId(null);
    }
  };

  // Próximo cobro: fecha de Stripe; durante la prueba es el primer cobro, no una mensualidad ya pagada
  const next = center.nextCharge;
  const nextDate = date(next?.at);
  const nextEstimated = next?.estimatedTotalCents != null ? money(next.estimatedTotalCents, next.currency) : null;
  const last = center.lastPayment;
  const pm = center.paymentMethod.state;
  const hasPeriod = !!center.billingPeriod && !!(center.billingPeriod.start || center.billingPeriod.end);

  const paymentColumns: PanelColumn<BillingCenterPayment>[] = [
    {
      key: "date",
      header: t("subscription.center.payments.date"),
      cell: (p) => (
        <span className="tabular-nums">
          {date(p.at) ?? t("subscription.center.payments.noDate")}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`subscription.center.payments.kind_${p.kind}`)}</span>
        </span>
      ),
    },
    { key: "amount", header: t("subscription.center.payments.amount"), align: "right", cell: (p) => <span className="whitespace-nowrap font-medium tabular-nums">{money(p.amountCents, p.currency)}</span> },
    { key: "period", header: t("subscription.center.payments.period"), cell: (p) => <span className="tabular-nums">{date(p.periodStart) ?? "—"}</span> },
    {
      key: "status",
      header: t("subscription.center.payments.status"),
      cell: (p) => <StatusBadge tone={PAYMENT_TONE[p.status]}>{t(`subscription.center.payments.status_${p.status}`)}</StatusBadge>,
    },
    { key: "reference", header: t("subscription.center.payments.reference"), className: "max-w-[10rem]", cell: (p) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground" title={p.reference ?? undefined}>{p.reference ?? "—"}</span> },
    { key: "invoice", header: t("subscription.center.payments.invoice"), cell: (p) => p.invoiceNumber ?? "—" },
    { key: "refund", header: t("subscription.center.payments.refund"), align: "right", cell: (p) => (p.refundedCents ? <span className="tabular-nums">{money(p.refundedCents, p.currency)}</span> : "—") },
  ];

  const invoiceColumns: PanelColumn<BillingCenterInvoice>[] = [
    {
      key: "number",
      header: t("subscription.center.invoices.number"),
      cell: (i) => (
        <span className="font-medium">
          {i.number ?? t("subscription.center.invoices.noNumber")}
          {i.free && <span className="ml-2 inline-block"><StatusBadge tone="neutral">{t("subscription.center.invoices.free")}</StatusBadge></span>}
        </span>
      ),
    },
    { key: "date", header: t("subscription.center.invoices.date"), cell: (i) => <span className="whitespace-nowrap tabular-nums">{date(i.issuedAt) ?? "—"}</span> },
    { key: "concept", header: t("subscription.center.invoices.concept"), cell: (i) => i.concept ?? "—" },
    { key: "base", header: t("subscription.center.invoices.base"), align: "right", cell: (i) => <span className="whitespace-nowrap tabular-nums">{money(i.baseCents, i.currency)}</span> },
    { key: "tax", header: t("subscription.center.invoices.tax"), align: "right", cell: (i) => <span className="whitespace-nowrap tabular-nums">{money(i.taxCents, i.currency)}</span> },
    { key: "total", header: t("subscription.center.invoices.total"), align: "right", cell: (i) => <span className="whitespace-nowrap font-semibold tabular-nums">{money(i.totalCents, i.currency)}</span> },
    { key: "state", header: t("subscription.center.invoices.status"), cell: (i) => <StatusBadge tone={INVOICE_TONE[i.state]}>{t(`subscription.center.invoices.state_${i.state}`)}</StatusBadge> },
    {
      key: "doc",
      header: t("subscription.center.invoices.document"),
      align: "right",
      cell: (i) =>
        i.hasDocument ? (
          <Button type="button" size="sm" variant="outline" disabled={busyId === i.id} onClick={() => void openInvoice(i)}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {busyId === i.id ? t("subscription.center.invoices.downloading") : t("subscription.center.invoices.download")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Cabecera (estado, planes, próximo cobro) y, debajo, lo que la cabecera no dice */}
      <BillingCenterHero center={center} onPortal={onPortal} portalBusy={portalBusy} />
      <section aria-label={t("subscription.center.summary.paymentMethod")} className={cn("grid gap-4 sm:grid-cols-2", hasPeriod ? "xl:grid-cols-3" : "")}>
        <Stat icon={<CreditCard />} label={t("subscription.center.summary.paymentMethod")} value={t(`subscription.center.summary.${pm}`)} detail={pm === "authorized" ? t("subscription.center.summary.authorizedNote") : undefined} tone={pm === "authorized" ? "success" : pm === "missing" ? "warning" : "neutral"} />
        <Stat
          icon={<Receipt />}
          label={t("subscription.center.summary.lastPayment")}
          value={last ? money(last.amountCents, last.currency) : t("subscription.center.summary.noneYet")}
          detail={last ? [date(last.at), last.invoiceNumber ? t("subscription.center.summary.invoice", { number: last.invoiceNumber }) : null].filter(Boolean).join(" · ") : undefined}
          tone={last ? "success" : "neutral"}
        />
        {hasPeriod && (
          <Stat
            icon={<CalendarClock />}
            label={t("subscription.center.plan.period")}
            value={t("subscription.center.plan.periodRange", { from: date(center.billingPeriod?.start) ?? "—", to: date(center.billingPeriod?.end) ?? "—" })}
            detail={intervalLabel || undefined}
            small
          />
        )}
      </section>

      {/* 2. Plan y condiciones */}
      <Panel id="condiciones" title={t("subscription.center.plan.title")} icon={<Layers />}>
        {center.fee ? (
          <div className="space-y-4">
            <p className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-foreground sm:text-5xl">
              {money(center.fee.totalCents, center.fee.currency)}
              {intervalLabel && <span className="ml-2 text-base font-semibold text-muted-foreground">{intervalLabel}</span>}
            </p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label={t("subscription.center.plan.net")}>{money(center.fee.netCents, center.fee.currency)}</Field>
              <Field label={t("subscription.center.plan.tax")}>{money(center.fee.taxCents, center.fee.currency)}</Field>
              <Field label={t("subscription.center.plan.total")}>{money(center.fee.totalCents, center.fee.currency)}</Field>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("subscription.center.plan.noFee")}</p>
        )}
        {trialDiffers && <p className="text-sm text-muted-foreground">{t("subscription.center.plan.trialDiffers", { trial: center.trial?.planName ?? "", contracted: planName ?? "" })}</p>}
        {center.included.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">{t("subscription.center.plan.included")}</p>
            <ul className="flex flex-wrap gap-2">
              {center.included.map((x) => (
                <li key={x} className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-foreground">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {/* 3. Historial de pagos (cobros reales; la factura de 0 € no es un cobro) */}
      <Panel id="pagos" title={t("subscription.center.payments.title")} text={t("subscription.center.payments.text")} icon={<CreditCard />}>
        {center.payments.length === 0 ? (
          <PanelEmpty icon={<CreditCard />} title={t("subscription.center.payments.empty")} description={t("subscription.center.payments.emptyText")} className="bg-background/40" />
        ) : (
          <RowsList rows={center.payments} columns={paymentColumns} rowKey={(p) => p.id} caption={t("subscription.center.payments.caption")} />
        )}
      </Panel>

      {/* 4. Facturas emitidas */}
      <Panel id="facturas" title={t("subscription.center.invoices.title")} text={t("subscription.center.invoices.text")} icon={<FileText />}>
        {center.invoices.length === 0 ? (
          <PanelEmpty icon={<FileText />} title={t("subscription.center.invoices.empty")} className="bg-background/40" />
        ) : (
          <RowsList rows={center.invoices} columns={invoiceColumns} rowKey={(i) => i.id} caption={t("subscription.center.invoices.caption")} />
        )}
      </Panel>

      {/* 5. Próximos importes (previsión) y acciones permitidas */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="proximo" tone="forecast" title={t("subscription.center.upcoming.title")} text={t("subscription.center.upcoming.text")} icon={<CalendarClock />}>
          {next && (nextDate || nextEstimated) ? (
            <div className="space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                {next.basis === "trial_end" ? t("subscription.center.upcoming.afterTrial") : t("subscription.center.upcoming.renewal")}
                <StatusBadge tone="neutral">{t("subscription.center.upcoming.forecast")}</StatusBadge>
              </p>
              {nextDate && <p className="text-sm text-foreground">{t("subscription.center.upcoming.on", { date: nextDate })}</p>}
              {nextEstimated && <p className="text-sm text-muted-foreground">{t("subscription.center.upcoming.estimated", { amount: nextEstimated })}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("subscription.center.upcoming.none")}</p>
          )}
        </Panel>
        <Panel id="acciones" title={t("subscription.center.actions.title")} icon={<Lock />}>
          <div className="space-y-3">
            {center.actions.portal ? (
              <>
                <p className="text-sm text-muted-foreground">{t("subscription.center.actions.portalText")}</p>
                <Button type="button" variant="outline" disabled={portalBusy} onClick={onPortal}>
                  {portalBusy ? t("subscription.common.opening") : t("subscription.center.actions.portal")}
                  <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("subscription.center.actions.noPortal")}</p>
            )}
            {!center.actions.selfServicePlanChange && (
              <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{center.actions.note ?? t("subscription.center.actions.planChangeBlocked")}</span>
              </p>
            )}
          </div>
        </Panel>
      </div>

      {children}
      {docHtml && <DocumentDialog html={docHtml} onClose={() => setDocHtml(null)} />}
    </div>
  );
}
