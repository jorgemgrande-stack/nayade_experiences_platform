import React, { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/AdminLayout";
import {
  Mail, MailOpen, Send, Archive, Trash2, RefreshCw, Search,
  Inbox, Clock, ChevronLeft, ChevronRight, Reply, X,
  User, ExternalLink, Loader2, Plus, FolderPlus, Folder,
  FolderOpen, Pencil, Check, Paperclip, ShieldAlert, CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Folder = "inbox" | "sent" | "archived" | "deleted" | "pending";

type AttachmentMeta = { filename: string; contentType: string; size: number };

type EmailRow = {
  id: number;
  accountId: number;
  messageId: string;
  inReplyTo: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  snippet: string | null;
  sentAt: Date | string | null;
  isRead: boolean;
  isAnswered: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  isSent: boolean;
  folder: string;
  hasAttachments: boolean;
  attachmentsMeta: AttachmentMeta[];
  imapUid: number | null;
  labels: string[];
  assignedUserId: number | null;
  linkedLeadId: number | null;
  linkedClientId: number | null;
  linkedQuoteId: number | null;
  linkedReservationId: number | null;
  createdAt: Date | string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Ayer";
  if (days < 7) return date.toLocaleDateString("es-ES", { weekday: "short" });
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// ─── Compose / Reply modal ────────────────────────────────────────────────────

function ComposeModal({
  open,
  onClose,
  replyTo,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  replyTo?: EmailRow;
  accountId?: number;
}) {
  const utils = trpc.useUtils();
  const accounts = trpc.emailAccounts.list.useQuery(undefined, { enabled: open });

  const [selAccount, setSelAccount] = useState<number | null>(accountId ?? null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setTo(replyTo ? replyTo.fromEmail : "");
      setSubject(replyTo
        ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`)
        : "");
      setBody("");
      setSending(false);
    }
  }, [open, replyTo?.id]);

  const replyMut = trpc.emailInbox.reply.useMutation({
    onSuccess: () => {
      toast.success("Respuesta enviada");
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendMut = trpc.emailInbox.sendNew.useMutation({
    onSuccess: () => {
      toast.success("Email enviado");
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  const handleSend = () => {
    if (!body.trim()) return toast.error("El cuerpo no puede estar vacío");
    setSending(true);
    if (replyTo) {
      replyMut.mutate({
        emailId: replyTo.id,
        bodyHtml: `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(/\n/g, "<br>")}</div>`,
        bodyText: body,
      }, { onSettled: () => setSending(false) });
    } else {
      if (!selAccount) { setSending(false); return toast.error("Selecciona una cuenta"); }
      const toList = to.split(",").map(s => s.trim()).filter(Boolean);
      if (!toList.length) { setSending(false); return toast.error("Añade al menos un destinatario"); }
      sendMut.mutate({
        accountId: selAccount,
        to: toList,
        subject: subject || "(Sin asunto)",
        bodyHtml: `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(/\n/g, "<br>")}</div>`,
        bodyText: body,
      }, { onSettled: () => setSending(false) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pointer-events-none">
      <div className="pointer-events-auto w-[560px] max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border shrink-0">
          <span className="text-sm font-medium">
            {replyTo ? "Responder" : "Nuevo email"}
          </span>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground/80">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
          {/* Account selector (only for new email) */}
          {!replyTo && (
            <div className="space-y-1">
              <Label className="text-xs text-foreground/50">Cuenta de envío</Label>
              <select
                value={selAccount ?? ""}
                onChange={e => setSelAccount(e.target.value ? Number(e.target.value) : null)}
                className="w-full h-8 text-xs bg-background border border-border rounded px-2"
              >
                <option value="">— seleccionar cuenta —</option>
                {accounts.data?.map(a => (
                  <option key={a.id} value={a.id}>{a.name} &lt;{a.fromEmail}&gt;</option>
                ))}
              </select>
            </div>
          )}

          {/* To */}
          <div className="space-y-1">
            <Label className="text-xs text-foreground/50">Para</Label>
            <Input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="email@ejemplo.com, otro@email.com"
              className="h-8 text-xs"
            />
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <Label className="text-xs text-foreground/50">Asunto</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Asunto"
              className="h-8 text-xs"
            />
          </div>

          {/* Body */}
          <div className="space-y-1 flex-1">
            <Label className="text-xs text-foreground/50">Mensaje</Label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Escribe tu mensaje..."
              className="w-full h-40 text-sm bg-background border border-border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSend} disabled={sending}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Email detail panel ───────────────────────────────────────────────────────

function EmailDetail({
  emailId,
  onClose,
  onReply,
  onArchive,
  onDelete,
  onMarkAnswered,
}: {
  emailId: number;
  onClose: () => void;
  onReply: (email: EmailRow) => void;
  onArchive: (id: number, archived: boolean) => void;
  onDelete: (id: number) => void;
  onMarkAnswered: (id: number, answered: boolean) => void;
}) {
  const { data, isLoading } = trpc.emailInbox.getEmail.useQuery({ id: emailId });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const setHtmlInIframe = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:sans-serif;font-size:14px;line-height:1.6;padding:12px 16px;color:#e0e0e0;background:#0d1523}
      a{color:#f97316}img{max-width:100%}</style></head><body>${html}</body></html>`);
    doc.close();
  }, []);

  const iframeCallbackRef = useCallback((node: HTMLIFrameElement | null) => {
    (iframeRef as any).current = node;
    if (node && data?.bodyHtml) {
      setHtmlInIframe(data.bodyHtml);
    }
  }, [data?.bodyHtml, setHtmlInIframe]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center text-foreground/40 text-sm">
        No se encontró el email
      </div>
    );
  }

  const email = data as EmailRow & { crmLead: any; crmClient: any };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 gap-2">
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground/80 flex items-center gap-1 text-xs">
          <ChevronLeft className="w-4 h-4" />
          Volver
        </button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
            onClick={() => onReply(email)}>
            <Reply className="w-3.5 h-3.5" /> Responder
          </Button>
          {!email.isSent && !email.isAnswered && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
              title="Marcar como sin respuesta pendiente"
              onClick={() => onMarkAnswered(email.id, true)}>
              <CheckCheck className="w-3.5 h-3.5" />
            </Button>
          )}
          {!email.isArchived && !email.isSent && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
              onClick={() => onArchive(email.id, true)}>
              <Archive className="w-3.5 h-3.5" /> Archivar
            </Button>
          )}
          {email.isArchived && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
              onClick={() => onArchive(email.id, false)}>
              <Inbox className="w-3.5 h-3.5" /> Mover a Recibidos
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300"
            onClick={() => onDelete(email.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Subject + meta */}
        <div className="px-5 pt-5 pb-3 border-b border-border/50">
          <h2 className="text-base font-semibold leading-snug mb-3">{email.subject || "(Sin asunto)"}</h2>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-semibold shrink-0">
              {initials(email.fromName, email.fromEmail)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{email.fromName || email.fromEmail}</div>
              <div className="text-xs text-foreground/50">{email.fromEmail}</div>
              <div className="text-xs text-foreground/40 mt-0.5">
                Para: {email.toEmails.join(", ")}
                {email.ccEmails?.length > 0 && <> · CC: {email.ccEmails.join(", ")}</>}
              </div>
            </div>
            <div className="text-xs text-foreground/40 shrink-0">
              {formatDate(email.sentAt)}
            </div>
          </div>
        </div>

        {/* Attachments */}
        {email.hasAttachments && (email.attachmentsMeta ?? []).length > 0 && (
          <div className="px-5 py-3 border-b border-border/50 flex flex-wrap gap-2">
            {(email.attachmentsMeta ?? []).map((att, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/60 text-xs text-foreground/70">
                <Paperclip className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="max-w-[160px] truncate">{att.filename}</span>
                <span className="text-foreground/30 shrink-0">
                  {att.size > 1024 * 1024
                    ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                    : att.size > 1024
                    ? `${(att.size / 1024).toFixed(0)} KB`
                    : `${att.size} B`}
                </span>
              </div>
            ))}
          </div>
        )}
        {email.hasAttachments && !(email.attachmentsMeta ?? []).length && (
          <div className="px-5 py-2 border-b border-border/50 flex items-center gap-1.5 text-xs text-foreground/40">
            <Paperclip className="w-3 h-3" /> Este email tiene adjuntos (se verán al resincronizar)
          </div>
        )}

        {/* Body */}
        <div className="flex-1">
          {email.bodyHtml ? (
            <iframe
              ref={iframeCallbackRef}
              sandbox="allow-same-origin allow-popups"
              className="w-full border-0"
              style={{ minHeight: "300px", height: "auto" }}
              onLoad={(e) => {
                const doc = (e.target as HTMLIFrameElement).contentDocument;
                if (doc?.body) {
                  (e.target as HTMLIFrameElement).style.height = doc.body.scrollHeight + "px";
                }
                if (email.bodyHtml) setHtmlInIframe(email.bodyHtml);
              }}
            />
          ) : (
            <div className="px-5 py-4 text-sm text-foreground/70 whitespace-pre-wrap">
              {email.bodyText || <span className="text-foreground/30 italic">Sin contenido</span>}
            </div>
          )}
        </div>

        {/* CRM context */}
        {(email.crmLead || email.crmClient || email.linkedQuoteId || email.linkedReservationId) && (
          <div className="mx-5 my-4 p-3 rounded-lg bg-muted/30 border border-border/50 text-xs space-y-2">
            <div className="text-foreground/50 font-medium uppercase tracking-wide text-[10px]">Contexto CRM</div>
            {email.crmLead && (
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-foreground/70">Lead:</span>
                <a href={`/admin/crm?tab=leads&id=${email.crmLead.id}`}
                  className="text-sky-400 hover:underline flex items-center gap-0.5">
                  {email.crmLead.name}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            )}
            {email.crmClient && (
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className="text-foreground/70">Cliente:</span>
                <a href={`/admin/crm?tab=clients&id=${email.crmClient.id}`}
                  className="text-green-400 hover:underline flex items-center gap-0.5">
                  {email.crmClient.name}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            )}
            {email.linkedQuoteId && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/70">Presupuesto:</span>
                <a href={`/admin/crm?tab=quotes&id=${email.linkedQuoteId}`}
                  className="text-orange-400 hover:underline">#{email.linkedQuoteId}</a>
              </div>
            )}
            {email.linkedReservationId && (
              <div className="flex items-center gap-2">
                <span className="text-foreground/70">Reserva:</span>
                <a href={`/admin/crm?tab=reservations&id=${email.linkedReservationId}`}
                  className="text-orange-400 hover:underline">#{email.linkedReservationId}</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── IMAP folder sidebar ─────────────────────────────────────────────────────

// Standard IMAP folders covered by virtual folders (no mostrar en "Mis carpetas")
const VIRTUAL_IMAP_NAMES = new Set([
  "inbox", "sent", "sent items", "sent messages", "elementos enviados",
  "archive", "archives", "archivados", "archived", "all mail",
  "trash", "deleted", "deleted items", "papelera", "basura", "deleted messages",
  "drafts", "borradores", "draft",
  // Spam se muestra como carpeta dedicada, no en "Mis carpetas"
  "spam", "junk", "correo no deseado",
]);

function isVirtualFolder(path: string) {
  return VIRTUAL_IMAP_NAMES.has(path.toLowerCase());
}

// Detecta si una carpeta IMAP es Spam/Junk
function isSpamFolder(path: string) {
  return /spam|junk|no.?deseado/i.test(path);
}

function ImapFolderItem({
  path, name, isSelected,
  onSelect, onRename, onDelete,
}: {
  path: string; name: string; isSelected: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editVal, setEditVal] = useState(name);
  const [showActions, setShowActions] = useState(false);

  function commitRename() {
    const trimmed = editVal.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditMode(false);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 px-3 py-1.5 rounded-md mx-1 transition-colors cursor-pointer",
        isSelected ? "bg-orange-500/15 text-orange-400" : "text-foreground/60 hover:text-foreground hover:bg-muted/50",
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); }}
      onClick={!editMode ? onSelect : undefined}
    >
      {isSelected
        ? <FolderOpen className="w-3.5 h-3.5 shrink-0" />
        : <Folder className="w-3.5 h-3.5 shrink-0" />}

      {editMode ? (
        <input
          autoFocus
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditMode(false);
          }}
          onBlur={commitRename}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-transparent border-b border-orange-500 text-xs outline-none min-w-0"
        />
      ) : (
        <span className="flex-1 text-xs truncate">{name}</span>
      )}

      {showActions && !editMode && (
        <div className="flex items-center gap-0.5 ml-auto" onClick={e => e.stopPropagation()}>
          <button
            title="Renombrar"
            onClick={() => { setEditVal(name); setEditMode(true); }}
            className="p-0.5 text-foreground/30 hover:text-foreground/70"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            title="Eliminar"
            onClick={onDelete}
            className="p-0.5 text-foreground/30 hover:text-red-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EmailInbox() {
  const utils = trpc.useUtils();

  // UI state
  const [folder, setFolder] = useState<Folder>("inbox");
  const [imapFolder, setImapFolder] = useState<string | undefined>(undefined); // custom IMAP folder
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyEmail, setReplyEmail] = useState<EmailRow | null>(null);

  // New folder input
  const [newFolderInput, setNewFolderInput] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  // Drag & drop
  const [dragEmailId, setDragEmailId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Data
  const accounts = trpc.emailAccounts.list.useQuery();

  // Resolve which account to query folders from (prefer explicit selection, fall back to first)
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

  // Mutations
  const markReadMut = trpc.emailInbox.markRead.useMutation({
    onSuccess: () => {
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
    },
  });
  const archiveMut = trpc.emailInbox.archive.useMutation({
    onSuccess: () => {
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      if (selectedId) setSelectedId(null);
    },
  });
  const deleteMut = trpc.emailInbox.setDeleted.useMutation({
    onSuccess: () => {
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      if (selectedId) setSelectedId(null);
    },
  });
  const syncNowMut = trpc.emailAccounts.syncNow.useMutation({
    onSuccess: () => {
      toast.success("Sincronización completada");
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markAnsweredMut = trpc.emailInbox.markAnswered.useMutation({
    onSuccess: () => {
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const bulkMarkAnsweredMut = trpc.emailInbox.bulkMarkAnswered.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.updated} emails marcados como respondidos`);
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const moveToFolderMut = trpc.emailInbox.moveToFolder.useMutation({
    onSuccess: () => {
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      setSelectedId(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const createFolderMut = trpc.emailAccounts.createFolder.useMutation({
    onSuccess: () => {
      utils.emailAccounts.listFolders.invalidate();
      toast.success("Carpeta creada");
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
      toast.success("Carpeta eliminada");
    },
    onError: (e) => toast.error(e.message),
  });
  const renameFolderMut = trpc.emailAccounts.renameFolder.useMutation({
    onSuccess: (_d, vars) => {
      utils.emailAccounts.listFolders.invalidate();
      utils.emailInbox.listEmails.invalidate();
      if (imapFolder === vars.oldPath) setImapFolder(vars.newPath);
      toast.success("Carpeta renombrada");
    },
    onError: (e) => toast.error(e.message),
  });

  const s = stats.data;
  const total = emails.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Custom IMAP folders (exclude virtual + spam which gets its own entry)
  const customFolders = (imapFolders.data ?? []).filter(f => !isVirtualFolder(f.path) && !isSpamFolder(f.path));
  // Spam folder (first match in IMAP list)
  const spamImapFolder = (imapFolders.data ?? []).find(f => isSpamFolder(f.path));

  const folderItems: { key: Folder; label: string; icon: React.ElementType; count?: number }[] = [
    { key: "inbox", label: "Recibidos", icon: Inbox, count: s?.unreadInbox },
    { key: "pending", label: "Pendientes", icon: Clock, count: s?.pendingReply },
    { key: "sent", label: "Enviados", icon: Send, count: undefined },
    { key: "archived", label: "Archivados", icon: Archive, count: undefined },
    { key: "deleted", label: "Papelera", icon: Trash2, count: undefined },
  ];

  function handleSelectEmail(email: EmailRow) {
    setSelectedId(email.id);
    if (!email.isRead) {
      markReadMut.mutate({ id: email.id, isRead: true });
    }
  }

  function handleFolderChange(f: Folder) {
    setFolder(f);
    setImapFolder(undefined);
    setPage(0);
    setSelectedId(null);
  }

  function handleImapFolderChange(path: string) {
    setImapFolder(path);
    setPage(0);
    setSelectedId(null);
  }

  function handleArchive(id: number, archived: boolean) {
    archiveMut.mutate({ id, archived });
    toast.success(archived ? "Archivado" : "Movido a Recibidos");
  }

  function handleDelete(id: number) {
    deleteMut.mutate({ id, deleted: true });
    toast.success("Movido a Papelera");
  }

  function handleDrop(targetFolder: string, emailId: number) {
    setDragEmailId(null);
    setDropTarget(null);
    if (!emailId) return;
    moveToFolderMut.mutate({ id: emailId, targetFolder });
    toast.success(`Email movido a ${targetFolder}`);
  }

  function handleCreateFolder() {
    const path = newFolderInput.trim();
    if (!path || !folderAccountId) return;
    createFolderMut.mutate({ accountId: folderAccountId, path });
  }

  return (
    <AdminLayout title="Email Comercial">
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">

        {/* ── Left: folder sidebar ── */}
        <div className="w-52 shrink-0 border-r border-border flex flex-col bg-background/50">
          <div className="p-3 border-b border-border">
            <Button
              size="sm"
              className="w-full bg-orange-500 hover:bg-orange-600 text-white gap-1.5 h-8 text-xs"
              onClick={() => { setReplyEmail(null); setComposeOpen(true); }}
            >
              <Plus className="w-3.5 h-3.5" /> Nuevo email
            </Button>
          </div>

          {/* Account filter */}
          {(accounts.data?.length ?? 0) > 1 && (
            <div className="p-2 border-b border-border">
              <select
                value={accountId ?? ""}
                onChange={e => { setAccountId(e.target.value ? Number(e.target.value) : undefined); setPage(0); }}
                className="w-full h-7 text-xs bg-background border border-border rounded px-1.5"
              >
                <option value="">Todas las cuentas</option>
                {accounts.data?.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Virtual folders + IMAP folders */}
          <nav className="flex-1 overflow-y-auto py-1">
            {/* Standard virtual folders */}
            {folderItems.map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => handleFolderChange(key)}
                onDragOver={e => { e.preventDefault(); setDropTarget(key); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => { e.preventDefault(); if (dragEmailId) handleDrop(key, dragEmailId); }}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md mx-1 transition-colors",
                  !imapFolder && folder === key
                    ? "bg-orange-500/15 text-orange-400"
                    : "text-foreground/60 hover:text-foreground hover:bg-muted/50",
                  dropTarget === key && "ring-1 ring-orange-400 bg-orange-500/10",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {key === "pending" && (s?.pendingReply ?? 0) > 0 && (
                    <button
                      title="Limpiar pendientes"
                      onClick={e => { e.stopPropagation(); bulkMarkAnsweredMut.mutate({ accountId }); }}
                      className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-emerald-400 p-0.5"
                    >
                      <CheckCheck className="w-3 h-3" />
                    </button>
                  )}
                  {!!count && (
                    <span className="text-[10px] bg-orange-500 text-white rounded-full px-1.5 py-0.5 font-medium">
                      {count}
                    </span>
                  )}
                </div>
              </button>
            ))}

            {/* Spam folder (dedicated entry from IMAP) */}
            {spamImapFolder && (
              <button
                onClick={() => handleImapFolderChange(spamImapFolder.path)}
                onDragOver={e => { e.preventDefault(); setDropTarget("__spam__"); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => { e.preventDefault(); if (dragEmailId) handleDrop(spamImapFolder.path, dragEmailId); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md mx-1 transition-colors",
                  imapFolder === spamImapFolder.path
                    ? "bg-orange-500/15 text-orange-400"
                    : "text-foreground/60 hover:text-foreground hover:bg-muted/50",
                  dropTarget === "__spam__" && "ring-1 ring-orange-400 bg-orange-500/10",
                )}
              >
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Spam</span>
              </button>
            )}

            {/* Custom IMAP folders */}
            {(customFolders.length > 0 || folderAccountId) && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between px-3 mb-1">
                  <span className="text-[10px] text-foreground/30 uppercase tracking-wider">Mis carpetas</span>
                  <button
                    title="Nueva carpeta"
                    onClick={() => setShowNewFolder(v => !v)}
                    className="text-foreground/30 hover:text-orange-400"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* New folder input */}
                {showNewFolder && (
                  <div className="flex items-center gap-1 px-2 mb-1">
                    <input
                      autoFocus
                      value={newFolderInput}
                      onChange={e => setNewFolderInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleCreateFolder();
                        if (e.key === "Escape") { setShowNewFolder(false); setNewFolderInput(""); }
                      }}
                      placeholder="Nombre carpeta"
                      className="flex-1 h-6 text-xs bg-background border border-border rounded px-1.5 outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderInput.trim() || createFolderMut.isPending}
                      className="text-orange-400 hover:text-orange-300 disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {imapFolders.isLoading && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-foreground/30 text-xs">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
                  </div>
                )}

                {customFolders.map(f => (
                  <div
                    key={f.path}
                    onDragOver={e => { e.preventDefault(); setDropTarget(f.path); }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={e => { e.preventDefault(); if (dragEmailId) handleDrop(f.path, dragEmailId); }}
                    className={cn(dropTarget === f.path && "ring-1 ring-inset ring-orange-400 rounded-md mx-1")}
                  >
                    <ImapFolderItem
                      path={f.path}
                      name={f.name}
                      isSelected={imapFolder === f.path}
                      onSelect={() => handleImapFolderChange(f.path)}
                      onRename={newName => {
                        if (!folderAccountId) return;
                        const parts = f.path.split(f.delimiter ?? "/");
                        parts[parts.length - 1] = newName;
                        const newPath = parts.join(f.delimiter ?? "/");
                        renameFolderMut.mutate({ accountId: folderAccountId, oldPath: f.path, newPath });
                      }}
                      onDelete={() => {
                        if (!folderAccountId) return;
                        if (!confirm(`¿Eliminar la carpeta "${f.name}" y todos sus emails?`)) return;
                        deleteFolderMut.mutate({ accountId: folderAccountId, path: f.path });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </nav>

          {/* Sync button */}
          <div className="p-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs gap-1.5 text-foreground/50"
              onClick={() => syncNowMut.mutate({ accountId })}
              disabled={syncNowMut.isPending}
            >
              {syncNowMut.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RefreshCw className="w-3 h-3" />}
              Sincronizar
            </Button>
          </div>
        </div>

        {/* ── Center: email list ── */}
        <div className={cn(
          "flex flex-col border-r border-border bg-background",
          selectedId ? "w-72 shrink-0" : "flex-1",
        )}>
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { setSearch(searchInput); setPage(0); }
                  if (e.key === "Escape") { setSearchInput(""); setSearch(""); setPage(0); }
                }}
                className="w-full h-7 pl-8 pr-2 text-xs bg-muted/30 border border-border rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <button
              onClick={() => { setOnlyUnread(v => !v); setPage(0); }}
              className={cn(
                "text-xs px-2 py-1 rounded border transition-colors",
                onlyUnread
                  ? "border-orange-500 text-orange-400 bg-orange-500/10"
                  : "border-border text-foreground/40 hover:border-foreground/30",
              )}
            >
              No leídos
            </button>
          </div>

          {/* Email rows */}
          <div className="flex-1 overflow-y-auto">
            {emails.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
              </div>
            ) : emails.isError ? (
              <div className="flex flex-col items-center justify-center py-16 text-red-400/70 gap-1 px-4 text-center">
                <span className="text-sm font-medium">Error al cargar correos</span>
                <span className="text-xs text-foreground/40">{(emails.error as any)?.message ?? "Error desconocido"}</span>
              </div>
            ) : !emails.data?.rows.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-foreground/30">
                <Mail className="w-10 h-10 mb-2" />
                <span className="text-sm">Sin correos</span>
              </div>
            ) : (
              emails.data.rows.map(email => (
                <button
                  key={email.id}
                  draggable
                  onDragStart={() => setDragEmailId(email.id)}
                  onDragEnd={() => { setDragEmailId(null); setDropTarget(null); }}
                  onClick={() => handleSelectEmail(email)}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b border-border/50 transition-colors cursor-grab active:cursor-grabbing",
                    selectedId === email.id
                      ? "bg-orange-500/10 border-l-2 border-l-orange-500"
                      : "hover:bg-muted/30",
                    !email.isRead && "bg-sky-500/5",
                    dragEmailId === email.id && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5",
                      email.isSent
                        ? "bg-orange-500/15 text-orange-400"
                        : "bg-sky-500/15 text-sky-400",
                    )}>
                      {email.isSent
                        ? initials(null, email.toEmails[0] ?? "")
                        : initials(email.fromName, email.fromEmail)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1 mb-0.5">
                        <span className={cn(
                          "text-xs truncate",
                          !email.isRead ? "font-semibold text-foreground" : "text-foreground/70",
                        )}>
                          {email.isSent
                            ? `→ ${email.toEmails[0] ?? "—"}`
                            : (email.fromName || email.fromEmail)}
                        </span>
                        <span className="text-[10px] text-foreground/35 shrink-0">
                          {formatDate(email.sentAt)}
                        </span>
                      </div>
                      <div className={cn(
                        "text-xs truncate",
                        !email.isRead ? "font-medium text-foreground/90" : "text-foreground/60",
                      )}>
                        {email.subject || "(Sin asunto)"}
                      </div>
                      {email.snippet && (
                        <div className="text-[11px] text-foreground/35 truncate mt-0.5">
                          {email.snippet}
                        </div>
                      )}
                    </div>
                    {!email.isRead && (
                      <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border shrink-0">
              <span className="text-xs text-foreground/40">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: email detail ── */}
        {selectedId ? (
          <div className="flex-1 flex flex-col overflow-hidden">
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
          <div className="flex-1 flex flex-col items-center justify-center text-foreground/20 gap-2">
            <MailOpen className="w-12 h-12" />
            <span className="text-sm">Selecciona un email para leerlo</span>
          </div>
        )}
      </div>

      {/* Compose/Reply modal */}
      <ComposeModal
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyEmail(null); }}
        replyTo={replyEmail ?? undefined}
        accountId={accountId}
      />
    </AdminLayout>
  );
}
