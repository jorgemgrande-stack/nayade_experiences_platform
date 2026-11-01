/**
 * TpvReports — Informes de caja del TPV: ventas por día, categoría, producto, forma de pago, IVA y cajero; tickets
 * anulados y devoluciones; cierres de caja con descuadres. Todo se calcula en el servidor (tpv.reports.*).
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { BarChart3, Download, ExternalLink, Printer } from "lucide-react";
import {
  PERIOD_PRESETS, presetRange, validateRange, formatEur, formatPct, formatDateKey, formatMadridDateTime, type PeriodPreset,
} from "./tpvReportsLogic";

type Section = "dias" | "productos" | "categorias" | "pagos" | "iva" | "cajeros" | "anulaciones" | "cierres";

interface Filter { dateFrom: string; dateTo: string; registerId: number | null }

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  const color = tone === "bad" ? "text-danger" : tone === "good" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${color}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function ReportCard({ title, section, onExport, exporting, empty, children }: {
  title: string; section: Section; onExport: (s: Section) => void; exporting: Section | null; empty: boolean; children: ReactNode;
}) {
  const id = `tpv-informe-${section}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-card print:break-inside-avoid">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 id={id} className="text-sm font-semibold text-foreground">{title}</h2>
        <Button
          size="sm" variant="outline" disabled={empty || exporting === section}
          onClick={() => onExport(section)}
          className="gap-1.5 print:hidden"
          aria-label={`Exportar «${title}» a CSV`}
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {exporting === section ? "Preparando…" : "CSV"}
        </Button>
      </div>
      {empty ? <p className="px-4 py-6 text-sm text-muted-foreground">Sin datos en este periodo.</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

function Table({ head, rows, right = [] }: { head: string[]; rows: ReactNode[][]; right?: number[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          {head.map((h, i) => <th key={h} scope="col" className={`px-4 py-2 font-medium ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-border text-foreground">
            {r.map((c, ci) => <td key={ci} className={`px-4 py-2 ${right.includes(ci) ? "text-right tabular-nums" : ""}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TpvReports() {
  const [draft, setDraft] = useState<Filter>(() => ({ ...presetRange("mes"), registerId: null }));
  const [filter, setFilter] = useState<Filter>(draft);
  const [exporting, setExporting] = useState<Section | null>(null);
  const draftError = validateRange(draft.dateFrom, draft.dateTo);

  const utils = trpc.useUtils();
  const registersQ = trpc.tpv.reports.registers.useQuery();
  const reportQ = trpc.tpv.reports.summary.useQuery(filter, { enabled: validateRange(filter.dateFrom, filter.dateTo) === null });
  const r = reportQ.data;

  const applyPreset = (p: PeriodPreset) => {
    const next = { ...draft, ...presetRange(p) };
    setDraft(next);
    setFilter(next);
  };
  const apply = () => { if (!draftError) setFilter(draft); };

  const exportSection = async (section: Section) => {
    setExporting(section);
    try {
      const res = await utils.tpv.reports.exportCsv.fetch({ ...filter, section });
      downloadCsv(res.filename, res.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se ha podido exportar el informe."));
    } finally {
      setExporting(null);
    }
  };
  const card = { onExport: exportSection, exporting };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary" aria-hidden="true" />
              Informes de caja
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Ventas del TPV, anulaciones y cierres de caja del periodo (hora peninsular española).</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()} disabled={!r} className="gap-2">
              <Printer className="w-4 h-4" aria-hidden="true" />
              Imprimir
            </Button>
            <Link href="/admin/tpv/cajas">
              <Button variant="outline" className="gap-2">
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                Historial de cajas
              </Button>
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <form
          className="rounded-xl border border-border bg-card p-4 space-y-3 print:hidden"
          onSubmit={(e) => { e.preventDefault(); apply(); }}
          noValidate
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Periodos rápidos">
            {PERIOD_PRESETS.map((p) => (
              <Button key={p.id} type="button" size="sm" variant="outline" onClick={() => applyPreset(p.id)}>{p.label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="inf-desde">Desde</Label>
              <Input id="inf-desde" type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} className="w-44" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inf-hasta">Hasta</Label>
              <Input id="inf-hasta" type="date" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} className="w-44" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inf-caja">Caja</Label>
              <select
                id="inf-caja"
                value={draft.registerId ?? ""}
                onChange={(e) => setDraft({ ...draft, registerId: e.target.value ? Number(e.target.value) : null })}
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas las cajas</option>
                {(registersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (desactivada)"}</option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={!!draftError} className="bg-primary hover:bg-primary/90 text-primary-foreground">Ver informe</Button>
          </div>
          {draftError && <p role="alert" className="text-sm text-danger">{draftError}</p>}
        </form>

        <p className="hidden print:block text-sm text-gray-700">
          Periodo: {formatDateKey(filter.dateFrom)} – {formatDateKey(filter.dateTo)}
          {filter.registerId ? ` · Caja: ${(registersQ.data ?? []).find((c) => c.id === filter.registerId)?.name ?? ""}` : " · Todas las cajas"}
        </p>

        {reportQ.isLoading ? (
          <PanelLoading label="Calculando informe…" className="py-10" />
        ) : reportQ.isError ? (
          <PanelError error={reportQ.error} onRetry={() => reportQ.refetch()} title="No se ha podido calcular el informe" />
        ) : !r ? null : r.summary.tickets === 0 && r.voids.length === 0 && r.closures.count === 0 ? (
          <PanelEmpty
            icon={<BarChart3 className="w-6 h-6" />}
            title="No hay ventas ni cierres en este periodo"
            description="Prueba con otras fechas o con todas las cajas. El informe se llena con cada venta cobrada en el terminal de venta y con cada cierre de caja."
          >
            <Button asChild size="sm">
              <Link href="/admin/tpv">Abrir el terminal de venta</Link>
            </Button>
          </PanelEmpty>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Ventas netas" value={formatEur(r.summary.netSales)} hint={`${r.summary.tickets} tickets`} />
              <Kpi label="Ticket medio" value={formatEur(r.summary.averageTicket)} hint={`${r.summary.units} unidades vendidas`} />
              <Kpi label="IVA incluido" value={formatEur(r.summary.taxAmount)} hint={`Base ${formatEur(r.summary.taxBase)}`} />
              <Kpi label="Descuentos en ticket" value={formatEur(r.summary.ticketDiscounts)} />
              <Kpi label="Tickets anulados" value={formatEur(r.summary.voidedAmount)} hint={`${r.summary.voidedTickets} tickets`} tone={r.summary.voidedTickets ? "bad" : undefined} />
              <Kpi label="Devoluciones" value={formatEur(r.summary.refundedAmount)} hint={`${r.summary.refundedTickets} tickets`} tone={r.summary.refundedTickets ? "bad" : undefined} />
              <Kpi label="Cierres de caja" value={String(r.closures.count)} hint={`${r.closures.withDifference} con descuadre`} tone={r.closures.withDifference ? "bad" : r.closures.count ? "good" : undefined} />
              <Kpi
                label="Descuadre neto"
                value={formatEur(r.closures.netDifference)}
                hint={`Faltan ${formatEur(r.closures.shortage)} · sobran ${formatEur(r.closures.surplus)}`}
                tone={r.closures.netDifference < 0 ? "bad" : undefined}
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ReportCard title="Ventas por día" section="dias" empty={r.byDay.length === 0} {...card}>
                <Table
                  head={["Fecha", "Tickets", "Ventas netas", "Ticket medio", "Anulado"]} right={[1, 2, 3, 4]}
                  rows={r.byDay.map((d) => [formatDateKey(d.date), d.tickets, formatEur(d.netSales), formatEur(d.averageTicket), d.voidedTickets ? `${formatEur(d.voidedAmount)} (${d.voidedTickets})` : "—"])}
                />
              </ReportCard>
              <ReportCard title="Ventas por forma de pago" section="pagos" empty={r.byPaymentMethod.length === 0} {...card}>
                <Table
                  head={["Forma de pago", "Cobros", "Importe", "%"]} right={[1, 2, 3]}
                  rows={r.byPaymentMethod.map((m) => [m.label, m.payments, formatEur(m.amount), formatPct(m.share)])}
                />
              </ReportCard>
              <ReportCard title="Ventas por categoría" section="categorias" empty={r.byCategory.length === 0} {...card}>
                <Table
                  head={["Categoría", "Unidades", "Importe", "%"]} right={[1, 2, 3]}
                  rows={r.byCategory.map((c) => [c.category, c.units, formatEur(c.amount), formatPct(c.share)])}
                />
              </ReportCard>
              <ReportCard title="Desglose por IVA" section="iva" empty={r.byTaxRate.length === 0} {...card}>
                <Table
                  head={["Tipo", "Base imponible", "Cuota", "Total"]} right={[1, 2, 3]}
                  rows={r.byTaxRate.map((t) => [t.label, formatEur(t.taxBase), formatEur(t.taxAmount), formatEur(t.amount)])}
                />
                <p className="px-4 py-2 text-xs text-muted-foreground">Orientativo: los importes fiscales oficiales son los de las facturas emitidas.</p>
              </ReportCard>
              <ReportCard title="Ventas por producto" section="productos" empty={r.byProduct.length === 0} {...card}>
                <Table
                  head={["Producto", "Categoría", "Unidades", "Importe", "%"]} right={[2, 3, 4]}
                  rows={r.byProduct.map((p) => [p.product, p.category, p.units, formatEur(p.amount), formatPct(p.share)])}
                />
              </ReportCard>
              <ReportCard title="Ventas por cajero" section="cajeros" empty={r.byCashier.length === 0} {...card}>
                <Table
                  head={["Cajero", "Tickets", "Ventas netas", "Ticket medio"]} right={[1, 2, 3]}
                  rows={r.byCashier.map((c) => [c.cashier, c.tickets, formatEur(c.netSales), formatEur(c.averageTicket)])}
                />
              </ReportCard>
            </div>

            <ReportCard title="Tickets anulados y devoluciones" section="anulaciones" empty={r.voids.length === 0} {...card}>
              <Table
                head={["Ticket", "Fecha", "Estado", "Importe", "Cajero", "Caja", "Cliente"]} right={[3]}
                rows={r.voids.map((v) => [v.ticketNumber, formatDateKey(v.date), v.statusLabel, formatEur(v.amount), v.cashier, v.register, v.customer || "—"])}
              />
            </ReportCard>

            <ReportCard title="Cierres de caja" section="cierres" empty={r.closures.sessions.length === 0} {...card}>
              <Table
                head={["Caja", "Cajero", "Cierre", "Fondo inicial", "Efectivo esperado", "Efectivo contado", "Descuadre", "Tarjeta", "Bizum"]}
                right={[3, 4, 5, 6, 7, 8]}
                rows={r.closures.sessions.map((s) => [
                  s.register, s.cashier, formatMadridDateTime(s.closedAt), formatEur(s.openingAmount), formatEur(s.expectedCash), formatEur(s.countedCash),
                  <span key="d" className={Math.abs(s.difference) >= 0.01 ? (s.difference < 0 ? "text-danger font-medium" : "text-warning font-medium") : "text-success"}>
                    {Math.abs(s.difference) >= 0.01 ? formatEur(s.difference) : "Cuadrada"}
                  </span>,
                  formatEur(s.totalCard), formatEur(s.totalBizum),
                ])}
              />
            </ReportCard>
            <p className="text-xs text-muted-foreground">
              Cuentan las ventas cobradas en el periodo por su fecha de cobro. Las anuladas o devueltas se muestran aparte y no suman en las ventas netas.
              Los cierres se agrupan por la fecha en que se cerró la caja.
            </p>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
