/**
 * Elephant Studio — validación de los envíos de los formularios a medida (sin base de datos). La entrada en el CRM,
 * el formulario publicado y el aislamiento entre empresas están en essential.studioForms.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { createBlock, formFieldVisibility, newFormField, type BlockDataMap } from "../shared/pageBlocks";
import { normalizeBlocks } from "./_core/pageBlocks";
import { allowFormSubmit, evaluateFormSubmission, fieldOptions, formRedirect, FORM_RATE, FormSubmitError } from "./_core/studioForms";

const form = (fields = createBlock("form").data.fields, extra: Partial<BlockDataMap["form"]> = {}): BlockDataMap["form"] => ({ ...createBlock("form").data, fields, ...extra });
const ok = { elapsedMs: 8000, consent: true };

describe("formularios a medida: validación del envío", () => {
  it("un envío correcto se convierte en oportunidad con todas las respuestas", () => {
    const r = evaluateFormSubmission(form(), { ...ok, values: { f0: "Ana Pérez", f1: "ANA@Ejemplo.es", f2: "+34 600 000 000", f3: "Quiero clases" } }, { slug: "contacto" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.lead).toMatchObject({ name: "Ana Pérez", email: "ana@ejemplo.es", phone: "+34 600 000 000" });
    expect(r.lead.message).toContain("Formulario: Pide información");
    expect(r.lead.message).toContain("Página: /contacto");
    expect(r.lead.message).toContain("Mensaje: Quiero clases");
  });

  it("obligatorios, correo, teléfono, número, fecha y hora se validan con un mensaje por campo", () => {
    const fields = [
      newFormField("email", "Correo", { required: "on", role: "email" }),
      newFormField("phone", "Teléfono"),
      newFormField("number", "Personas"),
      newFormField("date", "Día"),
      newFormField("time", "Hora"),
      newFormField("text", "Nombre", { required: "on", role: "name" }),
    ];
    const r = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "no-es-correo", f1: "abc", f2: "dos", f3: "2026-13-45", f4: "25:00" } }, { slug: "x" });
    expect(r.kind).toBe("invalid");
    if (r.kind !== "invalid") return;
    expect(Object.keys(r.errors).sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
    expect(r.errors.f5).toMatch(/obligatorio/);
  });

  it("desplegables, botones de opción y varias opciones solo admiten las opciones configuradas", () => {
    const fields = [
      newFormField("email", "Correo", { required: "on", role: "email" }),
      newFormField("select", "Curso", { options: "Iniciación\nAvanzado" }),
      newFormField("multi", "Material", { options: "Esquís\nBotas\nCasco" }),
    ];
    const bad = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "a@b.es", f1: "Otro", f2: ["Botas", "Tabla"] } }, { slug: "x" });
    expect(bad.kind === "invalid" && Object.keys(bad.errors)).toEqual(["f1", "f2"]);
    const good = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "a@b.es", f1: "Avanzado", f2: ["Botas", "Casco"] } }, { slug: "x" });
    expect(good.kind === "ok" && good.lead.message).toContain("Material: Botas, Casco");
    expect(fieldOptions({ options: " A \n\nB\nA" })).toEqual(["A", "B"]);
  });

  it("campo oculto: vale lo configurado, nunca lo que mande el navegador; lo que no es un campo se ignora", () => {
    const fields = [newFormField("email", "Correo", { required: "on", role: "email" }), newFormField("hidden", "Campaña", { value: "invierno-2026" })];
    const r = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "a@b.es", f1: "manipulado", f9: "<script>" } as never }, { slug: "x" });
    expect(r.kind === "ok" && r.lead.message).toContain("Campaña: invierno-2026");
    expect(r.kind === "ok" && r.lead.message).not.toMatch(/manipulado|script/);
  });

  it("la política de privacidad es obligatoria si el formulario la pide; una casilla obligatoria también", () => {
    const fields = [newFormField("email", "Correo", { required: "on", role: "email" }), newFormField("checkbox", "Acepto recibir novedades", { required: "on" })];
    const r = evaluateFormSubmission(form(fields), { values: { f0: "a@b.es" }, elapsedMs: 8000 }, { slug: "x" });
    expect(r.kind === "invalid" && Object.keys(r.errors).sort()).toEqual(["consent", "f1"]);
  });

  it("antispam: el campo trampa o un envío demasiado rápido se tratan como automáticos (no se guardan)", () => {
    const values = { f0: "Ana", f1: "a@b.es" };
    expect(evaluateFormSubmission(form(), { ...ok, values, website: "http://spam" }, { slug: "x" }).kind).toBe("spam");
    expect(evaluateFormSubmission(form(), { values, consent: true, elapsedMs: 300 }, { slug: "x" }).kind).toBe("spam");
  });

  it("sin campo de correo el formulario está mal configurado y se avisa (no se guarda nada)", () => {
    expect(() => evaluateFormSubmission(form([newFormField("text", "Nombre")]), { ...ok, values: { f0: "Ana" } }, { slug: "x" })).toThrow(FormSubmitError);
  });

  it("límite de envíos por visitante y página: 5 en 10 minutos", () => {
    const k = `prueba-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < FORM_RATE.max; i++) expect(allowFormSubmit(k, t0 + i)).toBe(true);
    expect(allowFormSubmit(k, t0 + 10)).toBe(false);
    expect(allowFormSubmit(k, t0 + FORM_RATE.windowMs + 20)).toBe(true);
  });

  it("después de enviar solo se puede llevar a una página de la propia web", () => {
    expect(formRedirect("/gracias")).toBe("/gracias");
    expect(formRedirect("https://otra-web.com")).toBe("");
    expect(formRedirect("javascript:alert(1)")).toBe("");
  });

  it("la configuración del formulario se sanea al guardar: tipos y datos de la lista cerrada, sin código", () => {
    const [b] = normalizeBlocks([{ id: "f", type: "form", data: { fields: [{ kind: "script", label: "<b>Hola</b>", role: "admin", required: "si" }], redirectUrl: "javascript:x" } }]) as any;
    expect(b.data.fields[0]).toMatchObject({ kind: "text", label: "<b>Hola</b>", role: "none", required: "off" });
    expect(b.data.redirectUrl).toBe("");
  });
});

describe("formularios a medida: campos con condición", () => {
  const fields = [
    newFormField("text", "Nombre", { required: "on", role: "name" }),
    newFormField("email", "Correo", { required: "on", role: "email" }),
    newFormField("radio", "¿Vienes con niños?", { options: "Sí\nNo", required: "on" }),
    newFormField("number", "Cuántos niños", { required: "on", showIf: "¿Vienes con niños?", showValue: "Sí" }),
    newFormField("text", "Edades", { showIf: "Cuántos niños", showValue: "2" }),
    newFormField("checkbox", "Quiero factura"),
    newFormField("text", "NIF", { required: "on", showIf: "Quiero factura", showValue: "Sí" }),
  ];

  it("se muestran solo los que cumplen su condición; la condición sobre un campo que no es de opciones o no existe se ignora", () => {
    expect(formFieldVisibility(fields, {})).toEqual([true, true, true, false, true, true, false]);
    expect(formFieldVisibility(fields, { f2: "Sí", f5: true })).toEqual([true, true, true, true, true, true, true]);
    expect(formFieldVisibility(fields, { f2: "No" })[3]).toBe(false);
    // Encadenado: si el campo del que depende está oculto, este también
    const chained = [newFormField("radio", "A", { options: "x\ny" }), newFormField("select", "B", { options: "1\n2", showIf: "A", showValue: "x" }), newFormField("text", "C", { showIf: "B", showValue: "1" })];
    expect(formFieldVisibility(chained, { f0: "y", f1: "1" })).toEqual([true, false, false]);
    expect(formFieldVisibility(chained, { f0: "x", f1: "1" })).toEqual([true, true, true]);
    // Varias opciones: basta con que esté marcada
    const multi = [newFormField("multi", "Intereses", { options: "Esquí\nSnow" }), newFormField("text", "Nivel de snow", { showIf: "Intereses", showValue: "Snow" })];
    expect(formFieldVisibility(multi, { f0: ["Esquí", "Snow"] })).toEqual([true, true]);
    expect(formFieldVisibility(multi, { f0: ["Esquí"] })).toEqual([true, false]);
  });

  it("el servidor no exige ni guarda un campo oculto por su condición, aunque el navegador lo mande", () => {
    const r = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "Ana", f1: "ana@ejemplo.es", f2: "No", f3: "7", f6: "X1234567" } }, { slug: "x" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.lead.message).not.toContain("Cuántos niños");
    expect(r.lead.message).not.toContain("X1234567");
  });

  it("un campo visible por su condición sí es obligatorio", () => {
    const r = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "Ana", f1: "ana@ejemplo.es", f2: "Sí", f5: true } }, { slug: "x" });
    expect(r.kind).toBe("invalid");
    if (r.kind !== "invalid") return;
    expect(Object.keys(r.errors).sort()).toEqual(["f3", "f6"]);
  });
});

describe("formulario en otro idioma: las opciones elegidas se entienden y se guardan en el idioma principal", () => {
  const de = form([
    newFormField("text", "Vorname", { required: "on", role: "name" }),
    newFormField("email", "E-Mail", { required: "on", role: "email" }),
    newFormField("select", "Welches Erlebnis interessiert dich?", { options: "Seelenreise\nNatur & Outdoor Retreat\nNeujahr Retreat" }),
    newFormField("select", "Wie viele Personen?", { options: "1 Person\n2 Personen\nKleine Gruppe (3–5)" }),
    newFormField("text", "Anmerkung", { showIf: "Wie viele Personen?", showValue: "2 Personen" }),
  ]);
  const es = form([
    newFormField("text", "Nombre", { required: "on", role: "name" }),
    newFormField("email", "Correo electrónico", { required: "on", role: "email" }),
    newFormField("select", "¿Qué experiencia te interesa?", { options: "Viaje del Alma\nRetiro Naturaleza & Outdoor\nRetiro de Año Nuevo" }),
    newFormField("select", "¿Cuántas personas?", { options: "1 persona\n2 personas\nGrupo pequeño (3–5)" }),
    newFormField("text", "Nota", {}),
  ]);
  const values = { f0: "Ana", f1: "ana@ejemplo.es", f2: "Retiro Naturaleza & Outdoor", f3: "2 personas", f4: "Con mi hermana" };
  const send = (v: Record<string, unknown>, localized: BlockDataMap["form"] | null) =>
    evaluateFormSubmission(de, { values: v as any, consent: true, website: "", elapsedMs: 60_000 } as any, { slug: "retreat-andalusien", localized });

  it("sin el formulario traducido, una opción del otro idioma sigue siendo un error", () => {
    const r = send(values, null);
    expect(r.kind).toBe("invalid");
  });
  it("con él, la opción elegida se guarda con el texto del principal y la condición «solo si» funciona", () => {
    const r = send(values, es);
    expect(r.kind).toBe("ok");
    const msg = (r as any).lead.message as string;
    expect(msg).toContain("Natur & Outdoor Retreat");
    expect(msg).toContain("2 Personen");
    expect(msg).not.toContain("Retiro Naturaleza");
    expect(msg).toContain("Anmerkung");
  });
  it("el consentimiento que se guarda es el texto que la persona vio, en su idioma", () => {
    const esConsent = { ...es, consent: "on" as const, consentText: "He leído la política de privacidad y la acepto." };
    const deConsent = { ...de, consent: "on" as const, consentText: "Ich habe die Datenschutzbestimmungen gelesen." };
    const r = evaluateFormSubmission(deConsent, { values: values as any, consent: true, website: "", elapsedMs: 60_000 } as any, { slug: "retreat-andalusien", localized: esConsent });
    expect(r.kind).toBe("ok");
    expect((r as any).consent.text).toContain("He leído");
    const p = evaluateFormSubmission(deConsent, { values: { ...values, f2: "Seelenreise", f3: "2 Personen" } as any, consent: true, website: "", elapsedMs: 60_000 } as any, { slug: "retreat-andalusien", localized: null });
    expect((p as any).consent.text).toContain("Ich habe");
  });
  it("una opción que no está en ninguna de las dos listas sigue rechazándose", () => {
    expect(send({ ...values, f2: "Otra cosa" }, es).kind).toBe("invalid");
  });
  it("las opciones del principal siguen valiendo en un envío desde el formulario traducido", () => {
    expect(send({ ...values, f2: "Seelenreise" }, es).kind).toBe("ok");
  });
});
