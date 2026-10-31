/**
 * Onboarding de Elephant Core (asistente «Primeros pasos» v2 e Inicio) con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas nuevas desde la baseline:
 *  - progreso persistente y reanudación (otra sesión ve lo mismo; «explorar primero» no vuelve a mostrar la bienvenida);
 *  - adaptación por tipo de actividad y por licencias (pasos ocultos sin capacidad, sectorial solo con módulo);
 *  - no se piden datos existentes (lo que consta en el registro o en los ajustes llega relleno y cuenta como hecho);
 *  - pasos «de hacer» completados por datos reales, no por clic;
 *  - separación de datos entre las dos empresas (progreso, ajustes y actividad reciente).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

type Plan = { steps: Array<{ id: string; status: string; recommended: boolean; byData: boolean }>; hidden: string[]; nextStep: string | null; percent: number };
const stepIds = (p: Plan) => p.steps.map((s) => s.id);
const stepOf = (p: Plan, id: string) => p.steps.find((s) => s.id === id);

describe.skipIf(!URL_)("Onboarding de Elephant Core (aplicación real, dos empresas nuevas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let userA: string;
  const status = async (co: "a" | "b", cookie: string) => {
    const r = await ess.q(co, "setupWizard.status", undefined, cookie);
    expect(r.status).toBe(200);
    return data(r);
  };
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "onb");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("empresa nueva: bienvenida pendiente, pasos de su plan y lo que ya consta relleno y hecho (no se vuelve a pedir)", async () => {
    const st = await status("a", admA);
    expect(st.progress.updatedAt).toBeNull();
    expect(st.nextStep).toBe("welcome");
    // Essential: sin módulo sectorial ni «sectorial» entre los tipos de actividad
    expect(stepIds(st.plan)).toEqual(["welcome", "company", "fiscal", "brand", "activity", "client", "product", "web", "operation", "comms", "finish"]);
    expect(st.plan.hidden).toContain("sector");
    expect(st.activities).toEqual(["comercio", "servicios", "web"]);
    // Entidad fiscal del registro: llega rellena y el paso fiscal cuenta como hecho
    expect(st.fiscalFromRegistry).toBe(true);
    expect(st.company).toMatchObject({ legalName: "Empresa A Ejemplo SL", taxId: "B00000011", country: "ES" });
    expect(stepOf(st.plan, "fiscal")).toMatchObject({ status: "done", byData: true });
    // El nombre comercial sembrado en el alta se muestra relleno
    expect(st.company.tradeName).toBeTruthy();
    expect(stepOf(st.plan, "company")?.status).toBe("pending");
  });

  it("«explorar primero» se guarda en el servidor: otra sesión no vuelve a ver la bienvenida y reanuda donde toca", async () => {
    expect((await ess.m("a", "setupWizard.setStep", { step: "welcome", status: "skipped" }, admA)).status).toBe(200);
    // Otra sesión del mismo administrador (otro navegador): mismo progreso
    const other = await ess.call("a", "POST", "/api/auth/login", { body: { email: `admin@${ess.ids.a}.example`, password: `clave-admin-a-${ess.ids.a.split("-").pop()}` } });
    const cookie = other.status === 200 && other.cookie ? other.cookie : admA;
    const st = await status("a", cookie);
    expect(st.progress.updatedAt).not.toBeNull();
    expect(stepOf(st.plan, "welcome")?.status).toBe("done");
    expect(st.nextStep).toBe("company");
    const [row] = await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'setup_wizard_progress'");
    expect(JSON.parse(row.value).steps.welcome.status).toBe("skipped");
  });

  it("identidad guardada en los ajustes de siempre; se reanuda en el siguiente paso pendiente (el fiscal ya consta)", async () => {
    const bad = await ess.m("a", "setupWizard.saveIdentity", { tradeName: "", country: "XX", currency: "EUR", timezone: "Europe/Madrid" }, admA);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    const ok = await ess.m("a", "setupWizard.saveIdentity", { tradeName: "Ferretería Sol", country: "ES", currency: "EUR", timezone: "Europe/Madrid" }, admA);
    expect(ok.status).toBe(200);
    expect(data(ok).nextStep).toBe("brand");
    const rows = await ess.sql("a", "SELECT `key`, value FROM system_settings WHERE `key` IN ('brand_name','site_legal_country','site_timezone','site_payment_currency')");
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({ brand_name: "Ferretería Sol", site_legal_country: "ES", site_timezone: "Europe/Madrid", site_payment_currency: "EUR" });
    const st = await status("a", admA);
    expect(st.company.tradeName).toBe("Ferretería Sol");
    expect(stepOf(st.plan, "company")).toMatchObject({ status: "done", byData: true });
    // Retroceder y corregir: se guarda igual y el paso sigue hecho
    expect((await ess.m("a", "setupWizard.saveIdentity", { tradeName: "Ferretería Sol Madrid", country: "ES", currency: "EUR", timezone: "Atlantic/Canary" }, admA)).status).toBe(200);
    expect((await status("a", admA)).company).toMatchObject({ tradeName: "Ferretería Sol Madrid", timezone: "Atlantic/Canary" });
  });

  it("el tipo de actividad reordena y prioriza los pasos; «sectorial» solo con un módulo sectorial contratado", async () => {
    expect((await ess.m("a", "setupWizard.saveActivity", { activity: "comercio" }, admA)).status).toBe(200);
    let st = await status("a", admA);
    expect(stepIds(st.plan).slice(5, 10)).toEqual(["product", "operation", "client", "web", "comms"]);
    expect(st.plan.steps.filter((s: Plan["steps"][number]) => s.recommended).map((s: Plan["steps"][number]) => s.id)).toEqual(["product", "operation"]);

    expect(errCode(await ess.m("a", "setupWizard.saveActivity", { activity: "sectorial" }, admA))).toBe("BAD_REQUEST");
    await ess.setCapability("a", "hotel-net", "active");
    try {
      st = await status("a", admA);
      expect(st.activities).toContain("sectorial");
      expect(st.sectorModules.map((m: { id: string }) => m.id)).toEqual(["hotel-net"]);
      expect(stepIds(st.plan)).toContain("sector");
      expect((await ess.m("a", "setupWizard.saveActivity", { activity: "sectorial" }, admA)).status).toBe(200);
      expect(stepIds(await status("a", admA).then((s) => s.plan))[5]).toBe("sector");
    } finally {
      await ess.setCapability("a", "hotel-net", null);
    }
    st = await status("a", admA);
    expect(stepIds(st.plan)).not.toContain("sector");
    expect((await ess.m("a", "setupWizard.saveActivity", { activity: "servicios" }, admA)).status).toBe(200);
    expect(stepIds((await status("a", admA)).plan).slice(5, 7)).toEqual(["client", "product"]);
  });

  it("pasos ocultos si la capacidad no está contratada (web sin CMS)", async () => {
    await ess.setCapability("a", "cms-editor", null);
    await ess.setCapability("a", "cms-pages-forms", null);
    try {
      const st = await status("a", admA);
      expect(stepIds(st.plan)).not.toContain("web");
      expect(st.plan.hidden).toContain("web");
    } finally {
      await ess.setCapability("a", "cms-editor", "active");
      await ess.setCapability("a", "cms-pages-forms", "active");
    }
    expect(stepIds((await status("a", admA)).plan)).toContain("web");
  });

  it("los pasos «de hacer» se completan con datos reales, no por clic", async () => {
    expect((await ess.m("a", "setupWizard.setStep", { step: "client", status: "done" }, admA)).status).toBe(200);
    expect(stepOf((await status("a", admA)).plan, "client")?.status).toBe("pending");
    expect((await ess.m("a", "crm.clients.create", { name: "Cliente Uno", email: "cliente@uno.example" }, admA)).status).toBe(200);
    const st = await status("a", admA);
    expect(stepOf(st.plan, "client")).toMatchObject({ status: "done", byData: true });
    expect(st.facts.clients).toBe(1);
    // Omitir no bloquea: queda omitido y el recorrido sigue
    expect((await ess.m("a", "setupWizard.setStep", { step: "product", status: "skipped" }, admA)).status).toBe(200);
    expect(stepOf((await status("a", admA)).plan, "product")?.status).toBe("skipped");
    // «Resumen y puesta en marcha» no se puede omitir
    expect(errCode(await ess.m("a", "setupWizard.setStep", { step: "finish", status: "skipped" }, admA))).toBe("BAD_REQUEST");
  });

  it("comunicaciones: en los ajustes que usan el correo y el WhatsApp de la web", async () => {
    expect(errCode(await ess.m("a", "setupWizard.saveComms", { replyTo: "no-es-correo" }, admA))).toBe("BAD_REQUEST");
    expect((await ess.m("a", "setupWizard.saveComms", { fromName: "Ferretería Sol", replyTo: "hola@ferreteria-sol.example", whatsapp: "+34 600 000 000" }, admA)).status).toBe(200);
    const rows = await ess.sql("a", "SELECT `key`, value FROM system_settings WHERE `key` IN ('email_from_name','email_reply_to','brand_whatsapp')");
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({ email_from_name: "Ferretería Sol", email_reply_to: "hola@ferreteria-sol.example", brand_whatsapp: "+34 600 000 000" });
    const st = await status("a", admA);
    expect(st.comms).toMatchObject({ replyTo: "hola@ferreteria-sol.example" });
    expect(stepOf(st.plan, "comms")?.status).toBe("done");
  });

  it("Inicio: actividad reciente real, filtrada por licencia y por rol", async () => {
    const r = data(await ess.q("a", "coreHome.recentActivity", undefined, agA));
    expect(r.items.map((i: { kind: string; detail: string }) => [i.kind, i.detail])).toContainEqual(["client", "Cliente Uno"]);
    await ess.setCapability("a", "crm-contacts", null);
    try {
      const hidden = data(await ess.q("a", "coreHome.recentActivity", undefined, agA));
      expect(hidden.items.some((i: { kind: string }) => i.kind === "client")).toBe(false);
    } finally {
      await ess.setCapability("a", "crm-contacts", "active");
    }
    expect(errCode(await ess.q("a", "coreHome.recentActivity", undefined, userA))).toBe("FORBIDDEN");
    // El asistente es solo para quien configura la empresa
    expect(errCode(await ess.q("a", "setupWizard.status", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "setupWizard.saveIdentity", { tradeName: "Intrusa", country: "ES", currency: "EUR", timezone: "Europe/Madrid" }, agA))).toBe("FORBIDDEN");
  });

  it("separación entre empresas: B empieza de cero y no ve nada de A; avanzar en B no cambia A", async () => {
    const before = await status("a", admA);
    const b = await status("b", admB);
    expect(b.nextStep).toBe("welcome");
    expect(b.progress.updatedAt).toBeNull();
    expect(b.company.tradeName).not.toBe("Ferretería Sol Madrid");
    expect(b.company.taxId).toBe("B00000022");
    expect(b.comms).toEqual({ fromName: "", replyTo: "", whatsapp: "" });
    expect(b.activity).toBeNull();
    expect(b.facts.clients).toBe(0);
    expect(data(await ess.q("b", "coreHome.recentActivity", undefined, admB)).items).toEqual([]);
    // La sesión de A no sirve en B
    expect((await ess.q("b", "setupWizard.status", undefined, admA)).status).toBeGreaterThanOrEqual(401);
    // B avanza: A no cambia
    expect((await ess.m("b", "setupWizard.setStep", { step: "welcome", status: "done" }, admB)).status).toBe(200);
    expect((await ess.m("b", "setupWizard.saveIdentity", { tradeName: "Librería Luna", country: "PT", currency: "EUR", timezone: "Europe/Lisbon" }, admB)).status).toBe(200);
    expect((await ess.m("b", "setupWizard.saveActivity", { activity: "web" }, admB)).status).toBe(200);
    const after = await status("a", admA);
    expect(after.progress).toEqual(before.progress);
    expect(after.company.tradeName).toBe("Ferretería Sol Madrid");
    expect(after.activity).toBe("servicios");
    expect((await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'brand_name'"))[0].value).toBe("Ferretería Sol Madrid");
    expect((await ess.sql("b", "SELECT value FROM system_settings WHERE `key` = 'brand_name'"))[0].value).toBe("Librería Luna");
    expect(stepIds((await status("b", admB)).plan)[5]).toBe("web");
  });

  it("puesta en marcha: queda registrada y el progreso persiste", async () => {
    expect((await ess.m("a", "setupWizard.setStep", { step: "finish", status: "done" }, admA)).status).toBe(200);
    const st = await status("a", admA);
    expect(st.progress.completedAt).not.toBeNull();
    expect(stepOf(st.plan, "finish")?.status).toBe("done");
    // Con pasos opcionales aún pendientes, el porcentaje lo refleja (no se inventa un 100 %)
    expect(st.plan.percent).toBeLessThan(100);
  });
});
