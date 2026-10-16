/**
 * Pulido del recorrido Essential (defectos detectados en la integración), lógica pura y cableado:
 *  - WhatsApp de la web pública por empresa (nunca el de Náyade en multi; en single, el de siempre).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTheme, whatsappNumber } from "./_core/theme";
import { LEGACY_WHATSAPP_PHONE, LEGACY_WHATSAPP_URL, whatsappTarget } from "../shared/whatsappButton";

const themeOf = (s: Record<string, string>, multi: boolean) => buildTheme((k) => s[k] || undefined, { multi });

describe("botón de WhatsApp de la web pública", () => {
  it("single (Náyade): el número y el texto de siempre, aunque haya teléfono de marca", () => {
    const t = whatsappTarget(themeOf({ brand_phone: "+34 911 000 000" }, false));
    expect(t).toEqual({ phone: LEGACY_WHATSAPP_PHONE, url: LEGACY_WHATSAPP_URL });
    expect(LEGACY_WHATSAPP_URL).toBe(
      `https://wa.me/34639576627?text=${encodeURIComponent("Hola Nayade Experiences, me gustaría recibir información")}`,
    );
  });

  it("multi: el número y el nombre de la empresa; nada de Náyade", () => {
    const t = whatsappTarget(themeOf({ brand_name: "Montaña Ejemplo", brand_phone: "+34 600 11 22 33" }, true));
    expect(t?.phone).toBe("34600112233");
    expect(decodeURIComponent(t!.url)).toBe("https://wa.me/34600112233?text=Hola Montaña Ejemplo, me gustaría recibir información");
    expect(t!.url).not.toMatch(/nayade|639576627/i);
  });

  it("multi: el ajuste propio de WhatsApp manda sobre el teléfono", () => {
    const t = whatsappTarget(themeOf({ brand_name: "Costa", brand_phone: "+34 911 000 000", brand_whatsapp: "0034 622 000 111" }, true));
    expect(t?.phone).toBe("34622000111");
  });

  it("multi sin número configurado (o no válido): no hay botón", () => {
    expect(whatsappTarget(themeOf({ brand_name: "Sin teléfono" }, true))).toBeNull();
    expect(whatsappTarget(themeOf({ brand_name: "Mal", brand_phone: "llámanos" }, true))).toBeNull();
    expect(whatsappTarget(themeOf({ brand_name: "Corto", brand_phone: "1234" }, true))).toBeNull();
  });

  it("sin tema (cargando o error): sin botón", () => {
    expect(whatsappTarget(null)).toBeNull();
    expect(whatsappTarget(undefined)).toBeNull();
  });

  it("normaliza solo dígitos con prefijo internacional", () => {
    expect(whatsappNumber("+34 (600) 11-22-33")).toBe("34600112233");
    expect(whatsappNumber("0034600112233")).toBe("34600112233");
    expect(whatsappNumber("<script>")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
  });
});

describe("CRM: aplicar un bono a un presupuesto", () => {
  it("el panel llama a un procedimiento que existe (crm.timeline.applyDiscountCode)", async () => {
    const { appRouter } = await import("./routers");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procedures["crm.timeline.applyDiscountCode"]).toBeDefined();
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/crm/CRMDashboard.tsx"), "utf8");
    expect(src).toContain("trpc.crm.timeline.applyDiscountCode.useMutation");
    // Toda llamada trpc.crm.<grupo>.<procedimiento> del panel CRM existe en el servidor
    const used = Array.from(new Set(Array.from(src.matchAll(/trpc\.crm\.([a-zA-Z]+)\.([a-zA-Z]+)\.use(?:Query|Mutation)/g), (m) => `crm.${m[1]}.${m[2]}`)));
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((p) => !procedures[p])).toEqual([]);
  });
});
