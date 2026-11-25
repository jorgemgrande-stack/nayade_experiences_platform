import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary, useVocabularyDefault } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { validateQuote, hasErrors, type FieldErrors } from "@shared/crmForms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { User, FileText, Search, Plus, Send, RefreshCw, Trash2, CreditCard } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, toastQuoteMail, FieldError, invalidProps, ProductSearchInput, QuoteLineItem, RegimeCell } from "../shared/crmCommon";
import { CrmFormSection } from "../shared/ui/CrmUi";

export function DirectQuoteModal({ onClose }: { onClose: () => void }) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [errors, setErrors] = useState<FieldErrors<"name" | "email" | "phone" | "lines">>({});

  // Paso 1: datos del cliente
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  // Paso 2: líneas de presupuesto
  const [title, setTitle] = useState("Presupuesto");
  const [conditions, setConditions] = useVocabularyDefault(voc.quoteConditions);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });
  const [activityDate, setActivityDate] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; serviceDate?: string }[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
  // Plan de pago fraccionado (draft local)
  const [showPlanSectionD, setShowPlanSectionD] = useState(false);
  type DraftInstD = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallmentsD, setDraftInstallmentsD] = useState<DraftInstD[]>([]);
  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [promoData, setPromoData] = useState<{ id: number; code: string; discountPercent: number } | null>(null);
  const validatePromo = trpc.discounts.validate.useMutation({
    onSuccess: (d) => setPromoData({ id: d.id, code: d.code, discountPercent: d.discountPercent }),
    onError: (e) => { toast.error(errorToastMessage(e)); setPromoData(null); },
  });

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const promoDiscount = promoData ? parseFloat((subtotal * promoData.discountPercent / 100).toFixed(2)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - promoDiscount);
  const discountedGeneral = Math.max(0, generalSubtotal - (promoData ? parseFloat((generalSubtotal * promoData.discountPercent / 100).toFixed(2)) : 0));
  // Multi-rate breakdown
  const taxRowsD = (() => {
    const promoRatio = generalSubtotal > 0 ? discountedGeneral / generalSubtotal : 1;
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
  const taxAmount = parseFloat(taxRowsD.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateD = taxRowsD.length === 1 ? taxRowsD[0].rate : taxRate;
  // El PVP de cada línea ya incluye el IVA: el total es la suma de líneas
  // (no se suma el IVA encima). La base imponible se obtiene extrayéndolo.
  const total = parseFloat(discountedSubtotal.toFixed(2));
  const baseImponible = parseFloat((total - taxAmount).toFixed(2));

  // Búsqueda de clientes existentes (en servidor, con una pequeña espera mientras se escribe)
  const [clientQuery, setClientQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setClientQuery(clientSearch.trim()), 250); return () => clearTimeout(t); }, [clientSearch]);
  const { data: clientSuggestionsRaw } = trpc.crm.clients.list.useQuery(
    { search: clientQuery, limit: 6 },
    { enabled: clientQuery.length >= 2 }
  );
  const clientSuggestions = clientSuggestionsRaw?.items ?? [];

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

  const upsertPlanDirect = trpc.crm.paymentPlans.upsert.useMutation({
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido guardar el plan de pago.")),
  });

  const createDirect = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: async (data) => {
      if (draftInstallmentsD.length > 0) {
        await upsertPlanDirect.mutateAsync({
          quoteId: data.quoteId,
          installments: draftInstallmentsD.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
        });
        toast.success(t("crmQuotes.presupuestoCreadoConPlan", { quoteNumber: data.quoteNumber, draftInstallmentsDCount: draftInstallmentsD.length }));
      } else {
        if (data.sent) toastQuoteMail(data, t("crmQuotes.presupuestoCreadoYEnviado", { quoteNumber: data.quoteNumber }));
        else toast.success(t("crmQuotes.presupuestoGuardadoComoBorrado", { quoteNumber: data.quoteNumber }));
      }
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const handleSubmit = (andSend: boolean) => {
    const errs = validateQuote({ name: clientName, email: clientEmail, phone: clientPhone, hasLines: items.length > 0 && items.every((i) => i.description.trim()) });
    if (errs.lines) errs.lines = "Completa la descripción de todos los conceptos.";
    setErrors(errs);
    if (hasErrors(errs)) {
      toast.error(t("crmQuotes.revisaLosCamposMarcados"));
      return;
    }
    if (draftInstallmentsD.some(i => !i.dueDate || i.amountCents <= 0)) {
      toast.error(t("crmQuotes.completaElImporteY"));
      return;
    }
    setSendAfterCreate(andSend);
    createDirect.mutate({
      clientName,
      clientEmail,
      clientPhone: clientPhone || undefined,
      clientCompany: clientCompany || undefined,
      title,
      items: items.map(i => ({ ...i, taxRate: (i as any).taxRate ?? 21 })),
      subtotal: baseImponible,
      discount: promoDiscount,
      taxRate: effectiveTaxRateD,
      total,
      validUntil,
      activityDate: activityDate || null,
      notes: promoData ? t("crmQuotes.codigo", { code: promoData.code, discountPercent: promoData.discountPercent, v: notes ? "\n" + notes : "" }) : notes || undefined,
      conditions,
      sendNow: andSend,
      origin: window.location.origin,
    });
  };

  const selectClient = (c: { name: string; email: string; phone?: string | null; company?: string | null }) => {
    setClientName(c.name);
    setClientEmail(c.email);
    setClientPhone(c.phone ?? "");
    setClientCompany(c.company ?? "");
    setClientSearch("");
    setShowClientSuggestions(false);
    setTitle(`Presupuesto - ${c.name}`);
  };

  return (
    <>
    {/* *:min-w-0: la tabla de conceptos (con su propio scroll horizontal) no ensancha el diálogo en el móvil */}
    <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto *:min-w-0">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2 pr-6">
          <Plus className="w-5 h-5 text-warning" /> {voc.licensed ? t("crmQuotes.nuevoPresupuesto2") : t("crmQuotes.nuevoPresupuesto")}
          <span className="hidden sm:inline text-foreground/50 text-sm font-normal ml-1">{voc.agreeLead(t("crmQuotes.sinLeadPrevio", { lead: voc.lead }), t("crmQuotes.sinLeadPrevia", { lead: voc.lead }))}</span>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* ── Sección cliente ── */}
        <CrmFormSection title={t("crmQuotes.datosDelCliente")}>

          {/* Buscador de cliente existente */}
          <div className="relative">
            <Label htmlFor="new-quote-client-search" className="text-foreground/65 text-xs">{t("crmQuotes.buscarClienteExistente")}</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" aria-hidden="true" />
              <Input
                id="new-quote-client-search"
                className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm"
                placeholder={t("crmQuotes.nombreOEmailDel")}
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setShowClientSuggestions(true); }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
              />
            </div>
            {showClientSuggestions && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border border-foreground/[0.12] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {clientSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-foreground/[0.08] flex items-center justify-between gap-2"
                    onMouseDown={() => selectClient(c)}
                  >
                    <div>
                      <div className="text-sm text-foreground font-medium">{c.name}</div>
                      <div className="text-xs text-foreground/50">{c.email}</div>
                    </div>
                    {c.company && <span className="text-xs text-foreground/40 shrink-0">{c.company}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-foreground/40 text-center">{t("crmQuotes.oIntroduceLosDatos")}</div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-quote-name" className="text-foreground/65 text-xs">{t("crmQuotes.nombre")}</Label>
              <Input id="new-quote-name" required value={clientName} onChange={(e) => { setClientName(e.target.value); setTitle(`Presupuesto - ${e.target.value}`); }}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 text-sm" placeholder={t("crmQuotes.nombreCompleto")} {...invalidProps(errors.name, "new-quote-name-error")} />
              <FieldError id="new-quote-name-error" msg={errors.name} />
            </div>
            <div>
              <Label htmlFor="new-quote-email" className="text-foreground/65 text-xs">{t("crmQuotes.email")}</Label>
              <Input id="new-quote-email" required type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 text-sm" placeholder="cliente@email.com" {...invalidProps(errors.email, "new-quote-email-error")} />
              <FieldError id="new-quote-email-error" msg={errors.email} />
            </div>
            <div>
              <Label htmlFor="new-quote-phone" className="text-foreground/65 text-xs">{t("crmQuotes.telefono")}</Label>
              <Input id="new-quote-phone" type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 text-sm" placeholder="+34 600 000 000" {...invalidProps(errors.phone, "new-quote-phone-error")} />
              <FieldError id="new-quote-phone-error" msg={errors.phone} />
            </div>
            <div>
              <Label htmlFor="new-quote-company" className="text-foreground/65 text-xs">{t("crmQuotes.empresa")}</Label>
              <Input id="new-quote-company" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 text-sm" placeholder={t("crmQuotes.nombreEmpresaOpcional")} />
            </div>
          </div>
        </CrmFormSection>

        {/* ── Asunto y fechas ── */}
        <CrmFormSection title={t("crmOpps.seccionDatos")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="new-quote-title" className="text-foreground/65 text-xs">{t("crmQuotes.asuntoDelPresupuesto")}</Label>
            <Input id="new-quote-title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 text-sm" />
          </div>
          <div>
            <Label htmlFor="new-quote-date" className="text-foreground/65 text-xs">{voc.serviceDateLabel}</Label>
            <Input id="new-quote-date" type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label htmlFor="new-quote-valid" className="text-foreground/65 text-xs">{t("crmQuotes.validoHasta")}</Label>
            <Input id="new-quote-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
        </div>

        </CrmFormSection>

        {/* ── Conceptos ── */}
        <CrmFormSection title={t("crmOpps.seccionLineas")}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.conceptos")}{" "}<span className="text-foreground/40">{t("crmQuotes.escribeOBuscaUn")}</span></Label>
            <Button size="sm" variant="ghost" className="text-warning hover:text-warning text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}>
              <Plus className="w-3 h-3 mr-1" />{" "}{t("crmQuotes.anadirLinea")}</Button>
          </div>
          <FieldError id="new-quote-lines-error" msg={errors.lines} />
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
                <Input aria-label={t("crmQuotes.cantidadDeLaLinea", { v: idx + 1 })} className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input aria-label={t("crmQuotes.precioUnitarioDeLa", { v: idx + 1 })} className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-warning" : "text-warning"}`}>{format.currency(item.total, "EUR", EUR2)}</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-foreground/40 hover:text-danger p-1" aria-label={t("crmQuotes.quitarLaLinea", { v: idx + 1 })}
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <label htmlFor={`new-quote-line-date-${idx}`} className="text-xs text-muted-foreground whitespace-nowrap">{t("crmQuotes.opcional", { serviceDateLabel: voc.serviceDateLabel })}</label>
                <Input id={`new-quote-line-date-${idx}`} type="date" value={item.serviceDate ?? ""} onChange={(e) => updateItem(idx, "serviceDate", e.target.value)}
                  className="h-7 w-auto bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-xs [color-scheme:dark]" />
                <span className="text-xs text-muted-foreground">{t("crmQuotes.vacioUsaLaDel", { toLowerCase: voc.serviceDateLabel.toLowerCase() })}</span>
              </div>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>
        </CrmFormSection>

        {/* Totales */}
        <CrmFormSection title={t("crmOpps.seccionResumen")}>
        <div className="space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponibleGeneral")}</span><span>{format.currency((discountedGeneral - taxAmount), "EUR", EUR2)}</span></div>
              <div className="flex justify-between text-sm text-warning/70"><span>{t("crmQuotes.subtotalReavSinIva")}</span><span>{format.currency((discountedSubtotal - discountedGeneral), "EUR", EUR2)}</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponible")}</span><span>{format.currency(baseImponible, "EUR", EUR2)}</span></div>
          )}
          {taxRowsD.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.ivaIncluidoEnEl", { rate: row.rate })}</span><span>{format.currency(row.amount, "EUR", EUR2)}</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-warning/70 italic">{t("crmQuotes.operacionReavNoProcede")}</div>
          )}
          <div className="flex justify-between text-base font-bold text-foreground border-t border-foreground/[0.12] pt-2 mt-2">
            <span>{t("crmQuotes.total2")}</span><span className="text-primary text-xl">{format.currency(total, "EUR", EUR2)}</span>
          </div>
        </div>
        </CrmFormSection>

        <CrmFormSection title={t("crmOpps.seccionCondiciones")}>
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.notasParaElCliente")}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={t("crmQuotes.informacionAdicionalVisiblePar")}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.condiciones")}</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 resize-none h-12 text-sm" />
        </div>
        </CrmFormSection>
      </div>

      {/* ─── PLAN DE PAGO FRACCIONADO (opcional) ─── */}
      <div className="border border-foreground/[0.10] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPlanSectionD(!showPlanSectionD)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-foreground/[0.04] transition-colors"
        >
          <span className="flex items-center gap-2 text-primary font-medium">
            <CreditCard className="w-4 h-4" />{t("crmQuotes.planDePagoFraccionado")}{draftInstallmentsD.length > 0 && (
              <span className="bg-primary/20 text-primary border border-primary/30 text-xs px-1.5 py-0.5 rounded-full">
                {t("crmQuotes.cuota", { draftInstallmentsDCount: draftInstallmentsD.length })}
              </span>
            )}
          </span>
          <span className="text-foreground/40 text-xs">{showPlanSectionD ? t("crmQuotes.ocultar") : t("crmQuotes.opcional2")}</span>
        </button>
        {showPlanSectionD && (
          <div className="px-4 pb-4 space-y-3 border-t border-foreground/[0.08]">
            <p className="text-xs text-foreground/45 pt-3">{t("crmQuotes.defineLasCuotasAhora")}</p>
            {draftInstallmentsD.map((inst, idx) => (
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
                      const updated = [...draftInstallmentsD];
                      updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                      if (idx + 1 < updated.length) {
                        const totalCents = Math.round(total * 100);
                        const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                        const remaining = Math.max(0, totalCents - sumOthers);
                        updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                      }
                      setDraftInstallmentsD(updated);
                    }}
                    className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/50"
                  />
                  <input
                    type="date"
                    value={inst.dueDate}
                    onChange={(e) => {
                      const updated = [...draftInstallmentsD];
                      updated[idx] = { ...updated[idx], dueDate: e.target.value };
                      setDraftInstallmentsD(updated);
                    }}
                    className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div className="flex items-center justify-between pl-7">
                  <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inst.isRequiredForConfirmation}
                      onChange={(e) => {
                        const updated = [...draftInstallmentsD];
                        updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                        setDraftInstallmentsD(updated);
                      }}
                      className="accent-primary shrink-0"
                    />{t("crmQuotes.cuotaInaplazable")}</label>
                  <button onClick={() => setDraftInstallmentsD(draftInstallmentsD.filter((_, i) => i !== idx))} className="text-danger hover:text-danger text-xs">{t("crmQuotes.eliminar")}</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const totalCents = Math.round(total * 100);
                const sumExisting = draftInstallmentsD.reduce((s, i) => s + i.amountCents, 0);
                const remaining = Math.max(0, totalCents - sumExisting);
                setDraftInstallmentsD([...draftInstallmentsD, {
                  installmentNumber: draftInstallmentsD.length + 1,
                  amountCents: remaining,
                  _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                  dueDate: "",
                  isRequiredForConfirmation: draftInstallmentsD.length === 0,
                  notes: "",
                }]);
              }}
              className="text-xs text-primary hover:text-primary flex items-center gap-1"
            >{t("crmQuotes.anadirCuota")}</button>
            {draftInstallmentsD.length > 0 && (() => {
              const sum = draftInstallmentsD.reduce((s, i) => s + i.amountCents, 0);
              const totalCents = Math.round(total * 100);
              const diff = Math.abs(sum - totalCents);
              return (
                <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <span>{t("crmQuotes.suma", { formatEur: format.currency((sum / 100), "EUR", EUR2) })}</span>
                  <span>{t("crmQuotes.total3", { formatEur: format.currency(total, "EUR", EUR2) })}</span>
                  {diff > 1 && <span>{t("crmQuotes.dif", { formatEur: format.currency((diff / 100), "EUR", EUR2) })}</span>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 flex-wrap sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-border bg-card px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>{t("crmQuotes.cancelar")}</Button>
        <Button variant="outline" size="sm" onClick={() => handleSubmit(false)} disabled={createDirect.isPending}>
          {createDirect.isPending && !sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}{t("crmQuotes.guardarBorrador")}</Button>
        <Button size="sm" onClick={() => handleSubmit(true)} disabled={createDirect.isPending}>
          {createDirect.isPending && sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}{t("crmQuotes.crearYEnviarAl")}</Button>
      </DialogFooter>
    </DialogContent>
    </>
  );
}