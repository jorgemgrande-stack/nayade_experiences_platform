import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Mail, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2 } from "../shared/crmCommon";

// ─── PAGOS PENDIENTES TAB ────────────────────────────────────────────────────
export function PagosPendientesTab() {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<"transferencia" | "efectivo" | "tarjeta_fisica">("transferencia");
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.crm.pendingPayments.list.useQuery({
    status: filterStatus === "all" ? undefined : filterStatus as "pending" | "paid" | "cancelled" | "incidentado",
    limit: 50,
    offset: 0,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const confirmMut = trpc.crm.pendingPayments.confirm.useMutation({
    onSuccess: () => {
      toast.success(t("crmPayments.pagoConfirmadoCorrectamente"));
      setConfirmId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const resendMut = trpc.crm.pendingPayments.resendReminder.useMutation({
    onSuccess: () => toast.success(t("crmPayments.emailDeRecordatorioEnviado")),
    onError: (e: { message: string }) => toast.error(errorToastMessage(e)),
  });

  const cancelMut = trpc.crm.pendingPayments.cancel.useMutation({
    onSuccess: () => {
      toast.success(t("crmPayments.pagoPendienteCancelado"));
      setCancelId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const deleteMut = trpc.crm.pendingPayments.delete.useMutation({
    onSuccess: () => {
      toast.success(t("crmPayments.registroEliminado"));
      setDeleteId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      pending:   { label: t("crmPayments.pendiente"),  cls: "bg-warning/15 text-warning border-warning/30" },
      overdue:   { label: t("crmPayments.vencido"),    cls: "bg-danger/15 text-danger border-danger/30" },
      confirmed: { label: t("crmPayments.confirmado"), cls: "bg-success/15 text-success border-success/30" },
      cancelled: { label: t("crmPayments.cancelado"),  cls: "bg-foreground/[0.08] text-foreground/50 border-foreground/[0.12]" },
    };
    const s = map[status] ?? { label: status, cls: "bg-foreground/[0.08] text-foreground/50 border-foreground/[0.12]" };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${s.cls}`}>
        {s.label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-lg">{voc.pendingPayments}</h2>
          <p className="text-foreground/50 text-sm">{t("crmPayments.registro", { total })}{" "}{t("crmPayments.enTotal")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
              <SelectItem value="all" className="text-white text-xs">{t("crmPayments.todos")}</SelectItem>
              <SelectItem value="pending" className="text-white text-xs">{t("crmPayments.pendiente")}</SelectItem>
              <SelectItem value="overdue" className="text-white text-xs">{t("crmPayments.vencido")}</SelectItem>
              <SelectItem value="confirmed" className="text-white text-xs">{t("crmPayments.confirmado")}</SelectItem>
              <SelectItem value="cancelled" className="text-white text-xs">{t("crmPayments.cancelado")}</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg bg-foreground/[0.05] hover:bg-foreground/[0.08] text-foreground/50 hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-foreground/[0.10] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">#</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.cliente")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.presupuesto")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.importe")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.vencimiento")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.motivo")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.estado")}</th>
                <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmPayments.acciones")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-foreground/40">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <Clock className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
                    <p className="text-foreground/40 text-sm">{t("crmPayments.noHayPagosPendientes")}</p>
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const dueDate = row.dueDate ? new Date(row.dueDate) : null;
                const isOverdue = dueDate && dueDate < new Date() && row.status === "pending";
                return (
                  <tr
                    key={row.id}
                    className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3 text-foreground/50 text-sm font-mono">#{row.id}</td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{row.clientName}</p>
                      {row.clientEmail && <p className="text-foreground/50 text-xs">{row.clientEmail}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {row.quoteId ? (
                        <span className="text-foreground/65 text-xs font-mono">{t("crmPayments.pres", { quoteId: row.quoteId })}</span>
                      ) : (
                        <span className="text-foreground/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold text-sm">
                        {format.currency((row.amountCents / 100), "EUR", EUR2)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {dueDate ? (
                        <span className={`text-xs ${isOverdue ? "text-danger font-semibold" : "text-foreground/65"}`}>
                          {format.date(dueDate, {})}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-foreground/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground/60 text-xs max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {row.reason ?? "—"}
                    </td>
                    <td className="px-4 py-3">{statusBadge(row.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {row.status === "pending" && (
                          <>
                            <button
                              onClick={() => { setConfirmId(row.id); setConfirmMethod("transferencia"); }}
                              title={t("crmPayments.confirmarPago")}
                              className="p-1.5 rounded-lg bg-success/10 hover:bg-success/20 text-success transition-colors"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => resendMut.mutate({ id: row.id })}
                              title={t("crmPayments.reenviarRecordatorio")}
                              className="p-1.5 rounded-lg bg-info/10 hover:bg-info/20 text-info transition-colors"
                              disabled={resendMut.isPending}
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCancelId(row.id)}
                              title={t("crmPayments.cancelar")}
                              className="p-1.5 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setDeleteId(row.id)}
                          title={t("crmPayments.eliminarRegistro")}
                          className="p-1.5 rounded-lg bg-foreground/[0.05] hover:bg-danger/20 text-foreground/30 hover:text-danger transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm payment modal */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />{" "}{t("crmPayments.confirmarPagoRecibido")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmPayments.metodoDePago")}</Label>
              <Select value={confirmMethod} onValueChange={(v) => setConfirmMethod(v as any)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="transferencia" className="text-white">{t("crmPayments.transferenciaBancaria")}</SelectItem>
                  <SelectItem value="tarjeta_fisica" className="text-white">{t("crmPayments.tarjetaFisica")}</SelectItem>
                  <SelectItem value="efectivo" className="text-white">{t("crmPayments.efectivo")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-foreground/50">{voc.agree(t("crmEmpty.confirm.markPaymentConfirmedM", { theOrder: voc.theOrder }), t("crmEmpty.confirm.markPaymentConfirmedF", { theOrder: voc.theOrder }))}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmPayments.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => confirmId !== null && confirmMut.mutate({ id: confirmId, paymentMethod: confirmMethod })}
              disabled={confirmMut.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {confirmMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}{t("crmPayments.confirmarCobro")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel modal */}
      <Dialog open={cancelId !== null} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-danger" />{" "}{t("crmPayments.cancelarPagoPendiente")}</DialogTitle>
          </DialogHeader>
          <p className="text-foreground/65 text-sm py-2">{t("crmPayments.seguroQueQuieresCancelar")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmPayments.volver")}</Button>
            <Button
              size="sm"
              onClick={() => cancelId !== null && cancelMut.mutate({ id: cancelId })}
              disabled={cancelMut.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {cancelMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}{t("crmPayments.cancelarPago")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete modal */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-danger" />{" "}{t("crmPayments.eliminarRegistro")}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-foreground/65 text-sm">{t("crmPayments.estaAccionEliminaraEl")}</p>
            <p className="text-xs text-warning/80 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">{t("crmPayments.soloEliminaElRegistro")}{" "}{voc.licensed ? t("crmPayments.elPedido") : t("crmPayments.laReserva")}{" "}{t("crmPayments.yElPresupuestoAsociados")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmPayments.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteId !== null && deleteMut.mutate({ id: deleteId })}
              disabled={deleteMut.isPending}
              className="bg-danger hover:bg-danger/10 text-white"
            >
              {deleteMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmPayments.eliminarDefinitivamente")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}