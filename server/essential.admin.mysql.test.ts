/**
 * Essential — Administración, comunicaciones y automatización (admin-panel, admin-users, comms-email,
 * comms-whatsapp-links, auto-basic) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Empresas nuevas desde la baseline. El correo va a un proveedor FALSO
 * que solo registra: nada sale.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, licenseMatrix, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const LEFTOVERS = /skicenter|n[aá]yade|iron elephant|B26987875|639 ?57 ?66 ?27/i;

describe.skipIf(!URL_)("Essential — Administración y comunicaciones (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let userA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "adm");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("admin-panel: ajustes editables y flags presentes en una empresa nueva; cambios auditados; aislamiento; licencia", async () => {
    const settings = data(await ess.q("a", "config.listSystemSettings", undefined, admA)) as any[];
    // Antes del arreglo una empresa nueva no tenía filas: el panel no mostraba ni guardaba nada
    expect(settings.map((s) => s.key)).toEqual(expect.arrayContaining(["site_legal_name", "brand_nif", "email_from_address", "tax_rate_general"]));
    expect((await ess.m("a", "config.updateSystemSetting", { key: "site_legal_name", value: "Empresa A Ejemplo SL" }, admA)).status).toBe(200);
    expect(errCode(await ess.m("a", "config.updateSystemSetting", { key: "email_reservations", value: "no-es-correo" }, admA))).toBe("BAD_REQUEST");
    expect(errCode(await ess.m("a", "config.updateSystemSetting", { key: "no_existe", value: "x" }, admA))).toBe("NOT_FOUND");
    expect((await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'site_legal_name'"))[0].value).toBe("Empresa A Ejemplo SL");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM config_change_logs"))[0].n).toBe(1);
    // Ajustes del sitio (pantalla de configuración del sitio): ahora se guardan
    expect((await ess.m("a", "cms.updateSiteSettings", { settings: { legalCompanyCif: "B00000011", paymentVat: "21" } }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'brand_nif'"))[0].value).toBe("B00000011");

    const flags = data(await ess.q("a", "config.listFeatureFlags", undefined, admA)) as any[];
    expect(flags.map((f) => f.key)).toEqual(expect.arrayContaining(["cash_register_module_enabled", "email_automation_job_enabled"]));
    expect((await ess.m("a", "config.updateFeatureFlag", { key: "email_automation_job_enabled", enabled: true }, admA)).status).toBe(200);

    // B: sus propios ajustes, sin los de A
    expect((await ess.sql("b", "SELECT value FROM system_settings WHERE `key` = 'site_legal_name'"))[0].value).toBe("");
    expect(data(await ess.q("a", "accounting.getOverview", undefined, admA))).toBeTruthy();
    expect(errCode(await ess.m("a", "config.updateSystemSetting", { key: "site_legal_name", value: "x" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "onboarding.getStatus", undefined, agA))).toBe("FORBIDDEN");
    expect((await ess.q("a", "onboarding.getStatus", undefined, admA)).status).toBe(200);

    const lic = await licenseMatrix(ess, "admin-panel", {
      query: () => ess.q("a", "config.listSystemSettings", undefined, admA),
      mutation: () => ess.m("a", "config.updateSystemSetting", { key: "site_legal_city", value: "Bloqueada" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "admin-panel")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "admin-panel")).toBe(true);
  });

  it("comms-email: el From es siempre el de plataforma con el nombre de la empresa; su dirección propia solo recibe las respuestas; sin restos de otra", async () => {
    ess.mails.length = 0;
    // Essential incluye 3 plazas y admin, agente y controler ya las ocupan: el alta se rechaza hasta liberar una
    const full = await ess.m("a", "admin.createUser", { name: "Nueva Persona", email: "nueva@empresa-a.example", role: "agente" }, admA);
    expect(full.status).toBe(403);
    expect((await ess.m("a", "admin.toggleUserActive", { userId: await ess.userId("a", "controler") }, admA)).status).toBe(200);
    const r = await ess.m("a", "admin.createUser", { name: "Nueva Persona", email: "nueva@empresa-a.example", role: "agente" }, admA);
    expect(r.status).toBe(200);
    // Sin remitente propio: sale igualmente con el remitente de plataforma y el nombre de la empresa del registro
    expect(ess.mails).toHaveLength(1);
    expect(ess.mails[0].sender.email).toBe("no-reply@envios.example");
    expect(ess.mails[0].sender.name).toBeTruthy();
    ess.mails.length = 0;

    expect((await ess.m("a", "config.updateSystemSetting", { key: "email_from_address", value: "hola@empresa-a.example" }, admA)).status).toBe(200);
    expect((await ess.m("a", "config.updateSystemSetting", { key: "email_from_name", value: "Empresa A" }, admA)).status).toBe(200);
    const uid = (await ess.sql("a", "SELECT id FROM users WHERE email = 'nueva@empresa-a.example'"))[0].id;
    expect((await ess.m("a", "admin.resendInvite", { userId: uid, email: "nueva@empresa-a.example", name: "Nueva Persona" }, admA)).status).toBe(200);
    expect(ess.mails).toHaveLength(1);
    const mail = ess.mails[0];
    // Una empresa no envía con una identidad que no es la suya: su dirección va en Reply-To
    expect(mail.sender).toEqual({ name: "Empresa A", email: "no-reply@envios.example" });
    expect(mail.replyTo).toEqual({ email: "hola@empresa-a.example" });
    expect(mail.to).toEqual([{ email: "nueva@empresa-a.example" }]);
    expect(mail.htmlContent).toContain(`https://${ess.host("a")}/establecer-contrasena`);
    expect(`${mail.subject} ${mail.htmlContent}`).not.toMatch(LEFTOVERS);
    // Antes del arreglo el enlace usaba la URL de la instalación (APP_URL), no la de la empresa
    expect(mail.htmlContent).not.toContain("instalacion-unica.example");

    // Recuperación de contraseña: enlace a la URL de la empresa; en B ese correo no existe y no se envía nada
    ess.mails.length = 0;
    expect((await ess.call("a", "POST", "/api/auth/forgot-password", { body: { email: "nueva@empresa-a.example" } })).status).toBe(200);
    expect(ess.mails).toHaveLength(1);
    expect(ess.mails[0].htmlContent).toContain(`https://${ess.host("a")}/nueva-contrasena`);
    expect((await ess.call("b", "POST", "/api/auth/forgot-password", { body: { email: "nueva@empresa-a.example" } })).status).toBe(200);
    expect(ess.mails).toHaveLength(1);

    // Plantillas editables por empresa
    const list = data(await ess.q("a", "emailTemplates.list", undefined, admA)) as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(errCode(await ess.q("a", "emailTemplates.list", undefined, agA))).toBe("FORBIDDEN");

    const lic = await licenseMatrix(ess, "comms-email", { query: () => ess.q("a", "emailTemplates.list", undefined, admA) });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.noneQuery, "comms-email")).toBe(true);
  });

  it("admin-users: alta por invitación, activación con contraseña, cambio de rol y baja; sesión aislada por empresa; licencia", async () => {
    // Libera la plaza que ocupa el alta de la prueba anterior (límite de 3 usuarios de Essential)
    const nueva = (await ess.sql("a", "SELECT id FROM users WHERE email = 'nueva@empresa-a.example'"))[0].id;
    expect((await ess.m("a", "admin.toggleUserActive", { userId: nueva }, admA)).status).toBe(200);
    const r = await ess.m("a", "admin.createUser", { name: "Comercial Dos", email: "comercial2@empresa-a.example", role: "agente" }, admA);
    expect(r.status).toBe(200);
    const token = data(r).token as string;
    expect(token).toBeTruthy();
    expect((await ess.m("a", "public.setPassword", { token, password: "clave-segura-de-prueba-1" })).status).toBe(200);
    const login = await ess.call("a", "POST", "/api/auth/login", { body: { email: "comercial2@empresa-a.example", password: "clave-segura-de-prueba-1" } });
    expect(login.status).toBe(200);
    // El mismo usuario no existe en B y su sesión no vale allí
    expect((await ess.call("b", "POST", "/api/auth/login", { body: { email: "comercial2@empresa-a.example", password: "clave-segura-de-prueba-1" } })).status).toBe(401);
    expect((await ess.q("b", "crm.leads.list", {}, login.cookie)).status).toBe(401);

    const uid = (await ess.sql("a", "SELECT id FROM users WHERE email = 'comercial2@empresa-a.example'"))[0].id;
    expect((await ess.m("a", "admin.changeUserRole", { userId: uid, role: "controler" }, admA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT role FROM users WHERE id = ?", [uid]))[0].role).toBe("controler");
    expect((await ess.m("a", "admin.toggleUserActive", { userId: uid }, admA)).status).toBe(200);
    expect((await ess.call("a", "POST", "/api/auth/login", { body: { email: "comercial2@empresa-a.example", password: "clave-segura-de-prueba-1" } })).status).not.toBe(200);
    const usersB = data(await ess.q("b", "admin.getUsers", undefined, admB)) as any[];
    expect(usersB.map((u) => u.email)).not.toContain("comercial2@empresa-a.example");
    expect(errCode(await ess.m("a", "admin.createUser", { name: "No", email: "no@empresa-a.example", role: "admin" }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.q("a", "admin.getUsers", undefined, userA))).toBe("FORBIDDEN");

    const lic = await licenseMatrix(ess, "admin-users", {
      query: () => ess.q("a", "admin.getUsers", undefined, admA),
      mutation: () => ess.m("a", "admin.createUser", { name: "Bloqueado", email: "bloq@empresa-a.example", role: "user" }, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "admin-users")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "admin-users")).toBe(true);
  });

  it("admin-users: los roles RBAC granulares no existen en una empresa nueva (tablas rbac_* fuera de la baseline)", async () => {
    expect(await ess.sql("a", "SHOW TABLES LIKE 'rbac_roles'")).toEqual([]);
    const uid = await ess.userId("a", "agente");
    const r = await ess.m("a", "admin.assignRbacRole", { userId: uid, roleKey: "agente" }, admA);
    expect(r.status).not.toBe(200);
  });

  it("auto-basic: regla de automatización propia, ejecución bajo demanda y avisos internos; permisos corregidos; aislamiento; licencia", async () => {
    // Configurar reglas y lanzar envíos es de administración; el equipo comercial las consulta
    expect(errCode(await ess.m("a", "emailCommunications.createRule", { templateKey: "quote", name: "x", delayHours: 1 }, agA))).toBe("FORBIDDEN");
    const r = await ess.m("a", "emailCommunications.createRule", { templateKey: "quote", name: "Recordatorio de presupuesto", delayHours: 48 }, admA);
    expect(r.status).toBe(200);
    expect((await ess.sql("a", "SELECT name, delayHours FROM email_automation_rules"))[0]).toEqual({ name: "Recordatorio de presupuesto", delayHours: 48 });
    expect((await ess.sql("b", "SELECT COUNT(*) AS n FROM email_automation_rules"))[0].n).toBe(0);
    const run = await ess.m("a", "emailCommunications.runAutomationJobNow", undefined, admA);
    expect(run.status).toBe(200);
    // Antes cualquier sesión (incluido un usuario sin rol) podía crear reglas y lanzar envíos
    expect(errCode(await ess.m("a", "emailCommunications.createRule", { templateKey: "quote", name: "x", delayHours: 1 }, userA))).toBe("FORBIDDEN");
    expect((await ess.q("a", "notifications.feed", undefined, agA)).status).toBe(200);

    const lic = await licenseMatrix(ess, "auto-basic", {
      query: () => ess.q("a", "emailCommunications.listRules", {}, agA),
      mutation: () => ess.m("a", "emailCommunications.runAutomationJobNow", undefined, admA),
    });
    expect(lic.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(lic.readOnlyMutation, "auto-basic")).toBe(true);
    expect(isLicenseDenied(lic.noneQuery, "auto-basic")).toBe(true);
  });

  it("comms-whatsapp-links: registro manual de contactos y número de WhatsApp propio de cada empresa (sin él, no hay enlace)", async () => {
    const q = await ess.m("a", "crm.quotes.createDirect", { clientName: "Cliente WA", clientEmail: "wa@cliente-a.example", title: "WA", items: [{ description: "S", quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, total: 10 }, agA);
    const quoteId = data(q).quoteId;
    expect((await ess.m("a", "commercialFollowup.addNote", { quoteId, note: "Enviado por WhatsApp", channel: "whatsapp" }, agA)).status).toBe(200);
    expect((await ess.sql("a", "SELECT channel FROM quote_internal_notes WHERE quoteId = ?", [quoteId]))[0].channel).toBe("whatsapp");
    // Sin número configurado no hay WhatsApp (ni el de otra empresa)
    expect(data(await ess.q("a", "public.getTheme")).contact.whatsapp).toBeNull();
    expect(JSON.stringify(data(await ess.q("a", "public.getTheme")))).not.toMatch(LEFTOVERS);
    // Con su teléfono (ajuste editable del negocio), cada empresa expone su WhatsApp y solo el suyo
    expect((await ess.m("a", "config.updateSystemSetting", { key: "brand_phone", value: "+34 600 11 22 33" }, admA)).status).toBe(200);
    expect(data(await ess.q("a", "public.getTheme")).contact.whatsapp).toBe("34600112233");
    expect(data(await ess.q("b", "public.getTheme")).contact.whatsapp).toBeNull();
  });
});
