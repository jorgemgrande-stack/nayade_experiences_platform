/**
 * Elephant GEO Control con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0048). Licencia geo-control (sin ella y en solo lectura),
 * solo administración, ajustes de la marca, plantilla de consultas, observaciones manuales, panel, cambios,
 * oportunidades con su ciclo de estados y aislamiento entre empresas. «Preguntar a la IA» no se prueba aquí: sin
 * proveedor de IA configurado debe responder que no está disponible, sin guardar nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, licenseMatrix, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "geo-control";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!URL_)("GEO Control · consultas, observaciones, panel y oportunidades (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let q1 = 0;
  let q2 = 0;

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `geoControl.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `geoControl.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "geocontrol");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad geo-control no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("dashboard"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveSettings", { brandName: "QA-GEO Marca" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("queries", undefined, agA))).toBe("FORBIDDEN");
  });

  it("ajustes de la marca y plantilla de consultas", async () => {
    expect((await ok(q("settings"))).configured).toBe(false);
    expect(errCode(await m("saveSettings", { brandName: "QA-GEO Clínica", domain: "no es un dominio" }))).toBe("BAD_REQUEST");
    const s = await ok(m("saveSettings", { brandName: "QA-GEO Clínica", aliases: ["Clínica QA"], domain: "https://www.qa-geo.example/", sector: "Clínica dental", zone: "Zaragoza" }));
    expect(s).toMatchObject({ configured: true, brandName: "QA-GEO Clínica", aliases: ["Clínica QA"], domain: "qa-geo.example", sector: "Clínica dental", zone: "Zaragoza" });
    const sug = (await ok(q("suggestions"))).suggestions;
    expect(sug.map((x: any) => x.queryText)).toContain("Mejor clínica dental en Zaragoza");
    const added = await ok(m("addSuggestions", { items: sug.slice(0, 3) }));
    expect(added).toEqual({ created: 3, skipped: 0 });
    // Idempotente: las mismas no se duplican y dejan de sugerirse
    expect(await ok(m("addSuggestions", { items: sug.slice(0, 3) }))).toEqual({ created: 0, skipped: 3 });
    expect((await ok(q("suggestions"))).suggestions).toHaveLength(sug.length - 3);
  });

  it("alta, edición y archivo de consultas", async () => {
    q1 = (await ok(m("upsertQuery", { queryText: "QA-GEO ¿mejor dentista en Zaragoza?", intent: "comparison", priority: 1 }))).id;
    q2 = (await ok(m("upsertQuery", { queryText: "QA-GEO dentista urgencias", intent: "non_branded", priority: 2 }))).id;
    expect(errCode(await m("upsertQuery", { queryText: "QA-GEO dentista urgencias", intent: "non_branded", priority: 2 }))).toBe("CONFLICT");
    expect(errCode(await m("upsertQuery", { queryText: "x", intent: "non_branded", priority: 2 }))).toBe("BAD_REQUEST");
    await ok(m("upsertQuery", { id: q2, queryText: "QA-GEO dentista de urgencias", intent: "transactional", priority: 2 }));
    const list = await ok(q("queries"));
    expect(list.find((x: any) => x.id === q2)).toMatchObject({ queryText: "QA-GEO dentista de urgencias", intent: "transactional", observations: 0 });
    await ok(m("setQueryArchived", { id: q2, archived: true }));
    expect((await ok(q("queries"))).some((x: any) => x.id === q2)).toBe(false);
    expect((await ok(q("queries", { includeArchived: true }))).find((x: any) => x.id === q2).isArchived).toBe(true);
    expect(errCode(await m("recordObservation", { queryId: q2, surface: "CHATGPT", observedOn: today(), brandMentioned: true, domainCited: false }))).toBe("BAD_REQUEST");
    await ok(m("setQueryArchived", { id: q2, archived: false }));
  });

  it("observaciones manuales, panel, cambios y oportunidades", async () => {
    // Una consulta prioritaria sin observar ya es una oportunidad (pendiente de revisar)
    let opps = await ok(q("opportunities"));
    expect(opps.some((o: any) => o.queryId === q1 && o.type === "stale_query")).toBe(true);

    expect(errCode(await m("recordObservation", { queryId: q1, surface: "CHATGPT", observedOn: "2999-01-01", brandMentioned: false, domainCited: false }))).toBe("BAD_REQUEST");
    await ok(m("recordObservation", { queryId: q1, surface: "CHATGPT", observedOn: daysAgo(10), brandMentioned: true, domainCited: false, position: 2, competitors: ["Rival QA A"] }));
    const o2 = await ok(m("recordObservation", { queryId: q1, surface: "CHATGPT", observedOn: daysAgo(2), brandMentioned: false, domainCited: false, competitors: ["Rival QA A", "Rival QA B"], note: "Ventana privada" }));
    expect(o2).toMatchObject({ queryId: q1, surface: "CHATGPT", brandMentioned: false, sourceMethod: "manual", competitors: ["Rival QA A", "Rival QA B"], note: "Ventana privada" });
    await ok(m("recordObservation", { queryId: q2, surface: "GEMINI", observedOn: daysAgo(1), brandMentioned: true, domainCited: false, citedUrl: "https://qa-geo.example/urgencias" }));

    const dash = await ok(q("dashboard", { days: 30, granularity: "month" }));
    expect(dash.visibility.total).toMatchObject({ observations: 3, present: 2, cited: 1 });
    expect(dash.visibility.bySurface.find((s: any) => s.surface === "CHATGPT")).toMatchObject({ observations: 2, presenceRate: 0.5 });
    expect(dash.changes.map((c: any) => c.kind).sort()).toEqual(["brand_disappeared", "new_competitors"]);
    expect(dash.competitors[0]).toMatchObject({ name: "Rival QA A", mentions: 2 });

    opps = await ok(q("opportunities"));
    const lost = opps.find((o: any) => o.queryId === q1 && o.type === "brand_lost");
    expect(lost).toMatchObject({ status: "open", surface: "CHATGPT", priority: "high" });
    expect(opps.some((o: any) => o.queryId === q1 && o.type === "stale_query")).toBe(false);
    // La que dejó de aplicar se resolvió sola
    const resolved = await ok(q("opportunities", { status: "resolved" }));
    expect(resolved.some((o: any) => o.queryId === q1 && o.type === "stale_query")).toBe(true);

    // Ciclo de estados a mano
    expect((await ok(m("setOpportunityStatus", { id: lost.id, status: "in_progress" }))).status).toBe("in_progress");
    expect((await ok(m("setOpportunityStatus", { id: lost.id, status: "dismissed", note: "Lo revisamos el mes que viene" }))).status).toBe("dismissed");
    expect(errCode(await m("setOpportunityStatus", { id: lost.id, status: "resolved" }))).toBe("BAD_REQUEST");
    // Revisar de nuevo no reabre lo descartado
    await ok(m("reconcile", {}));
    expect((await ok(q("opportunities", { status: "dismissed" }))).find((o: any) => o.id === lost.id)).toBeTruthy();

    // Archivar la observación anotada por error: deja de contar y la oportunidad desaparece de las activas
    await ok(m("setOpportunityStatus", { id: lost.id, status: "open" }));
    await ok(m("archiveObservation", { id: o2.id }));
    const after = await ok(q("dashboard", { days: 30, granularity: "week" }));
    expect(after.visibility.total.observations).toBe(2);
    expect((await ok(q("opportunities"))).some((o: any) => o.id === lost.id)).toBe(false);
    const rows = await ess.sql("a", "SELECT is_archived FROM geo_observations WHERE id = ?", [o2.id]);
    expect(Number(rows[0].is_archived)).toBe(1);
  });

  it("«Preguntar a la IA» sin proveedor de IA no guarda nada", async () => {
    const before = await ok(q("observations", { queryId: q1 }));
    const r = await m("askReferenceAi", { queryId: q1 });
    expect(r.status).not.toBe(200);
    expect(await ok(q("observations", { queryId: q1 }))).toHaveLength(before.length);
  });

  it("aislamiento: otra empresa no ve ni toca los datos de la primera", async () => {
    expect(await ok(q("queries", undefined, adB, "b"))).toEqual([]);
    expect((await ok(q("dashboard", undefined, adB, "b"))).visibility.total.observations).toBe(0);
    expect(errCode(await m("recordObservation", { queryId: q1, surface: "CHATGPT", observedOn: today(), brandMentioned: true, domainCited: false }, adB, "b"))).toBe("NOT_FOUND");
    expect(errCode(await m("setQueryArchived", { id: q1, archived: true }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("en solo lectura se consulta pero no se escribe", async () => {
    const r = await licenseMatrix(ess, CAP, {
      query: () => q("dashboard"),
      mutation: () => m("upsertQuery", { queryText: "QA-GEO solo lectura", intent: "informational", priority: 3 }),
    });
    expect(r.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(r.readOnlyMutation, CAP)).toBe(true);
    expect(isLicenseDenied(r.noneQuery, CAP)).toBe(true);
  });
});
