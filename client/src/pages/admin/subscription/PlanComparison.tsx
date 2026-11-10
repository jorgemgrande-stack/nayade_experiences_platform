/**
 * Comparador de planes de Elephant Core (Essential, Business, Enterprise…) con el sistema visual del marketplace:
 * tarjetas a la misma altura con el tono de cada plan (público, mensaje, ventajas, límites clave, precio mensual y
 * anual, estado y la acción que el servidor permite HOY a esta persona) y, debajo, la comparativa completa agrupada
 * por categorías (tabla en escritorio, grupos desplegables en el móvil).
 *
 * Nada se inventa ni se calcula aquí: precios, ventajas y límites son los del catálogo central (subscription.catalog)
 * y las acciones, las de buildPlanComparison (contratar desde la prueba, cambiar de plan o solicitud comercial).
 */
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Building2, Check, ChevronDown, HardDrive, Layers, MapPin, Receipt, Rocket, ShoppingBag, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@shared/connectCard";
import type { PanelPlanInfo, PlanCardModel, PlanRequestView, SelfServicePlanKey } from "@shared/subscriptionPlans";
import { cardBenefits, cardLimits, groupedComparisonRows, isGrowthOption, planMoney, planPresentation, taxLabel, type PlanIconKey } from "@shared/planPresentation";
import { PlanRequestCta, openRequestFor } from "./PlanRequests";
import { PlanChangeDialog, type PlanOption } from "./SelfServiceSection";

const ICONS: Record<PlanIconKey, LucideIcon> = { rocket: Rocket, trending: TrendingUp, building: Building2, layers: Layers };
const LIMIT_ICONS: Record<string, LucideIcon> = { users: Users, sites: MapPin, contacts: Users, orders_month: Receipt, storage_gb: HardDrive, websites: ShoppingBag };
export const COMPARISON_ID = "comparativa-planes";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const scrollToComparison = () => document.getElementById(COMPARISON_ID)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });

