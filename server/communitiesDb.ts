/**
 * Social Token Net · Comunidades (capacidad `social-token-net`) — acceso a datos. Lógica pura en shared/communities.ts;
 * eventos de dominio (punto de extensión de recompensas) en server/communities/events.ts.
 *
 *  - Miembros = usuarios del Core. Un cliente del CRM se incorpora con su cuenta de cliente (rol 'user'): si no la
 *    tiene, se crea con una invitación de un solo uso (la misma de las cuentas del Core: `public.setPassword`). Los
 *    usuarios del panel se incorporan con su propia cuenta. Nunca hay un segundo sistema de usuarios.
 *  - Nada se borra: comunidades archivadas, contenido oculto, miembros bloqueados o que salen; «me gusta» y guardados
 *    se desactivan (active = 0). Así activar o desactivar la capacidad nunca pierde datos.
 *  - Aislamiento: cada empresa tiene su base de datos; todas las consultas van por getDb() del tenant de la petición.
 *
 * Las tablas (migración db/migrations/0026_communities) no están en `drizzle/schema.ts` a propósito, como el
 * inventario: el resto del código no depende de que la migración esté aplicada.
 *
 * Reutilizado de Segolife (server/segolife/community/communitySocialDb.ts): comentarios con un nivel de respuesta,
 * listado de raíces + respuestas sin N+1, reacción única por persona (clave única + carrera idempotente), guardados,
 * conteos siempre en vivo y moderación por ocultación. Adaptado: comunidades y miembros genéricos (sin universidades
 * ni estudiantes) y SQL de la empresa en lugar de la conexión global.
 */
import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, createInvitedUser, resendUserInvite } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { recordCommunityEvent, dispatchCommunityEvent, type CommunityDomainEvent, type CommunityExec } from "./communities/events";
import {
  COMMUNITY_CAPABILITY,
  PARTICIPATION_WINDOW_DAYS,
  canModerateMember,
  engagementIndicators,
  initialPostStatus,
  joinStatus,
  permissionsFor,
  replyProblem,
  slugify,
  weeklySeries,
  type CommunityPermissions,
  type CommunityStatus,
  type MemberRole,
  type MemberSource,
  type MemberStatus,
  type PostKind,
  type PostModeration,
  type PostStatus,
  type ReactionTarget,
  type Visibility,
} from "../shared/communities";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function rows<T>(q: SQL, exec?: CommunityExec): Promise<T[]> {
  const [r] = (await (exec ?? (await db())).execute(q)) as unknown as [T[]];
  return r;
}

async function header(q: SQL, exec?: CommunityExec): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await (exec ?? (await db())).execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r.affectedRows ?? 0), insertId: Number(r.insertId ?? 0) };
}

const n = (v: unknown) => Number(v ?? 0);
const b = (v: unknown) => v === 1 || v === true || v === "1";

// ─── Licencia ─────────────────────────────────────────────────────────────────

/** ¿Incluye el plan las comunidades? (`write`: activa; sin `write`: activa o solo lectura). Si no puede verificarse, no. */
export async function communitiesLicensed(write: boolean): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(COMMUNITY_CAPABILITY, { write })).allowed;
  } catch {
    return false;
  }
}

export async function assertCommunities(write: boolean): Promise<void> {
  if (!(await communitiesLicensed(write))) throw new TRPCError({ code: "FORBIDDEN", message: "Las comunidades no están incluidas en tu plan." });
}

// ─── Comunidades ──────────────────────────────────────────────────────────────

