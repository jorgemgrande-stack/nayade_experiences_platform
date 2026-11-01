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

const FAMILY_LABELS: Record<string, string> = {
  net_module: "Módulos sectoriales",
  industry_module: "Módulos sectoriales",
  net_bundle: "Paquetes sectoriales",
  connect: "Conectores y herramientas",
  extension: "Conectores y herramientas",
  connect_bundle: "Paquetes de conectores",
  addon: "Ampliaciones",
  extra: "Ampliaciones",
};

const STATE_META: Record<ModuleState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  active: { label: "Incluido", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  read_only: { label: "Solo lectura", icon: Eye, tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  available: { label: "Disponible", icon: Sparkles, tone: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  on_request: { label: "Implantación acompañada", icon: PackagePlus, tone: "bg-muted text-foreground" },
  in_preparation: { label: "En preparación", icon: Clock, tone: "bg-muted text-muted-foreground" },
  coming_soon: { label: "Próximamente", icon: Clock, tone: "bg-muted text-muted-foreground" },
};

const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(16, "0");

function Price({ m }: { m: PanelModule }) {
  if (!m.monthly) return null;
  return (
    <p className="text-sm text-foreground">
      {money(m.monthly.amountCents, m.monthly.currency)}
      <span className="text-muted-foreground">
        {" "}/ mes{m.monthly.unit ? ` por ${m.monthly.unit}` : ""}
        {m.monthly.taxIncluded ? " (IVA incluido)" : " + IVA"}
      </span>
    </p>
  );
}

const METRIC_LABEL: Record<string, string> = { users: "usuarios", sites: "sedes", storage_gb: "GB de almacenamiento" };
const METRIC_FIELD: Record<string, "users" | "sites" | "storageGb"> = { users: "users", sites: "sites", storage_gb: "storageGb" };

/**
 * Vista previa y confirmación de una compra: un módulo entero, o el NUEVO total de una ampliación por unidades
 * (usuarios, sedes, almacenamiento) a partir del total contratado hoy.
 */
function PurchaseDialog({ module, current, onClose }: { module: PanelModule; current: number | null; onClose: () => void }) {
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
        toast.success(quantity ? "Ampliación aplicada" : `${module.name} ya está activo`);
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
          <DialogTitle>{quantity ? `Ampliar ${METRIC_LABEL[module.metric!] ?? module.name}` : `Añadir ${module.name}`}</DialogTitle>
          <DialogDescription>El importe lo calcula nuestro sistema de cobros según los días que quedan de tu periodo actual.</DialogDescription>
        </DialogHeader>

        {quantity && !result && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Ahora tienes {current} {METRIC_LABEL[module.metric!]} contratados. Indica el nuevo total.
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-foreground">Nuevo total</span>
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
                Calcular importe
              </Button>
            </div>
            {!valid && (
              <p className="text-xs text-red-700 dark:text-red-400">
                El total debe ser mayor que el actual{step > 1 ? ` y en múltiplos de ${step}` : ""}. Para reducir, usa «Reducir».
              </p>
            )}
          </div>
        )}

        {preview.isPending && <PanelLoading label="Calculando el importe…" />}
        {preview.isError && <p className="text-sm text-red-700 dark:text-red-400">{preview.error.message}</p>}

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
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-muted/50 p-3 space-y-1">
              <p className="flex justify-between gap-3">
                <span>A pagar ahora (parte proporcional)</span>
                <strong>{money(p.amountDueCents, p.currency)}</strong>
              </p>
              {p.taxCents !== null && <p className="text-xs text-muted-foreground">Incluye {money(p.taxCents, p.currency)} de impuestos.</p>}
              <p className="text-xs text-muted-foreground">
                Después, {money(p.recurringDeltaCents, p.currency)} más por {p.interval === "year" ? "año" : "mes"} en cada renovación
                {p.taxCents === null ? " (impuestos aparte)" : ""}.
              </p>
            </div>
          </div>
        )}

        {result?.status === "applied" && (
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            {quantity ? "Listo: la ampliación ya está aplicada." : `Listo: ${module.name} ya está activo en tu plataforma.`}
          </p>
        )}
        {result?.status === "processing" && <p className="text-sm text-foreground">Estamos confirmando el pago. El cambio se aplicará en cuanto se complete; te avisaremos.</p>}
        {result?.status === "payment_pending" && (
          <p className="text-sm text-foreground">Falta completar el pago con tu banco. Hasta entonces no se activa nada ni se hace ningún cargo.</p>
        )}
        {(result?.status === "failed" || result?.status === "expired") && (
          <p className="text-sm text-red-700 dark:text-red-400">No se ha podido completar la compra. No se ha hecho ningún cargo.</p>
        )}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="button" disabled={!p || !valid || buy.isPending} onClick={() => buy.mutate({ ...what, idempotencyKey: key })}>
                {buy.isPending ? "Procesando…" : "Confirmar y pagar"}
              </Button>
            </>
          )}
          {result?.status === "payment_pending" && result.paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(result.paymentUrl!)}>
              Completar el pago
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
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

/**
 * Vista previa y confirmación de una baja de módulo o de una reducción de ampliación (nuevo total menor que el
 * actual). Se aplica al final del periodo pagado, sin abonos; hasta entonces todo sigue disponible.
 */
