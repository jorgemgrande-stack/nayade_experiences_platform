/**
 * Elephant Studio — formularios a medida con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL), dos
 * empresas nuevas. Un visitante anónimo envía el formulario de una página PUBLICADA: entra en el CRM de esa empresa
 * como oportunidad con su cliente y todas las respuestas. Un formulario en borrador no admite envíos; lo inválido se
 * rechaza con su motivo; lo automático no se guarda; hay límite de envíos; y otra empresa no recibe nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Elephant Studio — formularios a medida (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  const formBlock = {
    id: "formulario1",
    type: "form",
    data: {
      title: "Inscripción",
      intro: "",
      fields: [
        { kind: "text", label: "Nombre", required: "on", role: "name", options: "", placeholder: "", width: "half", value: "" },
        { kind: "email", label: "Correo", required: "on", role: "email", options: "", placeholder: "", width: "half", value: "" },
        { kind: "select", label: "Curso", required: "on", role: "none", options: "Iniciación\nAvanzado", placeholder: "", width: "full", value: "" },
        { kind: "hidden", label: "Campaña", required: "off", role: "none", options: "", placeholder: "", width: "full", value: "invierno" },
      ],
      submitLabel: "Inscribirme",
      successMessage: "¡Inscripción recibida!",
      redirectUrl: "/gracias",
      consent: "on",
    },
  };
  const send = (co: "a" | "b", slug: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ess.m(co, "public.submitLead", { name: "Contacto web", email: "x@x.es", studioForm: { slug, blockId: "formulario1", values, consent: true, elapsedMs: 9000, ...extra } });
  const leadsA = (email: string) => ess.sql("a", "SELECT name, email, source, message FROM leads WHERE email = ?", [email]);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "formularios");
    admA = await ess.login("a", "admin");
    data(await ess.q("a", "cms.sitePages", undefined, admA));
    for (const slug of ["inscripcion", "borrador-form"]) {
      expect((await ess.m("a", "cms.createSitePage", { title: slug, slug, template: "blank", addToMenu: false }, admA)).status).toBe(200);
      expect((await ess.m("a", "cms.savePageDraft", { slug, blocks: [formBlock] }, admA)).status).toBe(200);
    }
    expect((await ess.m("a", "cms.publishPage", { slug: "inscripcion" }, admA)).status).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("un envío anónimo válido entra en el CRM como oportunidad, con su cliente y todas las respuestas", async () => {
    const r = await send("a", "inscripcion", { f0: "Lucía Gómez", f1: "lucia@visitante.example", f2: "Avanzado", f3: "manipulado" });
    expect(r.status, JSON.stringify(r.json?.error?.json?.message ?? r.json)).toBe(200);
    expect(data(r).studio).toEqual({ ok: true, message: "¡Inscripción recibida!", redirectUrl: "/gracias" });
    const [lead] = await leadsA("lucia@visitante.example");
    expect(lead).toMatchObject({ name: "Lucía Gómez", source: "web_formulario" });
    expect(lead.message).toContain("Curso: Avanzado");
    expect(lead.message).toContain("Campaña: invierno");
    expect(lead.message).not.toContain("manipulado");
    expect(await ess.sql("a", "SELECT id FROM clients WHERE email = ?", ["lucia@visitante.example"])).toHaveLength(1);
  });

  it("lo inválido se rechaza con su motivo por campo y no crea nada", async () => {
    const r = await send("a", "inscripcion", { f0: "Pepe", f1: "pepe@visitante.example", f2: "Otro curso" });
    expect(data(r).studio.ok).toBe(false);
    expect(Object.keys(data(r).studio.errors)).toEqual(["f2"]);
    const noConsent = await send("a", "inscripcion", { f0: "Pepe", f1: "pepe@visitante.example", f2: "Iniciación" }, { consent: false });
    expect(Object.keys(data(noConsent).studio.errors)).toEqual(["consent"]);
    expect(await leadsA("pepe@visitante.example")).toHaveLength(0);
  });

  it("un envío automático (campo trampa) recibe la misma respuesta pero no se guarda", async () => {
    const r = await send("a", "inscripcion", { f0: "Bot", f1: "bot@spam.example", f2: "Iniciación" }, { website: "http://spam.example" });
    expect(data(r).studio.ok).toBe(true);
    expect(await leadsA("bot@spam.example")).toHaveLength(0);
  });

  it("un formulario que solo está en borrador, o que no existe, no admite envíos", async () => {
    expect(errCode(await send("a", "borrador-form", { f0: "Ana", f1: "ana@visitante.example", f2: "Iniciación" }))).toBe("NOT_FOUND");
    expect(errCode(await send("a", "no-existe", { f0: "Ana", f1: "ana@visitante.example", f2: "Iniciación" }))).toBe("NOT_FOUND");
    expect(await leadsA("ana@visitante.example")).toHaveLength(0);
  });

  it("aislamiento: el formulario de una empresa no recibe envíos por el dominio de otra", async () => {
    expect(errCode(await send("b", "inscripcion", { f0: "Eva", f1: "eva@visitante.example", f2: "Iniciación" }))).toBe("NOT_FOUND");
    expect(await ess.sql("b", "SELECT id FROM leads WHERE email = ?", ["eva@visitante.example"])).toHaveLength(0);
  });

  it("límite de envíos: tras varios seguidos desde el mismo visitante, se pide esperar", async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await send("a", "inscripcion", { f0: `Persona ${i}`, f1: `p${i}@visitante.example`, f2: "Iniciación" });
    expect(errCode(last!)).toBe("TOO_MANY_REQUESTS");
  });

  it("el formulario de contacto de siempre sigue funcionando igual (sin studioForm)", async () => {
    const r = await ess.m("a", "public.submitLead", { name: "Contacto Clásico", email: "clasico@visitante.example", message: "Hola", source: "web_contacto" });
    expect(r.status).toBe(200);
    expect(await leadsA("clasico@visitante.example")).toHaveLength(1);
  });
});
