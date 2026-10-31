/**
 * Soporte (/admin/soporte y /admin/soporte/:id): las incidencias de la empresa con el equipo de Elephant Source.
 *
 * Todo pasa por el servidor del Core (support.*), que habla con el plano de control con la empresa de la sesión.
 * Solo se ven las respuestas públicas del equipo (nunca notas internas ni quién atiende). Funciona también con la
 * cuenta en solo lectura o suspendida. Sin canal, se remite al correo de soporte.
 */
import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, LifeBuoy, MessageSquarePlus, RotateCcw, Send } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";

type Status = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
interface TicketView {
  id: number;
  title: string;
  category: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}
interface Entry {
  at: number;
  kind: "created" | "comment" | "status";
  author: "customer" | "support";
  text: string | null;
  status: Status | null;
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  open: { label: "Recibida", tone: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  in_progress: { label: "En curso", tone: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200" },
  waiting_customer: { label: "Esperamos tu respuesta", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  resolved: { label: "Resuelta", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  closed: { label: "Cerrada", tone: "bg-muted text-muted-foreground" },
};
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "general", label: "Consulta general" },
  { value: "technical", label: "Algo no funciona" },
  { value: "billing", label: "Facturación y suscripción" },
  { value: "account", label: "Accesos y usuarios" },
  { value: "data", label: "Datos y exportaciones" },
];
const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;
const when = (ms: number) => new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function StatusBadge({ s }: { s: Status }) {
  return <Badge variant="outline" className={cn("border-0", STATUS[s].tone)}>{STATUS[s].label}</Badge>;
}

function NewTicketForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("technical");
  const [description, setDescription] = useState("");
  const utils = trpc.useUtils();
  const open = trpc.support.open.useMutation({
    onSuccess: (r) => {
      toast.success("Incidencia enviada. Te responderemos por aquí y por correo.");
      void utils.support.list.invalidate();
      onCreated((r as { ticket: TicketView }).ticket.id);
    },
    onError: (e) => toastError(e),
  });
  const valid = title.trim().length >= 3 && description.trim().length >= 10;
  return (
    <form
      className="rounded-2xl border border-border bg-card p-5 space-y-3"
      aria-labelledby="soporte-nueva"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) open.mutate({ title: title.trim(), description: description.trim(), category: category as "general" });
      }}
    >
      <h2 id="soporte-nueva" className="font-semibold text-foreground">Nueva incidencia</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1">
          <Label htmlFor="soporte-titulo">Asunto</Label>
          <Input id="soporte-titulo" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Por ejemplo: no se envían las facturas" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="soporte-tipo">Tipo</Label>
          <select id="soporte-tipo" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="soporte-detalle">Qué ocurre</Label>
        <Textarea id="soporte-detalle" value={description} maxLength={10_000} rows={5} onChange={(e) => setDescription(e.target.value)} placeholder="Cuéntanos qué intentabas hacer, en qué pantalla y qué ha pasado. No incluyas contraseñas ni datos de tarjetas." />
      </div>
      <Button type="submit" disabled={!valid || open.isPending}>
        <Send className="w-4 h-4 mr-1.5" aria-hidden="true" />
        {open.isPending ? "Enviando…" : "Enviar"}
      </Button>
    </form>
  );
}

