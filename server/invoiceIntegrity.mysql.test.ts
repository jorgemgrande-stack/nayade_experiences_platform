/**
 * Diagnóstico de integridad de facturas y cobros (orden `invoice-integrity`) contra MySQL real con datos SINTÉTICOS (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Se fabrican a mano las anomalías que dejaron los defectos históricos y se comprueba que el
 * diagnóstico las ve, que no usa nada que no sea SELECT y que no devuelve datos personales.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";
import { analyseNumbering, invoiceIntegrity, type Query } from "./controlPlane/invoiceIntegrity";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000 });
const TAG = Date.now().toString(36);
let seq = 0;

describe("analyseNumbering (puro)", () => {
  it("detecta huecos, duplicados y números fuera de patrón por serie", () => {
    const r = analyseNumbering(["FAC-2026-0001", "FAC-2026-0002", "FAC-2026-0004", "FAC-2026-0004", "FAC-2027-0001", "RARO"]);
    const s26 = r.find((x) => x.serie === "FAC-2026")!;
    expect(s26).toMatchObject({ emitidas: 4, minimo: 1, maximo: 4, huecos: [3], totalHuecos: 1, duplicados: [4] });
    expect(r.find((x) => x.serie === "FAC-2027")).toMatchObject({ huecos: [], duplicados: [] });
    expect(r[0].fueraDePatron).toBe(1);
  });
});

describe.skipIf(!URL_)("invoice-integrity contra MySQL real (datos sintéticos)", () => {
  let ess: EssentialApp;
  let adm = "";
  let exp = 0;
  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const sql: Query = (q, p) => ess.sql("a", q, p);
  const paidQuote = async () => {
    resetProductRequestLimits();
    const lead = Number(ok(await ess.m("a", "crm.leads.submitTestRequest", { experienceId: exp, name: "Persona Sintética", email: `p${++seq}.${TAG}@ejemplo.invalid` }, adm), "solicitud").leadId);
    const quoteId = Number(ok(await ess.m("a", "crm.leads.generateFromLead", { leadId: lead }, adm), "presupuesto").quoteId);
    ok(await ess.m("a", "crm.quotes.confirmPayment", { quoteId, paymentMethod: "efectivo", paymentNote: "sintético" }, adm), "cobro");
    return quoteId;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "diag");
    adm = await ess.login("a", "admin");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "servicios", name: "Servicios" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, slug: `fijo-${TAG}`, title: "Servicio precio fijo", offerMode: "priced_request", basePrice: "400.00" }, adm), "producto");
    exp = Number((await ess.sql("a", "SELECT id FROM experiences WHERE slug = ?", [`fijo-${TAG}`]))[0].id);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sobre datos sanos: sin anomalías y todas las comprobaciones se ejecutan (ninguna «sin tabla» salvo Stripe)", async () => {
    await paidQuote();
    await paidQuote();
    const r = await invoiceIntegrity(sql);
    for (const c of [r.reservasConFacturaInexistente, r.facturasConReservaInexistente, r.presupuestosConVariasFacturas, r.facturasConPresupuestoInexistente, r.presupuestosConNumeroSinFactura, r.facturasHuerfanasProbables, r.presupuestosCobradosSinFactura, r.presupuestosConVariasReservas]) {
      expect(c.nota).toBeUndefined();
      expect(c.total).toBe(0);
    }
    expect(r.numeracion.series.length).toBeGreaterThan(0);
    expect(r.numeracion.series[0]).toMatchObject({ totalHuecos: 0, duplicados: [] });
    expect(r.pagosSinFactura.marcadosPorElSistema.nota).toBeUndefined();
    expect(r.pagosSinFactura.pagosPendientesCobradosSinFactura.nota).toBeUndefined();
  });

  it("ve las anomalías históricas: reserva con factura borrada, huecos, factura huérfana, presupuesto con varias facturas", async () => {
    const a = await paidQuote(); // se le «borra» la factura como hacía quotes.delete
    const b = await paidQuote(); // se le duplica la factura como hacía el cobro simultáneo
    const c = await paidQuote(); // factura «generada» sin reserva con presupuesto sin cobrar (fallo a medias)
    const inv = (id: number) => ess.sql("a", "SELECT * FROM invoices WHERE quoteId = ?", [id]);
    const [ia] = await inv(a);
    await ess.sql("a", "DELETE FROM invoices WHERE id = ?", [ia.id]);
    const [ib] = await inv(b);
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, quoteId, reservationId, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, issuedAt, createdAt, updatedAt) SELECT 'FAC-2099-0009', quoteId, reservationId, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, issuedAt, createdAt, updatedAt FROM invoices WHERE id = ?", [ib.id]);
    const [ic] = await inv(c);
    await ess.sql("a", "UPDATE invoices SET status = 'generada', reservationId = NULL WHERE id = ?", [ic.id]);
    await ess.sql("a", "UPDATE quotes SET paidAt = NULL WHERE id = ?", [c]);

    const r = await invoiceIntegrity(sql);
    expect(r.reservasConFacturaInexistente.muestra.map((x) => Number(x.invoiceId))).toContain(Number(ia.id));
    expect(r.presupuestosConNumeroSinFactura.muestra.map((x) => x.invoiceNumber)).toContain(ia.invoiceNumber);
    expect(r.presupuestosConVariasFacturas.muestra.map((x) => Number(x.quoteId))).toContain(b);
    expect(r.facturasHuerfanasProbables.muestra.map((x) => Number(x.quoteId))).toContain(c);
    expect(r.numeracion.numerosRegistradosSinFactura.muestra.map((x) => x.numero)).toContain(ia.invoiceNumber);
  });

  it("no devuelve datos personales y todo el informe es serializable", async () => {
    const text = JSON.stringify(await invoiceIntegrity(sql));
    expect(text).not.toMatch(/ejemplo\.invalid|Persona Sint/i);
  });

  it("solo ejecuta SELECT (el ejecutor real rechaza cualquier otra sentencia)", async () => {
    const seen: string[] = [];
    await invoiceIntegrity(async (q, p) => {
      seen.push(q);
      return sql(q, p);
    });
    expect(seen.length).toBeGreaterThan(10);
    for (const q of seen) expect(q).toMatch(/^\s*SELECT\b/i);
  });
});
