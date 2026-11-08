/**
 * Puesta en marcha de Elephant Finance Sync: lo que antes exigía implantación acompañada, en autoservicio. Cada paso se
 * marca solo con los datos reales de la empresa (financeSync.setup): extracto bancario, operaciones del datáfono (Excel
 * o buzón de tickets), buzón IMAP en la bóveda de la empresa y primera conciliación.
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, CircleDashed, Loader2, Lock, MailCheck, Rocket } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { fieldFormatProblem, type PanelIntegration } from "@shared/integrationsPanel";
import { BANK_STATEMENT_FORMATS, type FinanceSyncStep, type FinanceSyncStepStatus } from "@shared/financeSyncSetup";
import { FieldInput } from "../settings/Integrations";

const STATUS: Record<FinanceSyncStepStatus, { icon: typeof Circle; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", label: "Hecho" },
  todo: { icon: Circle, className: "text-muted-foreground", label: "Pendiente" },
  optional: { icon: CircleDashed, className: "text-sky-600 dark:text-sky-400", label: "Opcional" },
  blocked: { icon: Lock, className: "text-muted-foreground", label: "Necesita los pasos anteriores" },
  attention: { icon: AlertTriangle, className: "text-red-600 dark:text-red-400", label: "Revisar" },
};

function StepItem({ s, index }: { s: FinanceSyncStep; index: number }) {
  const st = STATUS[s.status];
  const Icon = st.icon;
  const isAnchor = s.href.includes("#");
  const linkClass = "inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/50";
  return (
    <li className="bg-card border border-border/50 rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${st.className}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {index + 1}. {s.title}
            </h3>
            <span className={`text-xs font-medium ${st.className}`}>{st.label}</span>
          </div>
          <p className="text-sm text-muted-foreground">{s.description}</p>
          <p className="text-xs text-foreground/70">{s.detail}</p>
          {s.id === "bankStatement" && s.status !== "done" && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground" aria-label="Formatos admitidos">
              {BANK_STATEMENT_FORMATS.map((f) => (
                <li key={f.label}>
                  <span className="font-medium text-foreground">{f.label}</span> ({f.extensions}): {f.help}
                </li>
              ))}
            </ul>
          )}
          {s.status !== "blocked" && (
            <div className="pt-2">
              {isAnchor ? (
                <a href={s.href.slice(s.href.indexOf("#"))} className={linkClass}>
                  {s.action}
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </a>
              ) : (
                <Link href={s.href} className={linkClass}>
                  {s.action}
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function MailboxCard({ p, ingestionEnabled, onChanged }: { p: PanelIntegration; ingestionEnabled: boolean; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = trpc.financeSync.saveMailbox.useMutation();
  const test = trpc.financeSync.testMailbox.useMutation();
  const ingestion = trpc.financeSync.setIngestion.useMutation();

  // Solo lo cambiado de verdad (una contraseña en blanco conserva la guardada)
  const changed: Record<string, string> = {};
  for (const [k, x] of Object.entries(vals)) {
    const f = p.fields.find((y) => y.key === k);
    if (!f) continue;
    if (f.secret ? x !== "" : x !== (f.display ?? "")) changed[k] = x;
  }
  const errors: Record<string, string | null> = {};
  for (const f of p.fields) errors[f.key] = vals[f.key] !== undefined ? fieldFormatProblem(f, vals[f.key]) : null;
  const hasErrors = Object.values(errors).some(Boolean);
  const dirty = Object.keys(changed).length > 0;
  const working = p.state === "working";

  return (
    <section id="buzon" aria-labelledby="buzon-titulo" className="bg-card border border-border/50 rounded-2xl overflow-hidden scroll-mt-20">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h2 id="buzon-titulo" className="text-sm font-semibold">
            Buzón de tickets del datáfono
          </h2>
          <p className="text-xs text-muted-foreground">
            El buzón donde tu banco te envía la copia de cada ticket. Solo se leen los correos del remitente que indiques; no se
            borran ni se mueven. La contraseña se guarda cifrada y no se vuelve a mostrar.
          </p>
        </div>
        <span className={`text-xs font-medium ${working ? "text-emerald-600 dark:text-emerald-400" : p.state === "failing" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
          {p.stateLabel}
        </span>
      </div>

      <form
        className="p-5 space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (hasErrors) {
            toast.error("Revisa los datos marcados en rojo");
            return;
          }
          try {
            await save.mutateAsync({ values: changed });
            setVals({});
            setResult(null);
            toast.success("Buzón guardado. Ahora pulsa «Comprobar conexión».");
            onChanged();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "No se pudo guardar");
          }
        }}
      >
        {p.stateDetail && <p className={`text-xs ${p.state === "failing" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{p.stateDetail}</p>}
        {p.fields.map((f) => (
          <FieldInput key={f.key} p={p} f={f} value={vals[f.key]} error={errors[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
        ))}
        <p className="text-xs text-muted-foreground">Si dejas vacía la dirección que envía los tickets, se usa la de Comercia Global Payments.</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" disabled={!dirty || hasErrors || save.isPending} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            disabled={!p.configured || dirty || test.isPending}
            title={dirty ? "Guarda antes los cambios" : undefined}
            className="h-10 px-4 rounded-lg border border-border/60 text-sm disabled:opacity-50"
            onClick={async () => {
              try {
                setResult(await test.mutateAsync());
              } catch (err) {
                setResult({ ok: false, message: err instanceof Error ? err.message : "No se pudo comprobar" });
              }
              onChanged();
            }}
          >
            {test.isPending ? "Comprobando…" : "Comprobar conexión"}
          </button>
        </div>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {result.message}
          </p>
        )}

        <div className="border-t border-border/50 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium flex items-center gap-2">
              <MailCheck className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              Lectura automática cada 5 minutos
            </p>
            <p className="text-xs text-muted-foreground">
              {ingestionEnabled
                ? "Encendida para tu empresa: los tickets nuevos se convierten en operaciones del datáfono."
                : working
                  ? "Apagada. Enciéndela para que los tickets se lean solos."
                  : "Se puede encender cuando la conexión del buzón esté comprobada."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ingestionEnabled}
            disabled={ingestion.isPending || (!ingestionEnabled && !working)}
            className={`h-10 px-4 rounded-lg text-sm font-medium disabled:opacity-50 ${ingestionEnabled ? "border border-border/60" : "bg-primary text-primary-foreground"}`}
            onClick={async () => {
              try {
                await ingestion.mutateAsync({ enabled: !ingestionEnabled });
                toast.success(ingestionEnabled ? "Lectura automática apagada" : "Lectura automática encendida");
                onChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "No se pudo cambiar");
              }
            }}
          >
            {ingestion.isPending ? "Guardando…" : ingestionEnabled ? "Apagar" : "Encender"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function FinanceSyncSetup() {
  const q = trpc.financeSync.setup.useQuery();
  const d = q.data;

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-primary" aria-hidden="true" />
            Puesta en marcha de Finance Sync
          </h1>
          <p className="text-sm text-muted-foreground">
            Conecta tu banco y tu datáfono en unos minutos, sin esperar al equipo de implantación. Cada paso se marca solo en
            cuanto la plataforma ve los datos.
          </p>
        </div>

        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : q.isError || !d ? (
          <div role="alert" className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-red-600 dark:text-red-400">
            No se pudo cargar la puesta en marcha. Recarga la página para intentarlo de nuevo.
          </div>
        ) : (
          <>
            <div
              role="status"
              className={`rounded-2xl border p-4 sm:p-5 ${d.ready ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{d.ready ? "Finance Sync está listo" : "Aún falta algo para empezar"}</p>
                <span className="text-xs text-muted-foreground">
                  {d.completed} de {d.total} pasos necesarios
                </span>
              </div>
              {d.ready ? (
                <p className="text-sm text-muted-foreground mt-1">Ya tienes banco y datáfono. Revisa las conciliaciones sugeridas cuando quieras.</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                  {d.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>

            <ol className="space-y-3">
              {d.steps.map((s, i) => (
                <StepItem key={s.id} s={s} index={i} />
              ))}
            </ol>

            {d.mailbox ? (
              <MailboxCard p={d.mailbox} ingestionEnabled={d.ingestionEnabled} onChanged={() => q.refetch()} />
            ) : (
              <div id="buzon" className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-muted-foreground">
                En esta instalación el buzón de tickets lo configura el equipo técnico. Mientras tanto, puedes importar el Excel de
                operaciones del datáfono.
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
