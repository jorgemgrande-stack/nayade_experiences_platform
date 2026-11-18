/**
 * Inscripción ↔ presupuesto y servicios incluidos (migración 0078) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; ningún cobro real (el presupuesto nace en borrador).
 *  - «Preparar presupuesto» crea UN presupuesto del CRM (una línea = modalidad × plazas) y repetirlo devuelve el mismo.
 *  - Confirmar con el presupuesto sin pagar exige motivo y guarda quién lo hizo; pagar no confirma solo.
 *  - Al confirmar se generan los servicios incluidos de la modalidad (una vez); cancelar los cancela.
 *  - Solo administración; aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

const form = {
  label: "Otoño 2036",
  startsLocal: "2036-11-01T10:00",
  endsLocal: null,
  timezone: "Europe/Madrid",
  scheduleNote: "",
  mode: "online",
  locationNote: "",
  capacity: 10,
  showAvailability: false,
  status: "open",
  priceOverride: null,
};

describe.skipIf(!URL_)("Inscripción con presupuesto y servicios incluidos (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  let agA = "";
  let prod = 0;
  let variant = 0;
  let edition = 0;
  let enrollment = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "inspres");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    expect((await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, admA)).status).toBe(200);
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    expect((await ess.m("a", "products.create", { productType: "own", slug: "programa", title: "Programa", categoryId: cat, locationId: loc, basePrice: "300.00" }, admA)).status).toBe(200);
    prod = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'programa'"))[0].id;
    expect((await ess.m("a", "products.createVariant", { experienceId: prod, name: "Premium", priceModifier: "450.00", priceType: "fixed" }, admA)).status).toBe(200);
    variant = (await ess.sql("a", "SELECT id FROM experience_variants WHERE experienceId = ?", [prod]))[0].id;
    const r = await ess.m("a", "products.editions.create", { experienceId: prod, form }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    edition = data(r).id;
    const add = await ess.m("a", "products.editions.addEnrollment", { editionId: edition, name: "Persona Prueba", email: "persona@ejemplo.example", seats: 2, status: "solicitada" }, admA);
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    enrollment = data(add).id;
    await ess.sql("a", "UPDATE edition_enrollments SET variant_id = ? WHERE id = ?", [variant, enrollment]);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("servicios incluidos de la modalidad: alta, validación y archivo (sin borrar)", async () => {
    const save = await ess.m("a", "products.editions.includedServices.save", { variantId: variant, kind: "individual_session", label: "Sesión individual", quantity: 3, durationMinutes: 30 }, admA);
    expect(save.status, JSON.stringify(save.json)).toBe(200);
    expect(errCode(await ess.m("a", "products.editions.includedServices.save", { variantId: variant, kind: "support", label: "x", quantity: 0, durationMinutes: null }, admA))).toBe("BAD_REQUEST");
    const other = data(await ess.m("a", "products.editions.includedServices.save", { variantId: variant, kind: "support", label: "Soporte archivado", quantity: 1, durationMinutes: null }, admA));
    expect(data(await ess.m("a", "products.editions.includedServices.setStatus", { id: other.id, status: "archived" }, admA)).status).toBe("archived");
    expect((data(await ess.q("a", "products.editions.includedServices.list", { variantId: variant }, admA)) as any[]).length).toBe(2);
  });

  it("«Preparar presupuesto» crea un solo presupuesto del CRM con la línea modalidad × plazas", async () => {
    const [a, b] = await Promise.all([ess.m("a", "products.editions.prepareQuote", { enrollmentId: enrollment }, admA), ess.m("a", "products.editions.prepareQuote", { enrollmentId: enrollment }, admA)]);
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    expect(data(a).quoteId).toBe(data(b).quoteId);
    const again = data(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: enrollment }, admA));
    expect(again).toMatchObject({ created: false, quoteId: data(a).quoteId });
    const quotes = await ess.sql("a", "SELECT id, status, total, items FROM quotes");
    expect(quotes).toHaveLength(1);
    expect(quotes[0].status).toBe("borrador");
    expect(Number(quotes[0].total)).toBe(900);
    const items = typeof quotes[0].items === "string" ? JSON.parse(quotes[0].items) : quotes[0].items;
    expect(items).toEqual([expect.objectContaining({ description: "Programa — Premium · Otoño 2036", quantity: 2, unitPrice: 450, total: 900 })]);
    const list = data(await ess.q("a", "products.editions.enrollments", { editionId: edition }, admA)) as any[];
    expect(list[0]).toMatchObject({ quoteId: data(a).quoteId, variantName: "Premium", payment: { label: "Presupuesto en borrador", paid: false } });
  });

  it("confirmar sin pago exige motivo; con motivo confirma, registra quién y genera los servicios una vez", async () => {
    const no = await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: enrollment, status: "confirmada" }, admA);
    expect(errCode(no)).toBe("BAD_REQUEST");
    const yes = await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: enrollment, status: "confirmada", reason: "Paga por transferencia el lunes" }, admA);
    expect(yes.status, JSON.stringify(yes.json)).toBe(200);
    const [row] = await ess.sql("a", "SELECT status, status_changed_by, status_reason FROM edition_enrollments WHERE id = ?", [enrollment]);
    expect(row.status).toBe("confirmada");
    expect(row.status_changed_by).toBeTruthy();
    expect(row.status_reason).toBe("Paga por transferencia el lunes");
    const log = await ess.sql("a", "SELECT action, actorId FROM crm_activity_log WHERE action = 'enrollment_status_changed'");
    expect(log.length).toBe(1);
    expect(log[0].actorId).toBeTruthy();
    const services = data(await ess.q("a", "products.editions.services.list", { enrollmentId: enrollment }, admA)) as any[];
    expect(services.map((s) => [s.label, s.seq, s.durationMinutes, s.status])).toEqual([["Sesión individual", 1, 30, "pending"], ["Sesión individual", 2, 30, "pending"], ["Sesión individual", 3, 30, "pending"]]);
    const sch = await ess.m("a", "products.editions.services.update", { id: services[0].id, status: "scheduled", scheduledLocal: "2036-11-15T18:30" }, admA);
    expect(sch.status, JSON.stringify(sch.json)).toBe(200);
    expect(data(sch).scheduledFor).toBe("2036-11-15T18:30");
    expect(data(await ess.m("a", "products.editions.services.update", { id: services[1].id, status: "done" }, admA)).status).toBe("done");
  });

  it("cancelar la inscripción cancela lo pendiente y lo programado; lo realizado se conserva", async () => {
    expect((await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: enrollment, status: "cancelada" }, admA)).status).toBe(200);
    const rows = await ess.sql("a", "SELECT status FROM enrollment_services WHERE enrollment_id = ? ORDER BY seq", [enrollment]);
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "done", "cancelled"]);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM enrollment_services WHERE enrollment_id = ?", [enrollment]))[0].n).toBe(3);
  });

  it("solo administración y sin cruzar empresas", async () => {
    expect((await ess.m("a", "products.editions.prepareQuote", { enrollmentId: enrollment }, agA)).status).not.toBe(200);
    expect(errCode(await ess.m("b", "products.editions.prepareQuote", { enrollmentId: enrollment }, admB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "products.editions.services.list", { enrollmentId: enrollment }, admB))).toEqual([]);
  });
});
