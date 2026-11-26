import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LeadWebRequestBlock } from "../LeadWebRequestBlock";
import { FileText, XCircle, Phone, Mail, MessageSquare, RefreshCw, BellOff, Bell } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { DT_FULL, EUR2, OpportunityStatus, Priority, QuoteStatus, OpportunityBadge, QuoteStatusBadge, PriorityDot, ScheduledJobsMini } from "../shared/crmCommon";
import { CrmFormSection } from "../shared/ui/CrmUi";

// ─── LEAD DETAIL MODAL ────────────────────────────────────────────────────────
export function LeadDetailModal({
  leadId,
  onClose,
  onConvert,
}: {
  leadId: number;
  onClose: () => void;
  onConvert: (leadId: number, leadName?: string) => void;
}) {
  const { t, format } = useI18n();
  const [note, setNote] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [showPauseInput, setShowPauseInput] = useState(false);
  const utils = trpc.useUtils();
  const voc = useVocabulary();

  const { data, isLoading } = trpc.crm.leads.get.useQuery({ id: leadId });

  const addNote = trpc.crm.leads.addNote.useMutation({
    onSuccess: () => {
      toast.success(t("crmLeads.notaAnadida"));
      setNote("");
      utils.crm.leads.get.invalidate({ id: leadId });
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const updateStatus = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success(t("crmLeads.estadoActualizado"));
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
    },
  });

  const markLost = trpc.crm.leads.markLost.useMutation({
    onSuccess: () => {
      toast.success(`${voc.Lead} ${voc.agreeLead("marcado como perdido", "marcada como perdida")}`);
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
      onClose();
    },
  });

  const generateQuote = trpc.crm.leads.generateFromLead.useMutation({
    onSuccess: (result) => {
      toast.success(
        t("crmLeads.presupuestoGeneradoCon", { quoteNumber: result.quoteNumber, itemCount: result.itemCount, total: format.currency(result.total, "EUR", EUR2) }),
        { duration: 5000 }
      );
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.quotes.list.invalidate();
      onClose();
      // Navegar al presupuesto generado
      window.location.href = `/admin/crm?tab=quotes&quoteId=${result.quoteId}`;
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const emailPrefsQ = trpc.emailCommunications.getCustomerPrefs.useQuery(
    { email: data?.lead?.email ?? "" },
    { enabled: !!data?.lead?.email }
  );
  const setPrefs = trpc.emailCommunications.setCustomerPrefs.useMutation({
    onSuccess: () => {
      toast.success(emailPrefsQ.data?.automationsPaused ? t("crmLeads.automatizacionesReanudadas") : t("crmLeads.automatizacionesPausadas"));
      setPauseReason("");
      setShowPauseInput(false);
      emailPrefsQ.refetch();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-warning" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { lead, activity, quotes: relatedQuotes } = data;
  const emailPrefs = emailPrefsQ.data;

  return (
    <>
    <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-foreground">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            {lead.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-bold">{lead.name}</div>
            <div className="text-sm text-foreground/60 font-normal">{lead.email}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Status & Priority */}
        <div className="flex items-center gap-3 flex-wrap">
          <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
          {(lead as any).source === "venta_perdida" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger/15 text-danger border border-danger/25">{t("crmLeads.ventaAbandonada")}</span>
          )}
          <PriorityDot priority={lead.priority as Priority} />
          <span className="text-xs text-foreground/50 capitalize">{t("crmLeads.prioridad", { priority: lead.priority })}</span>
          <span className="text-xs text-foreground/40">·</span>
          <span className="text-xs text-foreground/50">{format.date(lead.createdAt, {})}</span>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-foreground/70 hover:text-warning transition-colors">
              <Phone className="w-3.5 h-3.5" /> {lead.phone}
            </a>
          )}
          <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-foreground/70 hover:text-warning transition-colors">
            <Mail className="w-3.5 h-3.5" /> {lead.email}
          </a>
        </div>

        {/* Solicitud web estructurada (solo leads que vienen de la ficha de un producto) */}
        <LeadWebRequestBlock request={data.webRequest} />

        {/* Request details */}
        <CrmFormSection title={t("crmOpps.seccionSolicitud")} className="space-y-2">
          {lead.selectedCategory && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">{t("crmLeads.categoria")}</span>
              <span className="text-foreground font-medium">{lead.selectedCategory}</span>
            </div>
          )}
          {lead.selectedProduct && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">{t("crmLeads.producto")}</span>
              <span className="text-foreground font-medium">{lead.selectedProduct}</span>
            </div>
          )}
          {lead.preferredDate && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">{voc.serviceDate}</span>
              <span className="text-foreground font-medium">{format.date(lead.preferredDate, {})}</span>
            </div>
          )}
          {(lead as any).preferredTime && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">{t("crmLeads.horaSolicitada")}</span>
              <span className="text-foreground font-medium">{(lead as any).preferredTime}</span>
            </div>
          )}
          {(lead.numberOfAdults || lead.numberOfPersons) && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">{t("crmLeads.personas")}</span>
              <span className="text-foreground font-medium">
                {lead.numberOfAdults ? t("crmLeads.adultos2", { numberOfAdults: lead.numberOfAdults }) : ""}{lead.numberOfChildren ? t("crmLeads.ninos2", { numberOfChildren: lead.numberOfChildren }) : ""}
                {!lead.numberOfAdults && lead.numberOfPersons ? t("crmLeads.personas2", { numberOfPersons: lead.numberOfPersons }) : ""}
              </span>
            </div>
          )}
          {/* Actividades enriquecidas desde el formulario multi-actividad */}
          {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 && (
            <div className="pt-2 border-t border-foreground/[0.12]">
              <p className="text-xs text-foreground/50 uppercase tracking-wider mb-2">{voc.requestedItems}</p>
              <div className="space-y-2">
                {(lead.activitiesJson as any[]).map((act: any, i: number) => (
                  <div key={i} className="bg-foreground/[0.06] rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-foreground">{act.experienceTitle}</span>
                      <span className="text-xs text-warning font-bold bg-warning/10 px-2 py-0.5 rounded-full">{t("crmLeads.pax", { participants: act.participants })}</span>
                    </div>
                    {act.details && Object.keys(act.details).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(act.details).map(([k, v]) => {
                          const labelMap: Record<string, string> = {
                            duration: t("crmLeads.duracion"), jumps: 'Saltos', level: 'Nivel',
                            type: 'Tipo', notes: 'Notas'
                          };
                          return (
                            <span key={k} className="text-xs bg-info/10 text-info border border-info/20 rounded-full px-2 py-0.5">
                              {labelMap[k] ?? k}: <strong>{String(v)}</strong>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {lead.message && (
            <div className="pt-2 border-t border-foreground/[0.12]">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground/45">{t("crmLeads.mensaje")}</p>
              <p className="text-sm text-foreground/80 whitespace-pre-line break-words" data-testid="lead-message">{lead.message}</p>
            </div>
          )}
        </CrmFormSection>

        {/* Related quotes */}
        {relatedQuotes.length > 0 && (
          <CrmFormSection title={t("crmLeads.presupuestosAsociados")}>
            <div className="space-y-2">
              {relatedQuotes.map((q: any) => (
                <div key={q.id} className="flex items-center justify-between bg-foreground/[0.05] rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{q.quoteNumber}</span>
                    <span className="text-xs text-foreground/50 ml-2">{q.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuoteStatusBadge status={q.status as QuoteStatus} />
                    <span className="text-sm font-bold text-warning">{format.currency(Number(q.total), "EUR", EUR2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CrmFormSection>
        )}

        {/* Email automation preferences */}
        <CrmFormSection title={t("crmLeads.emailsAutomaticos")}>
          <div className={`rounded-lg border px-4 py-3 flex items-start justify-between gap-3 ${emailPrefs?.automationsPaused ? "bg-warning/10 border-warning/40" : "bg-foreground/[0.04] border-foreground/[0.10]"}`}>
            <div className="flex items-start gap-2.5">
              {emailPrefs?.automationsPaused
                ? <BellOff className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                : <Bell className="w-4 h-4 text-success mt-0.5 shrink-0" />}
              <div>
                <div className="text-sm font-medium text-foreground">
                  {emailPrefs?.automationsPaused ? t("crmLeads.automatizacionesPausadas") : t("crmLeads.automatizacionesActivas")}
                </div>
                {emailPrefs?.automationsPaused && emailPrefs.pauseReason && (
                  <div className="text-xs text-warning/80 mt-0.5">{t("crmLeads.motivo", { pauseReason: emailPrefs.pauseReason })}</div>
                )}
                {emailPrefs?.automationsPaused && emailPrefs.pausedAt && (
                  <div className="text-xs text-foreground/40 mt-0.5">{t("crmLeads.pausadoEl")}{" "}{format.date(emailPrefs.pausedAt, {})}
                  </div>
                )}
                {!emailPrefs?.automationsPaused && (
                  <div className="text-xs text-foreground/40 mt-0.5">{t("crmLeads.esteClienteRecibeEmails")}</div>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {emailPrefs?.automationsPaused ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 border-success/50 text-success hover:bg-success/15"
                  onClick={() => setPrefs.mutate({ email: lead.email, automationsPaused: false })}
                  disabled={setPrefs.isPending}
                >
                  <Bell className="w-3 h-3 mr-1" />{" "}{t("crmLeads.reanudar")}</Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 border-warning/50 text-warning hover:bg-warning/15"
                  onClick={() => setShowPauseInput(v => !v)}
                >
                  <BellOff className="w-3 h-3 mr-1" />{" "}{t("crmLeads.pausar")}</Button>
              )}
            </div>
          </div>
          {showPauseInput && !emailPrefs?.automationsPaused && (
            <div className="mt-2 flex gap-2">
              <Input
                value={pauseReason}
                onChange={e => setPauseReason(e.target.value)}
                placeholder={t("crmLeads.motivoOpcional")}
                className="h-8 text-xs bg-foreground/[0.05] border-foreground/[0.12] text-foreground"
              />
              <Button
                size="sm"
                className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                onClick={() => setPrefs.mutate({ email: lead.email, automationsPaused: true, pauseReason: pauseReason || null })}
                disabled={setPrefs.isPending}
              >{t("crmLeads.confirmarPausa")}</Button>
            </div>
          )}
        </CrmFormSection>

        {/* Emails automáticos programados para este lead */}
        <CrmFormSection title={t("crmLeads.emailsProgramados")}>
          <ScheduledJobsMini entityType="lead" entityId={leadId} />
        </CrmFormSection>

        {/* Notes */}
        <CrmFormSection title={t("crmLeads.notasInternas")}>
          {Array.isArray(lead.internalNotes) && lead.internalNotes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {(lead.internalNotes as { text: string; authorName: string; createdAt: string }[]).map((n, i) => (
                <div key={i} className="bg-foreground/[0.05] rounded-lg px-3 py-2">
                  <p className="text-sm text-foreground/80">{n.text}</p>
                  <p className="text-xs text-foreground/40 mt-1">{n.authorName} · {format.dateTime(n.createdAt, DT_FULL)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/40 mb-3">{t("crmLeads.sinNotasAun")}</p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("crmLeads.anadirNotaInterna")}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm resize-none h-16"
            />
            <Button
              size="sm"
              onClick={() => addNote.mutate({ id: leadId, text: note })}
              disabled={!note.trim() || addNote.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground self-end"
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
          </div>
        </CrmFormSection>

        {/* Change status */}
        <CrmFormSection title={t("crmLeads.cambiarEstado")}>
          <div className="flex gap-2 flex-wrap">
            {(["nueva", "enviada", "ganada", "perdida"] as OpportunityStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className={`border-foreground/[0.15] text-foreground/70 hover:text-foreground text-xs capitalize ${lead.opportunityStatus === s ? "bg-foreground/[0.08] text-foreground" : ""}`}
                onClick={() => updateStatus.mutate({ id: leadId, opportunityStatus: s })}
              >
                {s}
              </Button>
            ))}
          </div>
        </CrmFormSection>
      </div>

      <DialogFooter className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="border-danger/30 text-danger hover:bg-danger/10"
          onClick={() => markLost.mutate({ id: leadId })}
        >
          <XCircle className="w-4 h-4 mr-1" />{" "}{t("crmLeads.marcarPerdido")}</Button>
        {/* Botón 'Generar presupuesto' eliminado — flujo correcto es 'Crear Presupuesto' que abre el modal */}
        <Button
          size="sm"
          onClick={() => { onClose(); onConvert(leadId, undefined); }}
        >
          <FileText className="w-4 h-4 mr-1" />{" "}{t("crmLeads.crearPresupuesto")}</Button>
      </DialogFooter>
    </DialogContent>
    </>
  );
}