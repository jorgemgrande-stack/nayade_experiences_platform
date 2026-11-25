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
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

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

const STATUS: Record<Status, { key: string; tone: string }> = {
  open: { key: "open", tone: "bg-info/10 text-info dark:bg-info/15 " },
  in_progress: { key: "in_progress", tone: "bg-info/10 text-info dark:bg-info/15 " },
  waiting_customer: { key: "waiting_customer", tone: "bg-warning/10 text-warning dark:bg-warning/15 " },
  resolved: { key: "resolved", tone: "bg-success/10 text-success dark:bg-success/15 " },
  closed: { key: "closed", tone: "bg-muted text-muted-foreground" },
};
const CATEGORY_VALUES = ["general", "technical", "billing", "account", "data"] as const;
const WHEN_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** Etiquetas traducidas de estados y tipos, y fecha local. */
function useSupportText() {
  const { t, format: f } = useI18n();
  const statusLabel = (s: Status): string => {
    switch (s) {
      case "open": return t("help.support.status.open");
      case "in_progress": return t("help.support.status.in_progress");
      case "waiting_customer": return t("help.support.status.waiting_customer");
      case "resolved": return t("help.support.status.resolved");
      case "closed": return t("help.support.status.closed");
    }
  };
  const categoryLabel = (c: string): string => {
    switch (c) {
      case "general": return t("help.support.category.general");
      case "technical": return t("help.support.category.technical");
      case "billing": return t("help.support.category.billing");
      case "account": return t("help.support.category.account");
      case "data": return t("help.support.category.data");
      default: return c;
    }
  };
  const when = (ms: number) => f.dateTime(ms, WHEN_FORMAT);
  return { t, statusLabel, categoryLabel, when };
}

function StatusBadge({ s }: { s: Status }) {
  const { statusLabel } = useSupportText();
  return <Badge variant="outline" className={cn("border-0", STATUS[s].tone)}>{statusLabel(s)}</Badge>;
}

