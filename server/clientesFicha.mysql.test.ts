/**
 * Essential — ficha de cliente del CRM con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * tipo y filtros del listado, recuentos, duplicados, validación al editar, notas, historial con factura,
 * presupuesto, venta en caja y correos, y exportación de lo filtrado. Dos empresas nuevas: ninguna ve lo de la otra.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Essential — ficha de cliente (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let agB: string;
  let empresaA: number;
  let anaA: number;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "ficha");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    empresaA = data(await ess.m("a", "crm.clients.create", { name: "Luis Compras", email: "compras@talleres-a.example", company: "Talleres Norte SL", nif: "B12345674" }, agA)).id;
    anaA = data(await ess.m("a", "crm.clients.create", { name: "Ana Gómez", email: "ana@cliente-a.example", phone: "600000001" }, agA)).id;
    await ess.m("b", "crm.clients.create", { name: "Cliente de B", email: "ana@cliente-a.example", company: "Otra Empresa SL" }, agB);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("listado: filtro por tipo, búsqueda con y sin tilde y por NIF; recuentos por empresa", async () => {
    const ids = async (input: Record<string, unknown>) => data(await ess.q("a", "crm.clients.list", input, agA)).items.map((c: { id: number }) => c.id);
    expect(await ids({ type: "empresa" })).toEqual([empresaA]);
    expect(await ids({ type: "particular" })).toEqual([anaA]);
    expect(await ids({ search: "gómez" })).toEqual([anaA]);
    expect(await ids({ search: "gomez" })).toEqual([anaA]);
    expect(await ids({ search: "B12345674" })).toEqual([empresaA]);
    expect(await ids({ search: "gomez", type: "empresa" })).toEqual([]);
    expect(data(await ess.q("a", "crm.clients.stats", undefined, agA))).toEqual({ total: 2, companies: 1, individuals: 1, newThisMonth: 2 });
    expect(data(await ess.q("b", "crm.clients.stats", undefined, agB))).toEqual({ total: 1, companies: 1, individuals: 0, newThisMonth: 1 });
  });

  it("duplicados por correo (sin distinguir mayúsculas) o por NIF (sin puntos ni guiones), solo de la propia empresa", async () => {
    const byEmail = data(await ess.q("a", "crm.clients.findDuplicates", { email: "ANA@cliente-a.example" }, agA));
    expect(byEmail).toEqual([expect.objectContaining({ id: anaA, by: ["email"] })]);
    const byNif = data(await ess.q("a", "crm.clients.findDuplicates", { nif: "b-12.345.674" }, agA));
    expect(byNif).toEqual([expect.objectContaining({ id: empresaA, by: ["nif"] })]);
    expect(data(await ess.q("a", "crm.clients.findDuplicates", { nif: "B12345674", excludeId: empresaA }, agA))).toEqual([]);
    // B tiene un cliente con el mismo correo que Ana de A: cada empresa solo ve el suyo
    const inB = data(await ess.q("b", "crm.clients.findDuplicates", { email: "ana@cliente-a.example" }, agB));
    expect(inB).toHaveLength(1);
    expect(inB[0].company).toBe("Otra Empresa SL");
  });

  it("edición: NIF no válido y correo repetido se rechazan con mensaje en español; pasar a particular quita la razón social", async () => {
    const bad = await ess.m("a", "crm.clients.update", { id: anaA, nif: "12345678A" }, agA);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    expect(bad.json?.error?.json?.message).toMatch(/NIF, NIE o CIF no es válido/);
    const dup = await ess.m("a", "crm.clients.update", { id: anaA, email: "compras@talleres-a.example" }, agA);
    expect(errCode(dup)).toBe("CONFLICT");
    expect(dup.json?.error?.json?.message).toMatch(/Ya existe otro cliente con ese correo/);
    const badEmail = await ess.m("a", "crm.clients.update", { id: anaA, email: "ana-mal" }, agA);
    expect(errCode(badEmail)).toBe("BAD_REQUEST");
    expect(JSON.stringify(badEmail.json)).toMatch(/correo electrónico no es válido/);
    expect((await ess.m("a", "crm.clients.update", { id: anaA, nif: "12345678Z", city: "Sevilla", postalCode: "41001" }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT nif, city, postalCode FROM clients WHERE id = ?", [anaA]))[0]).toEqual({ nif: "12345678Z", city: "Sevilla", postalCode: "41001" });
    // Otra empresa no puede editar el cliente de A
    expect(errCode(await ess.m("b", "crm.clients.update", { id: anaA, city: "X" }, agB))).toBe("NOT_FOUND");
  });

  it("notas: alta, listado y borrado; aislamiento entre empresas", async () => {
    expect(errCode(await ess.m("a", "crm.clients.addNote", { clientId: anaA, body: "   " }, agA))).toBe("BAD_REQUEST");
    const n = data(await ess.m("a", "crm.clients.addNote", { clientId: anaA, body: "Prefiere llamadas por la tarde" }, agA));
    const list = data(await ess.q("a", "crm.clients.notes", { clientId: anaA }, agA));
    expect(list.available).toBe(true);
    expect(list.items).toEqual([expect.objectContaining({ id: n.id, body: "Prefiere llamadas por la tarde", authorName: expect.any(String) })]);
    // B no ve, ni añade, ni borra notas de un cliente de A
    expect(errCode(await ess.q("b", "crm.clients.notes", { clientId: anaA }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crm.clients.addNote", { clientId: anaA, body: "intruso" }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crm.clients.deleteNote", { clientId: anaA, noteId: n.id }, agB))).toBe("NOT_FOUND");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", [anaA]))[0].n).toBe(1);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM client_notes"))[0].n).toBe(0);
    const n2 = data(await ess.m("a", "crm.clients.addNote", { clientId: anaA, body: "Nota para borrar" }, agA));
    expect((await ess.m("a", "crm.clients.deleteNote", { clientId: anaA, noteId: n2.id }, agA)).status).toBe(200);
    expect(data(await ess.q("a", "crm.clients.notes", { clientId: anaA }, agA)).items).toHaveLength(1);
  });

  it("historial: factura libre, presupuesto, venta en caja y correo del cliente; nada de la otra empresa", async () => {
    const inv = await ess.m("a", "crm.invoices.createDirect", { clientId: empresaA, lines: [{ description: "Mantenimiento", quantity: 1, unitPrice: 100, taxRate: 21 }] }, agA);
    expect(inv.status).toBe(200);
    const q = await ess.m("a", "crm.quotes.createDirect", {
      clientName: "Luis Compras", clientEmail: "compras@talleres-a.example", clientCompany: "Talleres Norte SL", title: "Revisión anual",
      items: [{ description: "Revisión", quantity: 1, unitPrice: 200, total: 200, taxRate: 21 }], subtotal: 200, taxRate: 21, total: 242, pricesIncludeTax: false, sendNow: false,
    }, agA);
    expect(q.status).toBe(200);
    // Venta en caja enlazada al cliente (pedido + ticket) y un correo enviado al cliente
    const now = Date.now();
    await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, customer_name, customer_email, merchant_order, created_at, updated_at, paid_at, client_id, paymentMethod) VALUES (0, 'Venta en caja', '2026-10-30', 1, 3000, 3000, 'paid', 'Luis Compras', 'otro-correo@talleres-a.example', 'TPVTEST0001', ?, ?, ?, ?, 'efectivo')", [now, now, now, empresaA]);
    const [resRow] = await ess.sql("a", "SELECT id FROM reservations WHERE merchant_order = 'TPVTEST0001'");
    await ess.sql("a", "INSERT INTO tpv_sales (ticketNumber, sessionId, reservationId, total, status_ts, createdAt, clientId) VALUES ('TK-TEST-1', 1, ?, '30.00', 'paid', ?, ?)", [resRow.id, now, empresaA]);
    await ess.sql("a", "INSERT INTO email_comm_log (recipientEmail, subject, status, channel) VALUES ('compras@talleres-a.example', 'Tu presupuesto', 'sent', 'email')");
    // En B: factura al mismo correo de Ana de A (no debe aparecer en A)
    expect((await ess.m("b", "crm.invoices.createDirect", { client: { name: "Ana", email: "compras@talleres-a.example" }, lines: [{ description: "Otro", quantity: 1, unitPrice: 10, taxRate: 21 }] }, agB)).status).toBe(200);

    const h = data(await ess.q("a", "crm.clients.getHistory", { id: empresaA }, agA));
    expect(h.invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual([data(inv).invoiceNumber]);
    expect(h.quotes.map((x: { title: string }) => x.title)).toEqual(["Revisión anual"]);
    expect(h.reservations.map((r: { id: number }) => r.id)).toEqual([resRow.id]);
    expect(h.tpvTickets).toEqual({ [resRow.id]: "TK-TEST-1" });
    expect(h.emails.map((m: { subject: string }) => m.subject)).toEqual(["Tu presupuesto"]);
    // B: su historial no tiene nada de A
    const [bClient] = await ess.sql("b", "SELECT id FROM clients LIMIT 1");
    const hb = data(await ess.q("b", "crm.clients.getHistory", { id: bClient.id }, agB));
    expect(hb.quotes).toEqual([]);
    expect(hb.reservations).toEqual([]);
    expect(hb.emails).toEqual([]);
    // Los id son por empresa: B tiene un solo cliente, el id de Ana (A) no existe en B
    expect(errCode(await ess.q("b", "crm.clients.getHistory", { id: anaA }, agB))).toBe("NOT_FOUND");
  });

  it("exportación CSV: sin filtros, todos; con filtros, solo lo filtrado", async () => {
    const all = data(await ess.q("a", "crm.clients.exportCsv", undefined, agA));
    expect(all.count).toBe(2);
    const companies = data(await ess.q("a", "crm.clients.exportCsv", { type: "empresa" }, agA));
    expect(companies.count).toBe(1);
    expect(companies.csv).toContain("Talleres Norte SL");
    expect(companies.csv).not.toContain("Ana Gómez");
    const search = data(await ess.q("a", "crm.clients.exportCsv", { search: "gomez" }, agA));
    expect(search.count).toBe(1);
    expect(search.csv).toContain("Ana Gómez");
  });

  it("al borrar un cliente se borran sus notas", async () => {
    const tmp = data(await ess.m("a", "crm.clients.create", { name: "Temporal", email: "temporal@cliente-a.example" }, agA)).id;
    await ess.m("a", "crm.clients.addNote", { clientId: tmp, body: "Se irá" }, agA);
    expect((await ess.m("a", "crm.clients.delete", { id: tmp }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", [tmp]))[0].n).toBe(0);
  });
});
