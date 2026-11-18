/**
 * Inscripción ↔ presupuesto y servicios incluidos (migración 0078).
 *  - Migración aditiva, con reversión, id ≤ 40 caracteres y publicación ordinaria.
 *  - Reglas puras: etiqueta de pago derivada del presupuesto, motivo al confirmar sin pago, línea = precio × plazas,
 *    plan idempotente de servicios incluidos y transiciones.
 *  - Con una BD simulada en memoria: «Preparar presupuesto» idempotente (doble clic y reintento no duplican), un
 *    presupuesto perdido se rehace, confirmar sin pago exige motivo y registra quién, los servicios se generan una sola
 *    vez y se cancelan al cancelar la inscripción; sin la migración nada se rompe.
 * La prueba sobre MySQL real queda para CI (patrón *.mysql.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  canMoveService,
  cleanConfirmReason,
  confirmNeedsReason,
  effectiveQuoteStatus,
  enrollmentQuoteLine,
  enrollmentUnitPrice,
  isQuoteDead,
  planEnrollmentServices,
  quotePaymentView,
  toDatetimeValue,
  validateIncludedService,
} from "../shared/enrollmentCommerce";
import { destructiveMigration, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const UP = "db/migrations/0078_enrollment_quote_services.sql";
const DOWN = "db/migrations/0078_enrollment_quote_services.down.sql";

describe("migración 0078", () => {
  it("id corto, aditiva y la publicación la trata como ordinaria", async () => {
    const { loadMigrations, validateMigrations, MAX_MIGRATION_ID } = await import("../scripts/db/migrationLib");
    const { migrations } = loadMigrations("db/migrations");
    const m = migrations.find((x) => x.id.startsWith("0078_"))!;
    expect(m.id).toBe("0078_enrollment_quote_services");
    expect(m.id.length).toBeLessThanOrEqual(MAX_MIGRATION_ID);
    expect(validateMigrations(migrations)).toEqual([]);
    const up = read(UP);
    expect(destructiveMigration(up)).toBeNull();
    expect(extraordinaryChanges([UP, DOWN], "", (f) => read(f))).toEqual([]);
    expect(up).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bMODIFY\b/i);
    expect(up).toMatch(/ALTER TABLE edition_enrollments\s+ADD COLUMN quote_id INT NULL/);
    expect(up).toMatch(/ADD KEY idx_edition_enrollments_quote \(quote_id\)/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS variant_included_services/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS enrollment_services/);
    expect(up).toMatch(/UNIQUE KEY uq_enrollment_services_unit \(enrollment_id, variant_included_service_id, seq\)/);
  });

  it("tiene reversión que solo quita lo suyo y va justo después de 0077", () => {
    const down = read(DOWN);
    expect(down).toMatch(/DROP TABLE IF EXISTS enrollment_services;/);
    expect(down).toMatch(/DROP TABLE IF EXISTS variant_included_services;/);
    expect(down).toMatch(/DROP COLUMN quote_id/);
    expect(down).not.toMatch(/DROP TABLE IF EXISTS (edition_enrollments|quotes|product_editions)/);
    const ups = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f) && !f.endsWith(".down.sql")).sort();
    expect(ups[ups.indexOf("0078_enrollment_quote_services.sql") - 1]).toMatch(/^0077_/);
  });

  it("la prueba de bajar y subir las migraciones de oferta incluye 0078", () => {
    expect(read("server/ofertaConvocatoriasMigracion.mysql.test.ts")).toContain("enrollment_quote_services");
  });

  it("sin borrados físicos en el código nuevo y Drizzle no declara las tablas", () => {
    for (const f of ["server/enrollmentCommerceDb.ts", "server/editionsDb.ts", "shared/enrollmentCommerce.ts"]) expect(read(f)).not.toMatch(/DELETE\s+FROM/i);
    expect(read("drizzle/schema.ts")).not.toMatch(/enrollment_services|variant_included_services/);
  });
});

describe("estado del pago derivado del presupuesto", () => {
  it("etiquetas en español; pagado o posterior cuenta como cobrado", () => {
    expect(quotePaymentView(null)).toEqual({ label: "Sin presupuesto", tone: "neutral", paid: false });
    expect(quotePaymentView("enviado").label).toBe("Presupuesto enviado");
    expect(quotePaymentView("aceptado")).toMatchObject({ label: "Presupuesto aceptado · pendiente de pago", paid: false });
    expect(quotePaymentView("pagado")).toMatchObject({ label: "Presupuesto pagado", paid: true, tone: "success" });
    expect(quotePaymentView("convertido_reserva").paid).toBe(true);
    expect(quotePaymentView("facturado").paid).toBe(true);
    expect(quotePaymentView("pago_fallido")).toMatchObject({ paid: false, tone: "danger" });
    expect(quotePaymentView("raro").label).toBe("Presupuesto: raro");
  });
  it("cobro manual o Redsys («aceptado» con fecha de pago) cuenta como pagado; sin fecha, tal cual", () => {
    expect(effectiveQuoteStatus("aceptado", new Date())).toBe("pagado");
    expect(effectiveQuoteStatus("aceptado", "2036-11-01 10:00:00")).toBe("pagado");
    expect(effectiveQuoteStatus("aceptado", null)).toBe("aceptado");
    expect(effectiveQuoteStatus("facturado", new Date())).toBe("facturado");
    expect(effectiveQuoteStatus("perdido", new Date())).toBe("perdido");
    expect(effectiveQuoteStatus(null, new Date())).toBeNull();
    expect(confirmNeedsReason(effectiveQuoteStatus("aceptado", new Date()))).toBe(false);
  });
  it("solo un presupuesto perdido, caducado o rechazado se rehace", () => {
    expect(["perdido", "expirado", "rechazado"].every(isQuoteDead)).toBe(true);
    expect(["borrador", "enviado", "aceptado", "pagado", "facturado"].some(isQuoteDead)).toBe(false);
  });
  it("confirmar exige motivo con un presupuesto sin pagar; sin presupuesto o pagado, no", () => {
    expect(confirmNeedsReason(null)).toBe(false);
    expect(confirmNeedsReason("pagado")).toBe(false);
    expect(confirmNeedsReason("facturado")).toBe(false);
    expect(confirmNeedsReason("enviado")).toBe(true);
    expect(confirmNeedsReason("aceptado")).toBe(true);
    expect(confirmNeedsReason("perdido")).toBe(true);
    expect(cleanConfirmReason("  ok ")).toBeNull();
    expect(cleanConfirmReason("Paga el lunes\npor transferencia")).toBe("Paga el lunes por transferencia");
    expect(cleanConfirmReason("x".repeat(900))!.length).toBe(600);
  });
});

describe("línea del presupuesto: precio × plazas", () => {
  const base = { productId: 3, productTitle: "Quantum Soulrise", editionLabel: "Otoño 2026", basePrice: "300.00", editionPrice: null, fiscalRegime: "general", taxRate: "21" };
  it("con modalidad de precio fijo: precio de la modalidad × plazas, con su nombre", () => {
    const l = enrollmentQuoteLine({ ...base, seats: 2, variant: { name: "Premium", priceType: "fixed", priceModifier: "450.00" } });
    expect(l).toEqual({ description: "Quantum Soulrise — Premium · Otoño 2026", quantity: 2, unitPrice: 450, total: 900, fiscalRegime: "general", taxRate: 21, productId: 3 });
  });
  it("modalidad por persona y porcentaje sobre el precio de la convocatoria", () => {
    expect(enrollmentUnitPrice({ basePrice: 300, editionPrice: null, variant: { name: "x", priceType: "per_person", priceModifier: 120 } })).toBe(120);
    expect(enrollmentUnitPrice({ basePrice: 300, editionPrice: 200, variant: { name: "x", priceType: "percentage", priceModifier: 10 } })).toBe(220);
  });
  it("sin modalidad: el de la convocatoria o, si no tiene, el del producto; nunca negativo", () => {
    expect(enrollmentUnitPrice({ basePrice: "300", editionPrice: "250.5", variant: null })).toBe(250.5);
    expect(enrollmentUnitPrice({ basePrice: "300", editionPrice: null, variant: null })).toBe(300);
    expect(enrollmentUnitPrice({ basePrice: null, editionPrice: null, variant: { name: "x", priceType: "fixed", priceModifier: -5 } })).toBe(0);
    const l = enrollmentQuoteLine({ ...base, seats: 3, variant: null, editionPrice: "99.99" });
    expect([l.quantity, l.unitPrice, l.total, l.description]).toEqual([3, 99.99, 299.97, "Quantum Soulrise · Otoño 2026"]);
  });
  it("REAV sin IVA; producto sin tipo de IVA → 21", () => {
    expect(enrollmentQuoteLine({ ...base, seats: 1, variant: null, fiscalRegime: "reav" }).taxRate).toBe(0);
    expect(enrollmentQuoteLine({ ...base, seats: 1, variant: null, taxRate: null }).taxRate).toBe(21);
  });
});

describe("servicios incluidos: plan idempotente y transiciones", () => {
  const defs = [
    { id: 1, label: "Sesión individual", quantity: 3, durationMinutes: 30, status: "active" },
    { id: 2, label: "Soporte por correo", quantity: 1, durationMinutes: null, status: "active" },
    { id: 3, label: "Archivado", quantity: 2, durationMinutes: 60, status: "archived" },
  ];
  it("genera `quantity` unidades por servicio activo con nombre y duración de la configuración", () => {
    const plan = planEnrollmentServices(defs, []);
    expect(plan).toHaveLength(4);
    expect(plan.filter((p) => p.variantIncludedServiceId === 1).map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(plan.find((p) => p.variantIncludedServiceId === 2)).toEqual({ variantIncludedServiceId: 2, seq: 1, label: "Soporte por correo", durationMinutes: null });
    expect(plan.some((p) => p.variantIncludedServiceId === 3)).toBe(false);
  });
  it("lo ya generado no se repite", () => {
    const first = planEnrollmentServices(defs, []);
    expect(planEnrollmentServices(defs, first)).toEqual([]);
    expect(planEnrollmentServices(defs, first.slice(0, 2)).map((p) => `${p.variantIncludedServiceId}:${p.seq}`)).toEqual(["1:3", "2:1"]);
  });
  it("transiciones y validación", () => {
    expect(canMoveService("pending", "scheduled")).toBe(true);
    expect(canMoveService("scheduled", "done")).toBe(true);
    expect(canMoveService("done", "cancelled")).toBe(false);
    expect(canMoveService("cancelled", "done")).toBe(false);
    expect(canMoveService("cancelled", "pending")).toBe(true);
    expect(toDatetimeValue("2026-12-01T18:30")).toBe("2026-12-01 18:30:00");
    expect(toDatetimeValue("2026-02-30T18:30")).toBeNull();
    expect(toDatetimeValue("2026-12-01 18:30")).toBeNull();
    expect(validateIncludedService({ kind: "individual_session", label: "Sesión individual", quantity: 3, durationMinutes: 30 })).toEqual({});
    expect(Object.keys(validateIncludedService({ kind: "x", label: "", quantity: 0, durationMinutes: 0 })).sort()).toEqual(["durationMinutes", "kind", "label", "quantity"]);
  });
});

// ─── BD simulada en memoria ──────────────────────────────────────────────────

const dialect = new MySqlDialect();
type Row = Record<string, any>;
const db = {
  missing: false,
  enrollments: new Map<number, Row>(),
  editions: new Map<number, Row>(),
  quotes: new Map<number, Row>(),
  services: [] as Row[],
  included: [] as Row[],
  logs: [] as Row[],
  quoteCalls: [] as Row[],
  leadCalls: [] as Row[],
};
const missingCol = () => Object.assign(new Error("Unknown column 'quote_id'"), { code: "ER_BAD_FIELD_ERROR" });
const missingTable = () => Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
const ok = (n = 1, insertId = 0) => [{ affectedRows: n, insertId }];
const visible = (r: Row) => {
  if (!db.missing) return { ...r };
  const { quote_id, status_changed_by, status_changed_at, status_reason, ...rest } = r;
  void quote_id; void status_changed_by; void status_changed_at; void status_reason;
  return rest;
};

async function exec(q: any): Promise<unknown> {
  const { sql, params: p } = dialect.sqlToQuery(q);
  const s = sql.replace(/\s+/g, " ").trim();
  const touches0078 = /quote_id|status_changed_by|enrollment_services|variant_included_services/.test(s);
  if (db.missing && touches0078) throw /enrollment_services|variant_included_services/.test(s) ? missingTable() : missingCol();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^SELECT id, quote_id FROM edition_enrollments WHERE id = \? FOR UPDATE$/))) {
    const r = db.enrollments.get(Number(p[0]));
    return [r ? [{ id: r.id, quote_id: r.quote_id }] : []];
  }
  if (/^SELECT \* FROM edition_enrollments WHERE id = \?( FOR UPDATE)?$/.test(s)) {
    const r = db.enrollments.get(Number(p[0]));
    return [r ? [visible(r)] : []];
  }
  if (/^SELECT \* FROM edition_enrollments WHERE edition_id = \?/.test(s)) return [[...db.enrollments.values()].filter((r) => r.edition_id === p[0]).map(visible)];
  if (/^SELECT id, quoteNumber, status, total, paidAt FROM quotes WHERE id IN/.test(s)) return [p.map((id) => db.quotes.get(Number(id))).filter(Boolean)];
  if (/^SELECT id, label, experience_id, price_override, starts_at, timezone FROM product_editions WHERE id = \?$/.test(s)) return [[db.editions.get(Number(p[0]))].filter(Boolean)];
  if (/^SELECT id, status FROM product_editions WHERE id = \? FOR UPDATE$/.test(s)) return [[db.editions.get(Number(p[0]))].filter(Boolean)];
  if (/^SELECT id, title, basePrice, fiscalRegime, taxRate FROM experiences WHERE id = \?$/.test(s)) return [[{ id: p[0], title: "Quantum Soulrise", basePrice: "300.00", fiscalRegime: "general", taxRate: "21.00" }]];
  if (/^SELECT id, name, priceType, priceModifier FROM experience_variants WHERE id = \? AND experienceId = \?$/.test(s)) return [p[0] === 9 ? [{ id: 9, name: "Premium", priceType: "fixed", priceModifier: "450.00" }] : []];
  if (/^SELECT id, name FROM experience_variants WHERE id IN/.test(s)) return [p.includes(9) ? [{ id: 9, name: "Premium" }] : []];
  if (/^SELECT leadId FROM clients WHERE id = \?$/.test(s)) return [[{ leadId: null }]];
  if ((m = s.match(/^UPDATE edition_enrollments SET quote_id = \?, lead_id = COALESCE\(lead_id, \?\), updated_at = \? WHERE id = \?$/))) {
    const r = db.enrollments.get(Number(p[3]))!;
    r.quote_id = p[0];
    r.lead_id = r.lead_id ?? p[1];
    return ok();
  }
  if (/^UPDATE product_editions SET reserved = reserved \+/.test(s)) return ok();
  if (/^UPDATE product_editions SET reserved = GREATEST/.test(s)) return ok();
  if (/^UPDATE edition_enrollments SET status = 'confirmada', confirmed_at = \?/.test(s)) {
    Object.assign(db.enrollments.get(Number(p[2]))!, { status: "confirmada", confirmed_at: p[0] });
    return ok();
  }
  if (/^UPDATE edition_enrollments SET status = \?, confirmed_at = NULL/.test(s)) {
    Object.assign(db.enrollments.get(Number(p[2]))!, { status: p[0], confirmed_at: null });
    return ok();
  }
  if (/^UPDATE edition_enrollments SET status_changed_by = \?, status_changed_at = \?, status_reason = \? WHERE id = \?$/.test(s)) {
    Object.assign(db.enrollments.get(Number(p[3]))!, { status_changed_by: p[0], status_changed_at: p[1], status_reason: p[2] });
    return ok();
  }
  if (/^UPDATE enrollment_services SET status = 'pending', cancelled_by_enrollment = 0, scheduled_for = NULL/.test(s)) {
    const hit = db.services.filter((x) => x.enrollment_id === p[1] && x.status === "cancelled" && x.cancelled_by_enrollment === 1);
    for (const x of hit) Object.assign(x, { status: "pending", cancelled_by_enrollment: 0, scheduled_for: null });
    return ok(hit.length);
  }
  if (/^SELECT id, label, quantity, duration_minutes, status FROM variant_included_services WHERE variant_id = \? AND status = 'active'/.test(s)) return [db.included.filter((x) => x.variant_id === p[0] && x.status === "active")];
  if (/^SELECT variant_included_service_id, seq FROM enrollment_services WHERE enrollment_id = \?$/.test(s)) return [db.services.filter((x) => x.enrollment_id === p[0])];
  if (/^INSERT INTO enrollment_services .* ON DUPLICATE KEY UPDATE id = id$/.test(s)) {
    let n = 0;
    for (let i = 0; i < p.length; i += 7) {
      const [enrollment_id, vis, seq, label, duration_minutes] = p.slice(i, i + 5);
      if (db.services.some((x) => x.enrollment_id === enrollment_id && x.variant_included_service_id === vis && x.seq === seq)) continue;
      db.services.push({ id: db.services.length + 1, enrollment_id, variant_included_service_id: vis, seq, label, duration_minutes, status: "pending", cancelled_by_enrollment: 0 });
      n++;
    }
    return ok(n);
  }
  if (/^UPDATE enrollment_services SET status = 'cancelled', cancelled_by_enrollment = 1/.test(s)) {
    const hit = db.services.filter((x) => x.enrollment_id === p[1] && (x.status === "pending" || x.status === "scheduled"));
    for (const x of hit) Object.assign(x, { status: "cancelled", cancelled_by_enrollment: 1 });
    return ok(hit.length);
  }
  if (/^SELECT enrollment_id, status, COUNT\(\*\) AS n FROM enrollment_services/.test(s)) {
    const out = new Map<string, Row>();
    for (const x of db.services.filter((y) => p.includes(y.enrollment_id))) {
      const k = `${x.enrollment_id}:${x.status}`;
      out.set(k, { enrollment_id: x.enrollment_id, status: x.status, n: (out.get(k)?.n ?? 0) + 1 });
    }
    return [[...out.values()]];
  }
  throw new Error("Consulta no simulada: " + s);
}

// Transacciones en serie: imita el bloqueo FOR UPDATE de la inscripción (una segunda petición espera a la primera)
let chain: Promise<unknown> = Promise.resolve();
const fakeDb = {
  execute: exec,
  transaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn({ execute: exec }));
    chain = run.catch(() => {});
    return run;
  },
};
vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  logActivity: async (entityType: string, entityId: number, action: string, actorId: number | null, actorName: string | null, details: Record<string, unknown>) => {
    db.logs.push({ entityType, entityId, action, actorId, actorName, details });
  },
}));

const actor = { id: 7, name: "Laura Admin" };
let quoteSeq = 100;
const deps = () => ({
  actor,
  createQuote: async (input: Row) => {
    db.quoteCalls.push(input);
    await new Promise((r) => setTimeout(r, 5));
    const id = ++quoteSeq;
    db.quotes.set(id, { id, quoteNumber: `PRES-${id}`, status: "borrador", total: input.total });
    return { quoteId: id, quoteNumber: `PRES-${id}` };
  },
  createLead: async (input: Row) => {
    db.leadCalls.push(input);
    return { id: 900 };
  },
});

function reset() {
  db.missing = false;
  db.enrollments = new Map([
    [1, { id: 1, edition_id: 5, client_id: null, lead_id: 40, name: "Ana", email: "ana@ejemplo.example", seats: 2, status: "solicitada", variant_id: 9, quote_id: null, created_at: 1 }],
    [2, { id: 2, edition_id: 5, client_id: 12, lead_id: null, name: "Bea", email: "bea@ejemplo.example", seats: 1, status: "solicitada", variant_id: null, quote_id: null, created_at: 2 }],
  ]);
  db.editions = new Map([[5, { id: 5, status: "open", label: "Otoño 2026", experience_id: 3, price_override: null, starts_at: Date.UTC(2026, 10, 30, 9), timezone: "Europe/Madrid" }]]);
  db.quotes = new Map();
  db.services = [];
  db.included = [
    { id: 1, variant_id: 9, label: "Sesión individual", quantity: 3, duration_minutes: 30, status: "active" },
    { id: 2, variant_id: 9, label: "Soporte", quantity: 1, duration_minutes: null, status: "active" },
  ];
  db.logs = [];
  db.quoteCalls = [];
  db.leadCalls = [];
}

describe("«Preparar presupuesto» reutiliza el presupuesto del CRM y es idempotente", () => {
  beforeEach(reset);

  it("una línea = producto + modalidad × plazas; se enlaza y se registra en la actividad", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const r = await prepareEnrollmentQuote(1, deps());
    expect(r).toMatchObject({ created: true, quoteNumber: expect.stringMatching(/^PRES-/), total: 900, leadId: 40, replacedQuoteId: null });
    expect(db.quoteCalls).toHaveLength(1);
    const input = db.quoteCalls[0];
    expect(input).toMatchObject({ leadId: 40, total: 900, subtotal: 900, discount: 0, pricesIncludeTax: true, activityDate: "2026-11-30" });
    expect(input.items).toEqual([{ description: "Quantum Soulrise — Premium · Otoño 2026", quantity: 2, unitPrice: 450, total: 900, fiscalRegime: "general", taxRate: 21, productId: 3 }]);
    expect(db.enrollments.get(1)!.quote_id).toBe(r.quoteId);
    expect(db.logs).toEqual([expect.objectContaining({ entityType: "lead", entityId: 40, action: "enrollment_quote_prepared", actorId: 7, actorName: "Laura Admin" })]);
  });

  it("doble clic a la vez y reintento: un solo presupuesto", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const [a, b] = await Promise.all([prepareEnrollmentQuote(1, deps()), prepareEnrollmentQuote(1, deps())]);
    const c = await prepareEnrollmentQuote(1, deps());
    expect(db.quoteCalls).toHaveLength(1);
    expect(new Set([a.quoteId, b.quoteId, c.quoteId]).size).toBe(1);
    expect([a.created, b.created, c.created].filter(Boolean)).toHaveLength(1);
  });

  it("un presupuesto perdido se sustituye por uno nuevo; uno enviado o pagado se devuelve", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const first = await prepareEnrollmentQuote(1, deps());
    db.quotes.get(first.quoteId)!.status = "pagado";
    expect((await prepareEnrollmentQuote(1, deps())).created).toBe(false);
    db.quotes.get(first.quoteId)!.status = "perdido";
    const again = await prepareEnrollmentQuote(1, deps());
    expect(again).toMatchObject({ created: true, replacedQuoteId: first.quoteId });
    expect(again.quoteId).not.toBe(first.quoteId);
  });

  it("sin oportunidad (ni en la inscripción ni en el cliente) crea una y la enlaza; precio del producto sin modalidad", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const r = await prepareEnrollmentQuote(2, deps());
    expect(db.leadCalls).toHaveLength(1);
    expect(r.leadId).toBe(900);
    expect(db.enrollments.get(2)!.lead_id).toBe(900);
    expect(db.quoteCalls[0].items[0]).toMatchObject({ description: "Quantum Soulrise · Otoño 2026", quantity: 1, unitPrice: 300, total: 300 });
  });

  it("una inscripción cancelada no se presupuesta", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    db.enrollments.get(1)!.status = "cancelada";
    await expect(prepareEnrollmentQuote(1, deps())).rejects.toThrow(/cancelada/);
    expect(db.quoteCalls).toHaveLength(0);
  });
});

describe("confirmar la inscripción: paso explícito, motivo sin pago y quién lo hizo", () => {
  beforeEach(reset);

  it("con el presupuesto sin pagar exige motivo; con motivo confirma y lo registra con el actor", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const { setEnrollmentStatus } = await import("./editionsDb");
    await prepareEnrollmentQuote(1, deps());
    db.logs = [];
    await expect(setEnrollmentStatus(1, "confirmada", 1000, { actor })).rejects.toThrow(/no está pagado/);
    expect(db.enrollments.get(1)!.status).toBe("solicitada");
    const r = await setEnrollmentStatus(1, "confirmada", 2000, { actor, reason: "Paga por transferencia el lunes" });
    expect(r).toMatchObject({ changed: true, quoteStatus: "borrador" });
    expect(db.enrollments.get(1)).toMatchObject({ status: "confirmada", status_changed_by: "Laura Admin", status_changed_at: 2000, status_reason: "Paga por transferencia el lunes" });
    expect(db.logs).toEqual([expect.objectContaining({ entityType: "lead", entityId: 40, action: "enrollment_status_changed", actorId: 7, actorName: "Laura Admin", details: expect.objectContaining({ from: "solicitada", to: "confirmada", withoutPayment: true, reason: "Paga por transferencia el lunes" }) })]);
  });

  it("con el presupuesto pagado confirma sin motivo; pagar no confirma solo", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const { setEnrollmentStatus } = await import("./editionsDb");
    const q = await prepareEnrollmentQuote(1, deps());
    db.quotes.get(q.quoteId)!.status = "pagado";
    expect(db.enrollments.get(1)!.status).toBe("solicitada");
    const r = await setEnrollmentStatus(1, "confirmada", 3000, { actor });
    expect(r.changed).toBe(true);
    expect(db.logs.at(-1)!.details).toMatchObject({ withoutPayment: false, quoteStatus: "pagado" });
  });

  it("cobrado a mano (aceptado con fecha de pago, como `crm.quotes.confirmPayment`): confirma sin motivo", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const { setEnrollmentStatus } = await import("./editionsDb");
    const q = await prepareEnrollmentQuote(1, deps());
    Object.assign(db.quotes.get(q.quoteId)!, { status: "aceptado", paidAt: new Date() });
    const r = await setEnrollmentStatus(1, "confirmada", 3000, { actor });
    expect(r.changed).toBe(true);
    expect(db.logs.at(-1)!.details).toMatchObject({ withoutPayment: false, quoteStatus: "pagado" });
  });
  it("sin presupuesto se confirma como siempre (convocatorias gratuitas o gestionadas a mano)", async () => {
    const { setEnrollmentStatus } = await import("./editionsDb");
    expect((await setEnrollmentStatus(2, "confirmada", 4000, { actor })).changed).toBe(true);
  });
});

describe("servicios incluidos al confirmar y al cancelar", () => {
  beforeEach(reset);

  it("se generan una vez (cantidad de la configuración) y no se duplican al reconfirmar", async () => {
    const { setEnrollmentStatus } = await import("./editionsDb");
    const r = await setEnrollmentStatus(1, "confirmada", 1, { actor });
    expect(r.services).toMatchObject({ created: 4 });
    expect(db.services.map((s) => `${s.variant_included_service_id}:${s.seq}:${s.label}:${s.duration_minutes}`)).toEqual(["1:1:Sesión individual:30", "1:2:Sesión individual:30", "1:3:Sesión individual:30", "2:1:Soporte:null"]);
    // Repetir la confirmación no hace nada; cancelar marca las pendientes; reconfirmar las recupera sin duplicar
    expect((await setEnrollmentStatus(1, "confirmada", 2, { actor })).changed).toBe(false);
    db.services[0].status = "done";
    const c = await setEnrollmentStatus(1, "cancelada", 3, { actor });
    expect(c.services).toMatchObject({ cancelled: 3 });
    expect(db.services.map((s) => s.status)).toEqual(["done", "cancelled", "cancelled", "cancelled"]);
    const again = await setEnrollmentStatus(1, "confirmada", 4, { actor });
    expect(again.services).toMatchObject({ created: 0, revived: 3 });
    expect(db.services).toHaveLength(4);
    expect(db.services.map((s) => s.status)).toEqual(["done", "pending", "pending", "pending"]);
  });

  it("sin modalidad no se inventa ningún servicio", async () => {
    const { setEnrollmentStatus } = await import("./editionsDb");
    const r = await setEnrollmentStatus(2, "confirmada", 1, { actor });
    expect(r.services).toMatchObject({ created: 0 });
    expect(db.services).toHaveLength(0);
  });

  it("el listado del panel lleva la modalidad, el estado del presupuesto y el resumen de servicios", async () => {
    const { setEnrollmentStatus, listEnrollments } = await import("./editionsDb");
    await setEnrollmentStatus(1, "confirmada", 1, { actor });
    const list = await listEnrollments(5);
    const ana = list.find((x) => x.id === 1)!;
    expect(ana).toMatchObject({ variantName: "Premium", quote: null, payment: { label: "Sin presupuesto", paid: false }, services: { pending: 4, scheduled: 0, done: 0, cancelled: 0 }, statusChangedBy: "Laura Admin" });
  });
});

describe("sin la migración 0078 nada se rompe", () => {
  beforeEach(() => {
    reset();
    db.missing = true;
  });

  it("listar y cambiar de estado siguen funcionando, sin presupuesto ni servicios", async () => {
    const { setEnrollmentStatus, listEnrollments } = await import("./editionsDb");
    const r = await setEnrollmentStatus(1, "confirmada", 1, { actor });
    expect(r.changed).toBe(true);
    expect(r.services).toEqual({ created: 0, cancelled: 0, revived: 0 });
    const list = await listEnrollments(5);
    expect(list[0]).toMatchObject({ quoteId: null, quote: null, payment: { label: "Sin presupuesto" }, services: { pending: 0 } });
  });

  it("«Preparar presupuesto» da el error de esquema (el router lo traduce a PRECONDITION_FAILED) y no crea nada", async () => {
    const { prepareEnrollmentQuote } = await import("./enrollmentCommerceDb");
    const { isMissingEditionsSchema } = await import("./editionsDb");
    const err = await prepareEnrollmentQuote(1, deps()).catch((e) => e);
    expect(isMissingEditionsSchema(err)).toBe(true);
    expect(db.quoteCalls).toHaveLength(0);
  });

  it("el router traduce la falta de esquema a un aviso claro y usa el servicio de presupuestos del CRM", () => {
    const src = read("server/routers/editions.ts");
    expect(src).toMatch(/PRECONDITION_FAILED", message: "El presupuesto de las inscripciones y los servicios incluidos todavía no están activados/);
    expect(src).toContain("crm.leads.convertToQuote(input)");
    expect(src).not.toMatch(/publicProcedure/);
  });
});
