/**
 * Piezas de «Llamadas IA: puesta en marcha»: lista de pasos, clave privada y conexión con asistente y número.
 * Solo presentación; las llamadas tRPC y los avisos son los de siempre. La clave nunca se muestra una vez guardada.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Lock, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { serviceSecretProps } from "@/lib/credentialFields";
import type { VoiceStep, VoiceStepStatus } from "@shared/voiceSetup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { FormField, FormSection } from "../accounting/shared/EconomyUi";

const STEP: Record<VoiceStepStatus, { icon: typeof Circle; tone: Tone; iconClass: string }> = {
  done: { icon: CheckCircle2, tone: "success", iconClass: "text-success" },
  todo: { icon: Circle, tone: "neutral", iconClass: "text-muted-foreground" },
  blocked: { icon: Lock, tone: "neutral", iconClass: "text-muted-foreground" },
  attention: { icon: AlertTriangle, tone: "danger", iconClass: "text-danger" },
};

export const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function StepList({ steps }: { steps: VoiceStep[] }) {
  const { t } = useI18n();
  return (
    <ol aria-label={t("voiceSetup.step.list")} className="grid gap-3 md:grid-cols-2">
      {steps.map((s, i) => {
        const st = STEP[s.status];
        const Icon = st.icon;
        return (
          <li key={s.id} className="flex gap-3 rounded-xl border border-border bg-card p-4">
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted ${st.iconClass}`} aria-hidden="true"><Icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{i + 1}. {s.title}</h3>
                <StatusBadge tone={st.tone}>{t(`voiceSetup.step.${s.status}`)}</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">{s.description}</p>
              <p className="break-words text-xs text-foreground/80">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function KeyCard({ masked, onChanged }: { masked: string | null; onChanged: () => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const save = trpc.voiceSetup.saveKey.useMutation();
  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await save.mutateAsync({ apiKey: key });
          setKey("");
          toast.success(r.selectionReset ? t("voiceSetup.key.okReset") : t("voiceSetup.key.ok"));
          onChanged();
        } catch (err) {
          toast.error(errMsg(err, t("voiceSetup.key.error")));
        }
      }}
    >
      <FormSection title={t("voiceSetup.key.title")} description={t("voiceSetup.key.help")}>
        <p className="text-xs text-muted-foreground">{masked ? t("voiceSetup.key.saved", { masked }) : t("voiceSetup.key.none")}</p>
        <FormField label={masked ? t("voiceSetup.key.replace") : t("voiceSetup.key.label")}>
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            {...serviceSecretProps("vapi-clave-privada")}
            spellCheck={false}
            className="h-10 font-mono text-sm"
            placeholder={t("voiceSetup.key.placeholder")}
          />
        </FormField>
        <Button type="submit" disabled={!key.trim() || save.isPending} className="gap-1.5">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {save.isPending ? t("voiceSetup.key.checking") : t("voiceSetup.key.submit")}
        </Button>
      </FormSection>
    </form>
  );
}

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ConnectCard({ ready, current, onChanged }: { ready: boolean; current: { assistantId: string | null; phoneId: string | null }; onChanged: () => void }) {
  const { t } = useI18n();
  const [load, setLoad] = useState(false);
  const [assistantId, setAssistantId] = useState<string>("");
  const [phoneId, setPhoneId] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  const res = trpc.voiceSetup.resources.useQuery(undefined, { enabled: ready && load, retry: false, refetchOnWindowFocus: false });
  const connect = trpc.voiceSetup.connect.useMutation();
  const a = res.data?.assistants ?? [];
  const p = res.data?.phoneNumbers ?? [];
  const selA = a.find((x) => x.id === (assistantId || current.assistantId));
  const selP = p.find((x) => x.id === (phoneId || current.phoneId));
  const other = t("voiceSetup.connect.otherAddress");
  const warnings: string[] = [];
  if (selA?.serverTarget === "other") warnings.push(t("voiceSetup.connect.warnAssistant", { name: selA.name, host: selA.otherHost ?? other }));
  if (selA && selP?.assistantId && selP.assistantId !== selA.id) warnings.push(t("voiceSetup.connect.warnPhone", { number: selP.number ?? selP.name ?? selP.id, name: selA.name }));

  return (
    <FormSection title={t("voiceSetup.connect.title")} description={t("voiceSetup.connect.help")}>
      {!ready ? (
        <p className="text-sm text-muted-foreground">{t("voiceSetup.connect.unavailable")}</p>
      ) : !load ? (
        <Button type="button" variant="outline" onClick={() => setLoad(true)}>{t("voiceSetup.connect.load")}</Button>
      ) : res.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("voiceSetup.connect.loading")}</p>
      ) : res.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">{res.error.message}</p>
          <Button type="button" variant="outline" onClick={() => res.refetch()}>{t("voiceSetup.retry")}</Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selA || !selP) {
              toast.error(t("voiceSetup.connect.choose"));
              return;
            }
            try {
              const r = await connect.mutateAsync({ assistantId: selA.id, phoneNumberId: selP.id, replaceExisting: confirm });
              toast.success(
                r.secretGenerated === "too_short"
                  ? t("voiceSetup.connect.okShort")
                  : r.secretGenerated === "missing"
                    ? t("voiceSetup.connect.okMissing")
                    : t("voiceSetup.connect.ok"),
              );
              setConfirm(false);
              res.refetch();
              onChanged();
            } catch (err) {
              toast.error(errMsg(err, t("voiceSetup.connect.error")));
            }
          }}
        >
          {(a.length === 0 || p.length === 0) && (
            <p className="text-sm text-muted-foreground">
              {a.length === 0 ? `${t("voiceSetup.connect.noAssistants")} ` : ""}
              {p.length === 0 ? t("voiceSetup.connect.noNumbers") : ""}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("voiceSetup.connect.assistant")}>
              <select value={selA?.id ?? ""} onChange={(e) => { setAssistantId(e.target.value); setConfirm(false); }} className={selectCls}>
                <option value="">{t("voiceSetup.connect.assistantPlaceholder")}</option>
                {a.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.serverTarget === "core" ? ` · ${t("voiceSetup.connect.alreadyConnected")}` : x.serverTarget === "other" ? ` · ${t("voiceSetup.connect.sendsTo", { host: x.otherHost ?? other })}` : ""}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("voiceSetup.connect.phone")}>
              <select value={selP?.id ?? ""} onChange={(e) => { setPhoneId(e.target.value); setConfirm(false); }} className={selectCls}>
                <option value="">{t("voiceSetup.connect.phonePlaceholder")}</option>
                {p.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.number ?? x.name ?? x.id}
                    {x.name && x.number ? ` (${x.name})` : ""}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {warnings.length > 0 && (
            <div role="alert" className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {warnings.map((w) => <li key={w} className="break-words">{w}</li>)}
              </ul>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
                <span>{t("voiceSetup.connect.confirm")}</span>
              </label>
            </div>
          )}
          <Button type="submit" disabled={!selA || !selP || connect.isPending || (warnings.length > 0 && !confirm)}>
            {connect.isPending ? t("voiceSetup.connect.submitting") : t("voiceSetup.connect.submit")}
          </Button>
        </form>
      )}
    </FormSection>
  );
}
