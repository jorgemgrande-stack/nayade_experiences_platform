import { useState, useMemo, useEffect } from "react";
import { PanelEmpty, errorMessage } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Plus, Search, RefreshCw, Phone, Mail, Building2, MapPin, Tag, AlertCircle, Download, Upload, User, Loader2,
} from "lucide-react";
import ClientImportDialog, { downloadTextFile } from "@/components/admin/crm/ClientImportDialog";
import AdminLayout from "@/components/AdminLayout";
import { Link, useLocation } from "wouter";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { TagChip, selectClass, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { ClientFormDialog } from "@/components/admin/crm/ClientFormDialog";
import { toastError } from "@/lib/errorMessage";
import { CLIENT_KIND_LABELS, clientDisplayName, clientKind, type ClientKind } from "@shared/clientProfile";

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
      downloadTextFile(`clientes-${new Date().toISOString().slice(0, 10)}.csv`, r.csv);
      toast.success(`${r.count} ${r.count === 1 ? "cliente exportado" : "clientes exportados"}`);
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  };

  const removeClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminado"); utils.crm.clients.list.invalidate(); utils.crm.clients.stats.invalidate(); setDeleteClient(null); },
    onError: (e) => toastError(e),
  });

  const clearFilters = () => { setSearch(""); setTagFilter(null); setTypeFilter(""); };
  const fichaHref = (c: ClientRow) => `/admin/crm/clientes/${c.id}`;

  const actions = (client: ClientRow) => (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button size="sm" variant="ghost" asChild className="h-8 px-2 text-primary">
        <Link href={fichaHref(client)} aria-label={`Ver la ficha de ${clientDisplayName(client)}`}>Ver ficha</Link>
      </Button>
      {canEdit && (
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditClient(client)} aria-label={`Editar ${clientDisplayName(client)}`}>
          Editar
        </Button>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => setDeleteClient(client)} aria-label={`Eliminar ${clientDisplayName(client)}`}>
          Eliminar
        </Button>
      )}
    </div>
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
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
        {k === "empresa" ? <Building2 className="h-3 w-3" aria-hidden="true" /> : <User className="h-3 w-3" aria-hidden="true" />}
        {CLIENT_KIND_LABELS[k]}
      </span>
    );
  };

  const emptyState = hasFilters ? (
    <PanelEmpty
      className="border-0"
      icon={<Users />}
      title={search.trim() ? `Ningún cliente coincide con «${search.trim()}»` : tagFilter && canTags ? `Ningún cliente tiene la etiqueta ${tagFilterName ? `«${tagFilterName}»` : "elegida"}` : "Ningún cliente coincide con los filtros"}
    >
      <Button size="sm" variant="outline" onClick={clearFilters}>Quitar filtros</Button>
    </PanelEmpty>
  ) : (
    <PanelEmpty
      className="border-0"
      icon={<Users />}
      title="Todavía no tienes clientes"
      description="Da de alta tu primer cliente para preparar presupuestos, registrar ventas y emitir facturas. También se crean solos cuando alguien te escribe desde tu web."
    >
      {canEdit && (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Crear el primer cliente
        </Button>
      )}
    </PanelEmpty>
  );

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {/* Header */}
        <PanelPageHeader
          icon={<Users />}
          title="Clientes"
          description="Tus clientes, particulares y empresas. Pulsa un nombre para ver su ficha."
          actions={<>
            <Button variant="outline" onClick={exportClients} disabled={exporting}>
              {exporting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
              {hasFilters ? "Exportar filtrados" : "Exportar"}
            </Button>
            {canImportClients && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" aria-hidden="true" /> Importar
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Nuevo cliente
              </Button>
            )}
          </>}
        />

        {/* Stats strip */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Total clientes", value: stats.data?.total },
            { label: "Empresas", value: stats.data?.companies },
            { label: "Particulares", value: stats.data?.individuals },
            { label: "Altas este mes", value: stats.data?.newThisMonth },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-bold tabular-nums text-foreground">{s.value ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email, empresa o NIF..."
              aria-label="Buscar clientes por nombre, email, empresa o NIF"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:flex">
            <div className="md:w-44">
              <label htmlFor="clients-type-filter" className="sr-only">Filtrar por tipo</label>
              <select id="clients-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ClientKind | "")} className={selectClass}>
                <option value="">Todos los tipos</option>
                <option value="empresa">Empresas</option>
                <option value="particular">Particulares</option>
              </select>
            </div>
            {canTags && (
              <div className="flex items-center gap-2 md:w-56">
                <label htmlFor="clients-tag-filter" className="sr-only">Filtrar por etiqueta</label>
                <Tag className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <select
                  id="clients-tag-filter"
                  value={tagFilter ?? ""}
                  onChange={(e) => setTagFilter(e.target.value ? Number(e.target.value) : null)}
                  className={selectClass}
                >
                  <option value="">Todas las etiquetas</option>
                  {(tagCatalog.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Listado */}
        <div className="rounded-xl border border-border bg-card">
          {isLoading ? (
            <p className="py-12 text-center text-muted-foreground" role="status">Cargando clientes…</p>
          ) : isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-12">
              <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
              <p className="text-sm text-foreground">{errorMessage(listError, "No se han podido cargar los clientes.")}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reintentar
              </Button>
            </div>
          ) : !clientsList || clientsList.length === 0 ? (
            emptyState
          ) : (
            <>
              {/* Escritorio: tabla */}
              <table className="hidden w-full text-sm md:table">
                <caption className="sr-only">Listado de clientes</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                    <th scope="col" className="px-4 py-3 font-medium">Tipo</th>
                    <th scope="col" className="px-4 py-3 font-medium">Contacto</th>
                    <th scope="col" className="px-4 py-3 font-medium">Población</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {clientsList.map((client) => (
                    <tr key={client.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40" data-client-row>
                      <td className="px-4 py-3 align-top">
                        <Link href={fichaHref(client)} className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                          {clientDisplayName(client)}
                        </Link>
                        {clientKind(client) === "empresa" && client.name !== client.company && <div className="text-xs text-muted-foreground">{client.name}</div>}
                        {client.nif && <div className="text-xs text-muted-foreground">NIF: {client.nif}</div>}
                        {tagsOf(client)}
                      </td>
                      <td className="px-4 py-3 align-top">{kindBadge(client)}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-1.5 break-all text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" aria-hidden="true" /> {client.email}</div>
                        {client.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3 shrink-0" aria-hidden="true" /> {client.phone}</div>}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-muted-foreground">{client.city || "—"}</td>
                      <td className="px-4 py-3 align-top">{actions(client)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Móvil: tarjetas */}
              <ul className="divide-y divide-border md:hidden" aria-label="Listado de clientes">
                {clientsList.map((client) => (
                  <li key={client.id} className="space-y-1.5 p-4" data-client-row>
                    <div className="flex items-start justify-between gap-2">
                      <Link href={fichaHref(client)} className="min-w-0 break-words font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                        {clientDisplayName(client)}
                      </Link>
                      {kindBadge(client)}
                    </div>
                    <div className="flex items-center gap-1.5 break-all text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" aria-hidden="true" /> {client.email}</div>
                    {client.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3 shrink-0" aria-hidden="true" /> {client.phone}</div>}
                    {client.city && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {client.city}</div>}
                    {tagsOf(client)}
                    {actions(client)}
                  </li>
                ))}
              </ul>

              {total > PAGE_SIZE && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  <span>Mostrando {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} de {total}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                    <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
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
            <DialogTitle>Eliminar cliente</DialogTitle>
            <DialogDescription>
              ¿Seguro que quieres eliminar a {deleteClient ? clientDisplayName(deleteClient) : "este cliente"}? Sus facturas y presupuestos se conservan. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteClient(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteClient && removeClient.mutate({ id: deleteClient.id })} disabled={removeClient.isPending}>
              {removeClient.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
