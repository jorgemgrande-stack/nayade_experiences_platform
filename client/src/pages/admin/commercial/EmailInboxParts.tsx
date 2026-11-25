/**
 * Piezas de la bandeja de Email Comercial: lectura (con adjuntos y contexto del CRM), redacción/respuesta, carpetas y
 * fila de la lista. Solo presentación: las consultas y mutaciones son las de siempre (emailInbox.*, emailAccounts.*).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ElementType } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Archive, CheckCheck, ChevronLeft, ExternalLink, Folder as FolderIcon, FolderOpen, Inbox, Loader2, Paperclip,
  Pencil, Reply, Send, Trash2, User,
} from "lucide-react";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/crm/CrmParts";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PersonAvatar } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelLoading } from "@/components/admin/PanelStates";

export type Folder = "inbox" | "sent" | "archived" | "deleted" | "pending";

export type AttachmentMeta = { filename: string; contentType: string; size: number };

export type EmailRow = {
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

/** Hora si es de hoy, «Ayer», día de la semana (última semana) o día y mes. */
export function useMailDate() {
  const { t } = useI18n();
  const f = useFormat();
  return (d: Date | string | null): string => {
    if (!d) return "—";
    const date = new Date(d);
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return f.time(date, { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return t("emailInbox.yesterday");
    if (days < 7) return f.date(date, { weekday: "short" });
    return f.date(date, { day: "2-digit", month: "short" });
  };
}

function fileSize(t: ReturnType<typeof useI18n>["t"], size: number) {
  if (size > 1024 * 1024) return t("emailInbox.sizeMb", { n: (size / 1024 / 1024).toFixed(1) });
  if (size > 1024) return t("emailInbox.sizeKb", { n: (size / 1024).toFixed(0) });
  return t("emailInbox.sizeB", { n: size });
}

/** Estado de un correo para la insignia: un solo estado, el más relevante. */
function rowStatus(e: Pick<EmailRow, "isSent" | "isRead" | "isAnswered" | "isArchived">): { tone: Tone; key: "unread" | "answered" | "pending" | "sent" | "archived" } {
  if (e.isSent) return { tone: "brand", key: "sent" };
  if (!e.isRead) return { tone: "info", key: "unread" };
  if (e.isArchived) return { tone: "neutral", key: "archived" };
  if (e.isAnswered) return { tone: "success", key: "answered" };
  return { tone: "warning", key: "pending" };
}

// ─── Redactar / responder ─────────────────────────────────────────────────────

export function ComposeDialog({ open, onClose, replyTo, accountId }: {
  open: boolean;
  onClose: () => void;
  replyTo?: EmailRow;
  accountId?: number;
}) {
  const { t } = useI18n();
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
      setSubject(replyTo ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`) : "");
      setBody("");
      setSending(false);
    }
  }, [open, replyTo?.id]);

  const replyMut = trpc.emailInbox.reply.useMutation({
    onSuccess: () => {
      toast.success(t("emailInbox.replySent"));
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendMut = trpc.emailInbox.sendNew.useMutation({
    onSuccess: () => {
      toast.success(t("emailInbox.mailSent"));
      utils.emailInbox.listEmails.invalidate();
      utils.emailInbox.getStats.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSend = () => {
    if (!body.trim()) return toast.error(t("emailInbox.bodyEmpty"));
    setSending(true);
    if (replyTo) {
      replyMut.mutate({
        emailId: replyTo.id,
        bodyHtml: `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(/\n/g, "<br>")}</div>`,
        bodyText: body,
      }, { onSettled: () => setSending(false) });
    } else {
      if (!selAccount) { setSending(false); return toast.error(t("emailInbox.pickAccount")); }
      const toList = to.split(",").map((s) => s.trim()).filter(Boolean);
      if (!toList.length) { setSending(false); return toast.error(t("emailInbox.addRecipient")); }
      sendMut.mutate({
        accountId: selAccount,
        to: toList,
        subject: subject || t("emailInbox.noSubject"),
        bodyHtml: `<div style="font-family:sans-serif;white-space:pre-wrap">${body.replace(/\n/g, "<br>")}</div>`,
        bodyText: body,
      }, { onSettled: () => setSending(false) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replyTo ? t("emailInbox.composeTitleReply") : t("emailInbox.composeTitleNew")}</DialogTitle>
          <DialogDescription>{replyTo ? t("emailInbox.composeDescReply") : t("emailInbox.composeDescNew")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!replyTo && (
            <FormField id="mail-account" label={t("emailInbox.account")} hint={t("emailInbox.accountHint")} required>
              <select
                id="mail-account"
                value={selAccount ?? ""}
                onChange={(e) => setSelAccount(e.target.value ? Number(e.target.value) : null)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t("emailInbox.accountPlaceholder")}</option>
                {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name} &lt;{a.fromEmail}&gt;</option>)}
              </select>
            </FormField>
          )}
          <FormField id="mail-to" label={t("emailInbox.toLabel")} hint={replyTo ? undefined : t("emailInbox.toHint")} required>
            <Input id="mail-to" name="mail-to" autoComplete="off" value={to} readOnly={!!replyTo} onChange={(e) => setTo(e.target.value)} placeholder={t("emailInbox.toPlaceholder")} />
          </FormField>
          <FormField id="mail-subject" label={t("emailInbox.subject")}>
            <Input id="mail-subject" name="mail-subject" autoComplete="off" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("emailInbox.subjectPlaceholder")} />
          </FormField>
          <FormField id="mail-body" label={t("emailInbox.message")} required>
            <Textarea id="mail-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("emailInbox.messagePlaceholder")} className="h-44 resize-none" />
          </FormField>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("emailInbox.cancel")}</Button>
          <Button type="button" onClick={handleSend} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {sending ? t("emailInbox.sending") : t("emailInbox.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export function EmailDetail({ emailId, onClose, onReply, onArchive, onDelete, onMarkAnswered }: {
  emailId: number;
  onClose: () => void;
  onReply: (email: EmailRow) => void;
  onArchive: (id: number, archived: boolean) => void;
  onDelete: (id: number) => void;
  onMarkAnswered: (id: number, answered: boolean) => void;
}) {
  const { t } = useI18n();
  const fmt = useMailDate();
  const { data, isLoading } = trpc.emailInbox.getEmail.useQuery({ id: emailId });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // El contenido del correo vive en un iframe aislado: hereda el color de texto y el fondo del tema para leerse en claro y oscuro.
  const setHtmlInIframe = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) return;
    const cs = hostRef.current ? getComputedStyle(hostRef.current) : null;
    const color = cs?.color ?? "inherit";
    const bg = cs?.backgroundColor ?? "transparent";
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:sans-serif;font-size:14px;line-height:1.6;padding:12px 16px;margin:0;color:${color};background:${bg};overflow-wrap:anywhere}
      a{color:inherit;text-decoration:underline}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`);
    doc.close();
  }, []);

  const iframeCallbackRef = useCallback((node: HTMLIFrameElement | null) => {
    iframeRef.current = node;
    if (node && data?.bodyHtml) setHtmlInIframe(data.bodyHtml);
  }, [data?.bodyHtml, setHtmlInIframe]);

  if (isLoading) return <PanelLoading label={t("emailInbox.loadingEmail")} className="flex-1" />;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <PanelEmpty icon={<Inbox />} title={t("emailInbox.notFound")}>
          <Button type="button" variant="outline" onClick={onClose}>{t("emailInbox.back")}</Button>
        </PanelEmpty>
      </div>
    );
  }

  const email = data as EmailRow & { crmLead: any; crmClient: any };
  const st = rowStatus(email);
  const hasCrm = !!(email.crmLead || email.crmClient || email.linkedQuoteId || email.linkedReservationId);
  const sender = email.isSent ? (email.toEmails[0] ?? "—") : (email.fromName || email.fromEmail);

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card text-foreground">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="gap-1 md:hidden">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("emailInbox.back")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" className="gap-1.5" onClick={() => onReply(email)}>
            <Reply className="h-3.5 w-3.5" aria-hidden="true" /> {t("emailInbox.reply")}
          </Button>
          {!email.isSent && !email.isAnswered && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-success hover:text-success" title={t("emailInbox.markAnsweredTitle")} onClick={() => onMarkAnswered(email.id, true)}>
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("emailInbox.markAnswered")}</span>
            </Button>
          )}
          {!email.isArchived && !email.isSent && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => onArchive(email.id, true)}>
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("emailInbox.archive")}</span>
            </Button>
          )}
          {email.isArchived && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => onArchive(email.id, false)}>
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("emailInbox.toInbox")}</span>
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-danger hover:text-danger" title={t("emailInbox.delete")} onClick={() => onDelete(email.id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{t("emailInbox.delete")}</span>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent px-4 pb-3 pt-4 sm:px-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h2 className="min-w-0 break-words text-base font-semibold leading-snug">{email.subject || t("emailInbox.noSubject")}</h2>
            <StatusBadge tone={st.tone}>{t(`emailInbox.status.${st.key}`)}</StatusBadge>
          </div>
          <div className="flex items-start gap-3">
            <PersonAvatar name={sender} id={email.id} size="md" />
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-medium">{email.fromName || email.fromEmail}</div>
              <div className="break-all text-xs text-muted-foreground">{email.fromEmail}</div>
              <div className="mt-0.5 break-words text-xs text-muted-foreground">
                {t("emailInbox.to")}: {email.toEmails.join(", ")}
                {email.ccEmails?.length > 0 && <> · {t("emailInbox.cc")}: {email.ccEmails.join(", ")}</>}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">{fmt(email.sentAt)}</div>
          </div>
        </div>

        {email.hasAttachments && (email.attachmentsMeta ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-5" role="list" aria-label={t("emailInbox.attachments")}>
            {(email.attachmentsMeta ?? []).map((att, i) => (
              <div key={i} role="listitem" className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                <Paperclip className="h-3 w-3 shrink-0 text-info" aria-hidden="true" />
                <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{att.filename}</span>
                <span className="shrink-0 text-muted-foreground">{fileSize(t, att.size)}</span>
              </div>
            ))}
          </div>
        )}
        {email.hasAttachments && !(email.attachmentsMeta ?? []).length && (
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-5">
            <Paperclip className="h-3 w-3" aria-hidden="true" /> {t("emailInbox.attachmentsPending")}
          </div>
        )}

        <div>
          {email.bodyHtml ? (
            <iframe
              ref={iframeCallbackRef}
              title={email.subject || t("emailInbox.noSubject")}
              sandbox="allow-same-origin allow-popups"
              className="w-full border-0"
              style={{ minHeight: "300px", height: "auto" }}
              onLoad={(e) => {
                const doc = (e.target as HTMLIFrameElement).contentDocument;
                if (doc?.body) (e.target as HTMLIFrameElement).style.height = doc.body.scrollHeight + "px";
                if (email.bodyHtml) setHtmlInIframe(email.bodyHtml);
              }}
            />
          ) : (
            <div className="whitespace-pre-wrap break-words px-4 py-4 text-sm sm:px-5">
              {email.bodyText || <span className="italic text-muted-foreground">{t("emailInbox.noContent")}</span>}
            </div>
          )}
        </div>

        {hasCrm && (
          <div className="mx-4 my-4 space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:mx-5">
            <div className="font-medium uppercase tracking-wide text-muted-foreground">{t("emailInbox.crm")}</div>
            {email.crmLead && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                <span className="text-muted-foreground">{t("emailInbox.crmLead")}:</span>
                <a href={`/admin/crm?tab=leads&id=${email.crmLead.id}`} className="flex items-center gap-0.5 text-info hover:underline">
                  {email.crmLead.name}<ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                </a>
              </div>
            )}
            {email.crmClient && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                <span className="text-muted-foreground">{t("emailInbox.crmClient")}:</span>
                <a href={`/admin/crm/clientes/${email.crmClient.id}`} className="flex items-center gap-0.5 text-success hover:underline">
                  {email.crmClient.name}<ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                </a>
              </div>
            )}
            {email.linkedQuoteId && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("emailInbox.crmQuote")}:</span>
                <a href={`/admin/crm?tab=quotes&id=${email.linkedQuoteId}`} className="text-primary hover:underline">#{email.linkedQuoteId}</a>
              </div>
            )}
            {email.linkedReservationId && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("emailInbox.crmReservation")}:</span>
                <a href={`/admin/crm?tab=reservations&id=${email.linkedReservationId}`} className="text-primary hover:underline">#{email.linkedReservationId}</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Carpetas ─────────────────────────────────────────────────────────────────

