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
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { EconomySummary } from "@/pages/admin/accounting/shared/EconomyUi";
import { BarChart3, Download, ExternalLink, Printer, Receipt, Percent, Tag, Ban, Undo2, Lock, Scale, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanySites } from "@/hooks/useCompanySites";
import { TpvConsolidated } from "./TpvBusiness";
import {
  PERIOD_PRESETS, presetRange, validateRange, formatEur, formatPct, formatDateKey, formatMadridDateTime, type PeriodPreset,
} from "./tpvReportsLogic";

type Section = "dias" | "productos" | "categorias" | "pagos" | "iva" | "cajeros" | "anulaciones" | "cierres";

interface Filter { dateFrom: string; dateTo: string; registerId: number | null; siteId?: string | null }

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

function ReportCard({ title, section, onExport, exporting, empty, children }: {
  title: string; section: Section; onExport: (s: Section) => void; exporting: Section | null; empty: boolean; children: ReactNode;
}) {
  const id = `tpv-informe-${section}`;
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm print:break-inside-avoid">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <h2 id={id} className="text-sm font-semibold text-foreground">{title}</h2>
        <Button
          size="sm" variant="outline" disabled={empty || exporting === section}
          onClick={() => onExport(section)}
          className="h-9 gap-1.5 print:hidden"
          aria-label={`Exportar «${title}» a CSV`}
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {exporting === section ? "Preparando…" : "CSV"}
        </Button>
      </div>
      {empty ? <p className="px-4 py-6 text-sm text-muted-foreground">Sin datos en este periodo.</p> : children}
    </section>
  );
}

/** Barra de reparto (porcentaje 0–100) con su cifra: se lee de un vistazo qué pesa más. */
function ShareBar({ value }: { value: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-flex w-full min-w-[5.5rem] items-center justify-end gap-2">
      <span className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted sm:inline-block" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
      </span>
      <span className="tabular-nums">{formatPct(value)}</span>
    </span>
  );
}