export interface Community {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  visibility: Visibility;
  allowMemberPosts: boolean;
  postModeration: PostModeration;
  status: CommunityStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

const COMMUNITY_COLS = sql`id, slug, name, description, cover_image_url, logo_url, accent_color, visibility, allow_member_posts, post_moderation, status, created_at, updated_at, archived_at`;

function toCommunity(r: Record<string, unknown>): Community {
  return {
    id: n(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    coverImageUrl: (r.cover_image_url as string | null) ?? null,
    logoUrl: (r.logo_url as string | null) ?? null,
    accentColor: (r.accent_color as string | null) ?? null,
    visibility: (["open", "request", "private"].includes(String(r.visibility)) ? r.visibility : "private") as Visibility,
    allowMemberPosts: b(r.allow_member_posts),
    postModeration: (r.post_moderation === "pre" ? "pre" : "none") as PostModeration,
    status: (r.status === "archived" ? "archived" : "active") as CommunityStatus,
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
    archivedAt: r.archived_at == null ? null : n(r.archived_at),
  };
}

export async function getCommunity(id: number): Promise<Community | null> {
  const [r] = await rows<Record<string, unknown>>(sql`SELECT ${COMMUNITY_COLS} FROM communities WHERE id = ${id}`);
  return r ? toCommunity(r) : null;
}

export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const [r] = await rows<Record<string, unknown>>(sql`SELECT ${COMMUNITY_COLS} FROM communities WHERE slug = ${slug}`);
  return r ? toCommunity(r) : null;
}

export async function requireCommunity(id: number): Promise<Community> {
  const c = await getCommunity(id);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comunidad no encontrada." });
  return c;
}

export interface CommunitySummary extends Community {
  activeMembers: number;
  pendingMembers: number;
  posts: number;
  pendingPosts: number;
  lastActivityAt: number | null;
}

/** Todas las comunidades de la empresa con sus cifras básicas (panel). */
export async function listCommunities(): Promise<CommunitySummary[]> {
  const list = await rows<Record<string, unknown>>(sql`SELECT ${COMMUNITY_COLS} FROM communities ORDER BY status ASC, name ASC`);
  if (!list.length) return [];
  const members = await rows<{ community_id: number; status: string; c: number }>(sql`SELECT community_id, status, COUNT(*) AS c FROM community_members GROUP BY community_id, status`);
  const posts = await rows<{ community_id: number; status: string; c: number }>(sql`SELECT community_id, status, COUNT(*) AS c FROM community_posts GROUP BY community_id, status`);
  const last = await rows<{ community_id: number; t: number }>(sql`SELECT community_id, MAX(created_at) AS t FROM community_activity GROUP BY community_id`);
  const count = (arr: Array<{ community_id: number; status: string; c: number }>, id: number, status: string) => n(arr.find((x) => n(x.community_id) === id && x.status === status)?.c);
  return list.map((r) => {
    const c = toCommunity(r);
    const lastRow = last.find((x) => n(x.community_id) === c.id);
    return {
      ...c,
      activeMembers: count(members, c.id, "active"),
      pendingMembers: count(members, c.id, "pending"),
      posts: count(posts, c.id, "published"),
      pendingPosts: count(posts, c.id, "pending"),
      lastActivityAt: lastRow?.t == null ? null : n(lastRow.t),
    };
  });
}

export interface CommunityInput {
  name: string;
  slug?: string;
  description?: string | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
  visibility: Visibility;
  allowMemberPosts: boolean;
  postModeration: PostModeration;
}

async function freeSlug(base: string, exceptId?: number): Promise<string> {
  const taken = new Set(
    (await rows<{ slug: string; id: number }>(sql`SELECT slug, id FROM communities WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`))
      .filter((r) => n(r.id) !== exceptId)
      .map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 74)}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base.slice(0, 60)}-${randomBytes(4).toString("hex")}`;
}

export async function createCommunity(input: CommunityInput, actorId: number): Promise<Community> {
  const now = Date.now();
  const slug = await freeSlug(slugify(input.slug || input.name));
  const { insertId } = await header(sql`INSERT INTO communities (slug, name, description, cover_image_url, logo_url, accent_color, visibility, allow_member_posts, post_moderation, status, created_by, created_at, updated_at)
    VALUES (${slug}, ${input.name}, ${input.description ?? null}, ${input.coverImageUrl ?? null}, ${input.logoUrl ?? null}, ${input.accentColor ?? null}, ${input.visibility}, ${input.allowMemberPosts ? 1 : 0}, ${input.postModeration}, 'active', ${actorId}, ${now}, ${now})`);
  return (await getCommunity(insertId))!;
}

export async function updateCommunity(id: number, input: CommunityInput): Promise<Community> {
  const current = await requireCommunity(id);
  const slug = input.slug && slugify(input.slug) !== current.slug ? await freeSlug(slugify(input.slug), id) : current.slug;
  await header(sql`UPDATE communities SET slug = ${slug}, name = ${input.name}, description = ${input.description ?? null}, cover_image_url = ${input.coverImageUrl ?? null},
    logo_url = ${input.logoUrl ?? null}, accent_color = ${input.accentColor ?? null}, visibility = ${input.visibility}, allow_member_posts = ${input.allowMemberPosts ? 1 : 0},
    post_moderation = ${input.postModeration}, updated_at = ${Date.now()} WHERE id = ${id}`);
  return (await getCommunity(id))!;
}

/** Archivar (solo lectura para los miembros) o reactivar. Nunca borra nada. */
export async function setCommunityStatus(id: number, status: CommunityStatus): Promise<Community> {
  await requireCommunity(id);
  const now = Date.now();
  await header(sql`UPDATE communities SET status = ${status}, archived_at = ${status === "archived" ? now : null}, updated_at = ${now} WHERE id = ${id}`);
  return (await getCommunity(id))!;
}

// ─── Miembros ─────────────────────────────────────────────────────────────────

export interface Member {
  id: number;
  communityId: number;
  userId: number;
  clientId: number | null;
  role: MemberRole;
  status: MemberStatus;
  source: MemberSource;
  statusReason: string | null;
  joinedAt: number | null;
  lastSeenAt: number | null;
  createdAt: number;
  name: string;
  email: string | null;
  /** Rol del usuario en el Core ('user' = cuenta de cliente). */
  accountRole: string | null;
  /** La cuenta aún no tiene contraseña (invitación pendiente). */
  invitePending: boolean;
}

const MEMBER_SELECT = sql`SELECT m.id, m.community_id, m.user_id, m.client_id, m.role, m.status, m.source, m.status_reason, m.joined_at, m.last_seen_at, m.created_at,
  u.name AS user_name, u.email AS user_email, u.role AS account_role, u.inviteAccepted AS invite_accepted, u.passwordHash IS NOT NULL AS has_password, c.name AS client_name
  FROM community_members m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN clients c ON c.id = m.client_id`;

function toMember(r: Record<string, unknown>): Member {
  const email = (r.user_email as string | null) ?? null;
  return {
    id: n(r.id),
    communityId: n(r.community_id),
    userId: n(r.user_id),
    clientId: r.client_id == null ? null : n(r.client_id),
    role: (["admin", "moderator"].includes(String(r.role)) ? r.role : "member") as MemberRole,
    status: (["active", "pending", "blocked", "left"].includes(String(r.status)) ? r.status : "active") as MemberStatus,
    source: (["admin", "client", "invite", "join"].includes(String(r.source)) ? r.source : "admin") as MemberSource,
    statusReason: (r.status_reason as string | null) ?? null,
    joinedAt: r.joined_at == null ? null : n(r.joined_at),
    lastSeenAt: r.last_seen_at == null ? null : n(r.last_seen_at),
    createdAt: n(r.created_at),
    name: String(r.client_name || r.user_name || email || `Usuario ${n(r.user_id)}`),
    email,
    accountRole: (r.account_role as string | null) ?? null,
    invitePending: !b(r.has_password),
  };
}

export async function listMembers(communityId: number, filter: { status?: MemberStatus; search?: string } = {}): Promise<Member[]> {
  const conds: SQL[] = [sql`m.community_id = ${communityId}`];
  if (filter.status) conds.push(sql`m.status = ${filter.status}`);
  if (filter.search?.trim()) {
    const like = `%${filter.search.trim()}%`;
    conds.push(sql`(u.name LIKE ${like} OR u.email LIKE ${like} OR c.name LIKE ${like})`);
  }
  const list = await rows<Record<string, unknown>>(sql`${MEMBER_SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY FIELD(m.status, 'pending', 'active', 'blocked', 'left'), FIELD(m.role, 'admin', 'moderator', 'member'), m.created_at DESC LIMIT 1000`);
  return list.map(toMember);
}

export async function getMember(id: number): Promise<Member | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${MEMBER_SELECT} WHERE m.id = ${id}`);
  return r ? toMember(r) : null;
}

