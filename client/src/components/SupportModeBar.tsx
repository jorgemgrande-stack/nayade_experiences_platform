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
import { createFormatters } from "@shared/i18n/core";
import { useI18n } from "@/i18n/I18nProvider";
import { getCurrentLocale, getT } from "@/i18n/standalone";

export interface SupportUserFields {
  loginMethod?: string | null;
  supportOperator?: string | null;
  supportReadOnly?: boolean | null;
  supportExpiresAt?: number | null;
  supportUntilRevoked?: boolean | null;
}

export const isSupportUser = (u: unknown): u is SupportUserFields => !!u && (u as SupportUserFields).loginMethod === "support";

export const supportModeLabel = (u: SupportUserFields): string => {
  const t = getT();
  const writes = u.supportReadOnly === false;
  const mode = writes ? t("supportBar.write") : t("supportBar.readOnly");
  if (u.supportUntilRevoked) return t("supportBar.untilRevoked", { mode });
  const until = u.supportExpiresAt ? createFormatters(getCurrentLocale()).time(u.supportExpiresAt) : "—";
  return t("supportBar.timed", { operator: u.supportOperator ?? t("supportBar.operator"), mode: writes ? t("supportBar.writeShort") : t("supportBar.readOnly"), until });
};

/** Aviso de actividad como mucho cada 5 minutos (el servidor renueva la sesión cada 15). */
export const SUPPORT_HEARTBEAT_MIN_MS = 5 * 60_000;

/**
 * Sale del modo soporte y vuelve al CRM. Si el servidor no ha podido registrar el cierre, NO se va: devuelve el mensaje
 * para mostrarlo (la sesión podría seguir valiendo en otra réplica hasta que se revoque).
 */
export async function exitSupportMode(): Promise<string | null> {
  const t = getT();
  let returnUrl = "https://admin.bigelephant.es/";
  try {
    const r = await fetch("/_support/exit", { method: "POST", credentials: "same-origin" });
    const j = (await r.json().catch(() => null)) as { returnUrl?: string; message?: string } | null;
    if (r.status === 503) return j?.message ?? t("supportBar.closeNotRegistered");
    if (j?.returnUrl && /^https:\/\//.test(j.returnUrl)) returnUrl = j.returnUrl;
  } catch {
    return t("supportBar.closeNoServer");
  }
  // Abierta desde el CRM en una pestaña nueva: se cierra; si el navegador no lo permite, se vuelve al CRM
  window.close();
  window.location.replace(returnUrl);
  return null;
}

export function SupportModeBar({ user }: { user: SupportUserFields }) {
  const { t } = useI18n();
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
      <span className="min-w-0 flex-1" title={user.supportOperator ? t("supportBar.operatorTitle", { operator: user.supportOperator }) : undefined}>
        {supportModeLabel(user)}
      </span>
      {error ? (
        <span className="text-xs font-normal" role="alert">{error}</span>
      ) : (
        untilRevoked && <span className="hidden text-xs font-normal text-white/80 sm:inline">{t("supportBar.stillValid")}</span>
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
        title={untilRevoked ? t("supportBar.endSessionTitle") : t("supportBar.exitTitle")}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {untilRevoked ? t("supportBar.endSession") : t("supportBar.exit")}
      </button>
    </div>
    </>
  );
}
