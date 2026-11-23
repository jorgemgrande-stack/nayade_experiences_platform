import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, Loader2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeIntegrationText } from "@shared/i18n/integrationsDe";
import { fieldFormatProblem, groupIntegrations, type PanelField, type PanelIntegration } from "@shared/integrationsPanel";

const STATE_STYLE: Record<PanelIntegration["state"], { icon: typeof Circle; className: string }> = {
  off: { icon: Circle, className: "text-muted-foreground" },
  incomplete: { icon: CircleDashed, className: "text-warning" },
  unchecked: { icon: CircleDashed, className: "text-info" },
  working: { icon: CheckCircle2, className: "text-success" },
  failing: { icon: AlertTriangle, className: "text-danger" },
};

export function FieldInput({ p, f, value, onChange, error }: { p: PanelIntegration; f: PanelField; value: string | undefined; onChange: (v: string) => void; error: string | null }) {
  const { t, locale } = useI18n();
  const L = <T extends string | null | undefined>(x: T) => localizeIntegrationText(x, locale);
  const id = `${p.id}-${f.key}`;
  const describedBy = [f.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const current = value ?? (f.secret ? "" : f.display ?? "");
  return (
    <div className="space-y-1">
      <label htmlFor={f.control === "yesno" ? undefined : id} id={`${id}-label`} className="text-sm font-medium flex flex-wrap items-center gap-2">
        {L(f.label)}
        {f.required && <span className="text-xs font-normal text-muted-foreground">{t("settingsPayments.integrations.required")}</span>}
        {f.secret && <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" aria-label={t("settingsPayments.integrations.storedEncrypted")} />}
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
              {L(o.label)}
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
          <option value="">{t("settingsPayments.integrations.choose")}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {L(o.label)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={`w-full h-10 rounded-lg border bg-background px-3 text-sm ${error ? "border-danger/40" : "border-border/60"}`}
          type={f.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={f.set && f.secret ? t("settingsPayments.integrations.savedPlaceholder", { display: f.display }) : !f.set && f.example ? t("settingsPayments.integrations.examplePlaceholder", { example: f.example }) : ""}
          value={current}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {f.help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {L(f.help)}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {L(error)}
        </p>
      )}
    </div>
  );
}

function ProviderCard({ p, onChanged }: { p: PanelIntegration; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const L = <T extends string | null | undefined>(x: T) => localizeIntegrationText(x, locale);
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
    <section aria-labelledby={`${p.id}-title`} className="bg-card border border-border/50 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 bg-muted/30 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h3 id={`${p.id}-title`} className="text-sm font-semibold">
            {L(p.title)}
          </h3>
          <p className="text-xs text-muted-foreground">{L(p.summary)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${style.className}`}>
          <StateIcon className="w-4 h-4" aria-hidden="true" />
          {L(p.stateLabel)}
        </span>
      </div>

      <form
        className="p-5 space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (hasErrors) {
            toast.error(t("settingsPayments.integrations.fixErrors"));
            return;
          }
          try {
            await save.mutateAsync({ provider: p.id, values: changed });
            setVals({});
            setResult(null);
            toast.success(t("settingsPayments.integrations.savedToast", { title: L(p.title) }));
            onChanged();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t("settingsPayments.integrations.saveFailed"));
          }
        }}
      >
        {p.stateDetail && <p className={`text-xs ${p.state === "failing" ? "text-danger" : "text-muted-foreground"}`}>{L(p.stateDetail)}</p>}
        {p.fields.map((f) => (
          <FieldInput key={f.key} p={p} f={f} value={vals[f.key]} error={errors[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
        ))}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={!dirty || hasErrors || save.isPending}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {save.isPending ? t("settingsPayments.integrations.saving") : t("settingsPayments.integrations.save")}
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
                  setResult({ ok: false, message: err instanceof Error ? err.message : t("settingsPayments.integrations.testFailed") });
                }
              }}
            >
              {test.isPending ? t("settingsPayments.integrations.testing") : t("settingsPayments.integrations.test")}
            </button>
          )}
          {p.configured && (
            <button
              type="button"
              className="h-10 px-4 rounded-lg text-sm text-danger"
              onClick={async () => {
                if (!(await confirmAction({ description: t("settingsPayments.integrations.confirmClear", { title: L(p.title) }), destructive: true }))) return;
                await clear.mutateAsync({ provider: p.id });
                setResult(null);
                toast.success(t("settingsPayments.integrations.clearedToast", { title: L(p.title) }));
                onChanged();
              }}
            >
              {t("settingsPayments.integrations.clear")}
            </button>
          )}
        </div>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {L(result.message)}
          </p>
        )}
      </form>
    </section>
  );
}

export default function Integrations() {
  const { t, locale } = useI18n();
  const avail = trpc.integrations.available.useQuery();
  const list = trpc.integrations.list.useQuery(undefined, { enabled: avail.data?.available === true });
  const groups = groupIntegrations((list.data ?? []) as PanelIntegration[]);

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("settingsPayments.integrations.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("settingsPayments.integrations.intro")}
          </p>
        </div>

        {avail.isLoading || (avail.data?.available && list.isLoading) ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !avail.data?.available ? (
          <div className="bg-card border border-border/50 rounded-xl p-5 text-sm text-muted-foreground">
            {t("settingsPayments.integrations.technicalTeam")}
          </div>
        ) : list.isError ? (
          <div role="alert" className="bg-card border border-border/50 rounded-xl p-5 text-sm text-danger">
            {t("settingsPayments.integrations.loadError")}
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-xl p-5 text-sm text-muted-foreground">
            {t("settingsPayments.integrations.none")}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`grupo-${g.id}`} className="space-y-3">
              <div>
                <h2 id={`grupo-${g.id}`} className="text-lg font-semibold">
                  {localizeIntegrationText(g.title, locale)}
                </h2>
                <p className="text-sm text-muted-foreground">{localizeIntegrationText(g.description, locale)}</p>
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
