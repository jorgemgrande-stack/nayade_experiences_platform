import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Mail, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, XCircle,
  Eye, EyeOff, ChevronDown, ChevronUp, Server, Send,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountForm = {
  name: string; email: string;
  imapHost: string; imapPort: number; imapSecure: boolean;
  imapUser: string; imapPassword: string;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  smtpUser: string; smtpPassword: string;
  fromName: string; fromEmail: string;
  isDefault: boolean; syncEnabled: boolean; syncIntervalMinutes: number;
  folderInbox: string; folderSent: string; folderArchive: string; folderTrash: string;
  maxEmailsPerSync: number;
};

const EMPTY_FORM: AccountForm = {
  name: "", email: "",
  imapHost: "", imapPort: 993, imapSecure: true, imapUser: "", imapPassword: "",
  smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpPassword: "",
  fromName: "", fromEmail: "",
  isDefault: false, syncEnabled: true, syncIntervalMinutes: 5,
  folderInbox: "INBOX", folderSent: "Sent", folderArchive: "Archive", folderTrash: "Trash",
  maxEmailsPerSync: 50,
};

// ─── Field row helper ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-foreground/60">{label}</Label>
      {children}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className="h-8 text-xs pr-8 font-mono" />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/70">
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ─── Account form modal ───────────────────────────────────────────────────────

