/**
 * Restaurant Net · carta QR de cada mesa y pedidos desde la mesa.
 *  - `TableQrButton`: emite o rota el enlace de la mesa y dibuja su QR (shared/qrCode, sin servicios externos). El enlace
 *    solo se ve al emitirlo: el servidor guarda su huella, no el token. Rotarlo invalida el QR impreso.
 *  - `TableRequestsPanel`: pedidos enviados desde las mesas, pendientes de confirmar. Confirmar los pasa a la comanda de
 *    la mesa (sin cobrar); el cobro sigue siendo el de la sala con el TPV.
 */
import { useMemo, useState } from "react";
import { Check, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toastError } from "@/components/admin/PanelStates";
import { qrMatrix, qrSvgPath } from "@shared/qrCode";

export function QrImage({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="h-56 w-56 rounded-lg bg-white" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function downloadSvg(text: string, name: string) {
  const { path, size } = qrSvgPath(qrMatrix(text));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TableQrButton({ tableId, code, active, canWrite, onChange }: { tableId: number; code: string; active: boolean; canWrite: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const issue = trpc.restaurantNet.issueTableLink.useMutation({ onSuccess: (r) => { setUrl(r.url); onChange(); }, onError: (e) => toastError(e) });
  const revoke = trpc.restaurantNet.revokeTableLink.useMutation({ onSuccess: () => { setUrl(null); toast.success(`El QR de la mesa ${code} ya no vale`); onChange(); }, onError: (e) => toastError(e) });
  const close = () => { setOpen(false); setUrl(null); };
  return (
    <>
      <Button size="sm" variant="ghost" aria-label={`Carta QR de la mesa ${code}`} onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4" aria-hidden="true" />
        {active && <span className="sr-only"> (activa)</span>}
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Carta QR · mesa {code}</DialogTitle>
            <DialogDescription>
              Los clientes ven la carta y envían su pedido; el camarero lo confirma antes de que pase a la comanda. No se cobra nada en línea.
            </DialogDescription>
          </DialogHeader>
          {url ? (
            <div className="flex flex-col items-center gap-3">
              <QrImage text={url} label={`Código QR de la mesa ${code}`} />
              <p className="w-full break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{url}</p>
              <p className="text-xs text-muted-foreground">Imprímelo o descárgalo ahora: por seguridad el enlace no se vuelve a mostrar. Si lo pierdes, genera uno nuevo.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Enlace copiado"))}>Copiar enlace</Button>
                <Button variant="outline" size="sm" onClick={() => downloadSvg(url, `mesa-${code}`)}>Descargar QR</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {active ? "Esta mesa ya tiene un QR activo. Generar uno nuevo invalida el que esté impreso." : "Esta mesa aún no tiene QR."}
            </p>
          )}
          <DialogFooter className="gap-2">
            {canWrite && active && !url && (
              <Button variant="outline" onClick={() => revoke.mutate({ tableId })} disabled={revoke.isPending}>Desactivar el QR</Button>
            )}
            {canWrite && (
              <Button onClick={() => issue.mutate({ tableId })} disabled={issue.isPending}>{active || url ? "Generar un QR nuevo" : "Generar el QR"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const fmtEur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const fmtTime = (ms: number) => new Intl.DateTimeFormat("es-ES", { timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms));

export function TableRequestsPanel({ restaurantId, canWrite }: { restaurantId: number; canWrite: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.restaurantNet.tableRequests.useQuery({ restaurantId }, { refetchInterval: 15_000, retry: false });
  const refresh = () => {
    utils.restaurantNet.tableRequests.invalidate();
    utils.restaurantNet.getFloor.invalidate();
  };
  const accept = trpc.restaurantNet.acceptTableRequest.useMutation({
    onSuccess: (r) => { toast.success(r.skipped.length ? `Pedido añadido a la comanda. No disponibles: ${r.skipped.join(", ")}` : "Pedido añadido a la comanda"); refresh(); },
    onError: (e) => { toastError(e); refresh(); },
  });
  const reject = trpc.restaurantNet.rejectTableRequest.useMutation({ onSuccess: () => { toast.success("Pedido rechazado"); refresh(); }, onError: (e) => { toastError(e); refresh(); } });
  const pending = q.data?.pending ?? [];
  if (q.isError || !pending.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3" aria-label="Pedidos desde la mesa">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        Pedidos desde la mesa <Badge variant="secondary">{pending.length}</Badge>
      </h2>
      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-card p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-foreground">Mesa {r.tableCode}</strong>
              <span className="text-xs text-muted-foreground">{fmtTime(r.createdAt)} · {fmtEur(r.estimatedTotal)} orientativo</span>
            </div>
            <ul className="mt-1 text-foreground">
              {r.lines.map((l, i) => <li key={i} className="break-words">{l.quantity} × {l.name}</li>)}
            </ul>
            {r.guestNote && <p className="mt-1 break-words text-xs text-muted-foreground">«{r.guestNote}»</p>}
            {canWrite && r.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => accept.mutate({ requestId: r.id })} disabled={accept.isPending}><Check className="mr-1 h-4 w-4" aria-hidden="true" />Confirmar</Button>
                <Button size="sm" variant="outline" onClick={() => reject.mutate({ requestId: r.id, reason: null })} disabled={reject.isPending}><X className="mr-1 h-4 w-4" aria-hidden="true" />Rechazar</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
