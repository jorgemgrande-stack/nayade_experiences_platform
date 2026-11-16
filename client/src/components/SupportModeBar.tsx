/**
 * Banda permanente del modo soporte de Big Elephant (soporte delegado desde el CRM central). Solo aparece con el usuario
 * sintético de soporte (`loginMethod: "support"`): operador, modo (solo lectura o con modificación) y duración.
 *  - Duración limitada: «Caduca HH:MM» y «Salir», que termina la sesión Y el acceso (el plano de control revoca la
 *    concesión al recibir la salida).
 *  - Hasta revocación: «Hasta revocación» y «Finalizar sesión», que cierra SOLO esta sesión; la autorización sigue
 *    vigente hasta que un administrador la revoque en el CRM (y desde allí se abre otra sesión).
 * En ambos casos se vuelve al CRM y la sesión central del operador no se toca. No confundir con «Cerrar sesión», que en
 * modo soporte no se muestra.
 */
import { useState } from "react";
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

export async function exitSupportMode(): Promise<void> {
  let returnUrl = "https://admin.bigelephant.es/";
  try {
    const r = await fetch("/_support/exit", { method: "POST", credentials: "same-origin" });
    const j = (await r.json().catch(() => null)) as { returnUrl?: string } | null;
    if (j?.returnUrl && /^https:\/\//.test(j.returnUrl)) returnUrl = j.returnUrl;
  } catch {
    /* la cookie caduca sola; se vuelve igualmente */
  }
  // Abierta desde el CRM en una pestaña nueva: se cierra; si el navegador no lo permite, se vuelve al CRM
  window.close();
  window.location.replace(returnUrl);
}

export function SupportModeBar({ user }: { user: SupportUserFields }) {
  const [leaving, setLeaving] = useState(false);
  const write = user.supportReadOnly === false;
  const untilRevoked = !!user.supportUntilRevoked;
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
      {untilRevoked && <span className="hidden text-xs font-normal text-white/80 sm:inline">La autorización sigue vigente hasta que se revoque en el CRM</span>}
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void exitSupportMode();
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
