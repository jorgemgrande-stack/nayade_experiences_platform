/**
 * Ski Net · Alquiler — Taller (/admin/ski/taller): órdenes abiertas y cerradas. Entra al taller una unidad disponible
 * o con incidencia (nunca una alquilada: antes se registra su devolución); al cerrar la orden vuelve a disponible,
 * sigue con incidencia o se retira.
 */
import { useState } from "react";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { SkiRentalShell, UNIT_STATUS_LABEL, rentalErrorMessage, toastRental, type RentalCtx } from "@/components/ski/SkiRentalShell";

function NewTicket({ ctx }: { ctx: RentalCtx }) {
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [lookup, setLookup] = useState<string | null>(null);
  const scan = trpc.skiRental.scanUnit.useQuery({ siteId: ctx.siteId, code: lookup ?? "" }, { enabled: !!lookup, retry: false });
  const open = trpc.skiRental.openTicket.useMutation({
    onSuccess: () => {
      toast.success("Unidad en el taller");
      setCode("");
      setReason("");
      setLookup(null);
      utils.skiRental.listTickets.invalidate();
      utils.skiRental.listModels.invalidate();
    },
    onError: toastRental,
  });
  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (scan.data) open.mutate({ siteId: ctx.siteId, unitId: scan.data.unit.id, reason });
        else if (code.trim()) setLookup(code.trim());
      }}
    >
      <p className="text-sm font-medium text-foreground">Enviar una unidad al taller</p>
      <div className="flex flex-wrap items-end gap-2">
        <FormField id="wk-code" label="Código">
          <Input
            id="wk-code"
            className="w-48 font-mono"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setLookup(null);
            }}
            autoComplete="off"
          />
        </FormField>
        {scan.data && (
          <FormField id="wk-reason" label="Motivo" required>
            <Input id="wk-reason" className="w-64" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
          </FormField>
        )}
        <Button type="submit" disabled={open.isPending}>
          {scan.data ? "Enviar al taller" : "Buscar"}
        </Button>
      </div>
      {lookup && scan.error && <p className="text-sm text-destructive">{rentalErrorMessage(scan.error)}</p>}
      {scan.data && (
        <p className="text-xs text-muted-foreground">
          {scan.data.model?.name} · {UNIT_STATUS_LABEL[scan.data.unit.status]}
        </p>
      )}
    </form>
  );
}

function Tickets({ ctx, status }: { ctx: RentalCtx; status: "open" | "done" }) {
  const utils = trpc.useUtils();
  const q = trpc.skiRental.listTickets.useQuery({ siteId: ctx.siteId, status });
  const [resolution, setResolution] = useState<Record<number, "available" | "incident" | "retired">>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const close = trpc.skiRental.closeTicket.useMutation({
    onSuccess: () => {
      toast.success("Orden cerrada");
      utils.skiRental.listTickets.invalidate();
      utils.skiRental.listModels.invalidate();
    },
    onError: toastRental,
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (q.data!.length === 0)
    return status === "open" ? (
      <PanelEmpty icon={<Wrench className="h-5 w-5" />} title="Nada en el taller" description="Envía una unidad escaneando su código; también puedes hacerlo desde el inventario." />
    ) : (
      <p className="text-sm text-muted-foreground">Sin órdenes cerradas todavía.</p>
    );
  const RES = { available: "Vuelve a disponible", incident: "Sigue con incidencia", retired: "Se retira" } as const;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {q.data!.map((t) => (
        <li key={t.id} className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words text-sm text-foreground">
              <span className="font-mono">{t.code}</span> · {t.modelName} · {t.reason}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString("es-ES")}</span>
          </div>
          {t.status === "done" ? (
            <p className="break-words text-xs text-muted-foreground">
              <Badge variant="outline">{t.resolution ? RES[t.resolution] : "Cerrada"}</Badge> {t.notes ?? ""}
            </p>
          ) : (
            ctx.canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Resultado" className={`${selectClass} w-52`} value={resolution[t.id] ?? "available"} onChange={(e) => setResolution({ ...resolution, [t.id]: e.target.value as "available" })}>
                  {(Object.keys(RES) as Array<keyof typeof RES>).map((k) => (
                    <option key={k} value={k}>
                      {RES[k]}
                    </option>
                  ))}
                </select>
                <Input aria-label="Notas" placeholder="Notas del trabajo" className="w-64" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} maxLength={500} />
                <Button size="sm" disabled={close.isPending} onClick={() => close.mutate({ siteId: ctx.siteId, ticketId: t.id, resolution: resolution[t.id] ?? "available", notes: notes[t.id] || null })}>
                  Cerrar orden
                </Button>
              </div>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

export default function SkiRentalWorkshop() {
  const [tab, setTab] = useState<"open" | "done">("open");
  return (
    <SkiRentalShell title="Taller" description="Mantenimiento del material: lo que está en el taller y cómo sale.">
      {(ctx) => (
        <div className="space-y-4">
          {ctx.canWrite && <NewTicket ctx={ctx} />}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Órdenes">
            {(["open", "done"] as const).map((t) => (
              <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
                {t === "open" ? "Abiertas" : "Cerradas"}
              </Button>
            ))}
          </div>
          <Tickets ctx={ctx} status={tab} />
        </div>
      )}
    </SkiRentalShell>
  );
}
