import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ProposalLeadButton } from "../ProposalsManager";
import { FileText, Eye, Phone, AlertTriangle, RefreshCw, Trash2, Pencil, X, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/admin/PanelVisual";
import { useI18n } from "@/i18n/I18nProvider";
import { Tab, OpportunityStatus, Priority, OpportunityBadge, PriorityDot, CrmTableState, PAGE_SIZE } from "../shared/crmCommon";
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
  const { selectedLeads, bulkMarkSeenLeads, bulkLeadsStatus, bulkUpdateLeadsStatus, bulkDeleteLeads, setSelectedLeads, leadsData, leadsLoading, leadsError, refetchLeadsList, setShowNewLeadModal, setSelectedLeadId, setEditLeadId, markLeadContacted, setConvertLeadId, setConvertLeadName, setDeleteLeadId, leadsPage, setLeadsPage } = ctrl;
  return (
    <>
{tab === "leads" && (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Barra acción masiva leads */}
            {selectedLeads.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-info/10 border-b border-info/20">
                <span className="text-xs text-info font-medium shrink-0">{t("crmLeads.seleccionadoS", { size: selectedLeads.size })}</span>
                <button onClick={() => bulkMarkSeenLeads.mutate({ ids: Array.from(selectedLeads) })} disabled={bulkMarkSeenLeads.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-foreground/20 hover:bg-foreground/10 transition-colors disabled:opacity-40">
                  <Eye className="w-3.5 h-3.5" />{" "}{t("crmLeads.marcarLeidos")}</button>
                <select value={bulkLeadsStatus} onChange={e => { if (e.target.value) bulkUpdateLeadsStatus.mutate({ ids: Array.from(selectedLeads), status: e.target.value as any }); }} disabled={bulkUpdateLeadsStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">{t("crmLeads.cambiarEstado2")}</option>
                  <option value="nueva">{t("crmLeads.nueva")}</option>
                  <option value="enviada">{t("crmLeads.enviada")}</option>
                  <option value="ganada">{t("crmLeads.ganada")}</option>
                  <option value="perdida">{t("crmLeads.perdida")}</option>
                </select>
                <button type="button" onClick={() => setBulkConfirm("leads")} disabled={bulkDeleteLeads.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" />{" "}{t("crmLeads.eliminar")}</button>
                <button onClick={() => setSelectedLeads(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!leadsData?.rows?.length && selectedLeads.size === leadsData.rows.length} onChange={e => setSelectedLeads(e.target.checked ? new Set(leadsData?.rows?.map((l: any) => l.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">{t("crmLeads.recibido")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium min-w-[260px]">{t("crmLeads.cliente")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">{t("crmLeads.producto")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell">{voc.serviceDateColumn}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden xl:table-cell">{t("crmLeads.origen")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmLeads.estado")}</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmLeads.acciones")}</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading || leadsError || !leadsData?.rows?.length ? (
                    <CrmTableState
                      colSpan={8}
                      loading={leadsLoading}
                      error={leadsError}
                      onRetry={() => refetchLeadsList()}
                      filtered={filterStatus !== "all" || !!search.trim()}
                      onClearFilters={() => { setFilterStatus("all"); setSearch(""); }}
                      emptyTitle={panelSub.isLicensed ? t("crmEmpty.empty.leadsLicensed", { leadsLower: voc.leadsLower }) : t("crmEmpty.empty.leadsLegacy", { leadsLower: voc.leadsLower })}
                      emptyHint={t("crmEmpty.empty.leadsHint")}
                      actionLabel={panelSub.isLicensed ? t("crmEmpty.empty.leadsActionLicensed") : t("crmEmpty.empty.leadsActionLegacy")}
                      onAction={() => setShowNewLeadModal(true)}
                    />
                  ) : leadsData.rows.map((lead: any) => (
                    <tr key={lead.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${selectedLeads.has(lead.id) ? "bg-info/5" : !lead.seenAt ? "bg-info/20" : ""}`}>
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedLeads.has(lead.id)} onChange={e => setSelectedLeads(prev => { const s = new Set(prev); e.target.checked ? s.add(lead.id) : s.delete(lead.id); return s; })} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-foreground/70 font-medium">{format.date(lead.createdAt, {})}</div>
                        <div className="text-[11px] text-foreground/40">{format.time(lead.createdAt, { hour: "2-digit", minute: "2-digit" })}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {/* Punto pulse para leads no leídos */}
                          {!lead.seenAt ? (
                            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-info" />
                            </span>
                          ) : (
                            <PriorityDot priority={lead.priority as Priority} />
                          )}
                          <PersonAvatar name={lead.name || lead.email || "?"} id={lead.id} size="md" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {(lead as typeof lead & { clientId?: number }).clientId ? (
                                <a
                                  href={`/admin/crm/clientes?clientId=${(lead as typeof lead & { clientId?: number }).clientId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm font-medium text-foreground hover:text-info hover:underline transition-colors"
                                >{lead.name}</a>
                              ) : (
                                <span className="text-sm font-medium text-foreground">{lead.name}</span>
                              )}
                              {!lead.seenAt && <span className="text-[10px] font-bold uppercase tracking-wider text-info bg-info/10 px-1.5 py-0.5 rounded-full">{t("crmLeads.nuevo")}</span>}
                            </div>
                            <div className="break-all text-xs text-muted-foreground">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {(lead.activitiesJson as any[]).slice(0, 2).map((act: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="text-sm text-foreground/80">{act.experienceTitle}</span>
                                <span className="text-xs text-warning font-semibold">{t("crmLeads.p", { participants: act.participants })}</span>
                              </div>
                            ))}
                            {(lead.activitiesJson as any[]).length > 2 && (
                              <span className="text-xs text-foreground/40">{t("crmLeads.mas", { v: (lead.activitiesJson as any[]).length - 2 })}</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-foreground/65">{lead.selectedProduct || lead.selectedCategory || "—"}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-sm text-foreground/60">{lead.preferredDate ? format.date(lead.preferredDate, {}) : "—"}</div>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {lead.lsName ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                            style={{
                              color: lead.lsColor ?? "#9CA3AF",
                              borderColor: `${lead.lsColor ?? "#9CA3AF"}40`,
                              backgroundColor: `${lead.lsColor ?? "#9CA3AF"}15`,
                            }}
                          >
                            {lead.lsName}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-foreground/60 hover:text-foreground h-7 px-2 text-xs"
                            onClick={() => setSelectedLeadId(lead.id)}
                            title={t("crmLeads.verFicha")}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-info hover:text-info h-7 px-2 text-xs"
                            onClick={() => setEditLeadId(lead.id)}
                            title={voc.licensed ? t("crmLeads.editarOportunidad") : t("crmLeads.editarLead")}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <ProposalLeadButton leadId={lead.id} leadName={lead.name} />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-foreground" aria-label={`${t("crmLeads.acciones")}: ${lead.name}`}>
                                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {lead.opportunityStatus === "nueva" && (
                                <DropdownMenuItem disabled={markLeadContacted.isPending} onSelect={() => markLeadContacted.mutate({ id: lead.id })}>
                                  <Phone className="mr-2 h-4 w-4" aria-hidden="true" />{voc.agreeLead(t("crmEmpty.hint.contactedM", { leadsLower: voc.leadsLower }), t("crmEmpty.hint.contactedF", { leadsLower: voc.leadsLower }))}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => { setConvertLeadId(lead.id); setConvertLeadName(lead.name); }}>
                                <FileText className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmLeads.crearPresupuesto2")}
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteLeadId(lead.id)}>
                                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{voc.licensed ? t("crmLeads.eliminarOportunidad") : t("crmLeads.eliminarLead")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leadsData && leadsData.total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  {leadsData.total <= PAGE_SIZE
                    ? t("crmLeads.mostrandoDe", { total: leadsData.total, total2: leadsData.total, leadsLower: voc.leadsLower })
                    : t("crmLeads.paginaDe", { v: leadsPage + 1, ceil: Math.ceil(leadsData.total / PAGE_SIZE), total: leadsData.total, leadsLower: voc.leadsLower })}
                </span>
                {leadsData.total > PAGE_SIZE && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLeadsPage(p => p - 1)}
                      disabled={leadsPage === 0}
                      className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                    >{t("crmLeads.anterior")}</button>
                    <button
                      onClick={() => setLeadsPage(p => p + 1)}
                      disabled={(leadsPage + 1) * PAGE_SIZE >= leadsData.total}
                      className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                    >{t("crmLeads.siguiente")}</button>
                  </div>
                )}
              </div>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" /> {voc.licensed ? t("crmInvoices.eliminarOportunidad") : t("crmInvoices.eliminarLead")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.estaAccionEsIrreversible")}{" "}{voc.licensed ? t("crmInvoices.laOportunidad") : t("crmInvoices.elLead")}{" "}{t("crmInvoices.yTodaSuActividad")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteLeadId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteLeadId !== null && deleteLead.mutate({ id: deleteLeadId })}
              disabled={deleteLead.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deleteLead.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmInvoices.eliminar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
