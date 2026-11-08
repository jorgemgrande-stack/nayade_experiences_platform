/**
 * Elephant GEO Control — lógica pura (shared/geoControl.ts): plantilla de consultas, métricas de visibilidad por
 * superficie y periodo, detección de cambios, competidores más citados, reglas de oportunidades, conciliación y
 * lectura de la respuesta de referencia. Además, el registro del namespace en el guardián de licencias y el menú.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeReferenceAnswer,
  canTransition,
  computeVisibility,
  detectChanges,
  detectOpportunities,
  diffObservations,
  mentions,
  normalizeDomain,
  observationProblem,
  parseCompetitors,
  periodOf,
  planReconcile,
  presenceOf,
  suggestQueries,
  topCompetitors,
  type GeoObservationLike,
} from "../shared/geoControl";
import { TRPC_ROUTER_CAPABILITIES, capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV } from "../shared/adminNav";

let seq = 0;
const obs = (p: Partial<GeoObservationLike> & { queryId: number; observedOn: string }): GeoObservationLike => ({
  id: ++seq,
  surface: "CHATGPT",
  brandMentioned: false,
  domainCited: false,
  citedUrl: null,
  position: null,
  competitors: [],
  sourceMethod: "manual",
  ...p,
});

describe("plantilla de consultas", () => {
  it("usa nombre, sector y zona; sin sector solo las de marca; sin repetidos", () => {
    const all = suggestQueries({ brandName: "QA Marca", sector: "Clínica dental", zone: "Zaragoza" });
    expect(all.map((s) => s.queryText)).toContain("Mejor clínica dental en Zaragoza");
    expect(all.map((s) => s.queryText)).toContain("QA Marca opiniones");
    expect(all.some((s) => s.intent === "informational")).toBe(true);
    const onlyBrand = suggestQueries({ brandName: "QA Marca" });
    expect(onlyBrand.every((s) => s.queryText.includes("QA Marca"))).toBe(true);
    const noZone = suggestQueries({ sector: "fontanería" });
    expect(noZone.map((s) => s.queryText)).toContain("Mejor fontanería");
    expect(noZone.some((s) => / en $/.test(s.queryText))).toBe(false);
    expect(suggestQueries({})).toEqual([]);
  });
});

describe("utilidades", () => {
  it("competidores sin vacíos ni repetidos (sin distinguir tildes ni mayúsculas)", () => {
    expect(parseCompetitors("Ácme, acme; Beta\n\n gamma ")).toEqual(["Ácme", "Beta", "gamma"]);
  });
  it("dominio normalizado y menciones por palabra completa", () => {
    expect(normalizeDomain("https://www.Ejemplo.es/ruta?x=1")).toBe("ejemplo.es");
    expect(mentions("Te recomiendo Clínica Sonrisa, en el centro", "clinica sonrisa")).toBe(true);
    expect(mentions("Sonrisas Plus", "Sonrisa")).toBe(false);
  });
  it("presencia: mención, enlace y cita", () => {
    expect(presenceOf({ brandMentioned: false, domainCited: false, citedUrl: null })).toBe("none");
    expect(presenceOf({ brandMentioned: true, domainCited: false, citedUrl: null })).toBe("mention");
    expect(presenceOf({ brandMentioned: false, domainCited: true, citedUrl: null })).toBe("link");
    expect(presenceOf({ brandMentioned: true, domainCited: true, citedUrl: "https://x.es" })).toBe("citation");
  });
  it("validación de observaciones", () => {
    expect(observationProblem({ observedOn: "2026-11-09", today: "2026-11-08" })).toMatch(/futura/);
    expect(observationProblem({ observedOn: "2026-02-30", today: "2026-11-08" })).toMatch(/fecha/);
    expect(observationProblem({ observedOn: "2026-11-01", position: 0, today: "2026-11-08" })).toMatch(/posición/);
    expect(observationProblem({ observedOn: "2026-11-01", citedUrl: "ejemplo.es", today: "2026-11-08" })).toMatch(/URL/);
    expect(observationProblem({ observedOn: "2026-11-01", position: 3, citedUrl: "https://ejemplo.es", today: "2026-11-08" })).toBeNull();
  });
  it("periodos: lunes de la semana ISO o mes", () => {
    expect(periodOf("2026-11-08", "week")).toBe("2026-11-02"); // domingo
    expect(periodOf("2026-11-02", "week")).toBe("2026-11-02"); // lunes
    expect(periodOf("2026-11-08", "month")).toBe("2026-11");
  });
});

describe("panel de visibilidad", () => {
  const list = [
    obs({ queryId: 1, surface: "CHATGPT", observedOn: "2026-10-05", brandMentioned: true }),
    obs({ queryId: 1, surface: "CHATGPT", observedOn: "2026-10-20", brandMentioned: false }),
    obs({ queryId: 2, surface: "GEMINI", observedOn: "2026-10-20", domainCited: true, citedUrl: "https://x.es" }),
    obs({ queryId: 2, surface: "PERPLEXITY", observedOn: "2026-11-02" }),
    // Las estimaciones no cuentan
    obs({ queryId: 1, surface: "REFERENCE_AI", observedOn: "2026-11-02", brandMentioned: true, sourceMethod: "assisted" }),
  ];
  it("presencia por superficie, total y nulo sin datos (nunca un 0 % falso)", () => {
    const v = computeVisibility(list, "month");
    expect(v.total).toMatchObject({ observations: 4, present: 2, cited: 1, presenceRate: 0.5, citationRate: 0.25 });
    expect(v.bySurface.find((s) => s.surface === "CHATGPT")).toMatchObject({ observations: 2, presenceRate: 0.5 });
    expect(v.bySurface.find((s) => s.surface === "COPILOT")).toMatchObject({ observations: 0, presenceRate: null });
    expect(v.queriesObserved).toBe(2);
    expect(v.dateRange).toEqual({ from: "2026-10-05", to: "2026-11-02" });
  });
  it("serie temporal solo con los periodos que tienen datos", () => {
    const v = computeVisibility(list, "month");
    expect(v.series.map((p) => p.period)).toEqual(["2026-10", "2026-11"]);
    expect(v.series[0]!.total).toMatchObject({ observations: 3, present: 2 });
    expect(v.series[1]!.bySurface.PERPLEXITY).toMatchObject({ observations: 1, presenceRate: 0 });
    expect(v.series[1]!.bySurface.CHATGPT).toBeUndefined();
    expect(computeVisibility([], "week")).toMatchObject({ total: { observations: 0, presenceRate: null }, series: [], dateRange: null });
  });
  it("competidores más citados", () => {
    const top = topCompetitors([
      obs({ queryId: 1, observedOn: "2026-10-01", competitors: ["Rival A", "Rival B"] }),
      obs({ queryId: 2, observedOn: "2026-10-01", surface: "GEMINI", competitors: ["rival a"] }),
      obs({ queryId: 2, observedOn: "2026-10-02", competitors: ["Rival C"], sourceMethod: "assisted" }),
    ]);
    expect(top[0]).toEqual({ name: "Rival A", mentions: 2, queries: 2, surfaces: ["CHATGPT", "GEMINI"] });
    expect(top.map((c) => c.name)).toEqual(["Rival A", "Rival B"]);
  });
});

describe("cambios", () => {
  it("compara las dos observaciones más recientes de cada consulta y superficie", () => {
    const a = obs({ queryId: 1, observedOn: "2026-10-01", brandMentioned: true, domainCited: true, position: 1, competitors: ["X"] });
    const b = obs({ queryId: 1, observedOn: "2026-10-15", brandMentioned: false, competitors: ["X", "Y"] });
    expect(diffObservations(a, b).map((c) => c.kind)).toEqual(["brand_disappeared", "citation_lost", "new_competitors"]);
    const c = obs({ queryId: 1, observedOn: "2026-10-30", brandMentioned: true, position: 3 });
    const d = obs({ queryId: 1, observedOn: "2026-11-05", brandMentioned: true, position: 1 });
    expect(diffObservations(c, d)).toEqual([{ kind: "position_improved", detail: "3.º → 1.º" }]);
    const changes = detectChanges([a, b, c, d, obs({ queryId: 2, observedOn: "2026-11-01", brandMentioned: true })]);
    // Solo el último par (c → d) de la consulta 1; la consulta 2 tiene una sola observación
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ queryId: 1, surface: "CHATGPT", kind: "position_improved", previousOn: "2026-10-30", currentOn: "2026-11-05", negative: false });
  });
  it("a igualdad de fecha, manda la anotada después; las estimaciones no cuentan", () => {
    const x = obs({ queryId: 3, observedOn: "2026-11-01", brandMentioned: true });
    const y = obs({ queryId: 3, observedOn: "2026-11-01", brandMentioned: false });
    const z = obs({ queryId: 3, observedOn: "2026-11-02", brandMentioned: true, sourceMethod: "assisted" });
    expect(detectChanges([x, y, z]).map((c) => c.kind)).toEqual(["brand_disappeared"]);
  });
});

describe("oportunidades", () => {
  const today = "2026-11-08";
  const queries = [
    { id: 1, queryText: "mejor dentista en Zaragoza", priority: 1 },
    { id: 2, queryText: "QA Marca opiniones", priority: 2 },
    { id: 3, queryText: "cómo elegir dentista", priority: 3 },
    { id: 4, queryText: "dentista urgencias Zaragoza", priority: 1 },
  ];
  const observations = [
    // 1: nunca aparece, con competidores → visibility_gap (alta)
    obs({ queryId: 1, observedOn: "2026-11-01", competitors: ["Rival A"] }),
    obs({ queryId: 1, surface: "GEMINI", observedOn: "2026-11-02", competitors: ["Rival B"] }),
    // 2: se menciona pero nunca se cita, con competidor → citation_gap; y en ChatGPT ha dejado de aparecer → brand_lost
    obs({ queryId: 2, observedOn: "2026-10-01", brandMentioned: true, competitors: ["Rival A"] }),
    obs({ queryId: 2, observedOn: "2026-11-01", brandMentioned: false, competitors: ["Rival A"] }),
    // 3: aparece y se cita → nada
    obs({ queryId: 3, observedOn: "2026-11-01", brandMentioned: true, domainCited: true }),
    // 4: prioridad alta sin observar desde hace más de 30 días → stale_query
    obs({ queryId: 4, observedOn: "2026-09-01", brandMentioned: true, domainCited: true }),
    // Una estimación nunca genera oportunidades
    obs({ queryId: 3, surface: "REFERENCE_AI", observedOn: "2026-11-05", competitors: ["Rival Z"], sourceMethod: "assisted" }),
  ];
  const live = detectOpportunities(queries, observations, today, "QA Marca");
  const keys = live.map((p) => p.naturalKey).sort();

  it("reglas deterministas solo con datos de GEO", () => {
    expect(keys).toEqual(["query:1:visibility_gap", "query:2:brand_lost:CHATGPT", "query:2:citation_gap", "query:4:stale_query"]);
    const gap = live.find((p) => p.type === "visibility_gap")!;
    expect(gap).toMatchObject({ priority: "high", lastEvidenceOn: "2026-11-02" });
    expect(gap.reason).toContain("Rival A");
    expect(live.find((p) => p.type === "citation_gap")!.priority).toBe("low");
    expect(live.find((p) => p.type === "brand_lost")).toMatchObject({ surface: "CHATGPT", priority: "medium" });
  });
  it("sin observaciones, una consulta prioritaria queda pendiente; una de prioridad media no", () => {
    const p = detectOpportunities([{ id: 9, queryText: "x", priority: 1 }, { id: 10, queryText: "y", priority: 2 }], [], today);
    expect(p.map((x) => x.naturalKey)).toEqual(["query:9:stale_query"]);
  });

  it("conciliación: crea, refresca, resuelve lo que desaparece y respeta lo descartado", () => {
    const plan = planReconcile(
      [
        { id: 1, naturalKey: "query:1:visibility_gap", status: "open", resolvedAt: null, autoResolved: true },
        { id: 2, naturalKey: "query:2:citation_gap", status: "dismissed", resolvedAt: null, autoResolved: false },
        { id: 3, naturalKey: "query:3:visibility_gap", status: "in_progress", resolvedAt: null, autoResolved: false },
        { id: 4, naturalKey: "query:5:visibility_gap", status: "dismissed", resolvedAt: null, autoResolved: false },
      ],
      live,
    );
    const summary = plan.map((a) => `${a.action}:${"id" in a ? a.id : a.problem.naturalKey}`).sort();
    expect(summary).toEqual(["create:query:2:brand_lost:CHATGPT", "create:query:4:stale_query", "refresh:1", "resolve:3"]);
  });
  it("conciliación: reabre lo resuelto por las reglas; lo resuelto a mano, solo con evidencia posterior", () => {
    const gap = live.find((p) => p.type === "visibility_gap")!;
    const auto = planReconcile([{ id: 1, naturalKey: gap.naturalKey, status: "resolved", resolvedAt: "2026-11-07T10:00:00.000Z", autoResolved: true }], [gap]);
    expect(auto.map((a) => a.action)).toEqual(["reopen"]);
    const manualOld = planReconcile([{ id: 1, naturalKey: gap.naturalKey, status: "resolved", resolvedAt: "2026-11-07T10:00:00.000Z", autoResolved: false }], [gap]);
    expect(manualOld).toEqual([]);
    const manualNew = planReconcile([{ id: 1, naturalKey: gap.naturalKey, status: "resolved", resolvedAt: "2026-10-01T10:00:00.000Z", autoResolved: false }], [gap]);
    expect(manualNew.map((a) => a.action)).toEqual(["reopen"]);
  });
  it("cambios de estado a mano", () => {
    expect(canTransition("open", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "resolved")).toBe(true);
    expect(canTransition("dismissed", "open")).toBe(true);
    expect(canTransition("resolved", "dismissed")).toBe(false);
  });
});

describe("respuesta de referencia (estimación)", () => {
  it("se analiza de forma determinista: marca, alias, dominio, posición y competidores", () => {
    const a = analyzeReferenceAnswer(
      { text: "Te recomiendo Rival A y también Clínica Sonrisa (https://www.sonrisa-qa.es/citas).", businesses: ["Rival A", "Clínica Sonrisa", "Rival B"], urls: ["https://www.sonrisa-qa.es/citas", "https://rival-a.example"] },
      { brandName: "QA Sonrisa SL", aliases: ["Clínica Sonrisa"], domain: "sonrisa-qa.es" },
    );
    expect(a).toEqual({ brandMentioned: true, domainCited: true, citedUrl: "https://www.sonrisa-qa.es/citas", position: 2, competitors: ["Rival A", "Rival B"] });
    const none = analyzeReferenceAnswer({ text: "Rival A es la mejor opción.", businesses: ["Rival A"], urls: [] }, { brandName: "QA Sonrisa SL", aliases: [], domain: "sonrisa-qa.es" });
    expect(none).toMatchObject({ brandMentioned: false, domainCited: false, position: null, competitors: ["Rival A"] });
  });
});

describe("registro", () => {
  it("el namespace geoControl exige la capacidad geo-control", () => {
    expect(TRPC_ROUTER_CAPABILITIES.geoControl).toBe("geo-control");
    expect(capabilityForProcedure("geoControl.dashboard")).toBe("geo-control");
  });
  it("menú de módulos contratados, solo administración", () => {
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/marketing/geo");
    expect(item).toMatchObject({ capabilities: ["geo-control"], roles: ["admin"] });
  });
});
