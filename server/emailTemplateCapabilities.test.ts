/**
 * Plantillas de email por capacidad: cada empresa solo ve (y recibe como prueba) las plantillas de las funciones
 * que tiene; las de sistema y las personalizadas, siempre.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EMAIL_TEMPLATE_CAPABILITY, templatesForCapabilities } from "../shared/emailTemplateCapabilities";
import { CAPABILITIES } from "./catalog/capabilities";

const router = fs.readFileSync(path.join(__dirname, "routers/emailTemplatesRouter.ts"), "utf8");
const systemIds = [...router.matchAll(/^ {4}id: "([a-z0-9_]+)",$/gm)].map((m) => m[1]);

describe("plantillas de email según las capacidades de la empresa", () => {
  it("cada plantilla del sistema tiene capacidad (salvo invitación y contraseña) y todas existen en el catálogo", () => {
    expect(systemIds.length).toBeGreaterThan(20);
    for (const id of systemIds) {
      if (id === "invite" || id === "password_reset") expect(EMAIL_TEMPLATE_CAPABILITY[id], id).toBeUndefined();
      else expect(EMAIL_TEMPLATE_CAPABILITY[id], id).toBeDefined();
    }
    const known = new Set(CAPABILITIES.map((c) => c.id));
    for (const cap of new Set(Object.values(EMAIL_TEMPLATE_CAPABILITY))) expect(known.has(cap), cap).toBe(true);
  });

  it("filtra por capacidad; las de sistema y las personalizadas siempre se ven", () => {
    const rows = [{ id: "restaurant_confirm" }, { id: "tpv_ticket" }, { id: "quote" }, { id: "invite" }, { id: "mi_plantilla" }];
    const can = (c: string) => c === "crm-quotes";
    expect(templatesForCapabilities(rows, can).map((r) => r.id)).toEqual(["quote", "invite", "mi_plantilla"]);
    expect(templatesForCapabilities(rows, () => true)).toHaveLength(5);
  });

  it("el router filtra la lista y el envío de todas las pruebas", () => {
    expect(router).toMatch(/return templatesForCapabilities\(rows, await visibleCapability\(\)\);/);
    const sendAll = router.slice(router.indexOf("sendAllTests:"));
    expect(sendAll).toMatch(/templatesForCapabilities\(\s*await db\.select\(\)\.from\(emailTemplates\)/);
  });
});
