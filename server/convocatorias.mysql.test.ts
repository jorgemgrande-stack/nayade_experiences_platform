/**
 * Convocatorias con plazas (E-4, migración 0070) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas; ningún cobro ni pedido.
 *  - Ediciones de un producto: crear, editar, duplicar, cancelar, borrar; validación en el servidor.
 *  - Web: solo lo visible (no borradores, canceladas ni terminadas), sin recuento interno de plazas.
 *  - Inscripción = solicitud al CRM (oportunidad + inscripción «solicitada»); no reserva plaza ni crea pedido.
 *  - Sin sobreventa: las plazas solo se ocupan al confirmar, con un UPDATE condicionado; concurrencia real.
 *  - Aislamiento entre empresas y solo administración.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const msg = (r: { json: any }) => String(r.json?.error?.json?.message ?? "");

/** Solicitud de información / plaza: va por `public.submitLead` (consulta ya pública) con `productRequest`. */
const toLead = (p: Record<string, any>) => {
  const { name, email, phone, message, ...rest } = p;
  return { name, email, phone, message, productRequest: rest };
};

const form = (over: Record<string, unknown> = {}) => ({
  label: "Edición de primavera",
  startsLocal: "2037-03-10T10:00",
  // Si el caso cambia el inicio y no dice el fin, no lleva fin (evita un fin anterior al inicio)
  endsLocal: "startsLocal" in over && !("endsLocal" in over) ? null : "2037-03-12T14:00",
  timezone: "Europe/Madrid",
  scheduleNote: "Mañanas de 10:00 a 14:00",
  mode: "presencial",
  locationNote: "Sala principal",
  capacity: 5,
  showAvailability: false,
  status: "open",
  priceOverride: null,
  ...over,
});

