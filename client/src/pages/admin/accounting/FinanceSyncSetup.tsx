/**
 * Puesta en marcha de Elephant Finance Sync: lo que antes exigía implantación acompañada, en autoservicio. Cada paso se
 * marca solo con los datos reales de la empresa (financeSync.setup): extracto bancario, operaciones del datáfono (Excel
 * o buzón de tickets), buzón IMAP en la bóveda de la empresa y primera conciliación.
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, CircleDashed, Lock, MailCheck, Rocket } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { HeroCard } from "@/components/admin/PanelVisual";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { TONE_TEXT, TONE_SURFACE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { fieldFormatProblem, type PanelIntegration } from "@shared/integrationsPanel";
import { BANK_STATEMENT_FORMATS, type FinanceSyncStep, type FinanceSyncStepStatus } from "@shared/financeSyncSetup";
import { FieldInput } from "../settings/Integrations";

const STATUS: Record<FinanceSyncStepStatus, { icon: typeof Circle; tone: Tone }> = {
  done: { icon: CheckCircle2, tone: "success" },
  todo: { icon: Circle, tone: "neutral" },
  optional: { icon: CircleDashed, tone: "info" },
  blocked: { icon: Lock, tone: "neutral" },
  attention: { icon: AlertTriangle, tone: "danger" },
};

function StepItem({ s, index }: { s: FinanceSyncStep; index: number }) {
  const { t } = useI18n();
  const st = STATUS[s.status];
  const Icon = st.icon;
  const label =
    s.status === "done" ? t("financeSync.status.done")
    : s.status === "todo" ? t("financeSync.status.todo")
    : s.status === "optional" ? t("financeSync.status.optional")
    : s.status === "blocked" ? t("financeSync.status.blocked")
    : t("financeSync.status.attention");
  const isAnchor = s.href.includes("#");
  const linkClass = "inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", s.status === "attention" ? TONE_SURFACE.danger : "border-border", s.status === "blocked" && "opacity-80")}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", TONE_TEXT[st.tone])} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {index + 1}. {s.title}
            </h3>
            <span className={cn("text-xs font-medium", TONE_TEXT[st.tone])}>{label}</span>
          </div>
          <p className="text-sm text-muted-foreground">{s.description}</p>
          <p className="text-xs text-foreground/70">{s.detail}</p>
          {s.id === "bankStatement" && s.status !== "done" && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground" aria-label={t("financeSync.formatsAria")}>
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
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : (
                <Link href={s.href} className={linkClass}>
                  {s.action}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
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
  const { t } = useI18n();
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
  const stateTone: Tone = working ? "success" : p.state === "failing" ? "danger" : "neutral";

  return (
    <section id="buzon" aria-labelledby="buzon-titulo" className="scroll-mt-20 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="buzon-titulo" className="text-sm font-semibold">
            {t("financeSync.mailbox.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("financeSync.mailbox.help")}</p>
        </div>
        <span className={cn("text-xs font-medium", TONE_TEXT[stateTone])}>{p.stateLabel}</span>
      </div>

      <form
        className="space-y-4 p-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (hasErrors) {
            toast.error(t("financeSync.mailbox.reviewErrors"));
            return;
          }
          // Cambiar el servidor, el puerto, el usuario o el cifrado exige volver a escribir la contraseña (el servidor lo vuelve a exigir)
          const passField = p.fields.find((f) => f.secret);
          if (passField?.set && !changed[passField.key] && ["host", "port", "user", "secure"].some((k) => k in changed)) {
            toast.error(t("financeSync.mailbox.retypePassword"));
            return;
          }
          try {
            const r = await save.mutateAsync({ values: changed });
            setVals({});
            setResult(null);
            toast.success(r.ingestionDisabled ? t("financeSync.mailbox.savedIngestionOff") : t("financeSync.mailbox.saved"));
            onChanged();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t("financeSync.mailbox.saveFailed"));
          }
        }}
      >
        {p.stateDetail && <p className={cn("text-xs", p.state === "failing" ? TONE_TEXT.danger : "text-muted-foreground")}>{p.stateDetail}</p>}
        {p.fields.map((f) => (
          <FieldInput key={f.key} p={p} f={f} value={vals[f.key]} error={errors[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} />
        ))}
        <p className="text-xs text-muted-foreground">{t("financeSync.mailbox.defaultSender")}</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" disabled={!dirty || hasErrors || save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!p.configured || dirty || test.isPending}
            title={dirty ? t("financeSync.mailbox.saveFirst") : undefined}
            onClick={async () => {
              try {
                setResult(await test.mutateAsync());
              } catch (err) {
                setResult({ ok: false, message: err instanceof Error ? err.message : t("financeSync.mailbox.testFailed") });
              }
              onChanged();
            }}
          >
            {test.isPending ? t("financeSync.mailbox.testing") : t("financeSync.mailbox.test")}
          </Button>
        </div>
        {result && (
          <p role="status" className={cn("text-sm", result.ok ? TONE_TEXT.success : TONE_TEXT.danger)}>
            {result.message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MailCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("financeSync.mailbox.autoTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {ingestionEnabled ? t("financeSync.mailbox.autoOn") : working ? t("financeSync.mailbox.autoOff") : t("financeSync.mailbox.autoNeedsTest")}
            </p>
          </div>
          <Button
            type="button"
            role="switch"
            aria-checked={ingestionEnabled}
            variant={ingestionEnabled ? "outline" : "default"}
            disabled={ingestion.isPending || (!ingestionEnabled && !working)}
            onClick={async () => {
              try {
                await ingestion.mutateAsync({ enabled: !ingestionEnabled });
                toast.success(ingestionEnabled ? t("financeSync.mailbox.autoTurnedOff") : t("financeSync.mailbox.autoTurnedOn"));
                onChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : t("financeSync.mailbox.toggleFailed"));
              }
            }}
          >
            {ingestion.isPending ? t("common.saving") : ingestionEnabled ? t("financeSync.mailbox.turnOff") : t("financeSync.mailbox.turnOn")}
          </Button>
        </div>
      </form>
    </section>
  );
}

export default function FinanceSyncSetup() {
  const { t } = useI18n();
  const q = trpc.financeSync.setup.useQuery();
  const d = q.data;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <PanelPageHeader icon={<Rocket />} title={t("financeSync.title")} description={t("financeSync.description")} />

        {q.isLoading ? (
          <PanelLoading />
        ) : q.isError || !d ? (
          <PanelError error={q.error} title={t("financeSync.loadError")} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <HeroCard className={d.ready ? "border-success/40" : "border-warning/50"}>
              <div role="status" className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold">{d.ready ? t("financeSync.ready") : t("financeSync.notReady")}</p>
                  <span className="text-xs text-muted-foreground">{t("financeSync.progress", { completed: d.completed, total: d.total })}</span>
                </div>
                <Progress value={d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0} aria-label={t("financeSync.progress", { completed: d.completed, total: d.total })} className="h-2" />
                {d.ready ? (
                  <p className="text-sm text-muted-foreground">{t("financeSync.readyHelp")}</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {d.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            </HeroCard>

            <ol className="space-y-3">
              {d.steps.map((s, i) => (
                <StepItem key={s.id} s={s} index={i} />
              ))}
            </ol>

            {d.mailbox ? (
              <MailboxCard p={d.mailbox} ingestionEnabled={d.ingestionEnabled} onChanged={() => q.refetch()} />
            ) : (
              <div id="buzon" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                {t("financeSync.mailbox.unavailable")}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
