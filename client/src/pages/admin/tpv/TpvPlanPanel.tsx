/**
 * Lo que incluye tu plan en la caja (estrategia TPV 09/11/2026): cajas activas frente al máximo, funciones incluidas,
 * lo que añaden los planes superiores y TPV Advanced con una sola vía de ampliación, y la hora de corte operativo.
 * Solo explica: quien decide es el servidor (tpv.planInfo, tpv.createRegister, tpv.setCutoffTime).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/admin/PanelStates";
import { Check, Clock, Sparkles } from "lucide-react";
import { TPV_ADVANCED_LABELS, TPV_FEATURES, TPV_FEATURE_LABELS, TPV_TIER_NAMES, tierForFeature, type TpvFeature } from "@shared/tpvPlan";

const ESSENTIAL_INCLUDES = [
  "Cobros manuales y registro de métodos de pago",
  "Tickets y justificantes",
  "Apertura y cierre de caja",
  "Historial de operaciones y resumen diario",
  "Integración con tus ventas y tu facturación",
];

export function registersLabel(max: number | null, tier?: string): string {
  if (max === null) return "Cajas sin límite";
  if (tier === "enterprise") return "Cajas sin límite fijo (uso razonable)";
  return max === 1 ? "1 caja activa" : `Hasta ${max} cajas activas`;
}

export default function TpvPlanPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.tpv.planInfo.useQuery();
  const [cutoff, setCutoff] = useState("00:00");
  useEffect(() => { if (q.data?.cutoff.cutoff) setCutoff(q.data.cutoff.cutoff); }, [q.data?.cutoff.cutoff]);
  const save = trpc.tpv.setCutoffTime.useMutation({
    onSuccess: () => { utils.tpv.planInfo.invalidate(); toast.success("Hora de corte guardada"); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido guardar la hora de corte.")),
  });
  if (!q.data) return null;
  const { plan, activeRegisters, advanced } = q.data;
  const tier = plan?.tier ?? "full";
  const included = TPV_FEATURES.filter((f) => plan?.features[f]);
  const notIncluded = TPV_FEATURES.filter((f) => plan && !plan.features[f]);
  const byTier = (t: "business" | "enterprise") => notIncluded.filter((f: TpvFeature) => tierForFeature(f) === t);
  const max = plan?.maxActiveRegisters ?? null;
  const atLimit = max !== null && tier !== "enterprise" && activeRegisters >= max;

  return (
    <section aria-labelledby="tpv-plan" className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="tpv-plan" className="text-base font-semibold text-foreground">
            {tier === "full" ? "Tu caja" : `Tu caja en el plan ${TPV_TIER_NAMES[tier]}`}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {registersLabel(max, tier)} · tienes {activeRegisters} {activeRegisters === 1 ? "activa" : "activas"}
            {atLimit && tier !== "full" ? ". Para añadir otra, desactiva una o amplía tu plan." : ""}
          </p>
        </div>
        {notIncluded.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/suscripcion">Ver planes</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Incluido</h3>
          <ul className="space-y-1">
            {[...ESSENTIAL_INCLUDES, ...included.map((f) => TPV_FEATURE_LABELS[f])].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="w-4 h-4 mt-0.5 text-success shrink-0" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
          {q.data.acquired.features.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Como cliente desde antes del {q.data.acquired.cutoff.split("-").reverse().join("/")}, conservas {q.data.acquired.features.map((f) => TPV_FEATURE_LABELS[f as TpvFeature].toLowerCase()).join(", ")}.
            </p>
          )}
        </div>
        <div className="space-y-3">
          {(["business", "enterprise"] as const).map((t) =>
            byTier(t).length > 0 ? (
              <div key={t}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Con {TPV_TIER_NAMES[t]}</h3>
                <p className="text-sm text-muted-foreground">
                  {t === "business" ? "Hasta 3 cajas activas, " : "Cajas sin límite fijo, "}
                  {byTier(t).map((f) => TPV_FEATURE_LABELS[f].toLowerCase()).join(", ")}.
                </p>
              </div>
            ) : null,
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> TPV Advanced {advanced ? "· contratado" : ""}
            </h3>
            <p className="text-sm text-muted-foreground">
              {TPV_ADVANCED_LABELS.join(", ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}.
              {!advanced && " Sobre la caja de tu plan, 19 €/mes + IVA, bajo solicitud."}
            </p>
          </div>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        onSubmit={(e) => { e.preventDefault(); save.mutate({ cutoff }); }}
      >
        <div className="space-y-1">
          <Label htmlFor="tpv-cutoff" className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden="true" /> Hora de cambio de día</Label>
          <Input id="tpv-cutoff" type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="w-32" disabled={!canManage} />
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          Lo que se cobra antes de esta hora cuenta para el día anterior en el resumen diario y en el cierre. Por defecto, las 00:00 ({q.data.cutoff.timeZone}). Cada caja puede tener la suya.
        </p>
        <Button type="submit" size="sm" variant="outline" disabled={!canManage || save.isPending || cutoff === q.data.cutoff.cutoff}>Guardar</Button>
      </form>
    </section>
  );
}
