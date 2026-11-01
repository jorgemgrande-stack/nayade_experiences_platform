/**
 * Essential — CRM (crm-contacts, crm-accounts, crm-activity, crm-tags, crm-leads, crm-quotes, crm-tasks)
 * con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL). Empresas nuevas desde la
 * baseline; operaciones con el rol comercial (agente), no con administrador.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Essential — CRM (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let agA: string;
  let agB: string;
  let userA: string;
  let roA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "crm");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    userA = await ess.login("a", "user");
    // Usuario de solo lectura (rol `readonly`, migración 0006) en la empresa A
    const pass = "clave-solo-lectura-ficticia"; // gitleaks:allow
    await ess.sql("a", "INSERT INTO users (openId, name, email, loginMethod, role, isActive, passwordHash, inviteAccepted) VALUES ('local_ro_a', 'Solo Lectura', 'lectura@empresa-a.example', 'local', 'readonly', 1, ?, 1)", [await bcrypt.hash(pass, 4)]);
    const r = await ess.call("a", "POST", "/api/auth/login", { body: { email: "lectura@empresa-a.example", password: pass } });
    if (!r.cookie) throw new Error(`login solo lectura: ${r.status}`);
    roA = r.cookie;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("crm-contacts / crm-accounts: alta de particular y de empresa con todos sus datos; aislamiento; permisos; licencia", async () => {
    const p = await ess.m("a", "crm.clients.create", { name: "Ana Particular", email: "ana@cliente-a.example", phone: "600000001", address: "Calle Uno 1", city: "Santander", postalCode: "39001", country: "ES", birthDate: "", notes: "Prefiere tardes" }, agA);
    expect(p.status).toBe(200);
    const e = await ess.m("a", "crm.clients.create", { name: "Compras Ejemplo", email: "compras@empresa-a.example", company: "Empresa Cliente SL", nif: "B99999999" }, agA);
    expect(e.status).toBe(200);
    const [row] = await ess.sql("a", "SELECT name, address, notes, source FROM clients WHERE id = ?", [data(p).id]);
    // Antes del arreglo la dirección y las notas se aceptaban pero no se guardaban
    expect(row).toMatchObject({ name: "Ana Particular", address: "Calle Uno 1", notes: "Prefiere tardes", source: "manual" });
    // Ciudad y código postal del formulario de alta (antes se descartaban)
    const [place] = await ess.sql("a", "SELECT city, postalCode, country, birthDate FROM clients WHERE id = ?", [data(p).id]);
    expect(place).toEqual({ city: "Santander", postalCode: "39001", country: "ES", birthDate: null });
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

  it("crm-tags: catálogo, asignación a clientes y oportunidades, filtro de listados; solo lectura; aislamiento; licencia", async () => {
    const t = await ess.m("a", "crmTags.create", { name: "  Cliente   VIP ", color: "azul" }, agA);
    expect(t.status).toBe(200);
    const tagId = data(t).id;
    expect((await ess.sql("a", "SELECT name, color FROM crm_tags WHERE id = ?", [tagId]))[0]).toEqual({ name: "Cliente VIP", color: "azul" });
    // Nombre único sin distinguir mayúsculas ni acentos; validación
    expect(errCode(await ess.m("a", "crmTags.create", { name: "cliente vip" }, agA))).toBe("CONFLICT");
    expect(errCode(await ess.m("a", "crmTags.create", { name: "   " }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crmTags.create", { name: "Color raro", color: "#ff0000" }, agA))).toBe("BAD_REQUEST");
    const other = data(await ess.m("a", "crmTags.create", { name: "Proveedor" }, agA)).id;

    const c1 = data(await ess.m("a", "crm.clients.create", { name: "Etiquetado Uno", email: "etiq1@cliente-a.example" }, agA)).id;
    const c2 = data(await ess.m("a", "crm.clients.create", { name: "Etiquetado Dos", email: "etiq2@cliente-a.example" }, agA)).id;
    const lead = data(await ess.m("a", "crm.leads.create", { name: "Lead Etiquetado", email: "etiq-lead@cliente-a.example" }, agA)).id;
    expect((await ess.m("a", "crmTags.assign", { tagId, entityType: "client", entityId: c1 }, agA)).status).toBe(200);
    // Idempotente
    expect((await ess.m("a", "crmTags.assign", { tagId, entityType: "client", entityId: c1 }, agA)).status).toBe(200);
    expect((await ess.m("a", "crmTags.assign", { tagId: other, entityType: "client", entityId: c2 }, agA)).status).toBe(200);
    expect((await ess.m("a", "crmTags.assign", { tagId, entityType: "lead", entityId: lead }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_tag_links WHERE tag_id = ?", [tagId]))[0].n).toBe(2);
    expect(errCode(await ess.m("a", "crmTags.assign", { tagId, entityType: "client", entityId: 999_999 }, agA))).toBe("NOT_FOUND");

    // Filtro de listados por etiqueta
    expect(data(await ess.q("a", "crm.clients.list", { tagId }, agA)).items.map((c: any) => c.id)).toEqual([c1]);
    expect(data(await ess.q("a", "crm.clients.list", { tagId: other }, agA)).items.map((c: any) => c.id)).toEqual([c2]);
    expect(data(await ess.q("a", "crm.leads.list", { tagId }, agA)).rows.map((l: any) => l.id)).toEqual([lead]);
    const by = data(await ess.q("a", "crmTags.forEntities", { entityType: "client", ids: [c1, c2] }, agA));
    expect(by[c1].map((x: any) => x.name)).toEqual(["Cliente VIP"]);
    expect(by[c2].map((x: any) => x.name)).toEqual(["Proveedor"]);
    expect(data(await ess.q("a", "crmTags.list", undefined, agA)).find((x: any) => x.id === tagId).usage).toBe(2);

    // Quitar y renombrar
    expect((await ess.m("a", "crmTags.unassign", { tagId: other, entityType: "client", entityId: c2 }, agA)).status).toBe(200);
    expect(data(await ess.q("a", "crm.clients.list", { tagId: other }, agA)).total).toBe(0);
    expect(errCode(await ess.m("a", "crmTags.update", { id: other, name: "CLIENTE VIP" }, agA))).toBe("CONFLICT");
    expect((await ess.m("a", "crmTags.update", { id: other, name: "Proveedor habitual", color: "verde" }, agA)).status).toBe(200);

    // Solo lectura: consulta sí, modifica no (403)
    expect((await ess.q("a", "crmTags.list", undefined, roA)).status).toBe(200);
    const roW = await ess.m("a", "crmTags.create", { name: "No permitida" }, roA);
    expect(roW.status).toBe(403);
    expect(errCode(await ess.m("a", "crmTags.assign", { tagId, entityType: "client", entityId: c2 }, roA))).toBe("FORBIDDEN");
    // Sin rol comercial ni sesión
    expect(errCode(await ess.q("a", "crmTags.list", undefined, userA))).toBe("FORBIDDEN");
    expect((await ess.q("a", "crmTags.list")).status).toBe(401);

    // Empresa B: ni ve ni puede tocar las etiquetas de A
    expect(data(await ess.q("b", "crmTags.list", undefined, agB))).toEqual([]);
    expect(errCode(await ess.m("b", "crmTags.delete", { id: tagId }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crmTags.assign", { tagId, entityType: "client", entityId: c1 }, agB))).toBe("NOT_FOUND");
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM crm_tags"))[0].n).toBe(0);
    // B puede tener una etiqueta con el mismo nombre
    expect((await ess.m("b", "crmTags.create", { name: "Cliente VIP" }, agB)).status).toBe(200);

    const lic = await licenseMatrix(ess, "crm-tags", {
      query: () => ess.q("a", "crmTags.list", undefined, agA),
      mutation: () => ess.m("a", "crmTags.create", { name: "Bloqueada" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-tags")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-tags")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "crm-tags")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_tags WHERE name = 'Bloqueada'"))[0].n).toBe(0);

    // Borrar la etiqueta borra sus asignaciones
    expect((await ess.m("a", "crmTags.delete", { id: tagId }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_tag_links WHERE tag_id = ?", [tagId]))[0].n).toBe(0);
    expect(data(await ess.q("a", "crm.clients.list", { tagId }, agA)).total).toBe(0);
  });

  let quoteId = 0;
  it("crm-quotes: presupuesto directo con numeración, propuesta comercial; aislamiento; licencia", async () => {
    const r = await ess.m(
      "a",
      "crm.quotes.createDirect",
      { clientName: "Cliente Presupuesto", clientEmail: "presu@cliente-a.example", title: "Servicio de prueba", items: [{ description: "Servicio", quantity: 2, unitPrice: 50, total: 100 }], subtotal: 100, total: 121, pricesIncludeTax: false },
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
    const rb = await ess.m("b", "crm.quotes.createDirect", { clientName: "Cliente B", clientEmail: "b@cliente-b.example", title: "B", items: [{ description: "S", quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, total: 12.1, pricesIncludeTax: false }, agB);
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

  it("crm-tasks: tareas internas con vencimiento, responsable y vínculo; Mis tareas, vencidas, avisos; solo lectura; aislamiento; licencia", async () => {
    const agId = await ess.userId("a", "agente");
    const adminId = await ess.userId("a", "admin");
    const userId = await ess.userId("a", "user");
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const yesterday = ymd(new Date(Date.now() - 86_400_000));
    const tomorrow = ymd(new Date(Date.now() + 86_400_000));

    // Responsables posibles: el equipo comercial activo (no el rol `user`)
    const who = data(await ess.q("a", "crmTasks.assignees", undefined, agA)).map((u: any) => u.id);
    expect(who).toEqual(expect.arrayContaining([agId, adminId]));
    expect(who).not.toContain(userId);

    const [client] = await ess.sql("a", "SELECT id, name FROM clients ORDER BY id LIMIT 1");
    const late = await ess.m("a", "crmTasks.create", { title: "Llamar para cerrar la propuesta", description: "Preguntar por la fecha", dueDate: yesterday, assignedTo: agId, priority: "alta", entityType: "client", entityId: client.id }, agA);
    expect(late.status).toBe(200);
    const lateId = data(late).id;
    const [row] = await ess.sql("a", "SELECT title, status, priority, assigned_to, entity_type, entity_id, DATE_FORMAT(due_date, '%Y-%m-%d') AS due FROM crm_tasks WHERE id = ?", [lateId]);
    expect(row).toEqual({ title: "Llamar para cerrar la propuesta", status: "pendiente", priority: "alta", assigned_to: agId, entity_type: "client", entity_id: client.id, due: yesterday });
    const future = data(await ess.m("a", "crmTasks.create", { title: "Enviar catálogo", dueDate: tomorrow, assignedTo: adminId, entityType: "quote", entityId: quoteId }, agA)).id;
    const loose = data(await ess.m("a", "crmTasks.create", { title: "Revisar tarifas" }, agA)).id;

    // Validación
    expect(errCode(await ess.m("a", "crmTasks.create", { title: "  " }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crmTasks.create", { title: "X", dueDate: "2026-02-30" }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crmTasks.create", { title: "X", entityType: "client" }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crmTasks.create", { title: "X", assignedTo: userId }, agA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "crmTasks.create", { title: "X", entityType: "lead", entityId: 999_999 }, agA))).toBe("NOT_FOUND");

    // Mis tareas (agente): solo la suya, con el nombre del cliente vinculado
    const mine = data(await ess.q("a", "crmTasks.list", { scope: "mine" }, agA));
    expect(mine.rows.map((t: any) => t.id)).toEqual([lateId]);
    expect(mine.rows[0]).toMatchObject({ entityLabel: client.name, assigneeName: "Usuario agente", dueDate: yesterday });
    // Todas: pendientes ordenadas por vencimiento (sin fecha al final)
    expect(data(await ess.q("a", "crmTasks.list", { scope: "all" }, agA)).rows.map((t: any) => t.id)).toEqual([lateId, future, loose]);
    expect(data(await ess.q("a", "crmTasks.list", { scope: "all", overdue: true }, agA)).rows.map((t: any) => t.id)).toEqual([lateId]);
    expect(data(await ess.q("a", "crmTasks.list", { scope: "all", entityType: "quote", entityId: quoteId }, agA)).rows.map((t: any) => t.id)).toEqual([future]);
    expect(data(await ess.q("a", "crmTasks.summary", undefined, agA))).toEqual({ minePending: 1, mineOverdue: 1, mineDueToday: 0, unassigned: 1 });

    // Aviso en la campana (sin correos)
    const mailsBefore = ess.mails.length;
    const feed = data(await ess.q("a", "notifications.feed", undefined, agA));
    const sec = feed.sections.find((s: any) => s.kind === "task");
    expect(sec).toMatchObject({ total: 1, severity: "warning" });
    expect(sec.items[0]).toMatchObject({ entityId: lateId, title: "Llamar para cerrar la propuesta" });

    // Edición y cierre
    expect((await ess.m("a", "crmTasks.update", { id: loose, assignedTo: agId, dueDate: tomorrow, priority: "baja" }, agA)).status).toBe(200);
    expect((await ess.m("a", "crmTasks.setStatus", { id: lateId, status: "hecha" }, agA)).status).toBe(200);
    const [done] = await ess.sql("a", "SELECT status, completed_by, completed_at IS NOT NULL AS closed FROM crm_tasks WHERE id = ?", [lateId]);
    expect(done).toEqual({ status: "hecha", completed_by: agId, closed: 1 });
    expect(data(await ess.q("a", "crmTasks.summary", undefined, agA))).toEqual({ minePending: 1, mineOverdue: 0, mineDueToday: 0, unassigned: 0 });
    expect(data(await ess.q("a", "notifications.feed", undefined, agA)).sections.find((s: any) => s.kind === "task").total).toBe(0);
    expect(data(await ess.q("a", "crmTasks.list", { scope: "mine", status: "hecha" }, agA)).rows.map((t: any) => t.id)).toEqual([lateId]);
    expect(ess.mails.length).toBe(mailsBefore);

    // Solo lectura: consulta sí, modifica no (403)
    expect((await ess.q("a", "crmTasks.list", { scope: "all" }, roA)).status).toBe(200);
    expect((await ess.m("a", "crmTasks.create", { title: "No permitida" }, roA)).status).toBe(403);
    expect(errCode(await ess.m("a", "crmTasks.setStatus", { id: future, status: "hecha" }, roA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "crmTasks.list", {}, userA))).toBe("FORBIDDEN");

    // Empresa B: no ve ni toca las tareas de A
    expect(data(await ess.q("b", "crmTasks.list", { scope: "all" }, agB)).total).toBe(0);
    expect(errCode(await ess.m("b", "crmTasks.setStatus", { id: future, status: "hecha" }, agB))).toBe("NOT_FOUND");
    expect(errCode(await ess.m("b", "crmTasks.delete", { id: future }, agB))).toBe("NOT_FOUND");
    expect((await ess.sql("a", "SELECT status FROM crm_tasks WHERE id = ?", [future]))[0].status).toBe("pendiente");

    const lic = await licenseMatrix(ess, "crm-tasks", {
      query: () => ess.q("a", "crmTasks.list", { scope: "all" }, agA),
      mutation: () => ess.m("a", "crmTasks.create", { title: "Bloqueada" }, agA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "crm-tasks")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "crm-tasks")).toBe(true);
    expect(isLicenseDenied(lic.noneMutation, "crm-tasks")).toBe(true);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_tasks WHERE title = 'Bloqueada'"))[0].n).toBe(0);
    // Sin la capacidad, la campana no muestra tareas
    await ess.sql("a", "UPDATE crm_tasks SET due_date = ? WHERE id = ?", [yesterday, future]);
    const adminCookie = await ess.login("a", "admin");
    expect(data(await ess.q("a", "notifications.feed", undefined, adminCookie)).sections.find((s: any) => s.kind === "task").total).toBe(1);
    try {
      await ess.setCapability("a", "crm-tasks", null);
      expect(data(await ess.q("a", "notifications.feed", undefined, adminCookie)).sections.find((s: any) => s.kind === "task").total).toBe(0);
    } finally {
      await ess.setCapability("a", "crm-tasks", "active");
    }

    expect((await ess.m("a", "crmTasks.delete", { id: future }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_tasks WHERE id = ?", [future]))[0].n).toBe(0);
  });
});
