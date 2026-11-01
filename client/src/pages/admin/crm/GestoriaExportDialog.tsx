/**
 * Diálogo «Exportar para la gestoría»: elige un mes, un trimestre o un rango de fechas y descarga un ZIP con
 * el PDF de cada factura y abono emitidos en el periodo y el libro de facturas emitidas (CSV).
 * Las fechas son las de Madrid; el servidor prepara el fichero con los documentos tal como se emitieron.
 */
import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { Download, RefreshCw } from "lucide-react";
import { isEmptyExport, madridDayKey, resolveExportPeriod, suggestedExportQuarter, type GestoriaExportPeriod } from "@shared/gestoriaExportPeriod";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

function downloadBase64(fileName: string, mimeType: string, contentBase64: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GestoriaExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const today = madridDayKey(new Date());
  const thisYear = Number(today.slice(0, 4));
  // Propuesta: el trimestre en curso o, si aún no tiene facturas, el último que sí las tiene
  const latest = trpc.crm.invoices.listAll.useQuery({ limit: 1, offset: 0 }, { enabled: open, staleTime: 60_000 });
  const initial = suggestedExportQuarter(new Date(), null);
  const [kind, setKind] = useState<GestoriaExportPeriod["kind"]>("quarter");
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState(initial.quarter);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !latest.data) return;
    const s = suggestedExportQuarter(new Date(), latest.data.items[0]?.issuedAt ?? null);
    setYear(s.year);
    setQuarter(s.quarter);
  }, [latest.data]);
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();

  const period: GestoriaExportPeriod =
    kind === "month" ? { kind, year, month } : kind === "quarter" ? { kind, year, quarter } : { kind, from, to };
  let label = "";
  let invalid = "";
  try {
    label = resolveExportPeriod(period).label;
  } catch (e) {
    invalid = (e as Error).message;
  }
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  async function handleExport() {
    if (invalid) return;
    setBusy(true);
    try {
      const res = await utils.crm.invoices.exportForGestoria.fetch(period, { staleTime: 0, gcTime: 0 });
      if (isEmptyExport(res)) {
        // Un ZIP vacío no sirve a la gestoría: se avisa y no se descarga nada
        toast.warning(`No hay facturas ni abonos emitidos en ${res.period.label}. Elige otro periodo.`);
        return;
      }
      downloadBase64(res.fileName, res.mimeType, res.contentBase64);
      const what = `${res.invoices} ${res.invoices === 1 ? "factura" : "facturas"} y ${res.creditNotes} ${res.creditNotes === 1 ? "abono" : "abonos"}`;
      if (res.missingPdfs.length) {
        toast.warning(`Descargado (${what}). Faltan ${res.missingPdfs.length} PDF: figuran en el libro y en LEEME.txt; descárgalos uno a uno.`);
      } else {
        toast.success(`Descargado: ${what} de ${res.period.label}.`);
      }
      onOpenChange(false);
    } catch (e) {
      toastError(e, "No se pudo preparar la exportación");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar para la gestoría</DialogTitle>
          <DialogDescription>
            Un archivo ZIP con el PDF de cada factura y abono emitidos en el periodo y el libro de facturas emitidas, listo para enviar a tu gestoría.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2" role="radiogroup" aria-label="Tipo de periodo">
            {([["quarter", "Trimestre"], ["month", "Mes"], ["range", "Fechas"]] as const).map(([k, text]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  kind === k ? "bg-orange-600 text-white border-orange-600" : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12] hover:bg-foreground/[0.08]"
                }`}
              >
                {text}
              </button>
            ))}
          </div>

          {kind !== "range" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="gx-year">Año</Label>
                <select id="gx-year" className={selectClass} value={year} onChange={(e) => { touched.current = true; setYear(Number(e.target.value)); }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {kind === "quarter" ? (
                <div className="space-y-1">
                  <Label htmlFor="gx-quarter">Trimestre</Label>
                  <select id="gx-quarter" className={selectClass} value={quarter} onChange={(e) => { touched.current = true; setQuarter(Number(e.target.value)); }}>
                    <option value={1}>1.er trimestre (ene-mar)</option>
                    <option value={2}>2.º trimestre (abr-jun)</option>
                    <option value={3}>3.er trimestre (jul-sep)</option>
                    <option value={4}>4.º trimestre (oct-dic)</option>
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="gx-month">Mes</Label>
                  <select id="gx-month" className={selectClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="gx-from">Desde</Label>
                <Input id="gx-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gx-to">Hasta</Label>
                <Input id="gx-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}

          <p className={`text-sm ${invalid ? "text-red-500" : "text-foreground/60"}`} aria-live="polite">
            {invalid || `Se incluirán las facturas y abonos emitidos en ${label} (fechas de España peninsular).`}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={handleExport} disabled={busy || !!invalid} className="bg-orange-600 hover:bg-orange-700 text-white">
            {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            {busy ? "Preparando…" : "Descargar ZIP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
