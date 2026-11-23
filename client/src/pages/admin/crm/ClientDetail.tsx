/**
 * Ficha de cliente del CRM: datos de contacto, fiscales y de dirección (editables), tipo, etiquetas, notas,
 * tareas e historial de presupuestos, ventas, facturas, pagos y correos con enlace a cada documento.
 * Se abre al pulsar el nombre de un cliente en el listado (/admin/crm/clientes/:id).
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertCircle, ArrowLeft, Building2, CheckCircle2, Circle, ClipboardList, ExternalLink, FileText, Loader2, Mail, MapPin,
  MessageSquare, MoreHorizontal, Pencil, Phone, Plus, Receipt, ShoppingBag, StickyNote, Tag, Trash2, User, Wallet,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HeroCard, MetricCard, PersonAvatar, SegmentedTabs } from "@/components/admin/PanelVisual";
import { StatusBadge } from "@/components/admin/PanelUi";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityTagsDialog, TagChip, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { ClientFormDialog } from "@/components/admin/crm/ClientFormDialog";
import { CustomerEmailDeliveryList, CustomerEmailDeliveryWarning } from "@/components/admin/crm/CustomerEmailDelivery";
import {
  ACTIVITY_FILTERS, NOTE_MAX, buildClientActivity, clientDisplayName, clientKind, invoicedTotal,
  type ActivityItem, type ActivityKind,
} from "@shared/clientProfile";

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

const KIND_ICON: Record<ActivityKind, typeof FileText> = {
  quote: FileText, order: ShoppingBag, invoice: Receipt, payment: Wallet, email: Mail, note: StickyNote,
};

function Card({ title, icon: Icon, action, children, className = "", hideHeader = false }: { title: string; icon: typeof FileText; action?: React.ReactNode; children: React.ReactNode; className?: string; hideHeader?: boolean }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm ${className}`} aria-label={title}>
      {hideHeader ? <h2 className="sr-only">{title}</h2> : (
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true"><Icon className="h-4 w-4" /></span>
          {title}
        </h2>
        {action}
      </div>
      )}
      {children}
    </section>
  );
}

function Row({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  const { t } = useI18n();
  const v = (value ?? "").trim();
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">
        {!v ? <span className="font-normal text-muted-foreground">{t("crmClientDetail.unspecified")}</span> : href ? <a href={href} className="text-primary underline-offset-4 hover:underline">{v}</a> : v}
      </dd>
    </div>
  );
}

const KIND_TONE: Record<ActivityKind, Tone> = {
  quote: "info", order: "brand", invoice: "warning", payment: "success", email: "neutral", note: "neutral",
};

export default function ClientDetail({ id }: { id: number }) {
  const { t, format } = useI18n();
  const fmtDate = (ms: number | string | Date | null | undefined) => (ms ? format.date(ms, DATE_OPTS) : "—");
  const fmtEuros = (n: number) => format.currency(n);
  const [, setLocation] = useLocation();
  const voc = useVocabulary();
  const sub = usePanelSubscription();
  const canEdit = useCrmCanWrite("crm-contacts");
  const canTags = sub.isLicensed ? sub.can("crm-tags") : false;
  const canWriteTags = useCrmCanWrite("crm-tags");
  const canTasks = sub.isLicensed ? sub.can("crm-tasks") : false;
  const canWriteTasks = useCrmCanWrite("crm-tasks");
  const canQuotes = sub.can("crm-quotes");
  const canOrders = sub.can("shop-orders");
  const canInvoices = sub.can("bill-invoices");
  const canLeads = sub.can("crm-leads");
  const utils = trpc.useUtils();

  const history = trpc.crm.clients.getHistory.useQuery({ id }, { retry: false });
  const notes = trpc.crm.clients.notes.useQuery({ clientId: id }, { retry: false, enabled: history.isSuccess });
  const tags = trpc.crmTags.forEntities.useQuery({ entityType: "client", ids: [id] }, { enabled: canTags && history.isSuccess });
  const tasks = trpc.crmTasks.list.useQuery({ scope: "all", status: "todas", entityType: "client", entityId: id, limit: 50 }, { enabled: canTasks && history.isSuccess });

  const [editing, setEditing] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [filter, setFilter] = useState<ActivityKind | "all">("all");
  const [view, setView] = useState<"activity" | "notes">("activity");

  const addNote = trpc.crm.clients.addNote.useMutation({
    onSuccess: () => { setNoteText(""); toast.success(t("crmClientDetail.noteSaved")); utils.crm.clients.notes.invalidate({ clientId: id }); },
    onError: (e) => toastError(e),
  });
  const deleteNote = trpc.crm.clients.deleteNote.useMutation({
    onSuccess: () => { toast.success(t("crmClientDetail.noteDeleted")); utils.crm.clients.notes.invalidate({ clientId: id }); },
    onError: (e) => toastError(e),
  });
  const createTask = trpc.crmTasks.create.useMutation({
    onSuccess: () => { setTaskTitle(""); setTaskDue(""); toast.success(t("crmClientDetail.taskCreated")); utils.crmTasks.list.invalidate(); utils.crmTasks.summary.invalidate(); },
    onError: (e) => toastError(e),
  });
  const setTaskStatus = trpc.crmTasks.setStatus.useMutation({
    onSuccess: () => { utils.crmTasks.list.invalidate(); utils.crmTasks.summary.invalidate(); },
    onError: (e) => toastError(e),
  });
  const removeClient = trpc.crm.clients.delete.useMutation({
    onSuccess: () => { toast.success(t("crmClientDetail.deleted")); utils.crm.clients.list.invalidate(); utils.crm.clients.stats.invalidate(); setLocation("/admin/crm/clientes"); },
    onError: (e) => toastError(e),
  });

  const data = history.data;
  const client = data?.client;
  const activity = useMemo<ActivityItem[]>(() => {
    if (!data) return [];
    const items = buildClientActivity(
      {
        quotes: canQuotes ? data.quotes : [],
        reservations: canOrders ? data.reservations : [],
        invoices: canInvoices ? data.invoices : [],
        tpvTickets: data.tpvTickets,
        emails: data.emails,
        notes: notes.data?.items ?? [],
      },
      { order: voc.Order },
    );
    return items;
  }, [data, notes.data, canQuotes, canOrders, canInvoices, voc.Order]);
  const filtered = filter === "all" ? activity : activity.filter((a) => a.kind === filter);
  const filterCounts = useMemo(() => {
    const m: Record<string, number> = { all: activity.length };
    for (const a of activity) m[a.kind] = (m[a.kind] ?? 0) + 1;
    return m;
  }, [activity]);

  if (history.isLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center gap-2 px-4 py-20 text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("crmClientDetail.loading")}
        </div>
      </AdminLayout>
    );
  }
  if (history.isError || !client || !data) {
    const notFound = (history.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";
    return (
      <AdminLayout>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center" role="alert">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-foreground">{notFound ? t("crmClientDetail.notFound") : errorMessage(history.error, t("crmClientDetail.loadError"))}</p>
          <div className="flex gap-2">
            {!notFound && <Button variant="outline" onClick={() => history.refetch()}>{t("crmClientDetail.retry")}</Button>}
            <Button asChild><Link href="/admin/crm/clientes">{t("crmClientDetail.backToClients")}</Link></Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const kind = clientKind(client);
  const display = clientDisplayName(client);
  const clientTags = tags.data?.[id] ?? [];
  const address = [client.address, [client.postalCode, client.city].filter(Boolean).join(" ")].filter((s) => (s ?? "").trim()).join(", ");
  const total = invoicedTotal(data.invoices);
  const openTasks = (tasks.data?.rows ?? []).filter((tk) => tk.status === "pendiente");
  const doneTasks = (tasks.data?.rows ?? []).filter((tk) => tk.status === "hecha");
  const visibleFilters = ACTIVITY_FILTERS.filter((f) =>
    f.id === "all" || (f.id === "quote" ? canQuotes : f.id === "order" ? canOrders : f.id === "invoice" ? canInvoices : f.id === "payment" ? canOrders || canInvoices : true),
  );

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <nav aria-label={t("crmClientDetail.breadcrumb")} className="mb-4 text-sm">
          <Link href="/admin/crm/clientes" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("crmClientDetail.clients")}
          </Link>
        </nav>

        {/* Cabecera con presencia: quién es, cómo contactarle y qué puedo hacer */}
        <HeroCard className="mb-6">
          <header className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-start gap-4">
              <PersonAvatar name={display} id={client.id} company={kind === "empresa"} size="xl" className="hidden sm:inline-flex" />
              <PersonAvatar name={display} id={client.id} company={kind === "empresa"} size="lg" className="sm:hidden" />
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-bold leading-tight text-foreground">{display}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <StatusBadge tone={kind === "empresa" ? "info" : "neutral"} icon={kind === "empresa" ? <Building2 aria-hidden="true" /> : <User aria-hidden="true" />}>
                    {t(`crmForm.kind.${kind}`)}
                  </StatusBadge>
                  {kind === "empresa" && client.name && client.name !== client.company && <span>{t("crmClientDetail.contactPrefix", { name: client.name })}</span>}
                  <span>{t("crmClientDetail.since", { date: fmtDate(client.createdAt as unknown as string) })}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {client.email && (
                    <Button asChild size="sm" variant="outline" className="h-auto min-h-8 max-w-full gap-1.5 rounded-full bg-card/70 px-3 py-1">
                      <a href={`mailto:${client.email}`}><Mail className="h-3.5 w-3.5" aria-hidden="true" /> <span className="break-all text-left">{client.email}</span></a>
                    </Button>
                  )}
                  {client.phone && (
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-full bg-card/70 px-3">
                      <a href={`tel:${client.phone.replace(/\s/g, "")}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {client.phone}</a>
                    </Button>
                  )}
                  {address && (
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> <span className="max-w-[18rem] overflow-hidden text-ellipsis whitespace-nowrap">{address}</span></span>
                  )}
                </div>
                {canTags && clientTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {clientTags.map((tg) => <TagChip key={tg.id} name={tg.name} color={tg.color} />)}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canEdit && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmClientDetail.editData")}
                </Button>
              )}
              {(canTags || canEdit) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9 bg-card/70" aria-label={t("crmClients.colActions")}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canTags && (
                      <DropdownMenuItem onSelect={() => setTagsOpen(true)}>
                        <Tag className="mr-2 h-4 w-4" aria-hidden="true" /> {t("crmClientDetail.tags")}
                      </DropdownMenuItem>
                    )}
                    {canEdit && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> {t("crmClientDetail.delete")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
        </HeroCard>

        <CustomerEmailDeliveryWarning clientId={id} email={client.email} />

        {/* Resumen */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {canQuotes && <MetricCard icon={<FileText />} tone="info" label={t("crmClientDetail.stat.quotes")} value={String(data.quotes.length)} />}
          {canOrders && <MetricCard icon={<ShoppingBag />} tone="brand" label={voc.orders} value={String(data.reservations.length)} />}
          {canInvoices && <MetricCard icon={<Receipt />} tone="warning" label={t("crmClientDetail.stat.invoices")} value={String(data.invoices.length)} />}
          {canInvoices && <MetricCard icon={<Wallet />} tone="success" label={t("crmClientDetail.stat.invoiced")} value={fmtEuros(total)} />}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Perfil y trabajo pendiente */}
          <div className="min-w-0 space-y-6">
            <Card title={t("crmClientDetail.contact")} icon={Phone}>
              <dl className="divide-y divide-border/60">
                {kind === "empresa" && <Row label={t("crmClientDetail.companyName")} value={client.company} />}
                <Row label={kind === "empresa" ? t("crmClientDetail.contact") : t("crmClientDetail.name")} value={client.name} />
                <Row label={t("crmClientDetail.email")} value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
                <Row label={t("crmClientDetail.phone")} value={client.phone} href={client.phone ? `tel:${client.phone.replace(/\s/g, "")}` : undefined} />
              </dl>
            </Card>
            <Card title={t("crmClientDetail.taxAddress")} icon={MapPin}>
              <dl className="divide-y divide-border/60">
                <Row label={kind === "empresa" ? t("crmClientDetail.nifCompany") : t("crmClientDetail.nifPerson")} value={client.nif} />
                <Row label={t("crmClientDetail.address")} value={address} />
                <Row label={t("crmClientDetail.country")} value={client.country === "ES" ? t("crmClientDetail.countryES") : client.country} />
              </dl>
              {!client.nif && canInvoices && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground">{t("crmClientDetail.addNif")}</p>}
            </Card>
            {canTasks && (
              <Card
                title={t("crmClientDetail.tasks")}
                icon={ClipboardList}
                action={<Link href={`/admin/crm/tareas?vinculo=client&id=${id}&nombre=${encodeURIComponent(display)}`} className="text-xs font-medium text-primary underline-offset-4 hover:underline">{t("crmClientDetail.seeAll")}</Link>}
              >
                {canWriteTasks && (
                  <form
                    className="mb-3 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!taskTitle.trim()) { toast.error(t("crmClientDetail.taskTypeSomething")); return; }
                      createTask.mutate({ title: taskTitle.trim(), dueDate: taskDue || null, entityType: "client", entityId: id });
                    }}
                  >
                    <label htmlFor="client-task-title" className="sr-only">{t("crmClientDetail.newTask")}</label>
                    <Input id="client-task-title" value={taskTitle} maxLength={200} onChange={(e) => setTaskTitle(e.target.value)} placeholder={t("crmClientDetail.newTaskPlaceholder")} />
                    <div className="flex gap-2">
                      <label htmlFor="client-task-due" className="sr-only">{t("crmClientDetail.dueDate")}</label>
                      <Input id="client-task-due" type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="flex-1" />
                      <Button type="submit" size="sm" disabled={createTask.isPending}>
                        <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("crmClientDetail.addTask")}
                      </Button>
                    </div>
                  </form>
                )}
                {tasks.isLoading ? (
                  <p className="text-sm text-muted-foreground" role="status">{t("crmClientDetail.tasksLoading")}</p>
                ) : openTasks.length + doneTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("crmClientDetail.tasksNone")}</p>
                ) : (
                  <ul className="space-y-1">
                    {[...openTasks, ...doneTasks].map((tk) => (
                      <li key={tk.id} className="flex items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-muted/40">
                        <button
                          type="button"
                          disabled={!canWriteTasks || setTaskStatus.isPending}
                          onClick={() => setTaskStatus.mutate({ id: tk.id, status: tk.status === "hecha" ? "pendiente" : "hecha" })}
                          className="mt-0.5 text-muted-foreground hover:text-foreground disabled:cursor-default"
                          aria-label={tk.status === "hecha" ? t("crmClientDetail.markPending", { title: tk.title }) : t("crmClientDetail.markDone", { title: tk.title })}
                        >
                          {tk.status === "hecha" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                        </button>
                        <span className={`min-w-0 flex-1 break-words ${tk.status === "hecha" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {tk.title}
                          {tk.dueDate && <span className="ml-1 text-xs text-muted-foreground">· {fmtDate(tk.dueDate)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {data.lead && client.leadId && canLeads && (
              <Card title={voc.leadOrigin} icon={User}>
                <p className="text-sm text-foreground">{data.lead.name} · {fmtDate(data.lead.createdAt as unknown as string)}</p>
                <Link href={`/admin/crm?tab=leads&search=${encodeURIComponent(data.lead.email ?? data.lead.name)}`} className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
                  {t("crmClientDetail.viewIn", { what: voc.leads })}
                </Link>
              </Card>
            )}
            {(client.notes ?? "").trim() && (
              <Card title={t("crmClientDetail.notes")} icon={MessageSquare}>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{client.notes}</p>
              </Card>
            )}
            <Card title={t("crmClientDetail.mailDelivery")} icon={Mail}>
              <CustomerEmailDeliveryList clientId={id} email={client.email} />
            </Card>
          </div>

          {/* Actividad y notas, en dos vistas */}
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <SegmentedTabs
              label={t("crmClientDetail.history")}
              value={view}
              onChange={setView}
              options={[
                { value: "activity", label: t("crmClientDetail.history"), count: activity.length },
                { value: "notes", label: t("crmClientDetail.notesTitle"), count: notes.data?.items.length ?? null },
              ]}
            />

            {view === "notes" && (
            <Card title={t("crmClientDetail.notesTitle")} icon={StickyNote} hideHeader>
              {notes.data && !notes.data.available ? (
                <p className="text-sm text-muted-foreground">{t("crmClientDetail.notesUnavailable")}</p>
              ) : (
                <>
                  {canEdit && (
                    <form
                      className="mb-4 space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!noteText.trim()) { toast.error(t("crmClientDetail.noteTypeSomething")); return; }
                        addNote.mutate({ clientId: id, body: noteText });
                      }}
                    >
                      <label htmlFor="client-note" className="sr-only">{t("crmClientDetail.newNote")}</label>
                      <Textarea id="client-note" rows={3} maxLength={NOTE_MAX} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("crmClientDetail.notePlaceholder")} />
                      <div className="flex justify-end">
                        <Button type="submit" size="sm" disabled={addNote.isPending}>
                          {addNote.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("crmClientDetail.saveNote")}
                        </Button>
                      </div>
                    </form>
                  )}
                  {notes.isLoading ? (
                    <p className="text-sm text-muted-foreground" role="status">{t("crmClientDetail.notesLoading")}</p>
                  ) : !notes.data?.items.length ? (
                    <p className="text-sm text-muted-foreground">{t("crmClientDetail.notesNone")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {notes.data.items.map((n) => (
                        <li key={n.id} className="rounded-xl border border-border bg-muted/30 p-3">
                          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{n.body}</p>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{n.authorName ?? t("crmClientDetail.team")} · {fmtDate(n.createdAt as unknown as string)}</span>
                            {canEdit && (
                              <button type="button" onClick={() => deleteNote.mutate({ clientId: id, noteId: n.id })} disabled={deleteNote.isPending} className="font-medium text-destructive hover:underline">
                                {t("crmClientDetail.deleteNote")}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>
            )}

            {view === "activity" && (
            <Card title={t("crmClientDetail.history")} icon={FileText} hideHeader>
              <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t("crmClientDetail.filterHistory")}>
                {visibleFilters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={filter === f.id}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {f.id === "order" ? voc.orders : t(`crmClientDetail.filter.${f.id}`)} ({filterCounts[f.id] ?? 0})
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {activity.length === 0 ? t("crmClientDetail.historyEmpty") : t("crmClientDetail.historyNothing")}
                </p>
              ) : (
                <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[1.05rem] before:top-2 before:w-px before:bg-border">
                  {filtered.map((a) => {
                    const Icon = KIND_ICON[a.kind];
                    return (
                      <li key={a.id} className="relative flex items-start gap-3 rounded-lg py-2 pr-2 hover:bg-muted/30">
                        <span className={`relative z-10 mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card ${TONE_BADGE[KIND_TONE[a.kind]]}`}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="break-words text-sm font-medium text-foreground">{a.title}</span>
                            {a.status && <StatusBadge tone="neutral">{a.status}</StatusBadge>}
                          </div>
                          {a.detail && <p className={`break-words text-xs text-muted-foreground ${a.kind === "note" ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{a.detail}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                            <span className="text-muted-foreground" title={fmtDate(a.date)}>{format.relative(a.date)}</span>
                            {a.href && <Link href={a.href} className="font-medium text-primary underline-offset-4 hover:underline">{t("crmClientDetail.view")}</Link>}
                            {a.externalHref && (
                              <a href={a.externalHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
                                {t("crmClientDetail.viewPdf")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </div>
                        {a.amount != null && <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtEuros(a.amount)}</span>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        {editing && <ClientFormDialog client={client as unknown as { id: number }} onClose={() => setEditing(false)} />}
      </Dialog>
      {canTags && tagsOpen && (
        <EntityTagsDialog
          open
          onOpenChange={(o) => !o && setTagsOpen(false)}
          entityType="client"
          entityId={id}
          entityName={display}
          current={clientTags.map((tg) => tg.id)}
          readOnly={!canWriteTags}
        />
      )}
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("crmClientDetail.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("crmClientDetail.deleteConfirm", { name: display })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>{t("crmClientDetail.cancel")}</Button>
            <Button variant="destructive" onClick={() => removeClient.mutate({ id })} disabled={removeClient.isPending}>
              {removeClient.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />} {t("crmClientDetail.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

