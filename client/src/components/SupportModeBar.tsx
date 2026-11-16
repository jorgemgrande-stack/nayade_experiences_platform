/**
 * Banda permanente del modo soporte de Big Elephant (soporte delegado desde el CRM central). Solo aparece con el usuario
 * sintético de soporte (`loginMethod: "support"`): operador, modo (solo lectura o con modificación) y duración.
 *  - Duración limitada: «Caduca HH:MM» y «Salir», que termina la sesión Y el acceso (el plano de control revoca la
 *    concesión al recibir la salida).
 *  - Hasta revocación: «Hasta revocación» y «Finalizar sesión», que cierra SOLO esta sesión; la autorización sigue
 *    vigente hasta que un administrador la revoque en el CRM (y desde allí se abre otra sesión). La sesión se mantiene
 *    con la actividad REAL del operador (pulsar o escribir: /_support/heartbeat); las consultas periódicas del panel no
 *    cuentan, así que una pestaña abandonada se cierra a las 2 h.
 * En ambos casos se vuelve al CRM y la sesión central del operador no se toca. No confundir con «Cerrar sesión», que en
 * modo soporte no se muestra.
 */
import { useEffect, useState } from "react";
import { LifeBuoy, LogOut } from "lucide-react";

export interface SupportUserFields {
  loginMethod?: string | null;
  supportOperator?: string | null;
  supportReadOnly?: boolean | null;
  supportExpiresAt?: number | null;
  supportUntilRevoked?: boolean | null;
}

export const isSupportUser = (u: unknown): u is SupportUserFields => !!u && (u as SupportUserFields).loginMethod === "support";

export const supportModeLabel = (u: SupportUserFields): string => {
  const mode = u.supportReadOnly === false ? "Con modificación" : "Solo lectura";
  if (u.supportUntilRevoked) return `Soporte Big Elephant · ${mode} · Hasta revocación`;
  const until = u.supportExpiresAt ? new Date(u.supportExpiresAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—";
  return `Modo soporte Big Elephant · ${u.supportOperator ?? "operador"} · ${u.supportReadOnly === false ? "Modificación" : "Solo lectura"} · Caduca ${until}`;
};

/** Aviso de actividad como mucho cada 5 minutos (el servidor renueva la sesión cada 15). */
export const SUPPORT_HEARTBEAT_MIN_MS = 5 * 60_000;

/**
 * Sale del modo soporte y vuelve al CRM. Si el servidor no ha podido registrar el cierre, NO se va: devuelve el mensaje
 * para mostrarlo (la sesión podría seguir valiendo en otra réplica hasta que se revoque).
 */
export async function exitSupportMode(): Promise<string | null> {
  let returnUrl = "https://admin.bigelephant.es/";
  try {
    const r = await fetch("/_support/exit", { method: "POST", credentials: "same-origin" });
    const j = (await r.json().catch(() => null)) as { returnUrl?: string; message?: string } | null;
    if (r.status === 503) return j?.message ?? "No se ha podido registrar el cierre en el servidor. Vuelve a intentarlo o revoca el acceso desde el CRM.";
    if (j?.returnUrl && /^https:\/\//.test(j.returnUrl)) returnUrl = j.returnUrl;
  } catch {
    return "No se ha podido contactar con el servidor para cerrar la sesión. Vuelve a intentarlo o revoca el acceso desde el CRM.";
  }
  // Abierta desde el CRM en una pestaña nueva: se cierra; si el navegador no lo permite, se vuelve al CRM
  window.close();
  window.location.replace(returnUrl);
  return null;
}

export function SupportModeBar({ user }: { user: SupportUserFields }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = user.supportReadOnly === false;
  const untilRevoked = !!user.supportUntilRevoked;

  // «Hasta revocación»: la interacción real del operador mantiene viva la sesión
  useEffect(() => {
    if (!untilRevoked) return;
    let last = 0;
    const beat = () => {
      const now = Date.now();
      if (now - last < SUPPORT_HEARTBEAT_MIN_MS) return;
      last = now;
      void fetch("/_support/heartbeat", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    };
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, beat, { passive: true, capture: true }));
    return () => events.forEach((e) => window.removeEventListener(e, beat, { capture: true }));
  }, [untilRevoked]);

  // Fija abajo (la barra superior del panel ya es fija arriba) y con hueco para no tapar el contenido
  return (
    <>
    <div aria-hidden="true" className="h-12 shrink-0" />
    <div
      role="status"
      data-support-mode
      data-support-until-revoked={untilRevoked ? "1" : undefined}
      className={`fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-medium text-white ${write ? "bg-red-700" : "bg-amber-700"}`}
    >
      <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1" title={user.supportOperator ? `Operador: ${user.supportOperator}` : undefined}>
        {supportModeLabel(user)}
      </span>
      {error ? (
        <span className="text-xs font-normal" role="alert">{error}</span>
      ) : (
        untilRevoked && <span className="hidden text-xs font-normal text-white/80 sm:inline">La autorización sigue vigente hasta que se revoque en el CRM</span>
      )}
      <button
        type="button"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          setError(null);
          const failed = await exitSupportMode();
          if (failed) {
            setError(failed);
            setLeaving(false);
          }
        }}
        title={untilRevoked ? "Cierra esta sesión. La autorización no se revoca: puedes abrir otra sesión desde el CRM." : "Termina la sesión y el acceso de soporte"}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {untilRevoked ? "Finalizar sesión" : "Salir"}
      </button>
    </div>
    </>
  );
}
