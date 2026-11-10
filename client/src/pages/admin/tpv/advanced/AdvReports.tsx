/**
 * Informes avanzados: por turno, por operador, por arqueo, entregas y autorizaciones, con exportación CSV (separador
 * «;» y coma decimal, como los informes de caja). Los calcula el servidor (tpvAdvanced.report / exportCsv).
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { BarChart3, Download } from "lucide-react";
import { ADV_REPORT_SECTIONS, ADV_REPORT_SECTION_LABELS, AUTH_KIND_LABELS, AUTH_STATUS_LABELS, COUNT_KIND_LABELS, HANDOVER_STATUS_LABELS, type AdvReportSection } from "@shared/tpvAdvanced";
import { differenceLabel, durationLabel, formatEur, formatMadridDateTime, presetRange, toneOf } from "./advLogic";

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Table({ head, rows, right = [] }: { head: string[]; rows: ReactNode[][]; right?: number[] }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground">{head.map((h, i) => <th key={h} scope="col" className={`px-4 py-2 font-medium ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri} className="border-t border-border text-foreground">{r.map((c, ci) => <td key={ci} className={`px-4 py-2 ${right.includes(ci) ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

const diff = (d: number | null) => <StatusBadge tone={toneOf(d)}>{differenceLabel(d, formatEur)}</StatusBadge>;
const SECTIONS = ADV_REPORT_SECTIONS.filter((s) => s !== "auditoria");

export default function AdvReports() {
  const utils = trpc.useUtils();
  const initial = presetRange("mes");
  const [from, setFrom] = useState(initial.dateFrom);
  const [to, setTo] = useState(initial.dateTo);
  const [section, setSection] = useState<AdvReportSection>("turnos");
  const [registerId, setRegisterId] = useState("");
  const registers = trpc.tpv.listAllRegisters.useQuery();
  const input = { from, to, registerId: registerId ? Number(registerId) : null, section };
  const report = trpc.tpvAdvanced.report.useQuery(input);
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await utils.tpvAdvanced.exportCsv.fetch(input);
      downloadCsv(r.filename, r.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se ha podido exportar el informe."));
    } finally {
      setExporting(false);
    }
  };

  const d = report.data;
  let body: ReactNode = null;
  let empty = true;
  if (d) {
    if (section === "turnos" && d.turnos) {
      empty = d.turnos.length === 0;
      body = <Table head={["Caja", "Operador", "Inicio", "Duración", "Al empezar", "Ventas", "Efectivo", "Tarjeta", "Bizum", "Esperado", "Al acabar", "Diferencia"]} right={[4, 5, 6, 7, 8, 9, 10]}
        rows={d.turnos.map((s) => [s.register, s.operator, formatMadridDateTime(s.startedAt), durationLabel(s.minutes), formatEur(s.openingCash), `${s.sales} · ${formatEur(s.salesTotal)}`, formatEur(s.cash), formatEur(s.card), formatEur(s.bizum), formatEur(s.expectedCash), s.closingCash === null ? "En curso" : formatEur(s.closingCash), diff(s.difference)])} />;
    } else if (section === "operadores" && d.operadores) {
      empty = d.operadores.length === 0;
      body = <Table head={["Operador", "Turnos", "Tiempo", "Ventas", "Diferencia de turnos", "Entregas dadas", "Recibidas", "Diferencia al recibir", "Arqueos", "Diferencia de arqueos"]} right={[1, 3, 5, 6, 8]}
        rows={d.operadores.map((o) => [o.operator, o.shifts, durationLabel(o.minutes), `${o.sales} · ${formatEur(o.salesTotal)}`, diff(o.shiftDifference), o.handoversGiven, o.handoversReceived, diff(o.handoverDifference), o.counts, diff(o.countDifference)])} />;
    } else if (section === "arqueos" && d.arqueos) {
      empty = d.arqueos.length === 0;
      body = <Table head={["Caja", "Tipo", "Fecha", "Hecho por", "Efectivo", "Tarjeta", "Bizum", "Otros"]}
        rows={d.arqueos.map((c) => [c.register, COUNT_KIND_LABELS[c.kind], formatMadridDateTime(c.createdAt), c.createdByName ?? "—", diff(c.differences.cash), diff(c.differences.card), diff(c.differences.bizum), diff(c.differences.other)])} />;
    } else if (section === "entregas" && d.entregas) {
      empty = d.entregas.length === 0;
      body = <Table head={["Caja", "Entrega", "Recibe", "Fecha", "Declarado", "Recibido", "Estado"]} right={[4, 5]}
        rows={d.entregas.map((h) => [h.register, h.fromName, h.toName ?? "—", formatMadridDateTime(h.declaredAt), formatEur(h.declaredCash), h.receivedCash === null ? "—" : formatEur(h.receivedCash), <StatusBadge key="s" tone={h.status === "accepted" ? "success" : h.status === "disputed" ? "warning" : "neutral"}>{HANDOVER_STATUS_LABELS[h.status]}</StatusBadge>])} />;
    } else if (section === "autorizaciones" && d.autorizaciones) {
      empty = d.autorizaciones.length === 0;
      body = <Table head={["Operación", "Estado", "Pedida por", "Fecha", "Resuelta por", "Motivo"]}
        rows={d.autorizaciones.map((a) => [AUTH_KIND_LABELS[a.kind], AUTH_STATUS_LABELS[a.status], a.requestedByName, formatMadridDateTime(a.requestedAt), a.decidedByName ?? "—", a.reason])} />;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1">
          <Label htmlFor="rep-section">Informe</Label>
          <select id="rep-section" className={selectClass} value={section} onChange={(e) => setSection(e.target.value as AdvReportSection)}>
            {SECTIONS.map((s) => <option key={s} value={s}>{ADV_REPORT_SECTION_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="rep-from">Desde</Label><Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="rep-to">Hasta</Label><Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="space-y-1">
          <Label htmlFor="rep-reg">Caja</Label>
          <select id="rep-reg" className={selectClass} value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            <option value="">Todas</option>
            {(registers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={exporting || empty} aria-label={`Exportar «${ADV_REPORT_SECTION_LABELS[section]}» a CSV`}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" />{exporting ? "Preparando…" : "CSV"}
        </Button>
      </div>
      {report.isLoading ? <PanelLoading /> : report.error ? <PanelError error={report.error} onRetry={() => report.refetch()} /> : empty ? (
        <PanelEmpty icon={<BarChart3 className="w-5 h-5" />} title="Sin datos en este periodo" description="Cambia las fechas, la caja o el informe." />
      ) : body}
    </div>
  );
}