/** Precio mensual y anual del catálogo (sin recalcular el anual) con la periodicidad y el IVA siempre a la vista. */
function PriceBox({ plan }: { plan: PanelPlanInfo }) {
  const cells = [
    plan.monthly ? { key: "m", price: plan.monthly, per: "/mes", label: "Mensual" } : null,
    plan.yearly ? { key: "y", price: plan.yearly, per: "/año", label: "Anual" } : null,
  ].filter((c): c is NonNullable<typeof c> => !!c);
  if (cells.length === 0) return <p className="sx-price rounded-2xl px-4 py-3 text-sm text-muted-foreground">Precio a consultar</p>;
  return (
    <dl className={cn("sx-price grid rounded-2xl", cells.length === 2 ? "grid-cols-2 divide-x divide-border" : "grid-cols-1")}>
      {cells.map((c) => (
        <div key={c.key} className="min-w-0 px-3 py-3 text-center sm:px-4">
          <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{c.label}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1 text-foreground">
            <strong className="text-xl font-extrabold tracking-tight sm:text-2xl">{planMoney(c.price.amountCents, c.price.currency)}</strong>
            <span className="text-xs text-muted-foreground">
              {c.per} {taxLabel(c.price)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PlanCard({
  card,
  currentKey,
  requests,
  onConvert,
  onChange,
}: {
  card: PlanCardModel;
  currentKey: string | null;
  requests: PlanRequestView[] | undefined;
  onConvert: (plan: SelfServicePlanKey) => void;
  onChange: (option: PlanOption) => void;
}) {
  const { plan } = card;
  const titleId = `plan-${plan.key}`;
  const pr = planPresentation(plan);
  const Icon = ICONS[pr.icon];
  const growth = isGrowthOption(card, currentKey);
  const benefits = cardBenefits(plan);
  const limits = cardLimits(plan);
  return (
    <li
      data-tone={pr.tone}
      data-current={card.isCurrent}
      className={cn("sx-plan relative flex h-full min-w-0 flex-col rounded-3xl", growth && "sx-plan-growth")}
      aria-labelledby={titleId}
    >
      {growth && (
        <span className="sx-tone-cta absolute -top-3 right-5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold shadow-lg">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Para crecer
        </span>
      )}
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="cx-tone-chip inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/20">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="break-words text-2xl font-extrabold leading-tight tracking-tight text-foreground">
              {plan.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {pr.audience && <span className="sx-tone-tag rounded-full px-2.5 py-0.5 text-xs font-semibold">{pr.audience}</span>}
              {card.currentLabel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background">
                  <Check className="h-3 w-3" aria-hidden="true" /> {card.currentLabel}
                </span>
              )}
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{card.commercialLabel}</span>
            </div>
          </div>
        </div>

        {pr.headline && <p className="text-sm font-medium leading-snug text-foreground sm:text-base">{pr.headline}</p>}

        {benefits.length > 0 && (
          <ul className="space-y-2" aria-label={`Ventajas de ${plan.name}`}>
            {benefits.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-foreground">
                <span aria-hidden="true" className="cx-tone-chip mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                  <Check className="h-3 w-3" />
                </span>
                <span className="min-w-0 break-words">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {limits.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3" aria-label={`Límites de ${plan.name}`}>
            {limits.map((l) => {
              const LIcon = (l.metric && LIMIT_ICONS[l.metric]) || Layers;
              return (
                <div key={l.label} className="flex min-w-0 items-center gap-2">
                  <LIcon className="cx-tone-text h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <dd className="break-words text-sm font-semibold leading-tight text-foreground">{l.value}</dd>
                    <dt className="break-words text-xs text-muted-foreground">{l.label}</dt>
                  </div>
                </div>
              );
            })}
          </dl>
        )}

        {card.isCurrent && card.currentLabel === "Prueba gratuita" && <p className="text-xs text-muted-foreground">Lo estás probando gratis: no se te ha cobrado nada.</p>}

        {/* Pie de altura fija (precio, acción, detalle) para que precios y botones queden alineados entre tarjetas */}
        <div className="mt-auto space-y-3 pt-1">
          <PriceBox plan={plan} />
          <div className="flex min-h-12 flex-col justify-center gap-1.5 [&_button]:min-h-12">
            <PlanAction card={card} requests={requests} onConvert={onConvert} onChange={onChange} />
          </div>
          <button
            type="button"
            onClick={scrollToComparison}
            className="mx-auto flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver detalles del plan <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only"> {plan.name}</span>
          </button>
        </div>
      </div>
    </li>
  );
}

function PlanAction({ card, requests, onConvert, onChange }: { card: PlanCardModel; requests: PlanRequestView[] | undefined; onConvert: (plan: SelfServicePlanKey) => void; onChange: (option: PlanOption) => void }) {
  const { plan, cta } = card;
  const big = "h-12 w-full rounded-xl text-base font-semibold";
  switch (cta.kind) {
    case "current":
      return <p className="rounded-xl border border-border px-3 py-3 text-center text-sm font-semibold text-foreground">Es tu plan actual</p>;
    case "convert":
      return (
        <Button type="button" className={cn("sx-tone-cta hover:bg-transparent", big)} onClick={() => onConvert(cta.plan)}>
          Contratar {plan.name}
        </Button>
      );
    case "change":
      return (
        <>
          <Button
            type="button"
            variant={cta.direction === "upgrade" ? "default" : "outline"}
            className={cn(big, cta.direction === "upgrade" && "sx-tone-cta hover:bg-transparent")}
            onClick={() => onChange({ plan: cta.plan, interval: cta.interval, direction: cta.direction, recurringCents: cta.recurringCents, currency: cta.currency })}
          >
            {cta.direction === "upgrade" ? `Cambiar a ${plan.name}` : `Solicitar el cambio a ${plan.name}`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {formatMoney(cta.recurringCents, cta.currency)} /{cta.interval === "year" ? "año" : "mes"} + IVA · {cta.direction === "upgrade" ? "se aplica desde hoy, con prorrateo" : "se aplica al final del periodo pagado"}
          </p>
        </>
      );
    case "contact":
      return <PlanRequestCta plan={plan} kind={cta.request} open={openRequestFor(requests, plan.key)} />;
    case "admin_only":
      return <p className="rounded-xl bg-muted px-3 py-2.5 text-center text-sm text-muted-foreground">Solo la administración de tu empresa puede contratar o cambiar de plan.</p>;
    default:
      return null;
  }
}

/** Celda de la comparativa: valor publicado o «Sin dato publicado» (nunca se presenta como incluido). */
function Value({ value, differs }: { value: string | null; differs?: boolean }) {
  if (value === null)
    return (
      <span className="text-muted-foreground">
        —<span className="sr-only">Sin dato publicado</span>
      </span>
    );
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", differs && "font-semibold")}>
      {value}
      {differs && (
        <span className="cx-red-text inline-flex items-center" title="Cambia frente a tu plan">
          <ArrowUp className="h-3.5 w-3.5 rotate-45" aria-hidden="true" />
          <span className="sr-only">(cambia frente a tu plan)</span>
        </span>
      )}
    </span>
  );
}

function Benefits({ items }: { items: string[] }) {
  if (items.length === 0) return <Value value={null} />;
  return (
    <ul className="space-y-1.5">
      {items.map((b) => (
        <li key={b} className="flex items-start gap-1.5">
          <Check className="cx-tone-text mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{b}</span>
        </li>
      ))}
    </ul>
  );
}

interface CompareRow {
  label: string;
  cells: Array<{ node: ReactNode; text: string | null }>;
}
interface CompareGroup {
  id: string;
  label: string;
  rows: CompareRow[];
}

/** Todas las filas de la comparativa (precios, límites agrupados y lo que incluye): nada de lo publicado se oculta. */
function comparisonModel(cards: PlanCardModel[]): CompareGroup[] {
  const price = (p: PanelPlanInfo["monthly"], per: string) => (p ? `${planMoney(p.amountCents, p.currency)} ${per} · ${taxLabel(p)}` : null);
  const groups: CompareGroup[] = [
    {
      id: "price",
      label: "Precio y contratación",
      rows: [
        { label: "Mensual", cells: cards.map((c) => ({ text: price(c.plan.monthly, "/mes"), node: <Value value={price(c.plan.monthly, "/mes")} /> })) },
        { label: "Anual", cells: cards.map((c) => ({ text: price(c.plan.yearly, "/año"), node: <Value value={price(c.plan.yearly, "/año")} /> })) },
        { label: "Contratación", cells: cards.map((c) => ({ text: c.commercialLabel, node: <Value value={c.commercialLabel} /> })) },
      ],
    },
    ...groupedComparisonRows(cards).map((g) => ({
      id: g.id,
      label: g.label,
      rows: g.rows.map((r) => ({ label: r.label, cells: r.cells.map((cell) => ({ text: cell.value, node: <Value value={cell.value} differs={cell.differs} /> })) })),
    })),
  ];
  const info: CompareRow[] = [];
  if (cards.some((c) => c.plan.tagline)) info.push({ label: "En resumen", cells: cards.map((c) => ({ text: c.plan.tagline, node: <Value value={c.plan.tagline} /> })) });
  if (cards.some((c) => c.plan.forWho)) info.push({ label: "Para quién", cells: cards.map((c) => ({ text: c.plan.forWho, node: <Value value={c.plan.forWho} /> })) });
  if (cards.some((c) => c.plan.description)) info.push({ label: "Qué incluye", cells: cards.map((c) => ({ text: c.plan.description, node: <Value value={c.plan.description} /> })) });
  if (cards.some((c) => c.plan.benefits.length > 0)) info.push({ label: "Ventajas", cells: cards.map((c) => ({ text: c.plan.benefits.join(", ") || null, node: <Benefits items={c.plan.benefits} /> })) });
  if (info.length > 0) groups.push({ id: "info", label: "Qué incluye cada plan", rows: info });
  return groups;
}

/** Comparativa completa: tabla con columnas por plan en escritorio y grupos desplegables en el móvil. */
function PlanComparisonTable({ cards }: { cards: PlanCardModel[] }) {
  const groups = comparisonModel(cards);
  const hasCurrent = cards.some((c) => c.isCurrent);
  const th = "px-4 py-3 text-left align-top";
  const td = "px-4 py-3 align-top text-sm text-foreground";
  return (
    <section id={COMPARISON_ID} className="cx-shadow scroll-mt-4 overflow-hidden rounded-3xl border border-border bg-card" aria-labelledby="plans-compare-title">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5 sm:p-6">
        <span aria-hidden="true" data-tone="night" className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <Layers className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="plans-compare-title" className="text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
            Comparativa completa de planes
          </h3>
          <p className="text-sm text-muted-foreground">
            Precios, límites y ventajas de cada plan tal como los publica el catálogo oficial.
            {hasCurrent && " La flecha marca lo que cambia frente a tu plan."}
          </p>
        </div>
      </div>

      {/* Escritorio y tableta: tabla */}
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Comparativa de los planes de Elephant Core</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={cn(th, "w-[24%] text-xs font-semibold uppercase tracking-wider text-muted-foreground")}>
                Característica
              </th>
              {cards.map((c) => {
                const pr = planPresentation(c.plan);
                return (
                  <th key={c.plan.key} scope="col" data-tone={pr.tone} className={cn(th, c.isCurrent && "sx-col-current")}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="cx-tone-chip h-2.5 w-2.5 shrink-0 rounded-full" />
                      <span className="text-base font-bold text-foreground">{c.plan.name}</span>
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{c.currentLabel ?? pr.audience ?? c.commercialLabel}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.id} className="[&_tr]:border-b [&_tr]:border-border">
              <tr>
                <th scope="colgroup" colSpan={cards.length + 1} className="bg-muted/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className={cn(td, "text-left font-normal text-muted-foreground")}>
                    {r.label}
                  </th>
                  {r.cells.map((cell, i) => (
                    <td key={cards[i].plan.key} data-tone={planPresentation(cards[i].plan).tone} className={cn(td, "break-words", cards[i].isCurrent && "sx-col-current")}>
                      {cell.node}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Móvil: grupos desplegables, cada característica con el valor de cada plan */}
      <div className="divide-y divide-border md:hidden">
        {groups.map((g, gi) => (
          <details key={g.id} className="sx-details group" open={gi === 0}>
            <summary className="flex items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-foreground">
              {g.label}
              <ChevronDown className="sx-chevron h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </summary>
            <dl className="space-y-4 px-5 pb-5">
              {g.rows.map((r) => (
                <div key={r.label} className="space-y-1.5">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</dt>
                  <dd>
                    <ul className="space-y-1.5">
                      {r.cells.map((cell, i) => {
                        const pr = planPresentation(cards[i].plan);
                        return (
                          <li key={cards[i].plan.key} data-tone={pr.tone} className={cn("flex items-start gap-3 rounded-xl px-3 py-2 text-sm", cards[i].isCurrent ? "sx-col-current" : "bg-muted/40")}>
                            <span className="cx-tone-text w-20 shrink-0 font-semibold">{cards[i].plan.name}</span>
                            <span className="min-w-0 flex-1 break-words text-foreground">{cell.node}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}

export function PlanComparison({
  cards,
  currentKey,
  requests,
  current,
  onConvert,
}: {
  cards: PlanCardModel[];
  /** Plan de la licencia de la empresa (para destacar solo lo que es un crecimiento). */
  currentKey: string | null;
  /** Solicitudes de plan de la empresa (para no repetir una que ya está abierta). */
  requests: PlanRequestView[] | undefined;
  /** Plan e intervalo del contrato (para el diálogo de cambio). */
  current: { plan: string; interval: "month" | "year" } | null;
  onConvert: (plan: SelfServicePlanKey) => void;
}) {
  const [choosing, setChoosing] = useState<PlanOption | null>(null);
  return (
    <>
      <ul className={cn("grid items-stretch gap-6 pt-3", cards.length >= 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
        {cards.map((c) => (
          <PlanCard key={c.plan.key} card={c} currentKey={currentKey} requests={requests} onConvert={onConvert} onChange={setChoosing} />
        ))}
      </ul>
      <PlanComparisonTable cards={cards} />
      {choosing && current && <PlanChangeDialog current={current} option={choosing} onClose={() => setChoosing(null)} />}
    </>
  );
}

/** Garantías que acompañan al comparador (las mismas que ya dice la página, visibles de un vistazo). */
export function PlanAssurances({ trial }: { trial: boolean }) {
  const items = [trial ? "Todo lo que has preparado en la prueba se conserva" : "Tus datos y tu configuración se conservan", "Ves el importe antes de pagar"];
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm">
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> {t}
        </li>
      ))}
    </ul>
  );
}
