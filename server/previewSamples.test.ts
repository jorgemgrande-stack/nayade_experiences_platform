/**
 * Datos de ejemplo de las vistas previas de correo y PDF que ve cada empresa en su panel: genéricos, sin datos de
 * contacto, localizadores, productos ni dominios de la instalación original.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ORIGINAL = /skicenter|nayadeexperiences|N[aá]yade|NAY-20|639 57 66 27|Wakeboard|Kayak|Cable Ski|[Ll]ago\b|Acuático/;
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8").split(/\r?\n/);

describe("datos de ejemplo de las vistas previas", () => {
  it.each([
    ["routers/emailTemplatesRouter.ts", /buildHtml: \(\) =>/],
    ["routers.ts", /html: build[A-Za-z]+Html\(/],
    ["routers/pdfTemplatesRouter.ts", /(description|title|paymentLinkUrl): "/],
  ])("%s", (file, sampleLine) => {
    const offending = read(file).filter((l) => sampleLine.test(l) && ORIGINAL.test(l));
    expect(offending.map((l) => l.trim().slice(0, 120))).toEqual([]);
  });

  it("la confirmación de ejemplo no fija un email ni un teléfono de contacto (usa los de la empresa)", () => {
    const line = read("routers/emailTemplatesRouter.ts").find((l) => l.includes("buildConfirmationHtml({"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/contactEmail|contactPhone/);
  });
});
