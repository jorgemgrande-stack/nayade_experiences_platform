import { useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Mail, RefreshCw, Trash2, AlertTriangle, Calendar } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2 } from "../shared/crmCommon";
import { BPill, BMoney, BStat, BSummary, BFilterBar, BFilterField, BTable, BRowActions, type BChip, type BColumn, type BTone } from "../shared/ui/bCrmUi";

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

  const { data, isLoading, error, refetch } = trpc.crm.pendingPayments.list.useQuery({
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

  // Resumen superior: la misma lista sin filtrar de estado (solo lectura; misma consulta que «Todos»)
  const { data: allData } = trpc.crm.pendingPayments.list.useQuery({ limit: 50, offset: 0 });
  const allRows = allData?.items ?? [];
  const now = Date.now();
  const isOverdueRow = (r: { status: string; dueDate: unknown }) => (r.status as string) === "overdue" || (r.status === "pending" && !!r.dueDate && new Date(r.dueDate as string).getTime() < now);
  const openRows = allRows.filter((r) => r.status === "pending" || (r.status as string) === "overdue");
  const overdueRows = allRows.filter(isOverdueRow);
  const soonRows = allRows.filter((r) => r.status === "pending" && !!r.dueDate && new Date(r.dueDate as string).getTime() >= now && new Date(r.dueDate as string).getTime() <= now + 7 * 86_400_000);
  const sumCents = (xs: { amountCents: number }[]) => xs.reduce((a, r) => a + (r.amountCents || 0), 0) / 100;
  const money = (v: number) => format.currency(v, "EUR", EUR2);
  const statusMap: Record<string, [BTone, ReactNode, string]> = {
    pending: ["warning", <Clock />, t("crmPayments.pendiente")],
    overdue: ["danger", <AlertTriangle />, t("crmPayments.vencido")],
    confirmed: ["success", <CheckCircle />, t("crmPayments.confirmado")],
    paid: ["success", <CheckCircle />, t("crmPayments.confirmado")],
    cancelled: ["muted", <XCircle />, t("crmPayments.cancelado")],
  };
  const statusBadge = (status: string) => {
    const s = statusMap[status] ?? ["muted", <Clock />, status] as [BTone, ReactNode, string];
    return <BPill tone={s[0]} icon={s[1]}>{s[2]}</BPill>;
  };
  const clearAll = () => setFilterStatus("all");
  const chips: BChip[] = filterStatus !== "all" ? [{ id: "status", label: `${t("crmShared.filtroEstado")}: ${statusMap[filterStatus]?.[2] ?? filterStatus}`, onRemove: clearAll }] : [];
  const columns: BColumn<(typeof rows)[number]>[] = [
    { key: "client", header: t("crmPayments.cliente"), mobile: "title", cell: (row) => (
      <div className="min-w-0">
        <div className="flex items-baseline gap-2"><span className="font-mono text-xs text-muted-foreground">#{row.id}</span><span className="break-words font-medium text-foreground">{row.clientName}</span></div>
        {row.clientEmail && <div className="hidden max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground @2xl:block">{row.clientEmail}</div>}
      </div>
    ) },
    { key: "quote", header: t("crmPayments.presupuesto"), priority: "md", cell: (row) => row.quoteId ? <span className="font-mono text-xs text-foreground">{t("crmPayments.pres", { quoteId: row.quoteId })}</span> : <span className="text-muted-foreground">—</span> },
    { key: "due", header: t("crmPayments.vencimiento"), num: true, cell: (row) => {
      const dueDate = row.dueDate ? new Date(row.dueDate) : null;
      const late = isOverdueRow(row);
      return dueDate ? (
        <span className={`inline-flex items-center gap-1 text-xs ${late ? "font-semibold text-danger" : "text-foreground"}`}>
          {late && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}{format.date(dueDate, {})}
        </span>
      ) : <span className="text-muted-foreground">—</span>;
    } },
    { key: "reason", header: t("crmPayments.motivo"), priority: "lg", cell: (row) => <span className="block max-w-[12rem] break-words text-xs text-muted-foreground">{row.reason ?? "—"}</span> },
    { key: "status", header: t("crmPayments.estado"), cell: (row) => statusBadge(row.status) },
    { key: "amount", header: t("crmPayments.importe"), align: "right", num: true, mobile: "amount", cell: (row) => <BMoney>{money(row.amountCents / 100)}</BMoney> },
  ];

  return (
    <div className="space-y-4">
      {allData && (
        <BSummary>
          <BStat tone="primary" icon={<Clock />} label={t("crmShared.porCobrar")} value={money(sumCents(openRows))} hint={`${openRows.length} · ${t("crmShared.importeAbierto").toLowerCase()}`} />
          <BStat tone="danger" icon={<AlertTriangle />} label={t("crmShared.vencidos")} value={overdueRows.length} hint={money(sumCents(overdueRows))} />
          <BStat tone="warning" icon={<Calendar />} label={t("crmShared.vencenSemana")} value={soonRows.length} hint={money(sumCents(soonRows))} />
        </BSummary>
      )}

      <BFilterBar
        primary={(
          <BFilterField label={t("crmShared.filtroEstado")} className="w-full sm:w-48">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("crmPayments.todos")}</SelectItem>
                <SelectItem value="pending">{t("crmPayments.pendiente")}</SelectItem>
                <SelectItem value="overdue">{t("crmPayments.vencido")}</SelectItem>
                <SelectItem value="confirmed">{t("crmPayments.confirmado")}</SelectItem>
                <SelectItem value="cancelled">{t("crmPayments.cancelado")}</SelectItem>
              </SelectContent>
            </Select>
          </BFilterField>
        )}
        chips={chips}
        onClear={clearAll}
        summary={t("crmPayments.registro", { total })}
        actions={<Button type="button" variant="outline" onClick={() => refetch()} aria-label={t("crmCancellations.actualizar")} title={t("crmCancellations.actualizar")} className="px-2.5"><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>}
      />

      <BTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption={voc.pendingPayments}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        filtered={chips.length > 0}
        onClearFilters={clearAll}
        emptyTitle={t("crmPayments.noHayPagosPendientes")}
        actions={(row) => (
          <BRowActions
            label={`#${row.id} ${row.clientName}`}
            primary={row.status === "pending" ? { label: t("crmPayments.confirmarPago"), icon: <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => { setConfirmId(row.id); setConfirmMethod("transferencia"); } } : undefined}
            menu={[
              ...(row.status === "pending" ? [
                { label: t("crmPayments.reenviarRecordatorio"), icon: <Mail />, onSelect: () => resendMut.mutate({ id: row.id }), disabled: resendMut.isPending },
                { label: t("crmPayments.cancelar"), icon: <XCircle />, onSelect: () => setCancelId(row.id) },
              ] : []),
              { label: t("crmPayments.eliminarRegistro"), icon: <Trash2 />, destructive: true, separatorBefore: row.status === "pending", onSelect: () => setDeleteId(row.id) },
            ]}
          />
        )}
      />

      {/* Confirm payment modal */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />{" "}{t("crmPayments.confirmarPagoRecibido")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmPayments.metodoDePago")}</Label>
              <Select value={confirmMethod} onValueChange={(v) => setConfirmMethod(v as any)}>
                <SelectTrigger >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">{t("crmPayments.transferenciaBancaria")}</SelectItem>
                  <SelectItem value="tarjeta_fisica">{t("crmPayments.tarjetaFisica")}</SelectItem>
                  <SelectItem value="efectivo">{t("crmPayments.efectivo")}</SelectItem>
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-danger" />{" "}{t("crmPayments.cancelarPagoPendiente")}</DialogTitle>
          </DialogHeader>
          <p className="text-foreground/65 text-sm py-2">{t("crmPayments.seguroQueQuieresCancelar")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmPayments.volver")}</Button>
            <Button
              size="sm"
              onClick={() => cancelId !== null && cancelMut.mutate({ id: cancelId })}
              disabled={cancelMut.isPending}
              variant="destructive"
            >
              {cancelMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}{t("crmPayments.cancelarPago")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete modal */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
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
              variant="destructive"
            >
              {deleteMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmPayments.eliminarDefinitivamente")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}