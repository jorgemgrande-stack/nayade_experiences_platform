/**
 * Aplazamientos y Fraccionamientos — Gestoría e Impuestos (Fase 6).
 *
 * Registra aplazamientos de obligaciones ante la AEAT, genera el calendario
 * de cuotas y permite registrar los pagos parciales.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, RefreshCw } from "lucide-react";
import { MODEL_NAME, eur } from "./taxLabels";

const DEFERRAL_STATUS: Record<string, string> = {
  solicitado: "Solicitado", concedido: "Concedido", denegado: "Denegado", fraccionado: "Fraccionado",
};

export default function GestoriaAplazamientos() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedObligationId, setSelectedObligationId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });
  const deferralsQ = trpc.gestoria.deferrals.list.useQuery({ year });
  const detailQ = trpc.gestoria.deferrals.get.useQuery(
    { obligationId: selectedObligationId ?? 0 },
    { enabled: selectedObligationId != null },
  );

  const [form, setForm] = useState({
    obligationId: "", principal: "", interestRate: "", installmentCount: "1",
    firstDueDate: "", requestedAt: new Date().toISOString().slice(0, 10),
    status: "solicitado",
  });

  const createMut = trpc.gestoria.deferrals.create.useMutation({
    onSuccess: () => {
      toast.success("Aplazamiento registrado");
      setForm({ ...form, obligationId: "", principal: "", interestRate: "", installmentCount: "1", firstDueDate: "" });
      utils.gestoria.deferrals.list.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const payMut = trpc.gestoria.deferrals.payInstallment.useMutation({
    onSuccess: () => {
      toast.success("Cuota marcada como pagada");
      utils.gestoria.deferrals.get.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];
  const obligations = obligationsQ.data ?? [];
  const deferrals = deferralsQ.data ?? [];
  // Obligaciones aplazables: sin aplazamiento previo y no pagadas/cerradas.
  const deferrable = obligations.filter(
    (o) => !o.deferralId && o.status !== "pagado" && o.status !== "cerrado",
  );

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarClock className="w-6 h-6 text-primary" /> Aplazamientos y Fraccionamientos
            </h1>
            <p className="text-sm text-muted-foreground">Aplazamientos de obligaciones ante la AEAT</p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Nuevo aplazamiento */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Nuevo aplazamiento</h2>
          <div>
            <Label className="text-xs">Obligación a aplazar</Label>
            <Select value={form.obligationId} onValueChange={(v) => setForm({ ...form, obligationId: v })}>
              <SelectTrigger><SelectValue placeholder="Selecciona una obligación…" /></SelectTrigger>
              <SelectContent>
                {deferrable.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {(MODEL_NAME[o.model] ?? o.model).split(" · ")[0]} · {o.periodLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {deferrable.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">No hay obligaciones aplazables en este ejercicio.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Importe a aplazar (€)</Label>
              <Input type="number" step="0.01" value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs">Nº de cuotas</Label>
              <Input type="number" min="1" max="60" value={form.installmentCount}
                onChange={(e) => setForm({ ...form, installmentCount: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Interés (%)</Label>
              <Input type="number" step="0.01" value={form.interestRate}
                onChange={(e) => setForm({ ...form, interestRate: e.target.value })} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Fecha 1.ª cuota</Label>
              <Input type="date" value={form.firstDueDate}
                onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Fecha de solicitud</Label>
              <Input type="date" value={form.requestedAt}
                onChange={(e) => setForm({ ...form, requestedAt: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEFERRAL_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => {
              if (!form.obligationId || !form.principal || !form.firstDueDate) {
                toast.error("Selecciona obligación, importe y fecha de la primera cuota");
                return;
              }
              createMut.mutate({
                obligationId: Number(form.obligationId),
                status: form.status as "solicitado" | "concedido" | "denegado" | "fraccionado",
                requestedAt: form.requestedAt || undefined,
                principal: form.principal,
                interestRate: form.interestRate || undefined,
                installmentCount: Number(form.installmentCount) || 1,
                firstDueDate: form.firstDueDate,
              });
            }}
            disabled={createMut.isPending}
            className="gap-2"
          >
            {createMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
            Registrar aplazamiento
          </Button>
        </div>

        {/* Aplazamientos existentes */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Aplazamientos del ejercicio</h2>
          {deferrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin aplazamientos registrados.</p>
          ) : (
            <div className="space-y-1.5">
              {deferrals.map((r) => (
                <button
                  key={r.deferral.id}
                  onClick={() => setSelectedObligationId(
                    selectedObligationId === r.deferral.obligationId ? null : r.deferral.obligationId)}
                  className="w-full text-left flex items-center justify-between text-sm border-b border-border/50 last:border-0 pb-1.5 last:pb-0 hover:bg-foreground/[0.03]"
                >
                  <div>
                    <div className="text-foreground/80">
                      {r.obligation ? `${(MODEL_NAME[r.obligation.model] ?? r.obligation.model).split(" · ")[0]} · ${r.obligation.periodLabel}` : "Obligación"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {DEFERRAL_STATUS[r.deferral.status] ?? r.deferral.status} · {r.deferral.installmentCount} cuota(s)
                    </div>
                  </div>
                  <span className="text-foreground/70">{eur(r.deferral.principal)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Calendario de cuotas del aplazamiento seleccionado */}
          {selectedObligationId != null && detailQ.data && (
            <div className="mt-3 border-t border-border pt-3">
              <h3 className="text-xs font-semibold text-foreground/70 mb-1.5">Calendario de cuotas</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left py-1">Cuota</th>
                    <th className="text-left py-1">Vencimiento</th>
                    <th className="text-right py-1">Importe</th>
                    <th className="text-right py-1">Interés</th>
                    <th className="text-left py-1 pl-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQ.data.installments.map((i) => (
                    <tr key={i.id} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 text-foreground/80">{i.number}</td>
                      <td className="py-1.5 text-foreground/70">{i.dueDate}</td>
                      <td className="py-1.5 text-right text-foreground/80">{eur(i.amount)}</td>
                      <td className="py-1.5 text-right text-foreground/60">{eur(i.interest)}</td>
                      <td className="py-1.5 pl-3">
                        {i.status === "pagada" ? (
                          <span className="text-xs text-emerald-400 font-medium">Pagada</span>
                        ) : (
                          <Button
                            size="sm" variant="outline"
                            className="h-6 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => payMut.mutate({ installmentId: i.id })}
                            disabled={payMut.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3" /> Pagar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
