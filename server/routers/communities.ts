/**
 * communities.* — Social Token Net · Comunidades (capacidad `social-token-net`).
 *
 * La licencia la aplica el guardián de rutas (`communities` → social-token-net en TRPC_ROUTER_CAPABILITIES) y cada
 * procedimiento la comprueba además aquí: sin ella no hay pantallas ni acceso de miembros; en solo lectura se consulta
 * pero nada cambia. Activar o desactivar la capacidad nunca pierde datos.
 *
 *  - `communities.admin.*`: la administración del panel (adminProcedure) crea y configura comunidades, incorpora
 *    miembros (clientes del CRM, usuarios del panel o invitación por correo), modera y ve los indicadores.
 *  - `communities.member.*`: el área de miembros (/comunidad), con la cuenta del Core de cada persona
 *    (protectedProcedure) y los permisos de su rol en la comunidad (administrador, moderador, miembro).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  COLOR_RE,
  COMMENT_MAX,
  DESCRIPTION_MAX,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  NAME_MAX,
  POST_BODY_MAX,
  POST_STATUSES,
  REACTION_TARGETS,
  REASON_MAX,
  SLUG_MAX,
  TITLE_MAX,
  VISIBILITIES,
  POST_MODERATION,
  canModerateMember,
  isSafeImageUrl,
  permissionsFor,
  sanitizeText,
} from "../../shared/communities";
import {
  addMembers,
  assertCommunities,
  canSeePost,
  communityStats,
  createComment,
  createCommunity,
  createPost,
  getComment,
  getCommunityBySlug,
  getMember,
  inviteMember,
  joinCommunity,
  leaveCommunity,
  listActivity,
  listCommunities,
  listComments,
  listFeed,
  listMembers,
  listPostsForAdmin,
  memberCandidates,
  memberOf,
  myCommunities,
  renewMemberInvite,
  requireActiveMember,
  requireCommunity,
  requirePost,
  setCommentHidden,
  setCommunityStatus,
  setMemberRole,
  setMemberStatus,
  setPostPinned,
  setPostStatus,
  toggleReaction,
  toggleSave,
  touchMember,
  updateCommunity,
  type Member,
} from "../communitiesDb";
import { notifyNewMembers } from "../communities/mail";

const id = z.number().int().positive();
const imageUrl = z.string().trim().max(512).refine(isSafeImageUrl, "Dirección de imagen no válida").nullable().optional();
const communityInput = z.object({
  name: z.string().trim().min(2, "Pon un nombre de al menos 2 caracteres").max(NAME_MAX),
  slug: z.string().trim().max(SLUG_MAX).optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
  coverImageUrl: imageUrl,
  logoUrl: imageUrl,
  accentColor: z.string().regex(COLOR_RE, "Color no válido").nullable().optional(),
  visibility: z.enum(VISIBILITIES),
  allowMemberPosts: z.boolean(),
  postModeration: z.enum(POST_MODERATION),
});
const reason = z.string().trim().max(REASON_MAX).nullable().optional();
const postInput = z.object({
  title: z.string().trim().max(TITLE_MAX).nullable().optional(),
  body: z.string().max(POST_BODY_MAX * 2),
  imageUrl,
});

const read = () => assertCommunities(false);
const write = () => assertCommunities(true);
const clean = (s: string | null | undefined, max: number) => (s == null ? null : sanitizeText(s, max) || null);

function bodyOrFail(raw: string, max: number, what: string): string {
  const body = sanitizeText(raw, max);
  if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: `${what} no puede estar vacío.` });
  return body;
}

async function memberOrFail(memberId: number, communityId?: number): Promise<Member> {
  const m = await getMember(memberId);
  if (!m || (communityId !== undefined && m.communityId !== communityId)) throw new TRPCError({ code: "NOT_FOUND", message: "Miembro no encontrado." });
  return m;
}

// ─── Panel de administración ──────────────────────────────────────────────────

const adminRouter = router({
  list: adminProcedure.query(async () => {
    await read();
    return listCommunities();
  }),

  get: adminProcedure.input(z.object({ id })).query(async ({ input }) => {
    await read();
    return requireCommunity(input.id);
  }),

  create: adminProcedure.input(communityInput).mutation(async ({ input, ctx }) => {
    await write();
    return createCommunity({ ...input, description: clean(input.description, DESCRIPTION_MAX) }, ctx.user.id);
  }),

  update: adminProcedure.input(communityInput.extend({ id })).mutation(async ({ input }) => {
    await write();
    const { id: communityId, ...rest } = input;
    return updateCommunity(communityId, { ...rest, description: clean(rest.description, DESCRIPTION_MAX) });
  }),

  setStatus: adminProcedure.input(z.object({ id, status: z.enum(["active", "archived"]) })).mutation(async ({ input }) => {
    await write();
    return setCommunityStatus(input.id, input.status);
  }),

  stats: adminProcedure.input(z.object({ id })).query(async ({ input }) => {
    await read();
    await requireCommunity(input.id);
    return communityStats(input.id);
  }),

  activity: adminProcedure.input(z.object({ id, limit: z.number().int().min(1).max(200).default(50) })).query(async ({ input }) => {
    await read();
    return listActivity(input.id, input.limit);
  }),

  members: router({
    list: adminProcedure.input(z.object({ communityId: id, status: z.enum(MEMBER_STATUSES).optional(), search: z.string().max(100).optional() })).query(async ({ input }) => {
      await read();
      await requireCommunity(input.communityId);
      return listMembers(input.communityId, { status: input.status, search: input.search });
    }),

    candidates: adminProcedure.input(z.object({ communityId: id, search: z.string().max(100).default("") })).query(async ({ input }) => {
      await read();
      return memberCandidates(input.communityId, input.search);
    }),

    add: adminProcedure
      .input(z.object({ communityId: id, clientIds: z.array(id).max(200).default([]), userIds: z.array(id).max(200).default([]), role: z.enum(MEMBER_ROLES).default("member"), notify: z.boolean().default(true) }))
      .mutation(async ({ input, ctx }) => {
        await write();
        const community = await requireCommunity(input.communityId);
        const results = await addMembers(community.id, input, ctx.user.id);
        const emailsSent = input.notify ? await notifyNewMembers(community, results) : 0;
        return { results: results.map(({ invite, ...r }) => ({ ...r, invited: !!invite })), emailsSent };
      }),

    invite: adminProcedure
      .input(z.object({ communityId: id, name: z.string().trim().min(2).max(120), email: z.string().trim().email("Correo no válido").max(200), role: z.enum(MEMBER_ROLES).default("member") }))
      .mutation(async ({ input, ctx }) => {
        await write();
        const community = await requireCommunity(input.communityId);
        const r = await inviteMember(community.id, input, ctx.user.id);
        const emailsSent = await notifyNewMembers(community, [r]);
        return { result: r.result, invited: !!r.invite, emailsSent };
      }),

    resendInvite: adminProcedure.input(z.object({ memberId: id })).mutation(async ({ input }) => {
      await write();
      const m = await memberOrFail(input.memberId);
      const invite = await renewMemberInvite(m.id);
      if (!invite) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta persona ya tiene su cuenta activa." });
      const community = await requireCommunity(m.communityId);
      const emailsSent = await notifyNewMembers(community, [{ name: m.name, email: m.email, result: "reactivated", memberId: m.id, invite }]);
      return { emailsSent };
    }),

    setRole: adminProcedure.input(z.object({ memberId: id, role: z.enum(MEMBER_ROLES) })).mutation(async ({ input, ctx }) => {
      await write();
      await setMemberRole(await memberOrFail(input.memberId), input.role, ctx.user.id);
      return { ok: true };
    }),

    setStatus: adminProcedure.input(z.object({ memberId: id, action: z.enum(["approve", "block", "unblock", "remove"]), reason })).mutation(async ({ input, ctx }) => {
      await write();
      const status = await setMemberStatus(await memberOrFail(input.memberId), input.action, clean(input.reason, REASON_MAX), ctx.user.id);
      return { status };
    }),
  }),

  posts: router({
    list: adminProcedure.input(z.object({ communityId: id, status: z.enum(POST_STATUSES).optional() })).query(async ({ input }) => {
      await read();
      return listPostsForAdmin(input.communityId, input.status);
    }),

    create: adminProcedure.input(postInput.extend({ communityId: id, announcement: z.boolean().default(false), pinned: z.boolean().default(false) })).mutation(async ({ input, ctx }) => {
      await write();
      const community = await requireCommunity(input.communityId);
      if (community.status === "archived") throw new TRPCError({ code: "BAD_REQUEST", message: "La comunidad está archivada." });
      return createPost(community, { userId: ctx.user.id, role: "admin" }, { kind: input.announcement ? "announcement" : "post", title: clean(input.title, TITLE_MAX), body: bodyOrFail(input.body, POST_BODY_MAX, "El texto"), imageUrl: input.imageUrl ?? null, pinned: input.pinned });
    }),

    setStatus: adminProcedure.input(z.object({ postId: id, status: z.enum(["published", "hidden"]), note: reason })).mutation(async ({ input, ctx }) => {
      await write();
      await setPostStatus(await requirePost(input.postId), input.status, ctx.user.id, clean(input.note, REASON_MAX));
      return { ok: true };
    }),

    pin: adminProcedure.input(z.object({ postId: id, pinned: z.boolean() })).mutation(async ({ input }) => {
      await write();
      await setPostPinned(await requirePost(input.postId), input.pinned);
      return { ok: true };
    }),
  }),

  comments: router({
    list: adminProcedure.input(z.object({ postId: id })).query(async ({ input, ctx }) => {
      await read();
      await requirePost(input.postId);
      return listComments(input.postId, ctx.user.id, true);
    }),

    setHidden: adminProcedure.input(z.object({ commentId: id, hidden: z.boolean() })).mutation(async ({ input, ctx }) => {
      await write();
      const c = await getComment(input.commentId);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado." });
      await setCommentHidden(c, input.hidden, ctx.user.id);
      return { ok: true };
    }),
  }),
});

// ─── Área de miembros ─────────────────────────────────────────────────────────

/** Contexto del miembro para una publicación (y que la puede ver). */
async function postContext(postId: number, userId: number) {
  const post = await requirePost(postId);
  const ctx = await requireActiveMember(post.communityId, userId);
  if (!canSeePost(post, userId, ctx.perms.moderate)) throw new TRPCError({ code: "NOT_FOUND", message: "Publicación no encontrada." });
  return { post, ...ctx };
}

