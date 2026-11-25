import React, { useState, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import CancellationDetailModal from "../CancellationDetailModal";
import { Eye, XCircle, AlertTriangle, RefreshCw, Trash2, CloudLightning, HeartPulse, HelpCircle, Inbox, Search, FileWarning, Clock, CheckCircle2, Archive, Wallet } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Tab, PAGE_SIZE } from "../shared/crmCommon";
import { BPill, BStat, BSummary, BFilterBar, BFilterField, BTable, BRowActions, BPager, type BChip, type BColumn, type BTone } from "../shared/ui/bCrmUi";
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
  const { anulKpis, anulOpFilter, setAnulOpFilter, anulResFilter, setAnulResFilter, anulFinFilter, setAnulFinFilter, anulReasonFilter, setAnulReasonFilter, anulSearch, setAnulSearch, refetchAnul, anulLoading, anulError, anulRows, setSelectedAnulId, setDeleteAnulId, anulData, anulPage, setAnulPage } = ctrl;
  const opOptions: [string, string][] = [
    ["recibida", t("crmCancellations.recibida")], ["en_revision", t("crmCancellations.enRevision")], ["pendiente_documentacion", t("crmCancellations.pendDocumentacion")],
    ["pendiente_decision", t("crmCancellations.pendDecision")], ["resuelta", t("crmCancellations.resuelta")], ["cerrada", t("crmCancellations.cerrada")], ["incidencia", t("crmCancellations.incidencia")],
  ];
  const resOptions: [string, string][] = [
    ["sin_resolver", t("crmCancellations.sinResolver")], ["rechazada", t("crmCancellations.rechazada")], ["aceptada_total", t("crmCancellations.aceptadaTotal")], ["aceptada_parcial", t("crmCancellations.aceptadaParcial")],
  ];
  const finOptions: [string, string][] = [
    ["sin_compensacion", t("crmCancellations.sinCompensacion")], ["pendiente_devolucion", t("crmCancellations.pendDevolucion")], ["devuelta_economicamente", t("crmCancellations.devuelta")],
    ["pendiente_bono", t("crmCancellations.pendBono")], ["compensada_bono", t("crmCancellations.bonoEnviado")], ["incidencia_economica", t("crmCancellations.incidenciaEc")],
  ];
  const reasonOptions: [string, string][] = [
    ["meteorologicas", t("crmCancellations.meteorologicas")], ["accidente", t("crmCancellations.accidente")], ["enfermedad", t("crmCancellations.enfermedad")], ["desistimiento", t("crmCancellations.desistimiento")], ["otra", t("crmCancellations.otra")],
  ];
  const labelOf = (opts: [string, string][], v: string) => opts.find(([k]) => k === v)?.[1] ?? v;
  const toggle = (cur: string, set: (v: string) => void, v: string) => set(cur === v ? "all" : v);
  const clearAll = () => { setAnulOpFilter("all"); setAnulResFilter("all"); setAnulFinFilter("all"); setAnulReasonFilter("all"); setAnulSearch(""); };
  const chips: BChip[] = [
    ...(anulOpFilter !== "all" ? [{ id: "op", label: `${t("crmCancellations.estadoOperativo")}: ${labelOf(opOptions, anulOpFilter)}`, onRemove: () => setAnulOpFilter("all") }] : []),
    ...(anulResFilter !== "all" ? [{ id: "res", label: `${t("crmCancellations.resolucion")}: ${labelOf(resOptions, anulResFilter)}`, onRemove: () => setAnulResFilter("all") }] : []),
    ...(anulFinFilter !== "all" ? [{ id: "fin", label: `${t("crmCancellations.estadoFinanciero")}: ${labelOf(finOptions, anulFinFilter)}`, onRemove: () => setAnulFinFilter("all") }] : []),
    ...(anulReasonFilter !== "all" ? [{ id: "reason", label: `${t("crmCancellations.motivo")}: ${labelOf(reasonOptions, anulReasonFilter)}`, onRemove: () => setAnulReasonFilter("all") }] : []),
    ...(anulSearch ? [{ id: "search", label: `“${anulSearch}”`, onRemove: () => setAnulSearch("") }] : []),
  ];
  const opPill = (s: string) => {
    const cfg: Record<string, [BTone, ReactNode]> = {
      recibida: ["info", <Inbox />], en_revision: ["warning", <Search />], pendiente_documentacion: ["warning", <FileWarning />], pendiente_decision: ["warning", <Clock />],
      resuelta: ["success", <CheckCircle2 />], cerrada: ["muted", <Archive />], incidencia: ["danger", <AlertTriangle />],
    };
    const [tone, icon] = cfg[s] ?? ["muted", <Clock />];
    return <BPill tone={tone} icon={icon}>{labelOf(opOptions, s)}</BPill>;
  };
  const resPill = (s: string) => {
    const tone: BTone = s === "rechazada" ? "danger" : s === "aceptada_total" || s === "aceptada_parcial" ? "success" : "muted";
    const icon = s === "rechazada" ? <XCircle /> : s === "sin_resolver" ? <Clock /> : <CheckCircle2 />;
    return <BPill tone={tone} icon={icon} title={t("crmCancellations.resolucion")}>{t("crmCancellations.pillResolucion", { label: labelOf(resOptions, s) })}</BPill>;
  };
  const finPill = (s: string) => {
    const tone: BTone = s === "incidencia_economica" ? "danger" : s === "pendiente_devolucion" ? "warning" : s === "devuelta_economicamente" ? "success" : s === "pendiente_bono" || s === "compensada_bono" ? "primary" : "muted";
    return <BPill tone={tone} icon={<Wallet />} title={t("crmCancellations.estadoFinanciero")}>{t("crmCancellations.pillFinanciero", { label: labelOf(finOptions, s) })}</BPill>;
  };
  const reasonIcon = (r: string) => (
    r === "meteorologicas" ? <CloudLightning className="h-4 w-4 text-info" aria-hidden="true" /> :
    r === "accidente" ? <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" /> :
    r === "enfermedad" ? <HeartPulse className="h-4 w-4 text-danger" aria-hidden="true" /> :
    r === "desistimiento" ? <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> :
    <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  );
  const columns: BColumn<any>[] = [
    { key: "who", header: t("crmCancellations.solicitante"), mobile: "title", cell: (row) => (
      <div className="min-w-0">
        <div className="flex items-baseline gap-2"><span className="font-mono text-xs text-muted-foreground">#{row.id}</span><span className="break-words font-medium text-foreground">{row.fullName}</span></div>
        {row.email && <div className="hidden max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground @2xl:block">{row.email}</div>}
        {row.locator && <div className="font-mono text-xs text-muted-foreground">{row.locator}</div>}
      </div>
    ) },
    { key: "order", header: `${voc.Order} / ${voc.serviceDateColumn}`, cell: (row) => (
      <div className="space-y-0.5">
        {row.linkedReservationId && row.reservationNumber ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setViewResId(row.linkedReservationId!); }} title={voc.viewOrder} className="font-mono text-xs font-medium text-primary hover:underline">{row.reservationNumber}</button>
        ) : <span className="text-xs text-muted-foreground">—</span>}
        {row.activityDate && <div className="text-xs tabular-nums text-muted-foreground">{row.activityDate}</div>}
      </div>
    ) },
    { key: "reason", header: t("crmCancellations.motivo"), priority: "md", cell: (row) => (
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground">{reasonIcon(row.reason)}<span className="capitalize">{labelOf(reasonOptions, row.reason)}</span></span>
    ) },
    { key: "state", header: t("crmCancellations.estadoOp"), cell: (row) => (
      <div className="flex flex-wrap items-start gap-1 @2xl:flex-col">{opPill(row.operationalStatus)}{resPill(row.resolutionStatus)}{finPill(row.financialStatus)}</div>
    ) },
    { key: "date", header: t("crmCancellations.fecha"), priority: "lg", num: true, mobile: "footer", cell: (row) => <span className="text-xs text-muted-foreground">{format.date(row.createdAt, {})}</span> },
  ];
  const statCards = anulKpis ? (
    <>
      <BSummary>
        <BStat tone="primary" icon={<Inbox />} label={t("crmCancellations.total")} value={anulKpis.total}
          hint={`${anulKpis.recibidas + anulKpis.enRevision + anulKpis.pendienteDocumentacion} ${t("crmShared.solicitudesAbiertas").toLowerCase()}`}
          onClick={() => clearAll()} />
        <BStat tone="info" label={t("crmCancellations.recibidas")} value={anulKpis.recibidas} onClick={() => toggle(anulOpFilter, setAnulOpFilter, "recibida")} active={anulOpFilter === "recibida"} />
        <BStat tone="warning" label={t("crmCancellations.enRevision")} value={anulKpis.enRevision} onClick={() => toggle(anulOpFilter, setAnulOpFilter, "en_revision")} active={anulOpFilter === "en_revision"} />
        <BStat tone="warning" label={t("crmCancellations.pendDocs")} value={anulKpis.pendienteDocumentacion} onClick={() => toggle(anulOpFilter, setAnulOpFilter, "pendiente_documentacion")} active={anulOpFilter === "pendiente_documentacion"} />
        <BStat tone="danger" label={t("crmCancellations.incidencias")} value={anulKpis.incidencias} onClick={() => toggle(anulOpFilter, setAnulOpFilter, "incidencia")} active={anulOpFilter === "incidencia"} />
        <BStat tone="muted" label={t("crmCancellations.cerradas")} value={anulKpis.cerradas} onClick={() => toggle(anulOpFilter, setAnulOpFilter, "cerrada")} active={anulOpFilter === "cerrada"} />
      </BSummary>
      <BSummary hero={false}>
        <BStat compact tone="success" label={t("crmCancellations.aceptadasTotal")} value={anulKpis.resueltasTotal} onClick={() => toggle(anulResFilter, setAnulResFilter, "aceptada_total")} active={anulResFilter === "aceptada_total"} />
        <BStat compact tone="success" label={t("crmCancellations.aceptadasParcial")} value={anulKpis.resueltasParcial} onClick={() => toggle(anulResFilter, setAnulResFilter, "aceptada_parcial")} active={anulResFilter === "aceptada_parcial"} />
        <BStat compact tone="danger" label={t("crmCancellations.rechazadas")} value={anulKpis.rechazadas} onClick={() => toggle(anulResFilter, setAnulResFilter, "rechazada")} active={anulResFilter === "rechazada"} />
        <BStat compact tone="primary" label={voc.licensed ? t("crmCancellations.valesEnviados") : t("crmCancellations.bonosEnviados")} value={anulKpis.compensadasBono} onClick={() => toggle(anulFinFilter, setAnulFinFilter, "compensada_bono")} active={anulFinFilter === "compensada_bono"} />
      </BSummary>
    </>
  ) : null;
  const sel = (value: string, onChange: (v: string) => void, all: string, opts: [string, string][]) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {opts.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  return (
    <>
{/* ─── TAB: ANULACIONES ─────────────────────────────────────────────── */}
{tab === "anulaciones" && (
      <div className="space-y-4">
        {statCards}
        <BFilterBar
          search={{ value: anulSearch, onChange: setAnulSearch, placeholder: t("crmCancellations.solicitante") }}
          primary={(
            <>
              <BFilterField label={t("crmCancellations.estadoOperativo")} className="w-full sm:w-48">{sel(anulOpFilter, setAnulOpFilter, t("crmCancellations.todosLosEstados"), opOptions)}</BFilterField>
              <BFilterField label={t("crmCancellations.resolucion")} className="w-full sm:w-48">{sel(anulResFilter, setAnulResFilter, t("crmCancellations.todaResolucion"), resOptions)}</BFilterField>
            </>
          )}
          more={(
            <>
              <BFilterField label={t("crmCancellations.estadoFinanciero")}>{sel(anulFinFilter, setAnulFinFilter, t("crmCancellations.todoFinanciero"), finOptions)}</BFilterField>
              <BFilterField label={t("crmCancellations.motivo")}>{sel(anulReasonFilter, setAnulReasonFilter, t("crmCancellations.todosLosMotivos"), reasonOptions)}</BFilterField>
            </>
          )}
          chips={chips}
          onClear={clearAll}
          summary={anulData ? `${anulData.total} ${voc.cancellations.toLowerCase()}` : undefined}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => refetchAnul()} aria-label={t("crmCancellations.actualizar")} title={t("crmCancellations.actualizar")} className="gap-1.5 max-sm:px-2.5"><RefreshCw className="h-4 w-4" aria-hidden="true" /><span className="max-sm:sr-only">{t("crmCancellations.actualizar")}</span></Button>
            </>
          )}
        />
        <BTable
          rows={anulRows as any[]}
          columns={columns}
          rowKey={(r) => r.id}
          caption={voc.cancellations}
          loading={anulLoading}
          error={anulError ? new Error(t("crmCancellations.errorAlCargarLas")) : undefined}
          onRetry={() => refetchAnul()}
          filtered={chips.length > 0}
          onClearFilters={clearAll}
          emptyTitle={t("crmCancellations.noHaySolicitudesQue")}
          onRowClick={(r) => setSelectedAnulId(r.id)}
          actions={(row) => (
            <BRowActions
              label={`#${row.id} ${row.fullName}`}
              primary={{ label: t("crmShared.ver"), icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => setSelectedAnulId(row.id) }}
              menu={[{ label: t("crmCancellations.eliminar"), icon: <Trash2 />, destructive: true, onSelect: () => setDeleteAnulId(row.id) }]}
            />
          )}
          footer={anulData && anulData.total > 0 ? (
            <BPager
              page={anulPage}
              onPrev={() => setAnulPage(p => p - 1)}
              onNext={() => setAnulPage(p => p + 1)}
              hasNext={(anulPage + 1) * PAGE_SIZE < anulData.total}
              prevLabel={t("crmCancellations.anterior")}
              nextLabel={t("crmCancellations.siguiente")}
              text={anulData.total <= PAGE_SIZE
                ? t("crmCancellations.mostrandoDeSolicitudes", { total: anulData.total, total2: anulData.total })
                : t("crmCancellations.paginaDeSolicitudes", { v: anulPage + 1, ceil: Math.ceil(anulData.total / PAGE_SIZE), total: anulData.total })}
            />
          ) : undefined}
        />
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
        <DialogContent className="max-w-sm">
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
              variant="destructive"
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
