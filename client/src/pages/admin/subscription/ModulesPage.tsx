/**
 * Módulos y ampliaciones: qué tiene la empresa, qué está a la venta y qué se puede pedir (subscription.catalog).
 *
 * Comprar un módulo usa la compra que ya existe (subscription.purchasePreview → purchase): el importe y el prorrateo
 * los calcula SIEMPRE el plano de control; aquí solo se muestran. Las ampliaciones por unidades y lo que está «bajo
 * petición» se piden por el canal de contratación. Sin canal con el plano de control la página lo explica.
 *
 * Dar de baja un módulo o reducir una ampliación usa la reducción que ya existe (subscription.reductionPreview →
 * reduce): a fin de periodo, sin abonos y nunca por debajo del uso real (lo comprueba el plano de control).
 */
import { randomId } from "@shared/randomId";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Clock, Eye, PackageMinus, PackagePlus, Sparkles } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useI18n } from "@/i18n/I18nProvider";
import type { Translate } from "@shared/i18n/core";

type ModuleState = "active" | "read_only" | "available" | "on_request" | "in_preparation" | "coming_soon";
interface PanelModule {
  key: string;
  name: string;
  family: string;
  kind: "module" | "quantity";
  metric: string | null;
  step: number | null;
  state: ModuleState;
  purchasable: boolean;
  monthly: { amountCents: number; currency: string; taxIncluded: boolean; unit: string | null } | null;
}
interface PreviewLine {
  productKey: string;
  name: string;
  kind: "module" | "quantity";
  fromQuantity: number;
  toQuantity: number;
}
interface Preview {
  currency: string;
  amountDueCents: number;
  taxCents: number | null;
  lines: PreviewLine[];
  recurringDeltaCents: number;
  interval: "month" | "year";
}
interface PurchaseResult {
  status: "applied" | "payment_pending" | "processing" | "expired" | "failed";
  paymentUrl: string | null;
}

const familyLabels = (t: Translate): Record<string, string> => ({
  net_module: t("subscription.modules.family.sector"),
  industry_module: t("subscription.modules.family.sector"),
  net_bundle: t("subscription.modules.family.sectorBundles"),
  connect: t("subscription.modules.family.connect"),
  extension: t("subscription.modules.family.connect"),
  connect_bundle: t("subscription.modules.family.connectBundles"),
  addon: t("subscription.modules.family.addons"),
  extra: t("subscription.modules.family.addons"),
});

const stateMeta = (t: Translate): Record<ModuleState, { label: string; icon: typeof CheckCircle2; tone: string }> => ({
  active: { label: t("subscription.modules.state.active"), icon: CheckCircle2, tone: "bg-success/10 text-success" },
  read_only: { label: t("subscription.modules.state.readOnly"), icon: Eye, tone: "bg-warning/10 text-warning" },
  available: { label: t("subscription.modules.state.available"), icon: Sparkles, tone: "bg-info/10 text-info" },
  on_request: { label: t("subscription.modules.state.onRequest"), icon: PackagePlus, tone: "bg-muted text-foreground" },
  in_preparation: { label: t("subscription.modules.state.inPreparation"), icon: Clock, tone: "bg-muted text-muted-foreground" },
  coming_soon: { label: t("subscription.modules.state.comingSoon"), icon: Clock, tone: "bg-muted text-muted-foreground" },
});

const newKey = () => randomId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(16, "0");

function Price({ m }: { m: PanelModule }) {
  const { t, format: f } = useI18n();
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
  if (!m.monthly) return null;
  return (
    <p className="text-sm text-foreground">
      {money(m.monthly.amountCents, m.monthly.currency)}
      <span className="text-muted-foreground">
        {t("subscription.modules.priceMonth")}{m.monthly.unit ? t("subscription.modules.priceUnit", { unit: m.monthly.unit }) : ""}
        {m.monthly.taxIncluded ? t("subscription.modules.vatIncluded") : t("subscription.modules.vatExcluded")}
      </span>
    </p>
  );
}

