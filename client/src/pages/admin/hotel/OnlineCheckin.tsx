/**
 * Hotel Net · check-in online de una reserva (en el diálogo de huéspedes): enviar el enlace al huésped, ver lo que ha
 * rellenado (registro de viajeros, sin datos de pago) y aplicarlo a las fichas o descartarlo. El enlace solo se ve al
 * emitirlo (el servidor guarda su huella) y caduca al terminar el día de llegada.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const fmt = (ms: number | null) => (ms == null ? "—" : new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms)));

export default function OnlineCheckin({ reservationId, onApplied }: { reservationId: number; onApplied: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminOnlineCheckin.useQuery({ reservationId }, { retry: false });
  const [url, setUrl] = useState<string | null>(null);
  const refresh = () => void utils.hotel.adminOnlineCheckin.invalidate({ reservationId });
  const issue = trpc.hotel.adminIssueCheckinLink.useMutation({ onSuccess: (r) => { setUrl(r.url); refresh(); }, onError: (e) => toast.error(e.message) });
  const revoke = trpc.hotel.adminRevokeCheckinLink.useMutation({ onSuccess: () => { setUrl(null); toast.success("Enlace desactivado"); refresh(); }, onError: (e) => toast.error(e.message) });
  const apply = trpc.hotel.adminApplyOnlineCheckin.useMutation({
    onSuccess: (r) => { toast.success(r.incomplete ? `Aplicado · ${r.incomplete} ficha(s) con datos pendientes` : "Datos aplicados a las fichas"); refresh(); onApplied(); },
    onError: (e) => toast.error(e.message),
  });
  const discard = trpc.hotel.adminDiscardOnlineCheckin.useMutation({ onSuccess: () => { toast.success("Datos descartados"); refresh(); }, onError: (e) => toast.error(e.message) });
  if (q.isLoading || q.isError || !q.data || !q.data.available) return null;
  const d = q.data;
  const s = d.submission;
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium"><Link2 className="h-4 w-4" aria-hidden="true" /> Check-in online</div>
        {d.link ? <Badge variant="secondary">Enlace activo hasta {fmt(d.link.expiresAt)}</Badge> : <Badge variant="outline">Sin enlace</Badge>}
      </div>
      {url && (
        <div className="space-y-1">
          <p className="break-all rounded bg-muted px-2 py-1 text-xs">{url}</p>
          <p className="text-xs text-muted-foreground">Envíaselo al huésped ahora: por seguridad no se vuelve a mostrar.</p>
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Enlace copiado"))}>Copiar enlace</Button>
        </div>
      )}
      {d.closedReason ? (
        <p className="text-xs text-muted-foreground">{d.closedReason}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => issue.mutate({ reservationId })}>{d.link ? "Generar un enlace nuevo" : "Crear enlace de check-in"}</Button>
          {d.link && <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate({ reservationId })}>Desactivar</Button>}
        </div>
      )}
      {s && s.status === "pending" && (
        <div className="space-y-2 rounded-md bg-muted/50 p-2">
          <p className="text-xs text-muted-foreground">Enviado por el huésped el {fmt(s.updatedAt)} · {s.guestCount} persona(s)</p>
          <ul className="space-y-1 text-sm">
            {s.guests.map((g, i) => (
              <li key={i} className="break-words">
                <strong>{g.displayName}</strong>
                <span className="text-xs text-muted-foreground"> · {[g.docType && g.docNumber ? `${g.docType} ${g.docNumber}` : null, g.nationality, g.birthDate].filter(Boolean).join(" · ")}</span>
                {g.missing.length > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">Falta: {g.missing.join(" ")}</span>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate({ reservationId })}>Aplicar a las fichas</Button>
            <Button size="sm" variant="outline" disabled={discard.isPending} onClick={() => discard.mutate({ reservationId })}>Descartar</Button>
          </div>
        </div>
      )}
      {s && s.status === "applied" && <p className="text-xs text-emerald-700 dark:text-emerald-400">Datos del check-in online aplicados el {fmt(s.decidedAt)}.</p>}
    </div>
  );
}
