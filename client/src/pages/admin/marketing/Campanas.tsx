/**
 * Elephant Connect · Campaigns (/admin/marketing/campanas): campañas de correo redactadas aquí y enviadas con la cuenta
 * de Brevo PROPIA de la empresa (la misma que sincroniza los clientes en /admin/marketing/brevo). Nombre, asunto,
 * remitente verificado en Brevo, contenido por bloques con la marca de la empresa, segmento por etiquetas del CRM (solo
 * clientes con consentimiento de marketing), vista previa, prueba a un buzón, envío o programación y estadísticas.
 * La autorización real (licencia `email-campaigns` y administración) la aplica el servidor.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, Copy, Eye, Mail, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { CAMPAIGN_STATUS_LABEL, type CampaignBlock, type CampaignStatus } from "@shared/connectCampaigns";

const STATUS_VARIANT: Record<CampaignStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  preparing: "secondary",
  scheduled: "secondary",
  sent: "default",
  failed: "destructive",
};
const BLOCK_LABEL: Record<CampaignBlock["type"], string> = { heading: "Título", text: "Texto", button: "Botón", image: "Imagen", divider: "Separador" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-ES") : "—");
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fieldClass = "block space-y-1.5 text-sm font-medium text-foreground";

interface Draft {
  name: string;
  subject: string;
  previewText: string;
  senderId: number | null;
  replyTo: string;
  blocks: CampaignBlock[];
  tagIds: number[];
  tagMode: "any" | "all";
}
const EMPTY: Draft = { name: "", subject: "", previewText: "", senderId: null, replyTo: "", blocks: [{ type: "heading", text: "" }, { type: "text", text: "" }], tagIds: [], tagMode: "any" };
const newBlock = (type: CampaignBlock["type"]): CampaignBlock =>
  type === "heading" || type === "text" ? { type, text: "" } : type === "button" ? { type, label: "", url: "https://" } : type === "image" ? { type, url: "https://", alt: "" } : { type };

function BlockEditor({ blocks, onChange }: { blocks: CampaignBlock[]; onChange: (b: CampaignBlock[]) => void }) {
  const set = (i: number, b: CampaignBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: -1 | 1) => {
    const n = [...blocks];
    const [b] = n.splice(i, 1);
    n.splice(i + d, 0, b);
    onChange(n);
  };
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{BLOCK_LABEL[b.type]}</span>
            <span className="flex gap-1">
              <Button type="button" size="icon" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Bajar" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Quitar" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </span>
          </div>
          {b.type === "heading" && <Input aria-label="Título" maxLength={200} value={b.text} onChange={(e) => set(i, { ...b, text: e.target.value })} />}
          {b.type === "text" && <Textarea aria-label="Texto" rows={4} maxLength={5000} value={b.text} onChange={(e) => set(i, { ...b, text: e.target.value })} placeholder="Deja una línea en blanco para separar párrafos" />}
          {b.type === "button" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Texto del botón" maxLength={80} placeholder="Texto del botón" value={b.label} onChange={(e) => set(i, { ...b, label: e.target.value })} />
              <Input aria-label="Enlace del botón" maxLength={1000} placeholder="https://" value={b.url} onChange={(e) => set(i, { ...b, url: e.target.value })} />
            </div>
          )}
          {b.type === "image" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Dirección de la imagen" maxLength={1000} placeholder="https://…/imagen.jpg" value={b.url} onChange={(e) => set(i, { ...b, url: e.target.value })} />
              <Input aria-label="Texto alternativo" maxLength={200} placeholder="Descripción de la imagen" value={b.alt} onChange={(e) => set(i, { ...b, alt: e.target.value })} />
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(BLOCK_LABEL) as CampaignBlock["type"][]).map((t) => (
          <Button key={t} type="button" size="sm" variant="outline" disabled={blocks.length >= 40} onClick={() => onChange([...blocks, newBlock(t)])}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {BLOCK_LABEL[t]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Editor({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const utils = trpc.useUtils();
  const existing = trpc.brevoMarketing.campaigns.get.useQuery({ id: id ?? 0 }, { enabled: !!id });
  const senders = trpc.brevoMarketing.campaigns.senders.useQuery(undefined, { retry: false });
  const tags = trpc.brevoMarketing.campaigns.tags.useQuery();
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    const c = existing.data;
    if (c && !loaded) {
      setD({ name: c.name, subject: c.subject, previewText: c.previewText ?? "", senderId: c.senderId, replyTo: c.replyTo ?? "", blocks: c.blocks, tagIds: c.tagIds, tagMode: c.tagMode });
      setLoaded(true);
    }
  }, [existing.data, loaded]);
  const audience = trpc.brevoMarketing.campaigns.audience.useQuery({ tagIds: d.tagIds, tagMode: d.tagMode });
  const payload = { ...d, previewText: d.previewText || null, replyTo: d.replyTo || null };
  const done = (c: { id: number } | null | undefined) => {
    toast.success("Campaña guardada");
    utils.brevoMarketing.campaigns.invalidate();
    if (c) onSaved(c.id);
  };
  const create = trpc.brevoMarketing.campaigns.create.useMutation({ onSuccess: done, onError: (e) => toastError(e) });
  const update = trpc.brevoMarketing.campaigns.update.useMutation({ onSuccess: done, onError: (e) => toastError(e) });
  if (id && !loaded) return <PanelLoading />;
  const save = () => (id ? update.mutate({ id, ...payload }) : create.mutate(payload));
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{id ? "Editar borrador" : "Nueva campaña"}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldClass}>
          <span>Nombre interno *</span>
          <Input maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ej.: Novedades de otoño" />
        </label>
        <label className={fieldClass}>
          <span>Asunto *</span>
          <Input maxLength={200} value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
        </label>
        <label className={fieldClass}>
          <span>Texto de vista previa</span>
          <Input maxLength={200} value={d.previewText} onChange={(e) => setD({ ...d, previewText: e.target.value })} placeholder="Lo que se ve junto al asunto en la bandeja" />
        </label>
        <label className={fieldClass}>
          <span>Remitente * (verificado en tu cuenta de Brevo)</span>
          <select className={selectClass} value={d.senderId ?? ""} onChange={(e) => setD({ ...d, senderId: e.target.value ? Number(e.target.value) : null })} disabled={senders.isLoading}>
            <option value="">{senders.isLoading ? "Cargando remitentes…" : "Elige un remitente"}</option>
            {(senders.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} &lt;{s.email}&gt;
              </option>
            ))}
          </select>
          {senders.error && <span className="text-xs font-normal text-destructive">No se han podido leer los remitentes de Brevo.</span>}
          {senders.data && !senders.data.length && <span className="text-xs font-normal text-muted-foreground">Tu cuenta de Brevo no tiene remitentes verificados: añádelos en Brevo (Remitentes y dominios).</span>}
        </label>
        <label className={fieldClass}>
          <span>Responder a (opcional)</span>
          <Input type="email" maxLength={190} value={d.replyTo} onChange={(e) => setD({ ...d, replyTo: e.target.value })} />
        </label>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium text-foreground">Destinatarios</legend>
        <p className="text-xs text-muted-foreground">Solo reciben la campaña los clientes con el consentimiento de marketing concedido. Sin etiquetas: todos ellos.</p>
        {tags.data && !tags.data.length && <p className="text-xs text-muted-foreground">Aún no hay etiquetas en el CRM.</p>}
        <div className="flex flex-wrap gap-2">
          {(tags.data ?? []).map((t) => {
            const on = d.tagIds.includes(t.id);
            return (
              <label key={t.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                <input type="checkbox" checked={on} onChange={() => setD({ ...d, tagIds: on ? d.tagIds.filter((x) => x !== t.id) : [...d.tagIds, t.id] })} />
                {t.name} <span className="text-xs text-muted-foreground">({t.consenting})</span>
              </label>
            );
          })}
        </div>
        {d.tagIds.length > 1 && (
          <select className={selectClass} aria-label="Cómo combinar las etiquetas" value={d.tagMode} onChange={(e) => setD({ ...d, tagMode: e.target.value as "any" | "all" })}>
            <option value="any">Con cualquiera de las etiquetas</option>
            <option value="all">Con todas las etiquetas</option>
          </select>
        )}
        {audience.data && (
          <p className="text-sm text-foreground">
            Recibirían la campaña: <strong>{audience.data.recipients}</strong>
            {audience.data.withdrawn ? ` · ${audience.data.withdrawn} excluidos por baja` : ""}
            {audience.data.skipped ? ` · ${audience.data.skipped} sin correo válido o repetido` : ""}
            {audience.data.tooMany && <span className="text-destructive"> · supera el máximo de {audience.data.max} por campaña</span>}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Contenido</legend>
        <p className="text-xs text-muted-foreground">Se envía con la cabecera, los colores y el pie de tu empresa. El enlace de baja se añade siempre al final.</p>
        <BlockEditor blocks={d.blocks} onChange={(blocks) => setD({ ...d, blocks })} />
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={!d.name.trim() || create.isPending || update.isPending} onClick={save}>
          Guardar borrador
        </Button>
      </div>
    </section>
  );
}

function Detail({ id, onEdit, onClose }: { id: number; onEdit: () => void; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.brevoMarketing.campaigns.get.useQuery({ id });
  const [preview, setPreview] = useState(false);
  const html = trpc.brevoMarketing.campaigns.preview.useQuery({ id }, { enabled: preview });
  const [testTo, setTestTo] = useState("");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [at, setAt] = useState("");
  const [confirm, setConfirm] = useState(false);
  const refresh = () => utils.brevoMarketing.campaigns.invalidate();
  const test = trpc.brevoMarketing.campaigns.sendTest.useMutation({ onSuccess: () => toast.success("Prueba enviada"), onError: (e) => toastError(e) });
  const launch = trpc.brevoMarketing.campaigns.launch.useMutation({
    onSuccess: (c) => {
      if (c?.status === "failed") toast.error(c.errorMessage ?? "No se pudo enviar");
      else toast.success(c?.status === "preparing" ? "Brevo está preparando la lista: pulsa «Actualizar» en unos minutos" : c?.status === "scheduled" ? "Campaña programada" : "Campaña enviada");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const upd = trpc.brevoMarketing.campaigns.refresh.useMutation({ onSuccess: () => (toast.success("Actualizada con los datos de Brevo"), refresh()), onError: (e) => toastError(e) });
  const dup = trpc.brevoMarketing.campaigns.duplicate.useMutation({ onSuccess: () => (toast.success("Copia creada como borrador"), refresh(), onClose()), onError: (e) => toastError(e) });
  const audience = trpc.brevoMarketing.campaigns.audience.useQuery({ tagIds: q.data?.tagIds ?? [], tagMode: q.data?.tagMode ?? "any" }, { enabled: !!q.data && (q.data.status === "draft" || q.data.status === "failed") });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const editable = c.status === "draft";
  const canSend = (c.status === "draft" || c.status === "failed") && !c.sendClaimedAt;
  const scheduledIso = mode === "schedule" && at ? new Date(at).toISOString() : null;
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 className="break-words text-base font-semibold text-foreground">{c.name}</h2>
          <p className="break-words text-sm text-muted-foreground">
            {c.subject || "Sin asunto"} · {c.senderEmail ?? "sin remitente"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={STATUS_VARIANT[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
      {c.errorMessage && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{c.errorMessage}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
          <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Vista previa
        </Button>
        {editable && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            Editar
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={dup.isPending} onClick={() => dup.mutate({ id })}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Duplicar
        </Button>
        {(c.status === "preparing" || c.status === "scheduled" || c.status === "sent") && (
          <Button size="sm" variant="outline" disabled={upd.isPending} onClick={() => upd.mutate({ id })}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Actualizar
          </Button>
        )}
      </div>

      {canSend && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="space-y-2 rounded-lg border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              test.mutate({ id, email: testTo });
            }}
          >
            <p className="text-sm font-medium text-foreground">Envío de prueba</p>
            <p className="text-xs text-muted-foreground">Brevo solo envía pruebas a contactos de tu cuenta (máximo 50 al día). En la prueba el enlace de baja no lleva a ningún sitio.</p>
            <div className="flex gap-2">
              <Input type="email" aria-label="Correo de prueba" placeholder="tu@empresa.es" value={testTo} onChange={(e) => setTestTo(e.target.value)} required />
              <Button type="submit" variant="outline" disabled={test.isPending}>
                Enviar prueba
              </Button>
            </div>
          </form>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">Envío</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "now"} onChange={() => setMode("now")} /> Enviar ahora
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={mode === "schedule"} onChange={() => setMode("schedule")} /> Programar
              </label>
            </div>
            {mode === "schedule" && <Input type="datetime-local" aria-label="Fecha y hora de envío" value={at} onChange={(e) => setAt(e.target.value)} />}
            <p className="text-xs text-muted-foreground">Destinatarios ahora: {audience.data?.recipients ?? "…"} (solo con consentimiento de marketing).</p>
            <Button disabled={launch.isPending || (mode === "schedule" && !at) || !audience.data?.recipients} onClick={() => setConfirm(true)}>
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {mode === "now" ? "Enviar campaña" : "Programar campaña"}
            </Button>
          </div>
        </div>
      )}

      {(c.status === "preparing" || c.status === "scheduled" || c.status === "sent") && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Destinatarios</dt>
            <dd className="font-medium text-foreground">{c.recipients}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{c.status === "sent" ? "Enviada" : "Programada"}</dt>
            <dd className="font-medium text-foreground">{fmt(c.sentAt ?? c.scheduledAt)}</dd>
          </div>
          {c.stats && (
            <>
              <div>
                <dt className="text-muted-foreground">Entregados</dt>
                <dd className="font-medium text-foreground">
                  {c.stats.delivered} de {c.stats.sent}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Aperturas únicas</dt>
                <dd className="font-medium text-foreground">{c.stats.opens}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Clics únicos</dt>
                <dd className="font-medium text-foreground">{c.stats.clicks}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bajas</dt>
                <dd className="font-medium text-foreground">{c.stats.unsubscribed}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rebotes</dt>
                <dd className="font-medium text-foreground">{c.stats.bounces}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Quejas</dt>
                <dd className="font-medium text-foreground">{c.stats.complaints}</dd>
              </div>
            </>
          )}
          <p className="col-span-full text-xs text-muted-foreground">Estadísticas de Brevo: {c.statsAt ? `leídas el ${fmt(c.statsAt)}` : "aún no leídas"}.</p>
        </dl>
      )}

      {c.events.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Historial</summary>
          <ul className="mt-2 space-y-1">
            {c.events.map((e, i) => (
              <li key={i} className="break-words text-xs text-muted-foreground">
                {fmt(e.createdAt)} · {e.kind}
                {e.detail ? ` · ${e.detail}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vista previa</DialogTitle>
            <DialogDescription>{html.data ? `Asunto: ${html.data.subject || "(sin asunto)"}` : "Cargando…"}</DialogDescription>
          </DialogHeader>
          {html.data && <iframe title="Vista previa de la campaña" sandbox="" srcDoc={html.data.html} className="h-[70vh] w-full rounded-md border border-border bg-white" />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mode === "now" ? "¿Enviar la campaña ahora?" : "¿Programar la campaña?"}</AlertDialogTitle>
            <AlertDialogDescription>
              Se enviará desde tu cuenta de Brevo a {audience.data?.recipients ?? 0} clientes con consentimiento de marketing{scheduledIso ? ` el ${fmt(scheduledIso)}` : ""}. Una vez pedida a Brevo no se puede enviar otra vez: para repetirla, duplícala.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => launch.mutate({ id, scheduledAt: scheduledIso })}>{mode === "now" ? "Enviar" : "Programar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Campaigns() {
  const status = trpc.brevoMarketing.campaigns.status.useQuery(undefined, { retry: false });
  const list = trpc.brevoMarketing.campaigns.list.useQuery(undefined, { enabled: !!status.data?.connected });
  const [view, setView] = useState<{ kind: "new" } | { kind: "edit"; id: number } | { kind: "detail"; id: number } | null>(null);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  if (status.isLoading) return <PanelLoading />;
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
  if (!status.data?.connected)
    return (
      <PanelEmpty icon={<Mail className="h-5 w-5" />} title="Conecta la cuenta de Brevo de tu empresa" description="Las campañas se envían con tu propia cuenta de Brevo. Pega su clave API en Ajustes → Integraciones (Brevo · email marketing) y pulsa «Probar conexión»; después registra los consentimientos de tus clientes.">
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/admin/configuracion/integraciones">Ir a Integraciones</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/marketing/brevo">Consentimientos y sincronización</Link>
          </Button>
        </div>
      </PanelEmpty>
    );
  return (
    <div className="space-y-4">
      {view?.kind === "new" && <Editor id={null} onClose={() => setView(null)} onSaved={(id) => setView({ kind: "detail", id })} />}
      {view?.kind === "edit" && <Editor id={view.id} onClose={() => setView({ kind: "detail", id: view.id })} onSaved={(id) => setView({ kind: "detail", id })} />}
      {view?.kind === "detail" && <Detail id={view.id} onEdit={() => setView({ kind: "edit", id: view.id })} onClose={() => setView(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Campañas</h2>
        <Button size="sm" onClick={() => setView({ kind: "new" })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Nueva campaña
        </Button>
      </div>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : !rows.length ? (
        <PanelEmpty icon={<Send className="h-5 w-5" />} title="Aún no hay campañas" description="Crea la primera: redáctala con bloques, elige a quién va y envíate una prueba antes de mandarla." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted/50" onClick={() => setView({ kind: "detail", id: c.id })}>
                <span className="min-w-0 space-y-0.5">
                  <span className="block break-words text-sm font-medium text-foreground">{c.name}</span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {c.subject || "Sin asunto"}
                    {c.status === "sent" ? ` · enviada ${fmt(c.sentAt)}` : c.status === "scheduled" ? ` · programada ${fmt(c.scheduledAt)}` : ""}
                    {c.stats ? ` · ${c.stats.opens} aperturas · ${c.stats.clicks} clics` : ""}
                  </span>
                </span>
                <Badge variant={STATUS_VARIANT[c.status]}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Campanas() {
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect · Campaigns</p>
          <h1 className="text-2xl font-bold text-foreground">Campañas de correo</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Redacta campañas con la marca de tu empresa y envíalas desde tu propia cuenta de Brevo solo a los clientes que han aceptado recibirlas. Las bajas se respetan siempre.</p>
        </header>
        <Campaigns />
      </div>
    </AdminLayout>
  );
}
