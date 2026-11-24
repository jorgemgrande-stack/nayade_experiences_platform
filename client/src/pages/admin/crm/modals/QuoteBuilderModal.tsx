import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary, useVocabularyDefault } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, Plus, Send, RefreshCw, Trash2, Sparkles, CreditCard } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, toastQuoteMail, ProductSearchInput, QuoteLineItem, RegimeCell } from "../shared/crmCommon";

// ─── QUOTE BUILDER MODAL ─────────────────────────────────────────────────────
export function QuoteBuilderModal({
  leadId,
  leadName,
  onClose,
}: {
  leadId: number;
  leadName: string;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [title, setTitle] = useState(`Presupuesto - ${leadName}`);
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useVocabularyDefault(voc.quoteConditions);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });
  const [activityDate, setActivityDate] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; serviceDate?: string }[]>([
    { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" },
  ]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  // Prellenar fecha de actividad desde lead.preferredDate
  const leadQuery = trpc.crm.leads.get.useQuery({ id: leadId });
  useEffect(() => {
    const pd = leadQuery.data?.lead?.preferredDate;
    if (pd && !activityDate) {
      setActivityDate(new Date(pd).toISOString().split("T")[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadQuery.data?.lead?.preferredDate]);
  // Plan de pago fraccionado (draft local — se guarda tras recibir quoteId)
  const [showPlanSection, setShowPlanSection] = useState(false);
  type DraftInst = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallments, setDraftInstallments] = useState<DraftInst[]>([]);
  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [promoData, setPromoData] = useState<{ id: number; code: string; discountPercent: number } | null>(null);
  const validatePromo = trpc.discounts.validate.useMutation({
    onSuccess: (d) => setPromoData({ id: d.id, code: d.code, discountPercent: d.discountPercent }),
    onError: (e) => { toast.error(errorToastMessage(e)); setPromoData(null); },
  });
  const previewQuery = trpc.crm.leads.previewFromLead.useQuery(
    { leadId },
    { enabled: false }
  );
  const handleAutoFill = async () => {
    const result = await previewQuery.refetch();
    if (result.data?.hasActivities && result.data.items.length > 0) {
      setItems(result.data.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]);
      setAutoFilled(true);
      toast.success(t("crmQuotes.lineasGeneradasAutomaticamente", { length: result.data.items.length }));
    } else {
      toast.error(voc.licensed ? t("crmEmpty.toast.leadNoItemsLicensed", { lead: voc.lead }) : t("crmEmpty.toast.leadNoItemsLegacy", { lead: voc.lead }));
    }
  };

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotalBuilder = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const promoDiscount = promoData ? parseFloat((subtotal * promoData.discountPercent / 100).toFixed(2)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - promoDiscount);
  const discountedGeneral = Math.max(0, generalSubtotalBuilder - (promoData ? parseFloat((generalSubtotalBuilder * promoData.discountPercent / 100).toFixed(2)) : 0));
  const taxRowsB = (() => {
    const promoRatio = generalSubtotalBuilder > 0 ? discountedGeneral / generalSubtotalBuilder : 1;
    const groups: Record<number, number> = {};
    items.filter(i => i.fiscalRegime !== "reav").forEach(item => {
      const rate = (item as any).taxRate ?? 21;
      groups[rate] = (groups[rate] ?? 0) + item.total * promoRatio;
    });
    return Object.entries(groups).map(([rateStr, gross]) => {
      const rate = Number(rateStr);
      const div = 1 + rate / 100;
      return { rate, amount: parseFloat((gross - gross / div).toFixed(2)) };
    }).sort((a, b) => b.rate - a.rate);
  })();
  const taxAmount = parseFloat(taxRowsB.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateB = taxRowsB.length === 1 ? taxRowsB[0].rate : taxRate;
  // El PVP de cada línea ya incluye el IVA: el total es la suma de líneas.
  const total = parseFloat(discountedSubtotal.toFixed(2));
  const baseImponible = parseFloat((total - taxAmount).toFixed(2));

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.total = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      })
    );
  };

  const sendQuote = trpc.crm.quotes.send.useMutation({
    onSuccess: (data) => toastQuoteMail(data, "Presupuesto enviado al cliente"),
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const upsertPlanBuilder = trpc.crm.paymentPlans.upsert.useMutation({
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido guardar el plan de pago.")),
  });

  const convertToQuote = trpc.crm.leads.convertToQuote.useMutation({
    onSuccess: async (data) => {
      toast.success(t("crmQuotes.presupuestoCreado", { quoteNumber: data.quoteNumber }));
      utils.crm.leads.counters.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.quotes.list.invalidate();
      if (draftInstallments.length > 0) {
        await upsertPlanBuilder.mutateAsync({
          quoteId: data.quoteId,
          installments: draftInstallments.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
        });
        toast.success(t("crmQuotes.planFraccionadoGuardadoCuotas", { draftInstallmentsCount: draftInstallments.length }));
      }
      if (sendAfterCreate) {
        await sendQuote.mutateAsync({ id: data.quoteId, origin: window.location.origin });
      }
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const handleSubmit = (andSend = false) => {
    if (!title || items.some((i) => !i.description)) {
      toast.error(t("crmQuotes.completaElTituloY"));
      return;
    }
    if (draftInstallments.some(i => !i.dueDate || i.amountCents <= 0)) {
      toast.error(t("crmQuotes.completaElImporteY"));
      return;
    }
    setSendAfterCreate(andSend);
    convertToQuote.mutate({
      leadId,
      title,
      description,
      items,
      subtotal: baseImponible,
      discount: promoDiscount,
      taxRate,
      total,
      validUntil,
      activityDate: activityDate || null,
      notes,
      conditions,
    });
  };

  return (
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-warning" />{" "}{t("crmQuotes.nuevoPresupuesto")}{leadName && <span className="text-foreground/50 text-sm font-normal ml-1">{t("crmQuotes.para", { leadName })}</span>}
        </DialogTitle>
      </DialogHeader>
      {/* Boton Autogenerar con IA */}
      <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/30">
        <Sparkles className="w-4 h-4 text-success shrink-0" />
        <span className="text-success text-sm flex-1">
          {voc.licensed
            ? (autoFilled ? t("crmQuotes.conceptosGeneradosDesdeLos") : t("crmQuotes.autogeneraLosConceptosDel"))
            : (autoFilled ? t("crmQuotes.conceptosGeneradosDesdeLas") : t("crmQuotes.autogeneraLosConceptosDel2"))}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="border-success/40 text-success hover:bg-success/10 hover:border-success/60 shrink-0"
          onClick={handleAutoFill}
          disabled={previewQuery.isFetching}
        >
          {previewQuery.isFetching
            ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5 mr-1" />}
          {autoFilled ? t("crmQuotes.regenerar") : t("crmQuotes.autogenerarConIa")}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.asuntoDelPresupuesto")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1"
            />
            <p className="text-foreground/40 text-xs mt-1">{t("crmQuotes.generadoAutomaticamentePuedesE")}</p>
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{voc.serviceDateLabel}</Label>
            <Input
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"
            />
            {leadQuery.data?.lead?.preferredDate && (
              <p className="text-foreground/40 text-xs mt-1">{t("crmQuotes.prerellenadaDesdeElFormulario")}</p>
            )}
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.validoHasta")}</Label>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"
            />
          </div>
        </div>

        {/* Items con buscador de productos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.conceptos")}{" "}<span className="text-foreground/40">{t("crmQuotes.escribeOBuscaUn")}</span>
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="text-warning hover:text-warning text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }])}
            >
              <Plus className="w-3 h-3 mr-1" />{" "}{t("crmQuotes.anadirLinea")}</Button>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[460px]">
          <div className="text-xs text-foreground/40 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-4">{t("crmQuotes.descripcion")}</span>
            <span className="col-span-2 text-center">{t("crmQuotes.regimen")}</span>
            <span className="col-span-2 text-center">{t("crmQuotes.cant")}</span>
            <span className="col-span-2 text-right">{t("crmQuotes.pUnit")}</span>
            <span className="col-span-2 text-right">{t("crmQuotes.total")}</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="space-y-1">
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <ProductSearchInput
                    value={item.description}
                    onChange={(v) => updateItem(idx, "description", v)}
                    onSelect={(p) => {
                      setItems((prev) => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const unitPrice = Number(p.basePrice);
                        const fr = p.fiscalRegime === "reav" ? "reav" : "general";
                        const tr = Number(p.taxRate ?? 21);
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity, fiscalRegime: fr, taxRate: tr, productId: p.id };
                      }));
                    }}
                  />
                </div>
                <RegimeCell
                  item={item as QuoteLineItem}
                  onChange={(fr, tr) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: fr, taxRate: tr } : it))}
                />
                <Input
                  className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-center"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                />
                <Input
                  className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-right"
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-warning" : "text-warning"}`}>
                  {format.currency(item.total, "EUR", EUR2)}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="col-span-1 text-foreground/40 hover:text-danger p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{t("crmQuotes.opcional", { serviceDateLabel: voc.serviceDateLabel })}</span>
                <Input type="date" value={item.serviceDate ?? ""} onChange={(e) => updateItem(idx, "serviceDate", e.target.value)}
                  className="h-7 w-auto bg-foreground/[0.05] border-foreground/[0.12] text-white text-xs [color-scheme:dark]" />
                <span className="text-[10px] text-muted-foreground">{t("crmQuotes.vacioUsaLaDel", { toLowerCase: voc.serviceDateLabel.toLowerCase() })}</span>
              </div>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>

        {/* Código promocional */}
        <div className="bg-foreground/[0.05] rounded-xl p-3">
          <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmQuotes.codigoDeDescuentoOpcional")}</Label>
          {promoData ? (
            <div className="flex items-center justify-between bg-success/30 border border-success/40 rounded-lg px-3 py-2">
              <span className="font-mono font-bold text-success text-sm">{promoData.code} — -{promoData.discountPercent}%</span>
              <button onClick={() => { setPromoData(null); setPromoInput(""); }} className="text-foreground/50 hover:text-danger text-xs ml-2">{t("crmQuotes.quitar")}</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm font-mono uppercase"
                placeholder={t("crmQuotes.verano25")}
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && validatePromo.mutate({ code: promoInput })}
              />
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0" onClick={() => validatePromo.mutate({ code: promoInput })} disabled={validatePromo.isPending || !promoInput.trim()}>
                {validatePromo.isPending ? "..." : t("crmQuotes.aplicar")}
              </Button>
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponibleGeneral")}</span><span>{format.currency((discountedGeneral - taxAmount), "EUR", EUR2)}</span></div>
              <div className="flex justify-between text-sm text-warning/70"><span>{t("crmQuotes.subtotalReavSinIva")}</span><span>{format.currency((discountedSubtotal - discountedGeneral), "EUR", EUR2)}</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponible")}</span><span>{format.currency(baseImponible, "EUR", EUR2)}</span></div>
          )}
          {promoDiscount > 0 && (
            <div className="flex justify-between text-sm text-success"><span>{t("crmQuotes.descuento", { code: promoData?.code })}</span><span>-{format.currency(promoDiscount, "EUR", EUR2)}</span></div>
          )}
          {taxRowsB.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.ivaIncluidoEnEl", { rate: row.rate })}</span><span>{format.currency(row.amount, "EUR", EUR2)}</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-warning/70 italic">{t("crmQuotes.operacionReavNoProcede")}</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-foreground/[0.12] pt-2 mt-2">
            <span>{t("crmQuotes.total2")}</span><span className="text-warning text-xl">{format.currency(total, "EUR", EUR2)}</span>
          </div>
        </div>

        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.notasParaElCliente")}</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("crmQuotes.informacionAdicionalVisiblePar")}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1 resize-none h-16 text-sm"
          />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.condiciones")}</Label>
          <Textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-12 text-sm"
          />
        </div>
      </div>

      {/* ─── PLAN DE PAGO FRACCIONADO (opcional) ─── */}
      <div className="border border-foreground/[0.10] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPlanSection(!showPlanSection)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-foreground/[0.04] transition-colors"
        >
          <span className="flex items-center gap-2 text-primary font-medium">
            <CreditCard className="w-4 h-4" />{t("crmQuotes.planDePagoFraccionado")}{draftInstallments.length > 0 && (
              <span className="bg-primary/20 text-primary border border-primary/30 text-xs px-1.5 py-0.5 rounded-full">
                {t("crmQuotes.cuota2", { draftInstallmentsCount: draftInstallments.length })}
              </span>
            )}
          </span>
          <span className="text-foreground/40 text-xs">{showPlanSection ? t("crmQuotes.ocultar") : t("crmQuotes.opcional2")}</span>
        </button>
        {showPlanSection && (
          <div className="px-4 pb-4 space-y-3 border-t border-foreground/[0.08]">
            <p className="text-xs text-foreground/45 pt-3">{t("crmQuotes.defineLasCuotasAhora")}</p>
            {draftInstallments.map((inst, idx) => (
              <div key={idx} className="space-y-1.5 py-1.5 border-b border-foreground/[0.07] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-5 shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={t("crmQuotes.importe")}
                    value={inst._amountStr ?? (inst.amountCents > 0 ? (inst.amountCents / 100).toFixed(2) : "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cents = Math.round(parseFloat(val.replace(",", ".") || "0") * 100) || 0;
                      const updated = [...draftInstallments];
                      updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                      if (idx + 1 < updated.length) {
                        const totalCents = Math.round(total * 100);
                        const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                        const remaining = Math.max(0, totalCents - sumOthers);
                        updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                      }
                      setDraftInstallments(updated);
                    }}
                    className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white placeholder:text-foreground/40 focus:outline-none focus:border-primary/50"
                  />
                  <input
                    type="date"
                    value={inst.dueDate}
                    onChange={(e) => {
                      const updated = [...draftInstallments];
                      updated[idx] = { ...updated[idx], dueDate: e.target.value };
                      setDraftInstallments(updated);
                    }}
                    className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div className="flex items-center justify-between pl-7">
                  <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inst.isRequiredForConfirmation}
                      onChange={(e) => {
                        const updated = [...draftInstallments];
                        updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                        setDraftInstallments(updated);
                      }}
                      className="accent-primary shrink-0"
                    />{t("crmQuotes.cuotaInaplazable")}</label>
                  <button onClick={() => setDraftInstallments(draftInstallments.filter((_, i) => i !== idx))} className="text-danger hover:text-danger text-xs">{t("crmQuotes.eliminar")}</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const totalCents = Math.round(total * 100);
                const sumExisting = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                const remaining = Math.max(0, totalCents - sumExisting);
                setDraftInstallments([...draftInstallments, {
                  installmentNumber: draftInstallments.length + 1,
                  amountCents: remaining,
                  _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                  dueDate: "",
                  isRequiredForConfirmation: draftInstallments.length === 0,
                  notes: "",
                }]);
              }}
              className="text-xs text-primary hover:text-primary flex items-center gap-1"
            >{t("crmQuotes.anadirCuota")}</button>
            {draftInstallments.length > 0 && (() => {
              const sum = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
              const totalCents = Math.round(total * 100);
              const diff = Math.abs(sum - totalCents);
              return (
                <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <span>{t("crmQuotes.sumaCuotas", { formatEur: format.currency((sum / 100), "EUR", EUR2) })}</span>
                  <span>{t("crmQuotes.total3", { formatEur: format.currency(total, "EUR", EUR2) })}</span>
                  {diff > 1 && <span>{t("crmQuotes.dif", { formatEur: format.currency((diff / 100), "EUR", EUR2) })}</span>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">{t("crmQuotes.cancelar")}</Button>
        <Button
          size="sm"
          onClick={() => handleSubmit(false)}
          disabled={convertToQuote.isPending}
          className="bg-foreground/[0.08] hover:bg-foreground/[0.15] text-white border border-foreground/[0.15]"
        >
          {convertToQuote.isPending && !sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}{t("crmQuotes.guardarBorrador")}</Button>
        <Button
          size="sm"
          onClick={() => handleSubmit(true)}
          disabled={convertToQuote.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
        >
          {convertToQuote.isPending && sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}{t("crmQuotes.crearYEnviarAl")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}