const VIRTUAL_IMAP_NAMES = new Set([
  "inbox", "sent", "sent items", "sent messages", "elementos enviados",
  "archive", "archives", "archivados", "archived", "all mail",
  "trash", "deleted", "deleted items", "papelera", "basura", "deleted messages",
  "drafts", "borradores", "draft",
  "spam", "junk", "correo no deseado",
]);
export const isVirtualFolder = (path: string) => VIRTUAL_IMAP_NAMES.has(path.toLowerCase());
export const isSpamFolder = (path: string) => /spam|junk|no.?deseado/i.test(path);

/** Botón de carpeta (lista lateral en pantallas anchas, pastillas en móvil). */
export function FolderButton({ icon: Icon, label, active, dropping, tone = "brand", count, onClick, onDragOver, onDragLeave, onDrop, pill }: {
  icon: ElementType;
  label: string;
  active: boolean;
  dropping?: boolean;
  tone?: "brand" | "warning" | "danger";
  count?: number;
  onClick: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  pill?: boolean;
}) {
  const activeCls = tone === "warning" ? "bg-warning/15 text-warning" : tone === "danger" ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pill ? "shrink-0 whitespace-nowrap border border-border px-3 py-1.5" : "w-full px-3 py-2",
        active ? activeCls : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        pill && active && "border-transparent",
        dropping && "ring-2 ring-primary",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">{label}</span>
      {!!count && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{count}</span>}
    </button>
  );
}

