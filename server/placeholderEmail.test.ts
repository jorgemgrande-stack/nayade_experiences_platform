/**
 * Contactos sin email (agente de voz, integraciones): email de relleno en un dominio reservado, nunca con el nombre
 * de la instalación original. Los contactos antiguos con el sufijo heredado se siguen reconociendo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isPlaceholderEmail, placeholderEmail } from "../shared/placeholderEmail";

describe("email de relleno de los contactos sin email", () => {
  it("usa el dominio reservado .invalid y se reconoce (también el sufijo heredado)", () => {
    expect(placeholderEmail("vapi", 42)).toBe("vapi-42@sin-email.invalid");
    expect(isPlaceholderEmail("vapi-42@sin-email.invalid")).toBe(true);
    expect(isPlaceholderEmail("ghl-abc@noreply.nayade")).toBe(true);
    expect(isPlaceholderEmail("cliente@empresa.es")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  it.each(["ghlWebhookRouter.ts", "vapiWebhookRouter.ts", "routers/vapiCalls.ts"])("%s no crea contactos con el dominio heredado", (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    expect(src).not.toContain("@noreply.nayade");
    expect(src).toContain("placeholderEmail(");
  });
});
