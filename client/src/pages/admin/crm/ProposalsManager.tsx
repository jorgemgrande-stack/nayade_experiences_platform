import React, { useState, useEffect } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { trpc } from "@/lib/trpc";
import { PanelPageHeader, StatusBadge as PanelStatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { SegmentedTabs } from "@/components/admin/PanelVisual";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Send,
  Eye,
  Trash2,
  FileText,
  RefreshCw,
  Copy,
  ArrowUpRight,
  Pencil,
  CheckCircle,
  X,
  ChevronDown,
} from "lucide-react";
import { CatalogConceptSelector, type CatalogProduct, type SourceType } from "@/components/CatalogConceptSelector";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ProposalStatus = "borrador" | "enviado" | "visualizado" | "aceptado" | "rechazado" | "expirado";

// Tono por significado (no color fijo): borrador/expirado neutros, enviado informa, visualizado avisa
const STATUS_TONE: Record<ProposalStatus, Tone> = {
  borrador: "neutral",
  enviado: "info",
  visualizado: "warning",
  aceptado: "success",
  rechazado: "danger",
  expirado: "neutral",
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const { t } = useI18n();
  const known = status in STATUS_TONE;
  return <PanelStatusBadge tone={known ? STATUS_TONE[status] : "neutral"}>{t(`crmProposals.status.${known ? status : "borrador"}`)}</PanelStatusBadge>;
}

// ─── Item row component ────────────────────────────────────────────────────────

type ItemLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isOptional?: boolean;
  fiscalRegime?: "reav" | "general";
  taxRate?: number;
  sourceType?: SourceType;
  sourceId?: number;
};

function ItemsEditor({
  items,
  onChange,
}: {
  items: ItemLine[];
  onChange: (items: ItemLine[]) => void;
}) {
  const { t, format } = useI18n();
  function addItem() {
    onChange([...items, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general", taxRate: 21 }]);
  }
  function updateItem(idx: number, patch: Partial<ItemLine>) {
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const next = { ...item, ...patch };
      next.total = next.quantity * next.unitPrice;
      return next;
    });
    onChange(updated);
  }
  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function handleSelectProduct(idx: number, p: CatalogProduct) {
    const unitPrice = Number(p.basePrice) || 0;
    const fiscalRegime = p.fiscalRegime === "reav" ? "reav" : "general";
    const taxRate = Number(p.taxRate ?? 21);
    const sourceType: SourceType = p.productType === "experience" ? "experience" : "legoPack";
    updateItem(idx, { description: p.title, unitPrice, total: unitPrice * items[idx].quantity, fiscalRegime, taxRate, sourceType, sourceId: p.id });
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="hidden sm:grid grid-cols-[1fr_100px_72px_88px_72px_28px] gap-x-2 text-xs text-foreground/40 px-1 mb-0.5">
          <div>{t("crmProposals.items.description")}</div>
          <div className="text-center">{t("crmProposals.items.regime")}</div>
          <div className="text-center">{t("crmProposals.items.qtyShort")}</div>
          <div className="text-right">{t("crmProposals.items.unitPrice")}</div>
          <div className="text-right">{t("crmProposals.items.total")}</div>
          <div />
        </div>
      )}
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2 space-y-2 sm:space-y-0 sm:p-0 sm:border-0 sm:bg-transparent">
            {/* Fila 1: descripción + delete (mobile) / grid completo (desktop) */}
            <div className="flex items-start gap-2 sm:hidden">
              <div className="flex-1">
                <CatalogConceptSelector
                  value={item.description}
                  onChange={(v) => updateItem(idx, { description: v, sourceType: "manual", sourceId: undefined })}
                  onSelectProduct={(p) => handleSelectProduct(idx, p)}
                  sourceType={item.sourceType}
                  sourceId={item.sourceId}
                  inputClassName="h-8 text-xs"
                  showBadge
                />
              </div>
              <button type="button" onClick={() => removeItem(idx)} className="text-destructive hover:text-destructive/80 mt-1 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Fila 2 mobile: régimen + cant + precio + total */}
            <div className="grid grid-cols-4 gap-1 sm:hidden">
              <select
                className="col-span-2 w-full bg-background border border-input text-xs rounded-md px-1 py-1.5 h-8"
                value={item.fiscalRegime === "reav" ? "reav" : item.taxRate === 10 ? "general_10" : "general"}
                onChange={(e) => updateItem(idx, {
                  fiscalRegime: e.target.value === "reav" ? "reav" : "general",
                  taxRate: e.target.value === "general_10" ? 10 : e.target.value === "reav" ? 0 : 21,
                  sourceType: "manual",
                })}
              >
                <option value="general">{t("crmProposals.items.vat21")}</option>
                <option value="general_10">{t("crmProposals.items.vat10")}</option>
                <option value="reav">{t("crmProposals.items.reav")}</option>
              </select>
              <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, { quantity: Number(e.target.value) })} className="h-8 text-xs text-center" />
              <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={e => updateItem(idx, { unitPrice: Number(e.target.value) })} className="h-8 text-xs text-right" />
            </div>
            {/* Layout desktop: grid en una sola fila */}
            <div className="hidden sm:grid grid-cols-[1fr_100px_72px_88px_72px_28px] gap-x-2 items-center mb-1.5">
              <div>
                <CatalogConceptSelector
                  value={item.description}
                  onChange={(v) => updateItem(idx, { description: v, sourceType: "manual", sourceId: undefined })}
                  onSelectProduct={(p) => handleSelectProduct(idx, p)}
                  sourceType={item.sourceType}
                  sourceId={item.sourceId}
                  inputClassName="h-8 text-xs"
                  showBadge
                />
              </div>
              <select
                className="w-full bg-background border border-input text-xs rounded-md px-1 py-1.5 h-8"
                value={item.fiscalRegime === "reav" ? "reav" : item.taxRate === 10 ? "general_10" : "general"}
                onChange={(e) => updateItem(idx, {
                  fiscalRegime: e.target.value === "reav" ? "reav" : "general",
                  taxRate: e.target.value === "general_10" ? 10 : e.target.value === "reav" ? 0 : 21,
                  sourceType: "manual",
                })}
              >
                <option value="general">{t("crmProposals.items.vat21")}</option>
                <option value="general_10">{t("crmProposals.items.vat10")}</option>
                <option value="reav">{t("crmProposals.items.reav")}</option>
              </select>
              <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, { quantity: Number(e.target.value) })} className="h-8 text-xs text-center" />
              <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={e => updateItem(idx, { unitPrice: Number(e.target.value) })} className="h-8 text-xs text-right" />
              <div className="text-right text-xs text-foreground/70 font-medium pr-0.5">{format.currency(item.total)}</div>
              <button type="button" onClick={() => removeItem(idx)} className="text-destructive hover:text-destructive/80 flex justify-end">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={addItem} className="text-xs">
        <Plus className="w-3.5 h-3.5 mr-1" /> {t("crmProposals.items.addLine")}
      </Button>
    </div>
  );
}

