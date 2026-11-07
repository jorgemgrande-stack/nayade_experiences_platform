/**
 * Comparador de planes de Elephant Core (Essential, Business, Enterprise…): tarjetas con lo principal de cada plan
 * (público, mensaje, precio, ventajas, capacidad clave y la acción que el servidor permite HOY a esta persona) y,
 * debajo, la comparativa completa con todos los precios, límites y ventajas publicados y lo que cambia frente al plan
 * actual. Nada se inventa ni se calcula aquí: precios y límites son los del catálogo central y las acciones, las de
 * buildPlanComparison (contratar desde la prueba, cambiar de plan o hablar con el equipo comercial).
 */
import { useState } from "react";
import { ArrowDown, Building2, Check, Layers, Rocket, ShieldCheck, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@shared/connectCard";
import type { PanelPlanInfo, PlanCardModel, PlanRequestView, SelfServicePlanKey } from "@shared/subscriptionPlans";
import { cardBenefits, cardLimits, comparisonLimitRows, displayMoney, planPresentation, taxLabel, type PlanIconKey } from "@shared/planPresentation";
import { PlanRequestCta, openRequestFor } from "./PlanRequests";
import { PlanChangeDialog, type PlanOption } from "./SelfServiceSection";

const ICONS: Record<PlanIconKey, LucideIcon> = { rocket: Rocket, trending: TrendingUp, building: Building2, layers: Layers };
export const COMPARISON_ID = "comparativa-planes";

const scrollToComparison = () =>
  document.getElementById(COMPARISON_ID)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

function PlanPrice({ plan }: { plan: PanelPlanInfo }) {
  const main = plan.monthly ?? plan.yearly;
  if (!main) return <p className="text-sm text-muted-foreground">Sin precio publicado</p>;
  const per = plan.monthly ? "/mes" : "/año";
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-foreground">
        <strong className="text-4xl font-extrabold leading-none tracking-tight sm:text-[2.75rem]">{displayMoney(main.amountCents, main.currency)}</strong>
        <span className="text-base font-medium text-muted-foreground">{per}</span>
        <span className="text-xs font-medium text-muted-foreground">{taxLabel(main)}</span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {plan.monthly ? "Facturación mensual" : "Facturación anual"}
        {plan.monthly && plan.yearly && (
          <>
            {" · o "}
            <strong className="text-sm font-semibold text-foreground">{formatMoney(plan.yearly.amountCents, plan.yearly.currency)}</strong> /año con facturación anual ({taxLabel(plan.yearly)})
          </>
        )}
      </p>
    </div>
  );
}