function ReductionDialog({ module, current, onClose }: { module: PanelModule; current: number | null; onClose: () => void }) {
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
        toast.success(quantity ? "Reducción programada" : `Baja de ${module.name} programada`);
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
  const per = p?.interval === "year" ? "año" : "mes";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{quantity ? `Reducir ${METRIC_LABEL[module.metric!] ?? module.name}` : `Dar de baja ${module.name}`}</DialogTitle>
          <DialogDescription>El cambio se aplica al final del periodo ya pagado: hasta entonces todo sigue disponible y no hay abonos por la parte pagada. Tus datos se conservan.</DialogDescription>
        </DialogHeader>

        {quantity && !result && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Ahora tienes {current} {METRIC_LABEL[module.metric!]} contratados. Indica el nuevo total (nunca por debajo de lo que ya usas).
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-foreground">Nuevo total</span>
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
                Ver el cambio
              </Button>
            </div>
            {!valid && <p className="text-xs text-red-700 dark:text-red-400">El total debe ser menor que el actual{step > 1 ? ` y en múltiplos de ${step}` : ""}.</p>}
          </div>
        )}

        {preview.isPending && <PanelLoading label="Comprobando…" />}
        {preview.isError && <p className="text-sm text-red-700 dark:text-red-400">{preview.error.message}</p>}

        {p && !result && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {p.lines.map((l) => (
                <li key={l.productKey} className="flex justify-between gap-3">
                  <span className="text-foreground">{l.name}</span>
                  <span className="text-muted-foreground">{l.kind === "quantity" ? `${l.fromQuantity} → ${l.toQuantity}` : "Baja"}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-muted/50 p-3 space-y-1">
              <p>
                Se aplica el <strong>{p.effectiveAt ? fmtDate(p.effectiveAt) : "final del periodo pagado"}</strong>. Hoy no se cobra ni se abona nada.
              </p>
              {p.recurringDeltaCents !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Desde entonces pagarás {money(Math.abs(p.recurringDeltaCents), "EUR")} menos por {per} (impuestos aparte).
                </p>
              )}
            </div>
          </div>
        )}

        {(result?.status === "applied" || result?.status === "processing") && (
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            Listo: el cambio queda programado{p?.effectiveAt ? ` para el ${fmtDate(p.effectiveAt)}` : " para el final del periodo"}. Hasta entonces sigue todo disponible.
          </p>
        )}
        {(result?.status === "failed" || result?.status === "expired") && <p className="text-sm text-red-700 dark:text-red-400">No se ha podido programar el cambio. No se ha modificado nada.</p>}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Volver
              </Button>
              <Button type="button" disabled={!p || !valid || reduce.isPending} onClick={() => reduce.mutate({ ...what, idempotencyKey: key })}>
                {reduce.isPending ? "Procesando…" : quantity ? "Confirmar la reducción" : "Confirmar la baja"}
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
      const g = m.kind === "quantity" ? "Ampliaciones" : (FAMILY_LABELS[m.family] ?? "Otros módulos");
      (out.get(g) ?? out.set(g, []).get(g)!).push(m);
    }
    return Array.from(out.entries());
  }, [data]);

  const ask = (m: PanelModule) =>
    upgradeUrl ? (
      <Button asChild variant="outline" size="sm">
        <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
          {m.kind === "quantity" ? "Ampliar" : "Solicitar"}
          <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">Pídelo a tu contacto comercial</span>
    );

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Suscripción
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-1">Módulos y ampliaciones</h1>
          <p className="text-sm text-muted-foreground">Lo que ya tienes y lo que puedes añadir a tu plataforma.</p>
        </div>

        {catalog.isLoading && <PanelLoading label="Cargando los módulos…" />}
        {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se han podido cargar los módulos" />}

        {catalog.isSuccess && !data && (
          <section className="rounded-2xl border border-border bg-card p-6 space-y-2">
            <p className="text-sm text-muted-foreground">El catálogo de módulos no está disponible en esta instalación. Para añadir funcionalidades, contacta con tu responsable de cuenta.</p>
          </section>
        )}

        {data && data.modules.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay módulos publicados.</p>}

        {groups.map(([group, mods]) => (
          <section key={group} className="space-y-3" aria-labelledby={`mod-${group}`}>
            <h2 id={`mod-${group}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {mods.map((m) => {
                const meta = STATE_META[m.state];
                const Icon = meta.icon;
                return (
                  <li key={m.key} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
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
                      {m.state === "active" && <span className="text-xs text-muted-foreground">Ya forma parte de tu plataforma.</span>}
                      {m.state === "read_only" && <span className="text-xs text-muted-foreground">Puedes consultarlo; para seguir usándolo, reactiva tu suscripción.</span>}
                      {(m.state === "coming_soon" || m.state === "in_preparation") && <span className="text-xs text-muted-foreground">Te avisaremos cuando esté disponible.</span>}
                      {m.state === "on_request" && <span className="text-xs text-muted-foreground">Lo implanta nuestro equipo contigo.</span>}
                      {buyable(m) && (
                        <Button type="button" size="sm" onClick={() => setBuying(m)}>
                          <PackagePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {m.kind === "quantity" ? "Ampliar" : "Añadir"}
                        </Button>
                      )}
                      {reducible(m) && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setReducing(m)}>
                          <PackageMinus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {m.kind === "quantity" ? "Reducir" : "Dar de baja"}
                        </Button>
                      )}
                      {m.kind === "quantity" && currentOf(m) !== null && <span className="text-xs text-muted-foreground">Tienes {currentOf(m)} contratados.</span>}
                      {((m.state === "available" && !buyable(m)) || m.state === "on_request") && ask(m)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {data && !data.canPurchase && data.modules.some((m) => m.purchasable) && (
          <p className="text-xs text-muted-foreground">Solo la administración de la empresa puede añadir módulos.</p>
        )}
      </div>
      {buying && <PurchaseDialog module={buying} current={currentOf(buying)} onClose={() => setBuying(null)} />}
      {reducing && <ReductionDialog module={reducing} current={currentOf(reducing)} onClose={() => setReducing(null)} />}
    </AdminLayout>
  );
}
