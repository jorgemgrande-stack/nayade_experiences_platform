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
  const fieldClass = "border-input bg-background text-foreground";
  const creditedPct = invoice.total > 0 ? Math.min(100, Math.max(0, Math.round((invoice.credited / invoice.total) * 100))) : 0;
  const modeOption = (value: CreditNoteMode, label: string) => (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
        mode === value ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/50"
      }`}
    >
      <input type="radio" name="modo-abono" value={value} checked={mode === value} onChange={() => props.onModeChange(value)} className="h-4 w-4 accent-primary" />
      <span className="font-medium">{label}</span>
    </label>
  );
  return (
    <div className="space-y-5 py-2 text-sm">
      <section className="space-y-2.5 rounded-xl border border-border bg-muted/40 p-4" data-testid="resumen-factura">
        <p className="font-semibold text-foreground">{t("crmInvoices.factura", { invoiceNumber: invoice.invoiceNumber })}
          {invoice.clientName ? <span className="font-normal text-muted-foreground"> · {invoice.clientName}</span> : null}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-warning" style={{ width: `${creditedPct}%` }} />
        </div>
        <p className="text-muted-foreground">{t("crmInvoices.facturadoYaAbonado", { formatEur: format.currency(invoice.total, "EUR", EUR2), formatEur2: format.currency(invoice.credited, "EUR", EUR2) })}{" "}<span className="font-medium text-foreground">{t("crmInvoices.pendienteDeAbonar", { formatEur: format.currency(invoice.remaining, "EUR", EUR2) })}</span>
        </p>
        {context.previous.length > 0 && (
          <ul className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
            {context.previous.map((p) => (
              <li key={p.invoiceNumber}>{t("crmInvoices.abono3", { invoiceNumber: p.invoiceNumber, formatEur: format.currency(p.total, "EUR", EUR2), v: p.reason ? ` — ${p.reason}` : "" })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("crmInvoices.queQuieresAbonar")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modeOption("total", t("crmInvoices.todoLoPendiente", { formatEur: format.currency(invoice.remaining, "EUR", EUR2) }))}
          {modeOption("partial", t("crmInvoices.soloUnaParteElige"))}
        </div>
      </fieldset>

      {mode === "partial" && (
        <div className="space-y-2" data-testid="lineas-abono">
          {context.lines.map((l) => {
            const d = drafts[l.itemIndex] ?? emptyLineDraft(l);
            const done = !(l.remaining > 0);
            const err = props.lineErrors[`line${l.itemIndex}`];
            return (
              <div key={l.itemIndex} className={`rounded-lg border p-3 ${d.selected ? "border-primary/50 bg-primary/5" : "border-border"} ${done ? "opacity-60" : ""}`}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={d.selected}
                    disabled={done}
                    onChange={(e) => props.onDraftChange(l.itemIndex, { selected: e.target.checked })}
                    aria-label={t("crmInvoices.abonar", { description: l.description })}
                  />
                  <span className="flex-1">
                    <span className="block font-medium text-foreground">{l.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("crmInvoices.total2", { quantity: l.quantity, formatEur: format.currency(l.unitPrice, "EUR", EUR2), taxLabel: taxLabel(l.taxRate), formatEur2: format.currency(l.total, "EUR", EUR2) })}
                      {l.credited > 0 ? t("crmInvoices.yaAbonado", { formatEur: format.currency(l.credited, "EUR", EUR2) }) : ""}
                      {done ? t("crmInvoices.abonadaPorCompleto") : t("crmInvoices.puedesAbonarHasta", { formatEur: format.currency(l.remaining, "EUR", EUR2) })}
                    </span>
                  </span>
                </label>
                {d.selected && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                    <select
                      className={`h-9 rounded-md border px-2 text-sm ${fieldClass}`}
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
                    <span className="text-xs text-muted-foreground">{d.by === "quantity" ? t("crmInvoices.de", { quantity: l.quantity }) : "€"}</span>
                  </div>
                )}
                {err ? <p className="mt-1.5 pl-6 text-xs font-medium text-danger">{err}</p> : null}
              </div>
            );
          })}
        </div>
      )}

      <section className="rounded-xl border border-danger/30 bg-danger/5 p-4" data-testid="vista-previa">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("crmInvoices.vistaPreviaDelAbono")}</p>
        {preview ? (
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {preview.taxBreakdown.map((b) => (
                <tr key={b.rate} className="text-muted-foreground">
                  <td>{t("crmInvoices.baseAl", { rate: b.rate })}</td>
                  <td className="text-right">{format.currency(abs(b.base), "EUR", EUR2)}</td>
                  <td className="pl-3 text-right">{t("crmInvoices.iva2", { rate: b.rate })}</td>
                  <td className="text-right">{format.currency(abs(b.amount), "EUR", EUR2)}</td>
                </tr>
              ))}
              <tr className="border-t border-border text-muted-foreground">
                <td className="pt-1">{t("crmInvoices.baseImponible")}</td>
                <td className="pt-1 text-right">{format.currency(abs(preview.subtotal), "EUR", EUR2)}</td>
                <td className="pl-3 pt-1 text-right">{t("crmInvoices.totalIva")}</td>
                <td className="pt-1 text-right">{format.currency(abs(preview.taxAmount), "EUR", EUR2)}</td>
              </tr>
              <tr className="text-base font-semibold text-danger">
                <td colSpan={3} className="pt-2">{t("crmInvoices.totalDelAbono")}</td>
                <td className="pt-2 text-right">−{format.currency(abs(preview.total), "EUR", EUR2)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-muted-foreground">{props.previewLoading ? t("crmInvoices.calculando") : t("crmInvoices.eligeQueAbonarPara")}</p>
        )}
        {preview && (
          <p className="mt-2 text-xs text-muted-foreground">
            {preview.closesInvoice
              ? t("crmInvoices.conEsteAbonoLa")
              : t("crmInvoices.despuesDeEsteAbono", { formatEur: format.currency(preview.remainingAfter, "EUR", EUR2) })}
          </p>
        )}
        {props.problem ? <p className="mt-2 text-xs font-medium text-danger" role="alert">{props.problem}</p> : null}
      </section>

      <div>
        <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("crmInvoices.motivoDelAbono")}</Label>
        <Textarea
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          placeholder={t("crmInvoices.ejDevolucionDeUna")}
          className={`${fieldClass} resize-none placeholder:text-muted-foreground`}
          rows={2}
        />
        {props.reasonError ? <p className="mt-1 text-xs font-medium text-danger">{props.reasonError}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("crmInvoices.seEmitiraUnaFactura")}</p>
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger/10 text-danger"><RotateCcw className="h-4 w-4" aria-hidden="true" /></span>{" "}{t("crmInvoices.emitirAbono")}</DialogTitle>
        </DialogHeader>
        {ctx.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("crmInvoices.cargandoLaFactura")}</p>
        ) : ctx.error ? (
          <p className="py-6 text-center text-sm font-medium text-danger">{t("crmInvoices.noSeHaPodido")}</p>
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
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t border-border bg-background px-6 py-4 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose}>{t("crmInvoices.cancelar")}</Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit}>
            {issue.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}{t("crmInvoices.emitirAbono")}{preview ? t("crmInvoices.de2", { formatEur: format.currency(abs(preview.total), "EUR", EUR2) }) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