function PlanCard({
  card,
  requests,
  onConvert,
  onChange,
}: {
  card: PlanCardModel;
  requests: PlanRequestView[] | undefined;
  onConvert: (plan: SelfServicePlanKey) => void;
  onChange: (option: PlanOption) => void;
}) {
  const { plan, cta } = card;
  const titleId = `plan-${plan.key}`;
  const pr = planPresentation(plan);
  const Icon = ICONS[pr.icon];
  const featured = plan.highlight && !card.isCurrent;
  const benefits = cardBenefits(plan);
  const limits = cardLimits(plan);
  return (
    <li
      className={cn(
        "cx-shadow relative flex h-full min-w-0 flex-col rounded-3xl border bg-card",
        card.isCurrent ? "border-primary ring-1 ring-primary" : featured ? "border-primary/50 ring-2 ring-primary/25" : "border-border",
      )}
      aria-labelledby={titleId}
    >
      {featured && <span className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-primary" aria-hidden="true" />}
      <div className={cn("flex flex-1 flex-col gap-4 rounded-3xl p-5 sm:p-6 xl:gap-3 xl:p-5", (featured || card.isCurrent) && "cx-glow")}>
        {/* Cabecera: público, estado y nombre */}
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              featured || card.isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            {pr.audience && <p className="cx-red-text text-xs font-semibold uppercase tracking-wider">{pr.audience}</p>}
            <h3 id={titleId} className="break-words text-2xl font-bold leading-tight text-foreground">
              {plan.name}
            </h3>
          </div>
        </div>
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          {card.currentLabel && <Badge className="bg-primary text-primary-foreground">{card.currentLabel}</Badge>}
          {featured && (
            <Badge className="gap-1 bg-primary/10 text-[color:var(--cx-red-text)] hover:bg-primary/10">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> Recomendado para crecer
            </Badge>
          )}
          <Badge variant="outline">{card.commercialLabel}</Badge>
        </div>

        {pr.headline && <p className="text-base font-medium leading-snug text-foreground">{pr.headline}</p>}

        <PlanPrice plan={plan} />
        {card.isCurrent && card.currentLabel === "Prueba gratuita" && (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-foreground">Lo estás probando gratis: todavía no tienes ninguna suscripción de pago ni se te ha cobrado nada.</p>
        )}

        {pr.pillars.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Áreas clave de ${plan.name}`}>
            {pr.pillars.map((p) => (
              <li key={p} className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs font-medium text-foreground">
                {p}
              </li>
            ))}
          </ul>
        )}

        {benefits.length > 0 && (
          <ul className="space-y-2">
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
                  <Check className="cx-red-text h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 break-words">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {limits.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border bg-background/60 px-3 py-2.5">
            {limits.map((l) => (
              <div key={l.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
                <dt className="min-w-0 break-words text-xs text-muted-foreground">{l.label}</dt>
                <dd className="min-w-0 break-words text-sm font-semibold text-foreground">{l.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-auto space-y-2 pt-1">
          {cta.kind === "current" && <p className="rounded-xl border border-border px-3 py-2.5 text-center text-sm font-medium text-foreground">Es tu plan actual</p>}
          {cta.kind === "convert" && (
            <Button type="button" size="lg" className="w-full" onClick={() => onConvert(cta.plan)}>
              Contratar {plan.name}
            </Button>
          )}
          {cta.kind === "change" && (
            <>
              <Button
                type="button"
                size="lg"
                className="w-full"
                variant={cta.direction === "upgrade" ? "default" : "outline"}
                onClick={() => onChange({ plan: cta.plan, interval: cta.interval, direction: cta.direction, recurringCents: cta.recurringCents, currency: cta.currency })}
              >
                {cta.direction === "upgrade" ? `Cambiar a ${plan.name}` : `Solicitar el cambio a ${plan.name}`}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {formatMoney(cta.recurringCents, cta.currency)} /{cta.interval === "year" ? "año" : "mes"} + IVA ·{" "}
                {cta.direction === "upgrade" ? "se aplica desde hoy" : "se aplica al final del periodo pagado"}
              </p>
            </>
          )}
          {cta.kind === "contact" && <PlanRequestCta plan={plan} kind={cta.request} open={openRequestFor(requests, plan.key)} />}
          {cta.kind === "admin_only" && <p className="text-sm text-muted-foreground">Solo la administración de tu empresa puede contratar o cambiar de plan.</p>}
          <button
            type="button"
            onClick={scrollToComparison}
            className="mx-auto flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver la comparativa completa <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}

/** Comparativa completa: todo lo publicado de cada plan, con lo que cambia frente al plan actual en negrita. */
function PlanComparisonTable({ cards }: { cards: PlanCardModel[] }) {
  const rows = comparisonLimitRows(cards);
  const hasCurrent = cards.some((c) => c.isCurrent);
  const anyDiff = rows.some((r) => r.cells.some((c) => c.differs));
  const anyBenefits = cards.some((c) => c.plan.benefits.length > 0);
  const th = "px-4 py-3 text-left align-top";
  const td = "px-4 py-2.5 align-top text-sm";
  const sticky = "sticky left-0 z-10 bg-card";
  const group = (label: string) => (
    <tr>
      <th scope="colgroup" colSpan={cards.length + 1} className={cn("bg-muted/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground")}>
        {label}
      </th>
    </tr>
  );
  return (
    <section id={COMPARISON_ID} className="cx-shadow scroll-mt-4 overflow-hidden rounded-3xl border border-border bg-card" aria-labelledby="plans-compare-title">
      <div className="space-y-1 border-b border-border p-5 sm:p-6">
        <h3 id="plans-compare-title" className="text-lg font-bold text-foreground">
          Comparativa completa de planes
        </h3>
        <p className="text-sm text-muted-foreground">
          Precios, límites y ventajas de cada plan tal como los publica el catálogo oficial.
          {hasCurrent && anyDiff && " En negrita, lo que cambia frente a tu plan."}
        </p>
        <p className="text-xs text-muted-foreground md:hidden">Desliza la tabla para ver todos los planes.</p>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <caption className="sr-only">Comparativa de los planes de Elephant Core</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={cn(th, sticky, "w-[28%] text-xs font-semibold uppercase tracking-wider text-muted-foreground")}>
                Plan
              </th>
              {cards.map((c) => (
                <th key={c.plan.key} scope="col" className={cn(th, c.isCurrent && "bg-primary/[0.06]")}>
                  <span className="block text-base font-bold text-foreground">{c.plan.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{c.currentLabel ?? planPresentation(c.plan).audience ?? c.commercialLabel}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:not(:last-child)]:border-b [&_tr]:border-border">
            {group("Precio")}
            <tr>
              <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                Mensual
              </th>
              {cards.map((c) => (
                <td key={c.plan.key} className={cn(td, "text-foreground", c.isCurrent && "bg-primary/[0.06]")}>
                  {c.plan.monthly ? (
                    <>
                      <strong className="font-semibold">{formatMoney(c.plan.monthly.amountCents, c.plan.monthly.currency)}</strong> /mes · {taxLabel(c.plan.monthly)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                Anual
              </th>
              {cards.map((c) => (
                <td key={c.plan.key} className={cn(td, "text-foreground", c.isCurrent && "bg-primary/[0.06]")}>
                  {c.plan.yearly ? (
                    <>
                      <strong className="font-semibold">{formatMoney(c.plan.yearly.amountCents, c.plan.yearly.currency)}</strong> /año · {taxLabel(c.plan.yearly)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                Contratación
              </th>
              {cards.map((c) => (
                <td key={c.plan.key} className={cn(td, "text-foreground", c.isCurrent && "bg-primary/[0.06]")}>
                  {c.commercialLabel}
                </td>
              ))}
            </tr>
            {rows.length > 0 && group("Límites y capacidades")}
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                  {r.label}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={cards[i].plan.key} className={cn(td, "text-foreground", cards[i].isCurrent && "bg-primary/[0.06]", cell.differs && "font-semibold")}>
                    {cell.value ?? <span className="text-muted-foreground">—</span>}
                    {cell.differs && <span className="sr-only"> (cambia frente a tu plan)</span>}
                  </td>
                ))}
              </tr>
            ))}
            {(anyBenefits || cards.some((c) => c.plan.tagline)) && group("Qué incluye")}
            {cards.some((c) => c.plan.tagline) && (
              <tr>
                <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                  Para quién
                </th>
                {cards.map((c) => (
                  <td key={c.plan.key} className={cn(td, "text-foreground", c.isCurrent && "bg-primary/[0.06]")}>
                    {c.plan.tagline ?? <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
              </tr>
            )}
            {anyBenefits && (
              <tr>
                <th scope="row" className={cn(td, sticky, "text-left font-normal text-muted-foreground")}>
                  Ventajas
                </th>
                {cards.map((c) => (
                  <td key={c.plan.key} className={cn(td, "text-foreground", c.isCurrent && "bg-primary/[0.06]")}>
                    {c.plan.benefits.length > 0 ? (
                      <ul className="space-y-1.5">
                        {c.plan.benefits.map((b) => (
                          <li key={b} className="flex items-start gap-1.5">
                            <Check className="cx-red-text mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 break-words">{b}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PlanComparison({
  cards,
  requests,
  current,
  onConvert,
}: {
  cards: PlanCardModel[];
  /** Solicitudes de plan de la empresa (para no repetir una que ya está abierta). */
  requests: PlanRequestView[] | undefined;
  /** Plan e intervalo del contrato (para el diálogo de cambio). */
  current: { plan: string; interval: "month" | "year" } | null;
  onConvert: (plan: SelfServicePlanKey) => void;
}) {
  const [choosing, setChoosing] = useState<PlanOption | null>(null);
  return (
    <>
      <ul className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <PlanCard key={c.plan.key} card={c} requests={requests} onConvert={onConvert} onChange={setChoosing} />
        ))}
      </ul>
      <PlanComparisonTable cards={cards} />
      {choosing && current && <PlanChangeDialog current={current} option={choosing} onClose={() => setChoosing(null)} />}
    </>
  );
}

/** Garantías que acompañan a la cabecera comercial (las mismas que ya dice la página, ahora visibles de un vistazo). */
export function PlanAssurances({ trial }: { trial: boolean }) {
  const items = [trial ? "Todo lo que has preparado en la prueba se conserva" : "Tus datos y tu configuración se conservan", "Importe exacto antes de confirmar"];
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-foreground">
          <ShieldCheck className="cx-red-text h-3.5 w-3.5" aria-hidden="true" /> {t}
        </li>
      ))}
    </ul>
  );
}
