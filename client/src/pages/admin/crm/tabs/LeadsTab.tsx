import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ProposalLeadButton } from "../ProposalsManager";
import { FileText, Eye, Phone, AlertTriangle, RefreshCw, Trash2, Pencil, Plus, Users } from "lucide-react";
import { PersonAvatar } from "@/components/admin/PanelVisual";
import { StatusBadge } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { useI18n } from "@/i18n/I18nProvider";
import { Tab, OpportunityStatus, Priority, OpportunityBadge, PriorityDot, PAGE_SIZE } from "../shared/crmCommon";
import { CrmBulkBar, CrmPager, CrmRowActions, CrmTable } from "../shared/ui/CrmUi";
import { LeadDetailModal } from "../modals/LeadDetailModal";
import { LeadEditModal } from "../modals/LeadEditModal";
import { NewLeadModal } from "../modals/NewLeadModal";
import { QuoteBuilderModal } from "../modals/QuoteBuilderModal";


export function useLeadsController({ filterStatus, search, tab }: { filterStatus: string; search: string; tab: Tab }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const utils = trpc.useUtils();
  // Selección masiva
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set());
  const [bulkLeadsStatus, setBulkLeadsStatus] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [editLeadId, setEditLeadId] = useState<number | null>(null);
  const [deleteLeadId, setDeleteLeadId] = useState<number | null>(null);
  const [convertLeadId, setConvertLeadId] = useState<number | null>(null);
  const [convertLeadName, setConvertLeadName] = useState<string>("");
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [leadSourceFilter, setLeadSourceFilter] = useState<number | "all" | "web">("all");
  const [leadsPage, setLeadsPage] = useState(0);
  // Resetear página al cambiar filtros o búsqueda
  useEffect(() => { setLeadsPage(0); }, [filterStatus, search, leadSourceFilter]);
  const leadsFilter = useMemo(() => ({
    opportunityStatus: filterStatus !== "all" && tab === "leads" ? (filterStatus as OpportunityStatus) : undefined,
    search: search || undefined,
    leadSourceId: typeof leadSourceFilter === "number" ? leadSourceFilter : undefined,
    webRequestsOnly: leadSourceFilter === "web" ? true : undefined,
    limit: PAGE_SIZE,
    offset: leadsPage * PAGE_SIZE,
  }), [filterStatus, search, tab, leadsPage, leadSourceFilter]);
  const { data: leadsData, isLoading: leadsLoading, error: leadsError, refetch: refetchLeadsList } = trpc.crm.leads.list.useQuery(leadsFilter, { enabled: tab === "leads" });
  // ─── Acciones masivas ─────────────────────────────────────────────────────────
  const bulkDeleteLeads = trpc.crm.leads.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.leadSEliminados", { deleted: r.deleted })); setSelectedLeads(new Set()); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const bulkMarkSeenLeads = trpc.crm.leads.bulkMarkSeen.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.leadSMarcadosComo", { updated: r.updated })); setSelectedLeads(new Set()); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const bulkUpdateLeadsStatus = trpc.crm.leads.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.estadoActualizadoEnLead", { updated: r.updated })); setSelectedLeads(new Set()); setBulkLeadsStatus(""); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const markLeadContacted = trpc.crm.leads.markContacted.useMutation({
    onSuccess: () => {
      toast.success(voc.agreeLead(t("crmEmpty.toast.leadContactedM", { lead: voc.Lead }), t("crmEmpty.toast.leadContactedF", { lead: voc.Lead })));
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.accounting.getOverview.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const deleteLead = trpc.crm.leads.delete.useMutation({
    onSuccess: () => {
      toast.success(`${voc.Lead} ${voc.agreeLead("eliminado", "eliminada")}`);
      setDeleteLeadId(null);
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  return { selectedLeads, setSelectedLeads, bulkLeadsStatus, setBulkLeadsStatus, selectedLeadId, setSelectedLeadId, editLeadId, setEditLeadId, deleteLeadId, setDeleteLeadId, convertLeadId, setConvertLeadId, convertLeadName, setConvertLeadName, showNewLeadModal, setShowNewLeadModal, leadSourceFilter, setLeadSourceFilter, leadsPage, setLeadsPage, leadsFilter, leadsData, leadsLoading, leadsError, refetchLeadsList, bulkDeleteLeads, bulkMarkSeenLeads, bulkUpdateLeadsStatus, markLeadContacted, deleteLead };
}
export type LeadsController = ReturnType<typeof useLeadsController>;

export function LeadsTab({ ctrl, tab, setBulkConfirm, filterStatus, search, setFilterStatus, setSearch }: { ctrl: LeadsController; tab: Tab; setBulkConfirm: React.Dispatch<React.SetStateAction<null | "leads" | "quotes" | "reservations">>; filterStatus: string; search: string; setFilterStatus: React.Dispatch<React.SetStateAction<string>>; setSearch: React.Dispatch<React.SetStateAction<string>> }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const panelSub = usePanelSubscription();
  const { selectedLeads, bulkMarkSeenLeads, bulkLeadsStatus, bulkUpdateLeadsStatus, bulkDeleteLeads, setSelectedLeads, leadsData, leadsLoading, leadsError, refetchLeadsList, setShowNewLeadModal, setSelectedLeadId, setEditLeadId, markLeadContacted, setConvertLeadId, setConvertLeadName, setDeleteLeadId, leadsPage, setLeadsPage, leadSourceFilter, setLeadSourceFilter } = ctrl;
  const filtered = filterStatus !== "all" || !!search.trim() || leadSourceFilter !== "all";
  return (
    <>
{tab === "leads" && (
            <div className="space-y-3">
            {leadsError ? (
              <PanelError error={leadsError} onRetry={() => refetchLeadsList()} />
            ) : leadsLoading ? (
              <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>
            ) : !leadsData?.rows?.length ? (
              <PanelEmpty
                icon={<Users className="h-5 w-5" />}
                title={filtered ? t("crmShared.ningunResultadoConEstos") : panelSub.isLicensed ? t("crmEmpty.empty.leadsLicensed", { leadsLower: voc.leadsLower }) : t("crmEmpty.empty.leadsLegacy", { leadsLower: voc.leadsLower })}
                description={filtered ? undefined : t("crmEmpty.empty.leadsHint")}
              >
                {filtered ? (
                  <Button variant="outline" onClick={() => { setFilterStatus("all"); setSearch(""); setLeadSourceFilter("all"); }}>{t("crmShared.quitarFiltros")}</Button>
                ) : (
                  <Button onClick={() => setShowNewLeadModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{panelSub.isLicensed ? t("crmEmpty.empty.leadsActionLicensed") : t("crmEmpty.empty.leadsActionLegacy")}</Button>
                )}
              </PanelEmpty>
            ) : (
              <>
                <CrmBulkBar count={selectedLeads.size} label={t("crmLeads.seleccionadoS", { size: selectedLeads.size })} onClear={() => setSelectedLeads(new Set())}>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => bulkMarkSeenLeads.mutate({ ids: Array.from(selectedLeads) })} disabled={bulkMarkSeenLeads.isPending}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />{t("crmLeads.marcarLeidos")}
                  </Button>
                  <select aria-label={t("crmLeads.cambiarEstado2")} value={bulkLeadsStatus} onChange={e => { if (e.target.value) bulkUpdateLeadsStatus.mutate({ ids: Array.from(selectedLeads), status: e.target.value as any }); }} disabled={bulkUpdateLeadsStatus.isPending} className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-40">
                    <option value="">{t("crmLeads.cambiarEstado2")}</option>
                    <option value="nueva">{t("crmLeads.nueva")}</option>
                    <option value="enviada">{t("crmLeads.enviada")}</option>
                    <option value="ganada">{t("crmLeads.ganada")}</option>
                    <option value="perdida">{t("crmLeads.perdida")}</option>
                  </select>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setBulkConfirm("leads")} disabled={bulkDeleteLeads.isPending}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("crmLeads.eliminar")}
                  </Button>
                </CrmBulkBar>
                <CrmTable
                  rows={leadsData.rows as any[]}
                  caption={voc.leads}
                  rowKey={(l) => l.id}
                  rowId={(l) => l.id}
                  rowClassName={(l) => selectedLeads.has(l.id) ? "bg-primary/5" : !l.seenAt ? "bg-info/5" : undefined}
                  selection={{
                    selected: selectedLeads,
                    onToggle: (id, checked) => setSelectedLeads(prev => { const s = new Set(prev); if (checked) s.add(id); else s.delete(id); return s; }),
                    onToggleAll: (checked) => setSelectedLeads(checked ? new Set(leadsData.rows.map((l: any) => l.id)) : new Set()),
                  }}
                  columns={[
                    {
                      key: "cliente", header: t("crmLeads.cliente"), mobile: "title",
                      cell: (lead: any) => (
                        <div className="flex items-center gap-2.5">
                          {!lead.seenAt ? (
                            <span className="relative flex h-2.5 w-2.5 shrink-0" title={t("crmOpps.nuevoEtiqueta")}>
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-info" />
                            </span>
                          ) : (
                            <PriorityDot priority={lead.priority as Priority} />
                          )}
                          <PersonAvatar name={lead.name || lead.email || "?"} id={lead.id} size="md" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(lead as typeof lead & { clientId?: number }).clientId ? (
                                <a href={`/admin/crm/clientes?clientId=${(lead as typeof lead & { clientId?: number }).clientId}`} className="font-medium text-foreground hover:text-info hover:underline">{lead.name}</a>
                              ) : (
                                <span className="font-medium text-foreground">{lead.name}</span>
                              )}
                              {!lead.seenAt && <StatusBadge tone="info">{t("crmLeads.nuevo")}</StatusBadge>}
                            </div>
                            <div className="break-all text-xs font-normal text-muted-foreground">{lead.email}</div>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "producto", header: t("crmLeads.producto"), priority: "md",
                      cell: (lead: any) => (
                        <div className="min-w-0">
                          {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {(lead.activitiesJson as any[]).slice(0, 2).map((act: any, i: number) => (
                                <div key={i} className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-foreground">{act.experienceTitle}</span>
                                  <span className="text-xs font-semibold text-warning">{t("crmLeads.p", { participants: act.participants })}</span>
                                </div>
                              ))}
                              {(lead.activitiesJson as any[]).length > 2 && <span className="text-xs text-muted-foreground">{t("crmLeads.mas", { v: (lead.activitiesJson as any[]).length - 2 })}</span>}
                            </div>
                          ) : (
                            <span className="text-foreground">{lead.selectedProduct || lead.selectedCategory || "—"}</span>
                          )}
                          {lead.preferredDate && <div className="mt-0.5 text-xs text-muted-foreground">{voc.serviceDateColumn}: {format.date(lead.preferredDate, {})}</div>}
                        </div>
                      ),
                    },
                    {
                      key: "recibido", header: t("crmLeads.recibido"), priority: "md", num: true,
                      cell: (lead: any) => (
                        <div>
                          <div className="text-foreground">{format.date(lead.createdAt, {})}</div>
                          <div className="text-xs text-muted-foreground">{format.time(lead.createdAt, { hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                      ),
                    },
                    {
                      key: "origen", header: t("crmLeads.origen"), priority: "lg",
                      cell: (lead: any) => lead.lsName ? (
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ color: lead.lsColor ?? undefined, borderColor: lead.lsColor ? `${lead.lsColor}40` : undefined, backgroundColor: lead.lsColor ? `${lead.lsColor}15` : undefined }}>
                          {lead.lsName}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>,
                    },
                    { key: "estado", header: t("crmLeads.estado"), cell: (lead: any) => <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} /> },
                  ]}
                  actions={(lead: any) => (
                    <CrmRowActions
                      name={lead.name}
                      primary={{ label: t("crmOpps.accionPrincipalVer"), icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => setSelectedLeadId(lead.id) }}
                      secondary={<ProposalLeadButton leadId={lead.id} leadName={lead.name} />}
                      menu={[
                        { label: voc.licensed ? t("crmLeads.editarOportunidad") : t("crmLeads.editarLead"), icon: <Pencil />, onSelect: () => setEditLeadId(lead.id) },
                        ...(lead.opportunityStatus === "nueva" ? [{ label: voc.agreeLead(t("crmEmpty.hint.contactedM", { leadsLower: voc.leadsLower }), t("crmEmpty.hint.contactedF", { leadsLower: voc.leadsLower })), icon: <Phone />, disabled: markLeadContacted.isPending, onSelect: () => markLeadContacted.mutate({ id: lead.id }) }] : []),
                        { label: t("crmLeads.crearPresupuesto2"), icon: <FileText />, onSelect: () => { setConvertLeadId(lead.id); setConvertLeadName(lead.name); } },
                        { label: voc.licensed ? t("crmLeads.eliminarOportunidad") : t("crmLeads.eliminarLead"), icon: <Trash2 />, destructive: true, onSelect: () => setDeleteLeadId(lead.id) },
                      ]}
                    />
                  )}
                  footer={
                    <CrmPager
                      text={leadsData.total <= PAGE_SIZE
                        ? t("crmLeads.mostrandoDe", { total: leadsData.total, total2: leadsData.total, leadsLower: voc.leadsLower })
                        : t("crmLeads.paginaDe", { v: leadsPage + 1, ceil: Math.ceil(leadsData.total / PAGE_SIZE), total: leadsData.total, leadsLower: voc.leadsLower })}
                      paged={leadsData.total > PAGE_SIZE}
                      hasPrev={leadsPage > 0}
                      hasNext={(leadsPage + 1) * PAGE_SIZE < leadsData.total}
                      onPrev={() => setLeadsPage(p => p - 1)}
                      onNext={() => setLeadsPage(p => p + 1)}
                      prevLabel={t("crmLeads.anterior")}
                      nextLabel={t("crmLeads.siguiente")}
                    />
                  }
                />
              </>
            )}
            </div>
          )}
    </>
  );
}

export function LeadsModals({ ctrl }: { ctrl: LeadsController }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const { showNewLeadModal, setShowNewLeadModal, selectedLeadId, setSelectedLeadId, setConvertLeadId, setConvertLeadName, convertLeadId, convertLeadName, editLeadId, setEditLeadId, deleteLeadId, setDeleteLeadId, deleteLead } = ctrl;
  return (
    <>
{/* Nuevo Lead Manual */}
<Dialog open={showNewLeadModal} onOpenChange={(o) => !o && setShowNewLeadModal(false)}>
        {showNewLeadModal && (
          <NewLeadModal onClose={() => setShowNewLeadModal(false)} />
        )}
      </Dialog>
<Dialog open={selectedLeadId !== null} onOpenChange={(o) => !o && setSelectedLeadId(null)}>
        {selectedLeadId !== null && (
          <LeadDetailModal
            leadId={selectedLeadId}
            onClose={() => setSelectedLeadId(null)}
            onConvert={(id, name) => { setConvertLeadId(id); setConvertLeadName(name ?? ""); }}
          />
        )}
      </Dialog>
<Dialog open={convertLeadId !== null} onOpenChange={(o) => !o && setConvertLeadId(null)}>
        {convertLeadId !== null && (
          <QuoteBuilderModal
            leadId={convertLeadId}
            leadName={convertLeadName}
            onClose={() => { setConvertLeadId(null); setConvertLeadName(""); }}
          />
        )}
      </Dialog>
{/* Edit Lead */}
<Dialog open={editLeadId !== null} onOpenChange={(o) => !o && setEditLeadId(null)}>
        {editLeadId !== null && (
          <LeadEditModal leadId={editLeadId} onClose={() => setEditLeadId(null)} />
        )}
      </Dialog>
{/* Delete Lead confirmation */}
<Dialog open={deleteLeadId !== null} onOpenChange={(o) => !o && setDeleteLeadId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <AlertTriangle className="w-5 h-5 text-danger" /> {voc.licensed ? t("crmInvoices.eliminarOportunidad") : t("crmInvoices.eliminarLead")}
            </DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{t("crmInvoices.estaAccionEsIrreversible")}{" "}{voc.licensed ? t("crmInvoices.laOportunidad") : t("crmInvoices.elLead")}{" "}{t("crmInvoices.yTodaSuActividad")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteLeadId(null)}>{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteLeadId !== null && deleteLead.mutate({ id: deleteLeadId })}
              disabled={deleteLead.isPending}
              variant="destructive"
            >
              {deleteLead.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmInvoices.eliminar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