/** Tabla con cabecera fija; por debajo de 768 px, tarjetas (la primera columna es el título). */
function Table({ head, rows, right = [], caption }: { head: string[]; rows: ReactNode[][]; right?: number[]; caption: string }) {
  const [, ...restHead] = head;
  return (
    <>
      <div className="hidden max-h-[28rem] overflow-auto md:block print:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground shadow-[0_1px_0_0_var(--border)]">
            <tr className="text-left">
              {head.map((h, i) => <th key={h} scope="col" className={cn("whitespace-nowrap px-4 py-2.5 font-medium", right.includes(i) && "text-right")}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, ri) => (
              <tr key={ri} className="text-foreground hover:bg-muted/40">
                {r.map((c, ci) => <td key={ci} className={cn("px-4 py-2.5", right.includes(ci) && "whitespace-nowrap text-right tabular-nums")}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden print:hidden" aria-label={caption}>
        {rows.map((r, ri) => (
          <li key={ri} className="space-y-1.5 p-4 text-sm">
            <div className="break-words font-medium text-foreground">{r[0]}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {restHead.map((h, i) => (
                <div key={h} className="min-w-0">
                  <dt className="text-muted-foreground">{h}</dt>
                  <dd className="break-words text-foreground tabular-nums">{r[i + 1]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TpvReports() {
  const [draft, setDraft] = useState<Filter>(() => ({ ...presetRange("mes"), registerId: null }));
  const [filter, setFilter] = useState<Filter>(draft);
  const [exporting, setExporting] = useState<Section | null>(null);
  const draftError = validateRange(draft.dateFrom, draft.dateTo);

  const utils = trpc.useUtils();
  const registersQ = trpc.tpv.reports.registers.useQuery();
  // Varias sedes (Business): filtro por sede (con una sola sede, o en Essential, no se muestra ni se envía)
  const companySites = useCompanySites();
  const query = companySites.enabled && filter.siteId ? filter : { ...filter, siteId: undefined };
  // Informes por caja, por empleado y por periodo: Business o superior (el servidor lo decide; aquí se explica)
  const planQ = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const detailed = planQ.data ? (planQ.data.plan?.features.detailedReports ?? true) : null;
  const consolidatedOn = planQ.data?.plan?.features.consolidatedReports ?? false;
  const reportQ = trpc.tpv.reports.summary.useQuery(query, { enabled: detailed === true && validateRange(filter.dateFrom, filter.dateTo) === null });
  const r = reportQ.data;

  const applyPreset = (p: PeriodPreset) => {
    const next = { ...draft, ...presetRange(p) };
    setDraft(next);
    setFilter(next);
  };
  const apply = () => { if (!draftError) setFilter(draft); };
  const isPresetActive = (p: PeriodPreset) => {
    const range = presetRange(p);
    return draft.dateFrom === range.dateFrom && draft.dateTo === range.dateTo;
  };

  const exportSection = async (section: Section) => {
    setExporting(section);
    try {
      const res = await utils.tpv.reports.exportCsv.fetch({ ...query, section });
      downloadCsv(res.filename, res.csv);
    } catch (e) {
      toast.error(errorMessage(e, "No se ha podido exportar el informe."));
    } finally {
      setExporting(null);
    }
  };
  const card = { onExport: exportSection, exporting };

  if (detailed === false) {
    return (
      <AdminLayout>
        <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
          <PanelPageHeader
            className="mb-0"
            icon={<BarChart3 />}
            title="Informes de caja"
            description="Ventas por cajero, anulaciones, cierres con su descuadre y exportación a CSV."
          />
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
            <div className="relative space-y-3">
              <p className="text-sm text-foreground">Los informes por caja, por empleado y por periodo forman parte del plan Business: ventas por cajero, anulaciones, cierres con su descuadre y exportación a CSV, del periodo que elijas.</p>
              <p className="text-sm text-muted-foreground">Con tu plan tienes el resumen del día y el historial de todas las sesiones de caja en «Cajas».</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild variant="outline"><Link href="/admin/tpv/cajas">Ver el resumen del día</Link></Button>
                <Button asChild><Link href="/admin/suscripcion">Ver planes</Link></Button>
              </div>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        {consolidatedOn && <TpvConsolidated dateFrom={filter.dateFrom} dateTo={filter.dateTo} />}
        <PanelPageHeader
          className="mb-0"
          icon={<BarChart3 />}
          title="Informes de caja"
          description="Ventas en caja, anulaciones y cierres de caja del periodo (hora peninsular española)."
          actions={
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="outline" onClick={() => window.print()} disabled={!r} className="gap-2">
                <Printer className="w-4 h-4" aria-hidden="true" />
                Imprimir
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link href="/admin/tpv/cajas">
                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  Historial de cajas
                </Link>
              </Button>
            </div>
          }
        />

        {/* Filtros */}
        <form
          aria-label="Filtros del informe"
          className="space-y-4 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4 print:hidden"
          onSubmit={(e) => { e.preventDefault(); apply(); }}
          noValidate
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />Periodo
            </span>
            <div role="group" aria-label="Periodos rápidos" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-muted/50 p-1">
              {PERIOD_PRESETS.map((p) => {
                const on = isPresetActive(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => applyPreset(p.id)}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
            <div className="space-y-1">
              <Label htmlFor="inf-desde" className="text-xs text-muted-foreground">Desde</Label>
              <Input id="inf-desde" type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inf-hasta" className="text-xs text-muted-foreground">Hasta</Label>
              <Input id="inf-hasta" type="date" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inf-caja" className="text-xs text-muted-foreground">Caja</Label>
              <select
                id="inf-caja"
                value={draft.registerId ?? ""}
                onChange={(e) => setDraft({ ...draft, registerId: e.target.value ? Number(e.target.value) : null })}
                className={selectCls}
              >
                <option value="">Todas las cajas</option>
                {(registersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (desactivada)"}</option>
                ))}
              </select>
            </div>
            {companySites.enabled && (
              <div className="space-y-1">
                <Label htmlFor="inf-sede" className="text-xs text-muted-foreground">Sede</Label>
                <select
                  id="inf-sede"
                  value={draft.siteId ?? ""}
                  onChange={(e) => setDraft({ ...draft, siteId: e.target.value || null })}
                  className={selectCls}
                >
                  <option value="">Todas las sedes</option>
                  {companySites.sites.map((s) => (
                    <option key={s.siteId} value={s.siteId}>{s.name}{s.status === "archived" ? " (desactivada)" : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" disabled={!!draftError}>Ver informe</Button>
          </div>
          {draftError && <p role="alert" className="text-sm text-danger">{draftError}</p>}
        </form>

        <p className="hidden print:block text-sm text-gray-700">
          Periodo: {formatDateKey(filter.dateFrom)} – {formatDateKey(filter.dateTo)}
          {filter.registerId ? ` · Caja: ${(registersQ.data ?? []).find((c) => c.id === filter.registerId)?.name ?? ""}` : " · Todas las cajas"}
          {query.siteId ? ` · Sede: ${companySites.nameOf(query.siteId)}` : ""}
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
            <EconomySummary className="print:break-inside-avoid">
              <MetricCard icon={<Receipt />} tone="brand" label="Ventas netas" value={formatEur(r.summary.netSales)} detail={`${r.summary.tickets} tickets · ticket medio ${formatEur(r.summary.averageTicket)}`} hint={`${r.summary.units} unidades vendidas`} />
              <MetricCard icon={<Percent />} tone="neutral" label="IVA incluido" value={formatEur(r.summary.taxAmount)} detail={`Base ${formatEur(r.summary.taxBase)}`} />
              <MetricCard icon={<Tag />} tone="neutral" label="Descuentos en ticket" value={formatEur(r.summary.ticketDiscounts)} />
              <MetricCard icon={<Ban />} tone={r.summary.voidedTickets ? "danger" : "neutral"} label="Tickets anulados" value={formatEur(r.summary.voidedAmount)} detail={`${r.summary.voidedTickets} tickets`} />
              <MetricCard icon={<Undo2 />} tone={r.summary.refundedTickets ? "danger" : "neutral"} label="Devoluciones" value={formatEur(r.summary.refundedAmount)} detail={`${r.summary.refundedTickets} tickets`} />
              <MetricCard icon={<Lock />} tone={r.closures.withDifference ? "danger" : r.closures.count ? "success" : "neutral"} label="Cierres de caja" value={r.closures.count} detail={`${r.closures.withDifference} con descuadre`} />
              <MetricCard
                icon={<Scale />}
                tone={r.closures.netDifference < 0 ? "danger" : "neutral"}
                label="Descuadre neto"
                value={formatEur(r.closures.netDifference)}
                detail={`Faltan ${formatEur(r.closures.shortage)} · sobran ${formatEur(r.closures.surplus)}`}
              />
            </EconomySummary>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <ReportCard title="Ventas por día" section="dias" empty={r.byDay.length === 0} {...card}>
                <Table
                  caption="Ventas por día"
                  head={["Fecha", "Tickets", "Ventas netas", "Ticket medio", "Anulado"]} right={[1, 2, 3, 4]}
                  rows={r.byDay.map((d) => [formatDateKey(d.date), d.tickets, formatEur(d.netSales), formatEur(d.averageTicket), d.voidedTickets ? `${formatEur(d.voidedAmount)} (${d.voidedTickets})` : "—"])}
                />
              </ReportCard>
              <ReportCard title="Ventas por forma de pago" section="pagos" empty={r.byPaymentMethod.length === 0} {...card}>
                <Table
                  caption="Ventas por forma de pago"
                  head={["Forma de pago", "Cobros", "Importe", "%"]} right={[1, 2, 3]}
                  rows={r.byPaymentMethod.map((m) => [m.label, m.payments, formatEur(m.amount), <ShareBar key="s" value={m.share} />])}
                />
              </ReportCard>
              <ReportCard title="Ventas por categoría" section="categorias" empty={r.byCategory.length === 0} {...card}>
                <Table
                  caption="Ventas por categoría"
                  head={["Categoría", "Unidades", "Importe", "%"]} right={[1, 2, 3]}
                  rows={r.byCategory.map((c) => [c.category, c.units, formatEur(c.amount), <ShareBar key="s" value={c.share} />])}
                />
              </ReportCard>
              <ReportCard title="Desglose por IVA" section="iva" empty={r.byTaxRate.length === 0} {...card}>
                <Table
                  caption="Desglose por IVA"
                  head={["Tipo", "Base imponible", "Cuota", "Total"]} right={[1, 2, 3]}
                  rows={r.byTaxRate.map((t) => [t.label, formatEur(t.taxBase), formatEur(t.taxAmount), formatEur(t.amount)])}
                />
                <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Orientativo: los importes fiscales oficiales son los de las facturas emitidas.</p>
              </ReportCard>
              <ReportCard title="Ventas por producto" section="productos" empty={r.byProduct.length === 0} {...card}>
                <Table
                  caption="Ventas por producto"
                  head={["Producto", "Categoría", "Unidades", "Importe", "%"]} right={[2, 3, 4]}
                  rows={r.byProduct.map((p) => [p.product, p.category, p.units, formatEur(p.amount), <ShareBar key="s" value={p.share} />])}
                />
              </ReportCard>
              <ReportCard title="Ventas por cajero" section="cajeros" empty={r.byCashier.length === 0} {...card}>
                <Table
                  caption="Ventas por cajero"
                  head={["Cajero", "Tickets", "Ventas netas", "Ticket medio"]} right={[1, 2, 3]}
                  rows={r.byCashier.map((c) => [c.cashier, c.tickets, formatEur(c.netSales), formatEur(c.averageTicket)])}
                />
              </ReportCard>
            </div>

            <ReportCard title="Tickets anulados y devoluciones" section="anulaciones" empty={r.voids.length === 0} {...card}>
              <Table
                caption="Tickets anulados y devoluciones"
                head={["Ticket", "Fecha", "Estado", "Importe", "Cajero", "Caja", "Cliente"]} right={[3]}
                rows={r.voids.map((v) => [v.ticketNumber, formatDateKey(v.date), v.statusLabel, formatEur(v.amount), v.cashier, v.register, v.customer || "—"])}
              />
            </ReportCard>

            <ReportCard title="Cierres de caja" section="cierres" empty={r.closures.sessions.length === 0} {...card}>
              <Table
                caption="Cierres de caja"
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
