import { describe, it, expect } from "vitest";
import { quoteMailNotice } from "../shared/quoteMailNotice";

describe("aviso al enviar un presupuesto", () => {
  it("enviado: el mensaje de siempre", () => {
    expect(quoteMailNotice({ emailSent: true, trialMailBlocked: false }, "Presupuesto enviado al cliente")).toEqual({ kind: "success", message: "Presupuesto enviado al cliente" });
  });
  it("respuesta sin el dato: no cambia nada", () => {
    expect(quoteMailNotice({}, "Enviado").kind).toBe("success");
    expect(quoteMailNotice(null, "Enviado").kind).toBe("success");
  });
  it("prueba gratuita: avisa de que no ha salido y pide compartir el enlace", () => {
    const n = quoteMailNotice({ emailSent: false, trialMailBlocked: true }, "Presupuesto enviado al cliente");
    expect(n.kind).toBe("warning");
    expect(n.message).toMatch(/prueba gratuita/);
    expect(n.message).toMatch(/Copia el enlace/);
    expect(n.message).not.toMatch(/enviado al cliente/);
  });
  it("otro fallo del correo: aviso sin hablar de la prueba", () => {
    const n = quoteMailNotice({ emailSent: false, trialMailBlocked: false }, "Presupuesto enviado al cliente");
    expect(n.kind).toBe("warning");
    expect(n.message).not.toMatch(/prueba/);
  });
});
