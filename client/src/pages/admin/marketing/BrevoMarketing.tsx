/**
 * Elephant Connect · Email marketing con Brevo (/admin/marketing/brevo): la empresa conecta SU cuenta de Brevo (la
 * clave se guarda en Ajustes → Integraciones), elige una lista y sincroniza los clientes del CRM que han dado su
 * consentimiento. Aquí se registra ese consentimiento (con su prueba), se ven las ejecuciones y se desconecta.
 * La autorización real (licencia `email-campaigns` y administración) la aplica el servidor.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Mail, RefreshCw, Search, Unplug } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";

const SOURCES: Record<string, string> = {
  form: "Formulario",
  in_person: "En persona (firmado)",
  import: "Importación con prueba de consentimiento",
  phone: "Teléfono (grabado)",
  other: "Otro",
};
const RUN_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "En curso", variant: "secondary" },
  completed: { label: "Completada", variant: "default" },
  partial: { label: "Parcial", variant: "outline" },
  failed: { label: "Fallida", variant: "destructive" },
};
const TRIGGER: Record<string, string> = { manual: "Manual", job: "Automática", retry: "Reintento" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES") : "—");
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Connection() {
  const utils = trpc.useUtils();
  const status = trpc.brevoMarketing.status.useQuery(undefined, { retry: false });
  const connected = !!status.data?.connected;
  const lists = trpc.brevoMarketing.lists.useQuery(undefined, { enabled: connected, retry: false });
  const [listId, setListId] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => utils.brevoMarketing.invalidate();
  const test = trpc.brevoMarketing.testConnection.useMutation({ onSuccess: (r) => toast.success(`Conexión correcta${r.account ? ` con ${r.account}` : ""}`), onError: (e) => toastError(e) });
  const choose = trpc.brevoMarketing.chooseList.useMutation({ onSuccess: (s) => (toast.success(`Lista elegida: ${s.listName}`), refresh()), onError: (e) => toastError(e) });
  const auto = trpc.brevoMarketing.setAutoSync.useMutation({ onSuccess: (s) => (toast.success(s.autoSync ? "Sincronización automática activada" : "Sincronización automática desactivada"), refresh()), onError: (e) => toastError(e) });
  const disconnect = trpc.brevoMarketing.disconnect.useMutation({ onSuccess: () => (toast.success("Cuenta de Brevo desconectada"), refresh()), onError: (e) => toastError(e) });

  if (status.isLoading) return <PanelLoading />;
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data!;
  if (!connected)
    return (
      <PanelEmpty icon={<Mail className="h-5 w-5" />} title="Conecta tu cuenta de Brevo" description="Pega la clave API de tu cuenta de Brevo en Ajustes → Integraciones y pulsa «Probar conexión». Después vuelve aquí para elegir la lista.">
        <Button asChild>
          <Link href="/admin/configuracion/integraciones">Ir a Integraciones</Link>
        </Button>
      </PanelEmpty>
    );
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Cuenta de Brevo conectada
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            Probar conexión
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmOff(true)}>
            <Unplug className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Desconectar
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Lista de Brevo {s.listName && <Badge variant="outline">Actual: {s.listName}</Badge>}</span>
          <select className={selectClass} value={listId || String(s.listId ?? "")} onChange={(e) => setListId(e.target.value)} disabled={lists.isLoading}>
            <option value="">{lists.isLoading ? "Cargando listas…" : "Elige una lista"}</option>
            {(lists.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.subscribers != null ? ` (${l.subscribers})` : ""}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!listId || choose.isPending} onClick={() => choose.mutate({ listId: Number(listId) })}>
          Usar esta lista
        </Button>
      </div>
      {lists.error && <p className="text-sm text-destructive">No se han podido leer las listas de Brevo. Comprueba la clave en Integraciones.</p>}
      <label className="flex flex-wrap items-center gap-3 text-sm text-foreground">
        <Switch checked={s.autoSync} disabled={!s.listId || auto.isPending} onCheckedChange={(on) => auto.mutate({ on })} aria-label="Sincronización automática" />
        Sincronización automática (cada hora)
      </label>
      <p className="text-xs text-muted-foreground">
        Consentimientos registrados: {s.consents.granted} concedidos · {s.consents.withdrawn} retirados. Solo se envían a Brevo los concedidos; las bajas de la lista de Brevo retiran el consentimiento aquí.
      </p>
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar tu cuenta de Brevo?</AlertDialogTitle>
            <AlertDialogDescription>Se borra la clave guardada y se apaga la sincronización. Los contactos que ya están en tu lista de Brevo no se tocan; los consentimientos y el historial se conservan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => disconnect.mutate()}>Desconectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Runs() {
  const utils = trpc.useUtils();
  const status = trpc.brevoMarketing.status.useQuery(undefined, { retry: false });
  const runs = trpc.brevoMarketing.runs.useQuery(undefined, { enabled: !!status.data?.connected });
  const preview = trpc.brevoMarketing.preview.useQuery(undefined, { enabled: !!status.data?.listId });
  const done = (r: { status: string; exported: number; removed: number; unsubscribed: number }) => {
    const msg = `${RUN_STATUS[r.status]?.label ?? r.status}: ${r.exported} enviados, ${r.removed} quitados de la lista, ${r.unsubscribed} bajas`;
    if (r.status === "failed") toast.error(msg);
    else toast.success(msg);
    utils.brevoMarketing.invalidate();
  };
  const sync = trpc.brevoMarketing.sync.useMutation({ onSuccess: done, onError: (e) => toastError(e) });
  const retry = trpc.brevoMarketing.retry.useMutation({ onSuccess: done, onError: (e) => toastError(e) });
  if (!status.data?.connected || !status.data.listId) return null;
  const last = runs.data?.[0];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Sincronización</h2>
        <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Sincronizar ahora
        </Button>
      </div>
      {preview.data && (
        <p className="text-xs text-muted-foreground">
          Próxima ejecución: {preview.data.toExport} por enviar · {preview.data.toRemove} por quitar de la lista
          {preview.data.skipped ? ` · ${preview.data.skipped} sin correo válido o repetidos` : ""}
          {preview.data.truncated ? " · hay más de los que caben en una ejecución" : ""}
        </p>
      )}
      {runs.isLoading ? (
        <PanelLoading />
      ) : runs.error ? (
        <PanelError error={runs.error} onRetry={() => runs.refetch()} />
      ) : !runs.data!.length ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ejecuciones. Registra el consentimiento de tus clientes y sincroniza.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {runs.data!.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0">
                <span className="block text-foreground">
                  #{r.id} · {TRIGGER[r.trigger]} · {fmt(r.startedAt)}
                </span>
                <span className="block break-words text-xs text-muted-foreground">
                  {r.exported} enviados · {r.removed} quitados · {r.unsubscribed} bajas · {r.errors} errores · {r.apiCalls} llamadas{r.errorMessage ? ` · ${r.errorMessage}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={RUN_STATUS[r.status].variant}>{RUN_STATUS[r.status].label}</Badge>
                {last?.id === r.id && (r.status === "failed" || r.status === "partial") && (
                  <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ runId: r.id })}>
                    Reintentar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ClientRow = { clientId: number; name: string; email: string; consent: "granted" | "withdrawn" | null; consentSource: string | null; consentAt: string | null; syncStatus: string | null; lastError: string | null };

function Consents() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const list = trpc.brevoMarketing.clients.useQuery({ q: search });
  const [grantFor, setGrantFor] = useState<ClientRow | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<ClientRow | null>(null);
  const [source, setSource] = useState("form");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => utils.brevoMarketing.invalidate();
  const grant = trpc.brevoMarketing.grantConsent.useMutation({ onSuccess: () => (toast.success("Consentimiento registrado"), setGrantFor(null), setEvidence(""), refresh()), onError: (e) => toastError(e) });
  const withdraw = trpc.brevoMarketing.withdrawConsent.useMutation({ onSuccess: () => (toast.success("Consentimiento retirado"), setWithdrawFor(null), setReason(""), refresh()), onError: (e) => toastError(e) });
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Consentimiento de marketing de tus clientes</h2>
      <p className="text-xs text-muted-foreground">Sin consentimiento registrado, un cliente nunca se envía a Brevo. Al concederlo indica cómo lo dio y su prueba (texto aceptado, formulario, documento firmado…).</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
        }}
      >
        <Input aria-label="Buscar cliente" placeholder="Nombre o correo" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline">
          <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Buscar
        </Button>
      </form>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data!.length ? (
        <p className="text-sm text-muted-foreground">No hay clientes que coincidan.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {(list.data as ClientRow[]).map((c) => (
            <li key={c.clientId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0">
                <span className="block break-words text-foreground">{c.name}</span>
                <span className="block break-all text-xs text-muted-foreground">
                  {c.email}
                  {c.consent ? ` · ${c.consent === "granted" ? "concedido" : "retirado"} el ${fmt(c.consentAt)}` : ""}
                  {c.syncStatus === "error" && c.lastError ? ` · error en Brevo: ${c.lastError}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {c.consent === "granted" ? <Badge>Con consentimiento</Badge> : c.consent === "withdrawn" ? <Badge variant="secondary">Baja</Badge> : <Badge variant="outline">Sin consentimiento</Badge>}
                {c.consent === "granted" ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Enlace público para que el cliente se dé de baja (pie de las campañas)"
                      onClick={() =>
                        utils.brevoMarketing.unsubscribeLink
                          .fetch({ clientId: c.clientId })
                          .then((r) => navigator.clipboard?.writeText(r.url))
                          .then(() => toast.success("Enlace de baja copiado"), (e) => toastError(e))
                      }
                    >
                      Enlace de baja
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawFor(c)}>
                      Retirar
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setGrantFor(c)}>
                    Registrar consentimiento
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!grantFor} onOpenChange={(o) => !o && setGrantFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Consentimiento de {grantFor?.name}</DialogTitle>
            <DialogDescription>Queda en el historial con la fecha, quién lo registra y su prueba.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (grantFor) grant.mutate({ clientId: grantFor.clientId, source: source as "form", evidence });
            }}
          >
            <label className="block space-y-1.5 text-sm font-medium text-foreground">
              <span>Cómo lo dio</span>
              <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
                {Object.entries(SOURCES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium text-foreground">
              <span>Prueba del consentimiento *</span>
              <Textarea rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} placeholder="Ej.: casilla «Quiero recibir novedades» del formulario de reserva, versión del texto 2026-11" required />
            </label>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setGrantFor(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={evidence.trim().length < 5 || grant.isPending}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!withdrawFor} onOpenChange={(o) => !o && setWithdrawFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retirar el consentimiento de {withdrawFor?.name}</DialogTitle>
            <DialogDescription>En la próxima sincronización sale de tu lista de Brevo.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Motivo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Motivo (opcional)" />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWithdrawFor(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={withdraw.isPending} onClick={() => withdrawFor && withdraw.mutate({ clientId: withdrawFor.clientId, reason })}>
              Retirar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function BrevoMarketing() {
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Email marketing con Brevo</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Envía tus campañas desde tu propia cuenta de Brevo a los clientes que han aceptado recibirlas. Las bajas que se produzcan en Brevo se respetan aquí.</p>
        </header>
        <Connection />
        <Runs />
        <Consents />
      </div>
    </AdminLayout>
  );
}
