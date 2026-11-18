/**
 * Sesiones de convocatoria (migración 0077): un paquete vendido una vez con varias fechas.
 *  - Migración aditiva, con reversión y con un id que cabe en el registro (≤ 40 caracteres).
 *  - Reglas puras: validación, duplicados, serie semanal, orden, fechas derivadas y formato público.
 *  - Lo que se publica nunca lleva la nota interna (enlaces de acceso).
 *  - Sin la tabla (migración sin aplicar) nada se rompe: lecturas públicas, recuentos y calendario devuelven vacío.
 * La prueba sobre MySQL real queda para CI (patrón *.mysql.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  addDaysToDate,
  chronologicalOrder,
  deriveEditionRange,
  findDuplicateSession,
  formatSessionLine,
  isValidSessionDate,
  normalizeTime,
  toPublicSessions,
  validateSessionInput,
  weeklySeriesDates,
  type SessionInput,
} from "../shared/editionSessions";
import { localToUtcMs } from "../shared/editions";
import { SITE_UI_TEXT, siteUiText } from "../shared/siteUiText";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const UP = "db/migrations/0077_edition_sessions.sql";
const DOWN = "db/migrations/0077_edition_sessions.down.sql";

describe("migración 0077", () => {
  it("id corto, aditiva (solo crea una tabla) y la publicación la trata como ordinaria", async () => {
    const { loadMigrations, validateMigrations, MAX_MIGRATION_ID } = await import("../scripts/db/migrationLib");
    const { migrations } = loadMigrations("db/migrations");
    const m = migrations.find((x) => x.id.startsWith("0077_"))!;
    expect(m.id).toBe("0077_edition_sessions");
    expect(m.id.length).toBeLessThanOrEqual(MAX_MIGRATION_ID);
    expect(validateMigrations(migrations)).toEqual([]);
    const up = read(UP);
    expect(destructiveMigration(up)).toBeNull();
    expect(extraordinaryChanges([UP, DOWN], "", (f) => read(f))).toEqual([]);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS edition_sessions/);
    expect(up).not.toMatch(/\bALTER\b|\bDROP\b|\bUPDATE\b|\bDELETE\b/i);
    for (const col of ["edition_id       INT UNSIGNED  NOT NULL", "starts_on        DATE          NOT NULL", "start_time       TIME          NULL", "duration_minutes SMALLINT      NULL", "private_note     VARCHAR(600)  NULL"]) expect(up).toContain(col);
    expect(up).toMatch(/KEY idx_edition_sessions_edition \(edition_id/);
  });

  it("tiene reversión que solo borra su tabla y va justo después de 0076", () => {
    const down = read(DOWN);
    expect(down).toMatch(/DROP TABLE IF EXISTS edition_sessions;/);
    expect(down).not.toMatch(/product_editions|edition_enrollments;/);
    const ups = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f) && !f.endsWith(".down.sql")).sort();
    const i = ups.indexOf("0077_edition_sessions.sql");
    expect(ups[i - 1]).toMatch(/^0076_/);
  });

  it("Drizzle no declara la tabla (el código la usa con SQL y tolera que no exista)", () => {
    expect(read("drizzle/schema.ts")).not.toMatch(/edition_sessions/);
  });
});

const ok: SessionInput = { startsOn: "2026-11-29", startTime: "18:00", durationMinutes: 90, timezone: "Europe/Madrid", title: "", status: "scheduled", privateNote: "" };

describe("validación de una sesión", () => {
  it("válida, también con la hora por confirmar y sin duración", () => {
    expect(validateSessionInput(ok)).toEqual({});
    expect(validateSessionInput({ ...ok, startTime: null, durationMinutes: null })).toEqual({});
  });
  it("errores por campo, en español", () => {
    const e = validateSessionInput({ ...ok, startsOn: "2026-02-30", startTime: "25:00", durationMinutes: 0, timezone: "Marte/Base", title: "x".repeat(161), privateNote: "y".repeat(601), status: "otra" as never });
    expect(Object.keys(e).sort()).toEqual(["durationMinutes", "privateNote", "startTime", "startsOn", "status", "timezone", "title"]);
    expect(e.startsOn).toMatch(/fecha/);
  });
  it("fechas dentro de un margen razonable", () => {
    expect(isValidSessionDate("2026-12-06")).toBe(true);
    expect(isValidSessionDate("1999-12-31")).toBe(false);
    expect(isValidSessionDate("2101-01-01")).toBe(false);
    expect(isValidSessionDate("2026-13-01")).toBe(false);
    expect(isValidSessionDate("29/11/2026")).toBe(false);
    expect(validateSessionInput({ ...ok, durationMinutes: 1441 }).durationMinutes).toBeTruthy();
  });
  it("horas de MySQL normalizadas; nada se inventa", () => {
    expect(normalizeTime("18:00:00")).toBe("18:00");
    expect(normalizeTime("9:30")).toBe("09:30");
    expect(normalizeTime(null)).toBeNull();
    expect(normalizeTime("")).toBeNull();
    expect(normalizeTime("basura")).toBeNull();
  });
  it("duplicados: misma fecha y hora (las canceladas y la propia sesión no cuentan)", () => {
    const existing = [
      { id: 1, startsOn: "2026-11-29", startTime: "18:00", status: "scheduled" },
      { id: 2, startsOn: "2026-12-06", startTime: null, status: "scheduled" },
      { id: 3, startsOn: "2026-12-13", startTime: "18:00", status: "cancelled" },
    ];
    expect(findDuplicateSession(existing, { startsOn: "2026-11-29", startTime: "18:00" })?.id).toBe(1);
    expect(findDuplicateSession(existing, { startsOn: "2026-11-29", startTime: "18:00" }, 1)).toBeNull();
    expect(findDuplicateSession(existing, { startsOn: "2026-11-29", startTime: "19:00" })).toBeNull();
    expect(findDuplicateSession(existing, { startsOn: "2026-12-06", startTime: null })?.id).toBe(2);
    expect(findDuplicateSession(existing, { startsOn: "2026-12-13", startTime: "18:00" })).toBeNull();
  });
});

describe("serie semanal", () => {
  it("RECONNECT LIVE: 4 sesiones semanales desde el 29/11/2026", () => {
    expect(weeklySeriesDates("2026-11-29", 4)).toEqual(["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"]);
  });
  it("MORNING IMPULSE: 4 lunes seguidos (cruza de mes y de año)", () => {
    const d = weeklySeriesDates("2026-12-21", 4);
    expect(d).toEqual(["2026-12-21", "2026-12-28", "2027-01-04", "2027-01-11"]);
    expect(d.every((x) => new Date(x + "T12:00:00Z").getUTCDay() === 1)).toBe(true);
  });
  it("cada dos semanas y límites (máximo 100 sesiones)", () => {
    expect(weeklySeriesDates("2026-01-05", 3, 2)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(weeklySeriesDates("2026-01-05", 100)).toHaveLength(100);
    expect(() => weeklySeriesDates("2026-01-05", 101)).toThrow(/100/);
    expect(() => weeklySeriesDates("2026-01-05", 0)).toThrow();
    expect(() => weeklySeriesDates("2026-02-30", 4)).toThrow(/fecha/);
    expect(() => weeklySeriesDates("2026-01-05", 4, 9)).toThrow(/semanas/);
    expect(() => weeklySeriesDates("2099-12-01", 100)).toThrow(/fechas permitidas/);
  });
  it("aritmética de calendario sin zonas (cambio de hora incluido)", () => {
    expect(addDaysToDate("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysToDate("2026-03-29", 7)).toBe("2026-04-05");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
  });
});

const ses = (id: number, startsOn: string, startTime: string | null, durationMinutes: number | null = 90, status: "scheduled" | "done" | "cancelled" = "scheduled", position = id) => ({ id, position, startsOn, startTime, durationMinutes, timezone: "Europe/Madrid", status });

describe("orden y fechas derivadas de la convocatoria", () => {
  it("orden cronológico estable: las de hora por confirmar al final del día", () => {
    const o = chronologicalOrder([ses(1, "2026-12-06", null), ses(2, "2026-11-29", "18:00"), ses(3, "2026-12-06", "10:00"), ses(4, "2026-11-29", "18:00", 90, "scheduled", 0)]);
    expect(o.map((s) => s.id)).toEqual([4, 2, 3, 1]);
  });
  it("inicio = primera sesión a su hora; fin = última sesión + duración", () => {
    const r = deriveEditionRange([ses(1, "2026-12-20", "18:00"), ses(2, "2026-11-29", "18:00"), ses(3, "2026-12-06", "18:00"), ses(4, "2026-12-13", "18:00")], "Europe/Madrid")!;
    expect(r.startsAt).toBe(localToUtcMs("2026-11-29T18:00", "Europe/Madrid"));
    expect(r.endsAt).toBe(localToUtcMs("2026-12-20T19:30", "Europe/Madrid"));
  });
  it("hora por confirmar: el día entero (no se inventa la hora)", () => {
    const r = deriveEditionRange([ses(1, "2026-11-29", null, null), ses(2, "2026-12-20", null, 90)], "Europe/Madrid")!;
    expect(r.startsAt).toBe(localToUtcMs("2026-11-29T00:00", "Europe/Madrid"));
    expect(r.endsAt).toBe(localToUtcMs("2026-12-20T23:59", "Europe/Madrid"));
  });
  it("las canceladas no cuentan; sin sesiones vigentes, la convocatoria conserva sus fechas (null)", () => {
    const r = deriveEditionRange([ses(1, "2026-11-29", "18:00", 90, "cancelled"), ses(2, "2026-12-06", "18:00", 90, "done")], "Europe/Madrid")!;
    expect(r.startsAt).toBe(localToUtcMs("2026-12-06T18:00", "Europe/Madrid"));
    expect(deriveEditionRange([ses(1, "2026-11-29", "18:00", 90, "cancelled")], "Europe/Madrid")).toBeNull();
    expect(deriveEditionRange([], "Europe/Madrid")).toBeNull();
  });
});

describe("web pública", () => {
  const rows = [
    { ...ses(2, "2026-12-06", null), title: "Sesión 2", privateNote: "https://zoom.us/j/123?pwd=secreto" },
    { ...ses(1, "2026-11-29", "18:00"), title: "Apertura", privateNote: "https://zoom.us/j/999" },
    { ...ses(3, "2026-12-13", "18:00", 90, "cancelled"), title: "", privateNote: "" },
  ];
  it("sin nota interna, sin título y sin canceladas, en orden", () => {
    const pub = toPublicSessions(rows);
    expect(pub).toEqual([
      { startsOn: "2026-11-29", startTime: "18:00", durationMinutes: 90, status: "scheduled" },
      { startsOn: "2026-12-06", startTime: null, durationMinutes: 90, status: "scheduled" },
    ]);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/zoom|privateNote|private_note|secreto|title/i);
  });
  it("fecha localizada y «hora por confirmar» / «Uhrzeit folgt» cuando no hay hora", () => {
    const es = siteUiText("es");
    const de = siteUiText("de");
    expect(formatSessionLine({ startsOn: "2026-11-29", startTime: "18:00", durationMinutes: 90 }, { locale: "es-ES", tbcText: es.timeToBeConfirmed, minutesText: es.sessionMinutes })).toBe("domingo, 29 de noviembre de 2026 · 18:00 · 90 min");
    expect(formatSessionLine({ startsOn: "2026-12-07", startTime: null, durationMinutes: 30 }, { locale: "de-DE", tbcText: de.timeToBeConfirmed, minutesText: de.sessionMinutes })).toBe("Montag, 7. Dezember 2026 · Uhrzeit folgt · 30 Min.");
    expect(formatSessionLine({ startsOn: "2026-12-07", startTime: null, durationMinutes: null }, { locale: "en", tbcText: siteUiText("en").timeToBeConfirmed })).toMatch(/December 7, 2026 · time to be confirmed$/);
  });
  it("los textos nuevos existen en los tres idiomas", () => {
    for (const k of ["sessionsHeading", "sessionsCount", "timeToBeConfirmed", "sessionMinutes"] as const) {
      expect(SITE_UI_TEXT.es[k]).toBeTruthy();
      expect(SITE_UI_TEXT.de[k]).toBeTruthy();
      expect(SITE_UI_TEXT.en[k]).toBeTruthy();
    }
    expect(SITE_UI_TEXT.es.timeToBeConfirmed).toBe("hora por confirmar");
    expect(SITE_UI_TEXT.de.timeToBeConfirmed).toBe("Uhrzeit folgt");
  });
});

// ─── BD simulada: tolerancia sin la migración y consultas públicas sin la nota interna ──────────────

const dialect = new MySqlDialect();
const state = { executed: [] as string[], missingSessions: false, sessionRows: [] as Record<string, unknown>[], editionRows: [] as Record<string, unknown>[] };
const missing = () => Object.assign(new Error("Table 'edition_sessions' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
const fakeDb = {
  execute: async (q: any) => {
    const { sql } = dialect.sqlToQuery(q);
    state.executed.push(sql);
    if (/edition_sessions/.test(sql)) {
      if (state.missingSessions) throw missing();
      return [state.sessionRows];
    }
    if (/FROM product_editions e JOIN experiences x/.test(sql)) return [state.editionRows];
    if (/FROM product_editions WHERE id = \? FOR UPDATE/.test(sql)) return [[{ id: 7, timezone: "Europe/Madrid", status: "open" }]];
    return [[]];
  },
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

describe("sin la migración 0077 nada se rompe", () => {
  beforeEach(() => {
    state.executed = [];
    state.missingSessions = true;
    state.sessionRows = [];
    state.editionRows = [];
  });

  it("recuentos, sesiones públicas y calendario devuelven vacío", async () => {
    const m = await import("./editionSessionsDb");
    expect((await m.sessionCounts(fakeDb as never, [1, 2])).size).toBe(0);
    expect((await m.listPublicSessions(fakeDb as never, [1])).size).toBe(0);
    expect(await m.listCalendarSessions("2026-11-01", "2026-12-31")).toEqual([]);
    await expect(m.syncEditionDatesIfAny(5)).resolves.toBeUndefined();
  });

  it("las convocatorias públicas siguen saliendo, sin sesiones", async () => {
    state.editionRows = [{ id: 7, experience_id: 3, label: "Otoño", starts_at: Date.UTC(2037, 0, 1), ends_at: null, timezone: "Europe/Madrid", mode: "online", status: "open", capacity: null, reserved: 0, show_availability: 0, product_title: "Curso", product_slug: "curso", product_price: "0", product_offer_mode: "on_request" }];
    const { listPublicEditions } = await import("./editionsDb");
    const list = await listPublicEditions({ now: Date.UTC(2036, 0, 1) });
    expect(list).toHaveLength(1);
    expect(list[0].sessions).toEqual([]);
  });

  it("las convocatorias de un producto por solicitud (no «activo»: no se vende en línea) también son públicas", async () => {
    const { listPublicEditions } = await import("./editionsDb");
    state.executed = [];
    await listPublicEditions({ experienceId: 24, now: Date.UTC(2036, 0, 1) });
    const q = state.executed.find((s) => /FROM product_editions e JOIN experiences x/.test(s))!;
    expect(q).toContain("x.isPublished = 1");
    expect(q).toContain("(x.isActive = 1 OR x.offer_mode IN ('on_request','priced_request','coming_soon'))");
    expect(q).not.toMatch(/AND x.isActive = 1 AND/);
  });

  it("crear una sesión sin la tabla da el error de esquema (el router lo traduce a un aviso claro)", async () => {
    const { createSession } = await import("./editionSessionsDb");
    const { isMissingEditionsSchema } = await import("./editionsDb");
    const err = await createSession(7, ok).catch((e) => e);
    expect(isMissingEditionsSchema(err)).toBe(true);
  });
});

describe("con la tabla: lo público no lee la nota interna", () => {
  beforeEach(() => {
    state.executed = [];
    state.missingSessions = false;
    state.sessionRows = [
      { id: 1, edition_id: 7, position: 1, starts_on: "2026-11-29", start_time: "18:00", duration_minutes: 90, timezone: "Europe/Madrid", status: "scheduled", private_note: "https://zoom.us/j/1" },
      { id: 2, edition_id: 7, position: 2, starts_on: "2026-12-06", start_time: null, duration_minutes: 90, timezone: "Europe/Madrid", status: "scheduled", private_note: "https://zoom.us/j/2" },
    ];
  });

  it("la consulta pública no pide private_note y el resultado no lo lleva", async () => {
    const { listPublicSessions } = await import("./editionSessionsDb");
    const by = await listPublicSessions(fakeDb as never, [7]);
    const q = state.executed.find((s) => /FROM edition_sessions/.test(s))!;
    expect(q).not.toMatch(/private_note/);
    expect(by.get(7)).toEqual([
      { startsOn: "2026-11-29", startTime: "18:00", durationMinutes: 90, status: "scheduled" },
      { startsOn: "2026-12-06", startTime: null, durationMinutes: 90, status: "scheduled" },
    ]);
    expect(JSON.stringify(by.get(7))).not.toMatch(/zoom/);
  });

  it("el calendario operativo tampoco pide la nota interna y excluye canceladas", async () => {
    const { listCalendarSessions } = await import("./editionSessionsDb");
    await listCalendarSessions("2026-11-01", "2026-12-31");
    const q = state.executed.find((s) => /FROM edition_sessions s\s/.test(s))!;
    expect(q).not.toMatch(/private_note/);
    expect(q).toMatch(/s\.status <> 'cancelled' AND e\.status <> 'cancelled'/);
    expect(q).toMatch(/n\.status = 'confirmada'/);
  });
});

describe("revisión de #864", () => {
  const read = (p: string) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", p), "utf8") as string;
  it("fecha y hora del formulario: expresiones con dígitos reales", () => {
    const src = read("server/routers/editions.ts");
    expect(src).toContain(String.raw`/^\d{4}-\d{2}-\d{2}$/`);
    expect(src).toContain(String.raw`/^\d{2}:\d{2}$/`);
    expect(/^\d{4}-\d{2}-\d{2}$/.test("2026-11-29") && /^\d{2}:\d{2}$/.test("18:30")).toBe(true);
  });
  it("sin borrado físico (publicación ordinaria) y bloqueo de la sesión antes de leer", () => {
    const src = read("server/editionSessionsDb.ts");
    expect(src).not.toMatch(/DELETE\s+FROM/i);
    expect(src.match(/FROM edition_sessions WHERE id = \$\{id\} FOR UPDATE/g)?.length).toBe(3);
  });
  it("el calendario no enseña convocatorias en borrador a agentes y monitores", () => {
    expect(read("server/routers/operations.ts")).toContain('includeDrafts: ctx.user?.role === "admin"');
  });
});
