/**
 * Ficha de una comunidad (Social Token Net · Comunidades): indicadores de participación, miembros (incorporación desde
 * el CRM, usuarios del panel o invitación por correo; roles, aprobación y bloqueo), publicaciones y moderación,
 * encuestas, propuestas de miembros y reportes,
 * configuración y actividad. Solo administración; el servidor vuelve a comprobar la licencia y el rol en cada operación.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { ArrowLeft, Ban, CheckCircle2, ExternalLink, Eye, EyeOff, Mail, MessageSquare, Pin, PinOff, Plus, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import ImageUploader from "@/components/ImageUploader";
import { toastError } from "@/lib/errorMessage";
import {
  ACTIVITY_LABELS,
  COMMUNITY_CAPABILITY,
  MEMBER_ROLES,
  MEMBER_ROLE_LABELS,
  MEMBER_SOURCE_LABELS,
  MEMBER_STATUS_LABELS,
  POST_KIND_LABELS,
  POST_STATUS_LABELS,
  VISIBILITY_SHORT,
  type CommunityEventType,
  type MemberRole,
  type MemberStatus,
  type PostStatus,
} from "@shared/communities";
import { CommunityForm } from "./CommunityForm";
import { PollsTab, ProposalsTab, ReportsTab } from "./CommunityPollsTabs";

type Out = inferRouterOutputs<AppRouter>["communities"]["admin"];
type MemberRow = Out["members"]["list"][number];
type PostRow = Out["posts"]["list"][number];

const fmtDateTime = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)) : "—");
const fmtWeek = (ms: number) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ms));

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Resumen ─────────────────────────────────────────────────────────────────

function Summary({ communityId }: { communityId: number }) {
  const stats = trpc.communities.admin.stats.useQuery({ id: communityId });
  if (stats.isLoading) return <PanelLoading label="Calculando los indicadores…" />;
  if (stats.isError || !stats.data) return <PanelError error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;
  const max = Math.max(1, ...s.weekly.map((w) => w.count));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Miembros activos" value={s.members.active} hint={`${s.members.newInWindow} nuevos en ${s.windowDays} días`} />
        <Stat label="Participación" value={`${s.indicators.participationRate} %`} hint={`${s.participants} participan en ${s.windowDays} días`} />
        <Stat label="Publicaciones" value={s.content.posts} hint={`${s.indicators.interactionsPerPost} interacciones por publicación`} />
        <Stat label="Comentarios y me gusta" value={s.content.comments + s.content.reactions} hint={`${s.content.comments} comentarios · ${s.content.reactions} me gusta · ${s.content.saves} guardados`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Encuestas" value={s.participation.polls} hint={`${s.participation.openPolls} abiertas · ${s.participation.responses} respuestas`} />
        <Stat label="Propuestas" value={s.participation.proposals} hint={`${s.participation.pendingProposals} por revisar`} />
        <Stat label="Reportes pendientes" value={s.participation.openReports} />
      </div>
      {(s.members.pending > 0 || s.content.pendingPosts > 0) && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Pendiente de revisar: {s.members.pending} {s.members.pending === 1 ? "solicitud de entrada" : "solicitudes de entrada"} y {s.content.pendingPosts} {s.content.pendingPosts === 1 ? "publicación" : "publicaciones"}.
        </p>
      )}
      <section aria-labelledby="weekly-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="weekly-title" className="mb-3 text-sm font-semibold text-foreground">Participación semanal (publicaciones, comentarios y me gusta)</h2>
        <ol className="flex h-36 items-end gap-2" aria-label="Acciones por semana, últimas 8 semanas">
          {s.weekly.map((w) => (
            <li key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">{w.count}</span>
              <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, (w.count / max) * 96)}px` }} aria-hidden="true" />
              <span className="text-[11px] text-muted-foreground">{fmtWeek(w.weekStart)}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Quién más participa ({s.windowDays} días)</h2>
          {s.topContributors.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay participación.</p> : (
            <ol className="space-y-1 text-sm">
              {s.topContributors.map((t) => <li key={t.userId} className="flex justify-between"><span>{t.name}</span><span className="text-muted-foreground">{t.actions} acciones</span></li>)}
            </ol>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Miembros y moderación</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Bloqueados</dt><dd>{s.members.blocked}</dd>
            <dt className="text-muted-foreground">Han salido</dt><dd>{s.members.left}</dd>
            <dt className="text-muted-foreground">Publicaciones ocultas</dt><dd>{s.content.hiddenPosts}</dd>
            <dt className="text-muted-foreground">Comentarios ocultos</dt><dd>{s.content.hiddenComments}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

// ─── Miembros ────────────────────────────────────────────────────────────────

function AddMembersDialog({ communityId, open, onClose }: { communityId: number; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<number[]>([]);
  const [users, setUsers] = useState<number[]>([]);
  const [role, setRole] = useState<MemberRole>("member");
  const [notify, setNotify] = useState(true);
  const [invite, setInvite] = useState({ name: "", email: "" });
  const cand = trpc.communities.admin.members.candidates.useQuery({ communityId, search }, { enabled: open });
  const done = () => {
    utils.communities.admin.members.list.invalidate();
    utils.communities.admin.stats.invalidate();
    utils.communities.admin.list.invalidate();
  };
  const add = trpc.communities.admin.members.add.useMutation({
    onSuccess: (r) => {
      const added = r.results.filter((x) => x.result !== "already").length;
      toast.success(`${added} ${added === 1 ? "persona incorporada" : "personas incorporadas"}${r.emailsSent ? ` · ${r.emailsSent} ${r.emailsSent === 1 ? "correo enviado" : "correos enviados"}` : ""}`);
      setClients([]);
      setUsers([]);
      done();
    },
    onError: (e) => toastError(e),
  });
  const sendInvite = trpc.communities.admin.members.invite.useMutation({
    onSuccess: (r) => {
      toast.success(r.result === "already" ? "Ya era miembro" : r.emailsSent ? "Invitación enviada" : "Incorporada (no se ha podido enviar el correo)");
      setInvite({ name: "", email: "" });
      done();
    },
    onError: (e) => toastError(e),
  });
  const toggle = (arr: number[], set: (v: number[]) => void, id: number) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incorporar miembros</DialogTitle>
          <DialogDescription>
            Desde tus clientes del CRM o los usuarios del panel. Quien aún no tiene cuenta recibe una invitación para crear su contraseña; quien ya la tiene,
            un aviso con el enlace a la comunidad.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-8" placeholder="Buscar por nombre o correo" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar clientes y usuarios" />
          </div>
          {cand.isLoading ? <PanelLoading /> : (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-semibold">Clientes del CRM</legend>
                {(cand.data?.clients ?? []).length === 0 && <p className="text-sm text-muted-foreground">Ningún cliente disponible.</p>}
                {(cand.data?.clients ?? []).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded p-1 text-sm hover:bg-muted">
                    <input type="checkbox" className="mt-1" checked={clients.includes(c.id)} onChange={() => toggle(clients, setClients, c.id)} />
                    <span><span className="font-medium">{c.name}</span><br /><span className="text-xs text-muted-foreground">{c.email}{c.hasAccount ? " · ya tiene cuenta" : ""}</span></span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-semibold">Usuarios del panel</legend>
                {(cand.data?.users ?? []).length === 0 && <p className="text-sm text-muted-foreground">Ningún usuario disponible.</p>}
                {(cand.data?.users ?? []).map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-start gap-2 rounded p-1 text-sm hover:bg-muted">
                    <input type="checkbox" className="mt-1" checked={users.includes(u.id)} onChange={() => toggle(users, setUsers, u.id)} />
                    <span><span className="font-medium">{u.name}</span><br /><span className="text-xs text-muted-foreground">{u.email}</span></span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="add-role" label="Rol en la comunidad">
              <select id="add-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                {MEMBER_ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>)}
              </select>
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch checked={notify} onCheckedChange={setNotify} aria-label="Enviar invitación o aviso por correo" /> Enviar invitación o aviso por correo
            </label>
          </div>
          <div className="flex justify-end">
            <Button disabled={add.isPending || (clients.length + users.length === 0)} onClick={() => add.mutate({ communityId, clientIds: clients, userIds: users, role, notify })}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Incorporar {clients.length + users.length || ""}
            </Button>
          </div>
          <form
            className="space-y-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              sendInvite.mutate({ communityId, name: invite.name, email: invite.email, role });
            }}
          >
            <p className="text-sm font-semibold">Invitar por correo a alguien que no está en el CRM</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Nombre" aria-label="Nombre" value={invite.name} onChange={(e) => setInvite((s) => ({ ...s, name: e.target.value }))} required minLength={2} />
              <Input type="email" placeholder="correo@ejemplo.es" aria-label="Correo" value={invite.email} onChange={(e) => setInvite((s) => ({ ...s, email: e.target.value }))} required />
              <Button type="submit" variant="outline" disabled={sendInvite.isPending}><Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />Invitar</Button>
            </div>
          </form>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersTab({ communityId, canEdit }: { communityId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<MemberStatus | "">("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const list = trpc.communities.admin.members.list.useQuery({ communityId, status: status || undefined, search: search || undefined });
  const refresh = () => {
    utils.communities.admin.members.list.invalidate();
    utils.communities.admin.stats.invalidate();
    utils.communities.admin.list.invalidate();
  };
  const setRole = trpc.communities.admin.members.setRole.useMutation({ onSuccess: () => { toast.success("Rol actualizado"); refresh(); }, onError: (e) => toastError(e) });
  const setSt = trpc.communities.admin.members.setStatus.useMutation({ onSuccess: () => { toast.success("Hecho"); refresh(); }, onError: (e) => toastError(e) });
  const resend = trpc.communities.admin.members.resendInvite.useMutation({ onSuccess: (r) => toast.success(r.emailsSent ? "Invitación reenviada" : "No se ha podido enviar el correo"), onError: (e) => toastError(e) });
  const rows = list.data ?? [];

  const act = (m: MemberRow, action: "approve" | "block" | "unblock" | "remove") => {
    const reason = action === "block" ? window.prompt(`Motivo del bloqueo de ${m.name} (opcional):`) : null;
    if (action === "block" && reason === null) return;
    if (action === "remove" && !window.confirm(`¿Dar de baja a ${m.name}? Su contenido se conserva.`)) return;
    setSt.mutate({ memberId: m.id, action, reason: reason || null });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" placeholder="Buscar miembro" aria-label="Buscar miembro" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label="Filtrar por estado" className={`${selectClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as MemberStatus | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(MEMBER_STATUS_LABELS) as MemberStatus[]).map((s) => <option key={s} value={s}>{MEMBER_STATUS_LABELS[s]}</option>)}
        </select>
        {canEdit && <Button onClick={() => setAdding(true)}><UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />Incorporar miembros</Button>}
      </div>
      {list.isLoading ? <PanelLoading /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? (
        <PanelEmpty icon={<Users className="h-6 w-6" />} title="Sin miembros" description="Incorpora clientes del CRM, usuarios del panel o invita por correo." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Persona</th><th className="p-2">Rol</th><th className="p-2">Estado</th><th className="p-2">Origen</th><th className="p-2">Última visita</th><th className="p-2 text-right">Acciones</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="p-2">
                    <span className="font-medium">{m.name}</span>
                    <br /><span className="text-xs text-muted-foreground">{m.email}{m.accountRole === "user" ? " · cuenta de cliente" : m.accountRole ? " · usuario del panel" : ""}</span>
                    {m.invitePending && <><br /><span className="text-xs text-amber-700 dark:text-amber-300">Invitación pendiente</span></>}
                  </td>
                  <td className="p-2">
                    <select aria-label={`Rol de ${m.name}`} className={`${selectClass} h-8 w-auto`} disabled={!canEdit || setRole.isPending} value={m.role} onChange={(e) => setRole.mutate({ memberId: m.id, role: e.target.value as MemberRole })}>
                      {MEMBER_ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <Badge variant={m.status === "active" ? "outline" : m.status === "blocked" ? "destructive" : "secondary"}>{MEMBER_STATUS_LABELS[m.status]}</Badge>
                    {m.statusReason && <p className="mt-1 text-xs text-muted-foreground">{m.statusReason}</p>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{MEMBER_SOURCE_LABELS[m.source]}</td>
                  <td className="p-2 text-xs text-muted-foreground">{fmtDateTime(m.lastSeenAt)}</td>
                  <td className="p-2">
                    {canEdit && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.status === "pending" && <Button size="sm" variant="outline" onClick={() => act(m, "approve")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Aprobar</Button>}
                        {m.status === "active" && <Button size="sm" variant="outline" onClick={() => act(m, "block")}><Ban className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Bloquear</Button>}
                        {m.status === "blocked" && <Button size="sm" variant="outline" onClick={() => act(m, "unblock")}>Desbloquear</Button>}
                        {m.invitePending && m.status === "active" && <Button size="sm" variant="ghost" onClick={() => resend.mutate({ memberId: m.id })}><Mail className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Reenviar</Button>}
                        {m.status !== "left" && <Button size="sm" variant="ghost" onClick={() => act(m, "remove")}>Dar de baja</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddMembersDialog communityId={communityId} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

// ─── Publicaciones ───────────────────────────────────────────────────────────

function CommentsDialog({ post, onClose, canEdit }: { post: PostRow | null; onClose: () => void; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.communities.admin.comments.list.useQuery({ postId: post?.id ?? 0 }, { enabled: !!post });
  const hide = trpc.communities.admin.comments.setHidden.useMutation({ onSuccess: () => { utils.communities.admin.comments.list.invalidate(); utils.communities.admin.stats.invalidate(); }, onError: (e) => toastError(e) });
  const all = (list.data ?? []).flatMap((c) => [c, ...c.replies]);
  return (
    <Dialog open={!!post} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comentarios</DialogTitle>
          <DialogDescription>{post?.title || post?.body.slice(0, 80)}</DialogDescription>
        </DialogHeader>
        {list.isLoading ? <PanelLoading /> : all.length === 0 ? <p className="text-sm text-muted-foreground">Sin comentarios.</p> : (
          <ul className="space-y-2">
            {all.map((c) => (
              <li key={c.id} className={`rounded-lg border border-border p-2 text-sm ${c.parentCommentId ? "ml-6" : ""} ${c.hidden ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <p><span className="font-medium">{c.authorName}</span> <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}{c.hidden ? " · oculto" : ""}</span></p>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => hide.mutate({ commentId: c.id, hidden: !c.hidden })}>
                      {c.hidden ? <><Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Mostrar</> : <><EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Ocultar</>}
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewPostDialog({ communityId, open, onClose }: { communityId: number; open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [announcement, setAnnouncement] = useState(true);
  const [pinned, setPinned] = useState(false);
  const create = trpc.communities.admin.posts.create.useMutation({
    onSuccess: () => {
      toast.success("Publicado");
      utils.communities.admin.posts.list.invalidate();
      utils.communities.admin.stats.invalidate();
      setTitle(""); setBody(""); setImageUrl(""); setPinned(false);
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva publicación</DialogTitle>
          <DialogDescription>Se publica en nombre de tu usuario. Los anuncios aparecen destacados.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ communityId, title: title || null, body, imageUrl: imageUrl || null, announcement, pinned }); }}>
          <FormField id="np-title" label="Título"><Input id="np-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField id="np-body" label="Texto" required><Textarea id="np-body" rows={5} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} required /></FormField>
          <ImageUploader label="Imagen (opcional)" value={imageUrl} onChange={setImageUrl} />
          <label className="flex items-center gap-2 text-sm"><Switch checked={announcement} onCheckedChange={setAnnouncement} aria-label="Anuncio" />Anuncio</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={pinned} onCheckedChange={setPinned} aria-label="Fijar arriba" />Fijar arriba del muro</label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || !body.trim()}>{create.isPending ? "Publicando…" : "Publicar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PostsTab({ communityId, canEdit }: { communityId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<PostStatus | "">("");
  const [newPost, setNewPost] = useState(false);
  const [comments, setComments] = useState<PostRow | null>(null);
  const list = trpc.communities.admin.posts.list.useQuery({ communityId, status: status || undefined });
  const refresh = () => { utils.communities.admin.posts.list.invalidate(); utils.communities.admin.stats.invalidate(); utils.communities.admin.list.invalidate(); };
  const setSt = trpc.communities.admin.posts.setStatus.useMutation({ onSuccess: () => { toast.success("Hecho"); refresh(); }, onError: (e) => toastError(e) });
  const pin = trpc.communities.admin.posts.pin.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const rows = list.data ?? [];
  const hide = (p: PostRow) => {
    const note = window.prompt("Motivo (opcional, solo para la moderación):");
    if (note === null) return;
    setSt.mutate({ postId: p.id, status: "hidden", note: note || null });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filtrar por estado" className={`${selectClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as PostStatus | "")}>
          <option value="">Todas</option>
          {(Object.keys(POST_STATUS_LABELS) as PostStatus[]).map((s) => <option key={s} value={s}>{POST_STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex-1" />
        {canEdit && <Button onClick={() => setNewPost(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva publicación</Button>}
      </div>
      {list.isLoading ? <PanelLoading /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? (
        <PanelEmpty icon={<MessageSquare className="h-6 w-6" />} title="Sin publicaciones" />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className={`rounded-xl border border-border bg-card p-3 ${p.status === "hidden" ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {p.authorName} · {fmtDateTime(p.createdAt)} · {POST_KIND_LABELS[p.kind]}{p.pinned ? " · fijada" : ""}
                  </p>
                  {p.title && <p className="font-semibold">{p.title}</p>}
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{p.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.comments} comentarios · {p.reactions} me gusta{p.moderationNote ? ` · Nota: ${p.moderationNote}` : ""}</p>
                </div>
                <Badge variant={p.status === "published" ? "outline" : p.status === "hidden" ? "destructive" : "secondary"}>{POST_STATUS_LABELS[p.status]}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setComments(p)}><MessageSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Comentarios</Button>
                {canEdit && p.status !== "published" && <Button size="sm" variant="outline" onClick={() => setSt.mutate({ postId: p.id, status: "published" })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{p.status === "pending" ? "Aprobar" : "Volver a mostrar"}</Button>}
                {canEdit && p.status !== "hidden" && <Button size="sm" variant="outline" onClick={() => hide(p)}><EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Ocultar</Button>}
                {canEdit && p.status === "published" && (
                  <Button size="sm" variant="ghost" onClick={() => pin.mutate({ postId: p.id, pinned: !p.pinned })}>
                    {p.pinned ? <><PinOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Desfijar</> : <><Pin className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Fijar</>}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <NewPostDialog communityId={communityId} open={newPost} onClose={() => setNewPost(false)} />
      <CommentsDialog post={comments} onClose={() => setComments(null)} canEdit={canEdit} />
    </div>
  );
}

// ─── Actividad ───────────────────────────────────────────────────────────────

function ActivityTab({ communityId }: { communityId: number }) {
  const list = trpc.communities.admin.activity.useQuery({ id: communityId, limit: 100 });
  if (list.isLoading) return <PanelLoading />;
  if (list.isError) return <PanelError error={list.error} onRetry={() => list.refetch()} />;
  const rows = list.data ?? [];
  if (!rows.length) return <PanelEmpty title="Sin actividad todavía" />;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      {rows.map((a) => (
        <li key={a.id} className="flex justify-between gap-3 p-2">
          <span><span className="font-medium">{a.actorName ?? "Alguien"}</span> {ACTIVITY_LABELS[a.type as CommunityEventType] ?? a.type}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function CommunityDetail() {
  const params = useParams<{ id: string }>();
  const communityId = Number(params.id);
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const canEdit = (user as { role?: string } | null)?.role === "admin" && sub.canWrite(COMMUNITY_CAPABILITY);
  const utils = trpc.useUtils();
  const q = trpc.communities.admin.get.useQuery({ id: communityId }, { enabled: Number.isInteger(communityId) && communityId > 0 });
  const update = trpc.communities.admin.update.useMutation({ onSuccess: () => { toast.success("Cambios guardados"); utils.communities.admin.get.invalidate(); utils.communities.admin.list.invalidate(); }, onError: (e) => toastError(e) });
  const setStatus = trpc.communities.admin.setStatus.useMutation({ onSuccess: () => { utils.communities.admin.get.invalidate(); utils.communities.admin.list.invalidate(); }, onError: (e) => toastError(e) });
  const c = q.data;
  const formKey = useMemo(() => (c ? `${c.id}-${c.updatedAt}` : "x"), [c]);

  return (
    <AdminLayout>
      <div className="space-y-4">
        <Link href="/admin/comunidades" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Comunidades</Link>
        {q.isLoading ? <PanelLoading /> : q.isError || !c ? <PanelError error={q.error} onRetry={() => q.refetch()} title="No se ha podido cargar la comunidad" /> : (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="h-28 bg-muted" style={c.coverImageUrl ? { backgroundImage: `url(${c.coverImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : c.accentColor ? { background: c.accentColor } : undefined} aria-hidden="true" />
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  {c.logoUrl && <img src={c.logoUrl} alt="" className="h-12 w-12 rounded-lg border border-border object-cover" />}
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{c.name}</h1>
                    <p className="text-sm text-muted-foreground">{VISIBILITY_SHORT[c.visibility]} · /comunidad/{c.slug}{c.status === "archived" ? " · Archivada" : ""}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" asChild><a href={`/comunidad/${c.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />Área de miembros</a></Button>
                  {canEdit && (
                    <Button variant="outline" disabled={setStatus.isPending} onClick={() => {
                      if (c.status === "active" && !window.confirm("Al archivarla, los miembros podrán leerla pero no publicar ni comentar. ¿Archivar?")) return;
                      setStatus.mutate({ id: c.id, status: c.status === "active" ? "archived" : "active" });
                    }}>{c.status === "active" ? "Archivar" : "Reactivar"}</Button>
                  )}
                </div>
              </div>
            </div>
            <Tabs defaultValue="resumen">
              <TabsList className="flex-wrap">
                <TabsTrigger value="resumen">Resumen</TabsTrigger>
                <TabsTrigger value="miembros">Miembros</TabsTrigger>
                <TabsTrigger value="publicaciones">Publicaciones</TabsTrigger>
                <TabsTrigger value="encuestas">Encuestas</TabsTrigger>
                <TabsTrigger value="propuestas">Propuestas</TabsTrigger>
                <TabsTrigger value="reportes">Reportes</TabsTrigger>
                <TabsTrigger value="configuracion">Configuración</TabsTrigger>
                <TabsTrigger value="actividad">Actividad</TabsTrigger>
              </TabsList>
              <TabsContent value="resumen"><Summary communityId={c.id} /></TabsContent>
              <TabsContent value="miembros"><MembersTab communityId={c.id} canEdit={canEdit} /></TabsContent>
              <TabsContent value="publicaciones"><PostsTab communityId={c.id} canEdit={canEdit} /></TabsContent>
              <TabsContent value="encuestas"><PollsTab communityId={c.id} canEdit={canEdit} /></TabsContent>
              <TabsContent value="propuestas"><ProposalsTab communityId={c.id} canEdit={canEdit} /></TabsContent>
              <TabsContent value="reportes"><ReportsTab communityId={c.id} canEdit={canEdit} /></TabsContent>
              <TabsContent value="configuracion">
                <div className="max-w-2xl rounded-xl border border-border bg-card p-4">
                  <CommunityForm
                    key={formKey}
                    showSlug
                    readOnly={!canEdit}
                    initial={{ name: c.name, slug: c.slug, description: c.description, coverImageUrl: c.coverImageUrl, logoUrl: c.logoUrl, accentColor: c.accentColor, visibility: c.visibility, allowMemberPosts: c.allowMemberPosts, postModeration: c.postModeration }}
                    submitLabel="Guardar cambios"
                    busy={update.isPending}
                    onSubmit={(v) => update.mutate({ id: c.id, ...v })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="actividad"><ActivityTab communityId={c.id} /></TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
