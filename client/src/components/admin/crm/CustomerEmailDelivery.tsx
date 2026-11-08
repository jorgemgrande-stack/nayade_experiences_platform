/**
 * Trazabilidad del correo transaccional en la ficha del cliente: aviso si su dirección está suprimida o si los últimos
 * correos no le han llegado (rebote, bloqueo, queja, error) y el estado de entrega de cada envío. Los datos salen de la
 * bandeja de salida de la empresa (`crm.clients.mailDelivery`); la dirección no se cambia sola.
 */
import { AlertTriangle, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  pending: { label: "En cola", tone: "muted" },
  sending: { label: "Enviando", tone: "muted" },
  accepted: { label: "Aceptado por el proveedor", tone: "muted" },
  delivered: { label: "Entregado al servidor del cliente", tone: "ok" },
  soft_bounced: { label: "Rebote temporal", tone: "warn" },
  bounced: { label: "Rebotado", tone: "bad" },
  blocked: { label: "Bloqueado por el proveedor", tone: "bad" },
  complained: { label: "Marcado como spam", tone: "bad" },
  failed: { label: "No enviado (error)", tone: "bad" },
  skipped: { label: "No enviado", tone: "muted" },
};
const SUPPRESSION: Record<string, string> = {
  hard_bounce: "rebote permanente",
  invalid: "dirección no válida",
  complaint: "lo marcó como spam",
  unsubscribed: "se dio de baja",
};
const SKIP_REASON: Record<string, string> = {
  suppressed: "dirección suprimida",
  mode_off: "envío de correo desactivado",
  sandbox_recipient_not_allowed: "modo de pruebas",
  rate_limited_recipient: "límite por hora",
  rate_limited_tenant: "límite por hora",
};
const TONE: Record<string, string> = {
  ok: "border-primary/40 text-primary",
  warn: "border-amber-500/50 text-amber-700 dark:text-amber-300",
  bad: "border-destructive/50 text-destructive",
  muted: "border-border text-muted-foreground",
};
const UNDELIVERED = new Set(["bounced", "blocked", "complained", "failed"]);

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

function useDelivery(clientId: number, enabled: boolean) {
  return trpc.crm.clients.mailDelivery.useQuery({ id: clientId }, { enabled, staleTime: 60_000, retry: false });
}

/** Aviso destacado: dirección suprimida o correos recientes no entregados. No se muestra si todo está bien. */
export function CustomerEmailDeliveryWarning({ clientId, email }: { clientId: number; email: string | null | undefined }) {
  const enabled = !!email && email.includes("@");
  const { data } = useDelivery(clientId, enabled);
  if (!enabled || !data?.available) return null;
  const failed = data.sends.filter((s) => UNDELIVERED.has(s.status));
  if (!data.suppressed && failed.length === 0) return null;
  return (
    <div role="alert" className="mb-6 space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Correo no entregado al cliente
      </p>
      <p>
        Dirección: <strong className="break-all">{data.email}</strong>
        {data.suppressed && (
          <>
            {" "}· <strong>suprimida</strong> desde el {fmt(data.suppressed.since)} ({SUPPRESSION[data.suppressed.reason] ?? data.suppressed.reason}): los próximos correos no se le envían.
          </>
        )}
      </p>
      {failed.length > 0 && (
        <ul className="space-y-1">
          {failed.slice(0, 5).map((s) => (
            <li key={s.id} className="border-t border-amber-500/20 pt-1">
              <span className="tabular-nums">{fmt(s.createdAt)}</span> · <span className="break-words">{s.subject || "(sin asunto)"}</span>
              <br />
              <span className="opacity-80">
                {STATUS[s.status]?.label ?? s.status}
                {s.lastEvent?.detail ? ` — ${s.lastEvent.detail}` : s.reason ? ` — ${s.reason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs opacity-80">Contacta con el cliente por teléfono o WhatsApp. Si confirma otra dirección, corrígela en su ficha.</p>
    </div>
  );
}

/** Lista de envíos con su estado de entrega (los 10 últimos). */
export function CustomerEmailDeliveryList({ clientId, email }: { clientId: number; email: string | null | undefined }) {
  const enabled = !!email && email.includes("@");
  const { data, isLoading } = useDelivery(clientId, enabled);
  if (!enabled) return <p className="text-sm text-muted-foreground">El cliente no tiene correo.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!data?.available) return <p className="text-sm text-muted-foreground">El registro de entregas no está disponible.</p>;
  if (data.sends.length === 0) return <p className="text-sm text-muted-foreground">Aún no se le ha enviado ningún correo.</p>;
  return (
    <ul className="space-y-2">
      {data.sends.slice(0, 10).map((s) => {
        const st = STATUS[s.status] ?? { label: s.status, tone: "muted" as const };
        const why = s.status === "skipped" && s.reason ? SKIP_REASON[s.reason] ?? null : null;
        return (
          <li key={s.id} className="flex flex-col gap-1 border-b border-border pb-2 text-sm last:border-b-0 last:pb-0">
            <span className="flex items-start gap-1.5 break-words text-foreground">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {s.subject || "(sin asunto)"}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{fmt(s.createdAt)}</span>
              <span className={`rounded-full border px-2 py-0.5 font-medium ${TONE[st.tone]}`}>{st.label}{why ? ` (${why})` : ""}</span>
              {s.provider === "postmark" && <span>Postmark</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