export async function memberOf(communityId: number, userId: number): Promise<Member | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${MEMBER_SELECT} WHERE m.community_id = ${communityId} AND m.user_id = ${userId}`);
  return r ? toMember(r) : null;
}

/** Clientes del CRM y usuarios del panel que aún no son miembros (para incorporarlos). */
export async function memberCandidates(communityId: number, search: string): Promise<{ clients: Array<{ id: number; name: string; email: string; hasAccount: boolean }>; users: Array<{ id: number; name: string; email: string | null; role: string }> }> {
  const like = `%${search.trim()}%`;
  const clients = await rows<{ id: number; name: string; email: string; user_id: number | null }>(sql`SELECT c.id, c.name, c.email, u.id AS user_id FROM clients c
    LEFT JOIN users u ON u.email = c.email
    WHERE (c.name LIKE ${like} OR c.email LIKE ${like}) AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = ${communityId} AND (m.client_id = c.id OR (u.id IS NOT NULL AND m.user_id = u.id)) AND m.status <> 'left')
    ORDER BY c.name ASC LIMIT 25`);
  const users = await rows<{ id: number; name: string | null; email: string | null; role: string }>(sql`SELECT u.id, u.name, u.email, u.role FROM users u
    WHERE u.role IN ('admin', 'agente', 'controler', 'adminrest') AND u.isActive = 1 AND (u.name LIKE ${like} OR u.email LIKE ${like})
      AND NOT EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = ${communityId} AND m.user_id = u.id AND m.status <> 'left')
    ORDER BY u.name ASC LIMIT 25`);
  return {
    clients: clients.map((c) => ({ id: n(c.id), name: c.name, email: c.email, hasAccount: c.user_id != null })),
    users: users.map((u) => ({ id: n(u.id), name: u.name || u.email || `Usuario ${u.id}`, email: u.email, role: u.role })),
  };
}

/** Invitación de cuenta a enviar por correo (el enlace lleva el token en claro; la BD solo guarda su hash). */
export interface AccountInvite {
  userId: number;
  name: string;
  email: string;
  token: string;
}

const INVITE_TTL_MS = 7 * 24 * 3600_000;

/**
 * Cuenta del Core para una persona: la existente por correo o una nueva de cliente (rol 'user') con invitación. Si la
 * cuenta existe pero nunca se activó (sin contraseña), se renueva la invitación. Nunca cambia el rol de una cuenta.
 */
export async function ensureAccount(name: string, email: string): Promise<{ userId: number; invite: AccountInvite | null; created: boolean }> {
  const clean = email.trim().toLowerCase();
  const [u] = await rows<{ id: number; name: string | null; has_password: number }>(sql`SELECT id, name, passwordHash IS NOT NULL AS has_password FROM users WHERE LOWER(email) = ${clean} LIMIT 1`);
  const token = randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + INVITE_TTL_MS);
  if (u) {
    if (b(u.has_password)) return { userId: n(u.id), invite: null, created: false };
    await resendUserInvite(n(u.id), token, expiry);
    return { userId: n(u.id), invite: { userId: n(u.id), name: u.name || name, email: clean, token }, created: false };
  }
  const { id } = await createInvitedUser({ name: name.trim() || clean, email: clean, role: "user", inviteToken: token, inviteTokenExpiry: expiry });
  return { userId: id, invite: { userId: id, name: name.trim() || clean, email: clean, token }, created: true };
}

/** ¿Ya está dentro (activo o bloqueado) la cuenta con ese correo? Entonces no se toca su invitación. */
async function alreadyInside(communityId: number, email: string): Promise<{ userId: number; memberId: number } | null> {
  const [r] = await rows<{ user_id: number; id: number }>(sql`SELECT m.user_id, m.id FROM community_members m JOIN users u ON u.id = m.user_id
    WHERE m.community_id = ${communityId} AND LOWER(u.email) = ${email.trim().toLowerCase()} AND m.status IN ('active', 'blocked') LIMIT 1`);
  return r ? { userId: n(r.user_id), memberId: n(r.id) } : null;
}

export interface AddResult {
  name: string;
  email: string | null;
  result: "added" | "reactivated" | "already";
  memberId: number;
  invite: AccountInvite | null;
}

/**
 * Alta de una persona en la comunidad (activa). Si ya era miembro activo o pendiente, no cambia nada (pendiente pasa a
 * activo); si había salido, vuelve. Un bloqueado sigue bloqueado: se desbloquea expresamente.
 */
async function upsertMember(communityId: number, userId: number, clientId: number | null, role: MemberRole, source: MemberSource, actorId: number | null): Promise<{ memberId: number; result: AddResult["result"]; events: Array<CommunityDomainEvent | null> }> {
  const now = Date.now();
  const existing = await memberOf(communityId, userId);
  const events: Array<CommunityDomainEvent | null> = [];
  if (!existing) {
    const { insertId } = await header(sql`INSERT INTO community_members (community_id, user_id, client_id, role, status, source, added_by, joined_at, created_at, updated_at)
      VALUES (${communityId}, ${userId}, ${clientId}, ${role}, 'active', ${source}, ${actorId}, ${now}, ${now}, ${now})`);
    events.push(await recordCommunityEvent(await db(), { key: `member.added:${communityId}:${userId}:${now}`, type: "member.added", communityId, userId: actorId, targetType: "member", targetId: insertId, now }));
    events.push(await recordCommunityEvent(await db(), { key: `member.joined:${communityId}:${userId}`, type: "member.joined", communityId, userId, targetType: "member", targetId: insertId, now }));
    return { memberId: insertId, result: "added", events };
  }
  if (existing.status === "active" || existing.status === "blocked") {
    if (clientId && !existing.clientId) await header(sql`UPDATE community_members SET client_id = ${clientId}, updated_at = ${now} WHERE id = ${existing.id}`);
    return { memberId: existing.id, result: "already", events };
  }
  await header(sql`UPDATE community_members SET status = 'active', role = ${existing.status === "left" ? role : existing.role}, client_id = COALESCE(client_id, ${clientId}), status_reason = NULL, joined_at = ${now}, updated_at = ${now} WHERE id = ${existing.id}`);
  events.push(await recordCommunityEvent(await db(), { key: `member.joined:${communityId}:${userId}`, type: "member.joined", communityId, userId, targetType: "member", targetId: existing.id, now }));
  return { memberId: existing.id, result: "reactivated", events };
}

/** Incorpora clientes del CRM (con su cuenta de cliente) y usuarios del panel. Devuelve las invitaciones a enviar. */
export async function addMembers(communityId: number, input: { clientIds: number[]; userIds: number[]; role: MemberRole }, actorId: number): Promise<AddResult[]> {
  const out: AddResult[] = [];
  const events: Array<CommunityDomainEvent | null> = [];
  const clientIds = Array.from(new Set(input.clientIds));
  const userIds = Array.from(new Set(input.userIds));
  if (clientIds.length) {
    const clients = await rows<{ id: number; name: string; email: string }>(sql`SELECT id, name, email FROM clients WHERE id IN (${sql.join(clientIds.map((i) => sql`${i}`), sql`, `)})`);
    for (const c of clients) {
      if (!c.email) continue;
      const inside = await alreadyInside(communityId, c.email);
      if (inside) {
        out.push({ name: c.name, email: c.email, result: "already", memberId: inside.memberId, invite: null });
        continue;
      }
      const acc = await ensureAccount(c.name, c.email);
      const r = await upsertMember(communityId, acc.userId, n(c.id), input.role, "client", actorId);
      events.push(...r.events);
      out.push({ name: c.name, email: c.email, result: r.result, memberId: r.memberId, invite: r.result === "already" ? null : acc.invite });
    }
  }
  if (userIds.length) {
    const users = await rows<{ id: number; name: string | null; email: string | null; role: string }>(sql`SELECT id, name, email, role FROM users WHERE id IN (${sql.join(userIds.map((i) => sql`${i}`), sql`, `)})`);
    for (const u of users) {
      const [client] = u.email ? await rows<{ id: number }>(sql`SELECT id FROM clients WHERE email = ${u.email} LIMIT 1`) : [];
      const r = await upsertMember(communityId, n(u.id), client ? n(client.id) : null, input.role, "admin", actorId);
      events.push(...r.events);
      out.push({ name: u.name || u.email || `Usuario ${u.id}`, email: u.email, result: r.result, memberId: r.memberId, invite: null });
    }
  }
  for (const e of events) await dispatchCommunityEvent(e);
  return out;
}

/** Invitación por correo a alguien que quizá no es cliente: cuenta de cliente nueva o la existente, enlazada a su cliente del CRM si lo hay. */
export async function inviteMember(communityId: number, input: { name: string; email: string; role: MemberRole }, actorId: number): Promise<AddResult> {
  const inside = await alreadyInside(communityId, input.email);
  if (inside) return { name: input.name, email: input.email.trim().toLowerCase(), result: "already", memberId: inside.memberId, invite: null };
  const acc = await ensureAccount(input.name, input.email);
  const [client] = await rows<{ id: number }>(sql`SELECT id FROM clients WHERE LOWER(email) = ${input.email.trim().toLowerCase()} LIMIT 1`);
  const r = await upsertMember(communityId, acc.userId, client ? n(client.id) : null, input.role, "invite", actorId);
  for (const e of r.events) await dispatchCommunityEvent(e);
  return { name: input.name, email: input.email.trim().toLowerCase(), result: r.result, memberId: r.memberId, invite: r.result === "already" ? null : acc.invite };
}

/** Nueva invitación de cuenta para un miembro que aún no ha creado su contraseña (null si ya la tiene). */
export async function renewMemberInvite(memberId: number): Promise<AccountInvite | null> {
  const m = await getMember(memberId);
  if (!m || !m.email || !m.invitePending) return null;
  const token = randomBytes(32).toString("hex");
  await resendUserInvite(m.userId, token, new Date(Date.now() + INVITE_TTL_MS));
  return { userId: m.userId, name: m.name, email: m.email, token };
}

export async function setMemberRole(member: Member, role: MemberRole, actorId: number): Promise<void> {
  if (member.role === role) return;
  const now = Date.now();
  await header(sql`UPDATE community_members SET role = ${role}, updated_at = ${now} WHERE id = ${member.id}`);
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.role_changed:${member.id}:${now}`, type: "member.role_changed", communityId: member.communityId, userId: actorId, targetType: "member", targetId: member.id, data: { from: member.role, to: role }, now }));
}

