/**
 * Marketing · Puesta en marcha y resumen (/admin/marketing/resumen): los cuatro módulos del Paquete Marketing (Ads
 * Manager, Campaigns, SEO Control y GEO Control) en una pantalla. Arriba, un resumen con el avance global; debajo, una
 * ficha por módulo con qué está hecho, el siguiente paso con el enlace a su pantalla y sus cifras clave, calculado con
 * los datos reales de la empresa (marketingPack.summary). Lo no incluido sale como tal, con enlace a «Amplía tu
 * empresa». Solo lectura: lo que se configura, se configura en la pantalla de cada módulo. La autorización real la
 * aplica el servidor. Las cifras del resumen se derivan de las mismas comprobaciones (no se repiten en las fichas).
 */
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Circle, CircleDashed, Lock, Rocket } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import type { Tone } from "@/lib/panelTones";
import type { MarketingModuleState, MarketingModuleView } from "@shared/marketingPack";

const STATE_TONE: Record<MarketingModuleState, Tone> = {
  ready: "success",
  in_progress: "warning",
  to_start: "neutral",
  unavailable: "danger",
  not_included: "neutral",
};

const linkClass = "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted/60";

function pendingChecks(m: MarketingModuleView) {
  return m.checks.filter((c) => !c.done && !c.optional).length;
}

function ModuleCard({ m }: { m: MarketingModuleView }) {
  const { t } = useI18n();
  const off = m.state === "not_included";
  const required = m.checks.filter((c) => !c.optional);
  const doneCount = required.filter((c) => c.done).length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 0;
  return (
    <section aria-labelledby={`mk-${m.id}`} className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm ${off ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={`mk-${m.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {off && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
            {m.name}
          </h2>
          <p className="break-words text-xs text-muted-foreground">{m.description}</p>
        </div>
        <StatusBadge tone={STATE_TONE[m.state]}>
          {m.stateLabel}
          {m.readOnly ? t("marketingSummary.readOnly") : ""}
        </StatusBadge>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        {m.message && <p className={`text-xs ${m.state === "unavailable" ? "text-danger" : "text-muted-foreground"}`}>{m.message}</p>}
        {off && <p className="text-sm text-muted-foreground">{t("marketingSummary.notIncluded")}</p>}

        {m.figures.length > 0 && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {m.figures.map((f) => (
              <div key={f.label} className="min-w-0 rounded-xl border border-border bg-muted/20 p-3">
                <dt className="break-words text-xs text-muted-foreground">{f.label}</dt>
                <dd className="break-words text-lg font-semibold text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {required.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("marketingSummary.progress", { done: doneCount, total: required.length })}</span>
              <span>{pct} %</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {m.checks.length > 0 && (
          <ul className="space-y-1.5" aria-label={t("marketingSummary.setupOf", { name: m.name })}>
            {m.checks.map((c) => {
              const Icon = c.done ? CheckCircle2 : c.optional ? CircleDashed : Circle;
              return (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.done ? "text-success" : c.optional ? "text-info" : "text-muted-foreground"}`} aria-hidden="true" />
                  <span className={`min-w-0 break-words ${c.done ? "text-foreground" : "text-muted-foreground"}`}>
                    {c.label}
                    {c.optional ? t("marketingSummary.optional") : ""}
                    <span className="sr-only">{c.done ? t("marketingSummary.done") : t("marketingSummary.todo")}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-auto space-y-2">
          {m.nextStep && (
            <div className="flex flex-col gap-2 rounded-lg bg-primary/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 flex-1 break-words text-sm text-foreground sm:min-w-[12rem]">
                <span className="font-medium">{off ? t("marketingSummary.toHaveIt") : t("marketingSummary.nextStep")}</span>
                {m.nextStep.label}
              </p>
              <Link href={m.nextStep.href} className={linkClass}>
                {off ? t("marketingSummary.howToAdd") : t("marketingSummary.go")}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}
          {!off && m.nextStep?.href !== m.href && (
            <p className="text-xs">
              <Link href={m.href} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {t("marketingSummary.open", { name: m.name })}
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function MarketingSummary() {
  const { t } = useI18n();
  const q = trpc.marketingPack.summary.useQuery(undefined, { retry: false });
  const d = q.data;

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <PanelPageHeader icon={<Rocket />} title={t("marketingSummary.title")} description={t("marketingSummary.description")} />

        {q.isLoading ? (
          <PanelLoading />
        ) : q.isError || !d ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} title={t("marketingSummary.loadError")} />
        ) : (
          <>
            {(() => {
              const allReady = d.ready === d.included;
              const pending = d.modules.filter((m) => m.state !== "not_included").reduce((n, m) => n + pendingChecks(m), 0);
              const pct = d.included ? Math.round((d.ready / d.included) * 100) : 0;
              return (
                <div role="status" className={`rounded-xl border p-5 sm:p-6 ${allReady ? "border-success/40 bg-gradient-to-br from-success/10 to-card" : "border-primary/30 bg-gradient-to-br from-primary/10 to-card"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-foreground">{allReady ? t("marketingSummary.heroDone") : t("marketingSummary.heroPending")}</p>
                      {!d.complete && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("marketingSummary.notComplete", { included: d.included })}{" "}
                          <Link href="/admin/ampliar" className="underline underline-offset-2">
                            {t("marketingSummary.upgradeLink")}
                          </Link>
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold leading-none text-foreground">{pct} %</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t("marketingSummary.heroCount", { ready: d.ready, included: d.included })}</p>
                      <p className="text-xs text-muted-foreground">{t("marketingSummary.heroSteps", { n: pending })}</p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                    <div className={`h-full rounded-full transition-all ${allReady ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}
            <div className="grid gap-4 lg:grid-cols-2">
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
