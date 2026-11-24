import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CalendarCheck, XCircle, RefreshCw, Pencil, FileDown, CreditCard, Paperclip, ExternalLink, FilePlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { DT_FULL, EUR2 } from "../shared/crmCommon";

// ─── RESERVATION DETAIL MODAL ───────────────────────────────────────────────
export function ReservationDetailModal({
  reservationId,
  onClose,
  onEdit,
  onGenerateInvoice,
  onCancel,
}: {
  reservationId: number;
  onClose: () => void;
  onEdit: (id: number, status: string) => void;
  onGenerateInvoice?: (id: number) => void;
  onCancel?: (id: number, name: string) => void;
}) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const { data, isLoading } = trpc.crm.reservations.get.useQuery({ id: reservationId });
  const planQuery = trpc.crm.paymentPlans.get.useQuery(
    { quoteId: data?.reservation?.quoteId ?? 0 },
    { enabled: !!data?.reservation?.quoteId }
  );

  const ACTION_LABELS: Record<string, string> = {
    reservation_created:   `${voc.Order} ${voc.agree("creado", "creada")}`,
    reservation_updated:   `${voc.Order} ${voc.agree("actualizado", "actualizada")}`,
    reservation_paid:      voc.agree(t("crmEmpty.timeline.orderPaidOnlineM", { order: voc.Order }), t("crmEmpty.timeline.orderPaidOnlineF", { order: voc.Order })),
    reservation_cancelled: `${voc.Order} ${voc.agree("cancelado", "cancelada")}`,
    payment_confirmed:     t("crmReservations.pagoConfirmado"),
    transfer_validated:    t("crmReservations.transferenciaBancariaValidada"),
    invoice_generated:     t("crmReservations.facturaGenerada"),
    booking_created:       voc.licensed ? t("crmReservations.servicioProgramado") : t("crmReservations.actividadProgramada"),
    booking_confirmed:     voc.licensed ? t("crmReservations.servicioConfirmado") : t("crmReservations.actividadConfirmada"),
    booking_completed:     voc.licensed ? t("crmReservations.servicioCompletado") : t("crmReservations.actividadCompletada"),
    email_sent:            t("crmReservations.emailEnviadoAlCliente"),
    discount_applied:      t("crmReservations.descuentoBonoAplicado"),
    email_resent:          t("crmReservations.emailDeConfirmacionReenviado"),
    date_changed:          voc.licensed ? t("crmReservations.fechaDeServicioModificada") : t("crmReservations.fechaDeReservaModificada"),
    status_updated:        t("crmReservations.estadoActualizado"),
  };
  const translateAction = (action: string) =>
    ACTION_LABELS[action] ?? action.replace(/_/g, " ");

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      paid:            { label: `✅ ${voc.agree("Confirmado", "Confirmada")}`, cls: "bg-success/15 text-success border-success/30" },
      pending_payment: { label: t("crmReservations.pendienteDePago"), cls: "bg-warning/15 text-warning border-warning/30" },
      cancelled:       { label: `❌ ${voc.agree("Cancelado", "Cancelada")}`, cls: "bg-danger/15 text-danger border-danger/30" },
      failed:          { label: `⚠️ ${voc.agree("Fallido", "Fallida")}`, cls: "bg-warning/15 text-warning border-warning/30" },
      draft:           { label: t("crmReservations.borrador"),           cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
      completed:       { label: `🏁 ${voc.agree("Completado", "Completada")}`, cls: "bg-info/15 text-info border-info/30" },
    };
    const s = map[status] ?? { label: status, cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
        {s.label}
      </span>
    );
  };

  const getPaymentBadge = (method: string | null) => {
    if (!method) return <span className="text-foreground/30 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      tarjeta_fisica: { label: voc.licensed ? t("crmReservations.tarjetaEnDatafono") : t("crmReservations.tarjetaFisica"),  cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      tarjeta_redsys: { label: voc.licensed ? t("crmReservations.tarjetaPagoOnline") : t("crmReservations.tarjetaRedsys"),  cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      redsys:         { label: voc.licensed ? t("crmReservations.tarjetaPagoOnline") : t("crmReservations.tarjetaRedsys"),  cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      tarjeta:        { label: t("crmReservations.tarjeta"),          cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      transferencia:  { label: t("crmReservations.transferencia2"),    cls: "bg-info/15 text-info border-info/30",         icon: "🏦" },
      efectivo:       { label: t("crmReservations.efectivo2"),         cls: "bg-success/15 text-success border-success/30", icon: "💵" },
      otro:           { label: t("crmReservations.otro2"),             cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "❓" },
    };
    const s = map[method] ?? { label: method, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "" };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
        <span>{s.icon}</span>{s.label}
      </span>
    );
  };

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-warning" />
        </div>
      </DialogContent>
    );
  }
  if (!data) return null;
  const { reservation: res, invoices: relatedInvoices, activity } = data;
  const amountEur = ((res.amountPaid ?? res.amountTotal) / 100).toFixed(2);
  const totalEur = (res.amountTotal / 100).toFixed(2);

  return (
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
      <div className="overflow-y-auto flex-1 px-6 pt-6 pb-2">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-700/20 border border-success/30 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="font-bold">{res.customerName}</div>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {res.reservationNumber && (
                  <span className="font-mono text-xs font-bold text-warning bg-warning/10 border border-warning/20 rounded px-1.5 py-0.5">
                    {res.reservationNumber}
                  </span>
                )}
                <span className="text-xs text-foreground/40 font-normal font-mono">{res.merchantOrder}</span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Estado, método de pago y canal */}
          {res.cancellationRequestId && (
            <div className="mb-3 flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-xl px-4 py-2.5">
              <span className="text-warning text-sm">⚠️</span>
              <div>
                <p className="text-warning text-xs font-bold">{t("crmReservations.solicitudDeAnulacionVinculada")}</p>
                <p className="text-warning/70 text-xs">{t("crmReservations.expediente", { cancellationRequestId: res.cancellationRequestId })}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {getStatusBadge(res.status)}
            {getPaymentBadge(res.paymentMethod)}
            {planQuery.data && planQuery.data.installments.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/15 border border-primary/30 px-2.5 py-1 rounded-full">
                <CreditCard className="w-3 h-3" />{" "}{t("crmReservations.planDePagos")}</span>
            )}
            {res.channel === "TPV_FISICO" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-primary bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">{t("crmReservations.tpvPresencial")}</span>
            )}
            {res.channel === "VENTA_DELEGADA" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-primary bg-primary/15 border border-primary/30 px-2 py-0.5 rounded-full">{t("crmReservations.crmDelegado")}</span>
            )}
            {(res.channel === "ONLINE_DIRECTO" || !res.channel) && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-info bg-info/15 border border-info/30 px-2 py-0.5 rounded-full">{t("crmReservations.onlineDirecto")}</span>
            )}
            {res.channel === "ONLINE_ASISTIDO" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-info bg-info/15 border border-info/30 px-2 py-0.5 rounded-full">{t("crmReservations.onlineAsistido")}</span>
            )}
            {res.channel === "TELEFONO" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-warning bg-warning/15 border border-warning/30 px-2 py-0.5 rounded-full">{t("crmReservations.telefono2")}</span>
            )}
            {res.channel === "EMAIL" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-info bg-info/15 border border-info/30 px-2 py-0.5 rounded-full">{t("crmReservations.email3")}</span>
            )}
            {res.channel === "PARTNER" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-warning bg-warning/15 border border-warning/30 px-2 py-0.5 rounded-full">{t("crmReservations.partner")}</span>
            )}
            {res.channel === "TICKETING" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-danger bg-danger/15 border border-danger/30 px-2 py-0.5 rounded-full">{t("crmReservations.ticketing")}</span>
            )}
          </div>
          {/* Info de ticket TPV si aplica */}
          {res.channel === "TPV_FISICO" && res.notes?.includes("[ORIGEN_TPV]") && (
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-3">
              <div className="text-xs font-semibold text-primary mb-1">{t("crmReservations.ventaEnCaja")}</div>
              <div className="text-xs text-primary/70">
                {res.notes.replace("[ORIGEN_TPV] ", "")}
              </div>
            </div>
          )}

          {/* Datos del cliente */}
          <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">{t("crmReservations.datosDelCliente")}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-foreground/50 mb-0.5">{t("crmReservations.nombre")}</div>
                <div className="text-sm text-white font-medium">{res.customerName}</div>
              </div>
              <div>
                <div className="text-xs text-foreground/50 mb-0.5">{t("crmReservations.email4")}</div>
                <a href={`mailto:${res.customerEmail}`} className="text-sm text-info hover:text-info transition-colors">
                  {res.customerEmail}
                </a>
              </div>
              {res.customerPhone && (
                <div>
                  <div className="text-xs text-foreground/50 mb-0.5">{t("crmReservations.telefono")}</div>
                  <a href={`tel:${res.customerPhone}`} className="text-sm text-info hover:text-info transition-colors">
                    {res.customerPhone}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Detalles de la reserva */}
          <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">{t("crmReservations.detalles")}{" "}{voc.licensed ? t("crmReservations.delPedido") : t("crmReservations.deLaReserva")}</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{t("crmReservations.producto")}</span>
                <span className="text-white font-medium text-right max-w-[60%]">{res.productName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{voc.serviceDateLabel}</span>
                <span className="text-white font-medium">{res.bookingDate || "—"}</span>
              </div>
              {res.selectedTime && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/60">{t("crmReservations.horaSolicitada")}</span>
                  <span className="text-white font-medium">{res.selectedTime}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{t("crmReservations.personas")}</span>
                <span className="text-white font-medium">{t("crmReservations.pax", { people: res.people })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{t("crmReservations.importeTotal2")}</span>
                <span className="text-warning font-bold">{totalEur} €</span>
              </div>
              {Number((res as any).discountAmount ?? (res as any).discount_amount ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-success/80">{t("crmReservations.descuento")}{((res as any).discountReason ?? (res as any).discount_reason) && (
                      <span className="text-foreground/40 text-xs ml-1">— {(res as any).discountReason ?? (res as any).discount_reason}</span>
                    )}
                  </span>
                  <span className="text-success font-semibold">
                    −{format.currency(Number((res as any).discountAmount ?? (res as any).discount_amount), "EUR", EUR2)}
                  </span>
                </div>
              )}
              {res.amountPaid !== res.amountTotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/60">{t("crmReservations.importeCobrado2")}</span>
                  <span className="text-success font-bold">{amountEur} €</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{t("crmReservations.referencia")}</span>
                <span className="font-mono text-foreground/65 text-xs">{res.merchantOrder}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">{t("crmReservations.creadaEl")}</span>
                <span className="text-foreground/65">{format.dateTime(res.createdAt, DT_FULL)}</span>
              </div>
              {res.paidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/60">{t("crmReservations.pagadaEl")}</span>
                  <span className="text-success">{format.dateTime(res.paidAt, DT_FULL)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Plan de pago fraccionado */}
          {planQuery.data && planQuery.data.installments.length > 0 && (
            <div className="bg-primary/30 border border-primary/30 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />{t("crmReservations.planDePagoFraccionado")}</h4>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  planQuery.data.installments.every(i => i.status === "paid")
                    ? "bg-success/20 text-success border-success/30"
                    : planQuery.data.installments.some(i => i.status === "paid")
                    ? "bg-warning/20 text-warning border-warning/30"
                    : "bg-primary/20 text-primary border-primary/30"
                }`}>
                  {planQuery.data.installments.every(i => i.status === "paid")
                    ? t("crmReservations.completado")
                    : planQuery.data.installments.some(i => i.status === "paid")
                    ? t("crmReservations.enCurso")
                    : t("crmReservations.pendiente2")}
                </span>
              </div>
              <div className="space-y-1">
                {planQuery.data.installments.map((inst) => (
                  <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-b border-foreground/[0.06] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground/40 w-5">#{inst.installmentNumber}</span>
                      <span className={inst.status === "paid" ? "text-success font-medium" : "text-foreground/80"}>
                        {format.currency((inst.amountCents / 100))}
                      </span>
                      {inst.isRequiredForConfirmation && (
                        <span className="text-[10px] bg-warning/20 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">{t("crmReservations.inaplazable")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {inst.dueDate && <span className="text-foreground/40">{inst.dueDate}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                        inst.status === "paid"
                          ? "bg-success/20 text-success border-success/30"
                          : "bg-foreground/[0.06] text-foreground/50 border-foreground/[0.12]"
                      }`}>
                        {inst.status === "paid" ? t("crmReservations.pagada") : t("crmReservations.pendiente2")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const paidTotal = planQuery.data.installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
                const pendingTotal = planQuery.data.installments.filter(i => i.status !== "paid").reduce((s, i) => s + i.amountCents, 0);
                return (
                  <div className="flex justify-between pt-1 text-xs text-foreground/60">
                    <span>{t("crmReservations.cobrado")}{" "}<span className="text-success font-medium">{format.currency((paidTotal / 100))}</span></span>
                    <span>{t("crmReservations.pendiente")}{" "}<span className="text-warning font-medium">{format.currency((pendingTotal / 100))}</span></span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Justificante de transferencia */}
          {res.transferProofUrl && (
            <div className="bg-info/10 border border-info/20 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-info uppercase tracking-wider mb-2">{t("crmReservations.justificanteDeTransferencia")}</h4>
              <a
                href={res.transferProofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-info hover:text-info transition-colors"
              >
                <Paperclip className="w-4 h-4" />{t("crmReservations.verJustificanteAdjunto")}<ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Notas internas */}
          {res.notes && (
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-warning uppercase tracking-wider mb-2">{t("crmReservations.notasInternas")}</h4>
              <p className="text-sm text-foreground/70">{res.notes}</p>
            </div>
          )}

          {/* Líneas del pedido */}
          {(() => {
            const allItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string }[] = [];
            for (const inv of relatedInvoices) {
              const items = (inv.itemsJson as any[]) ?? [];
              allItems.push(...items);
            }
            if (allItems.length === 0) return null;
            const generalItems = allItems.filter(i => !i.fiscalRegime || i.fiscalRegime !== "reav");
            const reavItems = allItems.filter(i => i.fiscalRegime === "reav");
            return (
              <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
                <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">{t("crmReservations.lineasDelPedido")}</h4>
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-foreground/40 font-medium pb-1 border-b border-foreground/[0.10]">
                    <div className="col-span-6">{t("crmReservations.concepto")}</div>
                    <div className="col-span-2 text-center">{t("crmReservations.cant")}</div>
                    <div className="col-span-2 text-right">{t("crmReservations.pUnit")}</div>
                    <div className="col-span-2 text-right">{t("crmReservations.total")}</div>
                  </div>
                  {/* General items */}
                  {generalItems.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-foreground/60 pt-1 pb-0.5">{t("crmReservations.regimenGeneralIva21")}</div>
                      {generalItems.map((item, i) => (
                        <div key={`g-${i}`} className="grid grid-cols-12 gap-2 text-sm py-1">
                          <div className="col-span-6 text-foreground/80">{item.description}</div>
                          <div className="col-span-2 text-center text-foreground/65">{item.quantity}</div>
                          <div className="col-span-2 text-right text-foreground/65">{format.currency(Number(item.unitPrice), "EUR", EUR2)}</div>
                          <div className="col-span-2 text-right text-warning font-medium">{format.currency(Number(item.total), "EUR", EUR2)}</div>
                        </div>
                      ))}
                    </>
                  )}
                  {/* REAV items */}
                  {reavItems.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-warning/70 pt-1 pb-0.5">{t("crmReservations.reavSinIvaRegimen")}</div>
                      {reavItems.map((item, i) => (
                        <div key={`r-${i}`} className="grid grid-cols-12 gap-2 text-sm py-1">
                          <div className="col-span-6 text-foreground/80 flex items-center gap-1.5">
                            {item.description}
                            <span className="text-[10px] font-bold text-warning bg-warning/10 border border-warning/20 px-1 py-0.5 rounded">{t("crmReservations.reav")}</span>
                          </div>
                          <div className="col-span-2 text-center text-foreground/65">{item.quantity}</div>
                          <div className="col-span-2 text-right text-foreground/65">{format.currency(Number(item.unitPrice), "EUR", EUR2)}</div>
                          <div className="col-span-2 text-right text-warning font-medium">{format.currency(Number(item.total), "EUR", EUR2)}</div>
                        </div>
                      ))}
                    </>
                  )}
                  {/* Totals */}
                  <div className="border-t border-foreground/[0.10] pt-2 mt-1 space-y-1">
                    {generalItems.length > 0 && reavItems.length > 0 && (
                      <div className="flex justify-between text-xs text-foreground/50">
                        <span>{t("crmReservations.subtotalRegGeneral")}</span>
                        <span>{format.currency(generalItems.reduce((s, i) => s + Number(i.total), 0), "EUR", EUR2)}</span>
                      </div>
                    )}
                    {reavItems.length > 0 && (
                      <div className="flex justify-between text-xs text-warning/60">
                        <span>{t("crmReservations.subtotalReavSinIva")}</span>
                        <span>{format.currency(reavItems.reduce((s, i) => s + Number(i.total), 0), "EUR", EUR2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-foreground">
                      <span>{t("crmReservations.total")}</span>
                      <span className="text-warning">{format.currency(allItems.reduce((s, i) => s + Number(i.total), 0), "EUR", EUR2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Facturas asociadas */}
          {relatedInvoices.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">{t("crmReservations.facturasAsociadas")}</h4>
              <div className="space-y-2">
                {relatedInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between bg-foreground/[0.05] border border-foreground/[0.10] rounded-xl px-4 py-3">
                    <div>
                      <div className="text-sm font-mono font-bold text-foreground">{inv.invoiceNumber}</div>
                      <div className="text-xs text-foreground/50 mt-0.5">
                        {format.date(inv.createdAt, {})} · {inv.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-warning">{format.currency(Number(inv.total), "EUR", EUR2)}</span>
                      {inv.pdfUrl && (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-success hover:text-success transition-colors"
                        >
                          <FileDown className="w-3.5 h-3.5" />{" "}{t("crmReservations.pdf")}</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historial de actividad */}
          {activity.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">{t("crmReservations.historialDeActividad")}</h4>
              <div className="space-y-1.5">
                {activity.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b border-foreground/[0.08] last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-success/60 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground/70">{translateAction(log.action)}</div>
                      {log.actorName && (
                        <div className="text-xs text-foreground/40">{log.actorName}</div>
                      )}
                    </div>
                    <div className="text-xs text-foreground/40 shrink-0">
                      {format.dateTime(log.createdAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="px-6 py-4 border-t border-foreground/[0.10] flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">{t("crmReservations.cerrar")}</Button>
        <Button
          size="sm"
          variant="outline"
          className="border-warning/30 text-warning hover:bg-warning/10"
          onClick={() => { onClose(); onEdit(res.id, res.status); }}
        >
          <Pencil className="w-4 h-4 mr-1" /> {voc.editOrder}
        </Button>
        {relatedInvoices.length === 0 && onGenerateInvoice && (
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => { onClose(); onGenerateInvoice(res.id); }}
          >
            <FilePlus className="w-4 h-4 mr-1" />{" "}{t("crmReservations.generarFactura")}</Button>
        )}
        {relatedInvoices[0]?.pdfUrl && (
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => window.open(relatedInvoices[0].pdfUrl ?? undefined, "_blank")}
          >
            <FileDown className="w-4 h-4 mr-1" />{" "}{t("crmReservations.descargarFacturaPdf")}</Button>
        )}
        {/* Anular reserva — solo si no está ya cancelada y no tiene expediente activo */}
        {onCancel && res.status !== "cancelled" && !res.cancellationRequestId && (
          <Button
            size="sm"
            variant="outline"
            className="border-warning/40 text-warning hover:bg-warning/10 ml-auto"
            onClick={() => { onClose(); onCancel(res.id, res.customerName); }}
          >
            <XCircle className="w-4 h-4 mr-1" /> {voc.cancelOrder}
          </Button>
        )}
        {res.cancellationRequestId && (
          <span className="ml-auto text-xs text-warning/70 border border-warning/20 rounded px-2 py-1">{t("crmReservations.expedienteActivo", { cancellationRequestId: res.cancellationRequestId })}</span>
        )}
      </DialogFooter>
    </DialogContent>
  );
}