export type MemberAction = "approve" | "block" | "unblock" | "remove";

/** Aprobar una solicitud, bloquear, desbloquear o dar de baja (estado «ha salido»: conserva su contenido). */
export async function setMemberStatus(member: Member, action: MemberAction, reason: string | null, actorId: number): Promise<MemberStatus> {
  const now = Date.now();
  const next: MemberStatus = action === "block" ? "blocked" : action === "remove" ? "left" : "active";
  if (action === "approve" && member.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Esa persona no tiene una solicitud pendiente." });
  if (action === "unblock" && member.status !== "blocked") throw new TRPCError({ code: "BAD_REQUEST", message: "Esa persona no está bloqueada." });
  if (member.status === next) return next;
  await header(sql`UPDATE community_members SET status = ${next}, status_reason = ${action === "block" ? reason : null}, joined_at = ${next === "active" && member.status === "pending" ? now : member.joinedAt}, updated_at = ${now} WHERE id = ${member.id}`);
  const ev =
    action === "approve"
      ? await recordCommunityEvent(await db(), { key: `member.joined:${member.communityId}:${member.userId}`, type: "member.joined", communityId: member.communityId, userId: member.userId, targetType: "member", targetId: member.id, now })
      : await recordCommunityEvent(await db(), {
          key: `${action === "block" ? "member.blocked" : action === "unblock" ? "member.unblocked" : "member.left"}:${member.id}:${now}`,
          type: action === "block" ? "member.blocked" : action === "unblock" ? "member.unblocked" : "member.left",
          communityId: member.communityId,
          userId: actorId,
          targetType: "member",
          targetId: member.id,
          data: reason ? { reason } : null,
          now,
        });
  await dispatchCommunityEvent(ev);
  return next;
}

/** El propio miembro se une (según la visibilidad) o sale. */
export async function joinCommunity(community: Community, userId: number): Promise<MemberStatus> {
  if (community.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta comunidad está archivada." });
  const existing = await memberOf(community.id, userId);
  if (existing?.status === "blocked") throw new TRPCError({ code: "FORBIDDEN", message: "No puedes unirte a esta comunidad." });
  if (existing?.status === "active" || existing?.status === "pending") return existing.status;
  const status = joinStatus(community.visibility);
  if (!status) throw new TRPCError({ code: "FORBIDDEN", message: "Esta comunidad es privada: solo se entra por invitación." });
  const now = Date.now();
  const [u] = await rows<{ email: string | null }>(sql`SELECT email FROM users WHERE id = ${userId}`);
  const [client] = u?.email ? await rows<{ id: number }>(sql`SELECT id FROM clients WHERE email = ${u.email} LIMIT 1`) : [];
  let memberId: number;
  if (existing) {
    memberId = existing.id;
    await header(sql`UPDATE community_members SET status = ${status}, role = 'member', source = 'join', status_reason = NULL, joined_at = ${status === "active" ? now : null}, updated_at = ${now} WHERE id = ${existing.id}`);
  } else {
    memberId = (await header(sql`INSERT INTO community_members (community_id, user_id, client_id, role, status, source, joined_at, created_at, updated_at)
      VALUES (${community.id}, ${userId}, ${client ? n(client.id) : null}, 'member', ${status}, 'join', ${status === "active" ? now : null}, ${now}, ${now})`)).insertId;
  }
  if (status === "active") await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.joined:${community.id}:${userId}`, type: "member.joined", communityId: community.id, userId, targetType: "member", targetId: memberId, now }));
  return status;
}

export async function leaveCommunity(member: Member): Promise<void> {
  if (member.status === "left" || member.status === "blocked") return;
  const now = Date.now();
  await header(sql`UPDATE community_members SET status = 'left', updated_at = ${now} WHERE id = ${member.id}`);
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.left:${member.id}:${now}`, type: "member.left", communityId: member.communityId, userId: member.userId, targetType: "member", targetId: member.id, now }));
}

