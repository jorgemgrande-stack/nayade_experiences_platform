/**
 * Essential — CRM (crm-contacts, crm-accounts, crm-activity, crm-tags, crm-leads, crm-quotes, crm-tasks)
 * con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Empresas nuevas desde la
 * baseline; operaciones con el rol comercial (agente), no con administrador.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Essential — CRM (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let agB: string;
  let userA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "crm");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("crm-contacts / crm-accounts: alta de particular y de empresa con todos sus datos; aislamiento; permisos; licencia", async () => {
    const p = await ess.m("a", "crm.clients.create", { name: "Ana Particular", email: "ana@cliente-a.example", phone: "600000001", address: "Calle Uno 1", notes: "Prefiere tardes" }, agA);
    expect(p.status).toBe(200);
    const e = await ess.m("a", "crm.clients.create", { name: "Compras Ejemplo", email: "compras@empresa-a.example", company: "Empresa Cliente SL", nif: "B99999999" }, agA);
    expect(e.status).toBe(200);
    const [row] = await ess.sql("a", "SELECT name, address, notes, source FROM clients WHERE id = ?", [data(p).id]);
    // Antes del arreglo la dirección y las notas se aceptaban pero no se guardaban
    expect(row).toMatchObject({ name: "Ana Particular", address: "Calle Uno 1", notes: "Prefiere tardes", source: "manual" });
    const [co] = await ess.sql("a", "SELECT company, nif FROM clients WHERE id = ?", [data(e).id]);
    expect(co).toEqual({ company: "Empresa Cliente SL", nif: "B99999999" });

    const dup = await ess.m("a", "crm.clients.create", { name: "Otra", email: "ana@cliente-a.example" }, agA);
    expect(errCode(dup)).toBe("CONFLICT");
    const upd = await ess.m("a", "crm.clients.update", { id: data(p).id, city: "Ciudad Ejemplo" }, agA);
    expect(upd.status).toBe(200);
    const list = data(await ess.q("a", "crm.clients.list", { search: "Ejemplo" }, agA));
    expect(list.items.map((c: any) => c.email)).toEqual(["compras@empresa-a.example"]);

    // Empresa B: no ve nada de A, ni por listado ni por id
    expect(data(await ess.q("b", "crm.clients.list", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.clients.get", { id: data(p).id }, agB))).toBe("NOT_FOUND");
    // Rol sin permiso comercial
    expect(errCode(await ess.q("a", "crm.clients.list", {}, userA))).toBe("FORBIDDEN");
    // Sin sesión
    expect((await ess.q("a", "crm.clients.list", {})).status).toBe(401);

    const lic = await licenseMatrix(ess, "crm-contacts", {
      query: () => ess.q("a", "crm.clients.list", {}, agA),
      mutation: () => ess.m("a", "crm.clients.create", { name: "Bloqueado", email: "bloqueado@cliente-a.example" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-contacts")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-contacts")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "crm-contacts")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients WHERE email = 'bloqueado@cliente-a.example'"))[0].n).toBe(0);
  });

  it("crm-leads: alta, cambio de estado, listado; aislamiento; permisos; licencia", async () => {
    const r = await ess.m("a", "crm.leads.create", { name: "Lead Prueba", email: "lead@cliente-a.example", message: "Quiero información" }, agA);
    expect(r.status).toBe(200);
    const id = data(r).id;
    const [row] = await ess.sql("a", "SELECT name, email, opportunityStatus FROM leads WHERE id = ?", [id]);
    expect(row).toMatchObject({ name: "Lead Prueba", email: "lead@cliente-a.example" });
    const lost = await ess.m("a", "crm.leads.markLost", { id, reason: "Sin presupuesto" }, agA);
    expect(lost.status).toBe(200);
    expect((await ess.sql("a", "SELECT opportunityStatus FROM leads WHERE id = ?", [id]))[0].opportunityStatus).toBe("perdida");
    const list = data(await ess.q("a", "crm.leads.list", {}, agA));
    expect(list.rows.map((l: any) => l.email)).toContain("lead@cliente-a.example");
    // El lead crea también la ficha de cliente
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM clients WHERE email = 'lead@cliente-a.example'"))[0].n).toBe(1);

    expect(data(await ess.q("b", "crm.leads.list", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.leads.get", { id }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("a", "crm.leads.create", { name: "No", email: "no@cliente-a.example" }, userA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "crm.leads.create", { name: "X", email: "no-es-correo" }, agA))).toBe("BAD_REQUEST");

    const lic = await licenseMatrix(ess, "crm-leads", {
      query: () => ess.q("a", "crm.leads.list", {}, agA),
      mutation: () => ess.m("a", "crm.leads.addNote", { id, text: "bloqueada" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-leads")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-leads")).toBe(true);
  });

  it("crm-activity: el historial registra alta y notas y se consulta por lead y por cliente; aislado", async () => {
    const r = await ess.m("a", "crm.leads.create", { name: "Lead Historial", email: "historial@cliente-a.example" }, agA);
    const id = data(r).id;
    expect((await ess.m("a", "crm.leads.addNote", { id, text: "Llamada hecha" }, agA)).status).toBe(200);
    const got = data(await ess.q("a", "crm.leads.get", { id }, agA));
    expect(got.activity.map((x: any) => x.action).sort()).toEqual(["lead_created", "lead_created_admin", "note_added"]);
    const [client] = await ess.sql("a", "SELECT id FROM clients WHERE email = 'historial@cliente-a.example'");
    const hist = await ess.q("a", "crm.clients.getHistory", { id: client.id }, agA);
    expect(hist.status).toBe(200);
    expect(JSON.stringify(data(hist))).toContain("Lead Historial");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM crm_activity_log"))[0].n).toBe(0);
  });

  it("crm-tags: no existe ningún procedimiento de etiquetas (NO IMPLEMENTADA)", async () => {
    const { appRouter } = await import("./routers");
    const procs = Object.keys((appRouter as any)._def.procedures);
    expect(procs.filter((p) => /tag/i.test(p) && /^(crm|admin)\./.test(p))).toEqual([]);
  });

  let quoteId = 0;
  it("crm-quotes: presupuesto directo con numeración, propuesta comercial; aislamiento; licencia", async () => {
    const r = await ess.m(
      "a",
      "crm.quotes.createDirect",
      { clientName: "Cliente Presupuesto", clientEmail: "presu@cliente-a.example", title: "Servicio de prueba", items: [{ description: "Servicio", quantity: 2, unitPrice: 50, total: 100 }], subtotal: 100, total: 121 },
      agA,
    );
    expect(r.status).toBe(200);
    quoteId = data(r).quoteId;
    expect(data(r).quoteNumber).toMatch(/^PRES-\d{4}-0001$/);
    const [q] = await ess.sql("a", "SELECT title, total, status FROM quotes WHERE id = ?", [quoteId]);
    expect(q).toMatchObject({ title: "Servicio de prueba", status: "borrador" });
    expect(Number(q.total)).toBe(121);
    expect(data(await ess.q("a", "crm.quotes.list", {}, agA)).total).toBe(1);

    const prop = await ess.m("a", "proposals.create", { leadId: data(r).leadId, title: "Propuesta de prueba" }, agA);
    expect(prop.status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM proposals"))[0].n).toBe(1);

    // La numeración de B es independiente y B no ve el presupuesto de A
    expect(data(await ess.q("b", "crm.quotes.list", {}, agB)).total).toBe(0);
    expect(errCode(await ess.q("b", "crm.quotes.get", { id: quoteId }, agB))).toBe("NOT_FOUND");
    const rb = await ess.m("b", "crm.quotes.createDirect", { clientName: "Cliente B", clientEmail: "b@cliente-b.example", title: "B", items: [{ description: "S", quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, total: 12.1 }, agB);
    expect(data(rb).quoteNumber).toMatch(/^PRES-\d{4}-0001$/);

    const lic = await licenseMatrix(ess, "crm-quotes", {
      query: () => ess.q("a", "crm.quotes.list", {}, agA),
      mutation: () => ess.m("a", "proposals.create", { leadId: data(r).leadId, title: "Bloqueada" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-quotes")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-quotes")).toBe(true);
  });

  it("crm-tasks: seguimiento comercial (estado y notas) sobre el presupuesto; permisos corregidos; aislamiento; licencia", async () => {
    expect((await ess.m("a", "commercialFollowup.updateCommercialStatus", { quoteId, status: "interested" }, agA)).status).toBe(200);
    expect((await ess.m("a", "commercialFollowup.addNote", { quoteId, note: "Volver a llamar el lunes", channel: "phone" }, agA)).status).toBe(200);
    const t = data(await ess.q("a", "commercialFollowup.getTracking", { quoteId }, agA));
    expect(t).toBeTruthy();
    const [row] = await ess.sql("a", "SELECT commercialStatus, lastContactChannel FROM quote_commercial_tracking WHERE quoteId = ?", [quoteId]);
    expect(row).toEqual({ commercialStatus: "interested", lastContactChannel: "phone" });
    // Antes cualquier sesión (incluido un usuario sin rol comercial) podía operar aquí
    expect(errCode(await ess.m("a", "commercialFollowup.addNote", { quoteId, note: "x" }, userA))).toBe("FORBIDDEN");
    // Un id inexistente (o de otra empresa) ya no crea seguimientos huérfanos
    expect(errCode(await ess.m("b", "commercialFollowup.updateCommercialStatus", { quoteId: 999_999, status: "lost" }, agB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM quote_commercial_tracking WHERE quoteId = 999999"))[0].n).toBe(0);
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM quote_internal_notes"))[0].n).toBe(0);

    const lic = await licenseMatrix(ess, "crm-tasks", {
      query: () => ess.q("a", "commercialFollowup.getTracking", { quoteId }, agA),
      mutation: () => ess.m("a", "commercialFollowup.addNote", { quoteId, note: "bloqueada" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-tasks")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-tasks")).toBe(true);
  });
});