describe.skipIf(!URL_)("Convocatorias: fechas, plazas e inscripciones (aplicación real)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  let agA = "";
  const prod = { a: 0, aPetición: 0, b: 0 };
  let cat = 0;
  let loc = 0;
  let n = 0;

  const rpi = (co: "a" | "b", p: Record<string, any>) => ess.m(co, "public.submitLead", toLead(p));
  /** Próximas convocatorias visibles (por `public.getExperiences` con `editions`) */
  const pubEd = (co: "a" | "b", editions: Record<string, unknown>) => ess.q(co, "public.getExperiences", { limit: 12, offset: 0, editions });
  const create = (over: Record<string, unknown> = {}, experienceId = prod.a) => ess.m("a", "products.editions.create", { experienceId, form: form(over) }, admA);
  const mkEdition = async (over: Record<string, unknown> = {}, experienceId = prod.a): Promise<number> => {
    const r = await create(over, experienceId);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return data(r).id;
  };
  const edRow = async (id: number) => (await ess.sql("a", "SELECT * FROM product_editions WHERE id = ?", [id]))[0];
  const request = (over: Record<string, unknown> = {}) => {
    resetProductRequestLimits();
    return rpi("a", { experienceId: prod.a, name: "Persona Prueba", email: `persona${++n}@ejemplo.example`, consent: true, ...over });
  };
  /** Inscripción creada directamente en BD (sin pasar por el límite de solicitudes del visitante) */
  const enroll = async (editionId: number, seats = 1, status = "solicitada") => {
    const now = Date.now();
    const r = await ess.sql("a", "INSERT INTO edition_enrollments (edition_id, name, email, seats, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [editionId, `Alumna ${++n}`, `alumna${n}@ejemplo.example`, seats, status, now, now]);
    return (r as any).insertId as number;
  };
  const setStatus = (enrollmentId: number, status: string, cookie = admA) => ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId, status }, cookie);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "convoc");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    await ess.markPaid("a"); // los correos de servicio salen en una empresa que ya ha contratado
    for (const [co, cookie] of [["a", admA], ["b", admB]] as const) {
      expect((await ess.m(co, "products.createCategory", { slug: "formacion", name: "Formación" }, cookie)).status).toBe(200);
      expect((await ess.m(co, "products.createLocation", { slug: "centro", name: "Centro" }, cookie)).status).toBe(200);
    }
    cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    const catB = (await ess.sql("b", "SELECT id FROM categories LIMIT 1"))[0].id;
    const locB = (await ess.sql("b", "SELECT id FROM locations LIMIT 1"))[0].id;
    const base = { productType: "own" };
    expect((await ess.m("a", "products.create", { ...base, slug: "curso-anual", title: "Curso anual", categoryId: cat, locationId: loc, basePrice: "120.00" }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.create", { ...base, slug: "retiro", title: "Retiro", categoryId: cat, locationId: loc, offerMode: "on_request" }, admA)).status).toBe(200);
    expect((await ess.m("b", "products.create", { ...base, slug: "curso-b", title: "Curso B", categoryId: catB, locationId: locB, basePrice: "10.00" }, admB)).status).toBe(200);
    prod.a = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'curso-anual'"))[0].id;
    prod.aPetición = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'retiro'"))[0].id;
    prod.b = (await ess.sql("b", "SELECT id FROM experiences WHERE slug = 'curso-b'"))[0].id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("crear una edición: se guarda con sus fechas en UTC según su zona horaria y sin plazas ocupadas", async () => {
    const id = await mkEdition();
    const row = await edRow(id);
    expect(row).toMatchObject({ experience_id: prod.a, label: "Edición de primavera", timezone: "Europe/Madrid", mode: "presencial", capacity: 5, reserved: 0, status: "open", show_availability: 0 });
    expect(Number(row.starts_at)).toBe(Date.UTC(2037, 2, 10, 9, 0)); // marzo: UTC+1
    expect(Number(row.ends_at)).toBe(Date.UTC(2037, 2, 12, 13, 0));
    const verano = await mkEdition({ label: "Verano", startsLocal: "2037-07-01T10:00", endsLocal: null, timezone: "America/Bogota", capacity: null });
    const v = await edRow(verano);
    expect(Number(v.starts_at)).toBe(Date.UTC(2037, 6, 1, 15, 0)); // UTC-5 todo el año
    expect([v.capacity, v.ends_at]).toEqual([null, null]);
    const list = data(await ess.q("a", "products.editions.list", { experienceId: prod.a }, admA)) as any[];
    expect(list.map((e) => e.label)).toEqual(["Edición de primavera", "Verano"]);
    expect(list[0].counts).toEqual({ solicitada: 0, confirmada: 0, lista_espera: 0, cancelada: 0 });
  });

  it("validación en el servidor, con textos para la persona", async () => {
    const before = (await ess.sql("a", "SELECT COUNT(*) AS n FROM product_editions"))[0].n;
    expect(msg(await create({ label: "  " }))).toContain("nombre a la edición");
    expect(msg(await create({ endsLocal: "2037-03-09T10:00" }))).toContain("fin no puede ser anterior");
    expect(msg(await create({ capacity: 0 }))).toContain("número entero mayor que 0");
    expect(msg(await create({ timezone: "Marte/Olimpo" }))).toContain("zona horaria");
    expect(msg(await create({ priceOverride: -5 }))).toContain("precio");
    expect(msg(await create({ startsLocal: "2037-02-31T10:00" }))).toContain("inicio");
    expect(errCode(await ess.m("a", "products.editions.create", { experienceId: 999999, form: form() }, admA))).toBe("NOT_FOUND");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM product_editions"))[0].n).toBe(before);
  });

  it("solo administración: un agente no gestiona convocatorias; sin sesión tampoco", async () => {
    const r = await ess.m("a", "products.editions.create", { experienceId: prod.a, form: form() }, agA);
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(r));
    expect(errCode(await ess.m("a", "products.editions.create", { experienceId: prod.a, form: form() }))).toBe("UNAUTHORIZED");
    expect(errCode(await ess.q("a", "products.editions.upcoming", undefined, agA))).not.toBeUndefined();
  });

  it("la web solo ve lo visible: sin borradores, canceladas ni terminadas, y sin el recuento interno de plazas", async () => {
    await ess.sql("a", "UPDATE product_editions SET status = 'cancelled'");
    const abierta = await mkEdition({ label: "Abierta", startsLocal: "2037-04-01T10:00", endsLocal: null, capacity: 10, showAvailability: false });
    const visible = await mkEdition({ label: "Con plazas visibles", startsLocal: "2037-04-05T10:00", endsLocal: null, capacity: 10, showAvailability: true, priceOverride: 99 });
    await mkEdition({ label: "Borrador", status: "draft", startsLocal: "2037-05-01T10:00" });
    const cancelada = await mkEdition({ label: "Cancelada", startsLocal: "2037-05-02T10:00" });
    expect((await ess.m("a", "products.editions.cancel", { id: cancelada }, admA)).status).toBe(200);
    await mkEdition({ label: "Ya pasó", startsLocal: "2020-01-10T10:00", endsLocal: "2020-01-12T10:00" });
    await mkEdition({ label: "Cerrada", status: "closed", startsLocal: "2037-06-01T10:00" });
    await mkEdition({ label: "Lista de espera", status: "waitlist", startsLocal: "2037-06-05T10:00" });
    const pub = data(await pubEd("a", { experienceId: prod.a })) as any[];
    expect(pub.map((e) => [e.label, e.state])).toEqual([
      ["Abierta", "open"],
      ["Con plazas visibles", "open"],
      ["Cerrada", "closed"],
      ["Lista de espera", "waitlist"],
    ]);
    // Sin el recuento interno (capacity / reserved / estado interno) y con plazas libres solo si la empresa lo activó
    for (const e of pub) expect(Object.keys(e)).not.toEqual(expect.arrayContaining(["reserved"]));
    expect(pub.every((e) => !("capacity" in e) && !("reserved" in e) && !("status" in e))).toBe(true);
    expect(pub.map((e) => e.seatsLeft)).toEqual([null, 10, null, null]);
    // Precio: el de la edición o el del producto
    expect(pub.map((e) => e.price)).toEqual([120, 99, 120, 120]);
    expect(abierta).toBeGreaterThan(0);
    expect(visible).toBeGreaterThan(0);
    // Por categoría y para otro producto
    expect((data(await pubEd("a", { categorySlug: "formacion" })) as any[]).length).toBe(4);
    expect(data(await pubEd("a", { categorySlug: "no-existe" }))).toEqual([]);
    expect(data(await pubEd("a", { experienceId: prod.aPetición }))).toEqual([]);
  });

  it("un producto bajo petición enseña sus fechas sin precio", async () => {
    await mkEdition({ label: "Retiro de otoño", priceOverride: 500, startsLocal: "2037-10-01T10:00" }, prod.aPetición);
    const pub = (data(await pubEd("a", { experienceId: prod.aPetición })) as any[])[0];
    expect([pub.label, pub.price]).toEqual(["Retiro de otoño", null]);
  });

  it("solicitar plaza = solicitud al CRM: oportunidad con la edición e inscripción «solicitada»; no reserva plaza ni crea pedido", async () => {
    await ess.sql("a", "UPDATE product_editions SET status = 'cancelled'");
    const ed = await mkEdition({ capacity: 2 });
    const reservations = (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n;
    const r = await request({ editionId: ed, seats: 2, email: "ana@ejemplo.example", name: "Ana Alumna", phone: "600111222", message: "Vamos dos amigas." });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(data(r)).toMatchObject({ ok: true, kind: "enrollment", enrollmentStatus: "solicitada", duplicate: false });
    const [lead] = await ess.sql("a", "SELECT id, experienceId, source, message, numberOfPersons FROM leads WHERE id = ?", [data(r).leadId]);
    expect(lead).toMatchObject({ experienceId: prod.a, source: "web_solicitud_plaza", numberOfPersons: 2 });
    expect(lead.message).toContain("Solicitud de plaza en «Curso anual» · Edición de primavera");
    expect(lead.message).toContain("Plazas: 2");
    expect(lead.message).toContain("Consentimiento RGPD: aceptado");
    const [en] = await ess.sql("a", "SELECT * FROM edition_enrollments WHERE edition_id = ?", [ed]);
    expect(en).toMatchObject({ lead_id: lead.id, name: "Ana Alumna", email: "ana@ejemplo.example", seats: 2, status: "solicitada", consent_given: 1, order_id: null });
    expect(en.consent_text).toContain("política de privacidad");
    expect(en.ip_hash === null || /^[0-9a-f]{64}$/.test(en.ip_hash)).toBe(true);
    // No ocupa plaza, no crea pedido ni factura
    expect((await edRow(ed)).reserved).toBe(0);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(reservations);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices"))[0].n).toBe(0);
    // La misma persona otra vez: no se duplica, se anota en su oportunidad
    const again = await request({ editionId: ed, email: "ANA@ejemplo.example", name: "Ana Alumna", message: "Otra duda" });
    expect(data(again)).toMatchObject({ duplicate: true, leadId: lead.id });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments WHERE edition_id = ?", [ed]))[0].n).toBe(1);
    expect(JSON.stringify((await ess.sql("a", "SELECT internalNotes FROM leads WHERE id = ?", [lead.id]))[0].internalNotes)).toContain("Otra duda");
    // El panel la ve, con quién es y en qué estado
    const list = data(await ess.q("a", "products.editions.enrollments", { editionId: ed }, admA)) as any[];
    expect(list.map((e) => [e.name, e.seats, e.status, e.leadId])).toEqual([["Ana Alumna", 2, "solicitada", lead.id]]);
  });

  it("solicitudes no válidas: edición ajena, borrador, cancelada, cerrada, terminada, sin consentimiento", async () => {
    const draft = await mkEdition({ status: "draft" });
    const closed = await mkEdition({ status: "closed" });
    const cancelled = await mkEdition({});
    await ess.m("a", "products.editions.cancel", { id: cancelled }, admA);
    const past = await mkEdition({ startsLocal: "2020-01-10T10:00", endsLocal: "2020-01-11T10:00" });
    const before = (await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments"))[0].n;
    for (const id of [draft, cancelled, past]) expect(errCode(await request({ editionId: id }))).toBe("NOT_FOUND");
    expect(errCode(await request({ editionId: closed }))).toBe("BAD_REQUEST");
    // Una edición de otro producto no vale con este producto
    const other = await mkEdition({}, prod.aPetición);
    expect(errCode(await request({ editionId: other }))).toBe("NOT_FOUND");
    expect(msg(await request({ editionId: other, consent: false }))).toContain("privacidad");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments"))[0].n).toBe(before);
  });

  it("edición completa o en lista de espera: la solicitud entra en «lista de espera»", async () => {
    const full = await mkEdition({ capacity: 1 });
    const first = await enroll(full, 1);
    expect((await setStatus(first, "confirmada")).status).toBe(200);
    const w = await request({ editionId: full });
    expect(data(w)).toMatchObject({ enrollmentStatus: "lista_espera" });
    expect((data(await pubEd("a", { experienceId: prod.a })) as any[]).find((e) => e.id === full)?.state).toBe("full");
    const waitlist = await mkEdition({ status: "waitlist", capacity: 10 });
    expect(data(await request({ editionId: waitlist }))).toMatchObject({ enrollmentStatus: "lista_espera" });
  });

  it("confirmar ocupa plazas; confirmar de nuevo no hace nada; sin plazas se rechaza; cancelar las libera", async () => {
    const ed = await mkEdition({ capacity: 3 });
    const [a, b, c] = [await enroll(ed, 1), await enroll(ed, 2), await enroll(ed, 2)];
    expect((await setStatus(a, "confirmada")).status).toBe(200);
    expect((await edRow(ed)).reserved).toBe(1);
    expect(data(await setStatus(a, "confirmada"))).toMatchObject({ changed: false });
    expect((await edRow(ed)).reserved).toBe(1);
    expect((await setStatus(b, "confirmada")).status).toBe(200);
    expect((await edRow(ed)).reserved).toBe(3);
    const full = await setStatus(c, "confirmada");
    expect(errCode(full)).toBe("CONFLICT");
    expect(msg(full)).toContain("No quedan plazas");
    expect((await ess.sql("a", "SELECT status FROM edition_enrollments WHERE id = ?", [c]))[0].status).toBe("solicitada");
    expect((await edRow(ed)).reserved).toBe(3);
    // Cancelar una confirmada libera sus plazas (y solo una vez)
    expect((await setStatus(b, "cancelada")).status).toBe(200);
    expect(data(await setStatus(b, "cancelada"))).toMatchObject({ changed: false });
    expect((await edRow(ed)).reserved).toBe(1);
    expect((await setStatus(c, "confirmada")).status).toBe(200);
    expect((await edRow(ed)).reserved).toBe(3);
    // Pasar una confirmada a lista de espera también libera
    expect((await setStatus(c, "lista_espera")).status).toBe(200);
    expect((await edRow(ed)).reserved).toBe(1);
    // Sin límite de plazas: siempre cabe
    const free = await mkEdition({ capacity: null });
    for (let i = 0; i < 4; i++) expect((await setStatus(await enroll(free, 10), "confirmada")).status).toBe(200);
    expect((await edRow(free)).reserved).toBe(40);
  });

  it("SIN SOBREVENTA con concurrencia: 14 confirmaciones a la vez para 5 plazas", async () => {
    const ed = await mkEdition({ capacity: 5 });
    const ids: number[] = [];
    for (let i = 0; i < 14; i++) ids.push(await enroll(ed, 1));
    const rs = await Promise.all(ids.map((id) => setStatus(id, "confirmada")));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    expect(rs.filter((r) => errCode(r) === "CONFLICT")).toHaveLength(9);
    expect((await edRow(ed)).reserved).toBe(5);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments WHERE edition_id = ? AND status = 'confirmada'", [ed]))[0].n).toBe(5);
    // Con plazas de distinto tamaño: capacidad 7, doce inscripciones de 2 plazas → caben 3
    const ed2 = await mkEdition({ capacity: 7 });
    const ids2: number[] = [];
    for (let i = 0; i < 12; i++) ids2.push(await enroll(ed2, 2));
    const rs2 = await Promise.all(ids2.map((id) => setStatus(id, "confirmada")));
    expect(rs2.filter((r) => r.status === 200)).toHaveLength(3);
    expect((await edRow(ed2)).reserved).toBe(6);
    // Confirmar y cancelar a la vez nunca deja el contador negativo ni por encima de las plazas
    const ed3 = await mkEdition({ capacity: 4 });
    const ids3: number[] = [];
    for (let i = 0; i < 8; i++) ids3.push(await enroll(ed3, 1));
    await Promise.all(ids3.flatMap((id) => [setStatus(id, "confirmada"), setStatus(id, "cancelada")]));
    const row3 = await edRow(ed3);
    const confirmed = (await ess.sql("a", "SELECT COALESCE(SUM(seats),0) AS n FROM edition_enrollments WHERE edition_id = ? AND status = 'confirmada'", [ed3]))[0].n;
    expect(row3.reserved).toBe(Number(confirmed));
    expect(row3.reserved).toBeGreaterThanOrEqual(0);
    expect(row3.reserved).toBeLessThanOrEqual(4);
  });

  it("la restricción de la base de datos es la última red: no admite más plazas ocupadas que plazas", async () => {
    const ed = await mkEdition({ capacity: 2 });
    await expect(ess.sql("a", "UPDATE product_editions SET reserved = 3 WHERE id = ?", [ed])).rejects.toThrow();
    await expect(ess.sql("a", "UPDATE product_editions SET reserved = -1 WHERE id = ?", [ed])).rejects.toThrow();
    expect((await edRow(ed)).reserved).toBe(0);
  });

  it("cambiar las plazas: ampliar vale; bajar por debajo de las confirmadas se rechaza; se puede reparar el contador", async () => {
    const ed = await mkEdition({ capacity: 4 });
    for (const id of [await enroll(ed, 2), await enroll(ed, 1)]) await setStatus(id, "confirmada");
    expect((await edRow(ed)).reserved).toBe(3);
    const low = await ess.m("a", "products.editions.update", { id: ed, form: form({ capacity: 2 }) }, admA);
    expect(errCode(low)).toBe("CONFLICT");
    expect(msg(low)).toContain("Ya hay 3 plazas confirmadas");
    expect((await edRow(ed)).capacity).toBe(4);
    expect((await ess.m("a", "products.editions.update", { id: ed, form: form({ capacity: 3, label: "Renombrada" }) }, admA)).status).toBe(200);
    expect((await ess.m("a", "products.editions.update", { id: ed, form: form({ capacity: null }) }, admA)).status).toBe(200);
    expect(await edRow(ed)).toMatchObject({ capacity: null, reserved: 3 });
    // Contador descuadrado a propósito: se repara a partir de las inscripciones confirmadas
    await ess.sql("a", "UPDATE product_editions SET reserved = 0 WHERE id = ?", [ed]);
    expect(data(await ess.m("a", "products.editions.recount", { editionId: ed }, admA))).toEqual({ reserved: 3 });
    expect((await edRow(ed)).reserved).toBe(3);
  });

  it("«Crear nueva edición a partir de esta»: copia como borrador, sin plazas ocupadas ni inscripciones", async () => {
    const ed = await mkEdition({ capacity: 6, mode: "hibrido", locationNote: "Aula 3 y enlace", priceOverride: 80 });
    await setStatus(await enroll(ed, 2), "confirmada");
    const r = await ess.m("a", "products.editions.duplicate", { id: ed, startsLocal: "2038-03-09T10:00", endsLocal: "2038-03-11T14:00" }, admA);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const copy = await edRow(data(r).id);
    expect(copy).toMatchObject({ experience_id: prod.a, label: "Edición de primavera (copia)", status: "draft", reserved: 0, capacity: 6, mode: "hibrido", location_note: "Aula 3 y enlace" });
    expect(Number(copy.price_override)).toBe(80);
    expect(Number(copy.starts_at)).toBe(Date.UTC(2038, 2, 9, 9, 0));
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments WHERE edition_id = ?", [copy.id]))[0].n).toBe(0);
    // El original no cambia
    expect((await edRow(ed)).reserved).toBe(2);
  });

  it("cancelar una edición: deja de verse, conserva las inscripciones (avisa de cuántas) y ya no admite confirmar", async () => {
    const ed = await mkEdition({ capacity: 5 });
    const [a, b] = [await enroll(ed, 1), await enroll(ed, 1)];
    await setStatus(a, "confirmada");
    const r = await ess.m("a", "products.editions.cancel", { id: ed }, admA);
    expect(data(r)).toMatchObject({ toNotify: 2 });
    expect((await edRow(ed)).status).toBe("cancelled");
    expect((data(await pubEd("a", { experienceId: prod.a })) as any[]).map((e) => e.id)).not.toContain(ed);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments WHERE edition_id = ?", [ed]))[0].n).toBe(2);
    expect(errCode(await setStatus(b, "confirmada"))).toBe("BAD_REQUEST");
    // Una convocatoria nunca se borra: no existe ningún procedimiento para ello
    expect(errCode(await ess.m("a", "products.editions.remove", { id: ed }, admA))).toBe("NOT_FOUND");
  });

  it("próximas convocatorias de toda la tienda para el panel (sin terminadas ni canceladas)", async () => {
    const up = data(await ess.q("a", "products.editions.upcoming", undefined, admA)) as any[];
    expect(up.length).toBeGreaterThan(3);
    expect(up.every((e) => e.status !== "cancelled" && e.startsAt + 86400000 > Date.now())).toBe(true);
    expect(up.map((e) => e.startsAt)).toEqual([...up.map((e) => e.startsAt)].sort((x, y) => x - y));
    expect(new Set(up.map((e) => e.productTitle))).toEqual(new Set(["Curso anual", "Retiro"]));
  });

  it("aislamiento: la otra empresa no ve, no cambia ni confirma nada de las convocatorias de ésta", async () => {
    const ed = await mkEdition({ capacity: 3 });
    const enr = await enroll(ed, 1);
    // B no tiene ese producto ni esa edición
    expect(data(await ess.q("b", "products.editions.list", { experienceId: prod.a }, admB))).toEqual([]);
    expect(data(await ess.q("b", "products.editions.upcoming", undefined, admB))).toEqual([]);
    expect(data(await pubEd("b", { experienceId: prod.a }))).toEqual([]);
    expect(errCode(await ess.m("b", "products.editions.update", { id: ed, form: form() }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "products.editions.cancel", { id: ed }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "products.editions.setEnrollmentStatus", { enrollmentId: enr, status: "confirmada" }, admB))).toBe("NOT_FOUND");
    expect(errCode(await rpi("b", { experienceId: prod.a, editionId: ed, name: "Intrusa", email: "intrusa@ejemplo.example", consent: true }))).toBe("NOT_FOUND");
    expect((await edRow(ed)).reserved).toBe(0);
    // B tiene sus propias convocatorias, que A no ve
    const rb = await ess.m("b", "products.editions.create", { experienceId: prod.b, form: form({ label: "Solo de B" }) }, admB);
    expect(rb.status).toBe(200);
    expect((data(await pubEd("b", { experienceId: prod.b })) as any[]).map((e) => e.label)).toEqual(["Solo de B"]);
    expect((data(await ess.q("a", "products.editions.upcoming", undefined, admA)) as any[]).map((e) => e.label)).not.toContain("Solo de B");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM edition_enrollments"))[0].n).toBe(0);
  });

  it("alta manual: se busca a la persona entre clientes y oportunidades; no ocupa plaza hasta confirmarla; sin duplicados", async () => {
    const ed = await mkEdition({ capacity: 1 });
    const lead = await request({ experienceId: prod.a, name: "Berta Buscada", email: "berta@ejemplo.example", phone: "611222333" });
    const leadId = data(lead).leadId;
    const hits = data(await ess.q("a", "products.editions.searchPeople", { q: "bert" }, admA)) as any[];
    expect(hits.map((h) => [h.kind, h.email])).toContainEqual(["client", "berta@ejemplo.example"]);
    expect(hits.filter((h) => h.email === "berta@ejemplo.example")).toHaveLength(1); // cliente y oportunidad: una sola vez
    expect(data(await ess.q("a", "products.editions.searchPeople", { q: "b" }, admA))).toEqual([]); // mínimo 2 letras
    expect(data(await ess.q("a", "products.editions.searchPeople", { q: "%%" }, admA))).toEqual([]); // los comodines no valen
    const add = await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Berta Buscada", email: "Berta@Ejemplo.example", phone: "611222333", seats: 1, status: "solicitada", notes: "Llamó por teléfono", source: { kind: "lead", id: leadId } }, admA);
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    expect(data(add)).toMatchObject({ status: "solicitada", leadId, email: "berta@ejemplo.example", consentGiven: false });
    expect((await edRow(ed)).reserved).toBe(0);
    expect(errCode(await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Berta Buscada", email: "berta@ejemplo.example", seats: 1, status: "solicitada" }, admA))).toBe("CONFLICT");
    // Confirmar es el paso que ocupa plaza, con las mismas reglas
    expect((await setStatus(data(add).id, "confirmada")).status).toBe(200);
    const second = await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Carlos Segundo", email: "carlos@ejemplo.example", seats: 1, status: "solicitada" }, admA);
    expect(errCode(await setStatus(data(second).id, "confirmada"))).toBe("CONFLICT");
    // Validación, edición cancelada, persona inexistente, solo administración y aislamiento
    const bad = (over: Record<string, unknown>) => ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Dora Datos", email: "dora@ejemplo.example", seats: 1, status: "solicitada", ...over }, admA);
    expect(msg(await bad({ name: "x" }))).toContain("nombre");
    expect(msg(await bad({ email: "no" }))).toContain("correo");
    expect(msg(await bad({ phone: "abc" }))).toContain("teléfono");
    expect(msg(await bad({ seats: 0 }))).toContain("Las plazas");
    expect(errCode(await bad({ source: { kind: "client", id: 999999 } }))).toBe("NOT_FOUND");
    expect(errCode(await bad({ status: "confirmada" }))).toBe("BAD_REQUEST"); // solo solicitada o lista de espera
    const cancelled = await mkEdition({});
    await ess.m("a", "products.editions.cancel", { id: cancelled }, admA);
    expect(errCode(await bad({ editionId: cancelled }))).toBe("BAD_REQUEST");
    const agent = await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Dora Datos", email: "dora@ejemplo.example", seats: 1, status: "solicitada" }, agA);
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(agent));
    expect(errCode(await ess.m("b", "products.editions.addEnrollment", { editionId: ed, name: "Dora Datos", email: "dora@ejemplo.example", seats: 1, status: "solicitada" }, admB))).toBe("NOT_FOUND");
    expect(data(await ess.q("b", "products.editions.searchPeople", { q: "berta" }, admB))).toEqual([]);
  });

  it("alta manual sin elegir persona: se enlaza al CRM (cliente y oportunidad), sin duplicar contactos", async () => {
    const ed = await mkEdition({ capacity: 5 });
    const count = async (email: string) => ({
      clients: (await ess.sql("a", "SELECT COUNT(*) AS n FROM clients WHERE email = ?", [email]))[0].n,
      leads: (await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email = ?", [email]))[0].n,
    });
    // Persona nueva (llamó por teléfono): se crea su oportunidad y su cliente, y la inscripción queda enlazada a ambos
    const a = await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Nuria Nueva", email: "Nuria@Ejemplo.example", phone: "611000111", seats: 2, status: "solicitada", notes: "Llamó" }, admA);
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    const na = data(a);
    expect(na.leadId).toBeGreaterThan(0);
    expect(na.clientId).toBeGreaterThan(0);
    expect(await count("nuria@ejemplo.example")).toEqual({ clients: 1, leads: 1 });
    const lead = (await ess.sql("a", "SELECT source, experienceId, numberOfPersons FROM leads WHERE id = ?", [na.leadId]))[0];
    expect(lead).toMatchObject({ source: "panel_inscripcion", experienceId: prod.a, numberOfPersons: 2 });
    expect((await edRow(ed)).reserved).toBe(0); // sigue sin ocupar plaza
    // La misma persona en otra convocatoria: se reutiliza el cliente y su oportunidad, no se crea otra
    const ed2 = await mkEdition({ capacity: 5, label: "Otra edición" });
    const b = await ess.m("a", "products.editions.addEnrollment", { editionId: ed2, name: "Nuria Nueva", email: "nuria@ejemplo.example", seats: 1, status: "solicitada" }, admA);
    expect(data(b)).toMatchObject({ clientId: na.clientId, leadId: na.leadId });
    expect(await count("nuria@ejemplo.example")).toEqual({ clients: 1, leads: 1 });
    // Quien ya llegó por la web (cliente existente): se reutiliza
    const web = await request({ experienceId: prod.a, name: "Willy Web", email: "willy@ejemplo.example" });
    const c = await ess.m("a", "products.editions.addEnrollment", { editionId: ed, name: "Willy Web", email: "willy@ejemplo.example", seats: 1, status: "solicitada" }, admA);
    expect(data(c).leadId).toBe(data(web).leadId);
    expect(await count("willy@ejemplo.example")).toEqual({ clients: 1, leads: 1 });
    // Aislamiento: nada de esto aparece en la otra empresa
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM leads WHERE email = 'nuria@ejemplo.example'"))[0].n).toBe(0);
  });

  it("aviso por correo al confirmar o cancelar: apagado por defecto, texto editable, correo operativo, sin romper nada si falla", async () => {
    const ed = await mkEdition({ capacity: 5, label: "Edición con aviso", startsLocal: "2037-05-04T10:00", endsLocal: null });
    const first = await enroll(ed, 2);
    await ess.sql("a", "UPDATE edition_enrollments SET name = 'Elena Avisada', email = 'elena@ejemplo.example' WHERE id = ?", [first]);
    const settings = data(await ess.q("a", "products.editions.notifySettings", undefined, admA));
    expect(settings.enabled).toBe(false);
    expect(settings.confirmBody).toContain("{nombre}");
    // Apagado: confirmar no envía nada
    const before = ess.mails.length;
    expect((await setStatus(first, "confirmada")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 800));
    expect(ess.mails.filter((m) => m.to.some((t) => t.email === "elena@ejemplo.example"))).toHaveLength(0);
    expect(ess.mails.length).toBe(before);
    // Activado con un texto propio
    const save = await ess.m("a", "products.editions.saveNotifySettings", { enabled: true, confirmSubject: "¡Plaza confirmada en {producto}!", confirmBody: "Hola {nombre}: tienes {plazas} en {edicion} ({fechas}).", cancelSubject: "", cancelBody: "<b>Hola</b> {nombre}, cancelada." }, admA);
    expect(save.status, JSON.stringify(save.json)).toBe(200);
    expect(data(save)).toMatchObject({ enabled: true, confirmSubject: "¡Plaza confirmada en {producto}!" });
    expect(data(save).cancelSubject).toContain("{producto}"); // vacío = el de partida
    expect(data(save).cancelBody).not.toMatch(/<b>/); // sin etiquetas
    const second = await enroll(ed, 1);
    await ess.sql("a", "UPDATE edition_enrollments SET name = 'Félix Aviso', email = 'felix@ejemplo.example' WHERE id = ?", [second]);
    expect((await setStatus(second, "confirmada")).status).toBe(200);
    const wait = async (to: string) => { for (let i = 0; i < 40; i++) { const m = ess.mails.find((x) => x.to.some((t) => t.email === to)); if (m) return m; await new Promise((r) => setTimeout(r, 250)); } return undefined; };
    const mail = await wait("felix@ejemplo.example");
    expect(mail?.subject).toBe("¡Plaza confirmada en Curso anual!");
    expect(mail?.htmlContent).toContain("Hola Félix Aviso: tienes 1 plaza en Edición con aviso (4 de mayo de 2037).");
    // Repetir la confirmación no reenvía; cancelar envía el de cancelación
    const count = ess.mails.length;
    expect(data(await setStatus(second, "confirmada"))).toMatchObject({ changed: false });
    await new Promise((r) => setTimeout(r, 500));
    expect(ess.mails.length).toBe(count);
    expect((await setStatus(second, "cancelada")).status).toBe(200);
    const cancel = await (async () => { for (let i = 0; i < 40; i++) { const m = ess.mails.filter((x) => x.to.some((t) => t.email === "felix@ejemplo.example")).find((x) => /cancel/i.test(x.subject)); if (m) return m; await new Promise((r) => setTimeout(r, 250)); } return undefined; })();
    expect(cancel?.subject).toContain("cancelado");
    expect(cancel?.htmlContent).toContain("Hola Félix Aviso, cancelada.");
    // Solo administración
    expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.m("a", "products.editions.saveNotifySettings", { enabled: false, confirmSubject: "", confirmBody: "", cancelSubject: "", cancelBody: "" }, agA)));
    // Cada empresa tiene los suyos
    expect(data(await ess.q("b", "products.editions.notifySettings", undefined, admB)).enabled).toBe(false);
  });

  it("SIN SESIÓN: submitLead con productRequest y getExperiences con editions funcionan, sin recuento interno ni datos de inscritos", async () => {
    const ed = await mkEdition({ capacity: 4, showAvailability: false, label: "Pública sin sesión" });
    const anon = await ess.m("a", "public.submitLead", { name: "Anónima Prueba", email: "anonima@ejemplo.example", productRequest: { experienceId: prod.a, editionId: ed, seats: 1, consent: true } });
    expect(anon.status, JSON.stringify(anon.json)).toBe(200); // sin cookie
    expect(data(anon)).toMatchObject({ ok: true, enrollmentStatus: "solicitada" });
    await setStatus((await ess.sql("a", "SELECT id FROM edition_enrollments WHERE email = 'anonima@ejemplo.example'"))[0].id, "confirmada");
    const raw = await ess.q("a", "public.getExperiences", { limit: 50, offset: 0, editions: { experienceId: prod.a } }); // sin cookie
    expect(raw.status).toBe(200);
    const body = JSON.stringify(data(raw));
    const mine = (data(raw) as any[]).find((e) => e.id === ed);
    expect(mine).toBeTruthy();
    expect(mine.seatsLeft).toBeNull(); // con «mostrar plazas» apagado no se dice cuántas quedan
    for (const k of ["capacity", "reserved", "status", "counts", "showAvailability", "priceOverride"]) expect(mine).not.toHaveProperty(k);
    for (const leak of ["anonima@ejemplo.example", "Anónima", "edition_enrollments", "enrollments", "leadId", "ip_hash"]) expect(body).not.toContain(leak);
    // Las rutas de administración siguen cerradas sin sesión
    for (const proc of ["products.editions.list", "products.editions.enrollments", "products.editions.upcoming"]) expect(errCode(await ess.q("a", proc, { experienceId: prod.a, editionId: ed }))).toBe("UNAUTHORIZED");
  });

  it("cancelar una convocatoria con inscripciones confirmadas: se conservan todas, el contador no cambia y no se puede confirmar más", async () => {
    const ed = await mkEdition({ capacity: 3, label: "A cancelar con confirmadas" });
    const [a, b, c] = [await enroll(ed, 1), await enroll(ed, 1), await enroll(ed, 1)];
    await setStatus(a, "confirmada");
    await setStatus(b, "confirmada");
    const r = await ess.m("a", "products.editions.cancel", { id: ed }, admA);
    expect(data(r)).toMatchObject({ toNotify: 3 });
    const rows = await ess.sql("a", "SELECT id, status FROM edition_enrollments WHERE edition_id = ? ORDER BY id", [ed]);
    expect(rows.map((x) => x.status)).toEqual(["confirmada", "confirmada", "solicitada"]);
    expect((await edRow(ed)).reserved).toBe(2); // las confirmadas siguen contando hasta que se cancelen una a una
    expect((await edRow(ed)).status).toBe("cancelled");
    expect(errCode(await setStatus(c, "confirmada"))).toBe("BAD_REQUEST");
    // Cancelar una inscripción confirmada sí libera su plaza aunque la convocatoria esté cancelada
    expect((await setStatus(a, "cancelada")).status).toBe(200);
    expect((await edRow(ed)).reserved).toBe(1);
  });

  it("regresión: la tienda de precio fijo sigue cobrando igual en un producto con convocatorias (las convocatorias no activan cobros)", async () => {
    const r = await ess.m("a", "reservations.cartCheckout", { customerName: "Lucía Prueba", customerEmail: "lucia@comprador-a.example", origin: `https://${ess.host("a")}`, items: [{ productId: prod.a, bookingDate: "", people: 1 }] });
    // Sin pasarela configurada en esta empresa: se rechaza como siempre, sin dejar nada (no es cosa de las convocatorias)
    expect(errCode(r)).toBe("PRECONDITION_FAILED");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n).toBe(0);
  });
});
