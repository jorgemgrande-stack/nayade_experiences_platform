import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CatalogConceptSelector, type CatalogProduct } from "@/components/CatalogConceptSelector";
import { Search, Plus, CheckCircle, RefreshCw, Trash2, Pencil, Gift } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, QuoteLineItem, RegimeCell } from "../shared/crmCommon";
import { CrmFormSection } from "../shared/ui/CrmUi";

export function QuoteEditModal({
  quoteId,
  onClose,
}: {
  quoteId: number;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const { data, isLoading } = trpc.crm.quotes.get.useQuery({ id: quoteId });
  const [title, setTitle] = useState("");
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [validUntil, setValidUntil] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; serviceDate?: string }[]>([]);
  const [discount, setDiscount] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // ── Aplicar bono/código ──
  const [showBonoPanel, setShowBonoPanel] = useState(false);
  const [bonoCode, setBonoCode] = useState("");
  const [bonoQueryCode, setBonoQueryCode] = useState<string | null>(null);

  const { data: bonoPreview, isFetching: bonoFetching } = trpc.discounts.verifyVoucher.useQuery(
    { code: bonoQueryCode ?? "" },
    { enabled: !!bonoQueryCode }
  );

  const applyDiscountCodeMut = trpc.crm.timeline.applyDiscountCode.useMutation({
    onSuccess: (result) => {
      toast.success(t("crmQuotes.bonoAplicadoDescontados", { code: result.code, formatEur: format.currency(result.discountEur, "EUR", EUR2) }));
      setDiscount(result.discountEur);
      setShowBonoPanel(false);
      setBonoCode("");
      setBonoQueryCode(null);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  if (data && !initialized) {
    const q = data.quote;
    setTitle(q.title ?? "");
    setConditions(q.conditions ?? "");
    setNotes(q.notes ?? "");
    setTaxRate(q.tax ? parseFloat(String(q.tax)) : 21);
    setValidUntil(q.validUntil ? new Date(q.validUntil).toISOString().split("T")[0] : "");
    setActivityDate((q as any).activityDate ? String((q as any).activityDate).slice(0, 10) : "");
    const rawItems = (q.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; serviceDate?: string }[]) ?? [];
    setItems(rawItems.length > 0 ? rawItems : [{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }]);
    setDiscount(Number(q.discount ?? 0));
    setInitialized(true);
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotalEdit = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const discountedBase = Math.max(0, generalSubtotalEdit - discount);
  const taxRowsE = (() => {
    const discountRatio = generalSubtotalEdit > 0 ? discountedBase / generalSubtotalEdit : 1;
    const groups: Record<number, number> = {};
    items.filter(i => i.fiscalRegime !== "reav").forEach(item => {
      const rate = (item as any).taxRate ?? 21;
      groups[rate] = (groups[rate] ?? 0) + item.total * discountRatio;
    });
    return Object.entries(groups).map(([rateStr, gross]) => {
      const rate = Number(rateStr);
      const div = 1 + rate / 100;
      return { rate, amount: parseFloat((gross - gross / div).toFixed(2)) };
    }).sort((a, b) => b.rate - a.rate);
  })();
  const taxAmount = parseFloat(taxRowsE.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateE = taxRowsE.length === 1 ? taxRowsE[0].rate : taxRate;
  // El PVP de cada línea ya incluye el IVA: el total es la suma de líneas
  // menos el descuento; el IVA no se suma encima.
  const total = parseFloat((subtotal - discount).toFixed(2));
  const baseImponible = parseFloat((total - taxAmount).toFixed(2));

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") updated.total = Number(updated.quantity) * Number(updated.unitPrice);
      return updated;
    }));
  };

  // Seleccionar producto del catálogo: rellena descripción, precio y régimen
  const selectCatalogProduct = (idx: number, product: CatalogProduct) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = item.quantity || 1;
      const unitPrice = Number(product.basePrice);
      const fiscalRegime = product.fiscalRegime === "reav" ? "reav" : "general";
      return {
        ...item,
        description: product.title,
        unitPrice,
        fiscalRegime,
        taxRate: product.taxRate ? Number(product.taxRate) : 21,
        total: qty * unitPrice,
        productId: product.id,
      };
    }));
  };

  const updateQuote = trpc.crm.quotes.update.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.presupuestoActualizado"));
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.get.invalidate({ id: quoteId });
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  if (isLoading || !initialized) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-warning" />
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2">
          <Pencil className="w-4 h-4 text-warning" />{" "}{t("crmQuotes.editarPresupuesto")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <CrmFormSection title={t("crmOpps.seccionDatos")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.titulo")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{voc.serviceDateLabel}</Label>
            <Input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.validoHasta")}</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
          </div>
        </div>
        </CrmFormSection>
        <CrmFormSection title={t("crmOpps.seccionLineas")}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.conceptos")}</Label>
            <Button size="sm" variant="ghost" className="text-warning hover:text-warning text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }])}>
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
                <CatalogConceptSelector
                  value={item.description}
                  onChange={(v) => updateItem(idx, "description", v)}
                  onSelectProduct={(product) => selectCatalogProduct(idx, product)}
                  className="col-span-4"
                  inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm pr-8"
                  showBadge={false}
                />
                <RegimeCell
                  item={item as QuoteLineItem}
                  onChange={(fr, tr) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: fr, taxRate: tr } : it))}
                />
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-warning" : "text-warning"}`}>{format.currency(item.total, "EUR", EUR2)}</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-foreground/40 hover:text-danger p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 pl-1">
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{t("crmQuotes.opcional", { serviceDateLabel: voc.serviceDateLabel })}</span>
                <Input type="date" value={item.serviceDate ?? ""} onChange={(e) => updateItem(idx, "serviceDate", e.target.value)}
                  className="h-7 w-auto bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-xs [color-scheme:dark]" />
                <span className="text-[10px] text-muted-foreground">{t("crmQuotes.vacioUsaLaDel", { toLowerCase: voc.serviceDateLabel.toLowerCase() })}</span>
              </div>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>
        </CrmFormSection>
        <CrmFormSection title={t("crmOpps.seccionResumen")}>
        <div className="space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponibleGeneral")}</span><span>{format.currency((discountedBase - taxAmount), "EUR", EUR2)}</span></div>
              <div className="flex justify-between text-sm text-warning/70"><span>{t("crmQuotes.subtotalReavSinIva")}</span><span>{format.currency((subtotal - generalSubtotalEdit), "EUR", EUR2)}</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.baseImponible")}</span><span>{format.currency(baseImponible, "EUR", EUR2)}</span></div>
          )}
          {discount > 0 && (
            <div className="flex justify-between text-sm text-primary">
              <span className="flex items-center gap-1"><Gift className="w-3 h-3" />{" "}{t("crmQuotes.descuentoBono")}</span>
              <span>−{format.currency(discount, "EUR", EUR2)}</span>
            </div>
          )}
          {taxRowsE.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>{t("crmQuotes.ivaIncluidoEnEl", { rate: row.rate })}</span><span>{format.currency(row.amount, "EUR", EUR2)}</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-warning/70 italic">{t("crmQuotes.operacionReavNoProcede")}</div>
          )}
          <div className="flex justify-between text-base font-bold text-foreground border-t border-foreground/[0.12] pt-2">
            <span>{t("crmQuotes.total2")}</span><span className="text-primary text-xl">{format.currency(total, "EUR", EUR2)}</span>
          </div>
        </div>
        </CrmFormSection>

        {/* ── Panel: Aplicar bono / código de descuento ── */}
        {discount === 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
            <button
              type="button"
              className="w-full flex items-center justify-between text-xs font-semibold text-primary uppercase tracking-wider"
              onClick={() => setShowBonoPanel((v) => !v)}
            >
              <span className="flex items-center gap-2"><Gift className="w-3.5 h-3.5" />{" "}{t("crmQuotes.aplicarBonoCodigoDe")}</span>
              <span className="text-primary/60">{showBonoPanel ? "▲" : "▼"}</span>
            </button>
            {showBonoPanel && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={bonoCode}
                    onChange={(e) => { setBonoCode(e.target.value.toUpperCase()); setBonoQueryCode(null); }}
                    placeholder={t("crmQuotes.ejBonA1b2C3d4")}
                    className="bg-background border-foreground/[0.12] text-foreground placeholder:text-muted-foreground font-mono text-xs h-8 flex-1"
                    spellCheck={false}
                  />
                  <Button size="sm" variant="outline"
                    className="border-primary/30 text-primary hover:bg-primary/10 h-8 px-3"
                    disabled={bonoCode.trim().length < 3 || bonoFetching}
                    onClick={() => setBonoQueryCode(bonoCode.trim())}
                  >
                    {bonoFetching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  </Button>
                </div>
                {bonoPreview && !bonoPreview.found && (
                  <p className="text-danger text-xs">{t("crmQuotes.codigoNoEncontrado")}</p>
                )}
                {bonoPreview?.found && (
                  <div className={`rounded-lg border p-3 space-y-2 text-xs ${
                    bonoPreview.status === "canjeado" ? "border-gray-500/20 bg-muted" :
                    bonoPreview.status === "caducado" ? "border-danger/20 bg-danger/5" :
                    "border-primary/20 bg-primary/5"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-foreground">{bonoPreview.code}</span>
                      <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${
                        bonoPreview.status === "canjeado" ? "text-muted-foreground bg-muted" :
                        bonoPreview.status === "caducado" ? "text-danger bg-danger/10" :
                        "text-primary bg-primary/10"
                      }`}>
                        {bonoPreview.status === "canjeado" ? t("crmQuotes.yaCanjeado") : bonoPreview.status === "caducado" ? t("crmQuotes.caducado") : t("crmQuotes.activo")}
                      </span>
                    </div>
                    {bonoPreview.value > 0 && <p className="text-foreground font-bold">{t("crmQuotes.deDescuento", { formatEur: format.currency(bonoPreview.value, "EUR", EUR2) })}</p>}
                    {bonoPreview.activityName && <p className="text-foreground/50">{bonoPreview.activityName}</p>}
                    {(bonoPreview.status === "enviado" || bonoPreview.status === "generado") && (
                      <Button size="sm" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-7"
                        disabled={applyDiscountCodeMut.isPending}
                        onClick={() => applyDiscountCodeMut.mutate({ id: quoteId, code: bonoPreview.code })}
                      >
                        {applyDiscountCodeMut.isPending ? t("crmQuotes.aplicando") : t("crmQuotes.confirmarDescontar", { formatEur: format.currency(bonoPreview.value, "EUR", EUR2) })}
                      </Button>
                    )}
                    {bonoPreview.status !== "enviado" && bonoPreview.status !== "generado" && (
                      <p className="text-danger">{t("crmQuotes.esteBonoNoPuede", { status: bonoPreview.status })}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <CrmFormSection title={t("crmOpps.seccionCondiciones")}>
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.notasParaElCliente")}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">{t("crmQuotes.condiciones")}</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1 resize-none h-12 text-sm" />
        </div>
        </CrmFormSection>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>{t("crmQuotes.cancelar")}</Button>
        <Button
          size="sm"
          onClick={() => updateQuote.mutate({ id: quoteId, title, conditions, notes, items: items.map(i => ({ ...i, taxRate: (i as any).taxRate ?? 21 })), subtotal: baseImponible, discount, taxRate: effectiveTaxRateE, total, validUntil, activityDate: activityDate || null })}
          disabled={updateQuote.isPending}
        >
          {updateQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}{t("crmQuotes.guardarCambios")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}