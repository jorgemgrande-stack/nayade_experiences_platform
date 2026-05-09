import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus, FileText, Loader2, Euro, Calendar, ChevronRight,
  Printer, Trash2, CheckCircle, XCircle, X, Users,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type BatchStatus = "borrador" | "emitida" | "cobrada" | "anulada";

const STATUS_MAP: Record<BatchStatus, { label: string; cls: string }> = {
  borrador:  { label: "Borrador",  cls: "bg-gray-100 text-gray-600" },
  emitida:   { label: "Emitida",   cls: "bg-blue-50 text-blue-600" },
  cobrada:   { label: "Cobrada",   cls: "bg-green-50 text-green-700" },
  anulada:   { label: "Anulada",   cls: "bg-red-50 text-red-500" },
};

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", manual: "Manual",
};

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function BatchDetail({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: batch, isLoading } = trpc.partners.getBatch.useQuery({ id: batchId });

  const updateStatus = trpc.partners.updateBatchStatus.useMutation({
    onSuccess: () => { utils.partners.getBatch.invalidate(); utils.partners.listBatches.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteBatch = trpc.partners.deleteBatch.useMutation({
    onSuccess: () => { utils.partners.listBatches.invalidate(); onClose(); toast.success("Liquidación eliminada"); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !batch) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
      </div>
    );
  }

  const s = STATUS_MAP[batch.status as BatchStatus] ?? STATUS_MAP.borrador;
  const items = batch.items ?? [];
  const total = parseFloat(batch.totalAmount ?? "0");

  function handlePrint() {
    window.print();
  }

  return (
    <div className="h-full flex flex-col">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-foreground/[0.08] flex-shrink-0">
        <div>
          <p className="text-xs text-foreground/50 font-mono">{batch.batchNumber}</p>
          <h2 className="text-base font-semibold text-foreground">{batch.partnerFiscalName ?? batch.partnerName}</h2>
          <p className="text-xs text-foreground/50 mt-0.5">
            {batch.periodStart} – {batch.periodEnd} · {PERIOD_LABELS[batch.periodType ?? "manual"] ?? batch.periodType}
          </p>
        </div>
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground/80 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Acciones de estado */}
      <div className="px-6 py-3 border-b border-foreground/[0.05] flex items-center gap-2 flex-wrap flex-shrink-0 print:hidden">
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
        {batch.status === "borrador" && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => updateStatus.mutate({ id: batchId, status: "emitida" })}
              disabled={updateStatus.isPending}>
              <CheckCircle className="w-3.5 h-3.5" /> Emitir
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 gap-1.5"
              onClick={() => { if (confirm("¿Eliminar esta liquidación?")) deleteBatch.mutate({ id: batchId }); }}
              disabled={deleteBatch.isPending}>
              <Trash2 className="w-3.5 h-3.5" /> Eliminar
            </Button>
          </>
        )}
        {batch.status === "emitida" && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => updateStatus.mutate({ id: batchId, status: "cobrada" })}
              disabled={updateStatus.isPending}>
              <Euro className="w-3.5 h-3.5" /> Marcar cobrada
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 gap-1.5"
              onClick={() => updateStatus.mutate({ id: batchId, status: "anulada" })}
              disabled={updateStatus.isPending}>
              <XCircle className="w-3.5 h-3.5" /> Anular
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 ml-auto print:hidden"
          onClick={handlePrint}>
          <Printer className="w-3.5 h-3.5" /> Imprimir
        </Button>
      </div>

      {/* Contenido imprimible */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Info partner (visible en impresión) */}
        <div className="hidden print:block mb-6">
          <p className="text-lg font-bold">{batch.partnerFiscalName ?? batch.partnerName}</p>
          {batch.partnerNif && <p className="text-sm">NIF: {batch.partnerNif}</p>}
          {batch.partnerAddress && <p className="text-sm">{batch.partnerAddress}, {batch.partnerCity} {batch.partnerPostalCode}</p>}
          <p className="text-sm mt-2">Liquidación: <strong>{batch.batchNumber}</strong></p>
          <p className="text-sm">Período: {batch.periodStart} – {batch.periodEnd}</p>
        </div>

        {/* Tabla de items */}
        <div className="rounded-xl border border-foreground/[0.08] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-foreground/[0.03] text-foreground/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Reserva</th>
                <th className="text-left px-4 py-2.5 hidden sm:table-cell">Fecha</th>
                <th className="text-left px-4 py-2.5 hidden md:table-cell">Huésped</th>
                <th className="text-left px-4 py-2.5 hidden lg:table-cell">Actividad</th>
                <th className="text-right px-4 py-2.5">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/[0.05]">
              {items.map((item: any) => (
                <tr key={item.id} className="hover:bg-foreground/[0.02] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-foreground/60">{item.reservationNumber ?? `#${item.reservationId}`}</td>
                  <td className="px-4 py-3 text-foreground/70 hidden sm:table-cell">
                    {item.bookingDate ? new Date(item.bookingDate).toLocaleDateString("es-ES") : "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground/70 hidden md:table-cell truncate max-w-[140px]">{item.customerName ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground/70 hidden lg:table-cell truncate max-w-[160px]">{item.productName ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">
                    {parseFloat(item.amount ?? "0").toFixed(2)} €
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-foreground/[0.03]">
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-foreground/70 text-right">
                  Total liquidación
                </td>
                <td className="px-4 py-3 text-right text-base font-bold text-foreground">
                  {total.toFixed(2)} €
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {batch.notes && (
          <div className="mt-4 text-xs text-foreground/50 bg-foreground/[0.03] rounded-lg px-4 py-3">
            <span className="font-medium">Notas:</span> {batch.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal nueva liquidación ───────────────────────────────────────────────────

function NewBatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { data: partners } = trpc.partners.list.useQuery({ onlyActive: true });
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodType, setPeriodType] = useState<"weekly" | "biweekly" | "monthly" | "manual">("monthly");
  const [notes, setNotes] = useState("");

  const { data: preview, isLoading: previewLoading } = trpc.partners.getUnbilled.useQuery(
    { partnerId: partnerId!, periodStart, periodEnd },
    { enabled: !!(partnerId && periodStart && periodEnd) }
  );

  const createBatch = trpc.partners.createBatch.useMutation({
    onSuccess: (data) => {
      toast.success(`Liquidación ${data.batchNumber} creada — ${data.itemCount} reservas, ${data.total.toFixed(2)} €`);
      onCreated(data.batchId);
    },
    onError: (e) => toast.error(e.message),
  });

  const previewTotal = (preview ?? []).reduce((acc: number, r: any) => acc + (r.amountTotal ?? 0) / 100, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background border border-foreground/[0.1] rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-foreground/[0.08]">
          <h2 className="font-semibold text-foreground">Nueva liquidación</h2>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground/80"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <Label className="text-xs text-foreground/60">Partner <span className="text-red-400">*</span></Label>
            <select
              className="mt-1 w-full rounded-lg border border-foreground/[0.15] bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              value={partnerId ?? ""}
              onChange={e => setPartnerId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Seleccionar partner…</option>
              {(partners ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/60">Inicio período <span className="text-red-400">*</span></Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs text-foreground/60">Fin período <span className="text-red-400">*</span></Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="mt-1 text-sm" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-foreground/60">Tipo de período</Label>
            <select
              className="mt-1 w-full rounded-lg border border-foreground/[0.15] bg-background text-foreground text-sm px-3 py-2 focus:outline-none"
              value={periodType}
              onChange={e => setPeriodType(e.target.value as any)}
            >
              <option value="monthly">Mensual</option>
              <option value="biweekly">Quincenal</option>
              <option value="weekly">Semanal</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          {/* Preview de reservas */}
          {partnerId && periodStart && periodEnd && (
            <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-xs text-foreground/50">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando reservas…
                </div>
              ) : !preview || preview.length === 0 ? (
                <p className="text-xs text-foreground/50">Sin reservas sin liquidar en ese período.</p>
              ) : (
                <>
                  <p className="text-xs font-medium text-foreground/70 mb-2">
                    {preview.length} reserva{preview.length !== 1 ? "s" : ""} incluida{preview.length !== 1 ? "s" : ""}
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {preview.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs text-foreground/60">
                        <span className="truncate">{r.customerName} · {r.productName}</span>
                        <span className="ml-2 font-medium flex-shrink-0">{((r.amountTotal ?? 0) / 100).toFixed(2)} €</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-foreground/[0.08] mt-2 pt-2 flex items-center justify-between text-xs font-semibold text-foreground">
                    <span>Total</span>
                    <span>{previewTotal.toFixed(2)} €</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs text-foreground/60">Notas (opcional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones…" className="mt-1 text-sm" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-foreground/[0.08] flex items-center gap-3 justify-end">
          <Button variant="ghost" onClick={onClose} className="text-sm">Cancelar</Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700 text-white text-sm gap-2"
            disabled={!partnerId || !periodStart || !periodEnd || !preview?.length || createBatch.isPending}
            onClick={() => createBatch.mutate({ partnerId: partnerId!, periodType, periodStart, periodEnd, notes: notes || undefined })}
          >
            {createBatch.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Crear liquidación
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PartnerBillingManager() {
  const utils = trpc.useUtils();
  const { data: batches, isLoading } = trpc.partners.listBatches.useQuery();
  const { data: partners } = trpc.partners.list.useQuery();

  const [filterPartnerId, setFilterPartnerId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<BatchStatus | "">("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const filtered = (batches ?? []).filter(b => {
    if (filterPartnerId && b.partnerId !== filterPartnerId) return false;
    if (filterStatus && b.status !== filterStatus) return false;
    return true;
  });

  return (
    <AdminLayout title="Facturación partners">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c] print:bg-white print:text-black">

        {/* Header — oculto al imprimir */}
        <div className="px-4 sm:px-6 pt-4 pb-4 border-b border-foreground/[0.08] print:hidden">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Facturación partners</h1>
              <p className="text-xs text-foreground/50 mt-0.5">Liquidaciones agrupadas de reservas por colaborador</p>
            </div>
            <Button onClick={() => setShowNew(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
              <Plus className="w-4 h-4 mr-1.5" /> Nueva liquidación
            </Button>
          </div>
        </div>

        <div className="flex h-[calc(100vh-9rem)] print:block print:h-auto">

          {/* Lista izquierda */}
          <div className={`${selectedId ? "hidden sm:flex" : "flex"} flex-col w-full sm:w-80 lg:w-96 border-r border-foreground/[0.08] flex-shrink-0 print:hidden`}>
            {/* Filtros */}
            <div className="px-4 py-3 border-b border-foreground/[0.05] space-y-2">
              <select
                className="w-full rounded-lg border border-foreground/[0.15] bg-background text-foreground text-xs px-3 py-1.5 focus:outline-none"
                value={filterPartnerId ?? ""}
                onChange={e => setFilterPartnerId(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Todos los partners</option>
                {(partners ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                className="w-full rounded-lg border border-foreground/[0.15] bg-background text-foreground text-xs px-3 py-1.5 focus:outline-none"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as any)}
              >
                <option value="">Todos los estados</option>
                <option value="borrador">Borrador</option>
                <option value="emitida">Emitida</option>
                <option value="cobrada">Cobrada</option>
                <option value="anulada">Anulada</option>
              </select>
            </div>

            {/* Listado */}
            <div className="flex-1 overflow-y-auto divide-y divide-foreground/[0.05]">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-foreground/20" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-foreground/40">Sin liquidaciones</p>
                </div>
              ) : (
                filtered.map(batch => {
                  const s = STATUS_MAP[batch.status as BatchStatus] ?? STATUS_MAP.borrador;
                  const active = selectedId === batch.id;
                  return (
                    <button
                      key={batch.id}
                      onClick={() => setSelectedId(batch.id)}
                      className={`w-full text-left px-4 py-3.5 transition-colors ${active ? "bg-orange-500/10" : "hover:bg-foreground/[0.03]"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-foreground/50">{batch.batchNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${s.cls}`}>{s.label}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground mt-0.5 truncate">{batch.partnerFiscalName ?? batch.partnerName}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-foreground/50 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {batch.periodStart} – {batch.periodEnd}
                        </span>
                        <span className="text-xs font-semibold text-foreground/70 ml-auto flex items-center gap-0.5">
                          <Euro className="w-3 h-3" /> {parseFloat(batch.totalAmount ?? "0").toFixed(2)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Panel derecho */}
          <div className="flex-1 overflow-hidden print:w-full">
            {selectedId ? (
              <BatchDetail batchId={selectedId} onClose={() => setSelectedId(null)} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center print:hidden">
                <FileText className="w-10 h-10 text-foreground/20 mb-3" />
                <p className="text-sm text-foreground/40">Selecciona una liquidación para ver el detalle</p>
                <Button variant="outline" className="mt-4 gap-2 text-sm" onClick={() => setShowNew(true)}>
                  <Plus className="w-4 h-4" /> Nueva liquidación
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showNew && (
        <NewBatchModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); setSelectedId(id); utils.partners.listBatches.invalidate(); }}
        />
      )}
    </AdminLayout>
  );
}
