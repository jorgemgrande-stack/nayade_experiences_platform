/**
 * Trazabilidad del correo transaccional en la ficha del cliente: aviso si su dirección está suprimida o si los últimos
 * correos no le han llegado (rebote, bloqueo, queja, error) y el estado de entrega de cada envío. Los datos salen de la
 * bandeja de salida de la empresa (`crm.clients.mailDelivery`); la dirección no se cambia sola.
 */
import { AlertTriangle, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  pending: "muted", sending: "muted", accepted: "muted", delivered: "ok", soft_bounced: "warn",
  bounced: "bad", blocked: "bad", complained: "bad", failed: "bad", skipped: "muted",
};
const SUPPRESSION_KEYS = ["hard_bounce", "invalid", "complaint", "unsubscribed"];
const SKIP_KEYS = ["suppressed", "mode_off", "sandbox_recipient_not_allowed", "rate_limited_recipient", "rate_limited_tenant"];
const TONE: Record<string, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-border bg-muted text-muted-foreground",
};
const UNDELIVERED = new Set(["bounced", "blocked", "complained", "failed"]);

const FMT_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" };

function useDelivery(clientId: number, enabled: boolean) {
  return trpc.crm.clients.mailDelivery.useQuery({ id: clientId }, { enabled, staleTime: 60_000, retry: false });
}

/** Aviso destacado: dirección suprimida o correos recientes no entregados. No se muestra si todo está bien. */
export function CustomerEmailDeliveryWarning({ clientId, email }: { clientId: number; email: string | null | undefined }) {
  const { t, format } = useI18n();
  const fmt = (ms: number) => format.dateTime(ms, FMT_OPTS);
  const statusLabel = (s: string) => (STATUS_TONE[s] ? t(`crmForm.mail.status.${s}`) : s);
  const enabled = !!email && email.includes("@");
  const { data } = useDelivery(clientId, enabled);
  if (!enabled || !data?.available) return null;
  const failed = data.sends.filter((s) => UNDELIVERED.has(s.status));
  if (!data.suppressed && failed.length === 0) return null;
  return (
    <div role="alert" className="mb-6 space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> {t("crmForm.mail.warnTitle")}
      </p>
      <p>
        {t("crmForm.mail.address")} <strong className="break-all">{data.email}</strong>
        {data.suppressed && (
          <>
            {" "}· <strong>{t("crmForm.mail.suppressed")}</strong> {t("crmForm.mail.suppressedSince", { date: fmt(data.suppressed.since), reason: SUPPRESSION_KEYS.includes(data.suppressed.reason) ? t(`crmForm.mail.suppression.${data.suppressed.reason}`) : data.suppressed.reason })}
          </>
        )}
      </p>
      {failed.length > 0 && (
        <ul className="space-y-1">
          {failed.slice(0, 5).map((s) => (
            <li key={s.id} className="border-t border-warning/20 pt-1">
              <span className="tabular-nums">{fmt(s.createdAt)}</span> · <span className="break-words">{s.subject || t("crmForm.mail.noSubject")}</span>
              <br />
              <span className="opacity-80">
                {statusLabel(s.status)}
                {s.lastEvent?.detail ? ` — ${s.lastEvent.detail}` : s.reason ? ` — ${s.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs opacity-80">{t("crmForm.mail.contactHint")}</p>
    </div>
  );
}

/** Lista de envíos con su estado de entrega (los 10 últimos). */
export function CustomerEmailDeliveryList({ clientId, email }: { clientId: number; email: string | null | undefined }) {
  const { t, format } = useI18n();
  const fmt = (ms: number) => format.dateTime(ms, FMT_OPTS);
  const enabled = !!email && email.includes("@");
  const { data, isLoading } = useDelivery(clientId, enabled);
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crmForm.mail.noEmail")}</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("crmForm.mail.loading")}</p>;
  if (!data?.available) return <p className="text-sm text-muted-foreground">{t("crmForm.mail.unavailable")}</p>;
  if (data.sends.length === 0) return <p className="text-sm text-muted-foreground">{t("crmForm.mail.empty")}</p>;
  return (
    <ul className="space-y-2">
      {data.sends.slice(0, 10).map((s) => {
        const st = { label: STATUS_TONE[s.status] ? t(`crmForm.mail.status.${s.status}`) : s.status, tone: STATUS_TONE[s.status] ?? ("muted" as const) };
        const why = s.status === "skipped" && s.reason && SKIP_KEYS.includes(s.reason) ? t(`crmForm.mail.skip.${s.reason}`) : null;
        return (
          <li key={s.id} className="flex flex-col gap-1 border-b border-border pb-2 text-sm last:border-b-0 last:pb-0">
            <span className="flex items-start gap-1.5 break-words text-foreground">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {s.subject || t("crmForm.mail.noSubject")}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{fmt(s.createdAt)}</span>
              <span className={`rounded-full border px-2 py-0.5 font-medium ${TONE[st.tone]}`}>{st.label}{why ? ` (${why})` : ""}</span>
              {s.provider === "postmark_tenant" && <span>Postmark</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
