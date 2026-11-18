/**
 * Circuito comercial de solicitudes y convocatorias de punta a punta (fase 7) con la aplicación real sobre MySQL
 * (opt-in, REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas NUEVAS; datos ficticios (dominios .example).
 *
 * Sin salidas reales: las solicitudes del circuito principal entran por el modo de pruebas del CRM
 * (`crm.leads.submitTestRequest`: sin avisos ni integraciones); las que comprueban el camino público
 * (`public.submitLead`) solo pueden avisar al proveedor de correo FALSO del banco de pruebas (fetch interceptado).
 * Ningún cobro real: el pago se registra con la confirmación manual de siempre (`crm.quotes.confirmPayment`).
 *
 *  A. Paquete de 4 sesiones (producto «precio visible, solo por solicitud» con modalidad): solicitud → lead con
 *     modalidad, precio, idioma y moneda → inscripción «solicitada» → «Preparar presupuesto» → cobro manual →
 *     confirmar SIN motivo → la persona cuenta en las 4 sesiones.
 *  B. Igual sin cobrar: confirmar exige motivo; quedan quién y por qué (inscripción y registro de actividad).
 *  C. Modalidad con «Sesión individual 90 min» incluida: al confirmar, 1 servicio pendiente; cancelar lo cancela;
 *     reconfirmar lo recupera sin duplicar.
 *  D. Doble clic / reintento: la solicitud pública repetida y «Preparar presupuesto» repetido no duplican.
 *  E. Idioma: el lead guarda el idioma de la web (alemán desde /de/..., español desde /...); la ficha pública en el
 *     idioma adicional superpone la traducción VALIDADA (producto y modalidad) y, sin ella, avisa (translated=false).
 *     La empresa nace con el español como principal: el alemán es el idioma adicional (el cambio de idioma principal
 *     tiene su propia prueba, idiomaPrincipal.mysql.test.ts).
 *  F. Aislamiento: la otra empresa no lee ni prepara presupuestos, sesiones ni servicios de esta; un agente no usa
 *     los procedimientos de administración.
 *  G. Panel operativo (`coreHome.operations`): las cifras esperadas en la empresa A y nada de la B (y al revés).
 *
 * Robustez: no depende de otros ficheros ni de su orden (BD propias); correos y slugs únicos por ejecución; fechas
 * relativas a hoy en Europe/Madrid (sesiones a 7, 14, 21 y 28 días, dentro de la ventana de 30 del panel).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";
import { addDaysToDate } from "../shared/editionSessions";
import { SESSION_TIME_TBC, leadHref, quoteHref } from "../shared/operationalPanel";
import { productEditionsHref } from "../shared/leadWebRequest";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

const TAG = Date.now().toString(36);
const mail = (who: string, co: "a" | "b" = "a") => `${who}.${TAG}@circuito-${co}.example`;
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

const editionForm = (startsLocal: string) => ({
  label: "Grupo invierno",
  startsLocal,
  endsLocal: null,
  timezone: "Europe/Madrid",
  scheduleNote: "",
  mode: "online",
  locationNote: "",
  capacity: 10,
  showAvailability: false,
  status: "open",
  priceOverride: null,
});

describe.skipIf(!URL_)("Circuito de solicitudes, presupuestos, sesiones y panel operativo (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let userA = "";
  let admB = "";
  const slug = { p: `paquete-reconnect-${TAG}`, q: `taller-abierto-${TAG}`, b: `curso-b-${TAG}` };
  const id = { p: 0, q: 0, v1: 0, v2: 0, ed: 0, prodB: 0 };
  const en = { a: 0, b: 0, c: 0, d: 0, w: 0 };
  const quote = { a: 0, b: 0, d: 0 };
  const days: string[] = [];

  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };
  /** Solicitud en modo de pruebas (sin avisos ni integraciones externas). */
  const testRequest = (input: Record<string, unknown>) => {
    resetProductRequestLimits();
    return ess.m("a", "crm.leads.submitTestRequest", { experienceId: id.p, ...input }, admA);
  };
  /** Solicitud por el camino público de la ficha (`productRequest`). */
  const publicRequest = (co: "a" | "b", p: { name: string; email: string; message?: string } & Record<string, unknown>) => {
    const { name, email, message, ...rest } = p;
    return ess.m(co, "public.submitLead", { name, email, message, productRequest: { consent: true, ...rest } });
  };
  const enrollmentOf = async (leadId: number) => (await ess.sql("a", "SELECT * FROM edition_enrollments WHERE lead_id = ? ORDER BY id", [leadId]))[0];
  const panel = async (co: "a" | "b" = "a") => ok(await ess.q(co, "coreHome.operations", undefined, co === "a" ? admA : admB), `panel ${co}`);
  const setStatus = (enrollmentId: number, status: string, reason?: string) => ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId, status, ...(reason ? { reason } : {}) }, admA);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "circuito");
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
    admB = await ess.login("b", "admin");
    // Empresa que ya ha contratado (como las demás pruebas de facturación): la factura del cobro manual sale normal
    await ess.markPaid("a");
    for (const [co, cookie] of [["a", admA], ["b", admB]] as const) {
      ok(await ess.m(co, "products.createCategory", { slug: "formacion", name: "Formación" }, cookie), "categoría");
      ok(await ess.m(co, "products.createLocation", { slug: "online", name: "Online" }, cookie), "lugar");
    }
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    const base = { productType: "own", categoryId: cat, locationId: loc, offerMode: "priced_request" };
    ok(await ess.m("a", "products.create", { ...base, slug: slug.p, title: "Paquete Reconnect", basePrice: "400.00" }, admA), "producto con paquete");
    ok(await ess.m("a", "products.create", { ...base, slug: slug.q, title: "Taller abierto", basePrice: "50.00" }, admA), "producto sin traducción");
    id.p = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = ?", [slug.p]))[0].id;
    id.q = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = ?", [slug.q]))[0].id;
    ok(await ess.m("a", "products.createVariant", { experienceId: id.p, name: "Paquete 4 sesiones", priceModifier: "400.00", priceType: "fixed" }, admA), "modalidad 1");
    ok(await ess.m("a", "products.createVariant", { experienceId: id.p, name: "Paquete con sesión individual", priceModifier: "520.00", priceType: "fixed" }, admA), "modalidad 2");
    const vs = await ess.sql("a", "SELECT id, name FROM experience_variants WHERE experienceId = ? ORDER BY id", [id.p]);
    id.v1 = vs.find((v) => v.name === "Paquete 4 sesiones").id;
    id.v2 = vs.find((v) => v.name === "Paquete con sesión individual").id;
    ok(await ess.m("a", "products.editions.includedServices.save", { variantId: id.v2, kind: "individual_session", label: "Sesión individual 90 min", quantity: 1, durationMinutes: 90 }, admA), "servicio incluido");
    // Convocatoria con 4 sesiones semanales, hora por confirmar
    const d0 = today();
    for (const k of [7, 14, 21, 28]) days.push(addDaysToDate(d0, k));
    id.ed = ok(await ess.m("a", "products.editions.create", { experienceId: id.p, form: editionForm(`${days[0]}T10:00`) }, admA), "convocatoria").id;
    const series = ok(await ess.m("a", "products.editions.sessions.weekly", { editionId: id.ed, firstDate: days[0], count: 4, startTime: null, durationMinutes: 90 }, admA), "sesiones") as any[];
    expect(series.map((s) => [s.startsOn, s.startTime])).toEqual(days.map((d) => [d, null]));
    // Empresa B: su propio producto (para comprobar que nada se cruza)
    const catB = (await ess.sql("b", "SELECT id FROM categories LIMIT 1"))[0].id;
    const locB = (await ess.sql("b", "SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("b", "products.create", { productType: "own", categoryId: catB, locationId: locB, offerMode: "priced_request", slug: slug.b, title: "Curso B", basePrice: "90.00" }, admB), "producto B");
    id.prodB = (await ess.sql("b", "SELECT id FROM experiences WHERE slug = ?", [slug.b]))[0].id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("A. paquete de 4 sesiones: solicitud → lead completo → presupuesto → cobro manual → confirmar sin motivo → cuenta en las 4 sesiones", async () => {
    const r = ok(await testRequest({ editionId: id.ed, variantId: id.v1, seats: 1, lang: "de", name: "Ana Paquete", email: mail("ana") }), "solicitud A");
    expect(r).toMatchObject({ ok: true, kind: "enrollment", enrollmentStatus: "solicitada", duplicate: false, testMode: true });
    const [lead] = await ess.sql("a", "SELECT source, status, request_lang, variant_id, variant_label, shown_price, is_test, edition_id, currency FROM leads WHERE id = ?", [r.leadId]);
    expect(lead).toMatchObject({ source: "web_solicitud_plaza", status: "nuevo", request_lang: "de", variant_id: id.v1, variant_label: "Paquete 4 sesiones", is_test: 1, edition_id: id.ed, currency: "EUR" });
    expect(Number(lead.shown_price)).toBe(400);
    const e = await enrollmentOf(r.leadId);
    expect(e).toMatchObject({ edition_id: id.ed, status: "solicitada", seats: 1, variant_id: id.v1, quote_id: null });
    en.a = e.id;

    const prep = ok(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.a }, admA), "preparar presupuesto A");
    expect(prep).toMatchObject({ created: true, status: "borrador", total: 400, leadId: r.leadId });
    quote.a = prep.quoteId;
    const [q] = await ess.sql("a", "SELECT status, total, items, paidAt FROM quotes WHERE id = ?", [quote.a]);
    expect([q.status, Number(q.total), q.paidAt]).toEqual(["borrador", 400, null]);
    const items = typeof q.items === "string" ? JSON.parse(q.items) : q.items;
    expect(items).toEqual([expect.objectContaining({ description: "Paquete Reconnect — Paquete 4 sesiones · Grupo invierno", quantity: 1, unitPrice: 400, total: 400 })]);

    // Cobro manual (el de siempre del CRM): el presupuesto queda «aceptado» con fecha de pago; pagar no confirma solo
    ok(await ess.m("a", "crm.quotes.confirmPayment", { quoteId: quote.a, paymentMethod: "efectivo", paymentNote: "Pago en mano (prueba)" }, admA), "cobro manual");
    const [paid] = await ess.sql("a", "SELECT status, paidAt FROM quotes WHERE id = ?", [quote.a]);
    expect(paid.status).toBe("aceptado");
    expect(paid.paidAt).not.toBeNull();
    expect((await enrollmentOf(r.leadId)).status).toBe("solicitada");
    const listed = (ok(await ess.q("a", "products.editions.enrollments", { editionId: id.ed }, admA), "inscripciones") as any[]).find((x) => x.id === en.a);
    expect(listed.payment).toMatchObject({ label: "Presupuesto pagado", paid: true });

    // Confirmar sin motivo: permitido porque el presupuesto está cobrado
    const conf = ok(await setStatus(en.a, "confirmada"), "confirmar A");
    expect(conf).toMatchObject({ changed: true, quoteStatus: "pagado" });
    const [row] = await ess.sql("a", "SELECT status, status_reason, status_changed_by FROM edition_enrollments WHERE id = ?", [en.a]);
    expect([row.status, row.status_reason]).toEqual(["confirmada", null]);
    expect(row.status_changed_by).toBeTruthy();
    expect((await ess.sql("a", "SELECT reserved FROM product_editions WHERE id = ?", [id.ed]))[0].reserved).toBe(1);

    // Participa en las 4 sesiones del paquete (una sola inscripción, sin inscripción por sesión)
    const sessions = (await panel()).upcomingSessions.items.filter((s: any) => s.editionId === id.ed);
    expect(sessions.map((s: any) => [s.startsOn, s.timeLabel, s.participants, s.index, s.total])).toEqual(days.map((d, i) => [d, SESSION_TIME_TBC, 1, i + 1, 4]));
  });

  it("B. sin cobrar: confirmar exige motivo; quedan quién y por qué", async () => {
    const r = ok(await testRequest({ editionId: id.ed, variantId: id.v1, seats: 1, lang: "es", name: "Bruno Sinpago", email: mail("bruno") }), "solicitud B");
    en.b = (await enrollmentOf(r.leadId)).id;
    quote.b = ok(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.b }, admA), "preparar presupuesto B").quoteId;
    const no = await setStatus(en.b, "confirmada");
    expect(errCode(no)).toBe("BAD_REQUEST");
    expect(String(no.json?.error?.json?.message)).toContain("no está pagado");
    expect(errCode(await setStatus(en.b, "confirmada", "  ok "))).toBe("BAD_REQUEST"); // motivo demasiado corto
    expect((await ess.sql("a", "SELECT status FROM edition_enrollments WHERE id = ?", [en.b]))[0].status).toBe("solicitada");

    const reason = "Paga en efectivo el primer día";
    expect(ok(await setStatus(en.b, "confirmada", reason), "confirmar B con motivo")).toMatchObject({ changed: true, quoteStatus: "borrador" });
    const [row] = await ess.sql("a", "SELECT status, status_reason, status_changed_by, status_changed_at FROM edition_enrollments WHERE id = ?", [en.b]);
    expect([row.status, row.status_reason]).toEqual(["confirmada", reason]);
    expect(row.status_changed_by).toBeTruthy();
    expect(Number(row.status_changed_at)).toBeGreaterThan(0);
    const [log] = await ess.sql("a", "SELECT actorId, details FROM crm_activity_log WHERE action = 'enrollment_status_changed' AND entityType = 'lead' AND entityId = ? ORDER BY id DESC LIMIT 1", [r.leadId]);
    expect(Number(log.actorId)).toBe(await ess.userId("a", "admin"));
    const details = typeof log.details === "string" ? JSON.parse(log.details) : log.details;
    expect(details).toMatchObject({ enrollmentId: en.b, from: "solicitada", to: "confirmada", reason, quoteId: quote.b, quoteStatus: "borrador", withoutPayment: true });
  });

  it("C. servicio incluido «Sesión individual 90 min»: al confirmar 1 pendiente; cancelar lo cancela; reconfirmar lo recupera sin duplicar", async () => {
    const r = ok(await testRequest({ editionId: id.ed, variantId: id.v2, seats: 1, lang: "de", name: "Carla Individual", email: mail("carla") }), "solicitud C");
    const e = await enrollmentOf(r.leadId);
    expect(e.variant_id).toBe(id.v2);
    en.c = e.id;
    // Sin presupuesto enlazado se confirma como siempre (sin motivo)
    expect(ok(await setStatus(en.c, "confirmada"), "confirmar C")).toMatchObject({ changed: true, services: { created: 1 } });
    const services = () => ess.q("a", "products.editions.services.list", { enrollmentId: en.c }, admA).then((x) => ok(x, "servicios") as any[]);
    const first = await services();
    expect(first.map((s) => [s.label, s.seq, s.durationMinutes, s.status])).toEqual([["Sesión individual 90 min", 1, 90, "pending"]]);

    ok(await setStatus(en.c, "cancelada"), "cancelar C");
    expect((await services()).map((s) => [s.id, s.status, s.cancelledByEnrollment])).toEqual([[first[0].id, "cancelled", true]]);

    expect(ok(await setStatus(en.c, "confirmada"), "reconfirmar C")).toMatchObject({ changed: true, services: { revived: 1, created: 0 } });
    expect((await services()).map((s) => [s.id, s.status])).toEqual([[first[0].id, "pending"]]);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM enrollment_services WHERE enrollment_id = ?", [en.c]))[0].n).toBe(1);
    // Confirmar otra vez lo ya confirmado no hace nada
    expect(ok(await setStatus(en.c, "confirmada"), "confirmar de nuevo")).toMatchObject({ changed: false });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM enrollment_services WHERE enrollment_id = ?", [en.c]))[0].n).toBe(1);
  });

  it("D. doble clic y reintento: ni la solicitud pública ni «Preparar presupuesto» se duplican", async () => {
    resetProductRequestLimits();
    const email = mail("diana");
    const body = { name: "Diana Dobleclic", email, experienceId: id.p, editionId: id.ed, variantId: id.v1, seats: 1, page: `/tienda/${slug.p}` };
    const [x, y] = await Promise.all([publicRequest("a", body), publicRequest("a", body)]);
    const rx = ok(x, "solicitud pública 1");
    const ry = ok(y, "solicitud pública 2");
    expect([rx.duplicate, ry.duplicate].sort()).toEqual([false, true]);
    expect(rx.leadId).toBe(ry.leadId);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email = ?", [email]))[0].n).toBe(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM edition_enrollments WHERE email = ?", [email]))[0].n).toBe(1);
    // Un reintento un momento después tampoco: se anota en la oportunidad
    resetProductRequestLimits();
    expect(ok(await publicRequest("a", body), "reintento")).toMatchObject({ duplicate: true, leadId: rx.leadId });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE email = ?", [email]))[0].n).toBe(1);

    en.d = (await enrollmentOf(rx.leadId)).id;
    const [p1, p2] = await Promise.all([
      ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.d }, admA),
      ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.d }, admA),
    ]);
    expect(ok(p1, "preparar 1").quoteId).toBe(ok(p2, "preparar 2").quoteId);
    quote.d = data(p1).quoteId;
    expect(ok(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.d }, admA), "reintento preparar")).toMatchObject({ created: false, quoteId: quote.d });
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes WHERE leadId = ?", [rx.leadId]))[0].n).toBe(1);
    expect((await ess.sql("a", "SELECT quote_id FROM edition_enrollments WHERE id = ?", [en.d]))[0].quote_id).toBe(quote.d);
  });

  it("E. idioma: el lead guarda el de la web; la ficha en el idioma adicional usa la traducción validada o avisa de que no la hay", async () => {
    // Idioma adicional (alemán) dado de alta y validado; traducción VALIDADA del producto y de una modalidad
    ok(await ess.m("a", "cms.i18nAddLocale", { locale: "de" }, admA), "alta del alemán");
    ok(await ess.m("a", "cms.i18nSetLocaleValidated", { locale: "de", validated: true }, admA), "validar alemán");
    ok(await ess.m("a", "cms.saveContentTranslation", { entityType: "product", entityKey: String(id.p), locale: "de", fields: { title: "Paket Reconnect", shortDescription: "Vier Sitzungen in der Gruppe" } }, admA), "traducción del producto");
    ok(await ess.m("a", "cms.validateContentTranslation", { entityType: "product", entityKey: String(id.p), locale: "de" }, admA), "validar producto");
    ok(await ess.m("a", "cms.saveContentTranslation", { entityType: "variant", entityKey: String(id.v1), locale: "de", fields: { name: "Paket mit 4 Sitzungen" } }, admA), "traducción de la modalidad");
    ok(await ess.m("a", "cms.validateContentTranslation", { entityType: "variant", entityKey: String(id.v1), locale: "de" }, admA), "validar modalidad");
    // Traducción en BORRADOR del otro producto: no se publica
    ok(await ess.m("a", "cms.saveContentTranslation", { entityType: "product", entityKey: String(id.q), locale: "de", fields: { title: "Offener Workshop (Entwurf)" } }, admA), "borrador sin validar");

    // /de/tienda/<slug>: traducida y validada
    const de = ok(await ess.q("a", "public.getExperienceBySlug", { slug: slug.p, locale: "de" }), "ficha en alemán");
    expect(de.title).toBe("Paket Reconnect");
    expect(de.i18n).toMatchObject({ locale: "de", contentLocale: "de", translated: true });
    const vDe = ok(await ess.q("a", "public.getVariantsByExperience", { experienceId: id.p, locale: "de" }), "modalidades en alemán") as any[];
    expect(vDe.map((v) => v.name).sort()).toEqual(["Paket mit 4 Sitzungen", "Paquete con sesión individual"]);
    // Precio: el del principal, nunca de la traducción
    expect(vDe.find((v) => v.id === id.v1).priceModifier).toBe((ok(await ess.q("a", "public.getVariantsByExperience", { experienceId: id.p }), "modalidades") as any[]).find((v) => v.id === id.v1).priceModifier);
    // Sin traducción validada: contenido del principal marcado como tal
    const fb = ok(await ess.q("a", "public.getExperienceBySlug", { slug: slug.q, locale: "de" }), "ficha sin traducción");
    expect(fb.title).toBe("Taller abierto");
    expect(fb.i18n).toMatchObject({ locale: "de", contentLocale: "es", translated: false });
    // /tienda/<slug> (principal): exactamente lo de siempre
    const es = ok(await ess.q("a", "public.getExperienceBySlug", { slug: slug.p }), "ficha principal");
    expect(es.title).toBe("Paquete Reconnect");
    expect(es.i18n).toBeUndefined();

    // Solicitudes de información desde cada idioma: el lead guarda el idioma; la modalidad, con su nombre del principal (CRM)
    resetProductRequestLimits();
    const fromDe = ok(await publicRequest("a", { name: "Erika Deutsch", email: mail("erika"), experienceId: id.p, variantId: id.v1, lang: "de", page: `/de/tienda/${slug.p}` }), "solicitud desde /de");
    resetProductRequestLimits();
    const fromEs = ok(await publicRequest("a", { name: "Elena Castellano", email: mail("elena"), experienceId: id.p, variantId: id.v1, lang: "es", page: `/tienda/${slug.p}` }), "solicitud desde /");
    const leads = await ess.sql("a", "SELECT id, source, request_lang, variant_label, message, is_test FROM leads WHERE id IN (?, ?) ORDER BY id", [fromDe.leadId, fromEs.leadId]);
    expect(leads.map((l) => [l.source, l.request_lang, l.variant_label, l.is_test])).toEqual([
      ["web_solicitud_producto", "de", "Paquete 4 sesiones", 0],
      ["web_solicitud_producto", "es", "Paquete 4 sesiones", 0],
    ]);
    expect(leads[0].message).toContain("Idioma de la web: de");
    expect(leads[0].message).toContain(`Origen: /de/tienda/${slug.p}`);
    expect(leads[1].message).toContain(`Origen: /tienda/${slug.p}`);
    // El CRM lo enseña en su bloque «Solicitud web», en español
    const detail = ok(await ess.q("a", "crm.leads.get", { id: fromDe.leadId }, admA), "lead en el CRM");
    expect(detail.webRequest).toMatchObject({ lang: { code: "de", name: "Alemán" }, variant: { label: "Paquete 4 sesiones" } });
    // Ningún correo a las personas que solicitan (solo, como mucho, el aviso al propietario por el proveedor falso)
    expect(ess.mails.some((m) => m.to.some((t) => [mail("erika"), mail("elena"), mail("diana")].includes(t.email)))).toBe(false);
  });

  it("F. aislamiento entre empresas y solo administración", async () => {
    // La empresa B no ve ni toca nada de la A (sus ids no existen en su BD)
    expect(errCode(await ess.m("b", "products.editions.prepareQuote", { enrollmentId: en.a }, admB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "products.editions.setEnrollmentStatus", { enrollmentId: en.b, status: "cancelada" }, admB))).toBe("NOT_FOUND");
    expect(ok(await ess.q("b", "products.editions.sessions.list", { editionId: id.ed }, admB), "sesiones desde B")).toEqual([]);
    expect(ok(await ess.q("b", "products.editions.services.list", { enrollmentId: en.c }, admB), "servicios desde B")).toEqual([]);
    expect(ok(await ess.q("b", "products.editions.enrollments", { editionId: id.ed }, admB), "inscripciones desde B")).toEqual([]);
    expect(errCode(await ess.q("b", "crm.quotes.get", { id: quote.b }, admB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM quotes"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM edition_enrollments"))[0].n).toBe(0);
    // Agente y usuario: fuera de los procedimientos de administración (también del panel operativo)
    for (const cookie of [agA, userA]) {
      expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.q("a", "coreHome.operations", undefined, cookie)));
      expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: en.d }, cookie)));
      expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.q("a", "products.editions.sessions.list", { editionId: id.ed }, cookie)));
      expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.q("a", "products.editions.services.list", { enrollmentId: en.c }, cookie)));
      expect(["FORBIDDEN", "UNAUTHORIZED"]).toContain(errCode(await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: en.d, status: "cancelada" }, cookie)));
    }
    expect(errCode(await ess.q("a", "coreHome.operations"))).toBe("UNAUTHORIZED");
    // Nada cambió por los intentos rechazados
    expect((await ess.sql("a", "SELECT status FROM edition_enrollments WHERE id = ?", [en.d]))[0].status).toBe("solicitada");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes WHERE id = ?", [quote.d]))[0].n).toBe(1);
  });

  it("G. panel operativo: las cifras esperadas en A y nada de B (y al revés)", async () => {
    // Una inscripción en lista de espera dada de alta a mano (no es una solicitud web) y una solicitud web en B
    en.w = ok(await ess.m("a", "products.editions.addEnrollment", { editionId: id.ed, name: "Wendy Espera", email: mail("wendy"), seats: 1, status: "lista_espera" }, admA), "lista de espera").id;
    resetProductRequestLimits();
    ok(await publicRequest("b", { name: "Bea Otraempresa", email: mail("bea", "b"), experienceId: id.prodB, lang: "es", page: `/tienda/${slug.b}` }), "solicitud en B");

    const p = await panel("a");
    expect(p.visible).toBe(true);
    expect(p.allClear).toBe(false);

    // Solicitudes web nuevas: las que siguen en «nuevo» (A y D pasaron a presupuesto; B también)
    const [oracle] = await ess.sql("a", "SELECT COUNT(*) AS n FROM leads WHERE source IN ('web_solicitud_producto', 'web_solicitud_plaza') AND status = 'nuevo'");
    expect(p.webRequests.total).toBe(Number(oracle.n));
    expect(p.webRequests.items.map((x: any) => x.name).sort()).toEqual(["Carla Individual", "Elena Castellano", "Erika Deutsch"]);
    const erika = p.webRequests.items.find((x: any) => x.name === "Erika Deutsch");
    expect(erika).toMatchObject({ sourceLabel: "Solicitud de información", product: "Paquete Reconnect", variant: "Paquete 4 sesiones", lang: "de", isTest: false, href: leadHref({ email: mail("erika") }) });
    expect(p.webRequests.items.find((x: any) => x.name === "Carla Individual")).toMatchObject({ sourceLabel: "Solicitud de plaza", edition: "Grupo invierno", variant: "Paquete con sesión individual", isTest: true });

    // Inscripciones por revisar: D (solicitada) y W (lista de espera) en la convocatoria
    expect(p.pendingEnrollments.total).toBe(2);
    expect(p.pendingEnrollments.items).toEqual([expect.objectContaining({ editionId: id.ed, requested: 1, waitlisted: 1, href: productEditionsHref(id.p) })]);

    // Presupuestos de inscripción sin cobrar: B (confirmada con motivo) y D; A está cobrado
    const numbers = new Map((await ess.sql("a", "SELECT id, quoteNumber FROM quotes WHERE id IN (?, ?)", [quote.b, quote.d])).map((r) => [Number(r.id), String(r.quoteNumber)]));
    expect(p.unpaidQuotes.total).toBe(2);
    expect(p.unpaidQuotes.items.map((x: any) => [x.enrollmentId, x.quoteNumber, x.paymentLabel, x.href]).sort((a: any, b: any) => a[0] - b[0])).toEqual(
      [[en.b, numbers.get(quote.b), "Presupuesto en borrador", quoteHref(numbers.get(quote.b)!)], [en.d, numbers.get(quote.d), "Presupuesto en borrador", quoteHref(numbers.get(quote.d)!)]].sort((a: any, b: any) => a[0] - b[0]),
    );
    expect(p.unpaidQuotes.items.some((x: any) => x.quoteId === quote.a)).toBe(false);

    // Convocatoria próxima: 3 confirmadas (A, B, C), 3 plazas de 10, 4 sesiones
    expect(p.upcomingEditions.total).toBe(1);
    expect(p.upcomingEditions.items[0]).toMatchObject({ editionId: id.ed, participants: 3, confirmedEnrollments: 3, capacity: 10, sessionCount: 4, href: productEditionsHref(id.p) });

    // Sesiones de los próximos 30 días: las 4, con hora por confirmar y 3 participantes en cada una
    expect(p.upcomingSessions.total).toBe(4);
    expect(p.upcomingSessions.items.map((s: any) => [s.startsOn, s.startTime, s.timeLabel, s.participants])).toEqual(days.map((d) => [d, null, SESSION_TIME_TBC, 3]));

    // Servicios por programar: el de C
    expect(p.pendingServices.total).toBe(1);
    expect(p.pendingServices.items[0]).toMatchObject({ enrollmentId: en.c, label: "Sesión individual 90 min", durationMinutes: 90, personName: "Carla Individual", href: productEditionsHref(id.p) });

    // Nada de la empresa B en el panel de A, y al revés
    const textA = JSON.stringify(p);
    expect(textA).not.toContain(mail("bea", "b"));
    expect(textA).not.toContain("Bea Otraempresa");
    expect(textA).not.toContain("Curso B");
    const pb = await panel("b");
    expect(pb.visible).toBe(true);
    expect(pb.webRequests.items.map((x: any) => x.name)).toEqual(["Bea Otraempresa"]);
    expect(pb.webRequests.total).toBe(1);
    for (const k of ["pendingEnrollments", "unpaidQuotes", "upcomingEditions", "upcomingSessions", "pendingServices"]) expect(pb[k], k).toEqual({ total: 0, items: [] });
    const textB = JSON.stringify(pb);
    for (const s of ["Paquete Reconnect", "Grupo invierno", "Carla Individual", mail("erika"), mail("diana")]) expect(textB).not.toContain(s);
  });
});
