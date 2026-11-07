/**
 * Funcionalidades de un producto Elephant Net agrupadas por áreas, con su estado real: «Disponible» (operativa hoy) o
 * «Próximamente» (incluida en el producto, pendiente de desarrollo; nunca una extensión de pago aparte).
 * La usan la ficha del marketplace y la portada del producto en el panel.
 */
import { CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NetArea } from "@shared/netProducts";

export function NetFeatureAreas({ areas, title = "Funcionalidades incluidas", intro }: { areas: NetArea[]; title?: string; intro?: string }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="net-areas-t">
      <div className="space-y-1">
        <h2 id="net-areas-t" className="text-lg font-bold text-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{intro ?? "Todo va incluido en el producto, sin extensiones adicionales. Lo marcado como «Próximamente» se activará en tu producto cuando esté listo, sin coste extra."}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {areas.map((a) => (
          <div key={a.title} className="space-y-2 rounded-xl border border-border bg-background/60 p-4">
            <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
            <ul className="space-y-1.5">
              {a.features.map((f) => (
                <li key={f.label} className="flex items-start justify-between gap-3 text-sm">
                  <span className={cn("flex min-w-0 items-start gap-2", f.status === "available" ? "text-foreground" : "text-muted-foreground")}>
                    {f.status === "available" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="break-words">{f.label}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      f.status === "available" ? "border-primary/30 bg-primary/10 text-foreground" : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {f.status === "available" ? "Disponible" : "Próximamente"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
