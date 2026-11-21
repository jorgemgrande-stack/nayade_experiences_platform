/**
 * Diálogo «Emitir abono» (factura rectificativa) de una factura emitida.
 * Total: abona lo que quede pendiente. Parcial: líneas elegidas, por unidades o por importe con IVA.
 * La vista previa (base, IVA por tipo y total) la calcula el servidor con las mismas reglas con las que
 * emite (crm.invoices.creditNotePreview), así que lo que se ve es lo que se emite. El motivo es
 * obligatorio y la suma de abonos nunca supera lo facturado: lo comprueba también el servidor.
 * La factura original no se modifica; el abono lleva su propio número correlativo.
 */
import React, { useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { RefreshCw, RotateCcw } from "lucide-react";
import {
  buildCreditNoteSelection,
  emptyLineDraft,
  formatEur,
  validateCreditNoteReason,
  type CreditNoteLineDraft,
  type CreditNoteMode,
} from "@shared/creditNoteForm";

import { useI18n } from "@/i18n/I18nProvider";
const EUR2: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
export interface CreditNoteLineView {
  itemIndex: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  taxRate: number | null;
  credited: number;
  remaining: number;
}

export interface CreditNotePreviewView {
  subtotal: number;
  taxAmount: number;
  total: number;
  taxBreakdown: { rate: number; base: number; amount: number }[];
  closesInvoice: boolean;
  remainingAfter: number;
}

export interface CreditNoteContextView {
  invoice: { invoiceNumber: string; clientName: string | null; total: number; credited: number; remaining: number };
  lines: CreditNoteLineView[];
  previous: { invoiceNumber: string; total: number; reason: string }[];
}

const taxLabel = (rate: number | null) => (rate === null ? "Sin IVA" : `IVA ${rate} %`);
const abs = (n: number) => Math.abs(n);

/** Contenido del diálogo, sin datos del servidor: lo que se ve con un contexto, una selección y su vista previa. */
export function CreditNoteForm(props: {
  context: CreditNoteContextView;
  mode: CreditNoteMode;
  onModeChange: (m: CreditNoteMode) => void;
  drafts: Record<number, CreditNoteLineDraft>;
  onDraftChange: (itemIndex: number, patch: Partial<CreditNoteLineDraft>) => void;
  reason: string;
  onReasonChange: (r: string) => void;
  lineErrors: Record<string, string>;
  /** Por qué no se puede emitir todavía (selección incompleta o regla del servidor). */
  problem: string | null;
  reasonError: string | null;
  preview: CreditNotePreviewView | null;
  previewLoading?: boolean;
}) {
  const { t, format } = useI18n();
  const { context, mode, drafts, preview } = props;
  const { invoice } = context;
  const fieldClass = "bg-foreground/[0.05] border-foreground/[0.15] text-white";
  return (
    <div className="space-y-4 py-2 text-sm">
      <div className="rounded-lg border border-foreground/[0.12] p-3 space-y-1" data-testid="resumen-factura">
        <p className="text-white font-medium">{t("crmInvoices.factura", { invoiceNumber: invoice.invoiceNumber })}
          {invoice.clientName ? <span className="text-foreground/60 font-normal"> · {invoice.clientName}</span> : null}
        </p>
        <p className="text-foreground/65">{t("crmInvoices.facturadoYaAbonado", { formatEur: format.currency(invoice.total, "EUR", EUR2), formatEur2: format.currency(invoice.credited, "EUR", EUR2) })}{" "}<span className="text-white">{t("crmInvoices.pendienteDeAbonar", { formatEur: format.currency(invoice.remaining, "EUR", EUR2) })}</span>
        </p>
        {context.previous.length > 0 && (
          <ul className="text-xs text-foreground/50 pt-1">
            {context.previous.map((p) => (
              <li key={p.invoiceNumber}>{t("crmInvoices.abono3", { invoiceNumber: p.invoiceNumber, formatEur: format.currency(p.total, "EUR", EUR2), v: p.reason ? ` — ${p.reason}` : "" })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-foreground/65 text-xs mb-1.5">{t("crmInvoices.queQuieresAbonar")}</legend>
        <label className="flex items-center gap-2 text-white cursor-pointer">
          <input type="radio" name="modo-abono" value="total" checked={mode === "total"} onChange={() => props.onModeChange("total")} />{t("crmInvoices.todoLoPendiente", { formatEur: format.currency(invoice.remaining, "EUR", EUR2) })}</label>
        <label className="flex items-center gap-2 text-white cursor-pointer">
          <input type="radio" name="modo-abono" value="partial" checked={mode === "partial"} onChange={() => props.onModeChange("partial")} />{t("crmInvoices.soloUnaParteElige")}</label>
      </fieldset>

      {mode === "partial" && (
        <div className="space-y-2" data-testid="lineas-abono">
          {context.lines.map((l) => {
            const d = drafts[l.itemIndex] ?? emptyLineDraft(l);
            const done = !(l.remaining > 0);
            const err = props.lineErrors[`line${l.itemIndex}`];
            return (
              <div key={l.itemIndex} className={`rounded-lg border p-3 ${d.selected ? "border-violet-500/50 bg-violet-500/[0.06]" : "border-foreground/[0.12]"}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={d.selected}
                    disabled={done}
                    onChange={(e) => props.onDraftChange(l.itemIndex, { selected: e.target.checked })}
                    aria-label={t("crmInvoices.abonar", { description: l.description })}
                  />
                  <span className="flex-1">
                    <span className="block text-white">{l.description}</span>
                    <span className="block text-xs text-foreground/55">
                      {t("crmInvoices.total2", { quantity: l.quantity, formatEur: format.currency(l.unitPrice, "EUR", EUR2), taxLabel: taxLabel(l.taxRate), formatEur2: format.currency(l.total, "EUR", EUR2) })}
                      {l.credited > 0 ? t("crmInvoices.yaAbonado", { formatEur: format.currency(l.credited, "EUR", EUR2) }) : ""}
                      {done ? t("crmInvoices.abonadaPorCompleto") : t("crmInvoices.puedesAbonarHasta", { formatEur: format.currency(l.remaining, "EUR", EUR2) })}
                    </span>
                  </span>
                </label>
                {d.selected && (
                  <div className="flex items-center gap-2 mt-2 pl-6">
                    <select
                      className={`rounded-md border px-2 py-1.5 text-sm ${fieldClass}`}
                      value={d.by}
                      onChange={(e) => props.onDraftChange(l.itemIndex, { by: e.target.value as CreditNoteLineDraft["by"], value: e.target.value === "quantity" ? String(l.quantity) : String(l.remaining) })}
                      aria-label={t("crmInvoices.abonarPor")}
                    >
                      <option value="quantity">{t("crmInvoices.unidades")}</option>
                      <option value="amount">{t("crmInvoices.importeConIva")}</option>
                    </select>
                    <Input
                      inputMode="decimal"
                      className={`w-28 ${fieldClass}`}
                      value={d.value}
                      onChange={(e) => props.onDraftChange(l.itemIndex, { value: e.target.value })}
                      aria-label={d.by === "quantity" ? t("crmInvoices.unidadesAAbonar") : t("crmInvoices.importeAAbonar")}
                    />
                    <span className="text-xs text-foreground/50">{d.by === "quantity" ? t("crmInvoices.de", { quantity: l.quantity }) : "€"}</span>
                  </div>
                )}
                {err ? <p className="text-xs text-red-400 mt-1 pl-6">{err}</p> : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-foreground/[0.12] p-3" data-testid="vista-previa">
        <p className="text-foreground/65 text-xs mb-2">{t("crmInvoices.vistaPreviaDelAbono")}</p>
        {preview ? (
          <table className="w-full text-sm">
            <tbody>
              {preview.taxBreakdown.map((b) => (
                <tr key={b.rate} className="text-foreground/75">
                  <td>{t("crmInvoices.baseAl", { rate: b.rate })}</td>
                  <td className="text-right">{format.currency(abs(b.base), "EUR", EUR2)}</td>
                  <td className="text-right pl-3">{t("crmInvoices.iva2", { rate: b.rate })}</td>
                  <td className="text-right">{format.currency(abs(b.amount), "EUR", EUR2)}</td>
                </tr>
              ))}
              <tr className="text-foreground/75 border-t border-foreground/[0.1]">
                <td>{t("crmInvoices.baseImponible")}</td>
                <td className="text-right">{format.currency(abs(preview.subtotal), "EUR", EUR2)}</td>
                <td className="text-right pl-3">{t("crmInvoices.totalIva")}</td>
                <td className="text-right">{format.currency(abs(preview.taxAmount), "EUR", EUR2)}</td>
              </tr>
              <tr className="text-white font-semibold">
                <td colSpan={3}>{t("crmInvoices.totalDelAbono")}</td>
                <td className="text-right">−{format.currency(abs(preview.total), "EUR", EUR2)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-foreground/50">{props.previewLoading ? t("crmInvoices.calculando") : t("crmInvoices.eligeQueAbonarPara")}</p>
        )}
        {preview && (
          <p className="text-xs text-foreground/50 mt-2">
            {preview.closesInvoice
              ? t("crmInvoices.conEsteAbonoLa")
              : t("crmInvoices.despuesDeEsteAbono", { formatEur: format.currency(preview.remainingAfter, "EUR", EUR2) })}
          </p>
        )}
        {props.problem ? <p className="text-xs text-red-400 mt-2" role="alert">{props.problem}</p> : null}
      </div>

      <div>
        <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmInvoices.motivoDelAbono")}</Label>
        <Textarea
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          placeholder={t("crmInvoices.ejDevolucionDeUna")}
          className={`${fieldClass} placeholder:text-foreground/40 resize-none`}
          rows={2}
        />
        {props.reasonError ? <p className="text-xs text-red-400 mt-1">{props.reasonError}</p> : null}
      </div>
      <p className="text-xs text-foreground/50">{t("crmInvoices.seEmitiraUnaFactura")}</p>
    </div>
  );
}

/** Retrasa un valor para no pedir la vista previa en cada pulsación. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function CreditNoteDialog({ invoiceId, onClose, onIssued }: { invoiceId: number | null; onClose: () => void; onIssued?: () => void }) {
  const { t, format } = useI18n();
  const [mode, setMode] = useState<CreditNoteMode>("total");
  const [drafts, setDrafts] = useState<Record<number, CreditNoteLineDraft>>({});
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    setMode("total");
    setDrafts({});
    setReason("");
    setSubmitted(false);
  }, [invoiceId]);

  const open = invoiceId !== null;
  const ctx = trpc.crm.invoices.creditNotePreview.useQuery({ invoiceId: invoiceId ?? 0 }, { enabled: open });
  const lines = ctx.data?.lines ?? [];
  const selection = useMemo(() => buildCreditNoteSelection(mode, lines, drafts), [mode, lines, drafts]);
  const partialLines = mode === "partial" && selection.ok ? selection.lines : undefined;
  const debouncedLines = useDebounced(partialLines, 300);
  const partial = trpc.crm.invoices.creditNotePreview.useQuery(
    { invoiceId: invoiceId ?? 0, lines: debouncedLines },
    { enabled: open && mode === "partial" && !!debouncedLines?.length, placeholderData: keepPreviousData },
  );

  const current = mode === "total" ? ctx.data : partialLines ? partial.data : undefined;
  const preview = current?.preview ?? null;
  const serverProblem = current?.error ?? null;
  const selectionProblem = selection.ok ? null : selection.message;
  const reasonError = submitted ? validateCreditNoteReason(reason) : null;
  const stale = mode === "partial" && JSON.stringify(debouncedLines) !== JSON.stringify(partialLines);

  const issue = trpc.crm.invoices.createCreditNote.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmInvoices.abonoEmitido", { creditNoteNumber: data.creditNoteNumber }));
      utils.crm.invoices.listAll.invalidate();
      utils.crm.invoices.creditNotePreview.invalidate();
      onIssued?.();
      onClose();
    },
    onError: (e) => toastError(e),
  });

  const canSubmit = !!preview && !serverProblem && selection.ok && !stale && !issue.isPending;
  const submit = () => {
    setSubmitted(true);
    if (validateCreditNoteReason(reason) || !selection.ok || !canSubmit || invoiceId === null) return;
    issue.mutate({ invoiceId, reason: reason.trim(), ...(selection.lines ? { lines: selection.lines } : {}) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-[#0d1526] border-foreground/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-violet-400" />{" "}{t("crmInvoices.emitirAbono")}</DialogTitle>
        </DialogHeader>
        {ctx.isLoading ? (
          <p className="text-sm text-foreground/60 py-6 text-center">{t("crmInvoices.cargandoLaFactura")}</p>
        ) : ctx.error ? (
          <p className="text-sm text-red-400 py-6 text-center">{t("crmInvoices.noSeHaPodido")}</p>
        ) : ctx.data ? (
          <CreditNoteForm
            context={ctx.data}
            mode={mode}
            onModeChange={setMode}
            drafts={drafts}
            onDraftChange={(i, patch) => setDrafts((ds) => ({ ...ds, [i]: { ...(ds[i] ?? emptyLineDraft(lines.find((l) => l.itemIndex === i) ?? { quantity: 1 })), ...patch } }))}
            reason={reason}
            onReasonChange={setReason}
            lineErrors={selection.ok ? {} : selection.errors}
            problem={serverProblem ?? selectionProblem}
            reasonError={reasonError}
            preview={stale ? null : preview}
            previewLoading={stale || partial.isFetching}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit} className="bg-violet-600 hover:bg-violet-700 text-white">
            {issue.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}{t("crmInvoices.emitirAbono")}{preview ? t("crmInvoices.de2", { formatEur: format.currency(abs(preview.total), "EUR", EUR2) }) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
