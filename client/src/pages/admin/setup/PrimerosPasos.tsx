/**
 * «Primeros pasos»: asistente de configuración inicial de la empresa.
 *
 * El progreso se guarda en el servidor (por empresa): se puede dejar a medias, volver atrás, corregir y continuar
 * después. El recorrido lo calcula el servidor (`plan`): solo los pasos de lo contratado, en el orden que mejor
 * encaja con el tipo de actividad, y los pasos «de hacer» se marcan solos cuando el dato existe. Ningún paso
 * bloquea el uso del sistema.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, Blocks, Briefcase, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, Globe, Hand, HelpCircle,
  Landmark, Loader2, Mail, Package, Palette, PartyPopper, Receipt, SkipForward, Star, UserPlus, Users,
} from "lucide-react";
import { BrandIdentityEditor } from "@/components/brand/BrandIdentityEditor";
import { STEP_LABELS, activityInfo, configurationStepNumber, configurationSteps, stepAfter, type SetupStep } from "@shared/setupWizard";
import {
  ActivityStep, ClientStep, CommsStep, FinishStep, FiscalStep, IdentityStep, OperationStep, ProductStep, SectorStep, WebStep, WelcomeStep, errMsg,
} from "./PrimerosPasosSteps";

const ICONS: Record<SetupStep, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  welcome: Hand,
  company: Building2,
  fiscal: Landmark,
  brand: Palette,
  activity: Briefcase,
  client: Users,
  product: Package,
  web: Globe,
  operation: Receipt,
  comms: Mail,
  sector: Blocks,
  finish: PartyPopper,
  users: UserPlus,
};

const HELP: Record<SetupStep, string> = {
  welcome: "El asistente solo te pide lo que aún no consta y se adapta a lo que tienes contratado.",
  company: "Es el nombre con el que te ven tus clientes y la base de fechas e importes del panel. Lo puedes cambiar más tarde en Datos de la empresa.",
  fiscal: "Estos datos aparecen en tus presupuestos y facturas. Sin ellos no se pueden emitir facturas válidas.",
  brand: "Tu logotipo y tus colores se aplican a la vez en tu web, en tus documentos y en la pantalla de acceso de tu equipo. Los puedes cambiar cuando quieras en Web › Marca y tema.",
  activity: "Solo ordena los pasos y adapta los textos y ejemplos. No activa módulos ni contrata nada.",
  client: "Tus clientes quedan en el CRM con su historial de presupuestos, pedidos y facturas.",
  // Misma convención que el gestor de productos: el precio guardado es el precio final, con el impuesto incluido
  product: "El precio se indica con impuestos incluidos (precio final); el impuesto se desglosa en presupuestos y facturas.",
  web: "Tu web se publica con tu dominio y tu marca. Puedes empezar con las páginas iniciales y mejorarlas poco a poco.",
  operation: "Un presupuesto se envía al cliente para que lo acepte; un pedido es una venta confirmada; la factura es el documento fiscal; la caja registra las ventas en mostrador.",
  comms: "Los correos salen siempre con el nombre de tu empresa. Las respuestas de tus clientes llegan a la dirección que indiques.",
  sector: "Los módulos sectoriales tienen su propia configuración. Aquí tienes el acceso directo a cada uno.",
  finish: "Puedes volver a este asistente cuando quieras desde el Inicio.",
  users: "Cada persona entra con su propio usuario. El número de usuarios depende de tu plan.",
};

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

export default function PrimerosPasos() {
  const utils = trpc.useUtils();
  const sub = usePanelSubscription();
  const status = trpc.setupWizard.status.useQuery(undefined, { retry: false });
  const [current, setCurrent] = useState<SetupStep | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Al cargar, se continúa por el primer paso pendiente (reanudación)
  useEffect(() => {
    if (current || !status.data) return;
    setCurrent(status.data.nextStep ?? "finish");
  }, [status.data, current]);
  // El foco va al título del paso al cambiar (lectores de pantalla y teclado)
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const setStep = trpc.setupWizard.setStep.useMutation({
    onSuccess: () => utils.setupWizard.status.invalidate(),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (status.isLoading || (!current && !status.error)) {
    return (
      <AdminLayout title="Primeros pasos">
        <div className="flex items-center gap-2 p-8 text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
        </div>
      </AdminLayout>
    );
  }
  if (status.error || !status.data || !current) {
    return (
      <AdminLayout title="Primeros pasos">
        <div role="alert" className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          No se pudo cargar el asistente: {status.error?.message ?? "inténtalo de nuevo"}.
        </div>
      </AdminLayout>
    );
  }

  const d = status.data;
  const readOnly = d.licence.readOnly;
  const steps = d.plan.steps;
  // Un paso que ya no se ve (p. ej. se dejó de contratar) lleva al resumen
  const shown: SetupStep = steps.some((s) => s.id === current) ? current : "finish";
  const idx = Math.max(0, steps.findIndex((s) => s.id === shown));
  const step = steps[idx];
  const go = (s: SetupStep) => setCurrent(s);
  // Siguiente sobre el plan más reciente (tras guardar, el servidor puede haber reordenado los pasos)
  const goNext = () => setCurrent(stepAfter(utils.setupWizard.status.getData()?.plan.steps ?? steps, shown));
  const goPrev = () => setCurrent(steps[Math.max(idx - 1, 0)].id);
  // Pasos «de hacer»: el dato real los completa; aun así queda registrado el avance
  const advance = (s: SetupStep) => async () => {
    if (!readOnly) await setStep.mutateAsync({ step: s, status: "done" }).catch(() => undefined);
    await utils.setupWizard.status.invalidate();
    goNext();
  };
  const mark = async (s: SetupStep, st: "done" | "skipped") => {
    await setStep.mutateAsync({ step: s, status: st });
    if (s !== "finish") goNext();
  };
  const Icon = ICONS[shown];
  const activity = activityInfo(d.activity);
  const can = (cap: string) => sub.can(cap);
  const planName = d.licence.plan ? PLAN_NAMES[d.licence.plan] ?? null : null;
  // Un único número en todo el recorrido: la bienvenida y el resumen no son pasos de configuración
  const configCount = configurationSteps(steps).length;
  const stepNumber = configurationStepNumber(steps, shown);

  return (
    <AdminLayout title="Primeros pasos">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Configura tu empresa</h1>
              <p className="text-sm text-muted-foreground">
                {configCount} pasos adaptados a tu negocio. Puedes omitir cualquiera y continuar más tarde: el progreso se guarda.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {planName && (
                <p className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                  Plan <strong className="text-foreground">{planName}</strong>
                  {d.licence.daysLeft !== null && !readOnly && <> · prueba: {d.licence.daysLeft === 1 ? "queda 1 día" : `quedan ${d.licence.daysLeft} días`}</>}
                </p>
              )}
              <Link href="/admin" className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                Continuar más tarde
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={d.plan.percent} className="h-2" aria-label="Avance de Primeros pasos" aria-valuetext={`${d.plan.percent}% completado`} />
            <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{d.plan.percent}%</span>
          </div>
          {readOnly && (
            <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <p>Tu periodo de prueba ha terminado: la cuenta está en solo lectura. Tus datos se conservan; contrata un plan para seguir trabajando.</p>
            </div>
          )}
        </header>

        {/* minmax(0,1fr): en móvil el índice de pasos (desplazable) no puede ensanchar la columna ni la página */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Pasos de Primeros pasos" className="min-w-0">
            {/* relative: los textos solo para lectores de pantalla (sr-only, absolutos) quedan dentro de la franja desplazable */}
            <ol className="relative flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {steps.map((s) => {
                const active = s.id === shown;
                const n = configurationStepNumber(steps, s.id);
                const StepIcon = ICONS[s.id];
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => go(s.id)}
                      aria-current={active ? "step" : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          s.status === "done" ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {s.status === "done" ? <Check className="h-3.5 w-3.5" /> : s.status === "skipped" ? <SkipForward className="h-3 w-3" /> : n ?? <StepIcon className="h-3 w-3" />}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {STEP_LABELS[s.id].title}
                        {s.recommended && s.status !== "done" && <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />}
                        <span className="sr-only">
                          {s.status === "done" ? " (hecho)" : s.status === "skipped" ? " (omitido)" : " (pendiente)"}
                          {s.recommended ? ", recomendado para tu actividad" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section aria-labelledby="paso-actual" className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {stepNumber !== null ? `Paso ${stepNumber} de ${configCount}` : shown === "welcome" ? "Antes de empezar" : "Para terminar"}
                  {step?.recommended && <> · recomendado para tu actividad</>}
                </p>
                <h2 id="paso-actual" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
                  {shown === "welcome" ? "Te damos la bienvenida a Elephant Core" : STEP_LABELS[shown].title}
                </h2>
                <p className="text-sm text-muted-foreground">{STEP_LABELS[shown].summary}</p>
              </div>
            </div>

            <details className="mb-5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <HelpCircle className="h-4 w-4" aria-hidden="true" /> ¿Para qué sirve este paso?
              </summary>
              <p className="mt-2 text-muted-foreground">{HELP[shown]}</p>
            </details>

            {/* key: al volver a un paso se parte de los datos guardados */}
            <div key={shown}>
              {shown === "welcome" && <WelcomeStep tradeName={d.company.tradeName} planName={planName} steps={steps} disabled={setStep.isPending || readOnly} onStart={() => void mark("welcome", "done")} />}
              {shown === "company" && <IdentityStep initial={d.company} done={step?.status === "done"} disabled={readOnly} onSaved={goNext} />}
              {shown === "fiscal" && <FiscalStep initial={d.company} done={step?.status === "done"} fiscalFromRegistry={d.fiscalFromRegistry} disabled={readOnly} onSaved={goNext} />}
              {shown === "brand" &&
                (readOnly ? (
                  <p className="text-sm text-muted-foreground">La cuenta está en solo lectura: la marca no se puede cambiar.</p>
                ) : (
                  <BrandIdentityEditor variant="onboarding" onSaved={() => void mark("brand", "done")} />
                ))}
              {shown === "activity" && <ActivityStep initial={d.activity} allowed={d.activities} disabled={readOnly} onSaved={goNext} />}
              {shown === "client" && <ClientStep noun={activity.clientNoun} count={d.facts.clients} disabled={readOnly || !sub.canWrite("crm-contacts")} onDone={advance("client")} />}
              {shown === "product" && (
                <ProductStep noun={activity.productNoun} example={activity.productExample} currency={d.company.currency || "EUR"} count={d.facts.products} disabled={readOnly || !sub.canWrite("shop-catalog")} onDone={advance("product")} />
              )}
              {shown === "web" && <WebStep done={step?.status === "done"} onContinue={advance("web")} />}
              {shown === "operation" && <OperationStep count={d.facts.sales} can={can} disabled={readOnly || !sub.canWrite("crm-quotes")} onDone={advance("operation")} />}
              {shown === "comms" && <CommsStep initial={d.comms} tradeName={d.company.tradeName} done={step?.status === "done"} can={can} disabled={readOnly} onSaved={goNext} />}
              {shown === "sector" && <SectorStep modules={d.sectorModules} disabled={setStep.isPending || readOnly} onDone={() => void mark("sector", "done")} />}
              {shown === "finish" && <FinishStep steps={steps} completedAt={d.progress.completedAt} showTeam={!d.plan.hidden.includes("users") && can("admin-users")} disabled={readOnly} onGo={go} />}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={goPrev} disabled={idx === 0}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Anterior
              </Button>
              <div className="flex flex-wrap gap-2">
                {shown !== "finish" && shown !== "welcome" && step?.status !== "done" && (
                  <Button type="button" variant="outline" disabled={setStep.isPending || readOnly} onClick={() => void mark(shown, "skipped")}>
                    Omitir por ahora
                  </Button>
                )}
                {shown !== "finish" && step?.status === "done" && (
                  <Button type="button" variant="outline" onClick={goNext}>
                    Siguiente <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                {shown === "finish" && !d.progress.completedAt && (
                  <Button type="button" disabled={setStep.isPending || readOnly} onClick={() => void mark("finish", "done").then(() => toast.success("¡Listo! Tu empresa está en marcha."))}>
                    <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Poner en marcha
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
