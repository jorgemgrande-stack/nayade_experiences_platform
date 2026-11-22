import React, { useState, useEffect } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { trpc } from "@/lib/trpc";
import { TONE_BADGE } from "@/lib/panelTones";
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

const STATUS_MAP: Record<ProposalStatus, { className: string }> = {
  borrador: { className: "bg-gray-500/15 text-gray-400 border-gray-500/30" },
  enviado: { className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  visualizado: { className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  aceptado: { className: TONE_BADGE.success },
  rechazado: { className: "bg-red-500/15 text-red-400 border-red-500/30" },
  expirado: { className: "bg-gray-600/15 text-gray-500 border-gray-600/30" },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const { t } = useI18n();
  const { className } = STATUS_MAP[status] ?? STATUS_MAP.borrador;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {t(`crmProposals.status.${STATUS_MAP[status] ? status : "borrador"}`)}
    </span>
  );
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
              <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 mt-1 shrink-0">
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
              <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 flex justify-end">
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
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${form.mode === m ? "bg-blue-600 border-blue-500 text-white" : "border-foreground/20 text-foreground/60 hover:border-foreground/40"}`}
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
                        <button type="button" onClick={() => removeOption(idx)} className="text-red-400 hover:text-red-300 shrink-0">
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

  // ─── Modo global (página /admin/crm/propuestas) ───────────────────────────
  if (!leadId) {
    return (
      <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header — igual que CRMDashboard */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t("crmProposals.list.title")}</h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5 hidden sm:block">{t("crmProposals.list.subtitle")}</p>
            </div>
          </div>
        </div>

        {/* Barra búsqueda + filtros + botón — igual que CRMDashboard */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-full sm:max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("crmProposals.list.searchPlaceholder")}
              className="w-full pl-9 pr-3 h-9 text-sm rounded-lg border border-foreground/[0.12] bg-foreground/[0.04] placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all", "borrador", "enviado", "visualizado", "aceptado", "rechazado", "expirado"] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${filterStatus === s ? "bg-orange-600 text-white shadow-lg shadow-orange-900/30" : "text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05]"}`}
              >
                {s === "all" ? t("crmProposals.list.all") : t(`crmProposals.status.${s}`)}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => setLeadPickerOpen(true)}
            className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white sm:ml-auto"
          >
            <Plus className="w-4 h-4 mr-1.5" /> {t("crmProposals.list.newProposal")}
          </Button>
        </div>

        {/* Tabla */}
        <div className="px-4 sm:px-6 pb-8">
          {listQuery.isLoading ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-foreground/40" /></div>
          ) : listQuery.error ? (
            <div className="text-center py-8 text-red-400 text-sm">{t("crmProposals.list.errorPrefix", { message: (listQuery.error as { message?: string })?.message ?? t("crmProposals.list.unknownError") })}</div>
          ) : rows.length === 0 ? (
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl flex flex-col items-center py-14 text-foreground/30">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">{filterStatus !== "all" ? t("crmProposals.list.emptyStatus", { status: t(`crmProposals.status.${filterStatus}`) }) : t("crmProposals.list.emptyAll")}</p>
            </div>
          ) : (
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20">
                  <span className="text-xs text-blue-300 font-medium shrink-0">{t("crmProposals.list.selected", { n: selected.size })}</span>
                  <select value={bulkStatus} onChange={e => { if (e.target.value) bulkUpdateStatusMutation.mutate({ ids: Array.from(selected), status: e.target.value as ProposalStatus }); }} disabled={bulkUpdateStatusMutation.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                    <option value="">{t("crmProposals.list.changeStatus")}</option>
                    <option value="borrador">{t("crmProposals.status.borrador")}</option>
                    <option value="enviado">{t("crmProposals.status.enviado")}</option>
                    <option value="aceptado">{t("crmProposals.status.aceptado")}</option>
                    <option value="rechazado">{t("crmProposals.status.rechazado")}</option>
                    <option value="expirado">{t("crmProposals.status.expirado")}</option>
                  </select>
                  <button onClick={async () => { if ((await confirmAction({ description: t("crmProposals.list.bulkDeleteConfirm", { n: selected.size }), destructive: true }))) bulkDeleteMutation.mutate({ ids: Array.from(selected) }); }} disabled={bulkDeleteMutation.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" /> {t("crmProposals.list.delete")}
                  </button>
                  <button onClick={() => setSelected(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                      <th className="w-10 px-3 py-3"><input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={rows.length > 0 && selected.size === rows.length} onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colRef")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colClient")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">{t("crmProposals.list.colTitle")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colStatus")}</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colTotal")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">{t("crmProposals.list.colDate")}</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(p => (
                      <tr key={p.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${selected.has(p.id) ? "bg-blue-500/5" : ""}`}>
                        <td className="w-10 px-3 py-3"><input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selected.has(p.id)} onChange={e => setSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(p.id) : s.delete(p.id); return s; })} /></td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono font-medium text-violet-400">{p.proposalNumber}</span>
                          <div className="text-[10px] text-foreground/30 mt-0.5">{t(`crmProposals.mode.${p.mode}`)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground/90">{p.leadName ?? t("crmProposals.list.leadFallback", { id: p.leadId })}</div>
                          {p.leadEmail && <div className="text-xs text-foreground/40 truncate max-w-[160px]">{p.leadEmail}</div>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-sm text-foreground/80 line-clamp-1">{p.title}</span>
                          {p.convertedToQuoteId && <div className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" /> {t("crmProposals.list.convertedToQuote")}</div>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                        <td className="px-4 py-3 text-right"><span className="text-sm font-bold text-foreground">{format.currency(parseFloat(p.total ?? "0"))}</span></td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="text-xs text-foreground/50">
                            {p.sentAt ? <span className="text-info">{t("crmProposals.list.sentOn", { date: format.date(p.sentAt) })}</span> : format.date(p.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-amber-300 h-7 w-7 p-0" title={p.publicUrl ? t("crmProposals.list.viewPublic") : t("crmProposals.list.preview")} disabled={generateLinkMutation.isPending} onClick={() => handlePreview(p)}><Eye className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-blue-300 h-7 w-7 p-0" title={p.status === "borrador" ? t("crmProposals.list.edit") : t("crmProposals.list.onlyDraft")} disabled={p.status !== "borrador"} onClick={() => setEditModal(p.id)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-green-300 h-7 w-7 p-0" title={t("crmProposals.list.sendEmail")} disabled={!["borrador", "enviado", "visualizado"].includes(p.status) || sendMutation.isPending} onClick={() => handleSend(p.id)}><Send className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-orange-300 h-7 w-7 p-0" title={p.convertedToQuoteId ? t("crmProposals.list.alreadyConverted") : t("crmProposals.list.convertToQuote")} disabled={!["enviado", "visualizado", "aceptado"].includes(p.status) || !!p.convertedToQuoteId} onClick={() => setConvertModal(p.id)}><ArrowUpRight className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground/70 h-7 w-7 p-0" title={p.publicUrl ? t("crmProposals.list.copyLink") : t("crmProposals.list.noLinkYet")} disabled={!p.publicUrl} onClick={() => { navigator.clipboard.writeText(p.publicUrl!); toast.success(t("crmProposals.list.linkCopied")); }}><Copy className="w-3.5 h-3.5" /></Button>
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-red-400 h-7 w-7 p-0" title={t("crmProposals.list.delete")} onClick={() => setDeleteConfirm(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                  <span className="text-sm text-foreground/50">{t("crmProposals.list.pageOf", { page: page + 1, pages: Math.ceil(total / PAGE_SIZE), total })}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors">{t("crmProposals.list.prev")}</button>
                    <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors">{t("crmProposals.list.next")}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modales globales */}
        {leadPickerOpen && <LeadPickerModal onClose={() => setLeadPickerOpen(false)} onPicked={(id, name) => { setLeadPickerOpen(false); setCreateModal({ open: true, leadId: id, leadName: name }); }} />}
        {deleteConfirm !== null && (
          <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
            <DialogContent className="w-[95vw] max-w-sm">
              <DialogHeader><DialogTitle>{t("crmProposals.list.deleteTitle")}</DialogTitle></DialogHeader>
              <p className="text-sm text-foreground/60">{t("crmProposals.list.deleteIrreversible")}</p>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t("crmProposals.list.cancel")}</Button>
                <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("crmProposals.list.delete")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {createModal?.open && <ProposalFormModal leadId={createModal.leadId} leadName={createModal.leadName} onClose={() => setCreateModal(null)} onSaved={invalidate} />}
        {editModal !== null && getByIdQuery.data && (
          <ProposalFormModal leadId={getByIdQuery.data.leadId} leadName={t("crmProposals.list.leadFallback", { id: getByIdQuery.data.leadId })} proposal={{ id: getByIdQuery.data.id, title: getByIdQuery.data.title, description: getByIdQuery.data.description, mode: getByIdQuery.data.mode, items: (getByIdQuery.data.items ?? []) as ItemLine[], discount: getByIdQuery.data.discount, validUntil: getByIdQuery.data.validUntil, conditions: getByIdQuery.data.conditions, notes: getByIdQuery.data.notes, options: getByIdQuery.data.options.map(o => ({ id: o.id, title: o.title, description: o.description, items: (o.items ?? []) as ItemLine[], discount: o.discount, isRecommended: o.isRecommended, sortOrder: o.sortOrder })) }} onClose={() => setEditModal(null)} onSaved={invalidate} />
        )}
        {convertModal !== null && (() => { const p = rows.find((x: any) => x.id === convertModal); if (!p) return null; return <ConvertModal proposal={{ id: p.id, proposalNumber: p.proposalNumber, mode: p.mode }} onClose={() => setConvertModal(null)} onConverted={invalidate} />; })()}
      </div>
    );
  }

  // ─── Modo incrustado (dentro de un lead) ──────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground/70">{t("crmProposals.list.embeddedTitle", { suffix: leadName ? `— ${leadName}` : "" })}</h3>
        <Button size="sm" variant="outline" className="text-xs" onClick={() => { if (leadId && leadName) setCreateModal({ open: true, leadId, leadName }); else setLeadPickerOpen(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> {t("crmProposals.list.newProposal")}
        </Button>
      </div>
      {listQuery.isLoading ? (
        <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-foreground/40" /></div>
      ) : listQuery.error ? (
        <div className="text-center py-8 text-red-400 text-sm">{t("crmProposals.list.errorPrefix", { message: (listQuery.error as { message?: string })?.message ?? "" })}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-foreground/30 text-sm"><FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />{t("crmProposals.list.emptyAll")}</div>
      ) : (
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colRefShort")}</th>
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">{t("crmProposals.list.colTitle")}</th>
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colStatus")}</th>
                  <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colTotal")}</th>
                  <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmProposals.list.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-violet-400">{p.proposalNumber}</span>
                      <div className="text-[10px] text-foreground/30 mt-0.5">{t(`crmProposals.mode.${p.mode}`)}</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-foreground/80 line-clamp-1">{p.title}</span>
                      {p.convertedToQuoteId && <div className="text-[10px] text-emerald-400 mt-0.5">{t("crmProposals.list.toQuote", { id: p.convertedToQuoteId })}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{format.currency(parseFloat(p.total ?? "0"))}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-foreground/50 hover:text-amber-300" title={p.publicUrl ? t("crmProposals.list.viewPublic") : t("crmProposals.list.preview")} disabled={generateLinkMutation.isPending} onClick={() => handlePreview(p)}><Eye className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className={`h-7 w-7 p-0 ${p.status === "borrador" ? "text-foreground/50 hover:text-blue-300" : "text-foreground/20 cursor-not-allowed"}`} disabled={p.status !== "borrador"} onClick={() => setEditModal(p.id)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className={`h-7 w-7 p-0 ${["borrador", "enviado", "visualizado"].includes(p.status) ? "text-foreground/50 hover:text-green-300" : "text-foreground/20 cursor-not-allowed"}`} disabled={!["borrador", "enviado", "visualizado"].includes(p.status)} onClick={() => handleSend(p.id)}><Send className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className={`h-7 w-7 p-0 ${["enviado", "visualizado", "aceptado"].includes(p.status) && !p.convertedToQuoteId ? "text-foreground/50 hover:text-orange-300" : "text-foreground/20 cursor-not-allowed"}`} disabled={!["enviado", "visualizado", "aceptado"].includes(p.status) || !!p.convertedToQuoteId} onClick={() => setConvertModal(p.id)}><ArrowUpRight className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className={`h-7 w-7 p-0 ${p.publicUrl ? "text-foreground/50 hover:text-foreground/70" : "text-foreground/20 cursor-not-allowed"}`} disabled={!p.publicUrl} onClick={() => { navigator.clipboard.writeText(p.publicUrl!); toast.success(t("crmProposals.list.linkCopied")); }}><Copy className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-red-400 h-7 w-7 p-0" onClick={() => setDeleteConfirm(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {deleteConfirm !== null && (
        <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="w-[95vw] max-w-sm">
            <DialogHeader><DialogTitle>{t("crmProposals.list.deleteTitle")}</DialogTitle></DialogHeader>
            <p className="text-sm text-foreground/60">{t("crmProposals.list.deleteIrreversible")}</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t("crmProposals.list.cancel")}</Button>
              <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : t("crmProposals.list.delete")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {createModal?.open && <ProposalFormModal leadId={createModal.leadId} leadName={createModal.leadName} onClose={() => setCreateModal(null)} onSaved={invalidate} />}
      {editModal !== null && getByIdQuery.data && (
        <ProposalFormModal leadId={getByIdQuery.data.leadId} leadName={leadName ?? t("crmProposals.list.leadFallback", { id: getByIdQuery.data.leadId })} proposal={{ id: getByIdQuery.data.id, title: getByIdQuery.data.title, description: getByIdQuery.data.description, mode: getByIdQuery.data.mode, items: (getByIdQuery.data.items ?? []) as ItemLine[], discount: getByIdQuery.data.discount, validUntil: getByIdQuery.data.validUntil, conditions: getByIdQuery.data.conditions, notes: getByIdQuery.data.notes, options: getByIdQuery.data.options.map(o => ({ id: o.id, title: o.title, description: o.description, items: (o.items ?? []) as ItemLine[], discount: o.discount, isRecommended: o.isRecommended, sortOrder: o.sortOrder })) }} onClose={() => setEditModal(null)} onSaved={invalidate} />
      )}
      {convertModal !== null && (() => { const p = rows.find((x: any) => x.id === convertModal); if (!p) return null; return <ConvertModal proposal={{ id: p.id, proposalNumber: p.proposalNumber, mode: p.mode }} onClose={() => setConvertModal(null)} onConverted={invalidate} />; })()}
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
        className="text-purple-400 hover:text-purple-300 h-7 px-2 text-xs"
        title={t("crmProposals.list.newCommercial")}
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
