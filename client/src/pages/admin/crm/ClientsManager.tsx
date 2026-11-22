import { useState, useMemo, useEffect } from "react";
import { PanelEmpty, errorMessage } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Search, RefreshCw, Phone, Mail, Building2, MapPin, Tag, AlertCircle, Download, Upload, User, Loader2, MoreHorizontal, Sparkles, X,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MetricCard, PersonAvatar, SegmentedTabs } from "@/components/admin/PanelVisual";
import ClientImportDialog, { downloadTextFile } from "@/components/admin/crm/ClientImportDialog";
import AdminLayout from "@/components/AdminLayout";
import { Link, useLocation } from "wouter";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { TagChip, selectClass, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { ClientFormDialog } from "@/components/admin/crm/ClientFormDialog";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { clientDisplayName, clientKind, type ClientKind } from "@shared/clientProfile";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ClientRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  nif: string | null;
  city: string | null;
  createdAt: Date;
};

const PAGE_SIZE = 50;

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ClientsManager() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ClientKind | "">("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editClient, setEditClient] = useState<ClientRow | null>(null);
  const [deleteClient, setDeleteClient] = useState<ClientRow | null>(null);

  // Etiquetas (crm-tags): empresas con licencias por capacidad cuyo plan las incluye
  // (la instalación de siempre no las muestra hasta tener aplicada la migración 0008)
  const sub = usePanelSubscription();
  const canTags = sub.isLicensed && sub.can("crm-tags");
  const canEdit = useCrmCanWrite("crm-contacts");
  const canImportClients = canEdit;
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tagFilter, setTagFilter] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(window.location.search).get("etiqueta"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const tagCatalog = trpc.crmTags.list.useQuery(undefined, { enabled: canTags });
  const filters = useMemo(
    () => ({
      ...(search.trim() ? { search } : {}),
      ...(canTags && tagFilter ? { tagId: tagFilter } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
    }),
    [search, canTags, tagFilter, typeFilter],
  );
  const hasFilters = Object.keys(filters).length > 0;
  useEffect(() => setPage(0), [filters]);
  const { data: clientsData, isLoading, isError, error: listError, refetch } = trpc.crm.clients.list.useQuery({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const stats = trpc.crm.clients.stats.useQuery();
  const clientsList = clientsData?.items as ClientRow[] | undefined;
  const total = clientsData?.total ?? 0;
  const visibleIds = useMemo(() => (clientsList ?? []).map((c) => c.id), [clientsList]);
  const clientTags = trpc.crmTags.forEntities.useQuery(
    { entityType: "client", ids: visibleIds },
    { enabled: canTags && visibleIds.length > 0 },
  );
  const tagFilterName = tagCatalog.data?.find((t) => t.id === tagFilter)?.name;
  const utils = trpc.useUtils();

  // Acceso directo «Nuevo cliente» (inicio del panel): /admin/crm/clientes?nuevo=1
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("nuevo") !== "1") return;
    setCreating(true);
    url.searchParams.delete("nuevo");
    window.history.replaceState({}, "", url.toString());
  }, []);

  // Enlaces antiguos con ?clientId=X: abren la ficha del cliente
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("clientId"));
    if (Number.isInteger(n) && n > 0) setLocation(`/admin/crm/clientes/${n}`, { replace: true });
  }, [setLocation]);

  const exportClients = async () => {
    setExporting(true);
    try {
      const r = await utils.crm.clients.exportCsv.fetch(hasFilters ? filters : undefined);
      downloadTextFile(t("crmClients.csvName", { date: new Date().toISOString().slice(0, 10) }), r.csv);
      toast.success(t("crmClients.exported", { n: r.count }));
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  };

  const removeClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success(t("crmClients.deleted")); utils.crm.clients.list.invalidate(); utils.crm.clients.stats.invalidate(); setDeleteClient(null); },
    onError: (e) => toastError(e),
  });

  const clearFilters = () => { setSearch(""); setTagFilter(null); setTypeFilter(""); };
  const fichaHref = (c: ClientRow) => `/admin/crm/clientes/${c.id}`;

  const actions = (client: ClientRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={`${t("crmClients.colActions")}: ${clientDisplayName(client)}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={fichaHref(client)} aria-label={t("crmClients.viewCardAria", { name: clientDisplayName(client) })}>{t("crmClients.viewCard")}</Link>
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem onSelect={() => setEditClient(client)} aria-label={t("crmClients.editAria", { name: clientDisplayName(client) })}>
            {t("crmClients.edit")}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteClient(client)} aria-label={t("crmClients.deleteAria", { name: clientDisplayName(client) })}>
            {t("crmClients.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const tagsOf = (client: ClientRow) =>
    canTags && (clientTags.data?.[client.id]?.length ?? 0) > 0 ? (
      <div className="mt-1 flex flex-wrap gap-1">
        {clientTags.data![client.id].map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}
      </div>
    ) : null;

  const kindBadge = (client: ClientRow) => {
    const k = clientKind(client);
    return (
      <StatusBadge tone={k === "empresa" ? "info" : "neutral"} icon={k === "empresa" ? <Building2 aria-hidden="true" /> : <User aria-hidden="true" />}>
        {t(`crmForm.kind.${k}`)}
      </StatusBadge>
    );
  };

  const emptyState = hasFilters ? (
    <PanelEmpty
      className="border-0"
      icon={<Users />}
      title={search.trim() ? t("crmClients.emptyNoMatch", { q: search.trim() }) : tagFilter && canTags ? t("crmClients.emptyNoTag", { tag: tagFilterName ? `«${tagFilterName}»` : t("crmClients.emptyNoTagChosen") }) : t("crmClients.emptyNoFilters")}
    >
      <Button size="sm" variant="outline" onClick={clearFilters}>{t("crmClients.clearFilters")}</Button>
    </PanelEmpty>
  ) : (
    <PanelEmpty
      className="border-0"
      icon={<Users />}
      title={t("crmClients.emptyTitle")}
      description={t("crmClients.emptyDesc")}
    >
      {canEdit && (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmClients.createFirst")}
        </Button>
      )}
    </PanelEmpty>
  );

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {/* Cabecera: la acción principal es una; importar y exportar pasan a «Más» */}
        <PanelPageHeader
          icon={<Users />}
          title={t("crmClients.title")}
          description={t("crmClients.description")}
          actions={<>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("crmClients.colActions")} disabled={exporting}>
                  {exporting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={exportClients} disabled={exporting}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" /> {hasFilters ? t("crmClients.exportFiltered") : t("crmClients.export")}
                </DropdownMenuItem>
                {canImportClients && (
                  <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" aria-hidden="true" /> {t("crmClients.import")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> {t("crmClients.newClient")}
              </Button>
            )}
          </>}
        />

        {/* Resumen: cada tarjeta es también un filtro */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard icon={<Users />} tone="brand" label={t("crmClients.stats.total")} value={stats.data?.total ?? "—"} onClick={() => setTypeFilter("")} active={typeFilter === ""} />
          <MetricCard icon={<Building2 />} tone="info" label={t("crmClients.stats.companies")} value={stats.data?.companies ?? "—"} onClick={() => setTypeFilter("empresa")} active={typeFilter === "empresa"} />
          <MetricCard icon={<User />} tone="success" label={t("crmClients.stats.individuals")} value={stats.data?.individuals ?? "—"} onClick={() => setTypeFilter("particular")} active={typeFilter === "particular"} />
          <MetricCard icon={<Sparkles />} tone="warning" label={t("crmClients.stats.newThisMonth")} value={stats.data?.newThisMonth ?? "—"} />
        </div>

        {/* Barra de filtros */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("crmClients.searchPlaceholder")}
              aria-label={t("crmClients.searchAria")}
              className="h-11 rounded-xl pl-10 pr-10"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label={t("crmClients.clearFilters")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <SegmentedTabs
            label={t("crmClients.filterType")}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "", label: t("crmClients.stats.total"), count: stats.data?.total ?? null },
              { value: "empresa", label: t("crmClients.companies"), count: stats.data?.companies ?? null },
              { value: "particular", label: t("crmClients.individuals"), count: stats.data?.individuals ?? null },
            ]}
          />
          {canTags && (
            <div className="flex items-center gap-2 lg:w-56">
              <label htmlFor="clients-tag-filter" className="sr-only">{t("crmClients.filterTag")}</label>
              <Tag className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <select
                id="clients-tag-filter"
                value={tagFilter ?? ""}
                onChange={(e) => setTagFilter(e.target.value ? Number(e.target.value) : null)}
                className={selectClass}
              >
                <option value="">{t("crmClients.allTags")}</option>
                {(tagCatalog.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Listado */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {isLoading ? (
            <div className="divide-y divide-border" role="status" aria-busy="true">
              <span className="sr-only">{t("crmClients.loading")}</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted" /></div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-12">
              <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
              <p className="text-sm text-foreground">{errorMessage(listError, t("crmClients.loadError"))}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmClients.retry")}
              </Button>
            </div>
          ) : !clientsList || clientsList.length === 0 ? (
            emptyState
          ) : (
            <>
              {/* Escritorio: filas con avatar; toda la fila abre la ficha */}
              <table className="hidden w-full text-sm md:table">
                <caption className="sr-only">{t("crmClients.listCaption")}</caption>
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmClients.colClient")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmClients.colContact")}</th>
                    <th scope="col" className="px-4 py-3 font-medium">{t("crmClients.colCity")}</th>
                    <th scope="col" className="w-12 px-4 py-3"><span className="sr-only">{t("crmClients.colActions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {clientsList.map((client) => (
                    <tr key={client.id} className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40" data-client-row onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,[role=menuitem]")) setLocation(fichaHref(client)); }}>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <PersonAvatar name={clientDisplayName(client)} id={client.id} company={clientKind(client) === "empresa"} />
                          <div className="min-w-0">
                            <Link href={fichaHref(client)} className="block overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                              {clientDisplayName(client)}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {kindBadge(client)}
                              {clientKind(client) === "empresa" && client.name !== client.company && <span className="overflow-hidden text-ellipsis whitespace-nowrap">{client.name}</span>}
                              {client.nif && <span>{t("crmClients.nif", { nif: client.nif })}</span>}
                            </div>
                            {tagsOf(client)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 break-all text-xs text-foreground hover:text-primary hover:underline"><Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> {client.email}</a>
                        {client.phone && <a href={`tel:${client.phone.replace(/\s/g, "")}`} className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"><Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {client.phone}</a>}
                      </td>
                      <td className="px-4 py-3 align-middle text-xs text-muted-foreground">{client.city ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {client.city}</span> : "—"}</td>
                      <td className="px-4 py-3 text-right align-middle">{actions(client)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Móvil: tarjetas con contacto de un toque */}
              <ul className="divide-y divide-border md:hidden" aria-label={t("crmClients.listCaption")}>
                {clientsList.map((client) => (
                  <li key={client.id} className="flex items-start gap-3 p-4" data-client-row>
                    <PersonAvatar name={clientDisplayName(client)} id={client.id} company={clientKind(client) === "empresa"} />
                    <div className="min-w-0 flex-1">
                      <Link href={fichaHref(client)} className="block break-words font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                        {clientDisplayName(client)}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {kindBadge(client)}
                        {client.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" /> {client.city}</span>}
                      </div>
                      {tagsOf(client)}
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full px-3 text-xs"><a href={`mailto:${client.email}`}><Mail className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmClientDetail.email")}</a></Button>
                        {client.phone && <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full px-3 text-xs"><a href={`tel:${client.phone.replace(/\s/g, "")}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmClientDetail.phone")}</a></Button>}
                      </div>
                    </div>
                    {actions(client)}
                  </li>
                ))}
              </ul>

              {total > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  <span>{t("crmClients.showing", { from: page * PAGE_SIZE + 1, to: Math.min(total, (page + 1) * PAGE_SIZE), total })}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t("crmClients.prev")}</Button>
                    <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>{t("crmClients.next")}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alta y edición */}
      <Dialog open={creating || editClient !== null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditClient(null); } }}>
        {(creating || editClient) && (
          <ClientFormDialog
            client={editClient}
            onClose={() => { setCreating(false); setEditClient(null); }}
            onSaved={(id) => { if (creating) setLocation(`/admin/crm/clientes/${id}`); }}
          />
        )}
      </Dialog>

      <ClientImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Confirmar borrado */}
      <Dialog open={deleteClient !== null} onOpenChange={(o) => !o && setDeleteClient(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("crmClients.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("crmClients.deleteConfirm", { name: deleteClient ? clientDisplayName(deleteClient) : t("crmClients.deleteThisClient") })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteClient(null)}>{t("crmClients.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteClient && removeClient.mutate({ id: deleteClient.id })} disabled={removeClient.isPending}>
              {removeClient.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("crmClients.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
