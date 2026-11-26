/**
 * Confirmación única del panel: sustituye a `confirm()` del navegador (sin estilo, sin idioma ni accesibilidad propios).
 *
 *   if (!(await confirmAction({ description: "¿Eliminar este gasto?", destructive: true }))) return;
 *
 * `<ConfirmHost />` vive en `AdminLayout`; `confirmAction` devuelve una promesa que resuelve `true` al confirmar y `false`
 * al cancelar, cerrar o pulsar Esc. Si no hay anfitrión montado (p. ej. una pantalla fuera del marco) usa la confirmación
 * nativa del navegador: nunca se ejecuta una acción sin confirmar.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n/I18nProvider";

export interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  /** Acción irreversible (borrar, anular): botón en color de peligro. */
  destructive?: boolean;
}

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

let host: ((p: Pending) => void) | null = null;

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Pantalla fuera del marco del panel (sin anfitrión): confirmación nativa, nunca se ejecuta sin confirmar
    if (!host) { resolve(typeof window !== "undefined" ? window.confirm(opts.description) : false); return; }
    host({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    host = (p) => setPending((prev) => { prev?.resolve(false); return p; });
    return () => { host = null; };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) close(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? (pending?.destructive ? t("common.delete") : t("common.confirm"))}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={pending?.destructive ? "bg-destructive hover:bg-destructive/90 text-white" : undefined}
            onClick={() => close(true)}
          >
            {pending?.confirmLabel ?? (pending?.destructive ? t("common.delete") : t("common.confirm"))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
