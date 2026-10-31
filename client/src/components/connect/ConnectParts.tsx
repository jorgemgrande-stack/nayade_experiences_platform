/**
 * Piezas de Elephant Connect: distintivo de estado, precio, solicitud al equipo y contratación (vista previa →
 * confirmación explícita → compra idempotente → seguimiento hasta la confirmación del backend).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Loader2, Lock, Mail, PackagePlus, Settings2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PanelLoading } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CONNECT_STATE_LABELS, type ConnectState } from "@shared/connectMarketplace";
import type { PurchaseStatus } from "@shared/connectPurchase";
import { useConnectAttempt, useOrderTracking, useRefreshLicences, type ConnectCatalogItem } from "./useConnect";

const STATE_META: Record<ConnectState, { icon: typeof CheckCircle2; tone: string }> = {
  available: { icon: Sparkles, tone: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  active: { icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  pending_setup: { icon: Settings2, tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  activating: { icon: Loader2, tone: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200" },
  not_eligible: { icon: Lock, tone: "bg-muted text-muted-foreground" },
  on_request: { icon: PackagePlus, tone: "bg-muted text-foreground" },
  coming_soon: { icon: Clock, tone: "bg-muted text-muted-foreground" },
  incident: { icon: AlertTriangle, tone: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200" },
};

export function StateBadge({ state }: { state: ConnectState }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 border-0 whitespace-normal text-left", meta.tone)}>
      <Icon className={cn("w-3.5 h-3.5 shrink-0", state === "activating" && "animate-spin")} aria-hidden="true" />
      {CONNECT_STATE_LABELS[state]}
    </Badge>
  );
}

export const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

/** Precio publicado en el catálogo (mensual); el IVA, aparte salvo que el catálogo diga lo contrario. */
export function Price({ item, className }: { item: Pick<ConnectCatalogItem, "monthly">; className?: string }) {
  if (!item.monthly) return <p className={cn("text-sm text-muted-foreground", className)}>Precio a consultar</p>;
  return (
    <p className={cn("text-sm text-foreground", className)}>
      <strong>{money(item.monthly.amountCents, item.monthly.currency)}</strong>
      <span className="text-muted-foreground">
        {" "}/ mes{item.monthly.unit ? ` por ${item.monthly.unit}` : ""}
        {item.monthly.taxIncluded ? " (IVA incluido)" : " + IVA"}
      </span>
    </p>
  );
}

