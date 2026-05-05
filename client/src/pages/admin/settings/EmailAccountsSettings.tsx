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
  const utils = trpc.useUtils();
  const [form, setForm] = useState<AccountForm>(initial ?? EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingImap, setTestingImap] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  const f = (k: keyof AccountForm) => (v: any) => setForm(p => ({ ...p, [k]: v }));

  const createMut = trpc.emailAccounts.create.useMutation({
    onSuccess: () => { toast.success("Cuenta creada"); utils.emailAccounts.list.invalidate(); onClose(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.emailAccounts.update.useMutation({
    onSuccess: () => { toast.success("Cuenta actualizada"); utils.emailAccounts.list.invalidate(); onClose(); },
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
          <DialogTitle>{editId ? "Editar cuenta de email" : "Nueva cuenta de email"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* General */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre de la cuenta *">
              <Input value={form.name} onChange={e => f("name")(e.target.value)} className="h-8 text-xs" placeholder="Ej: Administración" />
            </Field>
            <Field label="Email de la cuenta *">
              <Input value={form.email} onChange={e => f("email")(e.target.value)} className="h-8 text-xs" placeholder="info@empresa.es" />
            </Field>
            <Field label="Nombre remitente *">
              <Input value={form.fromName} onChange={e => f("fromName")(e.target.value)} className="h-8 text-xs" placeholder="Nayade Experiences" />
            </Field>
            <Field label="Email remitente *">
              <Input value={form.fromEmail} onChange={e => f("fromEmail")(e.target.value)} className="h-8 text-xs" placeholder="info@nayadeexperiences.es" />
            </Field>
          </div>

          {/* IMAP */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wider">Recepción (IMAP)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Servidor IMAP *">
                  <Input value={form.imapHost} onChange={e => f("imapHost")(e.target.value)} className="h-8 text-xs font-mono" placeholder="imap.empresa.es" />
                </Field>
              </div>
              <Field label="Puerto">
                <Input type="number" value={form.imapPort} onChange={e => f("imapPort")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label="Usuario IMAP *">
                <Input value={form.imapUser} onChange={e => f("imapUser")(e.target.value)} className="h-8 text-xs" placeholder="usuario@empresa.es" />
              </Field>
              <div className="col-span-2">
                <Field label="Contraseña IMAP *">
                  <PasswordInput value={form.imapPassword} onChange={f("imapPassword")} placeholder={editId ? "Dejar vacío para mantener" : ""} />
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
                Probar IMAP
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
              <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Envío (SMTP)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Servidor SMTP *">
                  <Input value={form.smtpHost} onChange={e => f("smtpHost")(e.target.value)} className="h-8 text-xs font-mono" placeholder="smtp.empresa.es" />
                </Field>
              </div>
              <Field label="Puerto">
                <Input type="number" value={form.smtpPort} onChange={e => f("smtpPort")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label="Usuario SMTP *">
                <Input value={form.smtpUser} onChange={e => f("smtpUser")(e.target.value)} className="h-8 text-xs" placeholder="usuario@empresa.es" />
              </Field>
              <div className="col-span-2">
                <Field label="Contraseña SMTP *">
                  <PasswordInput value={form.smtpPassword} onChange={f("smtpPassword")} placeholder={editId ? "Dejar vacío para mantener" : ""} />
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
                Probar SMTP
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
            Configuración avanzada
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Carpeta Recibidos">
                <Input value={form.folderInbox} onChange={e => f("folderInbox")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label="Carpeta Enviados">
                <Input value={form.folderSent} onChange={e => f("folderSent")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label="Carpeta Archivo">
                <Input value={form.folderArchive} onChange={e => f("folderArchive")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label="Carpeta Papelera">
                <Input value={form.folderTrash} onChange={e => f("folderTrash")(e.target.value)} className="h-8 text-xs font-mono" />
              </Field>
              <Field label="Emails por sync">
                <Input type="number" value={form.maxEmailsPerSync} onChange={e => f("maxEmailsPerSync")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <Field label="Intervalo sync (min)">
                <Input type="number" value={form.syncIntervalMinutes} onChange={e => f("syncIntervalMinutes")(Number(e.target.value))} className="h-8 text-xs" />
              </Field>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="sync-enabled" checked={form.syncEnabled}
                  onChange={e => f("syncEnabled")(e.target.checked)} className="accent-sky-500" />
                <label htmlFor="sync-enabled" className="text-xs cursor-pointer">Sincronización automática</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is-default" checked={form.isDefault}
                  onChange={e => f("isDefault")(e.target.checked)} className="accent-sky-500" />
                <label htmlFor="is-default" className="text-xs cursor-pointer">Cuenta por defecto</label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !form.name || !form.imapHost || !form.smtpHost}
            className="gap-1">
            {isPending && <RefreshCw className="w-3 h-3 animate-spin" />}
            {editId ? "Guardar cambios" : "Crear cuenta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmailAccountsSettings() {
  const utils = trpc.useUtils();
  const { data: accounts = [], isLoading } = trpc.emailAccounts.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const deleteMut = trpc.emailAccounts.delete.useMutation({
    onSuccess: () => { toast.success("Cuenta eliminada"); utils.emailAccounts.list.invalidate(); setDeleteId(null); },
    onError: e => toast.error(e.message),
  });
  const setActiveMut = trpc.emailAccounts.setActive.useMutation({
    onSuccess: () => utils.emailAccounts.list.invalidate(),
    onError: e => toast.error(e.message),
  });
  const syncMut = trpc.emailAccounts.syncNow.useMutation({
    onSuccess: (data) => {
      toast.success(`Sync completado — ${data.synced} emails nuevos${data.errors ? `, ${data.errors} errores` : ""}`);
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
              <Mail className="w-5 h-5 text-sky-400" /> Cuentas de Email Comercial
            </h1>
            <p className="text-sm text-foreground/50 mt-1">
              Gestiona las cuentas IMAP/SMTP para la bandeja de email integrada en Atención Comercial.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => syncMut.mutate({})} disabled={syncMut.isPending} className="gap-1 text-xs">
              {syncMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Sincronizar ahora
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1 text-xs">
              <Plus className="w-3 h-3" /> Nueva cuenta
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
            <p className="text-sm text-foreground/40">No hay cuentas de email configuradas</p>
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-4 gap-1">
              <Plus className="w-3 h-3" /> Añadir primera cuenta
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
                        Por defecto
                      </span>
                    )}
                    {!account.isActive && (
                      <span className="text-[10px] bg-foreground/10 text-foreground/40 px-1.5 py-0.5 rounded-full">
                        Inactiva
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground/50 truncate">{account.email}</p>
                  <div className="flex gap-3 mt-1 text-[10px] text-foreground/30">
                    <span>IMAP: {account.imapHost}:{account.imapPort}</span>
                    <span>SMTP: {account.smtpHost}:{account.smtpPort}</span>
                    {account.lastSyncAt && (
                      <span>Último sync: {new Date(account.lastSyncAt).toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</span>
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
                    <span className="text-xs text-foreground/50">Activa</span>
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
            <DialogHeader><DialogTitle>Eliminar cuenta</DialogTitle></DialogHeader>
            <p className="text-sm text-foreground/70">
              ¿Eliminar esta cuenta? Los emails ya sincronizados se conservarán en la base de datos.
            </p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Cancelar</Button>
              <Button size="sm" variant="destructive"
                onClick={() => deleteId && deleteMut.mutate({ id: deleteId })}
                disabled={deleteMut.isPending}>
                Eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
