/**
 * Ventana emergente (módulo «Ventana emergente» de Elephant Studio): la parte de la web pública.
 *
 * - La ventana usa el diálogo accesible de Radix (role="dialog", aria-modal, aria-labelledby, foco atrapado y devuelto,
 *   Esc, fondo bloqueado y resto de la página oculto a los lectores de pantalla).
 * - Se abre con cualquier enlace, botón o tarjeta cuya dirección sea `#modal-<identificador>`, con esa dirección en la
 *   barra (enlace directo) o, si el módulo lo pide, sola. Sin scripts de terceros ni HTML libre.
 * - La apertura automática está desactivada por defecto. Una vez por visita, solo cuando la persona ya ha decidido sobre
 *   las cookies, nunca encima de otra ventana y sin volver si marcó «no volver a mostrar» (se guarda solo si lo marca).
 * - El contenido solo está en la página mientras la ventana está abierta (no carga vídeos ni formularios ocultos); su
 *   texto sí va en el resumen que se guarda para buscadores (server/_core/pageBlocks.ts, `blocksToHtml`).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasCookieDecision, showsCookieBanner } from "@/components/CookieBanner";
import { trpc } from "@/lib/trpc";
import { cookieGate, createAutoOpener, type AutoOpener } from "@/lib/autoOpenGate";
import type { CookieThemeInput } from "@shared/cookieCategories";
import type { BlockOf } from "@shared/pageBlocks";
import {
  MODAL_DAY_MS, modalClosing, modalDismissalActive, modalHref, modalSessionKey, modalSlugFromHref, modalStorageKey,
} from "@shared/studio/modal";

const SIZE_CLASS: Record<string, string> = { s: "sm:max-w-sm", m: "sm:max-w-xl", l: "sm:max-w-3xl" };
const SYNC_EVENT = "es-modal-sync";

function readStore(kind: "local" | "session", key: string): string | null {
  try {
    return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(kind: "local" | "session", key: string, value: string) {
  try {
    (kind === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    /* sin almacenamiento: simplemente no se recuerda */
  }
}

/** La persona ya descartó esta ventana, o ya se abrió sola en esta visita. */
function autoOpenBlocked(slug: string): boolean {
  return modalDismissalActive(readStore("local", modalStorageKey(slug)), Date.now()) || readStore("session", modalSessionKey(slug)) !== null;
}

/** Estado de apertura de una ventana de la web: enlace `#modal-…`, enlace directo y apertura automática. */
export function usePublicModal(b: BlockOf<"modal">, enabled: boolean, autoEnabled: boolean) {
  const d = b.data;
  const href = modalHref(d.slug);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  // Enlaces y dirección de la barra: la dirección manda (así «Atrás» cierra la ventana y se puede compartir)
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setOpen(window.location.hash === href);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const h = a?.getAttribute("href") ?? "";
      if (!a || !h.startsWith("#") || modalSlugFromHref(h) !== d.slug) return;
      e.preventDefault();
      e.stopPropagation();
      trigger.current = a;
      if (window.location.hash !== href) window.history.pushState({ esModal: d.slug }, "", href);
      window.dispatchEvent(new Event(SYNC_EVENT));
    };
    sync();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener(SYNC_EVENT, sync);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(SYNC_EVENT, sync);
    };
  }, [enabled, href, d.slug]);

  // Apertura automática (desactivada por defecto). Espera al tema (¿usa aviso de cookies?) y a la decisión de la persona
  const wantsAuto = enabled && autoEnabled && d.autoOpen !== "off";
  const theme = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false, enabled: wantsAuto });
  const gateIn = useRef({ themeLoaded: false, theme: undefined as CookieThemeInput | null | undefined });
  gateIn.current = { themeLoaded: theme.isSuccess || theme.isError, theme: theme.data as CookieThemeInput | undefined };
  const opener = useRef<AutoOpener | null>(null);
  useEffect(() => {
    if (!wantsAuto || window.location.hash === href || autoOpenBlocked(d.slug)) return;
    const cleanups: Array<() => void> = [];
    const o = createAutoOpener({
      gate: () => (document.querySelector("[data-es-modal-open]") || autoOpenBlocked(d.slug) ? "wait-decision" : cookieGate({ ...gateIn.current, decided: hasCookieDecision(), bannerRoute: showsCookieBanner(window.location.pathname) })),
      open: () => {
        writeStore("session", modalSessionKey(d.slug), "1");
        trigger.current = (document.activeElement as HTMLElement | null) ?? null;
        setOpen(true);
      },
      graceMs: 1200,
      later: (fn, ms) => {
        const t = window.setTimeout(fn, ms);
        return () => window.clearTimeout(t);
      },
    });
    opener.current = o;
    const onConsent = () => o.recheck();
    window.addEventListener("cookieConsentChanged", onConsent);
    cleanups.push(() => window.removeEventListener("cookieConsentChanged", onConsent), () => o.dispose(), () => (opener.current = null));
    const wait = Number(d.autoDelay) * 1000;
    if (d.autoOpen === "load") {
      const t = window.setTimeout(() => o.trigger(), wait);
      cleanups.push(() => window.clearTimeout(t));
    } else if (window.matchMedia?.("(pointer: fine)").matches) {
      // Intención de salida: solo con ratón (en móvil no existe), pasados unos segundos y una sola vez
      let armed = false;
      const t = window.setTimeout(() => (armed = true), wait);
      const onOut = (e: MouseEvent) => {
        if (!armed || e.relatedTarget || e.clientY > 0) return;
        document.removeEventListener("mouseout", onOut);
        o.trigger();
      };
      document.addEventListener("mouseout", onOut);
      cleanups.push(() => window.clearTimeout(t), () => document.removeEventListener("mouseout", onOut));
    }
    return () => cleanups.forEach((c) => c());
  }, [wantsAuto, d.autoOpen, d.autoDelay, d.slug, href]);
  // El tema termina de cargar: si el disparo ya se cumplió, reevaluar
  const themeLoaded = theme.isSuccess || theme.isError;
  useEffect(() => {
    if (themeLoaded) opener.current?.recheck(false);
  }, [themeLoaded]);

  const close = useCallback(() => {
    if (window.location.hash === href) {
      // La entrada del historial la creó la propia ventana: se deshace; si venía de un enlace directo, se quita la dirección
      if ((window.history.state as { esModal?: string } | null)?.esModal === d.slug) window.history.back();
      else window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    setOpen(false);
  }, [href, d.slug]);

  return { open, setOpen, close, trigger };
}

