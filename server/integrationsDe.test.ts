/**
 * Cobertura alemana de «Integraciones y pagos» y de las plantillas de email (solo etiquetas visibles):
 * cada texto del catálogo y de `shared/integrationsPanel.ts` tiene traducción; el español no cambia.
 */
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./_core/credentials/catalog";
import { INTEGRATION_GROUPS, STATE_LABEL } from "../shared/integrationsPanel";
import { localizeIntegrationText } from "../shared/i18n/integrationsDe";
import { localizeTemplateText } from "../shared/i18n/emailTemplatesDe";
import { SYSTEM_TEMPLATES, GENERIC_TEMPLATE_TEXTS } from "./routers/emailTemplatesRouter";

describe("Integraciones y pagos en alemán", () => {
  it("traduce títulos, resúmenes, etiquetas, ayudas, avisos y opciones del catálogo", () => {
    const missing: string[] = [];
    const need = (s: string | undefined) => {
      if (s && localizeIntegrationText(s, "de") === s && !/^[A-Za-z0-9 ().+/-]+$/.test(s)) missing.push(s);
    };
    for (const p of PROVIDERS) {
      need(p.panel.title);
      need(p.panel.summary);
      for (const f of p.fields) {
        need(f.panel?.label ?? f.label);
        need(f.panel?.help);
        need(f.panel?.formatMessage);
        for (const v of Object.values(f.panel?.optionLabels ?? {})) need(v);
      }
    }
    for (const g of INTEGRATION_GROUPS) {
      need(g.title);
      need(g.description);
    }
    for (const v of Object.values(STATE_LABEL)) need(v);
    expect(missing).toEqual([]);
  });

  it("el español se queda igual y un texto desconocido cae al español", () => {
    expect(localizeIntegrationText("Cobrar con tarjeta", "es")).toBe("Cobrar con tarjeta");
    expect(localizeIntegrationText("Texto que no existe", "de")).toBe("Texto que no existe");
    expect(localizeIntegrationText("Falta: Número de comercio (FUC).", "de")).toBe("Es fehlt: Händlernummer (FUC).");
  });
});

describe("Plantillas de email en alemán (solo nombre y descripción visibles)", () => {
  it("traduce el nombre y la descripción de cada plantilla del sistema", () => {
    const missing: string[] = [];
    for (const t of [...SYSTEM_TEMPLATES, ...Object.values(GENERIC_TEMPLATE_TEXTS).filter((g) => g.name && g.description) as Array<{ name: string; description: string }>]) {
      for (const s of [t.name, t.description]) if (localizeTemplateText(s, "de") === s) missing.push(s);
    }
    expect(missing).toEqual([]);
  });

  it("no toca el español", () => {
    expect(localizeTemplateText("Email enviado al cliente cuando se aprueba una devolución económica.", "es")).toBe("Email enviado al cliente cuando se aprueba una devolución económica.");
  });
});
