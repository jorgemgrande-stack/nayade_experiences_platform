/**
 * Elephant Studio — validación de los envíos de los formularios a medida (sin base de datos). La entrada en el CRM,
 * el formulario publicado y el aislamiento entre empresas están en essential.studioForms.mysql.test.ts.
 */
import { describe, it, expect } from "vitest";
import { createBlock, newFormField, type BlockDataMap } from "../shared/pageBlocks";
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
