/**
 * Email Comercial: bandeja con carpetas, lista y lectura. En pantallas anchas son tres columnas (carpetas, lista,
 * lectura); en tableta, lista y lectura con las carpetas en pastillas; en móvil, la lista o el correo (con «Volver»).
 * Los indicadores de arriba filtran la lista. Solo presentación: consultas y mutaciones son las de siempre.
 */
import { useState } from "react";
import type { ElementType } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import {
  Archive, Check, ChevronLeft, ChevronRight, Clock, FolderPlus, Inbox, Loader2, Mail, MailOpen, Plus, RefreshCw,
  Search, Send, ShieldAlert, Trash2, X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import {
  ComposeDialog, EmailDetail, EmailListItem, FolderButton, ImapFolderItem, isSpamFolder, isVirtualFolder,
  type EmailRow, type Folder,
} from "./EmailInboxParts";

const PAGE_SIZE = 30;

export default function EmailInbox() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [folder, setFolder] = useState<Folder>("inbox");
  const [imapFolder, setImapFolder] = useState<string | undefined>(undefined);
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [page, setPage] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyEmail, setReplyEmail] = useState<EmailRow | null>(null);

  const [newFolderInput, setNewFolderInput] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const [dragEmailId, setDragEmailId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const accounts = trpc.emailAccounts.list.useQuery();
  const folderAccountId = accountId ?? accounts.data?.[0]?.id;
  const stats = trpc.emailInbox.getStats.useQuery({ accountId });
  const imapFolders = trpc.emailAccounts.listFolders.useQuery(
    { accountId: folderAccountId! },
    { enabled: !!folderAccountId, staleTime: 60_000 },
  );
  const emails = trpc.emailInbox.listEmails.useQuery({
    folder,
    imapFolder,
    accountId,
    search: search || undefined,
    onlyUnread,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const refresh = () => {
    utils.emailInbox.listEmails.invalidate();
    utils.emailInbox.getStats.invalidate();
  };

  const markReadMut = trpc.emailInbox.markRead.useMutation({ onSuccess: refresh });
  const archiveMut = trpc.emailInbox.archive.useMutation({ onSuccess: () => { refresh(); if (selectedId) setSelectedId(null); } });
  const deleteMut = trpc.emailInbox.setDeleted.useMutation({ onSuccess: () => { refresh(); if (selectedId) setSelectedId(null); } });
  const syncNowMut = trpc.emailAccounts.syncNow.useMutation({
    onSuccess: () => { toast.success(t("emailInbox.syncDone")); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const markAnsweredMut = trpc.emailInbox.markAnswered.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const bulkMarkAnsweredMut = trpc.emailInbox.bulkMarkAnswered.useMutation({
    onSuccess: (d) => { toast.success(t("emailInbox.bulkAnswered", { n: d.updated })); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const moveToFolderMut = trpc.emailInbox.moveToFolder.useMutation({
    onSuccess: () => { refresh(); setSelectedId(null); },
    onError: (e) => toast.error(e.message),
  });
  const createFolderMut = trpc.emailAccounts.createFolder.useMutation({
    onSuccess: () => {
      utils.emailAccounts.listFolders.invalidate();
      toast.success(t("emailInbox.folderCreated"));
      setNewFolderInput("");
      setShowNewFolder(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteFolderMut = trpc.emailAccounts.deleteFolder.useMutation({
    onSuccess: () => {
      utils.emailAccounts.listFolders.invalidate();
      utils.emailInbox.listEmails.invalidate();
      if (imapFolder) { setImapFolder(undefined); setFolder("inbox"); }
      toast.success(t("emailInbox.folderDeleted"));
    },
    onError: (e) => toast.error(e.message),
  });
  const renameFolderMut = trpc.emailAccounts.renameFolder.useMutation({
    onSuccess: (_d, vars) => {
      utils.emailAccounts.listFolders.invalidate();
      utils.emailInbox.listEmails.invalidate();
      if (imapFolder === vars.oldPath) setImapFolder(vars.newPath);
      toast.success(t("emailInbox.folderRenamed"));
    },
    onError: (e) => toast.error(e.message),
  });

  const s = stats.data;
  const total = emails.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const customFolders = (imapFolders.data ?? []).filter((f) => !isVirtualFolder(f.path) && !isSpamFolder(f.path));
  const spamImapFolder = (imapFolders.data ?? []).find((f) => isSpamFolder(f.path));
  const filtersActive = !!search || onlyUnread;

  const folderItems: { key: Folder; icon: ElementType; tone?: "warning" | "danger" }[] = [
    { key: "inbox", icon: Inbox },
    { key: "pending", icon: Clock, tone: "warning" },
    { key: "sent", icon: Send },
    { key: "archived", icon: Archive },
    { key: "deleted", icon: Trash2, tone: "danger" },
  ];

  function resetView() { setPage(0); setSelectedId(null); }
  function handleFolderChange(f: Folder, unread = false) {
    setFolder(f); setImapFolder(undefined); setOnlyUnread(unread); resetView();
  }
  function handleImapFolderChange(path: string) { setImapFolder(path); resetView(); }
  function handleSelectEmail(email: EmailRow) {
    setSelectedId(email.id);
    if (!email.isRead) markReadMut.mutate({ id: email.id, isRead: true });
  }
  function handleArchive(id: number, archived: boolean) {
    archiveMut.mutate({ id, archived });
    toast.success(archived ? t("emailInbox.archivedToast") : t("emailInbox.restoredToast"));
  }
  function handleDelete(id: number) {
    deleteMut.mutate({ id, deleted: true });
    toast.success(t("emailInbox.deletedToast"));
  }
  function handleDrop(targetFolder: string, emailId: number) {
    setDragEmailId(null);
    setDropTarget(null);
    if (!emailId) return;
    moveToFolderMut.mutate({ id: emailId, targetFolder });
    toast.success(t("emailInbox.movedToast", { folder: targetFolder }));
  }
  function handleCreateFolder() {
    const path = newFolderInput.trim();
    if (!path || !folderAccountId) return;
    createFolderMut.mutate({ accountId: folderAccountId, path });
  }
  const dropProps = (key: string, target: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropTarget(key); },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragEmailId) handleDrop(target, dragEmailId); },
  });

  const detailOpen = selectedId !== null;
  const inboxActive = !imapFolder && folder === "inbox";

  const folderNav = (pill: boolean) => (
    <>
      {folderItems.map(({ key, icon, tone }) => (
        <FolderButton
          key={key}
          pill={pill}
          icon={icon}
          tone={tone}
          label={t(`emailInbox.folder.${key}`)}
          active={!imapFolder && folder === key}
          dropping={dropTarget === key}
          onClick={() => handleFolderChange(key)}
          {...dropProps(key, key)}
        />
      ))}
      {spamImapFolder && (
        <FolderButton
          pill={pill}
          icon={ShieldAlert}
          tone="danger"
          label={t("emailInbox.folder.spam")}
          active={imapFolder === spamImapFolder.path}
          dropping={dropTarget === "__spam__"}
          onClick={() => handleImapFolderChange(spamImapFolder.path)}
          {...dropProps("__spam__", spamImapFolder.path)}
        />
      )}
    </>
  );

  return (
    <AdminLayout title={t("emailInbox.title")}>
      <div className="flex h-[calc(100vh-56px)] max-h-[calc(100vh-56px)] flex-col">
        <PanelPageHeader
          className={cn("mb-0 shrink-0 gap-2 px-4 pb-3 pt-3", detailOpen && "hidden md:flex")}
          icon={<Mail />}
          title={t("emailInbox.title")}
          description={<span className="hidden sm:inline">{t("emailInbox.description")}</span>}
          actions={
            <>
              {(accounts.data?.length ?? 0) > 1 && (
                <select
                  aria-label={t("emailInbox.accountFilter")}
                  value={accountId ?? ""}
                  onChange={(e) => { setAccountId(e.target.value ? Number(e.target.value) : undefined); resetView(); }}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t("emailInbox.accountAll")}</option>
                  {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => syncNowMut.mutate({ accountId })} disabled={syncNowMut.isPending}>
                {syncNowMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="hidden sm:inline">{syncNowMut.isPending ? t("emailInbox.syncing") : t("emailInbox.sync")}</span>
              </Button>
              <Button type="button" size="sm" className="gap-1.5" onClick={() => { setReplyEmail(null); setComposeOpen(true); }}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("emailInbox.compose")}
              </Button>
            </>
          }
        />

        {/* Indicadores que filtran; con un correo abierto en móvil se ocultan para dejar sitio a la lectura. */}
        <section aria-label={t("emailInbox.kpiLabel")} className={cn("shrink-0 border-b border-border bg-gradient-to-r from-primary/5 via-transparent to-transparent px-4 py-3", detailOpen && "hidden md:block")}>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 md:pb-0 [&>*]:min-w-[10.5rem] [&>*]:shrink-0 md:[&>*]:min-w-0">
            <MetricCard compact tone="info" icon={<MailOpen />} label={t("emailInbox.kpiUnread")} value={s?.unreadInbox ?? "—"} detail={t("emailInbox.kpiUnreadDetail")}
              active={inboxActive && onlyUnread} onClick={() => handleFolderChange("inbox", true)} />
            <MetricCard compact tone="warning" icon={<Clock />} label={t("emailInbox.kpiPending")} value={s?.pendingReply ?? "—"} detail={t("emailInbox.kpiPendingDetail")}
              active={!imapFolder && folder === "pending"} onClick={() => handleFolderChange("pending")} />
            <MetricCard compact tone="success" icon={<Inbox />} label={t("emailInbox.kpiToday")} value={s?.receivedToday ?? "—"} detail={t("emailInbox.kpiTodayDetail", { total: s?.totalInbox ?? 0 })}
              active={inboxActive && !onlyUnread} onClick={() => handleFolderChange("inbox")} />
            <MetricCard compact tone="brand" icon={<Send />} label={t("emailInbox.kpiSent")} value={s?.sent ?? "—"} detail={t("emailInbox.kpiSentDetail", { archived: s?.archived ?? 0 })}
              active={!imapFolder && folder === "sent"} onClick={() => handleFolderChange("sent")} />
          </div>
        </section>

        <div className="flex min-h-0 flex-1">
          {/* Carpetas (pantallas anchas) */}
          <nav aria-label={t("emailInbox.foldersLabel")} className="hidden w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/20 p-2 lg:flex">
            <div className="space-y-0.5">{folderNav(false)}</div>
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 flex items-center justify-between px-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("emailInbox.myFolders")}</span>
                {folderAccountId && (
                  <button type="button" title={t("emailInbox.newFolder")} aria-label={t("emailInbox.newFolder")} onClick={() => setShowNewFolder((v) => !v)} className="text-muted-foreground hover:text-primary">
                    <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {showNewFolder && (
                <div className="mb-1 flex items-center gap-1 px-2">
                  <input
                    autoFocus
                    aria-label={t("emailInbox.newFolderName")}
                    name="mail-folder-new"
                    autoComplete="off"
                    value={newFolderInput}
                    onChange={(e) => setNewFolderInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") { setShowNewFolder(false); setNewFolderInput(""); }
                    }}
                    placeholder={t("emailInbox.newFolderName")}
                    className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-primary"
                  />
                  <button type="button" aria-label={t("emailInbox.folderCreate")} onClick={handleCreateFolder} disabled={!newFolderInput.trim() || createFolderMut.isPending} className="text-primary disabled:opacity-40">
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              {imapFolders.isLoading && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t("emailInbox.loadingFolders")}</div>
              )}
              {customFolders.map((f) => (
                <div key={f.path} {...dropProps(f.path, f.path)} className={cn(dropTarget === f.path && "rounded-md ring-2 ring-inset ring-primary")}>
                  <ImapFolderItem
                    path={f.path}
                    name={f.name}
                    isSelected={imapFolder === f.path}
                    onSelect={() => handleImapFolderChange(f.path)}
                    onRename={(newName) => {
                      if (!folderAccountId) return;
                      const parts = f.path.split(f.delimiter ?? "/");
                      parts[parts.length - 1] = newName;
                      renameFolderMut.mutate({ accountId: folderAccountId, oldPath: f.path, newPath: parts.join(f.delimiter ?? "/") });
                    }}
                    onDelete={async () => {
                      if (!folderAccountId) return;
                      if (!(await confirmAction({ description: t("emailInbox.folderDeleteConfirm", { name: f.name }), destructive: true }))) return;
                      deleteFolderMut.mutate({ accountId: folderAccountId, path: f.path });
                    }}
                  />
                </div>
              ))}
            </div>
            {(s?.pendingReply ?? 0) > 0 && (
              <Button type="button" variant="ghost" size="sm" className="mt-auto h-auto justify-start gap-1.5 whitespace-normal py-1.5 text-left text-xs text-muted-foreground" onClick={() => bulkMarkAnsweredMut.mutate({ accountId })} disabled={bulkMarkAnsweredMut.isPending}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> {t("emailInbox.clearPending")}
              </Button>
            )}
          </nav>

          {/* Lista */}
          <section aria-label={t("emailInbox.listLabel")} className={cn("flex min-w-0 flex-col border-r border-border bg-background", detailOpen ? "hidden md:flex md:w-80 md:shrink-0 xl:w-96" : "flex-1 md:w-80 md:flex-none xl:w-96")}>
            {/* Pastillas de carpeta (tableta y móvil) */}
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2 lg:hidden" role="group" aria-label={t("emailInbox.foldersLabel")}>
              {folderNav(true)}
              {customFolders.length > 0 && (
                <select
                  aria-label={t("emailInbox.myFolders")}
                  value={imapFolder && customFolders.some((f) => f.path === imapFolder) ? imapFolder : ""}
                  onChange={(e) => e.target.value && handleImapFolderChange(e.target.value)}
                  className="h-8 shrink-0 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">{t("emailInbox.myFolders")}</option>
                  {customFolders.map((f) => <option key={f.path} value={f.path}>{f.name}</option>)}
                </select>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  name="email-search"
                  autoComplete="off"
                  aria-label={t("emailInbox.searchLabel")}
                  placeholder={t("emailInbox.searchPlaceholder")}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { setSearch(searchInput); setPage(0); }
                    if (e.key === "Escape") { setSearchInput(""); setSearch(""); setPage(0); }
                  }}
                  className="h-9 w-full rounded-md border border-input bg-muted/30 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                type="button"
                aria-pressed={onlyUnread}
                onClick={() => { setOnlyUnread((v) => !v); setPage(0); }}
                className={cn("h-9 shrink-0 rounded-md border px-2.5 text-xs font-medium transition-colors", onlyUnread ? "border-info/50 bg-info/10 text-info" : "border-border text-muted-foreground hover:bg-muted/50")}
              >
                {t("emailInbox.onlyUnread")}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {emails.isLoading ? (
                <PanelLoading label={t("emailInbox.loading")} />
              ) : emails.isError ? (
                <div className="p-4"><PanelError title={t("emailInbox.errorTitle")} error={emails.error} onRetry={() => emails.refetch()} /></div>
              ) : !emails.data?.rows.length ? (
                <div className="p-4">
                  <PanelEmpty
                    icon={<Mail />}
                    title={filtersActive ? t("emailInbox.emptySearch") : t("emailInbox.empty")}
                    description={filtersActive ? t("emailInbox.emptySearchHint") : t("emailInbox.emptyHint")}
                  >
                    {filtersActive && (
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => { setSearch(""); setSearchInput(""); setOnlyUnread(false); setPage(0); }}>
                        <X className="h-3.5 w-3.5" aria-hidden="true" /> {t("emailInbox.clearFilters")}
                      </Button>
                    )}
                  </PanelEmpty>
                </div>
              ) : (
                <ul>
                  {emails.data.rows.map((email) => (
                    <EmailListItem
                      key={email.id}
                      email={email as EmailRow}
                      selected={selectedId === email.id}
                      dragging={dragEmailId === email.id}
                      onSelect={() => handleSelectEmail(email as EmailRow)}
                      onDragStart={() => setDragEmailId(email.id)}
                      onDragEnd={() => { setDragEmailId(null); setDropTarget(null); }}
                    />
                  ))}
                </ul>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">{t("emailInbox.pageRange", { from: page * PAGE_SIZE + 1, to: Math.min((page + 1) * PAGE_SIZE, total), total })}</span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t("emailInbox.prev")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t("emailInbox.next")} disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Lectura */}
          {selectedId ? (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <EmailDetail
                emailId={selectedId}
                onClose={() => setSelectedId(null)}
                onReply={(email) => { setReplyEmail(email); setComposeOpen(true); }}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onMarkAnswered={(id, answered) => markAnsweredMut.mutate({ id, answered })}
              />
            </div>
          ) : (
            <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-6 text-center text-muted-foreground md:flex">
              <MailOpen className="h-10 w-10 text-primary/50" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">{t("emailInbox.selectPrompt")}</span>
              <span className="max-w-xs text-xs">{t("emailInbox.selectHint")}</span>
            </div>
          )}
        </div>
      </div>

      <ComposeDialog
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyEmail(null); }}
        replyTo={replyEmail ?? undefined}
        accountId={accountId}
      />
    </AdminLayout>
  );
}