// ─── Totals helper ─────────────────────────────────────────────────────────────

function calcTotals(items: ItemLine[], discountEuros = 0) {
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxableItems = items.filter(i => (i.fiscalRegime ?? "general") !== "reav");
  // Precios ya incluyen IVA: extraer la cuota por división
  const gross21 = taxableItems.filter(i => (i.taxRate ?? 21) === 21).reduce((s, i) => s + i.total, 0);
  const gross10 = taxableItems.filter(i => (i.taxRate ?? 21) === 10).reduce((s, i) => s + i.total, 0);
  const tax = (gross21 - gross21 / 1.21) + (gross10 - gross10 / 1.10);
  const total = subtotal - discountEuros;
  return { subtotal, tax: parseFloat(tax.toFixed(2)), total: parseFloat(total.toFixed(2)) };
}

// ─── Create/Edit Modal ─────────────────────────────────────────────────────────

type ProposalFormData = {
  leadId: number;
  title: string;
  description: string;
  mode: "configurable" | "multi_option";
  items: ItemLine[];
  discount: number;
  validUntil: string;
  conditions: string;
  notes: string;
  options: {
    id?: number;
    title: string;
    description: string;
    items: ItemLine[];
    discount: number;
    isRecommended: boolean;
    sortOrder: number;
  }[];
};

