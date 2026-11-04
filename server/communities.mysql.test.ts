/**
 * Social Token Net · Comunidades (capacidad social-token-net) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas desde la baseline y las migraciones de empresa (incluida la 0026).
 * Sin licencia no hay panel ni área de miembros; con ella, la administración crea la comunidad, incorpora clientes
 * del CRM ficticios (cuenta de cliente con invitación de un solo uso), los miembros publican, comentan, reaccionan y
 * guardan; la moderación oculta, aprueba y bloquea según el rol; cada empresa solo ve lo suyo; los eventos de
 * participación se emiten una sola vez; y desactivar y volver a activar la capacidad no pierde nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { onCommunityEvent, type CommunityDomainEvent } from "./communities/events";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "social-token-net";

describe.skipIf(!URL_)("Comunidades (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let communityId = 0;
  let slug = "";
  const cookies: Record<string, string> = {};
  const memberIds: Record<string, number> = {};
  let postId = 0;
  const events: CommunityDomainEvent[] = [];
  let off: () => void = () => undefined;

  const clients = [
    { name: "Lucía Ficticia", email: "lucia@clientes-a.example" },
    { name: "Marcos Ficticio", email: "marcos@clientes-a.example" },
    { name: "Nerea Ficticia", email: "nerea@clientes-a.example" },
  ];
  const PASS = "clave-de-miembro-segura-1";

  /** Activa la cuenta con el enlace del correo de invitación y abre sesión. */
  async function activate(email: string): Promise<string> {
    const mail = [...ess.mails].reverse().find((m) => m.to.some((t) => t.email === email) && /Invitación a la comunidad/.test(m.subject));
    expect(mail, `invitación a ${email}`).toBeTruthy();
    const token = /token=([a-f0-9]{64})/.exec(mail!.htmlContent)?.[1];
    expect(token).toBeTruthy();
    expect((await ess.m("a", "public.setPassword", { token, password: PASS })).status).toBe(200);
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: PASS } });
    expect(login.status).toBe(200);
    return login.cookie!;
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "comunidades");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    for (const c of clients) await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [c.name, c.email]);
    off = onCommunityEvent((e) => void events.push(e));
  }, 300_000);
  afterAll(async () => {
    off();
    await ess?.close();
  });

  it("sin la capacidad no hay panel ni área de miembros", async () => {
    expect(isLicenseDenied(await ess.q("a", "communities.admin.list", undefined, adA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "communities.admin.create", { name: "No", visibility: "open", allowMemberPosts: true, postModeration: "none" }, adA), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "communities.member.mine", undefined, adA), CAP)).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM communities"))[0].n).toBe(0);
  });

  it("administración: crea y configura la comunidad; el equipo sin rol de administración no puede", async () => {
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    expect(errCode(await ess.m("a", "communities.admin.create", { name: "Club", visibility: "open", allowMemberPosts: true, postModeration: "none" }, agA))).toBe("FORBIDDEN");
    const r = await ess.m("a", "communities.admin.create", {
      name: "Club de Socios Ñandú",
      description: "Comunidad de clientes <b>fieles</b>",
      visibility: "private",
      allowMemberPosts: true,
      postModeration: "none",
      accentColor: "#0F766E",
      coverImageUrl: "https://cdn.example/portada.jpg",
    }, adA);
    expect(r.status).toBe(200);
    communityId = data(r).id;
    slug = data(r).slug;
    expect(slug).toBe("club-de-socios-nandu");
    expect(data(r)).toMatchObject({ visibility: "private", accentColor: "#0F766E", description: "Comunidad de clientes fieles" });
    // Una imagen que no es https ni del propio Core se rechaza
    expect((await ess.m("a", "communities.admin.update", { id: communityId, name: "Club", visibility: "open", allowMemberPosts: true, postModeration: "none", logoUrl: "javascript:alert(1)" }, adA)).status).toBe(400);
    const list = data(await ess.q("a", "communities.admin.list", undefined, adA)) as any[];
    expect(list.map((c) => c.slug)).toEqual([slug]);
  });

  it("miembros: clientes del CRM ficticios con invitación de cuenta, activación y área de miembros", async () => {
    const cand = data(await ess.q("a", "communities.admin.members.candidates", { communityId, search: "clientes-a" }, adA));
    expect(cand.clients.map((c: any) => c.email).sort()).toEqual(clients.map((c) => c.email).sort());
    const add = await ess.m("a", "communities.admin.members.add", { communityId, clientIds: cand.clients.map((c: any) => c.id), role: "member" }, adA);
    expect(add.status).toBe(200);
    expect(data(add).results.every((x: any) => x.result === "added" && x.invited)).toBe(true);
    expect(data(add).emailsSent).toBe(3);
    // Cuentas de cliente (rol 'user', no ocupan plaza del panel) enlazadas a su cliente del CRM
    const accounts = await ess.sql("a", "SELECT u.email, u.role, m.client_id, m.status FROM community_members m JOIN users u ON u.id = m.user_id WHERE m.community_id = ?", [communityId]);
    expect(accounts).toHaveLength(3);
    expect(accounts.every((a: any) => a.role === "user" && a.client_id && a.status === "active")).toBe(true);
    // Repetir el alta no duplica
    const again = await ess.m("a", "communities.admin.members.add", { communityId, clientIds: cand.clients.map((c: any) => c.id) }, adA);
    expect(data(again).results.every((x: any) => x.result === "already")).toBe(true);

    for (const c of clients) cookies[c.email] = await activate(c.email);
    const members = data(await ess.q("a", "communities.admin.members.list", { communityId }, adA)) as any[];
    for (const m of members) memberIds[m.email] = m.id;
    expect(members.every((m) => !m.invitePending)).toBe(true);

    const mine = data(await ess.q("a", "communities.member.mine", undefined, cookies[clients[0].email]));
    expect(mine.mine.map((x: any) => x.community.slug)).toEqual([slug]);
    const head = data(await ess.q("a", "communities.member.community", { slug }, cookies[clients[0].email]));
    expect(head.membership).toMatchObject({ role: "member", status: "active" });
    expect(head.perms).toMatchObject({ read: true, post: true, moderate: false });
    // Un cliente sin invitación no ve una comunidad privada
    expect(errCode(await ess.q("a", "communities.member.community", { slug }, agA))).toBe("NOT_FOUND");
    // Una cuenta de cliente no entra en el panel
    expect(errCode(await ess.q("a", "communities.admin.list", undefined, cookies[clients[0].email]))).toBe("FORBIDDEN");
    // Invitación por correo de alguien que no es cliente
    const inv = await ess.m("a", "communities.admin.members.invite", { communityId, name: "Invitada Ficticia", email: "invitada@externa.example" }, adA);
    expect(data(inv)).toMatchObject({ result: "added", invited: true, emailsSent: 1 });
  });

  it("publicaciones, comentarios, me gusta y guardados; eventos de participación una sola vez", async () => {
    const [lucia, marcos] = [cookies[clients[0].email], cookies[clients[1].email]];
    const p = await ess.m("a", "communities.member.createPost", { communityId, title: "Hola", body: "Primera <script>x</script>publicación" }, lucia);
    expect(p.status).toBe(200);
    postId = data(p).id;
    expect(data(p)).toMatchObject({ status: "published", body: "Primera xpublicación" });
    // Un miembro no publica anuncios
    expect(errCode(await ess.m("a", "communities.member.createPost", { communityId, body: "Anuncio", announcement: true }, lucia))).toBe("FORBIDDEN");

    const c1 = await ess.m("a", "communities.member.addComment", { postId, body: "¡Bienvenida!" }, marcos);
    expect(c1.status).toBe(200);
    const reply = await ess.m("a", "communities.member.addComment", { postId, body: "Gracias", parentCommentId: data(c1).id }, lucia);
    expect(reply.status).toBe(200);
    // Solo un nivel de respuesta
    expect(errCode(await ess.m("a", "communities.member.addComment", { postId, body: "Más", parentCommentId: data(reply).id }, marcos))).toBe("BAD_REQUEST");

    expect(data(await ess.m("a", "communities.member.react", { target: "post", targetId: postId }, marcos))).toEqual({ liked: true, count: 1 });
    expect(data(await ess.m("a", "communities.member.react", { target: "post", targetId: postId }, marcos))).toEqual({ liked: false, count: 0 });
    expect(data(await ess.m("a", "communities.member.react", { target: "post", targetId: postId }, marcos))).toEqual({ liked: true, count: 1 });
    expect(data(await ess.m("a", "communities.member.react", { target: "comment", targetId: data(c1).id }, lucia))).toEqual({ liked: true, count: 1 });
    expect(data(await ess.m("a", "communities.member.save", { postId }, marcos))).toEqual({ saved: true });

    const feed = data(await ess.q("a", "communities.member.feed", { communityId }, marcos)) as any[];
    expect(feed[0]).toMatchObject({ id: postId, comments: 2, reactions: 1, likedByMe: true, savedByMe: true, authorName: "Lucía Ficticia" });
    expect((data(await ess.q("a", "communities.member.feed", { communityId, savedOnly: true }, lucia)) as any[])).toHaveLength(0);
    const tree = data(await ess.q("a", "communities.member.comments", { postId }, lucia)) as any[];
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ body: "¡Bienvenida!", likes: 1, likedByMe: true });
    expect(tree[0].replies.map((r: any) => r.body)).toEqual(["Gracias"]);

    // Quitar y volver a dar «me gusta» no repite el hecho; cada acción, una vez
    const reacted = events.filter((e) => e.type === "member.reacted" && e.targetType === "post" && e.targetId === postId);
    expect(reacted).toHaveLength(1);
    expect(events.filter((e) => e.type === "member.posted").map((e) => e.targetId)).toEqual([postId]);
    expect(events.filter((e) => e.type === "member.commented")).toHaveLength(2);
    expect(events.filter((e) => e.type === "member.joined")).toHaveLength(4);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    expect(events.every((e) => e.tenantId === ess.ids.a)).toBe(true);
  });

  it("moderación: revisión previa, ocultar, roles y bloqueo según permisos", async () => {
    const [lucia, marcos, nerea] = clients.map((c) => cookies[c.email]);
    await ess.m("a", "communities.admin.update", { id: communityId, name: "Club de Socios Ñandú", visibility: "private", allowMemberPosts: true, postModeration: "pre" }, adA);
    const pending = await ess.m("a", "communities.member.createPost", { communityId, body: "Necesita revisión" }, nerea);
    expect(data(pending).status).toBe("pending");
    const pendingId = data(pending).id;
    // Los demás no la ven; su autora sí
    expect((data(await ess.q("a", "communities.member.feed", { communityId }, lucia)) as any[]).map((p) => p.id)).not.toContain(pendingId);
    expect((data(await ess.q("a", "communities.member.feed", { communityId }, nerea)) as any[]).map((p) => p.id)).toContain(pendingId);
    expect(events.some((e) => e.type === "member.posted" && e.targetId === pendingId)).toBe(false);
    // Un miembro no modera (ni siquiera sabe que existe la pendiente) ni oculta lo publicado
    expect(errCode(await ess.m("a", "communities.member.moderatePost", { postId: pendingId, action: "publish" }, lucia))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("a", "communities.member.moderatePost", { postId, action: "hide" }, lucia))).toBe("FORBIDDEN");
    // La administración del panel nombra moderadora a Lucía
    expect((await ess.m("a", "communities.admin.members.setRole", { memberId: memberIds[clients[0].email], role: "moderator" }, adA)).status).toBe(200);
    expect((await ess.m("a", "communities.member.moderatePost", { postId: pendingId, action: "publish" }, lucia)).status).toBe(200);
    expect((data(await ess.q("a", "communities.member.feed", { communityId }, marcos)) as any[]).map((p) => p.id)).toContain(pendingId);
    expect(events.filter((e) => e.type === "member.posted" && e.targetId === pendingId)).toHaveLength(1);

    // Ocultar un comentario: desaparece para los miembros, la moderación lo sigue viendo
    const [comment] = data(await ess.q("a", "communities.member.comments", { postId }, marcos)) as any[];
    expect((await ess.m("a", "communities.member.moderateComment", { commentId: comment.id, hidden: true }, lucia)).status).toBe(200);
    expect((data(await ess.q("a", "communities.member.comments", { postId }, nerea)) as any[])).toHaveLength(0);
    expect((data(await ess.q("a", "communities.admin.comments.list", { postId }, adA)) as any[])[0]).toMatchObject({ id: comment.id, hidden: true });

    // La moderadora no puede cambiar roles ni bloquear a una administradora; sí bloquear a un miembro
    expect(errCode(await ess.m("a", "communities.member.setMemberRole", { memberId: memberIds[clients[1].email], role: "admin" }, lucia))).toBe("FORBIDDEN");
    await ess.m("a", "communities.admin.members.setRole", { memberId: memberIds[clients[2].email], role: "admin" }, adA);
    expect(errCode(await ess.m("a", "communities.member.moderateMember", { memberId: memberIds[clients[2].email], action: "block" }, lucia))).toBe("FORBIDDEN");
    expect((await ess.m("a", "communities.member.moderateMember", { memberId: memberIds[clients[1].email], action: "block", reason: "Spam" }, lucia)).status).toBe(200);
    expect(errCode(await ess.q("a", "communities.member.feed", { communityId }, marcos))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "communities.member.addComment", { postId, body: "sigo aquí" }, marcos))).toBe("FORBIDDEN");
    // La administradora de la comunidad desbloquea
    expect((await ess.m("a", "communities.member.moderateMember", { memberId: memberIds[clients[1].email], action: "unblock" }, nerea)).status).toBe(200);
    expect((await ess.q("a", "communities.member.feed", { communityId }, marcos)).status).toBe(200);

    // Ocultar una publicación desde el panel
    expect((await ess.m("a", "communities.admin.posts.setStatus", { postId, status: "hidden", note: "Fuera de tema" }, adA)).status).toBe(200);
    expect((data(await ess.q("a", "communities.member.feed", { communityId }, marcos)) as any[]).map((p) => p.id)).not.toContain(postId);
    expect(errCode(await ess.m("a", "communities.member.react", { target: "post", targetId: postId }, marcos))).toBe("NOT_FOUND");
    await ess.m("a", "communities.admin.posts.setStatus", { postId, status: "published" }, adA);
  });

  it("comunidad abierta y con solicitud: unirse desde el área; indicadores de participación", async () => {
    const r = data(await ess.m("a", "communities.admin.create", { name: "Abierta", visibility: "request", allowMemberPosts: false, postModeration: "none" }, adA));
    const lucia = cookies[clients[0].email];
    const mine = data(await ess.q("a", "communities.member.mine", undefined, lucia));
    expect(mine.available.map((x: any) => x.community.id)).toContain(r.id);
    expect(data(await ess.m("a", "communities.member.join", { communityId: r.id }, lucia))).toEqual({ status: "pending" });
    expect(errCode(await ess.q("a", "communities.member.feed", { communityId: r.id }, lucia))).toBe("FORBIDDEN");
    const [m] = data(await ess.q("a", "communities.admin.members.list", { communityId: r.id, status: "pending" }, adA)) as any[];
    expect((await ess.m("a", "communities.admin.members.setStatus", { memberId: m.id, action: "approve" }, adA)).status).toBe(200);
    expect((await ess.q("a", "communities.member.feed", { communityId: r.id }, lucia)).status).toBe(200);
    // Sin publicaciones de miembros
    expect(errCode(await ess.m("a", "communities.member.createPost", { communityId: r.id, body: "x" }, lucia))).toBe("FORBIDDEN");

    const stats = data(await ess.q("a", "communities.admin.stats", { id: communityId }, adA));
    expect(stats.members).toMatchObject({ active: 4, blocked: 0 });
    expect(stats.content).toMatchObject({ posts: 2, pendingPosts: 0, comments: 1, hiddenComments: 1, reactions: 2, saves: 1 });
    expect(stats.participants).toBe(3);
    expect(stats.indicators.participationRate).toBe(75);
    expect(stats.weekly).toHaveLength(8);
    expect(stats.weekly.at(-1).count).toBeGreaterThan(0);
    expect(stats.topContributors[0].actions).toBeGreaterThan(0);
  });

  it("aislamiento: la otra empresa no ve nada y la sesión de un miembro no vale allí", async () => {
    expect(data(await ess.q("b", "communities.admin.list", undefined, adB))).toEqual([]);
    expect(errCode(await ess.q("b", "communities.admin.get", { id: communityId }, adB))).toBe("NOT_FOUND");
    expect(errCode(await ess.q("b", "communities.admin.stats", { id: communityId }, adB))).toBe("NOT_FOUND");
    expect((await ess.q("b", "communities.member.feed", { communityId }, cookies[clients[0].email])).status).toBe(401);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM community_members"))[0].n).toBe(0);
  });

  it("solo lectura, desactivación y reactivación sin pérdida de datos", async () => {
    const lucia = cookies[clients[0].email];
    await ess.setCapability("a", CAP, "read_only");
    expect((await ess.q("a", "communities.member.feed", { communityId }, lucia)).status).toBe(200);
    expect(isLicenseDenied(await ess.m("a", "communities.member.createPost", { communityId, body: "no" }, lucia), CAP)).toBe(true);
    await ess.setCapability("a", CAP, null);
    expect(isLicenseDenied(await ess.q("a", "communities.member.feed", { communityId }, lucia), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.q("a", "communities.admin.list", undefined, adA), CAP)).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM community_posts WHERE community_id = ?", [communityId]))[0].n).toBe(2);
    await ess.setCapability("a", CAP, "active");
    const feed = data(await ess.q("a", "communities.member.feed", { communityId }, lucia)) as any[];
    expect(feed.map((p) => p.id)).toContain(postId);
    expect((data(await ess.q("a", "communities.admin.members.list", { communityId }, adA)) as any[])).toHaveLength(4);
  });
});