function NewTicketForm({ onCreated }: { onCreated: (id: number) => void }) {
  const { t, categoryLabel } = useSupportText();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("technical");
  const [description, setDescription] = useState("");
  const utils = trpc.useUtils();
  const open = trpc.support.open.useMutation({
    onSuccess: (r) => {
      toast.success(t("help.support.created"));
      void utils.support.list.invalidate();
      onCreated((r as { ticket: TicketView }).ticket.id);
    },
    onError: (e) => toastError(e),
  });
  const valid = title.trim().length >= 3 && description.trim().length >= 10;
  return (
    <form
      className="rounded-xl border border-border bg-card p-5 space-y-3"
      aria-labelledby="soporte-nueva"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) open.mutate({ title: title.trim(), description: description.trim(), category: category as "general" });
      }}
    >
      <h2 id="soporte-nueva" className="font-semibold text-foreground">{t("help.support.newTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="space-y-1">
          <Label htmlFor="soporte-titulo">{t("help.support.subject")}</Label>
          <Input id="soporte-titulo" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("help.support.subjectPlaceholder")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="soporte-tipo">{t("help.support.type")}</Label>
          <select id="soporte-tipo" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            {CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="soporte-detalle">{t("help.support.what")}</Label>
        <Textarea id="soporte-detalle" value={description} maxLength={10_000} rows={5} onChange={(e) => setDescription(e.target.value)} placeholder={t("help.support.whatPlaceholder")} />
      </div>
      <Button type="submit" disabled={!valid || open.isPending}>
        <Send className="w-4 h-4 mr-1.5" aria-hidden="true" />
        {open.isPending ? t("help.support.sending") : t("help.support.send")}
      </Button>
    </form>
  );
}

function TicketDetail({ id }: { id: number }) {
  const { t, statusLabel, categoryLabel, when } = useSupportText();
  const utils = trpc.useUtils();
  const q = trpc.support.get.useQuery({ id }, { retry: false });
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => {
    void utils.support.get.invalidate({ id });
    void utils.support.list.invalidate();
  };
  const reply = trpc.support.reply.useMutation({ onSuccess: () => (setText(""), refresh()), onError: (e) => toastError(e) });
  const reopen = trpc.support.reopen.useMutation({ onSuccess: () => (setReason(""), refresh(), toast.success(t("help.support.reopened"))), onError: (e) => toastError(e) });
  const data = q.data as { ticket: TicketView; timeline: Entry[] } | undefined;

  return (
    <div className="space-y-4">
      <Link href="/admin/soporte" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t("help.support.myTickets")}
      </Link>
      {q.isLoading && <PanelLoading label={t("help.support.loadingTicket")} />}
      {q.isError && <PanelError error={q.error} onRetry={() => q.refetch()} title={t("help.support.loadTicketError")} />}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-foreground flex-1 min-w-0">{data.ticket.title}</h1>
            <StatusBadge s={data.ticket.status} />
          </div>
          <p className="text-xs text-muted-foreground">{t("help.support.meta", { id: data.ticket.id, category: categoryLabel(data.ticket.category), date: when(data.ticket.createdAt) })}</p>

          <ol className="space-y-3" aria-label={t("help.support.history")}>
            {data.timeline.map((e, i) => (
              <li key={i} className={cn("rounded-xl p-4 text-sm", e.author === "customer" ? "bg-primary/5 border border-primary/15 sm:ml-10" : "bg-card border border-border sm:mr-10")}>
                <p className="text-xs text-muted-foreground mb-1">
                  {e.author === "customer" ? t("help.support.authorCustomer") : t("help.support.authorSupport")} · {when(e.at)}
                </p>
                {e.kind === "status" && e.status && <p className="text-xs font-medium text-foreground mb-1">{t("help.support.statusLabel", { status: STATUS[e.status] ? statusLabel(e.status) : e.status })}</p>}
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
              <Label htmlFor="soporte-respuesta">{t("help.support.reply")}</Label>
              <Textarea id="soporte-respuesta" value={text} rows={3} maxLength={5000} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" disabled={!text.trim() || reply.isPending}>
                <Send className="w-4 h-4 mr-1.5" aria-hidden="true" /> {reply.isPending ? t("help.support.sending") : t("help.support.sendReply")}
              </Button>
            </form>
          )}

          {data.ticket.status === "resolved" && (
            <form
              className="rounded-xl border border-dashed border-border p-4 space-y-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (reason.trim().length >= 3) reopen.mutate({ id, reason: reason.trim() });
              }}
            >
              <p className="text-sm text-foreground">{t("help.support.reopenHint")}</p>
              <Textarea aria-label={t("help.support.reopenReason")} value={reason} rows={2} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" variant="outline" disabled={reason.trim().length < 3 || reopen.isPending}>
                <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" /> {t("help.support.reopen")}
              </Button>
            </form>
          )}
          {data.ticket.status === "closed" && <p className="text-sm text-muted-foreground">{t("help.support.closedText")}</p>}
        </>
      )}
    </div>
  );
}

export default function SupportTicketsPage() {
  const { t: tr, categoryLabel, when } = useSupportText();
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
            <PanelPageHeader
              icon={<LifeBuoy />}
              title={tr("help.support.title")}
              description={tr("help.support.subtitle")}
              actions={available.data && !creating ? (
                <Button type="button" onClick={() => setCreating(true)}>
                  <MessageSquarePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> {tr("help.support.new")}
                </Button>
              ) : undefined}
            />

            {available.isSuccess && !available.data && (
              <section className="rounded-xl border border-border bg-card p-5 flex gap-3">
                <LifeBuoy className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {tr("help.support.unavailable").split(/(<link>.*?<\/link>)/g).map((part, i) =>
                    part.startsWith("<link>") ? <Link key={i} href="/admin/ayuda" className="underline underline-offset-4">{part.slice(6, -7)}</Link> : part,
                  )}
                </p>
              </section>
            )}

            {creating && <NewTicketForm onCreated={(id) => (setCreating(false), navigate(`/admin/soporte/${id}`))} />}

            {list.isLoading && <PanelLoading label={tr("help.support.loadingList")} />}
            {list.isError && <PanelError error={list.error} onRetry={() => list.refetch()} title={tr("help.support.loadListError")} />}
            {list.isSuccess && tickets.length === 0 && !creating && <PanelEmpty icon={<LifeBuoy />} title={tr("help.support.empty")} />}

            {tickets.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {tickets.map((tk) => (
                  <li key={tk.id}>
                    <Link href={`/admin/soporte/${tk.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{tk.title}</span>
                        <span className="block text-xs text-muted-foreground">{tr("help.support.updated", { id: tk.id, category: categoryLabel(tk.category), date: when(tk.updatedAt) })}</span>
                      </span>
                      <StatusBadge s={tk.status} />
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
