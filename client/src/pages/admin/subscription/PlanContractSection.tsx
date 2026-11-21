/**
 * «Mi plan»: contrato vigente (precio, periodicidad, renovación), estado del cobro y facturas de la empresa.
 * Todo viene del plano de control (subscription.plan); aquí no se calcula ningún importe. Solo la administración.
 */
import { useRef, useState } from "react";
import { AlertTriangle, CalendarClock, FileText, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { CustomTermsSection } from "./CustomTermsSection";
import { useI18n } from "@/i18n/I18nProvider";
import type { Translate } from "@shared/i18n/core";

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };
const orderState = (t: Translate): Record<string, { label: string; warn?: boolean }> => ({
  active: { label: t("subscription.contract.state.active") },
  past_due: { label: t("subscription.contract.state.pastDue"), warn: true },
  suspended: { label: t("subscription.contract.state.suspended"), warn: true },
  cancel_scheduled: { label: t("subscription.contract.state.cancelScheduled"), warn: true },
});
const paymentLabels = (t: Translate): Record<string, string> => ({
  paid: t("subscription.contract.payment.paid"),
  pending: t("subscription.contract.payment.pending"),
  failed: t("subscription.contract.payment.failed"),
  refunded: t("subscription.contract.payment.refunded"),
});

function InvoiceViewer({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const doc = trpc.subscription.invoiceDocument.useQuery({ id }, { retry: false });
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("subscription.contract.invoice")}</DialogTitle>
        </DialogHeader>
        {doc.isLoading && <p className="text-sm text-muted-foreground">{t("subscription.contract.invoiceLoading")}</p>}
        {doc.isError && <p className="text-sm text-destructive">{doc.error.message}</p>}
        {doc.data && (
          <>
            {/* Aislada: sin scripts (el mismo origen solo para poder imprimirla desde aquí) */}
            <iframe ref={frame} title={t("subscription.contract.invoice")} sandbox="allow-same-origin allow-modals" srcDoc={doc.data} className="h-[70vh] w-full rounded-md border border-border bg-white" />
            <Button type="button" variant="outline" onClick={() => frame.current?.contentWindow?.print()}>
              {t("subscription.contract.print")}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PlanContractSection({ isTrial }: { isTrial: boolean }) {
  const { t, format: f } = useI18n();
  const fmtDate = (ms: number) => f.date(ms, { day: "numeric", month: "long", year: "numeric" });
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
  const intervalLabel = (i: string) => (i === "year" ? t("subscription.common.perYear") : t("subscription.common.perMonth"));
  const plan = trpc.subscription.plan.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [viewing, setViewing] = useState<number | null>(null);
  const p = plan.data;
  if (!p) return null;
  const c = p.contract;
  const st = c ? orderState(t)[c.state] : undefined;
  return (
    <>
    {/* Condiciones pactadas con la empresa (solo lectura, con la presentación elegida por Big Elephant) */}
    {p.customTerms && <CustomTermsSection terms={p.customTerms} />}
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="sub-contract">
      <h2 id="sub-contract" className="font-semibold text-foreground">{t("subscription.contract.title")}</h2>
      {!c ? (
        <p className="text-sm text-muted-foreground">
          {isTrial
            ? t("subscription.contract.trialText")
            : t("subscription.contract.managedText")}
        </p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("subscription.contract.plan")}</dt>
              <dd className="font-medium text-foreground">{t("subscription.contract.planInterval", { plan: PLAN_NAMES[c.plan] ?? c.plan, interval: c.interval === "year" ? t("subscription.common.perYear") : t("subscription.common.perMonth") })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{c.interval === "year" ? t("subscription.contract.amountYear") : t("subscription.contract.amountMonth")}</dt>
              <dd className="font-medium text-foreground">{p.customTerms ? t("subscription.common.vatPlus", { amount: money(p.customTerms.today.netCents, p.customTerms.current.currency) }) : c.recurringNetCents === null ? t("subscription.contract.byContract") : t("subscription.common.vatPlus", { amount: money(c.recurringNetCents, c.currency) })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{p.period?.cancelAt ? t("subscription.contract.endOfService") : t("subscription.contract.nextRenewal")}</dt>
              <dd className="font-medium text-foreground flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                {p.period?.cancelAt ? fmtDate(p.period.cancelAt) : p.period?.renewsAt ? fmtDate(p.period.renewsAt) : "—"}
              </dd>
            </div>
          </dl>
          {c.items.length > 0 && <p className="text-xs text-muted-foreground">{t("subscription.contract.modules", { items: c.items.join(", ") })}</p>}
          {st && (
            <div className={st.warn ? "flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "text-sm text-foreground"}>
              {st.warn && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              <span>
                {t("subscription.contract.paymentState")} <strong>{st.label}</strong>
                {c.state === "past_due" && c.graceEndsAt && t("subscription.contract.graceNote", { date: fmtDate(c.graceEndsAt) })}
              </span>
            </div>
          )}
        </>
      )}
      {p.invoices.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground"><Receipt className="w-4 h-4" aria-hidden="true" /> {t("subscription.contract.invoices")}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {p.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{i.number ?? "—"}</span>
                <span className="text-muted-foreground">{i.periodLabel ?? i.issueDate ?? ""}</span>
                <span className="ml-auto text-foreground">{money(i.totalCents, i.currency)}</span>
                <Badge variant="outline" className="text-[11px]">{i.kind === "rectification" ? t("subscription.contract.rectification") : (paymentLabels(t)[i.paymentStatus] ?? i.paymentStatus)}</Badge>
                <Button type="button" size="sm" variant="ghost" onClick={() => setViewing(i.id)} aria-label={t("subscription.contract.viewInvoice", { number: i.number ?? "" })}>
                  <FileText className="w-4 h-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {viewing !== null && <InvoiceViewer id={viewing} onClose={() => setViewing(null)} />}
    </section>
    </>
  );
}
