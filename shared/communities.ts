/**
 * Social Token Net · Comunidades (capacidad `social-token-net`): lógica pura (sin BD ni React). La usan el servidor
 * (server/communitiesDb.ts), el panel, el área de miembros y las pruebas.
 *
 *  - Una comunidad es de la empresa (su propia base de datos). Sus miembros son usuarios del Core: clientes del CRM
 *    con cuenta de cliente (rol 'user') o usuarios del panel. No hay un segundo sistema de usuarios.
 *  - Roles dentro de la comunidad: administrador, moderador y miembro. Son independientes del rol en el panel: la
 *    administración del panel gestiona todas las comunidades desde /admin/comunidades.
 *  - Nada se borra: las comunidades se archivan, las publicaciones y comentarios se ocultan, los miembros se bloquean
 *    o salen. Activar o desactivar la capacidad nunca pierde datos.
 *
 * Procedencia (Segolife, server/segolife/community): la regla «un nivel de respuesta» de los comentarios, la
 * reacción única por persona con conteo en vivo, los guardados y la sanitización del texto libre
 * (communitySocialDb.ts, communityResponseService.ts::sanitizeOpenText). Sin universidades ni estudiantes.
 */

export const COMMUNITY_CAPABILITY = "social-token-net";

// ─── Comunidad ────────────────────────────────────────────────────────────────

export const VISIBILITIES = ["open", "request", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  open: "Abierta: cualquier cliente con cuenta puede unirse",
  request: "Con solicitud: la administración aprueba cada entrada",
  private: "Privada: solo por alta o invitación",
};
export const VISIBILITY_SHORT: Record<Visibility, string> = { open: "Abierta", request: "Con solicitud", private: "Privada" };

export const POST_MODERATION = ["none", "pre"] as const;
export type PostModeration = (typeof POST_MODERATION)[number];
export const POST_MODERATION_LABELS: Record<PostModeration, string> = {
  none: "Se publican al momento (se pueden ocultar después)",
  pre: "Revisión previa: un moderador aprueba cada publicación de los miembros",
};

export const COMMUNITY_STATUSES = ["active", "archived"] as const;
export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 4000;
export const SLUG_MAX = 80;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const URL_MAX = 512;

/** Identificador de la dirección de la comunidad (`/comunidad/<slug>`) a partir del nombre. */
export function slugify(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return s || "comunidad";
}

