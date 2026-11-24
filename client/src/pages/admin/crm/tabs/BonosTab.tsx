import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarClock, Search, Eye, Send, RefreshCw, Trash2, Ban } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2 } from "../shared/crmCommon";

// ─── BONOS MANAGER ───────────────────────────────────────────────────────────
export function BonosManager({ onOpenCancellation, onOpenReservation }: { onOpenCancellation: (id: number) => void; onOpenReservation: (id: number) => void }) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"all" | "generado" | "enviado" | "canjeado" | "caducado" | "anulado">("all");
  const [search, setSearch] = useState("");
  const [extendModal, setExtendModal] = useState<{ id: number; code: string; current: string | null } | null>(null);
  const [cancelModal, setCancelModal] = useState<{ id: number; code: string } | null>(null);
  const [viewModal, setViewModal] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; code: string } | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const { data: kpis } = trpc.cancellations.getVoucherCounters.useQuery();
  const { data: vouchers, isLoading } = trpc.cancellations.listVouchers.useQuery({
    status: statusFilter,
    search: search || undefined,
  });

  const invalidate = () => {
    utils.cancellations.listVouchers.invalidate();
    utils.cancellations.getVoucherCounters.invalidate();
  };

  const resendMut = trpc.cancellations.resendVoucherEmail.useMutation({
    onSuccess: () => { toast.success(t("crmVouchers.emailReenviadoCorrectamente")); invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const extendMut = trpc.cancellations.extendVoucherExpiry.useMutation({
    onSuccess: () => { toast.success(t("crmVouchers.caducidadAmpliada")); setExtendModal(null); invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const cancelMut = trpc.cancellations.cancelVoucher.useMutation({
    onSuccess: () => { toast.success(t("crmVouchers.bonoAnulado")); setCancelModal(null); invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const deleteMut = trpc.cancellations.deleteVoucher.useMutation({
    onSuccess: () => { toast.success(t("crmVouchers.bonoEliminado")); setDeleteConfirm(null); invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const { data: voucherDetail } = trpc.cancellations.getVoucherById.useQuery(
    { id: viewModal! },
    { enabled: !!viewModal }
  );

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    generado:  { label: t("crmVouchers.generado"),  cls: "bg-info/10 text-info border-info/20" },
    enviado:   { label: t("crmVouchers.activo"),    cls: "bg-success/10 text-success border-success/20" },
    canjeado:  { label: t("crmVouchers.canjeado"),  cls: "bg-primary/10 text-primary border-primary/20" },
    caducado:  { label: t("crmVouchers.caducado"),  cls: "bg-warning/10 text-warning border-warning/20" },
    anulado:   { label: t("crmVouchers.anulado"),   cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  };

  const filters: { key: typeof statusFilter; label: string }[] = [
    { key: "all",      label: t("crmVouchers.todos") },
    { key: "enviado",  label: t("crmVouchers.activos") },
    { key: "canjeado", label: t("crmVouchers.canjeados") },
    { key: "caducado", label: t("crmVouchers.caducados") },
    { key: "anulado",  label: t("crmVouchers.anulados") },
  ];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: t("crmVouchers.totalEmitidos"), value: kpis?.total ?? 0, cls: "border-foreground/[0.08]" },
          { label: t("crmVouchers.activos"),        value: kpis?.activos ?? 0, cls: "border-success/20" },
          { label: t("crmVouchers.canjeados"),      value: kpis?.canjeados ?? 0, cls: "border-primary/20" },
          { label: t("crmVouchers.caducados"),      value: kpis?.caducados ?? 0, cls: "border-warning/20" },
          { label: t("crmVouchers.importePend"), value: `${format.currency((kpis?.importePendiente ?? 0), "EUR", EUR2)}`, cls: "border-success/20" },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`bg-foreground/[0.03] border ${cls} rounded-xl p-4`}>
            <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros + búsqueda */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 bg-foreground/[0.05] rounded-lg p-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${statusFilter === f.key ? "bg-primary text-primary-foreground" : "text-foreground/50 hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crmVouchers.codigoClienteExpediente")}
            className="pl-8 h-8 bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-xs"
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.codigo")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.cliente")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.valor")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.generado")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.reserva")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.anulacion")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.caduca")}</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.estado")}</th>
                <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmVouchers.acciones")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : !vouchers || vouchers.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-foreground/40 text-sm">{t("crmVouchers.noSeEncontraronBonos")}</td></tr>
              ) : vouchers.map((v) => {
                const isActive = v.status === "enviado" || v.status === "generado";
                const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.generado;
                const isExpired = v.expiresAt && new Date(v.expiresAt) < new Date();
                return (
                  <tr key={v.id} className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors last:border-0">
                    {/* Código */}
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-sm text-primary">{v.code}</span>
                      {v.activityName && <p className="text-foreground/40 text-xs mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px]">{v.activityName}</p>}
                    </td>

                    {/* Cliente */}
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{v.clientName ?? "—"}</p>
                      {v.clientEmail && <p className="text-foreground/40 text-xs">{v.clientEmail}</p>}
                    </td>

                    {/* Valor */}
                    <td className="px-4 py-3">
                      <span className="text-warning font-bold font-mono">{format.currency(Number(v.value), "EUR", EUR2)}</span>
                      {v.redeemedAt && (
                        <p className="text-primary/60 text-xs mt-0.5">{t("crmVouchers.canjeado")}{" "}{format.date(v.redeemedAt, {})}
                        </p>
                      )}
                    </td>

                    {/* Generado */}
                    <td className="px-4 py-3 text-foreground/55 text-xs">
                      {v.issuedAt ? format.date(v.issuedAt, {}) : "—"}
                    </td>

                    {/* Reserva */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {v.linkedReservationId && v.reservationNumber ? (
                        <button
                          onClick={() => onOpenReservation(v.linkedReservationId!)}
                          className="font-mono text-xs text-warning hover:text-warning hover:underline transition-colors"
                          title={t("crmVouchers.verReserva")}
                        >
                          {v.reservationNumber}
                        </button>
                      ) : (
                        <span className="text-foreground/25 text-xs">—</span>
                      )}
                    </td>

                    {/* Anulación */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {v.cancellationNumber && v.requestId ? (
                        <button
                          onClick={() => onOpenCancellation(v.requestId)}
                          className="font-mono text-xs text-warning/80 hover:text-warning hover:underline transition-colors"
                          title={t("crmVouchers.verExpedienteDeAnulacion")}
                        >
                          {v.cancellationNumber}
                        </button>
                      ) : (
                        <span className="text-foreground/25 text-xs">—</span>
                      )}
                    </td>

                    {/* Caduca */}
                    <td className="px-4 py-3">
                      {v.expiresAt ? (
                        <span className={`text-xs font-medium ${isExpired && isActive ? "text-danger" : "text-foreground/55"}`}>
                          {isExpired && isActive && "⚠ "}{format.date(v.expiresAt, {})}
                        </span>
                      ) : (
                        <span className="text-foreground/25 text-xs italic">{t("crmVouchers.sinLimite")}</span>
                      )}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Ver detalle */}
                        <button
                          onClick={() => setViewModal(v.id)}
                          className="p-1.5 rounded-lg text-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t("crmVouchers.verDetalleDelBono")}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isActive && (
                          <button
                            onClick={() => resendMut.mutate({ voucherId: v.id })}
                            disabled={resendMut.isPending}
                            className="p-1.5 rounded-lg text-info/60 hover:text-info hover:bg-info/10 transition-colors"
                            title={t("crmVouchers.reenviarEmailAlCliente")}
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {(isActive || v.status === "caducado") && (
                          <button
                            onClick={() => {
                              setNewExpiry(v.expiresAt ? new Date(v.expiresAt).toISOString().split("T")[0] : "");
                              setExtendModal({ id: v.id, code: v.code, current: v.expiresAt ? format.date(v.expiresAt, {}) : null });
                            }}
                            className="p-1.5 rounded-lg text-warning/60 hover:text-warning hover:bg-warning/10 transition-colors"
                            title={t("crmVouchers.ampliarFechaDeCaducidad")}
                          >
                            <CalendarClock className="w-4 h-4" />
                          </button>
                        )}
                        {v.status !== "canjeado" && v.status !== "anulado" && (
                          <button
                            onClick={() => { setCancelReason(""); setCancelModal({ id: v.id, code: v.code }); }}
                            className="p-1.5 rounded-lg text-foreground/30 hover:text-danger hover:bg-danger/10 transition-colors"
                            title={t("crmVouchers.anularBono")}
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        {/* Borrar */}
                        {v.status !== "canjeado" && (
                          <button
                            onClick={() => setDeleteConfirm({ id: v.id, code: v.code })}
                            className="p-1.5 rounded-lg text-foreground/25 hover:text-danger hover:bg-danger/10 transition-colors"
                            title={t("crmVouchers.eliminarBonoPermanentemente")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Ampliar caducidad */}
      <Dialog open={!!extendModal} onOpenChange={(o) => !o && setExtendModal(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <CalendarClock className="w-4 h-4 text-warning" />{" "}{t("crmVouchers.ampliarCaducidad")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-foreground/60">{t("crmVouchers.bono")}{" "}<span className="font-mono text-primary">{extendModal?.code}</span></p>
            {extendModal?.current && (
              <p className="text-xs text-foreground/50">{t("crmVouchers.caducidadActual")}{" "}<span className="text-warning">{extendModal.current}</span></p>
            )}
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmVouchers.nuevaFechaDeCaducidad")}</Label>
              <Input
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setExtendModal(null)}>{t("crmVouchers.cancelar")}</Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={!newExpiry || extendMut.isPending}
              onClick={() => extendModal && extendMut.mutate({ voucherId: extendModal.id, newExpiresAt: newExpiry })}
            >
              {extendMut.isPending ? t("crmVouchers.guardando") : t("crmVouchers.confirmarNuevaFecha")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Anular bono */}
      <Dialog open={!!cancelModal} onOpenChange={(o) => !o && setCancelModal(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Ban className="w-4 h-4 text-danger" />{" "}{t("crmVouchers.anularBono")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-foreground/70">{t("crmVouchers.confirmasAnularElBono")}{" "}<span className="font-mono text-primary">{cancelModal?.code}</span>{t("crmVouchers.elCodigoQuedaraInactivo")}</p>
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmVouchers.motivoOpcional")}</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("crmVouchers.ejEmitidoPorError")}
                rows={3}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-gray-600 resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setCancelModal(null)}>{t("crmVouchers.cancelar")}</Button>
            <Button
              size="sm"
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={cancelMut.isPending}
              onClick={() => cancelModal && cancelMut.mutate({ voucherId: cancelModal.id, reason: cancelReason || undefined })}
            >
              {cancelMut.isPending ? t("crmVouchers.anulando") : t("crmVouchers.confirmarAnulacion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Ver detalle del bono */}
      <Dialog open={!!viewModal} onOpenChange={(o) => !o && setViewModal(null)}>
        <DialogContent className="max-w-lg bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Eye className="w-4 h-4 text-primary" />{" "}{t("crmVouchers.detalleDelBono")}</DialogTitle>
          </DialogHeader>
          {voucherDetail ? (
            <div className="space-y-4 py-1">
              {/* Código y estado */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-xl font-bold text-primary">{voucherDetail.code}</span>
                <span className={`inline-flex items-center border rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  voucherDetail.status === "enviado" ? "bg-success/10 text-success border-success/20" :
                  voucherDetail.status === "canjeado" ? "bg-primary/10 text-primary border-primary/20" :
                  voucherDetail.status === "caducado" ? "bg-warning/10 text-warning border-warning/20" :
                  voucherDetail.status === "anulado" ? "bg-gray-500/10 text-gray-400 border-gray-500/20" :
                  "bg-info/10 text-info border-info/20"
                }`}>
                  {voucherDetail.status === "enviado" ? t("crmVouchers.activo") : voucherDetail.status.charAt(0).toUpperCase() + voucherDetail.status.slice(1)}
                </span>
              </div>

              {/* Valor + actividad */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/50">{t("crmVouchers.valor")}</span>
                  <span className="text-warning font-bold font-mono">{format.currency(Number(voucherDetail.value), "EUR", EUR2)}</span>
                </div>
                {voucherDetail.activityName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">{t("crmVouchers.actividad")}</span>
                    <span className="text-foreground/80 text-right max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap">{voucherDetail.activityName}</span>
                  </div>
                )}
              </div>

              {/* Cliente */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">{t("crmVouchers.cliente")}</p>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/50">{t("crmVouchers.nombre")}</span>
                  <span className="text-white">{voucherDetail.clientName ?? "—"}</span>
                </div>
                {voucherDetail.clientEmail && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">{t("crmVouchers.email")}</span>
                    <span className="text-foreground/80">{voucherDetail.clientEmail}</span>
                  </div>
                )}
                {voucherDetail.clientPhone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">{t("crmVouchers.telefono")}</span>
                    <span className="text-foreground/80">{voucherDetail.clientPhone}</span>
                  </div>
                )}
              </div>

              {/* Fechas */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">{t("crmVouchers.fechas")}</p>
                {[
                  { label: t("crmVouchers.generado"), val: voucherDetail.issuedAt },
                  { label: t("crmVouchers.enviado"), val: voucherDetail.sentAt },
                  { label: t("crmVouchers.caduca"), val: voucherDetail.expiresAt },
                  { label: t("crmVouchers.canjeado"), val: voucherDetail.redeemedAt },
                ].map(({ label, val }) => val && (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-foreground/50">{label}</span>
                    <span className="text-foreground/80">{format.date(val, {})}</span>
                  </div>
                ))}
              </div>

              {/* Vínculos */}
              {(voucherDetail.cancellationNumber || voucherDetail.reservationNumber) && (
                <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                  <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">{t("crmVouchers.vinculos")}</p>
                  {voucherDetail.cancellationNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">{t("crmVouchers.anulacion")}</span>
                      <button onClick={() => { setViewModal(null); onOpenCancellation(voucherDetail.requestId!); }} className="font-mono text-warning hover:underline">{voucherDetail.cancellationNumber}</button>
                    </div>
                  )}
                  {voucherDetail.reservationNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">{t("crmVouchers.reserva")}</span>
                      <button onClick={() => { setViewModal(null); onOpenReservation(voucherDetail.linkedReservationId!); }} className="font-mono text-warning hover:underline">{voucherDetail.reservationNumber}</button>
                    </div>
                  )}
                </div>
              )}

              {voucherDetail.notes && (
                <div className="bg-foreground/[0.05] rounded-xl p-3">
                  <p className="text-xs text-foreground/40 uppercase tracking-wide mb-1">{t("crmVouchers.notas")}</p>
                  <p className="text-sm text-foreground/70">{voucherDetail.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-foreground/40" /></div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setViewModal(null)}>{t("crmVouchers.cerrar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Eliminar bono */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Trash2 className="w-4 h-4 text-danger" />{" "}{t("crmVouchers.eliminarBono")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-foreground/70">{t("crmVouchers.eliminarPermanentementeElBono")}{" "}<span className="font-mono text-primary">{deleteConfirm?.code}</span>?
            </p>
            <p className="text-xs text-danger/70 mt-2">{t("crmVouchers.estaAccionNoSe")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setDeleteConfirm(null)}>{t("crmVouchers.cancelar")}</Button>
            <Button
              size="sm"
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={deleteMut.isPending}
              onClick={() => deleteConfirm && deleteMut.mutate({ id: deleteConfirm.id })}
            >
              {deleteMut.isPending ? t("crmVouchers.eliminando") : t("crmVouchers.eliminar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}