function requirePerm(ok: boolean, message = "Tu rol en la comunidad no permite esta acción.") {
  if (!ok) throw new TRPCError({ code: "FORBIDDEN", message });
}

const memberRouter = router({
  /** Mis comunidades y las que puedo unirme. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    await read();
    return myCommunities(ctx.user.id);
  }),

  /** Cabecera de una comunidad para el miembro: identidad, su rol y permisos (o su estado si no es miembro activo). */
  community: protectedProcedure.input(z.object({ slug: z.string().max(SLUG_MAX) })).query(async ({ input, ctx }) => {
    await read();
    const community = await getCommunityBySlug(input.slug);
    if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Comunidad no encontrada." });
    const member = await memberOf(community.id, ctx.user.id);
    const active = member?.status === "active";
    if (!active && community.visibility === "private" && !member) throw new TRPCError({ code: "NOT_FOUND", message: "Comunidad no encontrada." });
    if (active) await touchMember(member.id).catch(() => undefined);
    return {
      community,
      membership: member ? { id: member.id, role: member.role, status: member.status } : null,
      perms: permissionsFor(active ? member.role : null, community),
    };
  }),

  join: protectedProcedure.input(z.object({ communityId: id })).mutation(async ({ input, ctx }) => {
    await write();
    return { status: await joinCommunity(await requireCommunity(input.communityId), ctx.user.id) };
  }),

  leave: protectedProcedure.input(z.object({ communityId: id })).mutation(async ({ input, ctx }) => {
    await write();
    const m = await memberOf(input.communityId, ctx.user.id);
    if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "No eres miembro de esta comunidad." });
    await leaveCommunity(m);
    return { ok: true };
  }),

  feed: protectedProcedure.input(z.object({ communityId: id, before: z.number().int().positive().optional(), savedOnly: z.boolean().default(false) })).query(async ({ input, ctx }) => {
    await read();
    const { perms } = await requireActiveMember(input.communityId, ctx.user.id);
    return listFeed(input.communityId, ctx.user.id, { moderate: perms.moderate, savedOnly: input.savedOnly, before: input.before });
  }),

  createPost: protectedProcedure.input(postInput.extend({ communityId: id, announcement: z.boolean().default(false) })).mutation(async ({ input, ctx }) => {
    await write();
    const { community, member, perms } = await requireActiveMember(input.communityId, ctx.user.id);
    requirePerm(perms.post, community.status === "archived" ? "La comunidad está archivada." : "En esta comunidad solo publican los moderadores.");
    if (input.announcement) requirePerm(perms.announce);
    return createPost(community, { userId: ctx.user.id, role: member.role }, {
      kind: input.announcement ? "announcement" : "post",
      title: clean(input.title, TITLE_MAX),
      body: bodyOrFail(input.body, POST_BODY_MAX, "El texto"),
      // Imágenes: solo la moderación (las sube con el almacenamiento del Core); los miembros publican texto
      imageUrl: perms.announce ? input.imageUrl ?? null : null,
      pinned: false,
    });
  }),

  comments: protectedProcedure.input(z.object({ postId: id })).query(async ({ input, ctx }) => {
    await read();
    const { perms } = await postContext(input.postId, ctx.user.id);
    return listComments(input.postId, ctx.user.id, perms.moderate);
  }),

  addComment: protectedProcedure.input(z.object({ postId: id, body: z.string().max(COMMENT_MAX * 2), parentCommentId: id.nullable().optional() })).mutation(async ({ input, ctx }) => {
    await write();
    const { post, perms } = await postContext(input.postId, ctx.user.id);
    requirePerm(perms.comment && post.status === "published", "No se puede comentar esta publicación.");
    return createComment(post, ctx.user.id, bodyOrFail(input.body, COMMENT_MAX, "El comentario"), input.parentCommentId ?? null);
  }),

  /** El autor retira su comentario (queda oculto, nunca se borra). */
  removeOwnComment: protectedProcedure.input(z.object({ commentId: id })).mutation(async ({ input, ctx }) => {
    await write();
    const c = await getComment(input.commentId);
    if (!c || c.authorUserId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado." });
    await requireActiveMember(c.communityId, ctx.user.id);
    await setCommentHidden(c, true, ctx.user.id);
    return { ok: true };
  }),

  react: protectedProcedure.input(z.object({ target: z.enum(REACTION_TARGETS), targetId: id })).mutation(async ({ input, ctx }) => {
    await write();
    let postId = input.targetId;
    if (input.target === "comment") {
      const c = await getComment(input.targetId);
      if (!c || c.hidden) throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado." });
      postId = c.postId;
    }
    const { post, perms } = await postContext(postId, ctx.user.id);
    requirePerm(perms.react && post.status === "published", "No se puede reaccionar a esta publicación.");
    return toggleReaction(post.communityId, input.target, input.targetId, ctx.user.id);
  }),

  save: protectedProcedure.input(z.object({ postId: id })).mutation(async ({ input, ctx }) => {
    await write();
    const { post } = await postContext(input.postId, ctx.user.id);
    return toggleSave(post, ctx.user.id);
  }),

  // ── Moderación desde el área (moderadores y administradores de la comunidad) ──

  members: protectedProcedure.input(z.object({ communityId: id })).query(async ({ input, ctx }) => {
    await read();
    const { perms } = await requireActiveMember(input.communityId, ctx.user.id);
    const list = await listMembers(input.communityId);
    // Los miembros ven quién participa (nombre y rol); el correo y los estados solo la moderación
    return list
      .filter((m) => perms.moderate || m.status === "active")
      .map((m) => ({ id: m.id, userId: m.userId, name: m.name, role: m.role, status: m.status, email: perms.moderate ? m.email : null, joinedAt: m.joinedAt }));
  }),

  moderatePost: protectedProcedure.input(z.object({ postId: id, action: z.enum(["hide", "publish", "pin", "unpin"]), note: reason })).mutation(async ({ input, ctx }) => {
    await write();
    const { post, perms } = await postContext(input.postId, ctx.user.id);
    requirePerm(perms.moderate);
    if (input.action === "pin" || input.action === "unpin") await setPostPinned(post, input.action === "pin");
    else await setPostStatus(post, input.action === "hide" ? "hidden" : "published", ctx.user.id, clean(input.note, REASON_MAX));
    return { ok: true };
  }),

  moderateComment: protectedProcedure.input(z.object({ commentId: id, hidden: z.boolean() })).mutation(async ({ input, ctx }) => {
    await write();
    const c = await getComment(input.commentId);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comentario no encontrado." });
    const { perms } = await requireActiveMember(c.communityId, ctx.user.id);
    requirePerm(perms.moderate);
    await setCommentHidden(c, input.hidden, ctx.user.id);
    return { ok: true };
  }),

  moderateMember: protectedProcedure.input(z.object({ memberId: id, action: z.enum(["approve", "block", "unblock"]), reason })).mutation(async ({ input, ctx }) => {
    await write();
    const target = await memberOrFail(input.memberId);
    const { member, perms } = await requireActiveMember(target.communityId, ctx.user.id);
    if (input.action === "approve") requirePerm(perms.manageMembers);
    else requirePerm(perms.blockMembers && canModerateMember(member.role, target.role, member.id === target.id));
    return { status: await setMemberStatus(target, input.action, clean(input.reason, REASON_MAX), ctx.user.id) };
  }),

  setMemberRole: protectedProcedure.input(z.object({ memberId: id, role: z.enum(MEMBER_ROLES) })).mutation(async ({ input, ctx }) => {
    await write();
    const target = await memberOrFail(input.memberId);
    const { member, perms } = await requireActiveMember(target.communityId, ctx.user.id);
    requirePerm(perms.manageMembers && member.id !== target.id);
    await setMemberRole(target, input.role, ctx.user.id);
    return { ok: true };
  }),
});

export const communitiesRouter = router({
  admin: adminRouter,
  member: memberRouter,
});