export async function touchMember(memberId: number): Promise<void> {
  await header(sql`UPDATE community_members SET last_seen_at = ${Date.now()} WHERE id = ${memberId}`);
}

export interface MyCommunity {
  community: Community;
  role: MemberRole | null;
  status: MemberStatus | null;
  activeMembers: number;
}

/** Comunidades del usuario y las abiertas o con solicitud a las que puede unirse (área de miembros). */
export async function myCommunities(userId: number): Promise<{ mine: MyCommunity[]; available: MyCommunity[] }> {
  const list = (await rows<Record<string, unknown>>(sql`SELECT ${COMMUNITY_COLS} FROM communities WHERE status = 'active' ORDER BY name ASC`)).map(toCommunity);
  if (!list.length) return { mine: [], available: [] };
  const mineRows = await rows<{ community_id: number; role: string; status: string }>(sql`SELECT community_id, role, status FROM community_members WHERE user_id = ${userId}`);
  const counts = await rows<{ community_id: number; c: number }>(sql`SELECT community_id, COUNT(*) AS c FROM community_members WHERE status = 'active' GROUP BY community_id`);
  const mine: MyCommunity[] = [];
  const available: MyCommunity[] = [];
  for (const c of list) {
    const m = mineRows.find((x) => n(x.community_id) === c.id);
    const item: MyCommunity = { community: c, role: (m?.role as MemberRole) ?? null, status: (m?.status as MemberStatus) ?? null, activeMembers: n(counts.find((x) => n(x.community_id) === c.id)?.c) };
    if (m && (m.status === "active" || m.status === "pending")) mine.push(item);
    else if (m?.status !== "blocked" && c.visibility !== "private") available.push(item);
  }
  return { mine, available };
}

// ─── Acceso del miembro ───────────────────────────────────────────────────────

export interface MemberContext {
  community: Community;
  member: Member;
  perms: CommunityPermissions;
}