/** La ventana: título, imagen opcional, contenido (ya pintado por el llamador) y cierres según el módulo. */
export function ModalDialog({
  b, open, onClose, triggerRef, children, rememberable,
}: { b: BlockOf<"modal">; open: boolean; onClose: () => void; triggerRef: { current: HTMLElement | null }; children: ReactNode; rememberable: boolean }) {
  const d = b.data;
  const closing = modalClosing(d);
  const dontShow = useRef(false);
  const rememberId = useId();
  useEffect(() => {
    if (open) dontShow.current = false;
  }, [open]);
  const finish = () => {
    if (rememberable && dontShow.current) writeStore("local", modalStorageKey(d.slug), String(Date.now() + Number(d.rememberDays) * MODAL_DAY_MS));
    onClose();
  };
  const showRemember = rememberable && d.autoOpen !== "off" && d.rememberOption === "on";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && finish()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          data-es-modal-open=""
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => !closing.esc && e.preventDefault()}
          onPointerDownOutside={(e) => {
            // Pulsar el aviso de cookies no cierra la ventana; el resto, solo si se ha activado
            if (!closing.overlay || (e.target as Element | null)?.closest?.("[data-cookie-banner]")) e.preventDefault();
          }}
          onInteractOutside={(e) => (e.target as Element | null)?.closest?.("[data-cookie-banner]") && e.preventDefault()}
          onCloseAutoFocus={(e) => {
            // El foco vuelve a lo que abrió la ventana (botón, tarjeta o enlace)
            e.preventDefault();
            const t = triggerRef.current;
            if (t && t.isConnected) t.focus({ preventScroll: true });
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[70] flex max-h-[90dvh] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-background text-foreground shadow-2xl focus:outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none",
            SIZE_CLASS[d.size] ?? SIZE_CLASS.m,
          )}
        >
          <div className={cn("min-h-0 flex-1 overflow-y-auto", d.align === "center" && "text-center")}>
            {d.imageUrl && <img src={d.imageUrl} alt={d.imageAlt} loading="lazy" className="max-h-64 w-full object-cover" />}
            <div className="p-5 md:p-7">
              <DialogPrimitive.Title className={cn("font-heading text-xl font-bold md:text-2xl", closing.button && "pr-10", !d.title && "sr-only")}>
                {d.title || d.slug}
              </DialogPrimitive.Title>
              <div className={cn(d.title && "mt-4")}>{children}</div>
              {showRemember && (
                <label htmlFor={rememberId} className={cn("mt-5 flex items-center gap-2 text-sm text-muted-foreground", d.align === "center" && "justify-center")}>
                  <input id={rememberId} type="checkbox" className="h-4 w-4" onChange={(e) => (dontShow.current = e.target.checked)} />
                  {d.rememberLabel}
                </label>
              )}
            </div>
          </div>
          {closing.button && (
            <DialogPrimitive.Close
              className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden />
              <span className="sr-only">{d.closeLabel || d.title || d.slug}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
