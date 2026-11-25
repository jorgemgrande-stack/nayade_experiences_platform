/**
 * Piezas comunes de los informes sectoriales de Elephant Net: barra de periodo y sede, indicadores, tablas con scroll
 * propio, barras horizontales (tema claro y oscuro) y descarga de CSV.
 */
import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BarChart3, Download, TriangleAlert } from "lucide-react";
import { MetricCard } from "@/components/admin/PanelVisual";

export const eur = (cents: number) => (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export const pct = (bp: number) => `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
export const num = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface Period { from: string; to: string; siteId?: string }

/** Periodo (últimos 30 días por defecto) y sede; con `siteRequired`, se elige siempre una sede (Ski Net). */
export function usePeriod(siteRequired = false) {
  const t = today();
  const [from, setFrom] = useState(addDays(t, -29));
  const [to, setTo] = useState(t);
  const [siteId, setSiteId] = useState<string>("");
  const sitesQ = trpc.sites.list.useQuery(undefined, { retry: false });
  const sites = (sitesQ.data?.sites ?? []).filter((s) => s.status === "active");
  const effectiveSite = siteId || (siteRequired ? sitesQ.data?.primarySiteId ?? "" : "");
  const valid = from <= to && (!siteRequired || !!effectiveSite);
  const value: Period = { from, to, ...(effectiveSite ? { siteId: effectiveSite } : {}) };
  const bar = (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="space-y-1"><Label className="text-sm">Desde</Label><Input type="date" className="h-10 w-full sm:w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-sm">Hasta</Label><Input type="date" className="h-10 w-full sm:w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
      {(sites.length > 1 || siteRequired) && (
        <div className="space-y-1">
          <Label className="text-sm">Sede</Label>
          <Select value={effectiveSite || "all"} onValueChange={(v) => setSiteId(v === "all" ? "" : v)}>
            <SelectTrigger className="h-10 w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {!siteRequired && <SelectItem value="all">Todas las sedes</SelectItem>}
              {sites.map((s) => <SelectItem key={s.siteId} value={s.siteId}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {from > to && <span role="alert" className="flex items-center gap-1 pb-2 text-sm text-danger"><TriangleAlert className="h-4 w-4" aria-hidden="true" />La fecha inicial debe ser anterior a la final.</span>}
    </div>
  );
  return { value, valid, bar };
}

export function Kpis({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((k) => (
        <MetricCard key={k.label} compact tone="brand" icon={<BarChart3 />} label={k.label} value={k.value} detail={k.hint} />
      ))}
    </div>
  );
}

/** Descarga un CSV ya generado por el servidor. */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CsvButton({ load }: { load: () => Promise<{ fileName: string; csv: string }> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" className="h-10" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await load();
        if (!r.csv) toast.info("No hay datos que exportar en este periodo.");
        else downloadCsv(r.fileName, r.csv);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo exportar");
      } finally {
        setBusy(false);
      }
    }}><Download className="h-4 w-4 mr-1" /> CSV</Button>
  );
}

export interface Column<T> { title: string; cell: (row: T) => ReactNode; right?: boolean }

/** Bloque de informe: título, CSV y tabla (con scroll horizontal propio) o estado vacío. */
export function ReportTable<T>({ title, rows, columns, empty, csv, bar }: {
  title: string; rows: readonly T[]; columns: Column<T>[]; empty: string; csv?: () => Promise<{ fileName: string; csv: string }>;
  /** Barra proporcional opcional (valor numérico por fila) para leer el reparto de un vistazo. */
  bar?: (row: T) => number;
}) {
  const max = bar ? Math.max(1, ...rows.map(bar)) : 1;
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {csv && rows.length > 0 && <CsvButton load={csv} />}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">{empty}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="border-b border-border bg-muted/40 text-left">
                <tr>{columns.map((c) => <th key={c.title} className={`p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${c.right ? "text-right" : ""}`}>{c.title}</th>)}{bar && <th className="p-2.5 w-40" />}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                    {columns.map((c) => <td key={c.title} className={`p-2.5 ${c.right ? "text-right whitespace-nowrap tabular-nums" : ""}`}>{c.cell(r)}</td>)}
                    {bar && (
                      <td className="p-2">
                        <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.round((bar(r) / max) * 100)}%` }} /></div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportError({ error }: { error: { message: string } }) {
  return (
    <Card className="border-danger/40 bg-danger/5">
      <CardContent role="alert" className="flex items-start gap-2 p-4 text-sm text-danger sm:p-6"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error.message}</CardContent>
    </Card>
  );
}