/** Miembro activo de la comunidad o FORBIDDEN (bloqueado, pendiente o ajeno). */
export async function requireActiveMember(communityId: number, userId: number): Promise<MemberContext> {
  const community = await requireCommunity(communityId);
  const member = await memberOf(communityId, userId);
  if (!member || member.status !== "active") {
    const message = member?.status === "pending" ? "Tu solicitud para unirte está pendiente de aprobación." : member?.status === "blocked" ? "No tienes acceso a esta comunidad." : "No eres miembro de esta comunidad.";
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  return { community, member, perms: permissionsFor(member.role, community) };
}

// ─── Publicaciones ────────────────────────────────────────────────────────────

export interface Post {
  id: number;
  communityId: number;
  authorUserId: number;
  authorName: string;
  kind: PostKind;
  title: string | null;
  body: string;
  imageUrl: string | null;
  pinned: boolean;
  status: PostStatus;
  moderationNote: string | null;
  moderatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeedPost extends Post {
  comments: number;
  reactions: number;
  likedByMe: boolean;
  savedByMe: boolean;
  isOwn: boolean;
}

const POST_SELECT = sql`SELECT p.id, p.community_id, p.author_user_id, p.kind, p.title, p.body, p.image_url, p.pinned, p.status, p.moderation_note, p.moderated_at, p.created_at, p.updated_at,
  COALESCE(cl.name, u.name, u.email) AS author_name
  FROM community_posts p LEFT JOIN users u ON u.id = p.author_user_id
  LEFT JOIN community_members mm ON mm.community_id = p.community_id AND mm.user_id = p.author_user_id
  LEFT JOIN clients cl ON cl.id = mm.client_id`;

function toPost(r: Record<string, unknown>): Post {
  return {
    id: n(r.id),
    communityId: n(r.community_id),
    authorUserId: n(r.author_user_id),
    authorName: String(r.author_name || `Usuario ${n(r.author_user_id)}`),
    kind: (r.kind === "announcement" ? "announcement" : "post") as PostKind,
    title: (r.title as string | null) ?? null,
    body: String(r.body ?? ""),
    imageUrl: (r.image_url as string | null) ?? null,
    pinned: b(r.pinned),
    status: (["published", "pending", "hidden"].includes(String(r.status)) ? r.status : "published") as PostStatus,
    moderationNote: (r.moderation_note as string | null) ?? null,
    moderatedAt: r.moderated_at == null ? null : n(r.moderated_at),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
  };
}

export async function getPost(id: number): Promise<Post | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${POST_SELECT} WHERE p.id = ${id}`);
  return r ? toPost(r) : null;
}

export async function requirePost(id: number): Promise<Post> {
  const p = await getPost(id);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Publicación no encontrada." });
  return p;
}

/** ¿Puede este espectador ver la publicación? Publicadas: todos; pendientes u ocultas: su autor y la moderación. */
export function canSeePost(post: Pick<Post, "status" | "authorUserId">, viewerId: number, moderate: boolean): boolean {
  return post.status === "published" || moderate || post.authorUserId === viewerId;
}

async function enrich(list: Post[], viewerId: number): Promise<FeedPost[]> {
  if (!list.length) return [];
  const ids = sql.join(list.map((p) => sql`${p.id}`), sql`, `);
  const comments = await rows<{ post_id: number; c: number }>(sql`SELECT post_id, COUNT(*) AS c FROM community_comments WHERE hidden = 0 AND post_id IN (${ids}) GROUP BY post_id`);
  const reactions = await rows<{ target_id: number; c: number; mine: number }>(sql`SELECT target_id, COUNT(*) AS c, SUM(user_id = ${viewerId}) AS mine FROM community_reactions WHERE target_type = 'post' AND active = 1 AND target_id IN (${ids}) GROUP BY target_id`);
  const saves = await rows<{ post_id: number }>(sql`SELECT post_id FROM community_saves WHERE user_id = ${viewerId} AND active = 1 AND post_id IN (${ids})`);
  const saved = new Set(saves.map((s) => n(s.post_id)));
  return list.map((p) => {
    const r = reactions.find((x) => n(x.target_id) === p.id);
    return {
      ...p,
      comments: n(comments.find((x) => n(x.post_id) === p.id)?.c),
      reactions: n(r?.c),
      likedByMe: n(r?.mine) > 0,
      savedByMe: saved.has(p.id),
      isOwn: p.authorUserId === viewerId,
    };
  });
}

export const FEED_PAGE = 20;

/** Muro de la comunidad: fijadas primero y después lo más reciente. `before`: paginación por fecha de creación. */
export async function listFeed(communityId: number, viewerId: number, opts: { moderate: boolean; savedOnly?: boolean; before?: number; limit?: number }): Promise<FeedPost[]> {
  const limit = Math.min(opts.limit ?? FEED_PAGE, 50);
  const conds: SQL[] = [sql`p.community_id = ${communityId}`];
  if (!opts.moderate) conds.push(sql`(p.status = 'published' OR p.author_user_id = ${viewerId})`);
  if (opts.savedOnly) conds.push(sql`EXISTS (SELECT 1 FROM community_saves s WHERE s.post_id = p.id AND s.user_id = ${viewerId} AND s.active = 1)`);
  if (opts.before) conds.push(sql`p.created_at < ${opts.before} AND p.pinned = 0`);
  const order = opts.before ? sql`p.created_at DESC` : sql`p.pinned DESC, p.created_at DESC`;
  const list = (await rows<Record<string, unknown>>(sql`${POST_SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY ${order}, p.id DESC LIMIT ${limit}`)).map(toPost);
  return enrich(list, viewerId);
}

/** Publicaciones para la moderación del panel (todas o por estado). */
export async function listPostsForAdmin(communityId: number, status?: PostStatus): Promise<FeedPost[]> {
  const conds: SQL[] = [sql`p.community_id = ${communityId}`];
  if (status) conds.push(sql`p.status = ${status}`);
  const list = (await rows<Record<string, unknown>>(sql`${POST_SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY p.created_at DESC LIMIT 200`)).map(toPost);
  return enrich(list, 0);
}

export interface NewPost {
  kind: PostKind;
  title: string | null;
  body: string;
  imageUrl: string | null;
  pinned: boolean;
}

/** Publica (o deja pendiente de revisión). Emite `member.posted` solo cuando queda publicada. */
export async function createPost(community: Community, author: { userId: number; role: MemberRole }, input: NewPost): Promise<Post> {
  const now = Date.now();
  const status = initialPostStatus(author.role, community.postModeration);
  const { insertId } = await header(sql`INSERT INTO community_posts (community_id, author_user_id, kind, title, body, image_url, pinned, status, created_at, updated_at)
    VALUES (${community.id}, ${author.userId}, ${input.kind}, ${input.title}, ${input.body}, ${input.imageUrl}, ${input.pinned ? 1 : 0}, ${status}, ${now}, ${now})`);
  if (status === "published") await emitPosted(community.id, insertId, author.userId, now);
  return (await getPost(insertId))!;
}

async function emitPosted(communityId: number, postId: number, userId: number, now = Date.now()): Promise<void> {
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.posted:${postId}`, type: "member.posted", communityId, userId, targetType: "post", targetId: postId, now }));
}

/** Moderación de una publicación: aprobar o volver a mostrar ('published') u ocultar ('hidden'). */
export async function setPostStatus(post: Post, status: "published" | "hidden", actorId: number, note: string | null): Promise<void> {
  if (post.status === status) return;
  const now = Date.now();
  await header(sql`UPDATE community_posts SET status = ${status}, moderated_by = ${actorId}, moderated_at = ${now}, moderation_note = ${note}, updated_at = ${now} WHERE id = ${post.id}`);
  const type = status === "hidden" ? "post.hidden" : post.status === "pending" ? "post.approved" : "post.restored";
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `${type}:${post.id}:${now}`, type, communityId: post.communityId, userId: actorId, targetType: "post", targetId: post.id, data: { authorUserId: post.authorUserId, ...(note ? { note } : {}) }, now }));
  // Una publicación aprobada cuenta como participación de su autor (una sola vez)
  if (status === "published" && post.status === "pending") await emitPosted(post.communityId, post.id, post.authorUserId, now);
}

export async function setPostPinned(post: Post, pinned: boolean): Promise<void> {
  await header(sql`UPDATE community_posts SET pinned = ${pinned ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${post.id}`);
}

// ─── Comentarios ──────────────────────────────────────────────────────────────

export interface Comment {
  id: number;
  postId: number;
  communityId: number;
  authorUserId: number;
  authorName: string;
  parentCommentId: number | null;
  body: string;
  hidden: boolean;
  createdAt: number;
}