export function ImapFolderItem({ name, isSelected, onSelect, onRename, onDelete }: {
  path: string; name: string; isSelected: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editMode, setEditMode] = useState(false);
  const [editVal, setEditVal] = useState(name);

  function commitRename() {
    const trimmed = editVal.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setEditMode(false);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-3 py-1.5 transition-colors",
        isSelected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {isSelected ? <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <FolderIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {editMode ? (
        <input
          autoFocus
          aria-label={t("emailInbox.folderRename")}
          autoComplete="off"
          name="mail-folder-rename"
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditMode(false);
          }}
          onBlur={commitRename}
          className="min-w-0 flex-1 border-b border-primary bg-transparent text-xs outline-none"
        />
      ) : (
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-xs">{name}</button>
      )}
      {!editMode && (
        <span className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <button type="button" title={t("emailInbox.folderRename")} aria-label={t("emailInbox.folderRename")} onClick={() => { setEditVal(name); setEditMode(true); }} className="p-1 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </button>
          <button type="button" title={t("emailInbox.folderDelete")} aria-label={t("emailInbox.folderDelete")} onClick={onDelete} className="p-1 text-muted-foreground hover:text-danger">
            <Trash2 className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  );
}

// ─── Fila de la lista ─────────────────────────────────────────────────────────

export function EmailListItem({ email, selected, dragging, onSelect, onDragStart, onDragEnd }: {
  email: EmailRow;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useI18n();
  const fmt = useMailDate();
  const st = rowStatus(email);
  const who = email.isSent ? `→ ${email.toEmails[0] ?? "—"}` : (email.fromName || email.fromEmail);
  const avatarName = email.isSent ? (email.toEmails[0] ?? "?") : (email.fromName || email.fromEmail);
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 border-b border-l-2 border-border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:cursor-grab md:active:cursor-grabbing",
          selected ? "border-l-primary bg-primary/10" : "border-l-transparent hover:bg-muted/40",
          !email.isRead && !selected && "bg-info/5",
          dragging && "opacity-50",
        )}
      >
        <PersonAvatar name={avatarName} id={email.id} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className={cn("overflow-hidden text-ellipsis whitespace-nowrap text-sm", !email.isRead ? "font-semibold text-foreground" : "text-foreground/80")}>{who}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{fmt(email.sentAt)}</span>
          </div>
          <div className={cn("overflow-hidden text-ellipsis whitespace-nowrap text-sm", !email.isRead ? "font-medium text-foreground" : "text-muted-foreground")}>{email.subject || t("emailInbox.noSubject")}</div>
          {email.snippet && <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{email.snippet}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={st.tone}>{t(`emailInbox.status.${st.key}`)}</StatusBadge>
            {email.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
          </div>
        </div>
      </button>
    </li>
  );
}