function TicketDetail({ id }: { id: number }) {
  const utils = trpc.useUtils();
  const q = trpc.support.get.useQuery({ id }, { retry: false });
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => {
    void utils.support.get.invalidate({ id });
    void utils.support.list.invalidate();
  };
  const reply = trpc.support.reply.useMutation({ onSuccess: () => (setText(""), refresh()), onError: (e) => toastError(e) });
  const reopen = trpc.support.reopen.useMutation({ onSuccess: () => (setReason(""), refresh(), toast.success("Incidencia reabierta")), onError: (e) => toastError(e) });
  const data = q.data as { ticket: TicketView; timeline: Entry[] } | undefined;

  return (
    <div className="space-y-4">
      <Link href="/admin/soporte" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Mis incidencias
      </Link>
      {q.isLoading && <PanelLoading label="Cargando la incidencia…" />}
      {q.isError && <PanelError error={q.error} onRetry={() => q.refetch()} title="No se ha podido cargar la incidencia" />}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-foreground flex-1 min-w-0">{data.ticket.title}</h1>
            <StatusBadge s={data.ticket.status} />
          </div>
          <p className="text-xs text-muted-foreground">#{data.ticket.id} · {categoryLabel(data.ticket.category)} · abierta el {when(data.ticket.createdAt)}</p>

          <ol className="space-y-3" aria-label="Historial">
            {data.timeline.map((e, i) => (
              <li key={i} className={cn("rounded-2xl p-4 text-sm", e.author === "customer" ? "bg-primary/5 border border-primary/15 sm:ml-10" : "bg-card border border-border sm:mr-10")}>
                <p className="text-xs text-muted-foreground mb-1">
                  {e.author === "customer" ? "Tu equipo" : "Soporte de Elephant Source"} · {when(e.at)}
                </p>
                {e.kind === "status" && e.status && <p className="text-xs font-medium text-foreground mb-1">Estado: {STATUS[e.status]?.label ?? e.status}</p>}
                {e.text && <p className="whitespace-pre-wrap text-foreground">{e.text}</p>}
              </li>
            ))}
          </ol>

          {data.ticket.status !== "resolved" && data.ticket.status !== "closed" && (
            <form
              className="space-y-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (text.trim()) reply.mutate({ id, text: text.trim() });
              }}
            >
              <Label htmlFor="soporte-respuesta">Responder</Label>
              <Textarea id="soporte-respuesta" value={text} rows={3} maxLength={5000} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" disabled={!text.trim() || reply.isPending}>
                <Send className="w-4 h-4 mr-1.5" aria-hidden="true" /> {reply.isPending ? "Enviando…" : "Enviar respuesta"}
              </Button>
            </form>
          )}

          {data.ticket.status === "resolved" && (
            <form
              className="rounded-2xl border border-dashed border-border p-4 space-y-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (reason.trim().length >= 3) reopen.mutate({ id, reason: reason.trim() });
              }}
            >
              <p className="text-sm text-foreground">¿No está resuelto? Reábrela y cuéntanos qué sigue pasando.</p>
              <Textarea aria-label="Motivo para reabrir" value={reason} rows={2} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" variant="outline" disabled={reason.trim().length < 3 || reopen.isPending}>
                <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" /> Reabrir
              </Button>
            </form>
          )}
          {data.ticket.status === "closed" && <p className="text-sm text-muted-foreground">Esta incidencia está cerrada. Si necesitas algo más, abre una nueva.</p>}
        </>
      )}
    </div>
  );
}

export default function SupportTicketsPage() {
  const [, params] = useRoute("/admin/soporte/:id");
  const [, navigate] = useLocation();
  const available = trpc.support.available.useQuery(undefined, { staleTime: 300_000, retry: false });
  const list = trpc.support.list.useQuery(undefined, { enabled: available.data === true, retry: false });
  const [creating, setCreating] = useState(false);
  const selected = params?.id && /^\d+$/.test(params.id) ? Number(params.id) : null;
  const tickets = ((list.data as { tickets?: TicketView[] } | undefined)?.tickets ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        {selected !== null && available.data ? (
          <TicketDetail id={selected} />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-foreground">Soporte</h1>
                <p className="text-sm text-muted-foreground">Tus incidencias con el equipo de Elephant Source. Te avisamos por correo de cada respuesta.</p>
              </div>
              {available.data && !creating && (
                <Button type="button" onClick={() => setCreating(true)}>
                  <MessageSquarePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Nueva incidencia
                </Button>
              )}
            </div>

            {available.isSuccess && !available.data && (
              <section className="rounded-2xl border border-border bg-card p-5 flex gap-3">
                <LifeBuoy className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  El seguimiento de incidencias no está disponible en esta instalación. Escríbenos desde el <Link href="/admin/ayuda" className="underline underline-offset-4">centro de ayuda</Link>.
                </p>
              </section>
            )}

            {creating && <NewTicketForm onCreated={(id) => (setCreating(false), navigate(`/admin/soporte/${id}`))} />}

            {list.isLoading && <PanelLoading label="Cargando tus incidencias…" />}
            {list.isError && <PanelError error={list.error} onRetry={() => list.refetch()} title="No se han podido cargar tus incidencias" />}
            {list.isSuccess && tickets.length === 0 && !creating && <p className="text-sm text-muted-foreground">No tienes incidencias. Si algo no funciona o tienes una duda, abre una nueva.</p>}

            {tickets.length > 0 && (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/admin/soporte/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-foreground truncate">{t.title}</span>
                        <span className="block text-xs text-muted-foreground">#{t.id} · {categoryLabel(t.category)} · actualizada {when(t.updatedAt)}</span>
                      </span>
                      <StatusBadge s={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
