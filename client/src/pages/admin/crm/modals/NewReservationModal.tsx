import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { validateContact, validateOrder, hasErrors, type FieldErrors } from "@shared/crmForms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarCheck, X, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, FieldError, invalidProps } from "../shared/crmCommon";

// ─── NEW RESERVATION MODAL (creación manual de reserva por admin) ─────────────
export function NewReservationModal({ onClose }: { onClose: () => void }) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [errors, setErrors] = useState<FieldErrors<"name" | "email" | "phone" | "product" | "date" | "amount">>({});
  const [clientErrors, setClientErrors] = useState<FieldErrors<"name" | "email" | "phone">>({});

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showClientSugg, setShowClientSugg] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState("");
  const [productPricingType, setProductPricingType] = useState<"per_person" | "per_unit">("per_person");
  const [showProductSugg, setShowProductSugg] = useState(false);

  const [bookingDate, setBookingDate] = useState("");
  const [people, setPeople] = useState(2);

  const [amountTotal, setAmountTotal] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "transferencia" | "redsys" | "otro">("efectivo");
  const [channel, setChannel] = useState<"VENTA_DELEGADA" | "TELEFONO" | "EMAIL" | "MANUAL">("VENTA_DELEGADA");
  const [notes, setNotes] = useState("");
  const [sendEmailConfirm, setSendEmailConfirm] = useState(true);

  // ── Crear nuevo cliente inline ──────────────────────────────────────────────
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientCompany, setNewClientCompany] = useState("");

  const createClientMutation = trpc.crm.clients.create.useMutation({
    onSuccess: () => {
      setCustomerName(newClientName.trim());
      setCustomerEmail(newClientEmail.trim());
      setCustomerPhone(newClientPhone.trim());
      setClientSearch("");
      setShowClientSugg(false);
      setShowCreateClient(false);
      toast.success(t("crmReservations.clienteCreadoYSeleccionado"));
    },
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido crear el cliente.")),
  });

  const handleCreateClient = () => {
    const errs = validateContact({ name: newClientName, email: newClientEmail, phone: newClientPhone });
    setClientErrors(errs);
    if (hasErrors(errs)) return;
    createClientMutation.mutate({
      name: newClientName.trim(),
      email: newClientEmail.trim(),
      phone: newClientPhone.trim() || undefined,
      company: newClientCompany.trim() || undefined,
    });
  };

  // Búsqueda en servidor con una pequeña espera mientras se escribe
  const [clientQuery, setClientQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setClientQuery(clientSearch.trim()), 250); return () => clearTimeout(t); }, [clientSearch]);
  useEffect(() => { const t = setTimeout(() => setProductQuery(productSearch.trim()), 250); return () => clearTimeout(t); }, [productSearch]);

  const { data: clientSuggestionsRaw } = trpc.crm.clients.list.useQuery(
    { search: clientQuery, limit: 6 },
    { enabled: clientQuery.length >= 2 }
  );
  const clientSuggestions = clientSuggestionsRaw?.items ?? [];

  const { data: productResults, isFetching: productsFetching } = trpc.crm.products.search.useQuery(
    { q: productQuery || undefined, limit: 20 },
    { placeholderData: (prev) => prev },
  );
  const productSuggestions = (productResults ?? []) as any[];

  const createManual = trpc.crm.reservations.createManual.useMutation({
    onSuccess: (data) => {
      toast.success(voc.agree(t("crmEmpty.toast.orderCreatedInvoiceM", { order: voc.Order, number: data.merchantOrder, invoice: data.invoiceNumber }), t("crmEmpty.toast.orderCreatedInvoiceF", { order: voc.Order, number: data.merchantOrder, invoice: data.invoiceNumber })));
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const handleSubmit = () => {
    const total = parseFloat(amountTotal);
    const paid = parseFloat(amountPaid || amountTotal);
    const errs = validateOrder(
      { name: customerName, email: customerEmail, phone: customerPhone, productId: productName ? productId : null, bookingDate, amount: total },
      { date: voc.serviceDate },
    );
    setErrors(errs);
    if (hasErrors(errs)) { toast.error(t("crmReservations.revisaLosCamposMarcados")); return; }
    if (!productId) return;
    createManual.mutate({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim() || undefined,
      productId,
      productName,
      bookingDate,
      people,
      amountTotal: total,
      amountPaid: isNaN(paid) ? total : paid,
      paymentMethod,
      notes: notes.trim() || undefined,
      channel,
      sendConfirmationEmail: sendEmailConfirm,
    });
  };

  return (
    <DialogContent className="max-w-xl bg-card border-border text-foreground max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-foreground flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-success" /> {voc.newOrder}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {/* Cliente */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t("crmReservations.cliente")}</p>

          {/* Búsqueda de cliente existente — se oculta cuando hay cliente seleccionado o se está creando */}
          {!customerName && !showCreateClient && (
            <div className="relative">
              <Label htmlFor="new-order-client" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.nombreCompleto")}</Label>
              <Input
                id="new-order-client"
                {...invalidProps(errors.name, "new-order-client-error")}
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setShowClientSugg(true); }}
                onFocus={() => setShowClientSugg(true)}
                placeholder={t("crmReservations.buscarClienteExistenteO")}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground"
              />
              {showClientSugg && clientSuggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {clientSuggestions.map((c) => (
                    <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-foreground/[0.07] text-sm text-foreground"
                      onClick={() => { setCustomerName(c.name); setCustomerEmail(c.email ?? ""); setCustomerPhone(c.phone ?? ""); setClientSearch(""); setShowClientSugg(false); }}>
                      <span className="font-medium">{c.name}</span>
                      <span className="text-foreground/50 ml-2 text-xs">{c.email}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Botón crear nuevo cliente — aparece cuando hay texto pero no hay sugerencias seleccionadas */}
              {clientSearch.length >= 1 && !showCreateClient && (
                <button
                  type="button"
                  onClick={() => { setNewClientName(clientSearch); setNewClientEmail(""); setNewClientPhone(""); setNewClientCompany(""); setShowClientSugg(false); setShowCreateClient(true); }}
                  className="mt-2 w-full flex items-center gap-2 text-sm text-success hover:text-success border border-dashed border-success/40 hover:border-success/70 rounded-lg px-3 py-2 transition-colors"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />{t("crmReservations.crearNuevoCliente", { clientSearch })}</button>
              )}
              <FieldError id="new-order-client-error" msg={errors.name} />
            </div>
          )}

          {/* Cliente seleccionado — mostrar resumen con opción de cambiar */}
          {customerName && !showCreateClient && (
            <div className="flex items-center justify-between bg-success/10 border border-success/25 rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium text-success">{customerName}</p>
                {customerEmail && <p className="text-xs text-foreground/50">{customerEmail}</p>}
              </div>
              <button type="button" onClick={() => { setCustomerName(""); setCustomerEmail(""); setCustomerPhone(""); setClientSearch(""); }} className="text-xs text-foreground/40 hover:text-foreground/70 underline underline-offset-2">{t("crmReservations.cambiar")}</button>
            </div>
          )}

          {/* Formulario inline de nuevo cliente */}
          {showCreateClient && (
            <div className="bg-success/10 border border-success/25 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-success uppercase tracking-wider flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />{" "}{t("crmReservations.nuevoCliente")}</p>
                <button type="button" onClick={() => setShowCreateClient(false)} className="text-foreground/40 hover:text-foreground/70" aria-label={t("crmReservations.cerrarElAltaDe")}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="new-client-name" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.nombreCompleto")}</Label>
                  <Input id="new-client-name" required value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder={t("crmReservations.nombreCompleto2")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground h-8 text-sm" {...invalidProps(clientErrors.name, "new-client-name-error")} />
                  <FieldError id="new-client-name-error" msg={clientErrors.name} />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="new-client-email" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.email")}</Label>
                  <Input id="new-client-email" required type="email" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} placeholder="cliente@email.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground h-8 text-sm" {...invalidProps(clientErrors.email, "new-client-email-error")} />
                  <FieldError id="new-client-email-error" msg={clientErrors.email} />
                </div>
                <div>
                  <Label htmlFor="new-client-phone" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.telefono")}</Label>
                  <Input id="new-client-phone" type="tel" value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground h-8 text-sm" {...invalidProps(clientErrors.phone, "new-client-phone-error")} />
                  <FieldError id="new-client-phone-error" msg={clientErrors.phone} />
                </div>
                <div>
                  <Label htmlFor="new-client-company" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.empresa")}</Label>
                  <Input id="new-client-company" value={newClientCompany} onChange={e => setNewClientCompany(e.target.value)} placeholder={t("crmReservations.opcional")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground h-8 text-sm" />
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleCreateClient}
                disabled={createClientMutation.isPending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-8"
              >
                {createClientMutation.isPending ? t("crmReservations.creando") : t("crmReservations.crearYUsarEste")}
              </Button>
            </div>
          )}

          {/* Campos email/teléfono — visibles cuando hay cliente seleccionado */}
          {customerName && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-order-email" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.email")}</Label>
                <Input id="new-order-email" required type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="cliente@email.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.email, "new-order-email-error")} />
                <FieldError id="new-order-email-error" msg={errors.email} />
              </div>
              <div>
                <Label htmlFor="new-order-phone" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.telefono")}</Label>
                <Input id="new-order-phone" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.phone, "new-order-phone-error")} />
                <FieldError id="new-order-phone-error" msg={errors.phone} />
              </div>
            </div>
          )}
        </div>
        {/* Producto */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t("crmReservations.productoServicio")}</p>
          <div className="relative">
            <Label htmlFor="new-order-product" className="text-xs text-foreground/60 mb-1 block">{voc.productRequired}</Label>
            {productName ? (
              <div className="flex items-center justify-between bg-success/10 border border-success/25 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-success">{productName}</p>
                  <p className="text-xs text-foreground/50 mt-0.5">
                    {productPricingType === "per_person" ? t("crmReservations.precioPorPersona") : t("crmReservations.precioPorUnidad")}
                  </p>
                </div>
                <button type="button" onClick={() => { setProductId(null); setProductName(""); setProductSearch(""); setProductPricingType("per_person"); setAmountTotal(""); setAmountPaid(""); }} className="text-xs text-foreground/40 hover:text-foreground/70 underline underline-offset-2">{t("crmReservations.cambiar")}</button>
              </div>
            ) : (
              <>
                <Input
                  id="new-order-product"
                  {...invalidProps(errors.product, "new-order-product-error")}
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); setShowProductSugg(true); }}
                  onFocus={() => setShowProductSugg(true)}
                  onBlur={() => setTimeout(() => setShowProductSugg(false), 150)}
                  placeholder={voc.licensed ? voc.productSearch : t("crmReservations.buscarProductoOActividad")}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground"
                />
                {showProductSugg && productSuggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {productSuggestions.map((p: any) => {
                      const base = Number(p.basePrice ?? 0);
                      const pricing = p.pricingType ?? "per_person";
                      const priceLabel = base > 0
                        ? `${format.currency(base, "EUR", EUR2)}${pricing === "per_person" ? "/pers" : "/ud"}`
                        : null;
                      return (
                        <button key={`${p.productType}-${p.id}`} type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-foreground/[0.07] text-sm text-foreground flex items-center gap-2.5 border-b border-foreground/[0.05] last:border-0"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setProductId(p.id);
                            setProductName(p.title);
                            setProductPricingType(pricing);
                            if (base > 0) {
                              const total = pricing === "per_person" ? base * people : base;
                              setAmountTotal(total.toFixed(2));
                              setAmountPaid(total.toFixed(2));
                            }
                            setProductSearch("");
                            setShowProductSugg(false);
                          }}>
                          <span className="text-base leading-none" aria-hidden="true">{voc.licensed ? "📦" : p.productType === "experience" ? "🏊" : "📦"}</span>
                          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{p.title}</span>
                          {priceLabel && <span className="text-foreground/50 text-xs shrink-0">{priceLabel}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {showProductSugg && productQuery.length > 0 && !productsFetching && productSuggestions.length === 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg px-3 py-3 text-sm text-foreground/40">{t("crmReservations.sinResultadosPara", { productQuery })}</div>
                )}
              </>
            )}
            <FieldError id="new-order-product-error" msg={errors.product} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-order-date" className="text-xs text-foreground/60 mb-1 block">{voc.licensed ? voc.serviceDate : t("crmReservations.fechaDelServicio")} *</Label>
              <Input id="new-order-date" required type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" {...invalidProps(errors.date, "new-order-date-error")} />
              <FieldError id="new-order-date-error" msg={errors.date} />
            </div>
            <div>
              <Label htmlFor="new-order-people" className="text-xs text-foreground/60 mb-1 block">{voc.licensed ? t("crmReservations.cantidad") : t("crmReservations.nPersonas")}</Label>
              <Input id="new-order-people" type="number" min={1} value={people} onChange={e => setPeople(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" />
            </div>
          </div>
        </div>
        {/* Económico */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t("crmReservations.datosEconomicos")}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-order-total" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.importeTotal")}</Label>
              <Input id="new-order-total" required type="number" min={0} step="0.01" value={amountTotal} onChange={e => setAmountTotal(e.target.value)} placeholder="0.00" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" {...invalidProps(errors.amount, "new-order-total-error")} />
              <FieldError id="new-order-total-error" msg={errors.amount} />
            </div>
            <div>
              <Label htmlFor="new-order-paid" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.importeCobrado")}</Label>
              <Input id="new-order-paid" type="number" min={0} step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder={t("crmReservations.igualAlTotalSi")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-order-payment" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.metodoDePago")}</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <SelectTrigger id="new-order-payment" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="efectivo" className="text-foreground text-xs">{t("crmReservations.efectivo")}</SelectItem>
                  <SelectItem value="transferencia" className="text-foreground text-xs">{t("crmReservations.transferencia")}</SelectItem>
                  <SelectItem value="tarjeta_fisica" className="text-foreground text-xs">💳 {voc.licensed ? t("crmReservations.tarjetaEnDatafono") : t("crmReservations.tarjetaFisica")}</SelectItem>
                  <SelectItem value="tarjeta_redsys" className="text-foreground text-xs">💳 {voc.licensed ? t("crmReservations.tarjetaPagoOnline") : t("crmReservations.tarjetaRedsys")}</SelectItem>
                  {!voc.licensed && <SelectItem value="redsys" className="text-foreground text-xs">{t("crmReservations.tarjetaRedsysLegacy")}</SelectItem>}
                  <SelectItem value="otro" className="text-foreground text-xs">{t("crmReservations.otro")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-order-channel" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.canal")}</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger id="new-order-channel" className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="VENTA_DELEGADA" className="text-foreground text-xs">{voc.licensed ? t("crmReservations.altaDesdeElPanel") : t("crmReservations.crmAdmin")}</SelectItem>
                  <SelectItem value="TELEFONO" className="text-foreground text-xs">{t("crmReservations.telefono2")}</SelectItem>
                  <SelectItem value="EMAIL" className="text-foreground text-xs">{t("crmReservations.email2")}</SelectItem>
                  <SelectItem value="MANUAL" className="text-foreground text-xs">{t("crmReservations.otro")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="new-order-notes" className="text-xs text-foreground/60 mb-1 block">{t("crmReservations.notasInternas")}</Label>
          <Textarea id="new-order-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("crmReservations.notasParaElEquipo")} rows={2} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-muted-foreground resize-none" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={sendEmailConfirm} onChange={e => setSendEmailConfirm(e.target.checked)} className="rounded" />
          <span className="text-sm text-foreground/65">{t("crmReservations.enviarEmailDeConfirmacion")}</span>
        </label>
      </div>
      <DialogFooter className="gap-2 sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-border bg-background px-6 pb-9 pt-3 max-sm:[&>button]:w-full">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">{t("crmReservations.cancelar")}</Button>
        <Button size="sm" onClick={handleSubmit} disabled={createManual.isPending}>
          {createManual.isPending ? voc.creatingOrder : voc.createOrder}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}