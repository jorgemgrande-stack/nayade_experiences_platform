import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ClipboardList, Send } from "lucide-react";
import { KIND_LABEL, OPERATION_NEXT, OPERATION_STATUS_LABEL, TravelEmpty, TravelNotInstalled, isTravelNotInstalled, operationClass } from "./travelShared";

const BUCKETS = [
  { value: "pendientes", label: "Pendientes de envío" },
  { value: "en_curso", label: "En curso" },
  { value: "atencion", label: "Requieren acción" },
  { value: "consolidadas", label: "Consolidadas" },
  { value: "canceladas", label: "Canceladas" },
] as const;

function OperationDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.travel.getOperation.useQuery({ id });
  const [to, setTo] = useState("");
  const [locator, setLocator] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const refresh = () => { void utils.travel.getOperation.invalidate({ id }); void utils.travel.listOperations.invalidate(); void utils.travel.getFile.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const submit = trpc.travel.submitOperation.useMutation({ onSuccess: (r) => { toast.success(r.note); refresh(); }, onError });
  const move = trpc.travel.transitionOperation.useMutation({ onSuccess: (r) => { toast.success(`Operación: ${r.label}`); setTo(""); setReason(""); refresh(); }, onError });
  const saveNotes = trpc.travel.setOperationNotes.useMutation({ onSuccess: () => { toast.success("Notas guardadas"); refresh(); }, onError });
  const op = q.data?.operation;
  const next = op ? OPERATION_NEXT[op.status] ?? [] : [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Operación con el proveedor</DialogTitle></DialogHeader>
        {!op ? <p className="text-sm text-muted-foreground py-4">Cargando…</p> : (
          <div className="space-y-4 py-1">
            <div className="text-sm space-y-1">
              <div className="font-medium">{op.serviceTitle} <span className="text-muted-foreground font-normal">· {KIND_LABEL[op.serviceKind ?? ""] ?? op.serviceKind}</span></div>
              <div className="text-muted-foreground">{op.supplierName ?? "Sin proveedor"} · {op.fileNumber} · {op.clientName}{op.serviceDate ? ` · ${op.serviceDate}` : ""}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline" className={operationClass(op.status)}>{OPERATION_STATUS_LABEL[op.status] ?? op.status}</Badge>
                {op.providerLocator && <Badge variant="secondary">Localizador {op.providerLocator}</Badge>}
                {op.slaDeadlineAt && !["consolidated", "provider_cancelled", "internally_cancelled"].includes(op.status) && <span className="text-xs text-muted-foreground">Respuesta antes de {new Date(op.slaDeadlineAt).toLocaleString("es-ES")}</span>}
              </div>
            </div>
            {op.status === "pending_submission" && (
              <Button onClick={() => submit.mutate({ id })} disabled={submit.isPending}><Send className="h-4 w-4 mr-1" /> Marcar como enviada al proveedor</Button>
            )}
            {next.length > 0 && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Registrar respuesta</div>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger><SelectValue placeholder="Nuevo estado" /></SelectTrigger>
                  <SelectContent>{next.map((s) => <SelectItem key={s} value={s}>{OPERATION_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
                {(to === "consolidated" || to === "provider_confirmed") && <div className="space-y-1"><Label className="text-xs">Localizador del proveedor</Label><Input value={locator} maxLength={128} onChange={(e) => setLocator(e.target.value)} placeholder={op.providerLocator ?? ""} /></div>}
                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Motivo o nota (opcional)" />
                <Button size="sm" disabled={!to || move.isPending} onClick={() => move.mutate({ id, to: to as any, locator: locator.trim() ? locator.trim() : undefined, reason: reason.trim() || null })}>Guardar</Button>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Notas internas</Label>
              <Textarea rows={2} value={notes ?? op.internalNotes ?? ""} onChange={(e) => setNotes(e.target.value)} />
              {notes !== null && <Button size="sm" variant="outline" onClick={() => saveNotes.mutate({ id, notes })}>Guardar notas</Button>}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Historial</div>
              {(q.data?.history ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin cambios todavía.</p>}
              {(q.data?.history ?? []).map((h) => (
                <div key={h.id} className="text-xs border-b border-border pb-1">
                  <span className="font-medium">{OPERATION_STATUS_LABEL[h.toStatus] ?? h.toStatus}</span> · {new Date(h.createdAt).toLocaleString("es-ES")}{h.reason ? ` · ${h.reason}` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TravelOperations() {
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]["value"]>("pendientes");
  const [open, setOpen] = useState<number | null>(null);
  const q = trpc.travel.listOperations.useQuery({ bucket }, { retry: (n, e) => !isTravelNotInstalled(e) && n < 2 });
  const list = q.data ?? [];
  return (
    <AdminLayout title="Operaciones con proveedores">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6 shrink-0" /> Operaciones</h1>
          <p className="text-muted-foreground text-sm">Cada servicio reservado se gestiona con su proveedor: envío, confirmación, alternativas y localizador. La gestión es manual (correo o teléfono) y aquí queda registrada.</p>
        </div>
        <Tabs value={bucket} onValueChange={(v) => setBucket(v as typeof bucket)}>
          <TabsList className="flex-wrap h-auto">{BUCKETS.map((b) => <TabsTrigger key={b.value} value={b.value}>{b.label}</TabsTrigger>)}</TabsList>
        </Tabs>
        {isTravelNotInstalled(q.error) ? <TravelNotInstalled /> : (
          <Card>
            <CardContent className="p-0">
              {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Cargando…</p> : list.length === 0 ? (
                <TravelEmpty title="Nada en esta bandeja" text="Las operaciones nacen al convertir un expediente en reserva: una por cada servicio de proveedor." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="border-b border-border bg-muted/40 text-left"><tr><th className="p-3 font-medium">Servicio</th><th className="p-3 font-medium">Proveedor</th><th className="p-3 font-medium">Expediente</th><th className="p-3 font-medium">Fecha</th><th className="p-3 font-medium">Estado</th><th className="p-3 font-medium">Localizador</th></tr></thead>
                    <tbody>
                      {list.map((o) => (
                        <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(o.id)}>
                          <td className="p-3"><div className="font-medium">{o.serviceTitle}</div><div className="text-xs text-muted-foreground">{KIND_LABEL[o.serviceKind ?? ""] ?? o.serviceKind}</div></td>
                          <td className="p-3">{o.supplierName ?? "—"}</td>
                          <td className="p-3 text-xs"><div className="font-mono">{o.fileNumber}</div><div className="text-muted-foreground">{o.clientName}</div></td>
                          <td className="p-3 text-xs whitespace-nowrap">{o.serviceDate ?? "—"}</td>
                          <td className="p-3"><Badge variant="outline" className={operationClass(o.status)}>{OPERATION_STATUS_LABEL[o.status] ?? o.status}</Badge></td>
                          <td className="p-3 font-mono text-xs">{o.providerLocator ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {open !== null && <OperationDialog id={open} onClose={() => setOpen(null)} />}
    </AdminLayout>
  );
}