function ProposalFormModal({
  leadId,
  leadName,
  proposal,
  onClose,
  onSaved,
}: {
  leadId: number;
  leadName: string;
  proposal?: {
    id: number;
    title: string;
    description: string | null;
    mode: "configurable" | "multi_option";
    items: ItemLine[];
    discount: string | null;
    validUntil: Date | string | null;
    conditions: string | null;
    notes: string | null;
    options?: {
      id: number;
      title: string;
      description: string | null;
      items: ItemLine[];
      discount: string | null;
      isRecommended: boolean;
      sortOrder: number;
    }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, format } = useI18n();
  const isEdit = !!proposal;

  const [form, setForm] = useState<ProposalFormData>({
    leadId,
    title: proposal?.title ?? "",
    description: proposal?.description ?? "",
    mode: proposal?.mode ?? "configurable",
    items: (proposal?.items ?? []) as ItemLine[],
    discount: parseFloat(proposal?.discount ?? "0") || 0,
    validUntil: proposal?.validUntil
      ? new Date(proposal.validUntil).toISOString().split("T")[0]
      : "",
    conditions: proposal?.conditions ?? "",
    notes: proposal?.notes ?? "",
    options: (proposal?.options ?? []).map(o => ({
      id: o.id,
      title: o.title,
      description: o.description ?? "",
      items: (o.items ?? []) as ItemLine[],
      discount: parseFloat(o.discount ?? "0") || 0,
      isRecommended: o.isRecommended,
      sortOrder: o.sortOrder,
    })),
  });

  const utils = trpc.useUtils();
  const createMutation = trpc.proposals.create.useMutation();
  const updateMutation = trpc.proposals.update.useMutation();

  function buildPayload() {
    const baseItems = form.items;
    const { subtotal, tax, total } = calcTotals(baseItems, form.discount);

    const options = form.options.map((o, idx) => {
      const { subtotal: os, tax: ot, total: oo } = calcTotals(o.items, o.discount);
      return {
        id: o.id,
        title: o.title,
        description: o.description || undefined,
        items: o.items,
        subtotal: os,
        discount: o.discount,
        tax: ot,
        total: oo,
        isRecommended: o.isRecommended,
        sortOrder: idx,
      };
    });

    return {
      leadId: form.leadId,
      title: form.title,
      description: form.description || undefined,
      mode: form.mode,
      items: form.mode === "configurable" ? baseItems : [],
      subtotal: form.mode === "configurable" ? subtotal : 0,
      discount: form.mode === "configurable" ? form.discount : 0,
      tax: form.mode === "configurable" ? tax : 0,
      total: form.mode === "configurable" ? total : 0,
      validUntil: form.validUntil || undefined,
      conditions: form.conditions || undefined,
      notes: form.notes || undefined,
      options: form.mode === "multi_option" ? options : undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error(t("crmProposals.form.titleRequired")); return; }

    try {
      if (isEdit && proposal) {
        const { subtotal, tax, total } = calcTotals(form.items, form.discount);
        await updateMutation.mutateAsync({
          id: proposal.id,
          title: form.title,
          description: form.description || undefined,
          items: form.mode === "configurable" ? form.items : [],
          subtotal: form.mode === "configurable" ? subtotal : 0,
          discount: form.mode === "configurable" ? form.discount : 0,
          tax: form.mode === "configurable" ? tax : 0,
          total: form.mode === "configurable" ? total : 0,
          validUntil: form.validUntil || null,
          conditions: form.conditions || undefined,
          notes: form.notes || undefined,
          options: form.mode === "multi_option"
            ? form.options.map((o, idx) => {
                const { subtotal: os, tax: ot, total: oo } = calcTotals(o.items, o.discount);
                return { id: o.id, title: o.title, description: o.description || undefined, items: o.items, subtotal: os, discount: o.discount, tax: ot, total: oo, isRecommended: o.isRecommended, sortOrder: idx };
              })
            : [],
        });
        toast.success(t("crmProposals.form.updated"));
      } else {
        await createMutation.mutateAsync(buildPayload());
        toast.success(t("crmProposals.form.created"));
      }
      utils.proposals.list.invalidate();
      utils.proposals.getByLeadId.invalidate({ leadId });
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t("crmProposals.form.saveError"));
    }
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;
  const configTotals = calcTotals(form.items, form.discount);

  function addOption() {
    setForm(f => ({
      ...f,
      options: [...f.options, { title: t("crmProposals.form.optionN", { n: f.options.length + 1 }), description: "", items: [], discount: 0, isRecommended: false, sortOrder: f.options.length }],
    }));
  }
  function removeOption(idx: number) {
    setForm(f => ({ ...f, options: f.options.filter((_, i) => i !== idx) }));
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-3xl flex flex-col max-h-[90vh] p-0 gap-0">
        {/* Header fijo */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/[0.08] shrink-0">
          <DialogTitle>{isEdit ? t("crmProposals.form.editTitle") : t("crmProposals.form.newTitle")} — {leadName}</DialogTitle>
        </DialogHeader>

        {/* Cuerpo con scroll */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          <form id="proposal-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Mode selector */}
            <div className="flex gap-2">
              {(["configurable", "multi_option"] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, mode: m }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${form.mode === m ? "bg-primary border-primary text-primary-foreground" : "border-foreground/20 text-foreground/60 hover:border-foreground/40"}`}
                >
                  {m === "configurable" ? t("crmProposals.form.modeConfigurable") : t("crmProposals.form.modeMulti")}
                </button>
              ))}
            </div>

            {/* Título */}
            <div>
              <Label>{t("crmProposals.form.title")}</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t("crmProposals.form.titlePlaceholder")} className="mt-1" />
            </div>

            {/* Descripción */}
            <div>
              <Label>{t("crmProposals.form.internalDesc")}</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 text-sm" />
            </div>

            {/* Items — configurable mode */}
            {form.mode === "configurable" && (
              <div>
                <Label className="mb-2 block">{t("crmProposals.form.lines")}</Label>
                <ItemsEditor items={form.items} onChange={items => setForm(f => ({ ...f, items }))} />
                <div className="mt-3 pt-3 border-t border-foreground/[0.08] flex flex-col items-end gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/50 text-xs">{t("crmProposals.form.discount")}</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.discount}
                      onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))}
                      className="h-7 w-24 text-xs text-right"
                    />
                  </div>
                  {form.discount > 0 && <div className="text-xs text-foreground/50">{t("crmProposals.form.baseDiscount", { base: format.currency(configTotals.subtotal), discount: format.currency(form.discount) })}</div>}
                  <div className="text-xs text-foreground/50">{t("crmProposals.form.vat", { amount: format.currency(configTotals.tax) })}</div>
                  <div className="text-base font-bold">{t("crmProposals.form.totalLine", { amount: format.currency(configTotals.total) })}</div>
                </div>
              </div>
            )}

            {/* Options — multi_option mode */}
            {form.mode === "multi_option" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("crmProposals.form.options")}</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addOption} className="text-xs">
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t("crmProposals.form.addOption")}
                  </Button>
                </div>
                {form.options.map((opt, idx) => {
                  const optTotals = calcTotals(opt.items, opt.discount);
                  return (
                    <div key={idx} className="border border-foreground/20 rounded-lg p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={opt.title}
                          onChange={e => setForm(f => ({ ...f, options: f.options.map((o, i) => i === idx ? { ...o, title: e.target.value } : o) }))}
                          placeholder={t("crmProposals.form.optionTitlePlaceholder")}
                          className="h-8 text-sm flex-1"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-foreground/60 cursor-pointer select-none shrink-0">
                          <input
                            type="checkbox"
                            checked={opt.isRecommended}
                            onChange={e => setForm(f => ({ ...f, options: f.options.map((o, i) => i === idx ? { ...o, isRecommended: e.target.checked } : o) }))}
                            className="rounded"
                          />
                          {t("crmProposals.form.recommended")}
                        </label>
                        <button type="button" onClick={() => removeOption(idx)} className="text-destructive hover:text-destructive/80 shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <ItemsEditor
                        items={opt.items}
                        onChange={items => setForm(f => ({ ...f, options: f.options.map((o, i) => i === idx ? { ...o, items } : o) }))}
                      />
                      <div className="pt-2 border-t border-foreground/[0.08] flex justify-end text-xs text-foreground/50 gap-3">
                        <span>{t("crmProposals.form.vat", { amount: format.currency(optTotals.tax) })}</span>
                        <span className="font-bold text-foreground">{t("crmProposals.form.totalLine", { amount: format.currency(optTotals.total) })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Meta fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>{t("crmProposals.form.validUntil")}</Label>
                <Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>{t("crmProposals.form.notes")}</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
            </div>
            <div>
              <Label>{t("crmProposals.form.conditions")}</Label>
              <Textarea value={form.conditions} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))} rows={2} className="mt-1 text-sm" placeholder={t("crmProposals.form.conditionsPlaceholder")} />
            </div>
          </form>
        </div>

        {/* Footer fijo siempre visible */}
        <div className="px-6 py-4 border-t border-foreground/[0.08] shrink-0 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>{t("crmProposals.form.cancel")}</Button>
          <Button type="submit" form="proposal-form" disabled={isBusy}>
            {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : (isEdit ? t("crmProposals.form.saveChanges") : t("crmProposals.form.create"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Convert to quote modal ────────────────────────────────────────────────────

function ConvertModal({
  proposal,
  onClose,
  onConverted,
}: {
  proposal: { id: number; proposalNumber: string; mode: "configurable" | "multi_option"; options?: { id: number; title: string; total: string | null }[] };
  onClose: () => void;
  onConverted: (quoteId: number, quoteNumber: string) => void;
}) {
  const { t, format } = useI18n();
  const [selectedOptionId, setSelectedOptionId] = useState<number | undefined>(undefined);
  const convertMutation = trpc.proposals.convertToQuote.useMutation();

  async function handleConvert() {
    try {
      const result = await convertMutation.mutateAsync({ id: proposal.id, selectedOptionId });
      toast.success(t("crmProposals.convert.quoteCreated", { number: result.quoteNumber }));
      onConverted(result.quoteId, result.quoteNumber);
      onClose();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t("crmProposals.convert.error"));
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("crmProposals.convert.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-foreground/60">
            {t("crmProposals.convert.intro", { number: proposal.proposalNumber })}
          </p>
          {proposal.mode === "multi_option" && (proposal.options ?? []).length > 0 && (
            <div>
              <Label>{t("crmProposals.convert.pickOption")}</Label>
              <Select value={selectedOptionId?.toString() ?? ""} onValueChange={v => setSelectedOptionId(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t("crmProposals.convert.pickPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(proposal.options ?? []).map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.title} — {format.currency(parseFloat(o.total ?? "0"))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={convertMutation.isPending}>{t("crmProposals.convert.cancel")}</Button>
          <Button onClick={handleConvert} disabled={convertMutation.isPending || (proposal.mode === "multi_option" && !selectedOptionId)}>
            {convertMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("crmProposals.convert.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lead picker modal (for global proposals page) ────────────────────────────

function LeadPickerModal({ onPicked, onClose }: { onPicked: (id: number, name: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.crm.leads.list.useQuery({ search: search || undefined, limit: 30 });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader><DialogTitle>{t("crmProposals.picker.title")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder={t("crmProposals.picker.search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {isLoading ? (
              <div className="flex justify-center py-4"><RefreshCw className="w-4 h-4 animate-spin text-foreground/40" /></div>
            ) : !data?.rows?.length ? (
              <p className="text-sm text-foreground/40 text-center py-4">{t("crmProposals.picker.none")}</p>
            ) : (
              data.rows.map((lead: { id: number; name: string; email: string }) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => { onPicked(lead.id, lead.name); onClose(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-foreground/[0.07] transition-colors"
                >
                  <div className="text-sm font-medium">{lead.name}</div>
                  <div className="text-xs text-foreground/40">{lead.email}</div>
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("crmProposals.picker.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ProposalsManager ─────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function ProposalsManager({ leadId, leadName }: { leadId?: number; leadName?: string }) {
  const { t, format } = useI18n();
  const [createModal, setCreateModal] = useState<{ open: boolean; leadId: number; leadName: string } | null>(null);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [editModal, setEditModal] = useState<number | null>(null);
  const [convertModal, setConvertModal] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");

  // Resetear página al cambiar filtros
  useEffect(() => { setPage(0); }, [search, filterStatus]);

  const utils = trpc.useUtils();

  const listQuery = leadId
    ? trpc.proposals.getByLeadId.useQuery({ leadId })
    : trpc.proposals.list.useQuery({
        search: search || undefined,
        status: filterStatus !== "all" ? filterStatus as ProposalStatus : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });

  const getByIdQuery = trpc.proposals.getById.useQuery(
    { id: editModal! },
    { enabled: !!editModal }
  );

  const sendMutation = trpc.proposals.send.useMutation();
  const generateLinkMutation = trpc.proposals.generateLink.useMutation();
  const deleteMutation = trpc.proposals.delete.useMutation();
  const bulkDeleteMutation = trpc.proposals.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(t("crmProposals.list.bulkDeleted", { deleted: r.deleted, skipped: r.skipped > 0 ? t("crmProposals.list.bulkSkipped", { n: r.skipped }) : "" })); setSelected(new Set()); utils.proposals.list.invalidate(); },
    onError: (e) => toastError(e),
  });
  const bulkUpdateStatusMutation = trpc.proposals.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(t("crmProposals.list.bulkStatus", { n: r.updated })); setSelected(new Set()); setBulkStatus(""); utils.proposals.list.invalidate(); },
    onError: (e) => toastError(e),
  });

  async function handlePreview(p: { id: number; publicUrl?: string | null }) {
    if (p.publicUrl) { window.open(p.publicUrl, "_blank"); return; }
    try {
      const result = await generateLinkMutation.mutateAsync({ id: p.id });
      invalidate();
      window.open(result.publicUrl, "_blank");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t("crmProposals.list.linkError"));
    }
  }

  function invalidate() {
    utils.proposals.list.invalidate();
    if (leadId) utils.proposals.getByLeadId.invalidate({ leadId });
  }

  async function handleSend(id: number) {
    try {
      const result = await sendMutation.mutateAsync({ id });
      if (result.emailSent) {
        toast.success(t("crmProposals.list.sentEmail", { email: result.clientEmail }));
      } else if (!result.clientEmail) {
        toast.warning(t("crmProposals.list.sentNoEmail"));
      } else {
        toast.warning(t("crmProposals.list.sentEmailFailed"));
      }
      invalidate();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t("crmProposals.list.sendError"));
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success(t("crmProposals.list.deleted"));
      invalidate();
      setDeleteConfirm(null);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t("crmProposals.list.deleteError"));
    }
  }

  // Normalizar los datos según el modo (leadId o global)
  type ProposalRow = { id: number; proposalNumber: string; leadId: number; title: string; mode: "configurable" | "multi_option"; status: ProposalStatus; total: string | null; sentAt: Date | string | null; createdAt: Date | string; convertedToQuoteId: number | null; publicUrl: string | null; leadName?: string | null; leadEmail?: string | null };
  const rows: ProposalRow[] = leadId
    ? ((listQuery.data as ProposalRow[] | undefined) ?? [])
    : (((listQuery.data as { rows: ProposalRow[]; total: number } | undefined)?.rows) ?? []);
  const total: number = leadId ? rows.length : (((listQuery.data as { rows: ProposalRow[]; total: number } | undefined)?.total) ?? 0);

  // Acciones de una propuesta (mismas reglas de habilitación en el listado global y en el de un lead)
  const rowActions = (p: ProposalRow) => {
    const canSend = ["borrador", "enviado", "visualizado"].includes(p.status);
    const canConvert = ["enviado", "visualizado", "aceptado"].includes(p.status) && !p.convertedToQuoteId;
    const btn = "h-8 w-8 p-0 text-muted-foreground hover:text-foreground";
    const label = (text: string) => `${text}: ${p.proposalNumber}`;
    return (
      <div className="flex items-center justify-end gap-0.5">
        <Button type="button" size="sm" variant="ghost" className={btn} title={p.publicUrl ? t("crmProposals.list.viewPublic") : t("crmProposals.list.preview")} aria-label={label(p.publicUrl ? t("crmProposals.list.viewPublic") : t("crmProposals.list.preview"))} disabled={generateLinkMutation.isPending} onClick={() => handlePreview(p)}><Eye className="w-4 h-4" aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn} title={p.status === "borrador" ? t("crmProposals.list.edit") : t("crmProposals.list.onlyDraft")} aria-label={label(t("crmProposals.list.edit"))} disabled={p.status !== "borrador"} onClick={() => setEditModal(p.id)}><Pencil className="w-4 h-4" aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn} title={t("crmProposals.list.sendEmail")} aria-label={label(t("crmProposals.list.sendEmail"))} disabled={!canSend || sendMutation.isPending} onClick={() => handleSend(p.id)}><Send className="w-4 h-4" aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn} title={p.convertedToQuoteId ? t("crmProposals.list.alreadyConverted") : t("crmProposals.list.convertToQuote")} aria-label={label(t("crmProposals.list.convertToQuote"))} disabled={!canConvert} onClick={() => setConvertModal(p.id)}><ArrowUpRight className="w-4 h-4" aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className={btn} title={p.publicUrl ? t("crmProposals.list.copyLink") : t("crmProposals.list.noLinkYet")} aria-label={label(t("crmProposals.list.copyLink"))} disabled={!p.publicUrl} onClick={() => { navigator.clipboard.writeText(p.publicUrl!); toast.success(t("crmProposals.list.linkCopied")); }}><Copy className="w-4 h-4" aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" title={t("crmProposals.list.delete")} aria-label={label(t("crmProposals.list.delete"))} onClick={() => setDeleteConfirm(p.id)}><Trash2 className="w-4 h-4" aria-hidden="true" /></Button>
      </div>
    );
  };

  // Cliente (lead) de la propuesta: enlaza al listado de leads filtrado por él
  const leadCell = (p: ProposalRow) => {
    const name = p.leadName ?? t("crmProposals.list.leadFallback", { id: p.leadId });
    const q = p.leadEmail ?? p.leadName;
    return (
      <div className="min-w-0">
        {q ? (
          <Link href={`/admin/crm?tab=leads&search=${encodeURIComponent(q)}`} aria-label={t("crmProposals.list.openLead", { name })} className="text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">{name}</Link>
        ) : (
          <div className="text-sm font-medium text-foreground">{name}</div>
        )}
        {p.leadEmail && <div className="max-w-[200px] truncate text-xs text-muted-foreground">{p.leadEmail}</div>}
      </div>
    );
  };

  const dateCell = (p: ProposalRow) => (p.sentAt ? <span className="text-info">{t("crmProposals.list.sentOn", { date: format.date(p.sentAt) })}</span> : format.date(p.createdAt));
  const convertedBadge = (p: ProposalRow, withId: boolean) =>
    p.convertedToQuoteId ? (
      <div className="mt-0.5 flex items-center gap-1 text-xs text-success"><CheckCircle className="h-3 w-3" aria-hidden="true" /> {withId ? t("crmProposals.list.toQuote", { id: p.convertedToQuoteId }) : t("crmProposals.list.convertedToQuote")}</div>
    ) : null;

  const loadingBlock = (
    <div className="divide-y divide-border" role="status" aria-busy="true">
      <span className="sr-only">{t("crmProposals.list.loading")}</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
  // Un error de lectura NO se presenta como «sin propuestas»: se avisa y se ofrece reintentar
  const errorBlock = <PanelError error={listQuery.error} onRetry={() => listQuery.refetch()} className="m-4" />;

  // Modales comunes (listado global y listado de un lead)
  const modals = (
    <>
      {deleteConfirm !== null && (
        <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="w-[95vw] max-w-sm">
            <DialogHeader><DialogTitle>{t("crmProposals.list.deleteTitle")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{t("crmProposals.list.deleteIrreversible")}</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t("crmProposals.list.cancel")}</Button>
              <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : t("crmProposals.list.delete")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {createModal?.open && <ProposalFormModal leadId={createModal.leadId} leadName={createModal.leadName} onClose={() => setCreateModal(null)} onSaved={invalidate} />}
      {editModal !== null && getByIdQuery.data && (
        <ProposalFormModal leadId={getByIdQuery.data.leadId} leadName={leadName ?? t("crmProposals.list.leadFallback", { id: getByIdQuery.data.leadId })} proposal={{ id: getByIdQuery.data.id, title: getByIdQuery.data.title, description: getByIdQuery.data.description, mode: getByIdQuery.data.mode, items: (getByIdQuery.data.items ?? []) as ItemLine[], discount: getByIdQuery.data.discount, validUntil: getByIdQuery.data.validUntil, conditions: getByIdQuery.data.conditions, notes: getByIdQuery.data.notes, options: getByIdQuery.data.options.map(o => ({ id: o.id, title: o.title, description: o.description, items: (o.items ?? []) as ItemLine[], discount: o.discount, isRecommended: o.isRecommended, sortOrder: o.sortOrder })) }} onClose={() => setEditModal(null)} onSaved={invalidate} />
      )}
      {convertModal !== null && (() => { const p = rows.find((x) => x.id === convertModal); if (!p) return null; return <ConvertModal proposal={{ id: p.id, proposalNumber: p.proposalNumber, mode: p.mode }} onClose={() => setConvertModal(null)} onConverted={invalidate} />; })()}
    </>
  );

  // ─── Modo global (página /admin/crm/propuestas) ───────────────────────────
  if (!leadId) {
    const statusOptions = (["all", "borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado"] as const).map((s) => ({
      value: s as string,
      label: s === "all" ? t("crmProposals.list.all") : t(`crmProposals.status.${s}`),
    }));
    const hasFilters = filterStatus !== "all" || search.trim() !== "";
    const allSelected = rows.length > 0 && selected.size === rows.length;
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {/* Cabecera: una acción principal reconocible */}
        <PanelPageHeader
          icon={<FileText />}
          title={t("crmProposals.list.title")}
          description={t("crmProposals.list.subtitle")}
          actions={
            <Button onClick={() => setLeadPickerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> {t("crmProposals.list.newProposal")}
            </Button>
          }
        />

        {/* Búsqueda + filtro de estado segmentado */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("crmProposals.list.searchPlaceholder")}
              aria-label={t("crmProposals.list.searchPlaceholder")}
              className="h-11 rounded-xl pl-10"
            />
          </div>
          <SegmentedTabs label={t("crmProposals.list.filterStatus")} value={filterStatus} onChange={setFilterStatus} options={statusOptions} />
        </div>

        {/* Listado */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {listQuery.isLoading ? (
            loadingBlock
          ) : listQuery.isError ? (
            errorBlock
          ) : rows.length === 0 ? (
            <PanelEmpty
              className="border-0"
              icon={<FileText />}
              title={filterStatus !== "all" ? t("crmProposals.list.emptyStatus", { status: t(`crmProposals.status.${filterStatus}`) }) : t("crmProposals.list.emptyAll")}
            >
              {hasFilters ? (
                <Button size="sm" variant="outline" onClick={() => { setSearch(""); setFilterStatus("all"); }}>{t("crmProposals.list.clearFilters")}</Button>
              ) : (
                <Button size="sm" onClick={() => setLeadPickerOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmProposals.list.newProposal")}</Button>
              )}
            </PanelEmpty>
          ) : (
            <>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2.5">
                  <span className="shrink-0 text-xs font-medium text-primary">{t("crmProposals.list.selected", { n: selected.size })}</span>
                  <select aria-label={t("crmProposals.list.changeStatus")} value={bulkStatus} onChange={e => { if (e.target.value) bulkUpdateStatusMutation.mutate({ ids: Array.from(selected), status: e.target.value as ProposalStatus }); }} disabled={bulkUpdateStatusMutation.isPending} className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-40">
                    <option value="">{t("crmProposals.list.changeStatus")}</option>
                    <option value="borrador">{t("crmProposals.status.borrador")}</option>
                    <option value="enviado">{t("crmProposals.status.enviado")}</option>
                    <option value="aceptado">{t("crmProposals.status.aceptado")}</option>
                    <option value="rechazado">{t("crmProposals.status.rechazado")}</option>
                    <option value="expirado">{t("crmProposals.status.expirado")}</option>
                  </select>
                  <Button type="button" size="sm" variant="outline" className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={bulkDeleteMutation.isPending} onClick={async () => { if ((await confirmAction({ description: t("crmProposals.list.bulkDeleteConfirm", { n: selected.size }), destructive: true }))) bulkDeleteMutation.mutate({ ids: Array.from(selected) }); }}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("crmProposals.list.delete")}
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7 text-muted-foreground" aria-label={t("crmProposals.list.clearSelection")} onClick={() => setSelected(new Set())}><X className="h-4 w-4" aria-hidden="true" /></Button>
                </div>
              )}

              {/* Escritorio: tabla */}
              <table className="hidden w-full text-sm md:table">
                <caption className="sr-only">{t("crmProposals.list.title")}</caption>
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-10 px-3 py-3"><input type="checkbox" aria-label={t("crmProposals.list.selectAll")} className="cursor-pointer rounded border-border" checked={allSelected} onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colRef")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colClient")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colTitle")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colStatus")}</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">{t("crmProposals.list.colTotal")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colDate")}</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">{t("crmProposals.list.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id} className={`border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 ${selected.has(p.id) ? "bg-primary/5" : ""}`}>
                      <td className="w-10 px-3 py-3 align-middle"><input type="checkbox" aria-label={t("crmProposals.list.selectRow", { ref: p.proposalNumber })} className="cursor-pointer rounded border-border" checked={selected.has(p.id)} onChange={e => setSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(p.id) : s.delete(p.id); return s; })} /></td>
                      <td className="px-4 py-3 align-middle">
                        <span className="font-mono text-sm font-medium text-primary">{p.proposalNumber}</span>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t(`crmProposals.mode.${p.mode}`)}</div>
                      </td>
                      <td className="px-4 py-3 align-middle">{leadCell(p)}</td>
                      <td className="px-4 py-3 align-middle">
                        <span className="line-clamp-1 text-sm text-foreground">{p.title}</span>
                        {convertedBadge(p, false)}
                      </td>
                      <td className="px-4 py-3 align-middle"><StatusBadge status={p.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-middle tabular-nums"><span className="text-sm font-semibold text-foreground">{format.currency(parseFloat(p.total ?? "0"))}</span></td>
                      <td className="px-4 py-3 align-middle text-xs text-muted-foreground">{dateCell(p)}</td>
                      <td className="px-4 py-3 align-middle">{rowActions(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Móvil: una tarjeta por propuesta, sin desbordes */}
              <ul className="divide-y divide-border md:hidden" aria-label={t("crmProposals.list.title")}>
                {rows.map(p => (
                  <li key={p.id} className={`space-y-2 p-4 text-sm ${selected.has(p.id) ? "bg-primary/5" : ""}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" aria-label={t("crmProposals.list.selectRow", { ref: p.proposalNumber })} className="mt-1 cursor-pointer rounded border-border" checked={selected.has(p.id)} onChange={e => setSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(p.id) : s.delete(p.id); return s; })} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-medium text-primary">{p.proposalNumber}</span>
                          <StatusBadge status={p.status} />
                        </div>
                        <div className="mt-1 break-words">{leadCell(p)}</div>
                        <div className="mt-1 break-words text-foreground">{p.title}</div>
                        {convertedBadge(p, false)}
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{dateCell(p)}</span>
                          <span className="font-semibold tabular-nums text-foreground">{format.currency(parseFloat(p.total ?? "0"))}</span>
                        </div>
                      </div>
                    </div>
                    <div className="-mr-1">{rowActions(p)}</div>
                  </li>
                ))}
              </ul>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3">
                  <span className="text-sm text-muted-foreground">{t("crmProposals.list.pageOf", { page: page + 1, pages: Math.ceil(total / PAGE_SIZE), total })}</span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setPage(p => p - 1)} disabled={page === 0}>{t("crmProposals.list.prev")}</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>{t("crmProposals.list.next")}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {leadPickerOpen && <LeadPickerModal onClose={() => setLeadPickerOpen(false)} onPicked={(id, name) => { setLeadPickerOpen(false); setCreateModal({ open: true, leadId: id, leadName: name }); }} />}
        {modals}
      </div>
    );
  }

  // ─── Modo incrustado (dentro de un lead) ──────────────────────────────────
  const embeddedTitle = t("crmProposals.list.embeddedTitle", { suffix: leadName ? `— ${leadName}` : "" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{embeddedTitle}</h3>
        <Button size="sm" variant="outline" onClick={() => { if (leadId && leadName) setCreateModal({ open: true, leadId, leadName }); else setLeadPickerOpen(true); }}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("crmProposals.list.newProposal")}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {listQuery.isLoading ? (
          loadingBlock
        ) : listQuery.isError ? (
          errorBlock
        ) : rows.length === 0 ? (
          <PanelEmpty className="border-0" icon={<FileText />} title={t("crmProposals.list.emptyAll")} />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <caption className="sr-only">{embeddedTitle}</caption>
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colRefShort")}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colTitle")}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t("crmProposals.list.colStatus")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t("crmProposals.list.colTotal")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t("crmProposals.list.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 align-middle">
                      <span className="font-mono text-xs font-medium text-primary">{p.proposalNumber}</span>
                      <div className="mt-0.5 text-xs text-muted-foreground">{t(`crmProposals.mode.${p.mode}`)}</div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="line-clamp-1 text-sm text-foreground">{p.title}</span>
                      {convertedBadge(p, true)}
                    </td>
                    <td className="px-4 py-3 align-middle"><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-middle text-sm font-medium tabular-nums">{format.currency(parseFloat(p.total ?? "0"))}</td>
                    <td className="px-4 py-3 align-middle">{rowActions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden" aria-label={embeddedTitle}>
              {rows.map(p => (
                <li key={p.id} className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-medium text-primary">{p.proposalNumber}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="break-words text-foreground">{p.title}</div>
                  {convertedBadge(p, true)}
                  <div className="text-right font-semibold tabular-nums">{format.currency(parseFloat(p.total ?? "0"))}</div>
                  <div className="-mr-1">{rowActions(p)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {modals}
    </div>
  );
}

// ─── Inline button for lead rows in CRMDashboard ──────────────────────────────

export function ProposalLeadButton({ leadId, leadName }: { leadId: number; leadName: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-primary hover:text-primary/80 h-7 px-2 text-xs"
        title={t("crmProposals.list.newCommercial")}
        aria-label={t("crmProposals.list.newCommercial")}
        onClick={() => setOpen(true)}
      >
        <FileText className="w-3.5 h-3.5" />
      </Button>
      {open && (
        <ProposalFormModal
          leadId={leadId}
          leadName={leadName}
          onClose={() => setOpen(false)}
          onSaved={() => utils.proposals.getByLeadId.invalidate({ leadId })}
        />
      )}
    </>
  );
}
