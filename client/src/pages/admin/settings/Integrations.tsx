import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, Loader2, ShieldCheck } from "lucide-react";
import { fieldFormatProblem, groupIntegrations, type PanelField, type PanelIntegration } from "@shared/integrationsPanel";

const STATE_STYLE: Record<PanelIntegration["state"], { icon: typeof Circle; className: string }> = {
  off: { icon: Circle, className: "text-muted-foreground" },
  incomplete: { icon: CircleDashed, className: "text-amber-600 dark:text-amber-400" },
  unchecked: { icon: CircleDashed, className: "text-sky-600 dark:text-sky-400" },
  working: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  failing: { icon: AlertTriangle, className: "text-red-600 dark:text-red-400" },
};

function FieldInput({ p, f, value, onChange, error }: { p: PanelIntegration; f: PanelField; value: string | undefined; onChange: (v: string) => void; error: string | null }) {
  const id = `${p.id}-${f.key}`;
  const describedBy = [f.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const current = value ?? (f.secret ? "" : f.display ?? "");
  return (
    <div className="space-y-1">
      <label htmlFor={f.control === "yesno" ? undefined : id} id={`${id}-label`} className="text-sm font-medium flex flex-wrap items-center gap-2">
        {f.label}
        {f.required && <span className="text-xs font-normal text-muted-foreground">(obligatorio)</span>}
        {f.secret && <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" aria-label="Se guarda cifrado" />}
      </label>
      {f.control === "yesno" ? (
        <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="inline-flex rounded-lg border border-border/60 p-0.5">
          {f.options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={current === o.value}
              onClick={() => onChange(o.value)}
              className={`h-9 min-w-16 rounded-md px-4 text-sm ${current === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : f.control === "choice" ? (
        <select
          id={id}
          className="w-full h-10 rounded-lg border border-border/60 bg-background px-3 text-sm"
          value={current}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Elige una opción</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={`w-full h-10 rounded-lg border bg-background px-3 text-sm ${error ? "border-red-500" : "border-border/60"}`}
          type={f.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={f.set && f.secret ? `Guardada (${f.display}). Déjala en blanco para conservarla` : !f.set && f.example ? `Por ejemplo: ${f.example}` : ""}
          value={current}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {f.help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {f.help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function ProviderCard({ p, onChanged }: { p: PanelIntegration; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = trpc.integrations.save.useMutation();
  const clear = trpc.integrations.clear.useMutation();
  const test = trpc.integrations.test.useMutation();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Solo lo que el usuario ha cambiado de verdad (un secreto vacío se conserva)
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
  const style = STATE_STYLE[p.state];
  const StateIcon = style.icon;

  return (
    <section aria-labelledby={`${p.id}-title`} className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h3 id={`${p.id}-title`} className="text-sm font-semibold">
            {p.title}
          </h3>
          <p className="text-xs text-muted-foreground">{p.summary}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${style.className}`}>
          <StateIcon className="w-4 h-4" aria-hidden="true" />
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
            await save.mutateAsync({ provider: p.id, values: changed });
            setVals({});
            setResult(null);
            toast.success(`${p.title}: guardado`);
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

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={!dirty || hasErrors || save.isPending}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
          {p.canTest && (
            <button
              type="button"
              disabled={!p.configured || test.isPending}
              className="h-10 px-4 rounded-lg border border-border/60 text-sm disabled:opacity-50"
              onClick={async () => {
                try {
                  setResult(await test.mutateAsync({ provider: p.id }));
                  onChanged();
                } catch (err) {
                  setResult({ ok: false, message: err instanceof Error ? err.message : "No se pudo comprobar" });
                }
              }}
            >
              {test.isPending ? "Comprobando…" : "Probar conexión"}
            </button>
          )}
          {p.configured && (
            <button
              type="button"
              className="h-10 px-4 rounded-lg text-sm text-red-600 dark:text-red-400"
              onClick={async () => {
                if (!window.confirm(`¿Quitar los datos de «${p.title}»? Quedará desactivada.`)) return;
                await clear.mutateAsync({ provider: p.id });
                setResult(null);
                toast.success(`${p.title}: desactivada`);
                onChanged();
              }}
            >
              Quitar datos
            </button>
          )}
        </div>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {result.message}
          </p>
        )}
      </form>
    </section>
  );
}

export default function Integrations() {
  const avail = trpc.integrations.available.useQuery();
  const list = trpc.integrations.list.useQuery(undefined, { enabled: avail.data?.available === true });
  const groups = groupIntegrations((list.data ?? []) as PanelIntegration[]);

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Integraciones y pagos</h1>
          <p className="text-sm text-muted-foreground">
            Conecta tus propias cuentas para cobrar con tarjeta, enviar correos y más. Los datos son de tu empresa y lo que no
            configures queda desactivado. Las claves se guardan cifradas y no se vuelven a mostrar.
          </p>
        </div>

        {avail.isLoading || (avail.data?.available && list.isLoading) ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !avail.data?.available ? (
          <div className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-muted-foreground">
            En esta instalación las integraciones las configura el equipo técnico. Si necesitas cambiar alguna, contacta con soporte.
          </div>
        ) : list.isError ? (
          <div role="alert" className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-red-600 dark:text-red-400">
            No se pudieron cargar las integraciones. Recarga la página para intentarlo de nuevo.
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-muted-foreground">
            Con lo que tienes contratado no hay integraciones que configurar.
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`grupo-${g.id}`} className="space-y-3">
              <div>
                <h2 id={`grupo-${g.id}`} className="text-lg font-semibold">
                  {g.title}
                </h2>
                <p className="text-sm text-muted-foreground">{g.description}</p>
              </div>
              {g.items.map((p) => (
                <ProviderCard key={p.id} p={p} onChanged={() => list.refetch()} />
              ))}
            </section>
          ))
        )}
      </div>
    </AdminLayout>
  );
}
