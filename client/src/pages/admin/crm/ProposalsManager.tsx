import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type ProposalStatus = "borrador" | "enviado" | "visualizado" | "aceptado" | "rechazado" | "expirado";

const STATUS_MAP: Record<ProposalStatus, { label: string; className: string }> = {
  borrador: { label: "Borrador", className: "bg-gray-500/15 text-gray-400 border-gray-500/30" },
  enviado: { label: "Enviado", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  visualizado: { label: "Visualizado", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  aceptado: { label: "Aceptado", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rechazado: { label: "Rechazado", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  expirado: { label: "Expirado", className: "bg-gray-600/15 text-gray-500 border-gray-600/30" },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const { label, className } = STATUS_MAP[status] ?? STATUS_MAP.borrador;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {label}
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
          <div>Descripción</div>
          <div className="text-center">Régimen</div>
          <div className="text-center">Cant.</div>
          <div className="text-right">Precio u.</div>
          <div className="text-right">Total</div>
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
                <option value="general">IVA 21%</option>
                <option value="general_10">IVA 10%</option>
                <option value="reav">REAV</option>
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
                <option value="general">IVA 21%</option>
                <option value="general_10">IVA 10%</option>
                <option value="reav">REAV</option>
              </select>
              <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, { quantity: Number(e.target.value) })} className="h-8 text-xs text-center" />
              <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={e => updateItem(idx, { unitPrice: Number(e.target.value) })} className="h-8 text-xs text-right" />
              <div className="text-right text-xs text-foreground/70 font-medium pr-0.5">{item.total.toFixed(2)} €</div>
              <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 flex justify-end">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={addItem} className="text-xs">
        <Plus className="w-3.5 h-3.5 mr-1" /> Añadir línea
      </Button>
    </div>
  );
}

// ─── Totals helper ─────────────────────────────────────────────────────────────

function calcTotals(items: ItemLine[], discountEuros = 0) {
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxableItems = items.filter(i => (i.fiscalRegime ?? "general") !== "reav");
  const tax21 = taxableItems.filter(i => (i.taxRate ?? 21) === 21).reduce((s, i) => s + i.total, 0) * 0.21;
  const tax10 = taxableItems.filter(i => (i.taxRate ?? 21) === 10).reduce((s, i) => s + i.total, 0) * 0.10;
  const tax = tax21 + tax10;
  const total = subtotal - discountEuros + tax;
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
    if (!form.title.trim()) { toast.error("El título es obligatorio"); return; }

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
        toast.success("Propuesta actualizada");
      } else {
        await createMutation.mutateAsync(buildPayload());
        toast.success("Propuesta creada");
      }
      utils.proposals.list.invalidate();
      utils.proposals.getByLeadId.invalidate({ leadId });
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Error al guardar propuesta");
    }
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;
  const configTotals = calcTotals(form.items, form.discount);

  function addOption() {
    setForm(f => ({
      ...f,
      options: [...f.options, { title: `Opción ${f.options.length + 1}`, description: "", items: [], discount: 0, isRecommended: false, sortOrder: f.options.length }],
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
          <DialogTitle>{isEdit ? "Editar propuesta" : "Nueva propuesta"} — {leadName}</DialogTitle>
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
                  {m === "configurable" ? "Configurable (líneas fijas)" : "Multi-opción (el cliente elige)"}
                </button>
              ))}
            </div>

            {/* Título */}
            <div>
              <Label>Título *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ej: Propuesta team building verano 2026" className="mt-1" />
            </div>

            {/* Descripción */}
            <div>
              <Label>Descripción interna</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 text-sm" />
            </div>

            {/* Items — configurable mode */}
            {form.mode === "configurable" && (
              <div>
                <Label className="mb-2 block">Líneas del presupuesto</Label>
                <ItemsEditor items={form.items} onChange={items => setForm(f => ({ ...f, items }))} />
                <div className="mt-3 pt-3 border-t border-foreground/[0.08] flex flex-col items-end gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/50 text-xs">Descuento (€)</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.discount}
                      onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))}
                      className="h-7 w-24 text-xs text-right"
                    />
                  </div>
                  {form.discount > 0 && <div className="text-xs text-foreground/50">Base: {configTotals.subtotal.toFixed(2)} € · Descuento: -{form.discount.toFixed(2)} €</div>}
                  <div className="text-xs text-foreground/50">IVA: {configTotals.tax.toFixed(2)} €</div>
                  <div className="text-base font-bold">Total: {configTotals.total.toFixed(2)} €</div>
                </div>
              </div>
            )}

            {/* Options — multi_option mode */}
            {form.mode === "multi_option" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Opciones</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addOption} className="text-xs">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Añadir opción
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
                          placeholder="Título de la opción"
                          className="h-8 text-sm flex-1"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-foreground/60 cursor-pointer select-none shrink-0">
                          <input
                            type="checkbox"
                            checked={opt.isRecommended}
                            onChange={e => setForm(f => ({ ...f, options: f.options.map((o, i) => i === idx ? { ...o, isRecommended: e.target.checked } : o) }))}
                            className="rounded"
                          />
                          Recomendada
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
                        <span>IVA: {optTotals.tax.toFixed(2)} €</span>
                        <span className="font-bold text-foreground">Total: {optTotals.total.toFixed(2)} €</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Meta fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Válida hasta</Label>
                <Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Notas (visibles en email)</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 text-sm" />
              </div>
            </div>
            <div>
              <Label>Condiciones</Label>
              <Textarea value={form.conditions} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))} rows={2} className="mt-1 text-sm" placeholder="Condiciones de cancelación, validez, etc." />
            </div>
          </form>
        </div>

        {/* Footer fijo siempre visible */}
        <div className="px-6 py-4 border-t border-foreground/[0.08] shrink-0 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>Cancelar</Button>
          <Button type="submit" form="proposal-form" disabled={isBusy}>
            {isBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : (isEdit ? "Guardar cambios" : "Crear propuesta")}
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
  const [selectedOptionId, setSelectedOptionId] = useState<number | undefined>(undefined);
  const convertMutation = trpc.proposals.convertToQuote.useMutation();

  async function handleConvert() {
    try {
      const result = await convertMutation.mutateAsync({ id: proposal.id, selectedOptionId });
      toast.success(`Presupuesto ${result.quoteNumber} creado`);
      onConverted(result.quoteId, result.quoteNumber);
      onClose();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Error al convertir");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-lg">
        <DialogHeader>
          <DialogTitle>Convertir propuesta a presupuesto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-foreground/60">
            Se creará un presupuesto en borrador a partir de la propuesta <strong>{proposal.proposalNumber}</strong>.
          </p>
          {proposal.mode === "multi_option" && (proposal.options ?? []).length > 0 && (
            <div>
              <Label>Selecciona la opción elegida por el cliente</Label>
              <Select value={selectedOptionId?.toString() ?? ""} onValueChange={v => setSelectedOptionId(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar opción…" />
                </SelectTrigger>
                <SelectContent>
                  {(proposal.options ?? []).map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.title} — {parseFloat(o.total ?? "0").toFixed(2)} €
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={convertMutation.isPending}>Cancelar</Button>
          <Button onClick={handleConvert} disabled={convertMutation.isPending || (proposal.mode === "multi_option" && !selectedOptionId)}>
            {convertMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Crear presupuesto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lead picker modal (for global proposals page) ────────────────────────────

function LeadPickerModal({ onPicked, onClose }: { onPicked: (id: number, name: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.crm.leads.list.useQuery({ search: search || undefined, limit: 30 });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader><DialogTitle>Seleccionar lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {isLoading ? (
              <div className="flex justify-center py-4"><RefreshCw className="w-4 h-4 animate-spin text-foreground/40" /></div>
            ) : !data?.rows?.length ? (
              <p className="text-sm text-foreground/40 text-center py-4">No se encontraron leads</p>
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
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ProposalsManager ─────────────────────────────────────────────────────

export default function ProposalsManager({ leadId, leadName }: { leadId?: number; leadName?: string }) {
  const [createModal, setCreateModal] = useState<{ open: boolean; leadId: number; leadName: string } | null>(null);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [editModal, setEditModal] = useState<number | null>(null);
  const [convertModal, setConvertModal] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const listQuery = leadId
    ? trpc.proposals.getByLeadId.useQuery({ leadId })
    : trpc.proposals.list.useQuery({ limit: 100 });

  const getByIdQuery = trpc.proposals.getById.useQuery(
    { id: editModal! },
    { enabled: !!editModal }
  );

  const sendMutation = trpc.proposals.send.useMutation();
  const deleteMutation = trpc.proposals.delete.useMutation();

  async function handleSend(id: number) {
    try {
      const result = await sendMutation.mutateAsync({ id });
      toast.success("Propuesta enviada por email");
      utils.proposals.list.invalidate();
      if (leadId) utils.proposals.getByLeadId.invalidate({ leadId });
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Error al enviar");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Propuesta eliminada");
      utils.proposals.list.invalidate();
      if (leadId) utils.proposals.getByLeadId.invalidate({ leadId });
      setDeleteConfirm(null);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Error al eliminar");
    }
  }

  const proposals = (listQuery.data as { id: number; proposalNumber: string; leadId: number; title: string; mode: "configurable" | "multi_option"; status: ProposalStatus; total: string | null; sentAt: Date | string | null; createdAt: Date | string; convertedToQuoteId: number | null; publicUrl: string | null }[] | undefined) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground/70">
          Propuestas Comerciales {leadName ? `— ${leadName}` : ""}
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => {
            if (leadId && leadName) {
              setCreateModal({ open: true, leadId, leadName });
            } else {
              setLeadPickerOpen(true);
            }
          }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Nueva propuesta
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-foreground/40" /></div>
      ) : listQuery.error ? (
        <div className="text-center py-8 text-red-400 text-sm">
          Error cargando propuestas: {(listQuery.error as { message?: string })?.message ?? "Error desconocido"}
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-8 text-foreground/30 text-sm">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No hay propuestas
        </div>
      ) : (
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Ref.</th>
                  {!leadId && <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Lead</th>}
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">Título</th>
                  <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                  <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Total</th>
                  <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => (
                  <tr key={p.id} className="border-b border-foreground/[0.06] hover:bg-foreground/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-foreground/70">{p.proposalNumber}</span>
                      <div className="text-[10px] text-foreground/30 mt-0.5">
                        {p.mode === "multi_option" ? "multi-opción" : "configurable"}
                      </div>
                    </td>
                    {!leadId && (
                      <td className="px-4 py-3 text-xs text-foreground/60">Lead #{p.leadId}</td>
                    )}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-foreground/80 line-clamp-1">{p.title}</span>
                      {p.convertedToQuoteId && (
                        <div className="text-[10px] text-emerald-400 mt-0.5">→ Presupuesto #{p.convertedToQuoteId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">
                      {parseFloat(p.total ?? "0").toFixed(2)} €
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Edit (borrador only) */}
                        {p.status === "borrador" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-400 hover:text-blue-300 h-7 px-2"
                            title="Editar"
                            onClick={() => setEditModal(p.id)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {/* Send */}
                        {["borrador", "visualizado"].includes(p.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-400 hover:text-green-300 h-7 px-2"
                            title="Enviar por email"
                            disabled={sendMutation.isPending}
                            onClick={() => handleSend(p.id)}
                          >
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {/* Public link */}
                        {p.publicUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-amber-400 hover:text-amber-300 h-7 px-2"
                            title="Ver propuesta pública"
                            onClick={() => window.open(p.publicUrl!, "_blank")}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {/* Convert to quote */}
                        {["enviado", "visualizado", "aceptado"].includes(p.status) && !p.convertedToQuoteId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-orange-400 hover:text-orange-300 h-7 px-2"
                            title="Convertir a presupuesto"
                            onClick={() => setConvertModal(p.id)}
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {/* Copy link */}
                        {p.publicUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-foreground/40 hover:text-foreground/70 h-7 px-2"
                            title="Copiar enlace"
                            onClick={() => { navigator.clipboard.writeText(p.publicUrl!); toast.success("Enlace copiado"); }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {/* Delete (borrador only) */}
                        {p.status === "borrador" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 hover:text-red-300 h-7 px-2"
                            title="Eliminar"
                            onClick={() => setDeleteConfirm(p.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lead picker (global page: no leadId preselected) */}
      {leadPickerOpen && (
        <LeadPickerModal
          onClose={() => setLeadPickerOpen(false)}
          onPicked={(id, name) => {
            setLeadPickerOpen(false);
            setCreateModal({ open: true, leadId: id, leadName: name });
          }}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm !== null && (
        <Dialog open onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="w-[95vw] max-w-sm">
            <DialogHeader><DialogTitle>¿Eliminar propuesta?</DialogTitle></DialogHeader>
            <p className="text-sm text-foreground/60">Esta acción no se puede deshacer.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Eliminar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create/Edit modal */}
      {createModal?.open && (
        <ProposalFormModal
          leadId={createModal.leadId}
          leadName={createModal.leadName}
          onClose={() => setCreateModal(null)}
          onSaved={() => {}}
        />
      )}
      {editModal !== null && getByIdQuery.data && (
        <ProposalFormModal
          leadId={getByIdQuery.data.leadId}
          leadName={leadName ?? `Lead #${getByIdQuery.data.leadId}`}
          proposal={{
            id: getByIdQuery.data.id,
            title: getByIdQuery.data.title,
            description: getByIdQuery.data.description,
            mode: getByIdQuery.data.mode,
            items: (getByIdQuery.data.items ?? []) as ItemLine[],
            discount: getByIdQuery.data.discount,
            validUntil: getByIdQuery.data.validUntil,
            conditions: getByIdQuery.data.conditions,
            notes: getByIdQuery.data.notes,
            options: getByIdQuery.data.options.map(o => ({
              id: o.id,
              title: o.title,
              description: o.description,
              items: (o.items ?? []) as ItemLine[],
              discount: o.discount,
              isRecommended: o.isRecommended,
              sortOrder: o.sortOrder,
            })),
          }}
          onClose={() => setEditModal(null)}
          onSaved={() => {}}
        />
      )}

      {/* Convert modal */}
      {convertModal !== null && (() => {
        const p = proposals.find(x => x.id === convertModal);
        if (!p) return null;
        return (
          <ConvertModal
            proposal={{ id: p.id, proposalNumber: p.proposalNumber, mode: p.mode }}
            onClose={() => setConvertModal(null)}
            onConverted={() => {
              utils.proposals.list.invalidate();
              if (leadId) utils.proposals.getByLeadId.invalidate({ leadId });
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Inline button for lead rows in CRMDashboard ──────────────────────────────

export function ProposalLeadButton({ leadId, leadName }: { leadId: number; leadName: string }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-purple-400 hover:text-purple-300 h-7 px-2 text-xs"
        title="Nueva propuesta comercial"
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
