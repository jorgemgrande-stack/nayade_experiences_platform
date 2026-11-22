/**
 * Diálogo «Exportar para la gestoría»: elige un mes, un trimestre o un rango de fechas y descarga un ZIP con
 * el PDF de cada factura y abono emitidos en el periodo y el libro de facturas emitidas (CSV), que incluye
 * los tickets de caja (facturas simplificadas).
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
import { isEmptyExport, isEmptyExportMessage, madridDayKey, resolveExportPeriod, suggestedExportQuarter, type GestoriaExportPeriod } from "@shared/gestoriaExportPeriod";

import { useI18n } from "@/i18n/I18nProvider";
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
  const { t, format } = useI18n();
  const monthName = (i: number) => { const n = format.date(new Date(2000, i, 1), { month: "long" }); return n.charAt(0).toUpperCase() + n.slice(1); };
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
        toast.warning(t("crmInvoices.noHayFacturasNi", { label: res.period.label }));
        return;
      }
      downloadBase64(res.fileName, res.mimeType, res.contentBase64);
      const what = t("crmInvoices.resumenFacturasAbonosTickets", { invoices: res.invoices, creditNotes: res.creditNotes, tickets: res.tickets });
      if (res.missingPdfs.length) {
        toast.warning(t("crmInvoices.descargadoFaltanPdfFiguran", { what, length: res.missingPdfs.length }));
      } else {
        toast.success(t("crmInvoices.descargadoDe", { what, label: res.period.label }));
      }
      onOpenChange(false);
    } catch (e) {
      // Periodo sin documentos: el servidor lo rechaza sin montar nada; es un aviso, no un fallo
      const message = (e as { message?: unknown })?.message;
      if (isEmptyExportMessage(message)) toast.warning(message as string);
      else toastError(e, "No se pudo preparar la exportación");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("crmInvoices.exportarParaLaGestoria")}</DialogTitle>
          <DialogDescription>{t("crmInvoices.unArchivoZipCon")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2" role="radiogroup" aria-label={t("crmInvoices.tipoDePeriodo")}>
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
                <Label htmlFor="gx-year">{t("crmInvoices.ano")}</Label>
                <select id="gx-year" className={selectClass} value={year} onChange={(e) => { touched.current = true; setYear(Number(e.target.value)); }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {kind === "quarter" ? (
                <div className="space-y-1">
                  <Label htmlFor="gx-quarter">{t("crmInvoices.trimestre")}</Label>
                  <select id="gx-quarter" className={selectClass} value={quarter} onChange={(e) => { touched.current = true; setQuarter(Number(e.target.value)); }}>
                    <option value={1}>{t("crmInvoices.n1ErTrimestreEne")}</option>
                    <option value={2}>{t("crmInvoices.n2TrimestreAbrJun")}</option>
                    <option value={3}>{t("crmInvoices.n3ErTrimestreJul")}</option>
                    <option value={4}>{t("crmInvoices.n4TrimestreOctDic")}</option>
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="gx-month">{t("crmInvoices.mes")}</Label>
                  <select id="gx-month" className={selectClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i)}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="gx-from">{t("crmInvoices.desde")}</Label>
                <Input id="gx-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gx-to">{t("crmInvoices.hasta")}</Label>
                <Input id="gx-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}

          <p className={`text-sm ${invalid ? "text-red-500" : "text-foreground/60"}`} aria-live="polite">
            {invalid || t("crmInvoices.seIncluiranLasFacturas", { label })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("crmInvoices.cancelar")}</Button>
          <Button onClick={handleExport} disabled={busy || !!invalid}>
            {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            {busy ? t("crmInvoices.preparando") : t("crmInvoices.descargarZip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
