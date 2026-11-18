/**
 * Panel operativo del Inicio (solicitudes y convocatorias): reglas puras de shared/operationalPanel.ts.
 *  - Solo se enseña con convocatorias o solicitudes web; las secciones vacías no cuentan.
 *  - Listas cortas con su total; enlaces a las pantallas de siempre (CRM y convocatorias del producto).
 *  - Presupuesto sin cobrar = vigente y sin pagar (estado + fecha de pago); sesiones de hoy a 30 días en su zona,
 *    «hora por confirmar» sin hora; convocatorias próximas sin borradores, canceladas ni terminadas.
 * La prueba con MySQL real y dos empresas está en server/circuitoSolicitudes.e2e.mysql.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_OPERATIONAL_PANEL,
  PANEL_LIST_LIMIT,
  SESSION_TIME_TBC,
  buildOperationalPanel,
  inSessionWindow,
  isUnpaidLinkedQuote,
  isUpcomingEdition,
  leadHref,
  quoteHref,
  sessionQueryRange,
  sessionTimeLabel,
  type RawOperationalPanel,
} from "../shared/operationalPanel";

const NOW = Date.UTC(2036, 10, 18, 9, 0); // 18/11/2036 10:00 en Madrid
const DAY = 86_400_000;

const raw = (over: Partial<RawOperationalPanel> = {}): RawOperationalPanel => ({
  editionCount: 0,
  webRequests: { total: 0, rows: [] },
  pendingEditions: { total: 0, rows: [] },
  linkedQuotes: { total: 0, rows: [] },
  upcomingEditions: [],
  sessions: [],
  pendingServices: { total: 0, rows: [] },
  ...over,
});
const web = (id: number, over: Record<string, unknown> = {}) => ({ id, name: `Persona ${id}`, email: `p${id}@ejemplo.example`, source: "web_solicitud_plaza", product: "Paquete", variant: "4 sesiones", lang: "de", edition: "Invierno", isTest: false, createdAt: NOW - id, ...over });
const quote = (enrollmentId: number, quoteStatus: string, paidAt: unknown = null, over: Record<string, unknown> = {}) => ({
  enrollmentId, name: `Alumna ${enrollmentId}`, enrollmentStatus: "solicitada", editionId: 5, experienceId: 7, productTitle: "Paquete", editionLabel: "Invierno",
  quoteId: 100 + enrollmentId, quoteNumber: `PRES-${enrollmentId}`, quoteStatus, paidAt, total: 400, ...over,
});
const session = (sessionId: number, startsOn: string, over: Record<string, unknown> = {}) => ({ sessionId, editionId: 5, experienceId: 7, productTitle: "Paquete", editionLabel: "Invierno", startsOn, startTime: null, durationMinutes: 90, timezone: "Europe/Madrid", index: sessionId, total: 4, participants: 3, ...over });
const edition = (id: number, over: Record<string, unknown> = {}) => ({ id, experienceId: 7, productTitle: "Paquete", label: `Ed ${id}`, status: "open", startsAt: NOW + id * DAY, endsAt: null, timezone: "Europe/Madrid", capacity: 10, reserved: 3, confirmedEnrollments: 3, sessionCount: 4, ...over });

describe("cuándo se enseña la tarjeta", () => {
  it("sin convocatorias ni solicitudes web: oculta (nada decorativo)", () => {
    expect(buildOperationalPanel(raw(), NOW)).toMatchObject({ visible: false, allClear: true });
    expect(EMPTY_OPERATIONAL_PANEL.visible).toBe(false);
    // Sin licencia de una parte (null) tampoco se inventa nada
    const none = buildOperationalPanel(raw({ webRequests: null, pendingEditions: null, linkedQuotes: null, upcomingEditions: null, sessions: null, pendingServices: null }), NOW);
    expect(none.visible).toBe(false);
    expect(none.webRequests).toEqual({ total: 0, items: [] });
  });
  it("con convocatorias (aunque esté todo al día) o con solicitudes web nuevas: visible", () => {
    expect(buildOperationalPanel(raw({ editionCount: 1 }), NOW)).toMatchObject({ visible: true, allClear: true });
    expect(buildOperationalPanel(raw({ webRequests: { total: 1, rows: [web(1)] } }), NOW)).toMatchObject({ visible: true, allClear: false });
  });
});

describe("enlaces a las pantallas de siempre", () => {
  it("oportunidad por correo en el CRM, presupuesto por número, convocatorias del producto", () => {
    expect(leadHref({ email: "ana+1@ejemplo.example", name: "Ana" })).toBe("/admin/crm?tab=leads&search=ana%2B1%40ejemplo.example");
    expect(leadHref({ email: "", name: "Ana López" })).toBe("/admin/crm?tab=leads&search=Ana%20L%C3%B3pez");
    expect(leadHref({})).toBe("/admin/crm?tab=leads");
    expect(quoteHref("PRES-2036-0001")).toBe("/admin/crm?tab=quotes&search=PRES-2036-0001");
    const p = buildOperationalPanel(raw({ editionCount: 1, pendingServices: { total: 1, rows: [{ id: 1, enrollmentId: 2, label: "Sesión individual 90 min", seq: 1, durationMinutes: 90, personName: "Carla", editionId: 5, experienceId: 7, productTitle: "Paquete", editionLabel: "Invierno" }] } }), NOW);
    expect(p.pendingServices.items[0].href).toBe("/admin/productos?convocatorias=7");
  });
});

describe("solicitudes web", () => {
  it("lista corta con el total real; etiqueta, producto, modalidad, idioma y convocatoria", () => {
    const rows = Array.from({ length: 14 }, (_, i) => web(i + 1));
    const p = buildOperationalPanel(raw({ webRequests: { total: 14, rows } }), NOW);
    expect(p.webRequests.total).toBe(14);
    expect(p.webRequests.items).toHaveLength(PANEL_LIST_LIMIT);
    expect(p.webRequests.items[0]).toMatchObject({ leadId: 1, sourceLabel: "Solicitud de plaza", product: "Paquete", variant: "4 sesiones", lang: "de", edition: "Invierno", href: leadHref({ email: "p1@ejemplo.example" }) });
    const info = buildOperationalPanel(raw({ webRequests: { total: 1, rows: [web(1, { source: "web_solicitud_producto", lang: "xx-yy-zz", isTest: true })] } }), NOW).webRequests.items[0];
    expect(info).toMatchObject({ sourceLabel: "Solicitud de información", lang: null, isTest: true });
  });
});

describe("presupuestos enlazados sin cobrar", () => {
  it("vigente y sin pagar; «aceptado» con fecha de pago es cobrado; perdido, caducado o rechazado no cuenta", () => {
    expect(isUnpaidLinkedQuote("borrador", null)).toBe(true);
    expect(isUnpaidLinkedQuote("enviado", null)).toBe(true);
    expect(isUnpaidLinkedQuote("aceptado", null)).toBe(true);
    expect(isUnpaidLinkedQuote("aceptado", new Date())).toBe(false);
    expect(isUnpaidLinkedQuote("pagado", null)).toBe(false);
    expect(isUnpaidLinkedQuote("facturado", null)).toBe(false);
    expect(isUnpaidLinkedQuote("perdido", null)).toBe(false);
    expect(isUnpaidLinkedQuote(null, null)).toBe(false);
  });
  it("filtra también en memoria (la BD ya excluye) y ajusta el total; las canceladas fuera", () => {
    const rows = [quote(1, "borrador"), quote(2, "aceptado", new Date()), quote(3, "enviado", null, { enrollmentStatus: "confirmada" }), quote(4, "borrador", null, { enrollmentStatus: "cancelada" })];
    const p = buildOperationalPanel(raw({ editionCount: 1, linkedQuotes: { total: 4, rows } }), NOW);
    expect(p.unpaidQuotes.total).toBe(2);
    expect(p.unpaidQuotes.items.map((x) => [x.enrollmentId, x.paymentLabel, x.href])).toEqual([
      [1, "Presupuesto en borrador", "/admin/crm?tab=quotes&search=PRES-1"],
      [3, "Presupuesto enviado", "/admin/crm?tab=quotes&search=PRES-3"],
    ]);
    expect(p.unpaidQuotes.items[1].editionHref).toBe("/admin/productos?convocatorias=7");
  });
});

describe("convocatorias próximas y participantes", () => {
  it("sin borradores, canceladas ni terminadas; ordenadas por fecha; participantes = plazas confirmadas", () => {
    expect(isUpcomingEdition({ status: "draft", startsAt: NOW + DAY, endsAt: null }, NOW)).toBe(false);
    expect(isUpcomingEdition({ status: "cancelled", startsAt: NOW + DAY, endsAt: null }, NOW)).toBe(false);
    expect(isUpcomingEdition({ status: "closed", startsAt: NOW - 3 * DAY, endsAt: NOW - DAY }, NOW)).toBe(false);
    expect(isUpcomingEdition({ status: "waitlist", startsAt: NOW - DAY, endsAt: NOW + DAY }, NOW)).toBe(true);
    const p = buildOperationalPanel(raw({ editionCount: 3, upcomingEditions: [edition(9), edition(2, { reserved: 5, confirmedEnrollments: 4 }), edition(4, { status: "draft" })] }), NOW);
    expect(p.upcomingEditions.total).toBe(2);
    expect(p.upcomingEditions.items.map((e) => [e.editionId, e.participants, e.confirmedEnrollments, e.sessionCount])).toEqual([[2, 5, 4, 4], [9, 3, 3, 4]]);
  });
});

describe("sesiones de los próximos 30 días", () => {
  it("de hoy a hoy + 30 en la zona de cada sesión; «hora por confirmar» sin hora; ordenadas", () => {
    expect(sessionTimeLabel(null)).toBe(SESSION_TIME_TBC);
    expect(sessionTimeLabel("18:30")).toBe("18:30");
    expect(sessionTimeLabel("25h")).toBe(SESSION_TIME_TBC);
    expect(inSessionWindow({ startsOn: "2036-11-18", timezone: "Europe/Madrid" }, NOW)).toBe(true);
    expect(inSessionWindow({ startsOn: "2036-11-17", timezone: "Europe/Madrid" }, NOW)).toBe(false);
    expect(inSessionWindow({ startsOn: "2036-12-18", timezone: "Europe/Madrid" }, NOW)).toBe(true);
    expect(inSessionWindow({ startsOn: "2036-12-19", timezone: "Europe/Madrid" }, NOW)).toBe(false);
    // 23:30 UTC del 18: en Madrid ya es el 19 (la sesión del 18 ya pasó), en Bogotá sigue siendo el 18
    const late = Date.UTC(2036, 10, 18, 23, 30);
    expect(inSessionWindow({ startsOn: "2036-11-18", timezone: "Europe/Madrid" }, late)).toBe(false);
    expect(inSessionWindow({ startsOn: "2036-11-18", timezone: "America/Bogota" }, late)).toBe(true);
    expect(sessionQueryRange(NOW)).toEqual({ from: "2036-11-17", to: "2036-12-19" });
    const p = buildOperationalPanel(raw({ editionCount: 1, sessions: [session(3, "2036-12-02"), session(1, "2036-11-25", { startTime: "18:00" }), session(2, "2036-11-25"), session(9, "2037-02-01")] }), NOW);
    expect(p.upcomingSessions.total).toBe(3);
    expect(p.upcomingSessions.items.map((s) => [s.sessionId, s.startsOn, s.timeLabel, s.participants])).toEqual([
      [1, "2036-11-25", "18:00", 3],
      [2, "2036-11-25", SESSION_TIME_TBC, 3],
      [3, "2036-12-02", SESSION_TIME_TBC, 3],
    ]);
  });
});

describe("inscripciones por revisar y servicios pendientes", () => {
  it("por convocatoria con sus solicitadas y en lista de espera; total = inscripciones", () => {
    const p = buildOperationalPanel(raw({ editionCount: 1, pendingEditions: { total: 3, rows: [{ editionId: 5, experienceId: 7, productTitle: "Paquete", editionLabel: "Invierno", startsAt: NOW, timezone: "Europe/Madrid", requested: 2, waitlisted: 1 }, { editionId: 6, experienceId: 7, productTitle: "Paquete", editionLabel: "Vacía", startsAt: NOW, timezone: "Europe/Madrid", requested: 0, waitlisted: 0 }] } }), NOW);
    expect(p.pendingEnrollments.total).toBe(3);
    expect(p.pendingEnrollments.items.map((e) => [e.editionId, e.requested, e.waitlisted, e.href])).toEqual([[5, 2, 1, "/admin/productos?convocatorias=7"]]);
  });
});

describe("solo lectura, solo administración y sin mezclar empresas", () => {
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
  it("las lecturas no escriben ni borran; usan la BD de la empresa en curso", () => {
    const src = read("server/operationalPanelDb.ts");
    expect(src).not.toMatch(/\b(DELETE|UPDATE|INSERT|REPLACE|DROP|ALTER)\b/);
    expect(src).toContain('import { getDb } from "./db"');
    expect(src).not.toMatch(/createPool|createConnection|DATABASE_URL/);
  });
  it("el procedimiento es de administración (como las convocatorias que resume)", () => {
    expect(read("server/routers/coreHome.ts")).toMatch(/operations: adminProcedure\.query\(/);
  });
});
