/**
 * /comunidad/:slug — muro de una comunidad para sus miembros: publicar, comentar (un nivel de respuesta), «me gusta»,
 * guardados, miembros, encuestas y propuestas, y reportar contenido. Moderadores y administradores de la comunidad
 * ocultan, aprueban, fijan, bloquean y resuelven reportes desde aquí.
 * Los permisos los vuelve a comprobar el servidor en cada operación.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { ArrowLeft, Bookmark, BookmarkCheck, CheckCircle2, EyeOff, Heart, Megaphone, MessageCircle, Pin, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toastError } from "@/lib/errorMessage";
import { COMMENT_MAX, MEMBER_ROLE_LABELS, POST_BODY_MAX, POST_STATUS_LABELS, TITLE_MAX } from "@shared/communities";
import CommunityLayout, { CommunityNotice, isUnlicensed } from "./CommunityLayout";
import { MemberPolls, MemberProposals, MemberReports, ReportButton } from "./CommunityPolls";

type Out = inferRouterOutputs<AppRouter>["communities"]["member"];
type Post = Out["feed"][number];
type Perms = Out["community"]["perms"];

const fmt = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

function Composer({ communityId, perms }: { communityId: number; perms: Perms }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [announcement, setAnnouncement] = useState(false);
  const create = trpc.communities.member.createPost.useMutation({
    onSuccess: (p) => {
      toast.success(p.status === "pending" ? "Enviada: un moderador la revisará antes de publicarla" : "Publicado");
      setTitle("");
      setBody("");
      setAnnouncement(false);
      utils.communities.member.feed.invalidate();
    },
    onError: (e) => toastError(e),
  });
  if (!perms.post) return null;
  return (
    <form
      className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ communityId, title: title || null, body, announcement });
      }}
    >
      <Input placeholder="Título (opcional)" aria-label="Título" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="Comparte algo con la comunidad…" aria-label="Texto de la publicación" rows={3} value={body} maxLength={POST_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {perms.announce ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={announcement} onChange={(e) => setAnnouncement(e.target.checked)} /> Publicar como anuncio
          </label>
        ) : <span />}
        <Button type="submit" disabled={create.isPending || !body.trim()} className="bg-[var(--portal-accent)] text-[var(--portal-accent-fg)] hover:opacity-90">
          <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />Publicar
        </Button>
      </div>
    </form>
  );
}

function Comments({ post, perms }: { post: Post; perms: Perms }) {
  const utils = trpc.useUtils();
  const list = trpc.communities.member.comments.useQuery({ postId: post.id });
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const refresh = () => { utils.communities.member.comments.invalidate({ postId: post.id }); utils.communities.member.feed.invalidate(); };
  const add = trpc.communities.member.addComment.useMutation({ onSuccess: () => { setBody(""); setReplyTo(null); refresh(); }, onError: (e) => toastError(e) });
  const react = trpc.communities.member.react.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const removeOwn = trpc.communities.member.removeOwnComment.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const moderate = trpc.communities.member.moderateComment.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const canComment = perms.comment && post.status === "published";

  const Item = ({ c, isReply }: { c: NonNullable<typeof list.data>[number]; isReply?: boolean }) => (
    <li className={`${isReply ? "ml-6 border-l-2 border-slate-100 pl-3" : ""} ${c.hidden ? "opacity-60" : ""}`}>
      <p className="text-sm"><span className="font-medium text-slate-900">{c.authorName}</span> <span className="text-xs text-slate-500">{fmt(c.createdAt)}{c.hidden ? " · oculto" : ""}</span></p>
      <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.body}</p>
      <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-500">
        {!c.hidden && perms.react && (
          <button type="button" className={`inline-flex items-center gap-1 ${c.likedByMe ? "text-rose-600" : "hover:text-slate-800"}`} onClick={() => react.mutate({ target: "comment", targetId: c.id })} aria-pressed={c.likedByMe} aria-label="Me gusta">
            <Heart className={`h-3.5 w-3.5 ${c.likedByMe ? "fill-current" : ""}`} aria-hidden="true" />{c.likes}
          </button>
        )}
        {!isReply && !c.hidden && canComment && <button type="button" className="hover:text-slate-800" onClick={() => setReplyTo({ id: c.id, name: c.authorName })}>Responder</button>}
        {c.isOwn && !c.hidden && <button type="button" className="hover:text-slate-800" onClick={() => removeOwn.mutate({ commentId: c.id })}>Retirar</button>}
        {perms.moderate && <button type="button" className="hover:text-slate-800" onClick={() => moderate.mutate({ commentId: c.id, hidden: !c.hidden })}>{c.hidden ? "Volver a mostrar" : "Ocultar"}</button>}
        {!c.isOwn && !c.hidden && <ReportButton target="comment" targetId={c.id} />}
      </div>
      {c.replies.length > 0 && <ul className="mt-2 space-y-2">{c.replies.map((r) => <Item key={r.id} c={r} isReply />)}</ul>}
    </li>
  );

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      {list.isLoading ? <p className="text-xs text-slate-500">Cargando comentarios…</p> : (
        <ul className="space-y-3">{(list.data ?? []).map((c) => <Item key={c.id} c={c} />)}</ul>
      )}
      {canComment && (
        <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); add.mutate({ postId: post.id, body, parentCommentId: replyTo?.id ?? null }); }}>
          {replyTo && <p className="text-xs text-slate-500">Respondiendo a {replyTo.name} · <button type="button" className="underline" onClick={() => setReplyTo(null)}>cancelar</button></p>}
          <div className="flex gap-2">
            <Input placeholder="Escribe un comentario…" aria-label="Comentario" value={body} maxLength={COMMENT_MAX} onChange={(e) => setBody(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={add.isPending || !body.trim()} aria-label="Enviar comentario"><Send className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PostCard({ post, perms }: { post: Post; perms: Perms }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const refresh = () => utils.communities.member.feed.invalidate();
  const react = trpc.communities.member.react.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const save = trpc.communities.member.save.useMutation({ onSuccess: (r) => { toast.success(r.saved ? "Guardada" : "Quitada de guardados"); refresh(); }, onError: (e) => toastError(e) });
  const moderate = trpc.communities.member.moderatePost.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  return (
    <article className={`space-y-3 rounded-xl border bg-white p-4 ${post.kind === "announcement" ? "border-[var(--portal-accent)]" : "border-slate-200"} ${post.status === "hidden" ? "opacity-70" : ""}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">{post.authorName}</p>
          <p className="text-xs text-slate-500">
            {fmt(post.createdAt)}
            {post.kind === "announcement" && <> · <Megaphone className="inline h-3 w-3" aria-hidden="true" /> Anuncio</>}
            {post.pinned && <> · <Pin className="inline h-3 w-3" aria-hidden="true" /> Fijada</>}
          </p>
        </div>
        {post.status !== "published" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{POST_STATUS_LABELS[post.status]}</span>}
      </header>
      {post.title && <h2 className="text-lg font-semibold text-slate-900">{post.title}</h2>}
      <p className="whitespace-pre-wrap break-words text-slate-800">{post.body}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="" className="max-h-96 w-full rounded-lg object-cover" loading="lazy" />}
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <button type="button" disabled={!perms.react || post.status !== "published"} className={`inline-flex items-center gap-1 disabled:opacity-50 ${post.likedByMe ? "text-rose-600" : "hover:text-slate-900"}`} onClick={() => react.mutate({ target: "post", targetId: post.id })} aria-pressed={post.likedByMe} aria-label="Me gusta">
          <Heart className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} aria-hidden="true" />{post.reactions}
        </button>
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />{post.comments} {post.comments === 1 ? "comentario" : "comentarios"}
        </button>
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => save.mutate({ postId: post.id })} aria-pressed={post.savedByMe}>
          {post.savedByMe ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}{post.savedByMe ? "Guardada" : "Guardar"}
        </button>
        {!post.isOwn && post.status === "published" && <ReportButton target="post" targetId={post.id} />}
        {perms.moderate && (
          <span className="ml-auto flex flex-wrap gap-2 text-xs">
            {post.status !== "published" && <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => moderate.mutate({ postId: post.id, action: "publish" })}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{post.status === "pending" ? "Aprobar" : "Mostrar"}</button>}
            {post.status !== "hidden" && <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => { const note = window.prompt("Motivo (opcional):"); if (note !== null) moderate.mutate({ postId: post.id, action: "hide", note: note || null }); }}><EyeOff className="h-3.5 w-3.5" aria-hidden="true" />Ocultar</button>}
            {post.status === "published" && <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => moderate.mutate({ postId: post.id, action: post.pinned ? "unpin" : "pin" })}><Pin className="h-3.5 w-3.5" aria-hidden="true" />{post.pinned ? "Desfijar" : "Fijar"}</button>}
          </span>
        )}
      </div>
      {open && <Comments post={post} perms={perms} />}
    </article>
  );
}

function Members({ communityId, perms }: { communityId: number; perms: Perms }) {
  const utils = trpc.useUtils();
  const list = trpc.communities.member.members.useQuery({ communityId });
  const refresh = () => utils.communities.member.members.invalidate();
  const mod = trpc.communities.member.moderateMember.useMutation({ onSuccess: () => { toast.success("Hecho"); refresh(); }, onError: (e) => toastError(e) });
  const role = trpc.communities.member.setMemberRole.useMutation({ onSuccess: () => { toast.success("Rol actualizado"); refresh(); }, onError: (e) => toastError(e) });
  if (list.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {(list.data ?? []).map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>
            <span className="font-medium text-slate-900">{m.name}</span>
            {m.role !== "member" && <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--portal-accent)]"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{MEMBER_ROLE_LABELS[m.role]}</span>}
            {m.status !== "active" && <span className="ml-2 text-xs text-amber-700">{m.status === "pending" ? "Solicitud pendiente" : m.status === "blocked" ? "Bloqueado" : "Ha salido"}</span>}
            {m.email && <span className="block text-xs text-slate-500">{m.email}</span>}
          </span>
          {perms.moderate && (
            <span className="flex flex-wrap gap-2 text-xs">
              {m.status === "pending" && perms.manageMembers && <Button size="sm" variant="outline" onClick={() => mod.mutate({ memberId: m.id, action: "approve" })}>Aprobar</Button>}
              {m.status === "active" && m.role !== "admin" && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt(`Motivo del bloqueo de ${m.name} (opcional):`); if (reason !== null) mod.mutate({ memberId: m.id, action: "block", reason: reason || null }); }}>Bloquear</Button>}
              {m.status === "blocked" && <Button size="sm" variant="outline" onClick={() => mod.mutate({ memberId: m.id, action: "unblock" })}>Desbloquear</Button>}
              {perms.manageMembers && m.status === "active" && (
                <select aria-label={`Rol de ${m.name}`} className="h-8 rounded-md border border-slate-200 bg-white px-2" value={m.role} onChange={(e) => role.mutate({ memberId: m.id, role: e.target.value as typeof m.role })}>
                  <option value="member">Miembro</option>
                  <option value="moderator">Moderador</option>
                  <option value="admin">Administrador</option>
                </select>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const TABS = ["muro", "encuestas", "propuestas", "guardados", "miembros", "reportes"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { muro: "Muro", encuestas: "Encuestas", propuestas: "Propuestas", guardados: "Guardados", miembros: "Miembros", reportes: "Reportes" };

export default function CommunityHub() {
  const { slug } = useParams<{ slug: string }>();
  const utils = trpc.useUtils();
  const head = trpc.communities.member.community.useQuery({ slug }, { retry: false });
  const c = head.data?.community;
  const active = head.data?.membership?.status === "active";
  const [tab, setTab] = useState<Tab>("muro");
  const feed = trpc.communities.member.feed.useQuery({ communityId: c?.id ?? 0, savedOnly: tab === "guardados" }, { enabled: !!c && active && (tab === "muro" || tab === "guardados") });
  const join = trpc.communities.member.join.useMutation({ onSuccess: () => utils.communities.member.community.invalidate(), onError: (e) => toastError(e) });
  const leave = trpc.communities.member.leave.useMutation({ onSuccess: () => { toast.success("Has salido de la comunidad"); utils.communities.member.community.invalidate(); }, onError: (e) => toastError(e) });

  let content: React.ReactNode;
  if (head.isLoading) content = <p className="text-sm text-slate-500">Cargando…</p>;
  else if (head.isError) {
    content = isUnlicensed(head.error)
      ? <CommunityNotice title="Comunidades no disponibles" text="Esta empresa no tiene activadas las comunidades." />
      : <CommunityNotice title="Comunidad no encontrada" text="No existe o no tienes acceso." action={<Link href="/comunidad" className="text-sm underline">Ver mis comunidades</Link>} />;
  } else if (c) {
    const perms = head.data!.perms;
    const membership = head.data!.membership;
    content = (
      <div className="space-y-5">
        <Link href="/comunidad" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Mis comunidades</Link>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="h-32 bg-[var(--portal-accent)]" style={c.coverImageUrl ? { backgroundImage: `url(${c.coverImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} aria-hidden="true" />
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              {c.logoUrl && <img src={c.logoUrl} alt="" className="-mt-10 h-16 w-16 rounded-xl border-4 border-white bg-white object-cover" />}
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{c.name}</h1>
                {membership?.role && membership.role !== "member" && active && <p className="text-xs font-medium text-[var(--portal-accent)]">{MEMBER_ROLE_LABELS[membership.role]}</p>}
                {c.status === "archived" && <p className="text-xs text-amber-700">Comunidad archivada: solo lectura</p>}
              </div>
            </div>
            {active && <Button variant="ghost" size="sm" onClick={() => { if (window.confirm("¿Salir de la comunidad?")) leave.mutate({ communityId: c.id }); }}>Salir</Button>}
          </div>
          {c.description && <p className="whitespace-pre-wrap px-4 pb-4 text-sm text-slate-600">{c.description}</p>}
        </section>
        {!active ? (
          membership?.status === "pending" ? <CommunityNotice title="Solicitud pendiente" text="La administración de la comunidad revisará tu solicitud." />
          : membership?.status === "blocked" ? <CommunityNotice title="Sin acceso" text="No tienes acceso a esta comunidad." />
          : <CommunityNotice title="Únete para participar" text={c.visibility === "open" ? "Esta comunidad es abierta." : "La administración aprobará tu solicitud."} action={<Button onClick={() => join.mutate({ communityId: c.id })} disabled={join.isPending}>{c.visibility === "open" ? "Unirme" : "Solicitar unirme"}</Button>} />
        ) : (
          <>
            <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Secciones de la comunidad">
              {TABS.filter((t) => t !== "reportes" || perms.moderate).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-[var(--portal-accent)] text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                  {TAB_LABELS[t]}
                </button>
              ))}
            </nav>
            {tab === "miembros" ? <Members communityId={c.id} perms={perms} /> : tab === "encuestas" ? <MemberPolls communityId={c.id} /> : tab === "propuestas" ? <MemberProposals communityId={c.id} perms={perms} /> : tab === "reportes" ? <MemberReports communityId={c.id} /> : (
              <div className="space-y-4">
                {tab === "muro" && <Composer communityId={c.id} perms={perms} />}
                {feed.isLoading ? <p className="text-sm text-slate-500">Cargando…</p> : (feed.data ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{tab === "guardados" ? "No has guardado ninguna publicación." : "Todavía no hay publicaciones."}</p>
                ) : (feed.data ?? []).map((p) => <PostCard key={p.id} post={p} perms={perms} />)}
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  return <CommunityLayout accent={c?.accentColor}>{content}</CommunityLayout>;
}
