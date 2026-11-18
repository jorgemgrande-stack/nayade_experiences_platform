/**
 * Solicitud web completa (migración 0076): bloque «Solicitud web» del CRM, moneda, convocatoria y modalidad.
 *  - Lógica pura del bloque (shared/leadWebRequest.ts).
 *  - processProductRequest escribe convocatoria y moneda en el lead y la modalidad en la inscripción (BD simulada).
 *  - Sin la migración aplicada nada se rompe: la solicitud entra igual y no se escribe lo que no existe.
 *  - Migración aditiva, con reversión, y el esquema de Drizzle no declara las columnas nuevas.
 * La prueba sobre MySQL real está en server/convocatorias.mysql.test.ts y ofertaBajoPeticion.mysql.test.ts (CI).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { clients, experiences, leads } from "../drizzle/schema";
import { buildLeadWebRequestView, formatShownPrice, isWebRequestSource, languageNameEs, normalizeCurrency, productEditionsHref } from "../shared/leadWebRequest";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const UP = "db/migrations/0076_leads_edition_currency_enrollment_variant.sql";
const DOWN = "db/migrations/0076_leads_edition_currency_enrollment_variant.down.sql";

describe("bloque «Solicitud web» (lógica pura)", () => {
  it("moneda: ISO de tres letras en mayúsculas, si no EUR", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency(" EUR ")).toBe("EUR");
    for (const bad of [null, undefined, "", "EURO", "€", 12]) expect(normalizeCurrency(bad)).toBe("EUR");
    expect(normalizeCurrency("xx", "GBP")).toBe("GBP");
  });

  it("precio mostrado con su moneda; sin moneda, solo la cifra; sin precio, nada", () => {
    expect(formatShownPrice("777.00", "EUR")).toMatch(/^777,00\s€$/);
    expect(formatShownPrice(12.5, "USD")).toMatch(/12,50\sUS\$/);
    expect(formatShownPrice("555.00", null)).toBe("555,00");
    expect(formatShownPrice(null, "EUR")).toBeNull();
    expect(formatShownPrice("", "EUR")).toBeNull();
    expect(formatShownPrice("abc", "EUR")).toBeNull();
  });

  it("idioma en español y orígenes web", () => {
    expect(languageNameEs("de")).toBe("Alemán");
    expect(languageNameEs("fr")).toBe("Francés");
    expect(isWebRequestSource("web_solicitud_plaza")).toBe(true);
    expect(isWebRequestSource("web_solicitud_producto")).toBe(true);
    expect(isWebRequestSource("web")).toBe(false);
    expect(productEditionsHref(7)).toBe("/admin/productos?convocatorias=7");
  });

  it("un lead normal no tiene bloque", () => {
    expect(buildLeadWebRequestView({ source: "web", selectedProduct: "Kayak", numberOfPersons: 2 })).toBeNull();
    expect(buildLeadWebRequestView({ source: "ghl_webhook" })).toBeNull();
  });

  it("solicitud de plaza completa: producto, modalidad, precio y moneda, idioma, convocatoria, participantes y origen", () => {
    const v = buildLeadWebRequestView(
      { source: "web_solicitud_plaza", experienceId: 3, selectedProduct: "Curso", variantId: 9, variantLabel: "INTENSIV", shownPrice: "777.00", requestLang: "de", numberOfPersons: 2, isTest: false },
      { currency: "EUR", product: { id: 3, title: "Curso anual", slug: "curso-anual" }, edition: { id: 5, label: "Primavera", startsAt: Date.UTC(2037, 2, 10, 9), endsAt: Date.UTC(2037, 2, 12, 13), timezone: "Europe/Madrid" } },
    )!;
    expect(v).toMatchObject({
      sourceLabel: "Solicitud de plaza",
      product: { id: 3, title: "Curso anual", slug: "curso-anual" },
      variant: { id: 9, label: "INTENSIV" },
      currency: "EUR",
      lang: { code: "de", name: "Alemán" },
      edition: { id: 5, label: "Primavera", experienceId: 3 },
      participants: 2,
      isTest: false,
    });
    expect(v.shownPrice).toMatch(/^777,00\s€$/);
    expect(v.edition!.dates).toMatch(/2037/);
  });

  it("lead anterior a 0076: sin moneda (no se inventa) y con lo que haya", () => {
    const v = buildLeadWebRequestView({ source: "web_solicitud_producto", selectedProduct: "Retiro", shownPrice: "120.00", requestLang: "xx-yy" })!;
    expect(v).toMatchObject({ sourceLabel: "Solicitud de información", product: { title: "Retiro" }, currency: null, shownPrice: "120,00", lang: null, edition: null, variant: null, participants: null });
  });

  it("con campos propios aunque el origen sea otro (p. ej. editado a mano), se enseña sin etiqueta de origen", () => {
    const v = buildLeadWebRequestView({ source: "manual", requestLang: "en" })!;
    expect(v.sourceLabel).toBeNull();
    expect(v.lang).toEqual({ code: "en", name: "Inglés" });
  });
});

describe("migración 0076", () => {
  it("es aditiva: solo añade columnas nullable y la publicación la trata como ordinaria", () => {
    const up = read(UP);
    expect(destructiveMigration(up)).toBeNull();
    expect(extraordinaryChanges([UP, DOWN], "", (f) => read(f))).toEqual([]);
    expect(up).toMatch(/ALTER TABLE leads\s+ADD COLUMN edition_id INT NULL,\s+ADD COLUMN currency CHAR\(3\) NULL;/);
    expect(up).toMatch(/ALTER TABLE edition_enrollments\s+ADD COLUMN variant_id INT NULL;/);
    expect(up).not.toMatch(/NOT NULL|DEFAULT|DROP|IF NOT EXISTS/i);
  });

  it("tiene reversión y es la siguiente tras 0075", () => {
    const down = read(DOWN);
    expect(down).toMatch(/DROP COLUMN edition_id/);
    expect(down).toMatch(/DROP COLUMN currency/);
    expect(down).toMatch(/DROP COLUMN variant_id/);
    const ups = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f) && !f.endsWith(".down.sql")).sort();
    const i = ups.indexOf(path.basename(UP));
    expect(i).toBeGreaterThan(0);
    expect(ups[i - 1]).toMatch(/^0075_/);
  });

  it("el `leads` de Drizzle no declara las columnas nuevas (select/insert seguirían funcionando sin la migración)", () => {
    const cols = Object.values(getTableColumns(leads)).map((c) => c.name);
    expect(cols).toContain("variant_id");
    expect(cols).not.toContain("edition_id");
    expect(cols).not.toContain("currency");
  });
});

// ─── processProductRequest con una BD simulada ─────────────────────────────────

const dialect = new MySqlDialect();
type Q = { sql: string; params: unknown[] };
const state = {
  executed: [] as Q[],
  missing: false,
  product: { id: 3, title: "Curso anual", isPublished: true, offerMode: "priced_request", basePrice: "555.00", currency: "usd" } as Record<string, unknown>,
  variants: [{ id: 9, name: "INTENSIV", priceType: "fixed", priceModifier: "777.00" }],
  edition: null as null | Record<string, unknown>,
  createdLeads: [] as Record<string, unknown>[],
};

const fakeDb = {
  select: () => ({
    from: (t: unknown) => {
      const result = t === experiences ? [state.product] : t === leads ? [] : t === clients ? [{ id: 44 }] : [];
      const chain: any = { where: () => chain, limit: async () => result, then: (r: any) => r(result) };
      return chain;
    },
  }),
  execute: async (q: any) => {
    const { sql, params } = dialect.sqlToQuery(q);
    state.executed.push({ sql, params });
    if (state.missing && /edition_id = |currency = |variant_id = /.test(sql) && /^UPDATE/.test(sql.trim())) {
      throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    }
    if (/^SELECT id, status, lead_id FROM edition_enrollments/.test(sql.trim())) return [[]];
    if (/^INSERT INTO edition_enrollments/.test(sql.trim())) return [{ insertId: 81, affectedRows: 1 }];
    return [{ affectedRows: 1, insertId: 0 }];
  },
};

vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  createLead: async (data: Record<string, unknown>) => { state.createdLeads.push(data); return { id: 500 + state.createdLeads.length, success: true }; },
  getVariantsByExperience: async () => state.variants,
}));
vi.mock("./editionsDb", () => ({
  getRequestableEdition: async () => state.edition,
  isMissingEditionsSchema: (e: any) => e?.code === "ER_BAD_FIELD_ERROR" || e?.code === "ER_NO_SUCH_TABLE",
}));

describe("processProductRequest: convocatoria, moneda y modalidad", () => {
  const ctx = { ip: "203.0.113.9", tenantId: "t1", ipSecret: "s".repeat(32), testMode: true };
  const base = { experienceId: 3, name: "Persona Prueba", consent: true, elapsedMs: 60_000, variantId: 9, lang: "de" };
  let n = 0;
  beforeEach(async () => {
    const { resetProductRequestLimits } = await import("./productRequests");
    resetProductRequestLimits();
    state.executed = [];
    state.createdLeads = [];
    state.missing = false;
    state.edition = null;
  });
  const updates = (re: RegExp) => state.executed.filter((q) => /^UPDATE/.test(q.sql.trim()) && re.test(q.sql));

  it("información: moneda del producto en el lead, sin convocatoria ni inscripción", async () => {
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...base, email: `info${++n}@ejemplo.example` }, ctx);
    expect(r).toMatchObject({ ok: true, kind: "info", leadId: 501, duplicate: false });
    expect(state.createdLeads[0]).toMatchObject({ variantId: 9, variantLabel: "INTENSIV", shownPrice: "777.00", requestLang: "de", source: "web_solicitud_producto", isTest: true });
    const [u] = updates(/UPDATE leads SET edition_id/);
    expect(u.params).toEqual([null, "USD", 501]);
    expect(state.executed.some((q) => /edition_enrollments/.test(q.sql))).toBe(false);
  });

  it("plaza: convocatoria y moneda (EUR si el producto no la tiene) en el lead, modalidad en la inscripción", async () => {
    state.product = { ...state.product, currency: null };
    state.edition = { edition: { id: 5, label: "Primavera", startsAt: Date.UTC(2037, 2, 10, 9), endsAt: null, timezone: "Europe/Madrid" }, state: "open", initialStatus: "solicitada" };
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...base, editionId: 5, seats: 2, email: `plaza${++n}@ejemplo.example` }, ctx);
    expect(r).toMatchObject({ ok: true, kind: "enrollment", enrollmentStatus: "solicitada" });
    expect(state.createdLeads[0]).toMatchObject({ numberOfPersons: 2, source: "web_solicitud_plaza", variantId: 9 });
    expect(updates(/UPDATE leads SET edition_id/)[0].params).toEqual([5, "EUR", r.leadId]);
    expect(updates(/UPDATE edition_enrollments SET variant_id/)[0].params).toEqual([9, 81]);
  });

  it("sin modalidad elegida no se toca la inscripción", async () => {
    state.edition = { edition: { id: 5, label: "Primavera", startsAt: Date.UTC(2037, 2, 10, 9), endsAt: null, timezone: "Europe/Madrid" }, state: "open", initialStatus: "solicitada" };
    const { processProductRequest } = await import("./productRequests");
    await processProductRequest({ ...base, variantId: undefined, editionId: 5, email: `sinvar${++n}@ejemplo.example` }, ctx);
    expect(updates(/edition_enrollments SET variant_id/)).toEqual([]);
    expect(updates(/UPDATE leads SET edition_id/)).toHaveLength(1);
  });

  it("sin la migración 0076: la solicitud entra igual (lead e inscripción) y no lanza", async () => {
    state.missing = true;
    state.edition = { edition: { id: 5, label: "Primavera", startsAt: Date.UTC(2037, 2, 10, 9), endsAt: null, timezone: "Europe/Madrid" }, state: "open", initialStatus: "solicitada" };
    const { processProductRequest } = await import("./productRequests");
    const r = await processProductRequest({ ...base, editionId: 5, email: `sinmig${++n}@ejemplo.example` }, ctx);
    expect(r).toMatchObject({ ok: true, kind: "enrollment", duplicate: false });
    expect(state.executed.some((q) => /^INSERT INTO edition_enrollments/.test(q.sql.trim()))).toBe(true);
  });

  it("lectura del bloque sin la migración: la convocatoria sale de la inscripción y la moneda queda vacía", async () => {
    const { getLeadWebRequest } = await import("./leadWebRequestDb");
    const orig = fakeDb.execute;
    fakeDb.execute = async (q: any) => {
      const { sql } = dialect.sqlToQuery(q);
      if (/SELECT edition_id, currency FROM leads/.test(sql)) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
      if (/FROM edition_enrollments WHERE lead_id/.test(sql)) return [[{ edition_id: 5 }]];
      if (/FROM product_editions/.test(sql)) return [[{ id: 5, label: "Primavera", starts_at: Date.UTC(2037, 2, 10, 9), ends_at: null, timezone: "Europe/Madrid", experience_id: 3 }]];
      if (/FROM experiences/.test(sql)) return [[{ id: 3, title: "Curso anual", slug: "curso-anual" }]];
      return [[]];
    };
    try {
      const v = await getLeadWebRequest({ id: 501, source: "web_solicitud_plaza", experienceId: 3, shownPrice: "777.00", variantLabel: "INTENSIV", numberOfPersons: 1 });
      expect(v).toMatchObject({ currency: null, shownPrice: "777,00", edition: { id: 5, label: "Primavera", experienceId: 3 }, product: { title: "Curso anual" } });
      // Un lead normal no consulta nada
      fakeDb.execute = async () => { throw new Error("no debería consultar"); };
      expect(await getLeadWebRequest({ id: 1, source: "web" })).toBeNull();
    } finally {
      fakeDb.execute = orig;
    }
  });
});
