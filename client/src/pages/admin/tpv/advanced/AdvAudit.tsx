/**
 * Auditoría de operaciones: registro cronológico unificado (aperturas, cierres, ventas, anulaciones, movimientos,
 * correcciones, turnos, entregas, arqueos y autorizaciones), filtrable por periodo, tipo, caja y persona, con CSV.
 * Solo lectura: lo construye el servidor (tpvAdvanced.audit) leyendo las tablas del TPV y las de TPV Advanced.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { Download, ScrollText } from "lucide-react";
import { AUDIT_TYPES, AUDIT_TYPE_LABELS, type AuditType } from "@shared/tpvAdvanced";
import { formatEur, formatMadridDateTime, presetRange } from "./advLogic";
import { downloadCsv } from "./AdvReports";

export default function AdvAudit() {
  const utils = trpc.useUtils();
  const initial = presetRange("7dias");
  const [from, setFrom] = useState(initial.dateFrom);
  const [to, setTo] = useState(initial.dateTo);
  const [type, setType] = useState<AuditType | "">("");
  const [registerId, setRegisterId] = useState("");
  const [actor, setActor] = useState("");
  const registers = trpc.tpv.listAllRegisters.useQuery();
  const query = { from, to, registerId: registerId ? Number(registerId) : null, types: type ? [type] : undefined, actor: actor.trim() || null };
  const audit = trpc.tpvAdvanced.audit.useQuery(query);
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await utils.tpvAdvanced.exportCsv.fetch({ from, to, registerId: query.registerId, section: "auditoria" });
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se ha podido exportar."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1"><Label htmlFor="au-from">Desde</Label><Input id="au-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="au-to">Hasta</Label><Input id="au-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="space-y-1">
          <Label htmlFor="au-type">Tipo</Label>
          <select id="au-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as AuditType | "")}>
            <option value="">Todos</option>
            {AUDIT_TYPES.map((t) => <option key={t} value={t}>{AUDIT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="au-reg">Caja</Label>
          <select id="au-reg" className={selectClass} value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            <option value="">Todas</option>
            {(registers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="au-actor">Persona</Label><Input id="au-actor" value={actor} maxLength={100} onChange={(e) => setActor(e.target.value)} placeholder="Nombre" /></div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={exporting}><Download className="w-3.5 h-3.5" aria-hidden="true" />{exporting ? "Preparando…" : "CSV"}</Button>
      </div>
      {audit.isLoading ? <PanelLoading /> : audit.error ? <PanelError error={audit.error} onRetry={() => audit.refetch()} /> : audit.data!.events.length === 0 ? (
        <PanelEmpty icon={<ScrollText className="w-5 h-5" />} title="Sin operaciones en este periodo" description="Cambia las fechas o los filtros." />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          {audit.data!.truncated && <p className="px-4 py-2 text-xs text-muted-foreground">Se muestran las 2.000 más recientes: acota el periodo o los filtros para ver el resto.</p>}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="px-4 py-2 font-medium">Fecha</th><th scope="col" className="px-4 py-2 font-medium">Operación</th><th scope="col" className="px-4 py-2 font-medium">Caja</th><th scope="col" className="px-4 py-2 font-medium">Persona</th><th scope="col" className="px-4 py-2 font-medium text-right">Importe</th><th scope="col" className="px-4 py-2 font-medium">Detalle</th></tr></thead>
            <tbody>
              {audit.data!.events.map((e) => (
                <tr key={e.ref} className="border-t border-border text-foreground">
                  <td className="px-4 py-2 whitespace-nowrap">{formatMadridDateTime(e.at)}</td>
                  <td className="px-4 py-2">{AUDIT_TYPE_LABELS[e.type]}</td>
                  <td className="px-4 py-2">{e.registerName ?? "—"}</td>
                  <td className="px-4 py-2">{e.actor ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.amount === null ? "—" : formatEur(e.amount)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