export interface CommentNode extends Comment {
  isOwn: boolean;
  likes: number;
  likedByMe: boolean;
  replies: CommentNode[];
}

const COMMENT_SELECT = sql`SELECT k.id, k.post_id, k.community_id, k.author_user_id, k.parent_comment_id, k.body, k.hidden, k.created_at,
  COALESCE(cl.name, u.name, u.email) AS author_name
  FROM community_comments k LEFT JOIN users u ON u.id = k.author_user_id
  LEFT JOIN community_members mm ON mm.community_id = k.community_id AND mm.user_id = k.author_user_id
  LEFT JOIN clients cl ON cl.id = mm.client_id`;

function toComment(r: Record<string, unknown>): Comment {
  return {
    id: n(r.id),
    postId: n(r.post_id),
    communityId: n(r.community_id),
    authorUserId: n(r.author_user_id),
    authorName: String(r.author_name || `Usuario ${n(r.author_user_id)}`),
    parentCommentId: r.parent_comment_id == null ? null : n(r.parent_comment_id),
    body: String(r.body ?? ""),
    hidden: b(r.hidden),
    createdAt: n(r.created_at),
  };
}

export async function getComment(id: number): Promise<Comment | null> {
  const [r] = await rows<Record<string, unknown>>(sql`${COMMENT_SELECT} WHERE k.id = ${id}`);
  return r ? toComment(r) : null;
}

/**
 * Comentarios de una publicación: principales en orden y sus respuestas debajo, con «me gusta» en una sola consulta.
 * Los ocultos solo los ve su autor (marcados) y la moderación (`includeHidden`).
 */
export async function listComments(postId: number, viewerId: number, includeHidden: boolean): Promise<CommentNode[]> {
  const visible = includeHidden ? sql`` : sql` AND (k.hidden = 0 OR k.author_user_id = ${viewerId})`;
  const list = (await rows<Record<string, unknown>>(sql`${COMMENT_SELECT} WHERE k.post_id = ${postId}${visible} ORDER BY k.created_at ASC, k.id ASC LIMIT 500`)).map(toComment);
  if (!list.length) return [];
  const ids = sql.join(list.map((c) => sql`${c.id}`), sql`, `);
  const likes = await rows<{ target_id: number; c: number; mine: number }>(sql`SELECT target_id, COUNT(*) AS c, SUM(user_id = ${viewerId}) AS mine FROM community_reactions WHERE target_type = 'comment' AND active = 1 AND target_id IN (${ids}) GROUP BY target_id`);
  const node = (c: Comment): CommentNode => {
    const l = likes.find((x) => n(x.target_id) === c.id);
    return { ...c, isOwn: c.authorUserId === viewerId, likes: n(l?.c), likedByMe: n(l?.mine) > 0, replies: [] };
  };
  const roots = list.filter((c) => c.parentCommentId == null).map(node);
  const byId = new Map(roots.map((r) => [r.id, r]));
  for (const c of list) if (c.parentCommentId != null) byId.get(c.parentCommentId)?.replies.push(node(c));
  return roots;
}

export async function createComment(post: Post, userId: number, body: string, parentCommentId: number | null): Promise<Comment> {
  if (parentCommentId != null) {
    const parent = await getComment(parentCommentId);
    const problem = replyProblem(parent ? { postId: parent.postId, parentCommentId: parent.parentCommentId, hidden: parent.hidden } : null, post.id);
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
  }
  const now = Date.now();
  const { insertId } = await header(sql`INSERT INTO community_comments (community_id, post_id, author_user_id, parent_comment_id, body, created_at)
    VALUES (${post.communityId}, ${post.id}, ${userId}, ${parentCommentId}, ${body}, ${now})`);
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.commented:${insertId}`, type: "member.commented", communityId: post.communityId, userId, targetType: "comment", targetId: insertId, data: { postId: post.id }, now }));
  return (await getComment(insertId))!;
}

/** Ocultar o volver a mostrar (moderación, o el propio autor al retirar su comentario). */
export async function setCommentHidden(comment: Comment, hidden: boolean, actorId: number): Promise<void> {
  if (comment.hidden === hidden) return;
  const now = Date.now();
  await header(sql`UPDATE community_comments SET hidden = ${hidden ? 1 : 0}, hidden_by = ${hidden ? actorId : null}, hidden_at = ${hidden ? now : null} WHERE id = ${comment.id}`);
  const type = hidden ? "comment.hidden" : "comment.restored";
  await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `${type}:${comment.id}:${now}`, type, communityId: comment.communityId, userId: actorId, targetType: "comment", targetId: comment.id, data: { authorUserId: comment.authorUserId, postId: comment.postId }, now }));
}

// ─── Reacciones y guardados ───────────────────────────────────────────────────

/**
 * «Me gusta» (alternar). La fila es única por persona y elemento; quitarlo la desactiva. El hecho `member.reacted`
 * se emite una sola vez por persona y elemento (volver a darlo no lo repite).
 */
export async function toggleReaction(communityId: number, target: ReactionTarget, targetId: number, userId: number): Promise<{ liked: boolean; count: number }> {
  const now = Date.now();
  const [existing] = await rows<{ id: number; active: number }>(sql`SELECT id, active FROM community_reactions WHERE target_type = ${target} AND target_id = ${targetId} AND user_id = ${userId}`);
  let liked: boolean;
  if (existing) {
    liked = !b(existing.active);
    await header(sql`UPDATE community_reactions SET active = ${liked ? 1 : 0}, updated_at = ${now} WHERE id = ${existing.id}`);
  } else {
    // Carrera (doble clic): la clave única ya protege; la segunda inserción no hace nada
    await header(sql`INSERT IGNORE INTO community_reactions (community_id, target_type, target_id, user_id, active, created_at, updated_at) VALUES (${communityId}, ${target}, ${targetId}, ${userId}, 1, ${now}, ${now})`);
    liked = true;
  }
  if (liked) await dispatchCommunityEvent(await recordCommunityEvent(await db(), { key: `member.reacted:${target}:${targetId}:${userId}`, type: "member.reacted", communityId, userId, targetType: target, targetId, now }));
  const [c] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_reactions WHERE target_type = ${target} AND target_id = ${targetId} AND active = 1`);
  return { liked, count: n(c?.c) };
}

