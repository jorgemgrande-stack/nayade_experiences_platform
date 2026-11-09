/**
 * Marketing · Puesta en marcha y resumen (/admin/marketing/resumen): los cuatro módulos del Paquete Marketing (Ads
 * Manager, Campaigns, SEO Control y GEO Control) en una pantalla. Para cada uno incluido: qué está hecho, el siguiente
 * paso con el enlace a su pantalla y sus cifras clave, calculado con los datos reales de la empresa
 * (marketingPack.summary). Lo no incluido sale como tal, con enlace a «Amplía tu empresa». Solo lectura: lo que se
 * configura, se configura en la pantalla de cada módulo. La autorización real la aplica el servidor.
 */
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Circle, CircleDashed, Lock, Rocket } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import type { MarketingModuleState, MarketingModuleView } from "@shared/marketingPack";

const STATE_TONE: Record<MarketingModuleState, string> = {
  ready: "text-emerald-600 dark:text-emerald-400",
  in_progress: "text-amber-600 dark:text-amber-400",
  to_start: "text-muted-foreground",
  unavailable: "text-red-600 dark:text-red-400",
  not_included: "text-muted-foreground",
};

const linkClass = "inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/50";

function ModuleCard({ m }: { m: MarketingModuleView }) {
  const off = m.state === "not_included";
  return (
    <section aria-labelledby={`mk-${m.id}`} className={`bg-card border border-border/50 rounded-2xl overflow-hidden ${off ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h2 id={`mk-${m.id}`} className="text-sm font-semibold flex items-center gap-1.5">
            {off && <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />}
            {m.name}
          </h2>
          <p className="text-xs text-muted-foreground break-words">{m.description}</p>
        </div>
        <span className={`text-xs font-medium ${STATE_TONE[m.state]}`}>
          {m.stateLabel}
          {m.readOnly ? " · solo lectura" : ""}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {m.message && <p className={`text-xs ${m.state === "unavailable" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{m.message}</p>}
        {off && <p className="text-sm text-muted-foreground">Este módulo no forma parte de lo que tu empresa tiene contratado. Viene incluido en el Paquete Marketing.</p>}

        {m.figures.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {m.figures.map((f) => (
              <div key={f.label} className="rounded-xl border border-border/50 p-3 min-w-0">
                <dt className="text-xs text-muted-foreground break-words">{f.label}</dt>
                <dd className="text-lg font-semibold break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {m.checks.length > 0 && (
          <ul className="space-y-1.5" aria-label={`Puesta en marcha de ${m.name}`}>
            {m.checks.map((c) => {
              const Icon = c.done ? CheckCircle2 : c.optional ? CircleDashed : Circle;
              return (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${c.done ? "text-emerald-600 dark:text-emerald-400" : c.optional ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`} aria-hidden="true" />
                  <span className={`min-w-0 break-words ${c.done ? "" : "text-muted-foreground"}`}>
                    {c.label}
                    {c.optional ? " (opcional)" : ""}
                    <span className="sr-only">{c.done ? ": hecho" : ": pendiente"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {m.nextStep && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-sm min-w-0 flex-1 break-words">
              <span className="font-medium">{off ? "Para tenerlo: " : "Siguiente paso: "}</span>
              {m.nextStep.label}
            </p>
            <Link href={m.nextStep.href} className={linkClass}>
              {off ? "Ver cómo añadirlo" : "Ir"}
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        )}
        {!off && m.nextStep?.href !== m.href && (
          <p className="text-xs">
            <Link href={m.href} className="underline underline-offset-2 text-muted-foreground hover:text-foreground">
              Abrir {m.name}
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

export default function MarketingSummary() {
  const q = trpc.marketingPack.summary.useQuery(undefined, { retry: false });
  const d = q.data;

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect · Paquete Marketing</p>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-primary" aria-hidden="true" />
            Marketing · Puesta en marcha y resumen
          </h1>
          <p className="text-sm text-muted-foreground">
            Publicidad, campañas de correo, SEO y visibilidad en IA en una sola pantalla: qué tienes ya funcionando, qué falta y
            dónde se hace. Cada estado se calcula con los datos reales de tu empresa.
          </p>
        </header>

        {q.isLoading ? (
          <PanelLoading />
        ) : q.isError || !d ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title="No se pudo cargar el resumen de marketing" />
        ) : (
          <>
            <div role="status" className={`rounded-2xl border p-4 sm:p-5 ${d.ready === d.included ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{d.ready === d.included ? "Tus módulos de marketing están funcionando" : "Aún falta algo para tenerlo todo en marcha"}</p>
                <span className="text-xs text-muted-foreground">
                  {d.ready} de {d.included} {d.included === 1 ? "módulo funcionando" : "módulos funcionando"}
                </span>
              </div>
              {!d.complete && (
                <p className="text-sm text-muted-foreground mt-1">
                  Tienes {d.included} de los 4 módulos. El Paquete Marketing los incluye todos.{" "}
                  <Link href="/admin/ampliar" className="underline underline-offset-2">
                    Ver cómo ampliarlo
                  </Link>
                </p>
              )}
            </div>
            <div className="space-y-4">
              {d.modules.map((m) => (
                <ModuleCard key={m.id} m={m} />
              ))}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
