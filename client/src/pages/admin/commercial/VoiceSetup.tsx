/**
 * «Llamadas IA · Puesta en marcha» (Elephant Voice, capacidad voice-ai, solo administración): la empresa conecta su
 * propia cuenta de Vapi sin implantación técnica. Clave privada en la bóveda de la empresa (validada contra Vapi y nunca
 * mostrada), elección de asistente y número, configuración del webhook hacia el dominio de la empresa con una clave de
 * verificación de al menos 24 caracteres, y comprobación de la primera llamada. Cada paso se marca con datos reales
 * (voiceSetup.status).
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Loader2, Lock, PhoneCall, Rocket, ShieldCheck, Unplug } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { VOICE_CALLS_PATH, type VoiceStep, type VoiceStepStatus } from "@shared/voiceSetup";

const STATUS: Record<VoiceStepStatus, { icon: typeof Circle; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", label: "Hecho" },
  todo: { icon: Circle, className: "text-muted-foreground", label: "Pendiente" },
  blocked: { icon: Lock, className: "text-muted-foreground", label: "Necesita los pasos anteriores" },
  attention: { icon: AlertTriangle, className: "text-red-600 dark:text-red-400", label: "Revisar" },
};

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const btn = "h-10 px-4 rounded-lg text-sm font-medium disabled:opacity-50";
const card = "bg-card border border-border/50 rounded-2xl overflow-hidden";
const cardHead = "px-5 py-3 bg-muted/30 border-b border-border/50";

function StepItem({ s, index }: { s: VoiceStep; index: number }) {
  const st = STATUS[s.status];
  const Icon = st.icon;
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
          <p className="text-xs text-foreground/70 break-words">{s.detail}</p>
        </div>
      </div>
    </li>
  );
}

function KeyCard({ masked, onChanged }: { masked: string | null; onChanged: () => void }) {
  const [key, setKey] = useState("");
  const save = trpc.voiceSetup.saveKey.useMutation();
  return (
    <section aria-labelledby="clave-titulo" className={card}>
      <div className={cardHead}>
        <h2 id="clave-titulo" className="text-sm font-semibold">
          Clave privada de Vapi
        </h2>
        <p className="text-xs text-muted-foreground">
          En dashboard.vapi.ai › API Keys, copia la «Private Key». Antes de guardarla se comprueba con Vapi (solo lectura); se guarda cifrada y no se
          vuelve a mostrar.
        </p>
      </div>
      <form
        className="p-5 space-y-3"
        noValidate
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await save.mutateAsync({ apiKey: key });
            setKey("");
            toast.success(r.selectionReset ? "Clave guardada. Es de otra cuenta: vuelve a elegir asistente y número." : "Clave guardada y aceptada por Vapi.");
            onChanged();
          } catch (err) {
            toast.error(errMsg(err, "No se pudo guardar la clave"));
          }
        }}
      >
        <p className="text-xs text-muted-foreground">{masked ? `Clave guardada: ${masked}` : "Todavía no hay ninguna clave guardada."}</p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{masked ? "Sustituir por otra clave" : "Clave privada"}</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className="w-full h-10 px-3 rounded-lg border border-border/60 bg-background text-sm font-mono"
            placeholder="Pega aquí la Private Key"
          />
        </label>
        <button type="submit" disabled={!key.trim() || save.isPending} className={`${btn} bg-primary text-primary-foreground`}>
          {save.isPending ? "Comprobando con Vapi…" : "Guardar y comprobar"}
        </button>
      </form>
    </section>
  );
}

function ConnectCard({ ready, current, onChanged }: { ready: boolean; current: { assistantId: string | null; phoneId: string | null }; onChanged: () => void }) {
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
  const warnings: string[] = [];
  if (selA?.serverTarget === "other") warnings.push(`El asistente «${selA.name}» envía ahora sus avisos a ${selA.otherHost ?? "otra dirección"}: dejará de enviarlos allí.`);
  if (selA && selP?.assistantId && selP.assistantId !== selA.id) warnings.push(`El número ${selP.number ?? selP.name ?? selP.id} tiene ahora otro asistente: pasará a atenderlo «${selA.name}».`);

  return (
    <section aria-labelledby="conectar-titulo" className={card}>
      <div className={cardHead}>
        <h2 id="conectar-titulo" className="text-sm font-semibold">
          Asistente, número y conexión
        </h2>
        <p className="text-xs text-muted-foreground">
          Elige uno de tus asistentes y uno de tus números de Vapi. Al conectar, la plataforma configura en el asistente la dirección de tu panel y una
          clave de verificación (al menos 24 caracteres; si no tienes una válida, se genera), y le asigna el número.
        </p>
      </div>
      <div className="p-5 space-y-4">
        {!ready ? (
          <p className="text-sm text-muted-foreground">Disponible cuando Vapi acepte tu clave.</p>
        ) : !load ? (
          <button type="button" className={`${btn} border border-border/60`} onClick={() => setLoad(true)}>
            Cargar mis asistentes y números
          </button>
        ) : res.isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Consultando tu cuenta de Vapi…
          </p>
        ) : res.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {res.error.message}
            </p>
            <button type="button" className={`${btn} border border-border/60`} onClick={() => res.refetch()}>
              Reintentar
            </button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selA || !selP) {
                toast.error("Elige un asistente y un número");
                return;
              }
              try {
                const r = await connect.mutateAsync({ assistantId: selA.id, phoneNumberId: selP.id, replaceExisting: confirm });
                toast.success(
                  r.secretGenerated === "too_short"
                    ? "Conectado. La clave de verificación anterior tenía menos de 24 caracteres: se ha generado y configurado una nueva."
                    : r.secretGenerated === "missing"
                      ? "Conectado. Se ha generado una clave de verificación y se ha configurado en Vapi."
                      : "Conectado. Haz ahora una llamada de prueba.",
                );
                setConfirm(false);
                res.refetch();
                onChanged();
              } catch (err) {
                toast.error(errMsg(err, "No se pudo conectar"));
              }
            }}
          >
            {a.length === 0 || p.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {a.length === 0 ? "Tu cuenta de Vapi no tiene asistentes: crea uno en dashboard.vapi.ai. " : ""}
                {p.length === 0 ? "Tu cuenta de Vapi no tiene números de teléfono: compra o importa uno en dashboard.vapi.ai › Phone Numbers." : ""}
              </p>
            ) : null}
            <label className="block space-y-1">
              <span className="text-sm font-medium">Asistente</span>
              <select
                value={selA?.id ?? ""}
                onChange={(e) => {
                  setAssistantId(e.target.value);
                  setConfirm(false);
                }}
                className="w-full h-10 px-3 rounded-lg border border-border/60 bg-background text-sm"
              >
                <option value="">Elige un asistente…</option>
                {a.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.serverTarget === "core" ? " · ya conectado a tu panel" : x.serverTarget === "other" ? ` · envía a ${x.otherHost ?? "otra dirección"}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Número de teléfono</span>
              <select
                value={selP?.id ?? ""}
                onChange={(e) => {
                  setPhoneId(e.target.value);
                  setConfirm(false);
                }}
                className="w-full h-10 px-3 rounded-lg border border-border/60 bg-background text-sm"
              >
                <option value="">Elige un número…</option>
                {p.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.number ?? x.name ?? x.id}
                    {x.name && x.number ? ` (${x.name})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {warnings.length > 0 && (
              <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-2">
                <ul className="list-disc pl-5 text-sm text-amber-900 dark:text-amber-200 space-y-1">
                  {warnings.map((w) => (
                    <li key={w} className="break-words">
                      {w}
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
                  <span>Entendido: quiero hacer el cambio.</span>
                </label>
              </div>
            )}
            <button type="submit" disabled={!selA || !selP || connect.isPending || (warnings.length > 0 && !confirm)} className={`${btn} bg-primary text-primary-foreground`}>
              {connect.isPending ? "Conectando…" : "Conectar con Vapi"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

export default function VoiceSetup() {
  const q = trpc.voiceSetup.status.useQuery(undefined, { refetchInterval: 30_000 });
  const d = q.data;
  const [verifyOn, setVerifyOn] = useState(false);
  const verify = trpc.voiceSetup.verify.useQuery(undefined, { enabled: verifyOn, retry: false, refetchOnWindowFocus: false });
  const disconnect = trpc.voiceSetup.disconnect.useMutation();
  const keyOk = d?.steps.find((s) => s.id === "apiKey")?.status === "done";
  const connected = d?.steps.find((s) => s.id === "webhook")?.status === "done";

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="w-6 h-6 text-primary" aria-hidden="true" />
            Llamadas IA · Puesta en marcha
          </h1>
          <p className="text-sm text-muted-foreground">
            Conecta tu propia cuenta de Vapi para que cada llamada de tu asistente de voz quede registrada en tu panel. Cada paso se marca solo en cuanto
            la plataforma lo comprueba.
          </p>
        </div>

        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : q.isError || !d ? (
          <div role="alert" className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-red-600 dark:text-red-400">
            {q.error?.message || "No se pudo cargar la puesta en marcha. Recarga la página para intentarlo de nuevo."}
          </div>
        ) : !d.multi ? (
          <div className="bg-card border border-border/50 rounded-2xl p-5 text-sm text-muted-foreground">
            En esta instalación la cuenta de Vapi la configura el equipo técnico, desde{" "}
            <Link href={VOICE_CALLS_PATH} className="underline">
              Llamadas IA › Configuración
            </Link>
            .
          </div>
        ) : (
          <>
            <div role="status" className={`rounded-2xl border p-4 sm:p-5 ${d.ready ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">{d.ready ? "Llamadas IA está funcionando" : "Aún falta algo para empezar"}</p>
                <span className="text-xs text-muted-foreground">
                  {d.completed} de {d.total} pasos
                </span>
              </div>
              {d.ready ? (
                <p className="text-sm text-muted-foreground mt-1">Tu asistente está conectado y ya ha llegado una llamada. Revísalas en «Llamadas».</p>
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

            <KeyCard masked={d.keyMasked} onChanged={() => q.refetch()} />
            <ConnectCard ready={keyOk} current={{ assistantId: d.assistant.id, phoneId: d.phoneNumber.id }} onChanged={() => q.refetch()} />

            <section aria-labelledby="estado-titulo" className={card}>
              <div className={cardHead}>
                <h2 id="estado-titulo" className="text-sm font-semibold flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  Llamada de prueba y último evento
                </h2>
                <p className="text-xs text-muted-foreground">Llama al número conectado: al colgar, Vapi envía el informe de la llamada a tu panel.</p>
              </div>
              <dl className="p-5 grid gap-3 sm:grid-cols-2 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Asistente conectado</dt>
                  <dd className="break-words">{d.assistant.name ?? "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Número</dt>
                  <dd className="break-words">{d.phoneNumber.number ?? "—"}</dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Dirección de los avisos (la de tu empresa)</dt>
                  <dd className="font-mono text-xs break-all">{d.webhookUrl ?? "Tu empresa aún no tiene dirección pública."}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Clave de verificación</dt>
                  <dd className="flex items-center gap-1">
                    <ShieldCheck className={`w-4 h-4 ${d.secret.usable ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} aria-hidden="true" />
                    {d.secret.usable ? "Configurada (no se muestra)" : d.secret.tooShort ? "Demasiado corta: se renovará al conectar" : "Se genera al conectar"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Conectado el</dt>
                  <dd>{fmt(d.connectedAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Último aviso recibido de Vapi</dt>
                  <dd>{fmt(d.lastEventAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Última llamada registrada</dt>
                  <dd>{d.lastCall ? `${fmt(d.lastCall.at)}${d.lastCall.durationSeconds != null ? ` · ${d.lastCall.durationSeconds} s` : ""}` : "—"}</dd>
                </div>
              </dl>
              <div className="px-5 pb-5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`${btn} border border-border/60`} disabled={!connected || verify.isFetching} onClick={() => (verifyOn ? verify.refetch() : setVerifyOn(true))}>
                    {verify.isFetching ? "Comprobando…" : "Comprobar en Vapi"}
                  </button>
                  <button type="button" className={`${btn} border border-border/60`} onClick={() => q.refetch()}>
                    Actualizar estado
                  </button>
                  <Link href={VOICE_CALLS_PATH} className={`${btn} border border-border/60 inline-flex items-center gap-1`}>
                    Ver las llamadas
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
                {verifyOn && verify.data && (
                  <div role="status" className={`text-sm ${verify.data.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {verify.data.ok ? "Todo correcto en Vapi: el asistente envía sus avisos a tu panel y el número lo tiene asignado." : (
                      <ul className="list-disc pl-5">
                        {verify.data.problems.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {verifyOn && verify.isError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {verify.error.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Coste: los minutos de cada llamada los factura Vapi en tu propia cuenta (consúltalos en dashboard.vapi.ai). La plataforma no cobra nada
                  por llamada; en «Llamadas» tienes la duración de cada una.
                </p>
              </div>
            </section>

            {(d.keyMasked || d.secret.set || d.assistant.id) && (
              <section aria-labelledby="desconectar-titulo" className={`${card} p-5 space-y-2`}>
                <h2 id="desconectar-titulo" className="text-sm font-semibold flex items-center gap-2">
                  <Unplug className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  Desconectar
                </h2>
                <p className="text-xs text-muted-foreground">
                  Borra de tu panel la clave de Vapi, la clave de verificación y la elección: desde ese momento tu panel rechaza los avisos de Vapi. El
                  historial de llamadas se conserva. Si usas la Recepcionista IA por teléfono, también deja de funcionar. En Vapi no se cambia nada: si
                  quieres, quita la «Server URL» del asistente en dashboard.vapi.ai.
                </p>
                <button
                  type="button"
                  disabled={disconnect.isPending}
                  className={`${btn} border border-red-500/50 text-red-700 dark:text-red-300`}
                  onClick={async () => {
                    if (!window.confirm("¿Desconectar Vapi de tu panel? Las llamadas dejarán de registrarse.")) return;
                    try {
                      await disconnect.mutateAsync();
                      setVerifyOn(false);
                      toast.success("Vapi desconectado de tu panel.");
                      q.refetch();
                    } catch (err) {
                      toast.error(errMsg(err, "No se pudo desconectar"));
                    }
                  }}
                >
                  {disconnect.isPending ? "Desconectando…" : "Desconectar Vapi"}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