export async function toggleSave(post: Post, userId: number): Promise<{ saved: boolean }> {
  const now = Date.now();
  const [existing] = await rows<{ id: number; active: number }>(sql`SELECT id, active FROM community_saves WHERE post_id = ${post.id} AND user_id = ${userId}`);
  if (existing) {
    const saved = !b(existing.active);
    await header(sql`UPDATE community_saves SET active = ${saved ? 1 : 0}, updated_at = ${now} WHERE id = ${existing.id}`);
    return { saved };
  }
  await header(sql`INSERT IGNORE INTO community_saves (community_id, post_id, user_id, active, created_at, updated_at) VALUES (${post.communityId}, ${post.id}, ${userId}, 1, ${now}, ${now})`);
  return { saved: true };
}

// ─── Actividad e indicadores ──────────────────────────────────────────────────

export interface ActivityItem {
  id: number;
  type: string;
  actorUserId: number | null;
  actorName: string | null;
  targetType: string | null;
  targetId: number | null;
  createdAt: number;
}

export async function listActivity(communityId: number, limit = 50, opts: { participationOnly?: boolean } = {}): Promise<ActivityItem[]> {
  const only = opts.participationOnly ? sql` AND a.type LIKE 'member.%' AND a.type NOT IN ('member.blocked', 'member.unblocked', 'member.role_changed', 'member.added')` : sql``;
  const list = await rows<Record<string, unknown>>(sql`SELECT a.id, a.type, a.actor_user_id, a.target_type, a.target_id, a.created_at, COALESCE(cl.name, u.name, u.email) AS actor_name
    FROM community_activity a LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN community_members mm ON mm.community_id = a.community_id AND mm.user_id = a.actor_user_id
    LEFT JOIN clients cl ON cl.id = mm.client_id
    WHERE a.community_id = ${communityId}${only} ORDER BY a.id DESC LIMIT ${Math.min(limit, 200)}`);
  return list.map((r) => ({
    id: n(r.id),
    type: String(r.type),
    actorUserId: r.actor_user_id == null ? null : n(r.actor_user_id),
    actorName: (r.actor_name as string | null) ?? null,
    targetType: (r.target_type as string | null) ?? null,
    targetId: r.target_id == null ? null : n(r.target_id),
    createdAt: n(r.created_at),
  }));
}

const PARTICIPATION_TYPES = sql`('member.posted', 'member.commented', 'member.reacted')`;

/** Indicadores de participación de una comunidad (panel). */
export async function communityStats(communityId: number, now = Date.now()) {
  const since = now - PARTICIPATION_WINDOW_DAYS * 86_400_000;
  const members = await rows<{ status: string; c: number }>(sql`SELECT status, COUNT(*) AS c FROM community_members WHERE community_id = ${communityId} GROUP BY status`);
  const memberCount = (s: string) => n(members.find((m) => m.status === s)?.c);
  const [newMembers] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_members WHERE community_id = ${communityId} AND status = 'active' AND joined_at >= ${since}`);
  const posts = await rows<{ status: string; c: number }>(sql`SELECT status, COUNT(*) AS c FROM community_posts WHERE community_id = ${communityId} GROUP BY status`);
  const postCount = (s: string) => n(posts.find((p) => p.status === s)?.c);
  const [comments] = await rows<{ c: number; hidden: number }>(sql`SELECT COUNT(*) AS c, COALESCE(SUM(hidden), 0) AS hidden FROM community_comments WHERE community_id = ${communityId}`);
  const [reactions] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_reactions WHERE community_id = ${communityId} AND active = 1`);
  const [saves] = await rows<{ c: number }>(sql`SELECT COUNT(*) AS c FROM community_saves WHERE community_id = ${communityId} AND active = 1`);
  const [participants] = await rows<{ c: number }>(sql`SELECT COUNT(DISTINCT a.actor_user_id) AS c FROM community_activity a
    JOIN community_members m ON m.community_id = a.community_id AND m.user_id = a.actor_user_id AND m.status = 'active'
    WHERE a.community_id = ${communityId} AND a.type IN ${PARTICIPATION_TYPES} AND a.created_at >= ${since}`);
  const recent = await rows<{ created_at: number }>(sql`SELECT created_at FROM community_activity WHERE community_id = ${communityId} AND type IN ${PARTICIPATION_TYPES} AND created_at >= ${now - 8 * 7 * 86_400_000}`);
  const top = await rows<{ actor_user_id: number; c: number; name: string | null }>(sql`SELECT a.actor_user_id, COUNT(*) AS c, COALESCE(cl.name, u.name, u.email) AS name
    FROM community_activity a LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN community_members mm ON mm.community_id = a.community_id AND mm.user_id = a.actor_user_id
    LEFT JOIN clients cl ON cl.id = mm.client_id
    WHERE a.community_id = ${communityId} AND a.type IN ${PARTICIPATION_TYPES} AND a.created_at >= ${since}
    GROUP BY a.actor_user_id, name ORDER BY c DESC LIMIT 5`);
  const activeMembers = memberCount("active");
  const publishedPosts = postCount("published");
  const visibleComments = n(comments?.c) - n(comments?.hidden);
  return {
    windowDays: PARTICIPATION_WINDOW_DAYS,
    members: { active: activeMembers, pending: memberCount("pending"), blocked: memberCount("blocked"), left: memberCount("left"), newInWindow: n(newMembers?.c) },
    content: { posts: publishedPosts, pendingPosts: postCount("pending"), hiddenPosts: postCount("hidden"), comments: visibleComments, hiddenComments: n(comments?.hidden), reactions: n(reactions?.c), saves: n(saves?.c) },
    participants: n(participants?.c),
    indicators: engagementIndicators({ activeMembers, participants: n(participants?.c), posts: publishedPosts, comments: visibleComments, reactions: n(reactions?.c) }),
    weekly: weeklySeries(recent.map((r) => n(r.created_at)), now),
    topContributors: top.map((t) => ({ userId: n(t.actor_user_id), name: t.name || `Usuario ${t.actor_user_id}`, actions: n(t.c) })),
  };
}

export { canModerateMember };