/** Solo direcciones https o rutas del propio Core (almacenamiento de ficheros). */
export function isSafeImageUrl(url: string): boolean {
  if (url.length > URL_MAX) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https:\/\/[^\s"'<>]+$/i.test(url);
}

// ─── Miembros ─────────────────────────────────────────────────────────────────

export const MEMBER_ROLES = ["admin", "moderator", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = { admin: "Administrador", moderator: "Moderador", member: "Miembro" };

export const MEMBER_STATUSES = ["active", "pending", "blocked", "left"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = { active: "Activo", pending: "Pendiente de aprobación", blocked: "Bloqueado", left: "Ha salido" };

export const MEMBER_SOURCES = ["admin", "client", "invite", "join"] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];
export const MEMBER_SOURCE_LABELS: Record<MemberSource, string> = { admin: "Alta desde el panel", client: "Cliente del CRM", invite: "Invitación por correo", join: "Se unió desde el área de miembros" };

/** Qué puede hacer cada rol dentro de la comunidad (el servidor lo vuelve a comprobar en cada operación). */
export interface CommunityPermissions {
  read: boolean;
  post: boolean;
  comment: boolean;
  react: boolean;
  /** Ocultar y aprobar publicaciones y comentarios, ver lo oculto. */
  moderate: boolean;
  /** Bloquear y desbloquear miembros (no a administradores). */
  blockMembers: boolean;
  /** Cambiar roles y aprobar solicitudes de entrada. */
  manageMembers: boolean;
  /** Fijar publicaciones y publicar anuncios. */
  announce: boolean;
}

export function permissionsFor(role: MemberRole | null, community: { allowMemberPosts: boolean; status: CommunityStatus }): CommunityPermissions {
  const none: CommunityPermissions = { read: false, post: false, comment: false, react: false, moderate: false, blockMembers: false, manageMembers: false, announce: false };
  if (!role) return none;
  const archived = community.status === "archived";
  const staff = role === "admin" || role === "moderator";
  return {
    read: true,
    post: !archived && (staff || community.allowMemberPosts),
    comment: !archived,
    react: !archived,
    moderate: staff,
    blockMembers: staff,
    manageMembers: role === "admin",
    announce: !archived && staff,
  };
}

/** Estado con el que entra quien se une por su cuenta: null = no puede (privada). */
export function joinStatus(visibility: Visibility): MemberStatus | null {
  if (visibility === "open") return "active";
  if (visibility === "request") return "pending";
  return null;
}

/** ¿Puede un moderador actuar sobre este miembro? Nunca sobre administradores ni sobre sí mismo. */
export function canModerateMember(actor: MemberRole, target: MemberRole, self: boolean): boolean {
  if (self) return false;
  if (actor === "admin") return true;
  return actor === "moderator" && target === "member";
}

// ─── Publicaciones y comentarios ──────────────────────────────────────────────

export const POST_KINDS = ["post", "announcement"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_KIND_LABELS: Record<PostKind, string> = { post: "Publicación", announcement: "Anuncio" };

export const POST_STATUSES = ["published", "pending", "hidden"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_STATUS_LABELS: Record<PostStatus, string> = { published: "Publicada", pending: "Pendiente de revisión", hidden: "Oculta" };

export const TITLE_MAX = 200;
export const POST_BODY_MAX = 5000;
export const COMMENT_MAX = 1000;
export const REASON_MAX = 300;

/** Estado inicial de una publicación: los moderadores publican siempre; los miembros, según la revisión previa. */
export function initialPostStatus(role: MemberRole, moderation: PostModeration): PostStatus {
  if (role === "admin" || role === "moderator") return "published";
  return moderation === "pre" ? "pending" : "published";
}

/**
 * Texto libre de miembros: sin etiquetas HTML, espacios recortados y longitud acotada. Se pinta siempre como texto
 * (nunca como HTML). Reutilizado de Segolife (communityResponseService.ts::sanitizeOpenText).
 */
export function sanitizeText(raw: string, max: number): string {
  return raw.replace(/<[^>]*>/g, "").trim().slice(0, max);
}

/** Un comentario solo puede responder a un comentario principal visible de la misma publicación (un nivel). */
export function replyProblem(parent: { postId: number; parentCommentId: number | null; hidden: boolean } | null, postId: number): string | null {
  if (!parent || parent.postId !== postId || parent.hidden) return "El comentario al que respondes ya no está disponible.";
  if (parent.parentCommentId != null) return "Solo se puede responder a un comentario principal, no a otra respuesta.";
  return null;
}

export const REACTION_TARGETS = ["post", "comment"] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];

// ─── Actividad y eventos de dominio (punto de extensión de las recompensas) ───

/**
 * Hechos de participación que otros módulos pueden escuchar (p. ej. Social Token Net Complete para recompensar con
 * tokens) sin que Comunidades dependa de ellos. Cada hecho tiene una clave única: se registra y se emite una sola vez
 * aunque la acción se repita (quitar y volver a dar «me gusta» no genera un segundo hecho).
 */
export const PARTICIPATION_EVENTS = ["member.joined", "member.posted", "member.commented", "member.reacted"] as const;
export type ParticipationEvent = (typeof PARTICIPATION_EVENTS)[number];

/** Hechos de gestión (no son participación; sirven, p. ej., para retirar recompensas de contenido ocultado). */
export const MANAGEMENT_EVENTS = ["post.hidden", "post.restored", "post.approved", "comment.hidden", "comment.restored", "member.blocked", "member.unblocked", "member.left", "member.role_changed", "member.added"] as const;
export type ManagementEvent = (typeof MANAGEMENT_EVENTS)[number];

export type CommunityEventType = ParticipationEvent | ManagementEvent;

export const ACTIVITY_LABELS: Record<CommunityEventType, string> = {
  "member.joined": "se ha unido a la comunidad",
  "member.posted": "ha publicado",
  "member.commented": "ha comentado",
  "member.reacted": "ha reaccionado",
  "post.hidden": "ha ocultado una publicación",
  "post.restored": "ha vuelto a mostrar una publicación",
  "post.approved": "ha aprobado una publicación",
  "comment.hidden": "ha ocultado un comentario",
  "comment.restored": "ha vuelto a mostrar un comentario",
  "member.blocked": "ha bloqueado a un miembro",
  "member.unblocked": "ha desbloqueado a un miembro",
  "member.left": "ha salido de la comunidad",
  "member.role_changed": "ha cambiado el rol de un miembro",
  "member.added": "ha incorporado a un miembro",
};

export const isParticipationEvent = (t: string): t is ParticipationEvent => (PARTICIPATION_EVENTS as readonly string[]).includes(t);

// ─── Indicadores de participación ─────────────────────────────────────────────

export const PARTICIPATION_WINDOW_DAYS = 30;

export interface EngagementInput {
  activeMembers: number;
  /** Miembros activos con alguna participación (publicar, comentar, reaccionar…) en la ventana. */
  participants: number;
  posts: number;
  comments: number;
  reactions: number;
}

export interface EngagementIndicators {
  participationRate: number;
  interactionsPerPost: number;
  interactionsPerMember: number;
}

/** Porcentajes y medias redondeados; nunca divide por cero. */
export function engagementIndicators(i: EngagementInput): EngagementIndicators {
  const interactions = i.comments + i.reactions;
  return {
    participationRate: i.activeMembers > 0 ? Math.min(100, Math.round((i.participants / i.activeMembers) * 100)) : 0,
    interactionsPerPost: i.posts > 0 ? Math.round((interactions / i.posts) * 10) / 10 : 0,
    interactionsPerMember: i.activeMembers > 0 ? Math.round(((interactions + i.posts) / i.activeMembers) * 10) / 10 : 0,
  };
}

/** Lunes (UTC) de la semana de un instante: agrupa la actividad semanal. */
export function weekStartUtc(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

/** Serie de las últimas `weeks` semanas (la más antigua primero), con ceros donde no hubo actividad. */
export function weeklySeries(timestamps: number[], now: number, weeks = 8): Array<{ weekStart: number; count: number }> {
  const current = weekStartUtc(now);
  const out = Array.from({ length: weeks }, (_, i) => ({ weekStart: current - (weeks - 1 - i) * 7 * 86_400_000, count: 0 }));
  const index = new Map(out.map((w, i) => [w.weekStart, i]));
  for (const t of timestamps) {
    const i = index.get(weekStartUtc(t));
    if (i !== undefined) out[i].count++;
  }
  return out;
}