const metricLabel = (t: Translate): Record<string, string> => ({ users: t("subscription.modules.metric.users"), sites: t("subscription.modules.metric.sites"), storage_gb: t("subscription.modules.metric.storage") });
const METRIC_FIELD: Record<string, "users" | "sites" | "storageGb"> = { users: "users", sites: "sites", storage_gb: "storageGb" };

/**
 * Vista previa y confirmación de una compra: un módulo entero, o el NUEVO total de una ampliación por unidades
 * (usuarios, sedes, almacenamiento) a partir del total contratado hoy.
 */
function PurchaseDialog({ module, current, onClose }: { module: PanelModule; current: number | null; onClose: () => void }) {
  const { t, format: f } = useI18n();
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
  const utils = trpc.useUtils();
  const [key] = useState(newKey);
  const quantity = module.kind === "quantity" && module.metric !== null && current !== null;
  const step = module.step ?? 1;
  const [total, setTotal] = useState(quantity ? current! + step : 0);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const what = quantity ? { [METRIC_FIELD[module.metric!]]: total } : { add: [module.key] };
  const preview = trpc.subscription.purchasePreview.useMutation();
  const buy = trpc.subscription.purchase.useMutation({
    onSuccess: (r) => {
      const res = r as PurchaseResult;
      setResult(res);
      if (res.status === "applied") {
        toast.success(quantity ? t("subscription.modules.toastExpanded") : t("subscription.modules.toastActive", { name: module.name }));
        void utils.subscription.catalog.invalidate();
        void utils.subscription.overview.invalidate();
        void utils.panel.navigation.invalidate();
      }
    },
    onError: (e) => toast.error(e.message),
  });
  // Módulo: la vista previa se pide al abrir. Ampliación: al pulsar «Calcular importe» con el total elegido
  const { mutate: requestPreview, reset: resetPreview } = preview;
  useEffect(() => {
    if (!quantity) requestPreview({ add: [module.key] });
  }, [requestPreview, module.key, quantity]);
  const p = preview.data as Preview | undefined;
  const valid = !quantity || (Number.isInteger(total) && total >= current! + step && (total - current!) % step === 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{quantity ? t("subscription.modules.expandTitle", { what: metricLabel(t)[module.metric!] ?? module.name }) : t("subscription.modules.addTitle", { name: module.name })}</DialogTitle>
          <DialogDescription>{t("subscription.modules.dialogDesc")}</DialogDescription>
        </DialogHeader>

        {quantity && !result && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {t("subscription.modules.nowHave", { current, what: metricLabel(t)[module.metric!] })}
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-foreground">{t("subscription.modules.newTotal")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={current! + step}
                  step={step}
                  value={Number.isFinite(total) ? total : ""}
                  onChange={(e) => {
                    setTotal(Number(e.target.value));
                    resetPreview();
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
                />
              </label>
              <Button type="button" variant="outline" disabled={!valid || preview.isPending} onClick={() => requestPreview(what)}>
                {t("subscription.modules.calcAmount")}
              </Button>
            </div>
            {!valid && (
              <p className="text-xs text-danger">
                {t("subscription.modules.totalHigher", { mult: step > 1 ? t("subscription.modules.multiples", { step }) : "" })}
              </p>
            )}
          </div>
        )}

        {preview.isPending && <PanelLoading label={t("subscription.change.calculating")} />}
        {preview.isError && <p className="text-sm text-danger">{preview.error.message}</p>}

        {p && !result && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {p.lines.map((l) => (
                <li key={l.productKey} className="flex justify-between gap-3">
                  <span className="text-foreground">{l.name}</span>
                  {l.kind === "quantity" && (
                    <span className="text-muted-foreground">
                      {l.fromQuantity} → {l.toQuantity}
                    </span>
                  )}
                  {l.kind === "module" && l.toQuantity === 0 && <span className="text-muted-foreground">{t("subscription.modules.stopsSeparate")}</span>}
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-muted/50 p-3 space-y-1">
              <p className="flex justify-between gap-3">
                <span>{t("subscription.modules.dueNow")}</span>
                <strong>{money(p.amountDueCents, p.currency)}</strong>
              </p>
              {p.taxCents !== null && <p className="text-xs text-muted-foreground">{t("subscription.change.includesTax", { amount: money(p.taxCents, p.currency) })}</p>}
              <p className="text-xs text-muted-foreground">
                {p.recurringDeltaCents < 0 ? t("subscription.modules.afterLess", { amount: money(Math.abs(p.recurringDeltaCents), p.currency), per: p.interval === "year" ? t("subscription.plans.intervalYear") : t("subscription.plans.intervalMonth"), tax: p.taxCents === null ? t("subscription.change.taxAside") : "" }) : t("subscription.modules.afterMore", { amount: money(Math.abs(p.recurringDeltaCents), p.currency), per: p.interval === "year" ? t("subscription.plans.intervalYear") : t("subscription.plans.intervalMonth"), tax: p.taxCents === null ? t("subscription.change.taxAside") : "" })}
              </p>
            </div>
          </div>
        )}

        {result?.status === "applied" && (
          <p className="text-sm text-success">
            {quantity ? t("subscription.modules.doneExpanded") : t("subscription.modules.doneActive", { name: module.name })}
          </p>
        )}
        {result?.status === "processing" && <p className="text-sm text-foreground">{t("subscription.modules.processing")}</p>}
        {result?.status === "payment_pending" && (
          <p className="text-sm text-foreground">{t("subscription.modules.paymentPending")}</p>
        )}
        {(result?.status === "failed" || result?.status === "expired") && (
          <p className="text-sm text-danger">{t("subscription.modules.purchaseFailed")}</p>
        )}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("subscription.common.cancel")}
              </Button>
              <Button type="button" disabled={!p || !valid || buy.isPending} onClick={() => buy.mutate({ ...what, idempotencyKey: key })}>
                {buy.isPending ? t("subscription.change.processing") : t("subscription.change.confirmPay")}
              </Button>
            </>
          )}
          {result?.status === "payment_pending" && result.paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(result.paymentUrl!)}>
              {t("subscription.change.completePayment")}
              <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Button>
          )}
          {result && (
            <Button type="button" variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReductionPreview {
  lines: Array<PreviewLine & { unitAmountCents?: number }>;
  recurringDeltaCents: number;
  effectiveAt: number | null;
  interval: "month" | "year";
}

/**
 * Vista previa y confirmación de una baja de módulo o de una reducción de ampliación (nuevo total menor que el
 * actual). Se aplica al final del periodo pagado, sin abonos; hasta entonces todo sigue disponible.
 */
function ReductionDialog({ module, current, onClose }: { module: PanelModule; current: number | null; onClose: () => void }) {
  const { t, format: f } = useI18n();
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
  const fmtDate = (ms: number) => f.date(ms, { day: "numeric", month: "long", year: "numeric" });
  const utils = trpc.useUtils();
  const [key] = useState(newKey);
  const quantity = module.kind === "quantity" && module.metric !== null && current !== null;
  const step = module.step ?? 1;
  const [total, setTotal] = useState(quantity ? Math.max(current! - step, 0) : 0);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const what = quantity ? { [METRIC_FIELD[module.metric!]]: total } : { remove: [module.key] };
  const preview = trpc.subscription.reductionPreview.useMutation();
  const reduce = trpc.subscription.reduce.useMutation({
    onSuccess: (r) => {
      const res = r as PurchaseResult;
      setResult(res);
      if (res.status === "applied" || res.status === "processing") {
        toast.success(quantity ? t("subscription.modules.removeToastQty") : t("subscription.modules.removeToast", { name: module.name }));
        void utils.subscription.catalog.invalidate();
        void utils.subscription.plan.invalidate();
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const { mutate: requestPreview, reset: resetPreview } = preview;
  useEffect(() => {
    if (!quantity) requestPreview({ remove: [module.key] });
  }, [requestPreview, module.key, quantity]);
  const p = preview.data as ReductionPreview | undefined;
  const valid = !quantity || (Number.isInteger(total) && total >= 0 && total <= current! - step && (current! - total) % step === 0);
  const per = p?.interval === "year" ? t("subscription.plans.intervalYear") : t("subscription.plans.intervalMonth");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{quantity ? t("subscription.modules.removeTitleQty", { what: metricLabel(t)[module.metric!] ?? module.name }) : t("subscription.modules.removeTitle", { name: module.name })}</DialogTitle>
          <DialogDescription>{t("subscription.modules.removeDesc")}</DialogDescription>
        </DialogHeader>

        {quantity && !result && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {t("subscription.modules.nowHaveReduce", { current, what: metricLabel(t)[module.metric!] })}
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-foreground">{t("subscription.modules.newTotal")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={current! - step}
                  step={step}
                  value={Number.isFinite(total) ? total : ""}
                  onChange={(e) => {
                    setTotal(Number(e.target.value));
                    resetPreview();
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
                />
              </label>
              <Button type="button" variant="outline" disabled={!valid || preview.isPending} onClick={() => requestPreview(what)}>
                {t("subscription.modules.seeChange")}
              </Button>
            </div>
            {!valid && <p className="text-xs text-danger">{t("subscription.modules.totalLower", { mult: step > 1 ? t("subscription.modules.multiples", { step }) : "" })}</p>}
          </div>
        )}

        {preview.isPending && <PanelLoading label={t("subscription.modules.checking")} />}
        {preview.isError && <p className="text-sm text-danger">{preview.error.message}</p>}

        {p && !result && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {p.lines.map((l) => (
                <li key={l.productKey} className="flex justify-between gap-3">
                  <span className="text-foreground">{l.name}</span>
                  <span className="text-muted-foreground">{l.kind === "quantity" ? `${l.fromQuantity} → ${l.toQuantity}` : t("subscription.modules.lineCancel")}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-muted/50 p-3 space-y-1">
              <p>
                {t("subscription.modules.appliesOn")} <strong>{p.effectiveAt ? fmtDate(p.effectiveAt) : t("subscription.cancel.endFallback")}</strong>{t("subscription.modules.appliesTail")}
              </p>
              {p.recurringDeltaCents !== 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("subscription.modules.afterThat", { amount: money(Math.abs(p.recurringDeltaCents), "EUR"), per })}
                </p>
              )}
            </div>
          </div>
        )}

        {(result?.status === "applied" || result?.status === "processing") && (
          <p className="text-sm text-success">
            {t("subscription.modules.scheduled", { when: p?.effectiveAt ? t("subscription.modules.whenDate", { date: fmtDate(p.effectiveAt) }) : t("subscription.modules.whenEnd") })}
          </p>
        )}
        {(result?.status === "failed" || result?.status === "expired") && <p className="text-sm text-danger">{t("subscription.modules.scheduleFailed")}</p>}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("subscription.change.back")}
              </Button>
              <Button type="button" disabled={!p || !valid || reduce.isPending} onClick={() => reduce.mutate({ ...what, idempotencyKey: key })}>
                {reduce.isPending ? t("subscription.change.processing") : quantity ? t("subscription.modules.confirmReduce") : t("subscription.modules.confirmRemove")}
              </Button>
            </>
          )}
          {result && (
            <Button type="button" variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModulesPage() {
  const { t } = useI18n();
  const STATE_META = stateMeta(t);
  const catalog = trpc.subscription.catalog.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const overview = trpc.subscription.overview.useQuery(undefined, { retry: false, staleTime: 120_000 });
  const [buying, setBuying] = useState<PanelModule | null>(null);
  const [reducing, setReducing] = useState<PanelModule | null>(null);
  const data = catalog.data as { canPurchase: boolean; modules: PanelModule[]; totals?: Record<string, number | null> } | null | undefined;
  const upgradeUrl = overview.data?.upgradeUrl ?? null;
  const canPurchase = data?.canPurchase ?? false;
  /** Total contratado hoy de una métrica (número), o null si no se conoce o no tiene tope. */
  const currentOf = (m: PanelModule) => (m.metric && typeof data?.totals?.[m.metric] === "number" ? (data.totals[m.metric] as number) : null);
  /** ¿Se puede comprar desde aquí? Un módulo entero, o una ampliación con su total actual conocido. */
  const buyable = (m: PanelModule) => m.state === "available" && m.purchasable && canPurchase && (m.kind === "module" || currentOf(m) !== null);
  /** ¿Se puede dar de baja (módulo contratado aparte) o reducir (ampliación con unidades contratadas) desde aquí? */
  const reducible = (m: PanelModule) => canPurchase && m.purchasable && (m.kind === "module" ? m.state === "active" : (currentOf(m) ?? 0) > 0);

  const groups = useMemo(() => {
    const out = new Map<string, PanelModule[]>();
    for (const m of data?.modules ?? []) {
      const g = m.kind === "quantity" ? t("subscription.modules.family.addons") : (familyLabels(t)[m.family] ?? t("subscription.modules.family.other"));
      (out.get(g) ?? out.set(g, []).get(g)!).push(m);
    }
    return Array.from(out.entries());
  }, [data, t]);

  const ask = (m: PanelModule) =>
    upgradeUrl ? (
      <Button asChild variant="outline" size="sm">
        <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
          {m.kind === "quantity" ? t("subscription.modules.expand") : t("subscription.modules.request")}
          <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
          <span className="sr-only">{t("subscription.page.newTab")}</span>
        </a>
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">{t("subscription.modules.askCommercial")}</span>
    );

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t("subscription.hero.title")}
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-1">{t("subscription.modules.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("subscription.modules.pageText")}</p>
        </div>

        {catalog.isLoading && <PanelLoading label={t("subscription.modules.loading")} />}
        {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title={t("subscription.modules.loadError")} />}

        {catalog.isSuccess && !data && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-2">
            <p className="text-sm text-muted-foreground">{t("subscription.modules.noCatalog")}</p>
          </section>
        )}

        {data && data.modules.length === 0 && <p className="text-sm text-muted-foreground">{t("subscription.modules.none")}</p>}

        {groups.map(([group, mods]) => (
          <section key={group} className="space-y-3" aria-labelledby={`mod-${group}`}>
            <h2 id={`mod-${group}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {mods.map((m) => {
                const meta = STATE_META[m.state];
                const Icon = meta.icon;
                return (
                  <li key={m.key} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground">{m.name}</h3>
                        {m.state !== "active" && m.state !== "read_only" && <Price m={m} />}
                      </div>
                      <Badge variant="outline" className={cn("gap-1 border-0", meta.tone)}>
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.state === "active" && <span className="text-xs text-muted-foreground">{t("subscription.modules.partOf")}</span>}
                      {m.state === "read_only" && <span className="text-xs text-muted-foreground">{t("subscription.modules.readOnlyHint")}</span>}
                      {(m.state === "coming_soon" || m.state === "in_preparation") && <span className="text-xs text-muted-foreground">{t("subscription.modules.notifyHint")}</span>}
                      {m.state === "on_request" && <span className="text-xs text-muted-foreground">{t("subscription.modules.teamHint")}</span>}
                      {buyable(m) && (
                        <Button type="button" size="sm" onClick={() => setBuying(m)}>
                          <PackagePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {m.kind === "quantity" ? t("subscription.modules.expand") : t("subscription.modules.add")}
                        </Button>
                      )}
                      {reducible(m) && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setReducing(m)}>
                          <PackageMinus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {m.kind === "quantity" ? t("subscription.modules.reduce") : t("subscription.modules.cancelModule")}
                        </Button>
                      )}
                      {m.kind === "quantity" && currentOf(m) !== null && <span className="text-xs text-muted-foreground">{t("subscription.modules.youHave", { n: currentOf(m) })}</span>}
                      {((m.state === "available" && !buyable(m)) || m.state === "on_request") && ask(m)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {data && !data.canPurchase && data.modules.some((m) => m.purchasable) && (
          <p className="text-xs text-muted-foreground">{t("subscription.modules.adminOnly")}</p>
        )}
      </div>
      {buying && <PurchaseDialog module={buying} current={currentOf(buying)} onClose={() => setBuying(null)} />}
      {reducing && <ReductionDialog module={reducing} current={currentOf(reducing)} onClose={() => setReducing(null)} />}
    </AdminLayout>
  );
}
