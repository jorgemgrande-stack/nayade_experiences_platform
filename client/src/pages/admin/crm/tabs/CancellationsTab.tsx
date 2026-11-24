import React, { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import CancellationDetailModal from "../CancellationDetailModal";
import { Eye, XCircle, AlertTriangle, RefreshCw, Trash2, ExternalLink, CloudLightning, HeartPulse, HelpCircle } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Tab, AnulOpBadge, AnulResBadge, AnulFinBadge, PAGE_SIZE } from "../shared/crmCommon";
import { AnularReservaModal } from "../modals/AnularReservaModal";


export function useCancellationsController({ tab }: { tab: Tab }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [anulPage, setAnulPage] = useState(0);
  // requestId del expediente recién creado → abre CancellationDetailModal en modo auto-aceptar
  const [cancelAutoAcceptAnulId, setCancelAutoAcceptAnulId] = useState<number | null>(null);
  // ─── Anulaciones state ───────────────────────────────────────────────────────
  const [anulSearch, setAnulSearch] = useState("");
  const [anulOpFilter, setAnulOpFilter] = useState("all");
  const [anulResFilter, setAnulResFilter] = useState("all");
  const [anulFinFilter, setAnulFinFilter] = useState("all");
  const [anulReasonFilter, setAnulReasonFilter] = useState("all");
  const [selectedAnulId, setSelectedAnulId] = useState<number | null>(null);
  const [deleteAnulId, setDeleteAnulId] = useState<number | null>(null);
  // Reset paginación cuando cambian filtros de anulaciones
  useEffect(() => { setAnulPage(0); }, [anulSearch, anulOpFilter, anulResFilter, anulFinFilter, anulReasonFilter]);
  const { data: anulData, isLoading: anulLoading, isError: anulError, refetch: refetchAnul } = trpc.cancellations.listRequests.useQuery({
    search: anulSearch || undefined,
    operationalStatus: anulOpFilter !== "all" ? anulOpFilter : undefined,
    resolutionStatus: anulResFilter !== "all" ? anulResFilter : undefined,
    financialStatus: anulFinFilter !== "all" ? anulFinFilter : undefined,
    reason: anulReasonFilter !== "all" ? anulReasonFilter : undefined,
    limit: PAGE_SIZE,
    offset: anulPage * PAGE_SIZE,
  }, { enabled: tab === "anulaciones", retry: 1 });
  const deleteAnulMutation = trpc.cancellations.deleteRequest.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.solicitudEliminada"));
      setDeleteAnulId(null);
      utils.cancellations.listRequests.invalidate();
    },
    onError: (err) => toast.error(errorToastMessage(err)),
  });
  const anulRows = anulData?.rows ?? [];
  const anulKpis = anulData?.kpis;
  return { anulPage, setAnulPage, cancelAutoAcceptAnulId, setCancelAutoAcceptAnulId, anulSearch, setAnulSearch, anulOpFilter, setAnulOpFilter, anulResFilter, setAnulResFilter, anulFinFilter, setAnulFinFilter, anulReasonFilter, setAnulReasonFilter, selectedAnulId, setSelectedAnulId, deleteAnulId, setDeleteAnulId, anulData, anulLoading, anulError, refetchAnul, deleteAnulMutation, anulRows, anulKpis };
}
export type CancellationsController = ReturnType<typeof useCancellationsController>;

