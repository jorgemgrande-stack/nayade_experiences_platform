/**
 * Comunidades — encuestas, propuestas de miembros y reportes con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL): dos empresas nuevas con las migraciones 0027 y 0028. Responder los tipos de pregunta
 * con su ventana, cambio de respuesta y «me apunto» de un solo uso; resultados según su visibilidad; evento enlazado a
 * un producto del catálogo; propuestas con moderación, apoyos y conversión en encuesta; reportes resueltos por la
 * moderación de la comunidad; aviso en la campana del panel; permisos, aislamiento y licencia; eventos de
 * participación una sola vez.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";
import { onCommunityEvent, type CommunityDomainEvent } from "./communities/events";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "social-token-net";
const PASS = "clave-de-miembro-segura-2";

describe.skipIf(!URL_)("Comunidades: encuestas, propuestas y reportes (aplicación real)", () => {
  let ess: EssentialApp;
  let adA: string;
  let adB: string;
  let communityId = 0;
  let experienceId = 0;
  const m: Record<"ana" | "blas" | "carla", string> = { ana: "", blas: "", carla: "" };
  const memberId: Record<string, number> = {};
  const events: CommunityDomainEvent[] = [];
  let off: () => void = () => undefined;

  async function activate(email: string): Promise<string> {
    const mail = [...ess.mails].reverse().find((x) => x.to.some((t) => t.email === email));
    const token = /token=([a-f0-9]{64})/.exec(mail!.htmlContent)![1];
    expect((await ess.m("a", "public.setPassword", { token, password: PASS })).status).toBe(200);
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email, password: PASS } });
    expect(login.status).toBe(200);
    return login.cookie!;
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "encuestas");
    adA = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
    off = onCommunityEvent((e) => void events.push(e));
    // Producto del catálogo para el evento
    await ess.m("a", "products.createCategory", { slug: "salidas", name: "Salidas" }, adA);
    await ess.m("a", "products.createLocation", { slug: "lago", name: "Lago" }, adA);
    const [cat] = await ess.sql("a", "SELECT id FROM categories WHERE slug = 'salidas'");
    const [loc] = await ess.sql("a", "SELECT id FROM locations LIMIT 1");
    expect((await ess.m("a", "products.create", { slug: "ruta-kayak", title: "Ruta en kayak", categoryId: cat.id, locationId: loc.id, basePrice: "30.00", taxRate: "21" }, adA)).status).toBe(200);
    experienceId = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'ruta-kayak'"))[0].id;

    const c = data(await ess.m("a", "communities.admin.create", { name: "Socios del Lago", visibility: "private", allowMemberPosts: true, postModeration: "none" }, adA));
    communityId = c.id;
    for (const [k, name] of [["ana", "Ana Ficticia"], ["blas", "Blas Ficticio"], ["carla", "Carla Ficticia"]] as const) {
      await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES (?, ?, 'manual')", [name, `${k}@socios-a.example`]);
    }
    const clients = await ess.sql("a", "SELECT id FROM clients WHERE email LIKE '%@socios-a.example'");
    await ess.m("a", "communities.admin.members.add", { communityId, clientIds: clients.map((x: any) => x.id) }, adA);
    for (const k of ["ana", "blas", "carla"] as const) m[k] = await activate(`${k}@socios-a.example`);
    for (const row of data(await ess.q("a", "communities.admin.members.list", { communityId }, adA)) as any[]) memberId[row.email.split("@")[0]] = row.id;
  }, 300_000);
  afterAll(async () => {
    off();
    await ess?.close();
  });

  it("encuestas: configuración validada, borradores ocultos, respuestas, cambio y resultados según visibilidad", async () => {
    // Validación del servidor (no solo del formulario)
    expect(errCode(await ess.m("a", "communities.admin.polls.create", { communityId, title: "¿Día?", questionType: "single_choice", options: [{ label: "Sábado" }] }, adA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "communities.admin.polls.create", { communityId, title: "¿Vienes?", questionType: "yes_no", options: [{ label: "A" }, { label: "B" }] }, adA))).toBe("BAD_REQUEST");

    const single = data(await ess.m("a", "communities.admin.polls.create", { communityId, title: "¿Qué día?", questionType: "single_choice", options: [{ label: "Sábado", isPositiveIntent: true }, { label: "Domingo" }], resultsVisibility: "after_vote" }, adA));
    const yesNo = data(await ess.m("a", "communities.admin.polls.create", { communityId, title: "¿Repetimos?", questionType: "yes_no", resultsVisibility: "after_close", allowChangeResponse: true }, adA));
    const draft = data(await ess.m("a", "communities.admin.polls.create", { communityId, title: "Borrador", questionType: "open_text", publish: false }, adA));
    const later = data(await ess.m("a", "communities.admin.polls.create", { communityId, title: "Más adelante", questionType: "scale_1_5", startsAt: Date.now() + 86_400_000 }, adA));

    const list = data(await ess.q("a", "communities.member.polls", { communityId }, m.ana)) as any[];
    expect(list.map((p) => p.id)).not.toContain(draft.id);
    expect(list.find((p) => p.id === later.id).effectiveStatus).toBe("scheduled");
    expect(errCode(await ess.q("a", "communities.member.poll", { pollId: draft.id }, m.ana))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("a", "communities.member.respond", { pollId: later.id, payload: { questionType: "scale_1_5", value: 4 } }, m.ana))).toBe("BAD_REQUEST");

    // Antes de responder no hay resultados (after_vote); después sí
    expect(data(await ess.q("a", "communities.member.poll", { pollId: single.id }, m.ana)).results).toBeNull();
    const [sat, sun] = single.options;
    expect(data(await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "single_choice", optionId: sat.id } }, m.ana))).toEqual({ first: true });
    await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "single_choice", optionId: sat.id } }, m.blas);
    await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "single_choice", optionId: sun.id } }, m.carla);
    // Cambiar de opinión (permitido): no cuenta dos veces ni repite el hecho
    expect(data(await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "single_choice", optionId: sun.id } }, m.blas))).toEqual({ first: false });
    expect(errCode(await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "single_choice", optionId: 999999 } }, m.ana))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "communities.member.respond", { pollId: single.id, payload: { questionType: "yes_no", value: "yes" } }, m.ana))).toBe("BAD_REQUEST");
    const det = data(await ess.q("a", "communities.member.poll", { pollId: single.id }, m.ana));
    expect(det.myResponse.values[0].optionId).toBe(sat.id);
    expect(det.results.singleChoice.map((o: any) => [o.label, o.count])).toEqual([["Sábado", 1], ["Domingo", 2]]);
    expect(det.results).toMatchObject({ totalResponses: 3, totalAudience: 3, participationRate: 100 });
    expect(det.results.score.insufficientData).toBe(false);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM community_poll_values WHERE poll_id = ? AND current = 0", [single.id]))[0].n).toBe(1);
    expect(events.filter((e) => e.type === "member.responded" && e.targetId === single.id)).toHaveLength(3);

    // after_close: ni respondiendo se ven hasta cerrar
    await ess.m("a", "communities.member.respond", { pollId: yesNo.id, payload: { questionType: "yes_no", value: "yes" } }, m.ana);
    expect(data(await ess.q("a", "communities.member.poll", { pollId: yesNo.id }, m.ana)).results).toBeNull();
    expect((await ess.m("a", "communities.admin.polls.setStatus", { pollId: yesNo.id, action: "close" }, adA)).status).toBe(200);
    expect(data(await ess.q("a", "communities.member.poll", { pollId: yesNo.id }, m.blas)).results.yesNo).toMatchObject({ yes: 1, no: 0 });
    expect(errCode(await ess.m("a", "communities.member.respond", { pollId: yesNo.id, payload: { questionType: "yes_no", value: "no" } }, m.blas))).toBe("BAD_REQUEST");
    // La administración ve los resultados siempre; un miembro no entra en el panel
    expect((await ess.q("a", "communities.admin.polls.results", { pollId: single.id }, adA)).status).toBe(200);
    expect(errCode(await ess.q("a", "communities.admin.polls.list", { communityId }, m.ana))).toBe("FORBIDDEN");
  });

  it("evento: «me apunto» enlazado a un producto del catálogo, de un solo uso", async () => {
    const ev = data(await ess.m("a", "communities.admin.polls.create", { communityId, title: "Ruta del sábado", questionType: "me_apunto", experienceId, eventAt: Date.now() + 3 * 86_400_000, resultsVisibility: "immediate", allowChangeResponse: true }, adA));
    expect(ev.experience).toMatchObject({ id: experienceId, slug: "ruta-kayak" });
    expect(errCode(await ess.m("a", "communities.admin.polls.create", { communityId, title: "x", questionType: "me_apunto", experienceId: 999999 }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "communities.member.respond", { pollId: ev.id, payload: { questionType: "me_apunto" } }, m.carla)).status).toBe(200);
    expect(errCode(await ess.m("a", "communities.member.respond", { pollId: ev.id, payload: { questionType: "me_apunto" } }, m.carla))).toBe("CONFLICT");
    const det = data(await ess.q("a", "communities.member.poll", { pollId: ev.id }, m.ana));
    expect(det.results.meApunto).toEqual({ count: 1 });
    expect(det.poll.experience.slug).toBe("ruta-kayak");
  });

  it("propuestas: moderación, apoyos únicos y conversión en encuesta", async () => {
    const p = data(await ess.m("a", "communities.member.propose", { communityId, title: "Excursión al faro", description: "Con <b>picnic</b>", proposedQuestionType: "single_choice", proposedOptions: ["Mañana", "Tarde"] }, m.ana));
    expect(p).toMatchObject({ status: "pending", description: "Con picnic", proposedOptions: ["Mañana", "Tarde"], internalNote: null });
    expect(errCode(await ess.m("a", "communities.member.propose", { communityId, title: "Mal", proposedQuestionType: "ranking", proposedOptions: ["Una"] }, m.ana))).toBe("BAD_REQUEST");
    // Pendiente: solo la ve su autora
    expect((data(await ess.q("a", "communities.member.proposals", { communityId }, m.blas)) as any[]).map((x) => x.id)).not.toContain(p.id);
    expect((data(await ess.q("a", "communities.member.proposals", { communityId }, m.ana)) as any[]).map((x) => x.id)).toContain(p.id);
    expect(errCode(await ess.m("a", "communities.member.support", { proposalId: p.id }, m.blas))).toBe("NOT_FOUND");
    // Rechazar exige motivo para la persona
    expect(errCode(await ess.m("a", "communities.admin.proposals.moderate", { proposalId: p.id, action: "reject" }, adA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "communities.admin.proposals.moderate", { proposalId: p.id, action: "approve", internalNote: "Buena idea" }, adA)).status).toBe(200);
    expect(data(await ess.m("a", "communities.member.support", { proposalId: p.id }, m.blas))).toEqual({ supported: true, count: 1 });
    expect(data(await ess.m("a", "communities.member.support", { proposalId: p.id }, m.blas))).toEqual({ supported: false, count: 0 });
    expect(data(await ess.m("a", "communities.member.support", { proposalId: p.id }, m.blas))).toEqual({ supported: true, count: 1 });
    await ess.m("a", "communities.member.support", { proposalId: p.id }, m.carla);
    const seen = (data(await ess.q("a", "communities.member.proposals", { communityId }, m.carla)) as any[]).find((x) => x.id === p.id);
    expect(seen).toMatchObject({ supports: 2, supportedByMe: true, internalNote: null });
    expect(events.filter((e) => e.type === "member.supported" && e.targetId === p.id)).toHaveLength(2);
    expect(events.filter((e) => e.type === "member.proposed" && e.targetId === p.id && e.userId === memberUser("ana"))).toHaveLength(1);

    const poll = data(await ess.m("a", "communities.admin.proposals.convert", { proposalId: p.id, title: "Excursión al faro: ¿cuándo?", questionType: "single_choice", options: [{ label: "Mañana" }, { label: "Tarde" }] }, adA));
    expect(poll.sourceProposalId).toBe(p.id);
    const after = (data(await ess.q("a", "communities.admin.proposals.list", { communityId }, adA)) as any[]).find((x) => x.id === p.id);
    expect(after).toMatchObject({ status: "converted", convertedPollId: poll.id, internalNote: "Buena idea" });
    expect(errCode(await ess.m("a", "communities.member.support", { proposalId: p.id }, m.carla))).toBe("BAD_REQUEST");
  });

  it("reportes: uno por persona, no el propio; la moderación de la comunidad oculta; aviso en la campana", async () => {
    const post = data(await ess.m("a", "communities.member.createPost", { communityId, body: "Vendo cosas, escríbeme" }, m.blas));
    expect(errCode(await ess.m("a", "communities.member.report", { target: "post", targetId: post.id, reason: "spam" }, m.blas))).toBe("BAD_REQUEST");
    expect(data(await ess.m("a", "communities.member.report", { target: "post", targetId: post.id, reason: "spam", details: "Publicidad" }, m.ana))).toEqual({ created: true });
    expect(data(await ess.m("a", "communities.member.report", { target: "post", targetId: post.id, reason: "offensive" }, m.ana))).toEqual({ created: false });
    await ess.m("a", "communities.member.report", { target: "post", targetId: post.id, reason: "off_topic" }, m.carla);

    // La campana del panel lo avisa (solo administración, con la capacidad)
    const feed = data(await ess.q("a", "notifications.feed", undefined, adA));
    const sec = feed.sections.find((s: any) => s.kind === "community");
    expect(sec.total).toBe(1);
    expect(sec.items[0]).toMatchObject({ title: "Socios del Lago", ctaPath: `/admin/comunidades/${communityId}` });
    expect(sec.items[0].subtitle).toContain("1 reporte");

    // Un miembro no ve los reportes; una moderadora sí y oculta el contenido
    expect(errCode(await ess.q("a", "communities.member.reports", { communityId }, m.ana))).toBe("FORBIDDEN");
    await ess.m("a", "communities.admin.members.setRole", { memberId: memberId.carla, role: "moderator" }, adA);
    const groups = data(await ess.q("a", "communities.member.reports", { communityId }, m.carla)) as any[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ targetType: "post", targetId: post.id, reports: 2 });
    expect(data(await ess.m("a", "communities.member.resolveReport", { communityId, target: "post", targetId: post.id, action: "hide" }, m.carla))).toEqual({ resolved: 2 });
    expect((await ess.sql("a", "SELECT status FROM community_posts WHERE id = ?", [post.id]))[0].status).toBe("hidden");
    expect((data(await ess.q("a", "communities.admin.reports.list", { communityId, status: "resolved" }, adA)) as any[])).toHaveLength(1);
    expect(data(await ess.q("a", "notifications.feed", undefined, adA)).sections.find((s: any) => s.kind === "community").total).toBe(0);

    const stats = data(await ess.q("a", "communities.admin.stats", { id: communityId }, adA));
    expect(stats.participation).toMatchObject({ proposals: 1, pendingProposals: 0, openReports: 0 });
    expect(stats.participation.polls).toBeGreaterThanOrEqual(4);
    expect(stats.participation.responses).toBeGreaterThanOrEqual(5);
  });

  it("aislamiento y licencia: la otra empresa no ve nada; sin capacidad, ni encuestas ni propuestas", async () => {
    expect(errCode(await ess.q("b", "communities.admin.polls.results", { pollId: 1 }, adB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "communities.admin.proposals.list", { communityId }, adB))).toEqual([]);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM community_polls"))[0].n).toBe(0);
    await ess.setCapability("a", CAP, null);
    expect(isLicenseDenied(await ess.q("a", "communities.member.polls", { communityId }, m.ana), CAP)).toBe(true);
    expect(isLicenseDenied(await ess.m("a", "communities.member.propose", { communityId, title: "x" }, m.ana), CAP)).toBe(true);
    expect(data(await ess.q("a", "notifications.feed", undefined, adA)).sections.find((s: any) => s.kind === "community").total).toBe(0);
    await ess.setCapability("a", CAP, "active");
    expect((data(await ess.q("a", "communities.member.polls", { communityId }, m.ana)) as any[]).length).toBeGreaterThanOrEqual(4);
  });

  function memberUser(k: string): number | null {
    return events.find((e) => e.type === "member.joined" && e.targetId === memberId[k])?.userId ?? null;
  }
});