/** Solicitud al equipo (contratación acompañada, sin permiso para comprar, compras cerradas…). */
export function RequestDialog({ item, supportEmail, upgradeUrl, requestsEnabled, onClose }: { item: ConnectCatalogItem; supportEmail: string | null; upgradeUrl: string | null; requestsEnabled: boolean; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const open = trpc.support.open.useMutation({ onError: (e) => toast.error(e.message) });
  const description = `Me interesa contratar «${item.name}» para mi empresa.${message.trim() ? `\n\n${message.trim()}` : ""}`;
  const mailto = supportEmail ? `mailto:${supportEmail}?subject=${encodeURIComponent(`Solicitud: ${item.name}`)}&body=${encodeURIComponent(description)}` : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar {item.name}</DialogTitle>
          <DialogDescription>Nuestro equipo revisa tu solicitud y te contacta para activarlo contigo. Enviarla no supone ningún cargo.</DialogDescription>
        </DialogHeader>
        {open.isSuccess ? (
          <p className="text-sm text-emerald-800 dark:text-emerald-300">Solicitud enviada. Puedes seguirla en Soporte.</p>
        ) : requestsEnabled ? (
          <label className="block space-y-1 text-sm">
            <span className="text-foreground">¿Algo que debamos saber? (opcional)</span>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} />
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">{mailto ? "Escríbenos y te contactamos." : upgradeUrl ? "Consulta las opciones en nuestra web." : "Pídelo a tu contacto comercial."}</p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          {requestsEnabled && !open.isSuccess && (
            <Button type="button" disabled={open.isPending} onClick={() => open.mutate({ title: `Solicitud de contratación: ${item.name}`.slice(0, 200), description, category: "billing" })}>
              {open.isPending ? "Enviando…" : "Enviar solicitud"}
            </Button>
          )}
          {open.isSuccess && (
            <Button asChild>
              <Link href="/admin/soporte">Ir a Soporte</Link>
            </Button>
          )}
          {!requestsEnabled && mailto && (
            <Button asChild>
              <a href={mailto}>
                <Mail className="w-4 h-4 mr-1.5" aria-hidden="true" /> Escribir
              </a>
            </Button>
          )}
          {!requestsEnabled && !mailto && upgradeUrl && (
            <Button asChild>
              <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
                Ver opciones <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PreviewLine {
  productKey: string;
  name: string;
  kind: "module" | "quantity";
  fromQuantity: number;
  toQuantity: number;
}
interface Preview {
  currency: string;
  amountDueCents: number;
  taxCents: number | null;
  lines: PreviewLine[];
  recurringDeltaCents: number;
  interval: "month" | "year";
}
interface PurchaseResult {
  status: PurchaseStatus;
  orderId: number;
  paymentUrl: string | null;
}

/** Mensaje para cada estado del pedido (el backend manda). */
function StatusMessage({ status, name }: { status: PurchaseStatus | null; name: string }) {
  if (status === "applied") return <p className="text-sm text-emerald-800 dark:text-emerald-300">Listo: {name} ya está activa. La encontrarás en tu menú.</p>;
  if (status === "processing")
    return (
      <p className="text-sm text-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Estamos confirmando el cobro. Se activará en cuanto quede verificado; puedes cerrar esta ventana.
      </p>
    );
  if (status === "payment_pending") return <p className="text-sm text-foreground">Falta completar el pago con tu banco. Hasta entonces no se activa nada ni se hace ningún cargo.</p>;
  if (status === "failed" || status === "expired") return <p className="text-sm text-red-700 dark:text-red-400">No se ha podido completar la contratación. No se ha hecho ningún cargo.</p>;
  return null;
}

/**
 * Contratación de un módulo: vista previa (importe del plano de control) → confirmación explícita → compra con
 * clave estable por intento (reintentar nunca duplica) → seguimiento hasta que el backend la aplica.
 */
export function PurchaseDialog({ item, onClose }: { item: ConnectCatalogItem; onClose: () => void }) {
  const { attempt, begin, record } = useConnectAttempt(item.key);
  const refresh = useRefreshLicences();
  const tracking = useOrderTracking(attempt);
  const [accepted, setAccepted] = useState(false);
  const [last, setLast] = useState<PurchaseResult | null>(null);
  // Un pedido ya aceptado (p. ej. al volver de la página de pago) se sigue; no se pide otra vista previa
  const ordered = !!attempt && attempt.orderId !== null;
  const preview = trpc.subscription.purchasePreview.useMutation();
  const buy = trpc.subscription.purchase.useMutation({
    onSuccess: (r, vars) => {
      const res = r as PurchaseResult;
      setLast(res);
      const a = attempt && attempt.idempotencyKey === vars.idempotencyKey ? attempt : { productKey: item.key, idempotencyKey: vars.idempotencyKey, orderId: null, status: "draft" as const, paymentUrl: null, startedAt: Date.now() };
      record(a, res);
      if (res.status === "applied") {
        refresh();
        toast.success(`${item.name} ya está activa`);
      }
    },
    // Error de red o del servicio: el intento se conserva y «Reintentar» usa la MISMA clave
    onError: (e) => toast.error(e.message),
  });
  const { mutate: requestPreview } = preview;
  useEffect(() => {
    if (!ordered) requestPreview({ add: [item.key] });
  }, [requestPreview, item.key, ordered]);
  const p = preview.data as Preview | undefined;
  const status: PurchaseStatus | null = tracking.status ?? last?.status ?? null;
  const rawPaymentUrl = attempt?.paymentUrl ?? last?.paymentUrl ?? null;
  // Solo se lleva a una página de pago de Stripe (nunca a otra dirección)
  const paymentUrl = rawPaymentUrl && /^https:\/\/(invoice|pay|checkout)\.stripe\.com\//.test(rawPaymentUrl) ? rawPaymentUrl : null;
  const confirm = () => {
    const a = begin();
    buy.mutate({ add: [item.key], idempotencyKey: a.idempotencyKey });
  };
  const per = p?.interval === "year" ? "año" : "mes";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contratar {item.name}</DialogTitle>
          <DialogDescription>Revisa el importe antes de confirmar. Lo calcula nuestro sistema de cobros según los días que quedan de tu periodo actual.</DialogDescription>
        </DialogHeader>

        {!ordered && !status && (
          <>
            {preview.isPending && <PanelLoading label="Calculando el importe…" />}
            {preview.isError && <p className="text-sm text-red-700 dark:text-red-400">{preview.error.message}</p>}
            {p && (
              <div className="space-y-3 text-sm">
                <ul className="space-y-1">
                  {p.lines.map((l) => (
                    <li key={l.productKey} className="text-foreground">
                      {l.name}
                    </li>
                  ))}
                </ul>
                <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                  <p className="flex justify-between gap-3">
                    <span>A pagar ahora (parte proporcional)</span>
                    <strong>{money(p.amountDueCents, p.currency)}</strong>
                  </p>
                  {p.taxCents !== null && <p className="text-xs text-muted-foreground">Incluye {money(p.taxCents, p.currency)} de impuestos.</p>}
                  <p className="text-xs text-muted-foreground">
                    Después, {money(p.recurringDeltaCents, p.currency)} más por {per} en cada renovación{p.taxCents === null ? " (IVA aparte)" : ""}.
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
                  <span>Confirmo que quiero contratar {item.name} con este importe para mi empresa.</span>
                </label>
              </div>
            )}
          </>
        )}

        {(ordered || status) && <StatusMessage status={status ?? (attempt?.status === "draft" ? null : (attempt?.status ?? null))} name={item.name} />}
        {buy.isError && !status && <p className="text-sm text-red-700 dark:text-red-400">No hemos recibido respuesta. Puedes reintentarlo: no se cobrará dos veces.</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {status || ordered ? "Cerrar" : "Cancelar"}
          </Button>
          {!ordered && !status && (
            <Button type="button" disabled={!p || !accepted || buy.isPending} onClick={confirm}>
              {buy.isPending ? "Procesando…" : buy.isError ? "Reintentar" : "Confirmar y contratar"}
            </Button>
          )}
          {status === "payment_pending" && paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(paymentUrl)}>
              Completar el pago <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Button>
          )}
          {(status === "payment_pending" || status === "processing") && (
            <Button type="button" variant="ghost" disabled={tracking.isChecking} onClick={() => void tracking.recheck()}>
              Comprobar ahora
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
