/**
 * Comparador de planes de Elephant Core (Essential, Business, Enterprise…): tarjetas homogéneas con lo que publica el
 * catálogo central (precio, periodicidad, beneficios, límites, estado comercial) y la acción que el servidor permite
 * HOY a esta persona (contratar desde la prueba, cambiar de plan o hablar con el equipo comercial). Nada se inventa:
 * lo que el catálogo no publica no aparece.
 */
import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@shared/connectCard";
import type { PanelPlanInfo, PlanCardModel, PlanPrice, PlanRequestView, SelfServicePlanKey } from "@shared/subscriptionPlans";
import { PlanRequestCta, openRequestFor } from "./PlanRequests";
import { PlanChangeDialog, type PlanOption } from "./SelfServiceSection";

const tax = (p: PlanPrice) => (p.taxIncluded ? "IVA incluido" : "+ IVA");

function PlanPrices({ plan }: { plan: PanelPlanInfo }) {
  const main = plan.monthly ?? plan.yearly;
  if (!main) return <p className="text-sm text-muted-foreground">Sin precio publicado</p>;
  const per = plan.monthly ? "/mes" : "/año";
  return (
    <div className="min-w-0">
      <p className="text-foreground">
        <strong className="text-3xl font-bold tracking-tight">{formatMoney(main.amountCents, main.currency)}</strong>
        <span className="text-sm text-muted-foreground"> {per}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {plan.monthly ? "Facturación mensual" : "Facturación anual"} · {tax(main)}
      </p>
      {plan.monthly && plan.yearly && (
        <p className="mt-1 text-sm text-muted-foreground">
          O <strong className="font-semibold text-foreground">{formatMoney(plan.yearly.amountCents, plan.yearly.currency)}</strong> /año con facturación anual ({tax(plan.yearly)})
        </p>
      )}
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
  return (
    <li
      className={cn(
        "flex h-full min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 sm:p-6",
        card.isCurrent ? "border-primary shadow-lg ring-1 ring-primary" : "border-border",
      )}
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-center gap-2">
        {card.currentLabel && <Badge className="bg-primary text-primary-foreground">{card.currentLabel}</Badge>}
        <Badge variant="outline">{card.commercialLabel}</Badge>
        {plan.highlight && !card.isCurrent && (
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> Destacado
          </Badge>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        <h3 id={titleId} className="break-words text-xl font-bold text-foreground">
          {plan.name}
        </h3>
        {plan.tagline && <p className="text-sm text-muted-foreground">{plan.tagline}</p>}
      </div>

      <PlanPrices plan={plan} />
      {card.isCurrent && card.currentLabel === "Prueba gratuita" && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-foreground">Lo estás probando gratis: todavía no tienes ninguna suscripción de pago ni se te ha cobrado nada.</p>
      )}

      {plan.benefits.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Principales ventajas</h4>
          <ul className="space-y-1.5">
            {plan.benefits.slice(0, 5).map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 break-words">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.limits.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Límites incluidos</h4>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            {plan.limits.map((l) => (
              <div key={l.label} className="contents">
                <dt className="min-w-0 break-words text-muted-foreground">{l.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-foreground">{l.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {card.differences.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Frente a tu plan</h4>
          <ul className="space-y-1 text-sm">
            {card.differences.map((d) => (
              <li key={d.label} className="flex flex-wrap items-center gap-x-1.5 text-foreground">
                <span className="text-muted-foreground">{d.label}:</span>
                <span>{d.current}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="pasa a" />
                <strong className="font-semibold">{d.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-1">
        {cta.kind === "current" && <p className="rounded-xl border border-border px-3 py-2 text-center text-sm font-medium text-foreground">Es tu plan actual</p>}
        {cta.kind === "convert" && (
          <Button type="button" className="w-full" onClick={() => onConvert(cta.plan)}>
            Contratar {plan.name}
          </Button>
        )}
        {cta.kind === "change" && (
          <>
            <Button
              type="button"
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
      </div>
    </li>
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
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <PlanCard key={c.plan.key} card={c} requests={requests} onConvert={onConvert} onChange={setChoosing} />
        ))}
      </ul>
      {choosing && current && <PlanChangeDialog current={current} option={choosing} onClose={() => setChoosing(null)} />}
    </>
  );
}