export function CancellationsTab({ ctrl, tab, setViewResId }: { ctrl: CancellationsController; tab: Tab; setViewResId: React.Dispatch<React.SetStateAction<number | null>> }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const { anulKpis, anulOpFilter, setAnulOpFilter, anulResFilter, setAnulResFilter, anulFinFilter, setAnulFinFilter, anulReasonFilter, setAnulReasonFilter, refetchAnul, anulLoading, anulError, anulRows, setSelectedAnulId, setDeleteAnulId, anulData, anulPage, setAnulPage } = ctrl;
  return (
    <>
{/* ─── TAB: ANULACIONES ─────────────────────────────────────────────── */}
{tab === "anulaciones" && (
            <div className="space-y-4">
              {/* KPIs fila 1 */}
              {anulKpis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    { label: t("crmCancellations.total"), value: anulKpis.total, color: "border-foreground/[0.08]" },
                    { label: t("crmCancellations.recibidas"), value: anulKpis.recibidas, color: "border-info/20" },
                    { label: t("crmCancellations.enRevision"), value: anulKpis.enRevision, color: "border-warning/20" },
                    { label: t("crmCancellations.pendDocs"), value: anulKpis.pendienteDocumentacion, color: "border-warning/20" },
                    { label: t("crmCancellations.incidencias"), value: anulKpis.incidencias, color: "border-danger/20" },
                    { label: t("crmCancellations.cerradas"), value: anulKpis.cerradas, color: "border-gray-500/20" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-foreground/[0.03] border ${color} rounded-xl p-4`}>
                      <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* KPIs fila 2 */}
              {anulKpis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: t("crmCancellations.aceptadasTotal"), value: anulKpis.resueltasTotal, color: "border-success/20" },
                    { label: t("crmCancellations.aceptadasParcial"), value: anulKpis.resueltasParcial, color: "border-success/20" },
                    { label: t("crmCancellations.rechazadas"), value: anulKpis.rechazadas, color: "border-danger/20" },
                    { label: voc.licensed ? t("crmCancellations.valesEnviados") : t("crmCancellations.bonosEnviados"), value: anulKpis.compensadasBono, color: "border-primary/20" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-foreground/[0.03] border ${color} rounded-xl p-4`}>
                      <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Filtros */}
              <div className="flex flex-wrap gap-3">
                <Select value={anulOpFilter} onValueChange={setAnulOpFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder={t("crmCancellations.estadoOperativo")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmCancellations.todosLosEstados")}</SelectItem>
                    <SelectItem value="recibida" className="text-foreground/70 text-xs">{t("crmCancellations.recibida")}</SelectItem>
                    <SelectItem value="en_revision" className="text-foreground/70 text-xs">{t("crmCancellations.enRevision")}</SelectItem>
                    <SelectItem value="pendiente_documentacion" className="text-foreground/70 text-xs">{t("crmCancellations.pendDocumentacion")}</SelectItem>
                    <SelectItem value="pendiente_decision" className="text-foreground/70 text-xs">{t("crmCancellations.pendDecision")}</SelectItem>
                    <SelectItem value="resuelta" className="text-foreground/70 text-xs">{t("crmCancellations.resuelta")}</SelectItem>
                    <SelectItem value="cerrada" className="text-foreground/70 text-xs">{t("crmCancellations.cerrada")}</SelectItem>
                    <SelectItem value="incidencia" className="text-foreground/70 text-xs">{t("crmCancellations.incidencia")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulResFilter} onValueChange={setAnulResFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder={t("crmCancellations.resolucion")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmCancellations.todaResolucion")}</SelectItem>
                    <SelectItem value="sin_resolver" className="text-foreground/70 text-xs">{t("crmCancellations.sinResolver")}</SelectItem>
                    <SelectItem value="rechazada" className="text-foreground/70 text-xs">{t("crmCancellations.rechazada")}</SelectItem>
                    <SelectItem value="aceptada_total" className="text-foreground/70 text-xs">{t("crmCancellations.aceptadaTotal")}</SelectItem>
                    <SelectItem value="aceptada_parcial" className="text-foreground/70 text-xs">{t("crmCancellations.aceptadaParcial")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulFinFilter} onValueChange={setAnulFinFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder={t("crmCancellations.estadoFinanciero")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmCancellations.todoFinanciero")}</SelectItem>
                    <SelectItem value="sin_compensacion" className="text-foreground/70 text-xs">{t("crmCancellations.sinCompensacion")}</SelectItem>
                    <SelectItem value="pendiente_devolucion" className="text-foreground/70 text-xs">{t("crmCancellations.pendDevolucion")}</SelectItem>
                    <SelectItem value="devuelta_economicamente" className="text-foreground/70 text-xs">{t("crmCancellations.devuelta")}</SelectItem>
                    <SelectItem value="pendiente_bono" className="text-foreground/70 text-xs">{t("crmCancellations.pendBono")}</SelectItem>
                    <SelectItem value="compensada_bono" className="text-foreground/70 text-xs">{t("crmCancellations.bonoEnviado")}</SelectItem>
                    <SelectItem value="incidencia_economica" className="text-foreground/70 text-xs">{t("crmCancellations.incidenciaEc")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulReasonFilter} onValueChange={setAnulReasonFilter}>
                  <SelectTrigger className="w-40 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder={t("crmCancellations.motivo")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmCancellations.todosLosMotivos")}</SelectItem>
                    <SelectItem value="meteorologicas" className="text-foreground/70 text-xs">{t("crmCancellations.meteorologicas")}</SelectItem>
                    <SelectItem value="accidente" className="text-foreground/70 text-xs">{t("crmCancellations.accidente")}</SelectItem>
                    <SelectItem value="enfermedad" className="text-foreground/70 text-xs">{t("crmCancellations.enfermedad")}</SelectItem>
                    <SelectItem value="desistimiento" className="text-foreground/70 text-xs">{t("crmCancellations.desistimiento")}</SelectItem>
                    <SelectItem value="otra" className="text-foreground/70 text-xs">{t("crmCancellations.otra")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAnul()}
                  className="gap-1.5 border-foreground/[0.12] text-foreground/50 hover:text-foreground h-9"
                >
                  <RefreshCw className="w-3.5 h-3.5" />{t("crmCancellations.actualizar")}</Button>
                <Button
                  size="sm"
                  onClick={() => window.open("/solicitar-anulacion", "_blank")}
                  className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground h-9 ml-auto"
                >
                  <ExternalLink className="w-3.5 h-3.5" />{t("crmCancellations.verFormularioPublico")}</Button>
              </div>
              {/* Tabla */}
              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">#</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.solicitante")}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{voc.Order}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.motivo")}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{voc.serviceDateColumn}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.estadoOp")}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.resolucion")}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.financiero")}</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.fecha")}</th>
                        <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmCancellations.acciones")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anulLoading && (
                        <tr>
                          <td colSpan={10} className="text-center py-12 text-foreground/40">
                            <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                          </td>
                        </tr>
                      )}
                      {!anulLoading && anulError && (
                        <tr>
                          <td colSpan={10} className="text-center py-12">
                            <AlertTriangle className="w-8 h-8 text-danger/60 mx-auto mb-2" />
                            <p className="text-danger/70 text-sm font-medium">{t("crmCancellations.errorAlCargarLas")}</p>
                            <button onClick={() => refetchAnul()} className="mt-2 text-xs text-foreground/40 hover:text-foreground/70 underline">{t("crmCancellations.reintentar")}</button>
                          </td>
                        </tr>
                      )}
                      {!anulLoading && !anulError && anulRows.length === 0 && (
                        <tr>
                          <td colSpan={10} className="text-center py-12">
                            <AlertTriangle className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
                            <p className="text-foreground/40 text-sm">{t("crmCancellations.noHaySolicitudesQue")}</p>
                          </td>
                        </tr>
                      )}
                      {anulRows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                          onClick={() => setSelectedAnulId(row.id)}
                        >
                          <td className="px-4 py-3 text-foreground/50 text-sm font-mono">#{row.id}</td>
                          <td className="px-4 py-3">
                            <p className="text-white text-sm font-medium">{row.fullName}</p>
                            {row.email && <p className="text-foreground/50 text-xs">{row.email}</p>}
                            {row.locator && <p className="text-foreground/40 text-xs font-mono">{row.locator}</p>}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            {row.linkedReservationId && row.reservationNumber ? (
                              <button
                                onClick={() => setViewResId(row.linkedReservationId!)}
                                className="font-mono text-xs text-warning hover:text-warning hover:underline transition-colors"
                                title={voc.viewOrder}
                              >
                                {row.reservationNumber}
                              </button>
                            ) : (
                              <span className="text-foreground/30 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {row.reason === "meteorologicas" && <CloudLightning className="w-4 h-4 text-info" />}
                              {row.reason === "accidente" && <AlertTriangle className="w-4 h-4 text-danger" />}
                              {row.reason === "enfermedad" && <HeartPulse className="w-4 h-4 text-danger" />}
                              {row.reason === "desistimiento" && <XCircle className="w-4 h-4 text-foreground/50" />}
                              {row.reason === "otra" && <HelpCircle className="w-4 h-4 text-foreground/50" />}
                              <span className="text-foreground/65 text-xs capitalize">{row.reason}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-foreground/65 text-sm">{row.activityDate}</td>
                          <td className="px-4 py-3">
                            <AnulOpBadge status={row.operationalStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulResBadge status={row.resolutionStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulFinBadge status={row.financialStatus} />
                          </td>
                          <td className="px-4 py-3 text-foreground/50 text-xs">
                            {format.date(row.createdAt, {})}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setSelectedAnulId(row.id)}
                                className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                                title={t("crmCancellations.verDetalle")}
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteAnulId(row.id)}
                                className="p-1.5 rounded-lg text-foreground/30 hover:text-danger hover:bg-danger/10 transition-colors"
                                title={t("crmCancellations.eliminar")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {anulData && anulData.total > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                    <span className="text-sm text-foreground/50">
                      {anulData.total <= PAGE_SIZE
                        ? t("crmCancellations.mostrandoDeSolicitudes", { total: anulData.total, total2: anulData.total })
                        : t("crmCancellations.paginaDeSolicitudes", { v: anulPage + 1, ceil: Math.ceil(anulData.total / PAGE_SIZE), total: anulData.total })}
                    </span>
                    {anulData.total > PAGE_SIZE && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAnulPage(p => p - 1)}
                          disabled={anulPage === 0}
                          className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                        >{t("crmCancellations.anterior")}</button>
                        <button
                          onClick={() => setAnulPage(p => p + 1)}
                          disabled={(anulPage + 1) * PAGE_SIZE >= anulData.total}
                          className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                        >{t("crmCancellations.siguiente")}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
    </>
  );
}

export function CancellationsModals({ ctrl, handleTabChange, setViewResId, cancelReservationId, cancelReservationName, setCancelReservationId, setCancelReservationName }: { ctrl: CancellationsController; handleTabChange: (t: Tab) => void; setViewResId: React.Dispatch<React.SetStateAction<number | null>>; cancelReservationId: number | null; cancelReservationName: string; setCancelReservationId: React.Dispatch<React.SetStateAction<number | null>>; setCancelReservationName: React.Dispatch<React.SetStateAction<string>> }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { selectedAnulId, setSelectedAnulId, deleteAnulId, setDeleteAnulId, deleteAnulMutation, setCancelAutoAcceptAnulId, cancelAutoAcceptAnulId } = ctrl;
  return (
    <>
{/* ─── MODALES DE ANULACIONES ──────────────────────────────────────────── */}
{/* Modal detalle anulación */}
{selectedAnulId !== null && (
        <CancellationDetailModal
          requestId={selectedAnulId}
          onClose={() => {
            setSelectedAnulId(null);
            utils.cancellations.listRequests.invalidate();
          }}
          onNavigateToReservation={(reservationId) => {
            setSelectedAnulId(null);
            handleTabChange("reservations");
            setViewResId(reservationId);
          }}
        />
      )}
{/* Confirmar eliminación anulación */}
<Dialog open={deleteAnulId !== null} onOpenChange={(o) => !o && setDeleteAnulId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle>{t("crmCancellations.eliminarSolicitud")}</DialogTitle>
          </DialogHeader>
          <p className="text-foreground/65 text-sm">{t("crmCancellations.seguroQueQuieresEliminar")}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteAnulId(null)} className="border-foreground/[0.12] text-foreground/65">{t("crmCancellations.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteAnulId && deleteAnulMutation.mutate({ id: deleteAnulId })}
              disabled={deleteAnulMutation.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deleteAnulMutation.isPending ? t("crmCancellations.eliminando") : t("crmCancellations.eliminar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* ─── MODAL: Anular reserva directa — paso 1: motivo ────────────────────── */}
{cancelReservationId !== null && (
        <AnularReservaModal
          reservationId={cancelReservationId}
          reservationName={cancelReservationName}
          onClose={() => { setCancelReservationId(null); setCancelReservationName(""); }}
          onCreated={(requestId) => {
            setCancelReservationId(null);
            setCancelReservationName("");
            setCancelAutoAcceptAnulId(requestId);
          }}
        />
      )}
{/* ─── MODAL: Anular reserva directa — paso 2: resolución (CancellationDetailModal) ── */}
{cancelAutoAcceptAnulId !== null && (
        <CancellationDetailModal
          requestId={cancelAutoAcceptAnulId}
          autoOpenAccept
          onClose={() => {
            setCancelAutoAcceptAnulId(null);
            utils.crm.reservations.list.invalidate();
            utils.crm.reservations.counters.invalidate();
            utils.cancellations.listRequests.invalidate();
            utils.cancellations.getCounters.invalidate();
            utils.crm.invoices.listAll.invalidate();
          }}
          onNavigateToReservation={(reservationId) => {
            setCancelAutoAcceptAnulId(null);
            handleTabChange("reservations");
            setViewResId(reservationId);
          }}
        />
      )}
    </>
  );
}
