import { useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Lock, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Mode {
  mode: "test" | "live";
  label: string;
  connectable: boolean;
  status: string;
  statusLabel: string;
  accountHint: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  onlineEnabled: boolean;
  connectedAt: number | null;
  verifiedAt: number | null;
  lastEventAt: number | null;
  lastEventType: string | null;
}

const STATUS_STYLE: Record<string, { icon: typeof CheckCircle2; className: string; help: string }> = {
  no_conectada: { icon: CircleDashed, className: "text-muted-foreground", help: "Todavía no has vinculado una cuenta de Stripe." },
  pendiente: { icon: CircleDashed, className: "text-amber-600 dark:text-amber-400", help: "Stripe aún necesita datos tuyos o está revisándolos. Continúa el alta para terminar la verificación." },
  verificada: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", help: "Tu cuenta puede cobrar y recibir los pagos." },
  restringida: { icon: AlertTriangle, className: "text-red-600 dark:text-red-400", help: "Stripe ha limitado la cuenta. Entra en tu panel de Stripe para ver qué piden." },
};

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "—");

function ModeCard({ m, platformReady, onChanged }: { m: Mode; platformReady: boolean; onChanged: () => void }) {
  const connect = trpc.cobros.connect.useMutation({
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => toast.error(e.message),
  });
  const refresh = trpc.cobros.refresh.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado desde Stripe");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const setOnline = trpc.cobros.setOnline.useMutation({
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });
  const s = STATUS_STYLE[m.status] ?? STATUS_STYLE.no_conectada;
  const Icon = s.icon;
  const isLive = m.mode === "live";

  return (
    <section className="bg-card border border-border/50 rounded-2xl p-5 space-y-4" aria-labelledby={`cobros-${m.mode}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`cobros-${m.mode}`} className="text-lg font-semibold">
            {m.label}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isLive ? "Cobros con dinero real." : "Para probar el circuito completo sin mover dinero real."}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.className}`}>
          <Icon className="w-4 h-4" aria-hidden /> {m.statusLabel}
        </span>
      </div>

      {isLive ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>Desactivado. Los cobros reales no están activados todavía; se activarán de forma explícita tras validar la conexión de Prueba.</span>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{s.help}</p>
          {m.accountHint && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Cuenta vinculada</dt>
              <dd className="font-mono">{m.accountHint}</dd>
              <dt className="text-muted-foreground">Vinculada el</dt>
              <dd>{fmt(m.connectedAt)}</dd>
              <dt className="text-muted-foreground">Puede cobrar</dt>
              <dd>{m.chargesEnabled ? "Sí" : "No"}</dd>
              <dt className="text-muted-foreground">Puede recibir pagos</dt>
              <dd>{m.payoutsEnabled ? "Sí" : "No"}</dd>
              <dt className="text-muted-foreground">Último aviso válido de Stripe</dt>
              <dd>{m.lastEventAt ? `${fmt(m.lastEventAt)} (${m.lastEventType})` : "Aún no ha llegado ninguno"}</dd>
            </dl>
          )}
          {m.requirementsDue.length > 0 && (
            <div role="alert" className="text-sm rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              Stripe todavía pide {m.requirementsDue.length} dato{m.requirementsDue.length === 1 ? "" : "s"} para completar la verificación.
              Continúa el alta para enviarlos.
            </div>
          )}
          {m.disabledReason && (
            <div role="alert" className="text-sm rounded-xl border border-red-500/40 bg-red-500/10 p-3">
              Motivo indicado por Stripe: {m.disabledReason}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => connect.mutate()} disabled={!platformReady || connect.isPending} variant={m.status === "verificada" ? "outline" : "default"}>
              {connect.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {m.accountHint ? "Continuar o revisar en Stripe" : "Conectar mi cuenta de Stripe"}
            </Button>
            {m.accountHint && (
              <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Comprobar estado
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-4">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={m.onlineEnabled}
                disabled={setOnline.isPending || (!m.onlineEnabled && m.status !== "verificada")}
                onChange={(e) => setOnline.mutate({ mode: m.mode, enabled: e.target.checked })}
              />
              <span>
                <strong>Cobrar en línea con esta cuenta (Prueba)</strong>
                <br />
                <span className="text-muted-foreground">
                  {m.status === "verificada"
                    ? "Los presupuestos de pago único mostrarán el pago con tarjeta en Stripe, sin mover dinero real."
                    : "Se podrá activar cuando la cuenta esté verificada."}
                </span>
              </span>
            </label>
          </div>
        </>
      )}
    </section>
  );
}

export default function Cobros() {
  const utils = trpc.useUtils();
  const status = trpc.cobros.status.useQuery();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const back = params?.get("stripe");
  const refresh = trpc.cobros.refresh.useMutation({ onSettled: () => utils.cobros.status.invalidate() });

  // Al volver de Stripe se relee el estado real de la cuenta (la vuelta del navegador no prueba nada por sí sola)
  useEffect(() => {
    if (back === "volver" && status.data?.platformReady) refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back, status.data?.platformReady]);

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cobros con Stripe</h1>
          <p className="text-sm text-muted-foreground">
            Conecta la cuenta de Stripe de tu empresa para cobrar tus ventas directamente en ella. El dinero va a tu cuenta; no pasa por
            la de Big Elephant, que solo cobra tu suscripción. Prueba y Real son conexiones distintas.
          </p>
        </div>

        {status.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : status.error ? (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> {status.error.message}
          </div>
        ) : (
          status.data && (
            <>
              {!status.data.platformReady && (
                <div role="alert" className="text-sm rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  Los cobros con Stripe aún no están preparados en la plataforma. {status.data.platformProblem}
                </div>
              )}
              {status.data.modes.map((m) => (
                <ModeCard key={m.mode} m={m} platformReady={status.data!.platformReady} onChanged={() => utils.cobros.status.invalidate()} />
              ))}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                Autorizas la conexión en la página de Stripe, con tus propios datos fiscales y bancarios: Big Elephant no los ve ni los
                guarda. Los avisos de Stripe se reciben y verifican de forma automática; no tienes que configurar ninguna dirección ni secreto.
              </p>
            </>
          )
        )}
      </div>
    </AdminLayout>
  );
}