function AccountModal({
  open, onClose, initial, editId,
}: {
  open: boolean;
  onClose: () => void;
  initial?: AccountForm;
  editId?: number;
}) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<AccountForm>(initial ?? EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingImap, setTestingImap] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  const f = (k: keyof AccountForm) => (v: any) => setForm(p => ({ ...p, [k]: v }));

  const createMut = trpc.emailAccounts.create.useMutation({
    onSuccess: () => { toast.success(t("settingsEmailAccounts.created")); utils.emailAccounts.list.invalidate(); onClose(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.emailAccounts.update.useMutation({
    onSuccess: () => { toast.success(t("settingsEmailAccounts.updated")); utils.emailAccounts.list.invalidate(); onClose(); },
    onError: e => toast.error(e.message),
  });
  const testImapMut = trpc.emailAccounts.testImap.useMutation({
    onSuccess: r => setImapTestResult(r),
    onError: e => setImapTestResult({ ok: false, message: e.message }),
  });
  const testSmtpMut = trpc.emailAccounts.testSmtp.useMutation({
    onSuccess: r => setSmtpTestResult(r),
    onError: e => setSmtpTestResult({ ok: false, message: e.message }),
  });

  async function handleTestImap() {
    setTestingImap(true); setImapTestResult(null);
    await testImapMut.mutateAsync({
      host: form.imapHost, port: form.imapPort, secure: form.imapSecure,
      user: form.imapUser, password: form.imapPassword, folder: form.folderInbox,
    });
    setTestingImap(false);
  }

  async function handleTestSmtp() {
    setTestingSmtp(true); setSmtpTestResult(null);
    await testSmtpMut.mutateAsync({
      host: form.smtpHost, port: form.smtpPort, secure: form.smtpSecure,
      user: form.smtpUser, password: form.smtpPassword,
    });
    setTestingSmtp(false);
  }

  function handleSubmit() {
    if (editId) {
      updateMut.mutate({ ...form, id: editId });
    } else {
      createMut.mutate(form);
    }
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? t("settingsEmailAccounts.modal.editTitle") : t("settingsEmailAccounts.modal.newTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* General */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settingsEmailAccounts.modal.accountName")}>
              <Input value={form.name} onChange={e => f("name")(e.target.value)} className="h-8 text-xs" placeholder={t("settingsEmailAccounts.modal.accountNamePh")} />
            </Field>
            <Field label={t("settingsEmailAccounts.modal.accountEmail")}>
              <Input value={form.email} onChange={e => f("email")(e.target.value)} className="h-8 text-xs" placeholder="info@empresa.es" />
            </Field>
            <Field label={t("settingsEmailAccounts.modal.fromName")}>
              <Input value={form.fromName} onChange={e => f("fromName")(e.target.value)} className="h-8 text-xs" placeholder={t("settingsEmailAccounts.modal.fromNamePh")} />
            </Field>
            <Field label={t("settingsEmailAccounts.modal.fromEmail")}>
              <Input value={form.fromEmail} onChange={e => f("fromEmail")(e.target.value)} className="h-8 text-xs" placeholder="info@tuempresa.es" />
            </Field>
          </div>

          {/* IMAP */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wider">{t("settingsEmailAccounts.modal.receiving")}</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label={t("settingsEmailAccounts.modal.imapServer")}>
                  <Input value={form.imapHost} onChange={e => f("imapHost")(e.target.value)} className="h-8 text-xs font-mono" placeholder="imap.empresa.es" />
                </Field>
              </div>
              <Field label={t("settingsEmailAccounts.modal.port")}>
                <Input type="number" value={form.imapPort} onChange={e => f("imapPort")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.imapUser")}>
                <Input value={form.imapUser} onChange={e => f("imapUser")(e.target.value)} className="h-8 text-xs" placeholder="usuario@empresa.es" />
              </Field>
              <div className="col-span-2">
                <Field label={t("settingsEmailAccounts.modal.imapPassword")}>
                  <PasswordInput value={form.imapPassword} onChange={f("imapPassword")} placeholder={editId ? t("settingsEmailAccounts.modal.keepEmpty") : ""} />
                </Field>
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input type="checkbox" id="imap-secure" checked={form.imapSecure}
                  onChange={e => f("imapSecure")(e.target.checked)} className="accent-sky-500" />
                <label htmlFor="imap-secure" className="text-xs cursor-pointer">SSL/TLS</label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleTestImap} disabled={testingImap || !form.imapHost}
                className="h-7 text-xs gap-1">
                {testingImap ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
                {t("settingsEmailAccounts.modal.testImap")}
              </Button>
              {imapTestResult && (
                <span className={`text-xs flex items-center gap-1 ${imapTestResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {imapTestResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {imapTestResult.message}
                </span>
              )}
            </div>
          </div>

          {/* SMTP */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-violet-400" />
              <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wider">{t("settingsEmailAccounts.modal.sending")}</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label={t("settingsEmailAccounts.modal.smtpServer")}>
                  <Input value={form.smtpHost} onChange={e => f("smtpHost")(e.target.value)} className="h-8 text-xs font-mono" placeholder="smtp.empresa.es" />
                </Field>
              </div>
              <Field label={t("settingsEmailAccounts.modal.port")}>
                <Input type="number" value={form.smtpPort} onChange={e => f("smtpPort")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.smtpUser")}>
                <Input value={form.smtpUser} onChange={e => f("smtpUser")(e.target.value)} className="h-8 text-xs" placeholder="usuario@empresa.es" />
              </Field>
              <div className="col-span-2">
                <Field label={t("settingsEmailAccounts.modal.smtpPassword")}>
                  <PasswordInput value={form.smtpPassword} onChange={f("smtpPassword")} placeholder={editId ? t("settingsEmailAccounts.modal.keepEmpty") : ""} />
                </Field>
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input type="checkbox" id="smtp-secure" checked={form.smtpSecure}
                  onChange={e => f("smtpSecure")(e.target.checked)} className="accent-violet-500" />
                <label htmlFor="smtp-secure" className="text-xs cursor-pointer">SSL/TLS</label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleTestSmtp} disabled={testingSmtp || !form.smtpHost}
                className="h-7 text-xs gap-1">
                {testingSmtp ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {t("settingsEmailAccounts.modal.testSmtp")}
              </Button>
              {smtpTestResult && (
                <span className={`text-xs flex items-center gap-1 ${smtpTestResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {smtpTestResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {smtpTestResult.message}
                </span>
              )}
            </div>
          </div>

          {/* Advanced */}
          <button type="button" onClick={() => setShowAdvanced(s => !s)}
            className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70">
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {t("settingsEmailAccounts.modal.advanced")}
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label={t("settingsEmailAccounts.modal.folderInbox")}>
                <Input value={form.folderInbox} onChange={e => f("folderInbox")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.folderSent")}>
                <Input value={form.folderSent} onChange={e => f("folderSent")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.folderArchive")}>
                <Input value={form.folderArchive} onChange={e => f("folderArchive")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.folderTrash")}>
                <Input value={form.folderTrash} onChange={e => f("folderTrash")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.perSync")}>
                <Input type="number" value={form.maxEmailsPerSync} onChange={e => f("maxEmailsPerSync")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label={t("settingsEmailAccounts.modal.syncInterval")}>
                <Input type="number" value={form.syncIntervalMinutes} onChange={e => f("syncIntervalMinutes")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="sync-enabled" checked={form.syncEnabled}
                  onChange={e => f("syncEnabled")(e.target.checked)} className="accent-sky-500" />
                <label htmlFor="sync-enabled" className="text-xs cursor-pointer">{t("settingsEmailAccounts.modal.autoSync")}</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is-default" checked={form.isDefault}
                  onChange={e => f("isDefault")(e.target.checked)} className="accent-sky-500" />
                <label htmlFor="is-default" className="text-xs cursor-pointer">{t("settingsEmailAccounts.modal.isDefault")}</label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t("settingsEmailAccounts.modal.cancel")}</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !form.name || !form.imapHost || !form.smtpHost}
            className="gap-1">
            {isPending && <RefreshCw className="w-3 h-3 animate-spin" />}
            {editId ? t("settingsEmailAccounts.modal.saveChanges") : t("settingsEmailAccounts.modal.createAccount")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmailAccountsSettings() {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const { data: accounts = [], isLoading } = trpc.emailAccounts.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const deleteMut = trpc.emailAccounts.delete.useMutation({
    onSuccess: () => { toast.success(t("settingsEmailAccounts.deleted")); utils.emailAccounts.list.invalidate(); setDeleteId(null); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.emailAccounts.setActive.useMutation({
    onSuccess: () => utils.emailAccounts.list.invalidate(),
    onError: e => toast.error(e.message),
  });
  const syncMut = trpc.emailAccounts.syncNow.useMutation({
    onSuccess: (data) => {
      toast.success(t("settingsEmailAccounts.syncDone", { synced: data.synced, errors: data.errors ?? 0 }));
      utils.emailAccounts.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  function toEditForm(a: any): AccountForm {
    return {
      name: a.name, email: a.email,
      imapHost: a.imapHost, imapPort: a.imapPort, imapSecure: a.imapSecure,
      imapUser: a.imapUser, imapPassword: "",
      smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure,
      smtpUser: a.smtpUser, smtpPassword: "",
      fromName: a.fromName, fromEmail: a.fromEmail,
      isDefault: a.isDefault, syncEnabled: a.syncEnabled,
      syncIntervalMinutes: a.syncIntervalMinutes,
      folderInbox: a.folderInbox, folderSent: a.folderSent,
      folderArchive: a.folderArchive, folderTrash: a.folderTrash,
      maxEmailsPerSync: a.maxEmailsPerSync,
    };
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" /> {t("settingsEmailAccounts.title")}
            </h1>
            <p className="text-sm text-foreground/50 mt-1">
              {t("settingsEmailAccounts.intro")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => syncMut.mutate({})} disabled={syncMut.isPending} className="gap-1 text-xs">
              {syncMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {t("settingsEmailAccounts.syncNow")}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1 text-xs">
              <Plus className="w-3 h-3" /> {t("settingsEmailAccounts.newAccount")}
            </Button>
          </div>
        </div>

        {/* Accounts list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-4 h-4 animate-spin text-foreground/30" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border/40 rounded-xl">
            <Mail className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-foreground/40">{t("settingsEmailAccounts.empty")}</p>
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4 gap-1">
              <Plus className="w-3 h-3" /> {t("settingsEmailAccounts.addFirst")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map(account => (
              <div key={account.id}
                className="rounded-xl border border-border/40 bg-card p-4 flex items-center gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-sky-400" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{account.name}</p>
                    {account.isDefault && (
                      <span className="text-[10px] bg-sky-500/15 text-sky-400 px-1.5 py-0.5 rounded-full">
                        {t("settingsEmailAccounts.isDefaultBadge")}
                      </span>
                    )}
                    {!account.isActive && (
                      <span className="text-[10px] bg-foreground/10 text-foreground/40 px-1.5 py-0.5 rounded-full">
                        {t("settingsEmailAccounts.inactive")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground/50 truncate">{account.email}</p>
                  <div className="flex gap-3 mt-1 text-[10px] text-foreground/30">
                    <span>IMAP: {account.imapHost}:{account.imapPort}</span>
                    <span>SMTP: {account.smtpHost}:{account.smtpPort}</span>
                    {account.lastSyncAt && (
                      <span>{t("settingsEmailAccounts.lastSync", { date: format.dateTime(account.lastSyncAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</span>
                    )}
                  </div>
                  {account.lastSyncError && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">⚠ {account.lastSyncError}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={account.isActive}
                      onChange={e => setActiveMut.mutate({ id: account.id, isActive: e.target.checked })}
                      className="accent-sky-500" />
                    <span className="text-xs text-foreground/50">{t("settingsEmailAccounts.active")}</span>
                  </label>
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => setEditAccount(account)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-red-400"
                    onClick={() => setDeleteId(account.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <AccountModal open onClose={() => setShowCreate(false)} />
        )}

        {/* Edit modal */}
        {editAccount && (
          <AccountModal
            open
            onClose={() => setEditAccount(null)}
            initial={toEditForm(editAccount)}
            editId={editAccount.id}
          />
        )}

        {/* Delete confirm */}
        <Dialog open={deleteId !== null} onOpenChange={v => { if (!v) setDeleteId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t("settingsEmailAccounts.deleteTitle")}</DialogTitle></DialogHeader>
            <p className="text-sm text-foreground/70">
              {t("settingsEmailAccounts.deleteText")}
            </p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>{t("settingsEmailAccounts.cancel")}</Button>
              <Button size="sm" variant="destructive"
                onClick={() => deleteId && deleteMut.mutate({ id: deleteId })}
                disabled={deleteMut.isPending}>
                {t("settingsEmailAccounts.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
