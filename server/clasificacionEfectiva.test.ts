/**
 * Clasificación de despliegues por cambios EFECTIVOS (docs/elephant-source/AUTONOMIA_DESPLIEGUES.md): un comentario, un
 * documento o una prueba que mencionan un interruptor no convierten un despliegue ordinario en extraordinario; una lectura
 * real del interruptor o un cambio en la configuración, sí.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { CRM_VERSION_FILE, CRM_VERSION_URL, codeOfLine, coreLockedChanges, effectiveChangedLines, externalLockedChanges, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

const diffOf = (file: string, ...lines: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", ...lines].join("\n");

describe("líneas sin comentarios", () => {
  it("quita comentarios de línea, de bloque y de JSDoc, y respeta las cadenas", () => {
    expect(codeOfLine('const a = 1; // usa CP_STRIPE_MODE')).toBe("const a = 1; ");
    expect(codeOfLine(" * Lee CP_STRIPE_MODE del entorno")).toBe("");
    expect(codeOfLine("/** Planes (SELF_SERVICE_PLANS) */ export const X = 1;")).toBe(" export const X = 1;");
    expect(codeOfLine('const u = "https://x.example//CP_STRIPE_MODE";')).toBe('const u = "https://x.example//CP_STRIPE_MODE";');
    expect(codeOfLine("const r = /a\\/\\//; const m = env.CP_STRIPE_MODE;")).toContain("env.CP_STRIPE_MODE");
    expect(codeOfLine("{$GATEWAY_USER} {$GATEWAY_PASSWORD_HASH} # acceso", "hash")).toBe("{$GATEWAY_USER} {$GATEWAY_PASSWORD_HASH} ");
    expect(codeOfLine("<!-- STRIPE_KEY --> <div>", "html")).toBe(" <div>");
  });
  it("descarta documentación, pruebas, e2e y ejemplos de variables", () => {
    const diff = [diffOf("docs/x.md", "+ CP_STRIPE_MODE"), diffOf("src/a.test.ts", "+ env.CHECKOUT_ENABLED"), diffOf("e2e/b.ts", "+ process.env.STRIPE_KEY"), diffOf("env.example", "+VITE_CHECKOUT_ENABLED=1"), diffOf("src/c.ts", "+ const ok = 1;")].join("\n");
    expect(effectiveChangedLines(diff)).toEqual([{ file: "src/c.ts", code: " const ok = 1;" }]);
  });
});

describe("CRM y web: solo cuenta tocar de verdad un interruptor", () => {
  it("el comentario que bloqueó el CRM el 27/10/2026 (86e1dfc) ya no es extraordinario", () => {
    const diff = diffOf(
      "src/orders.ts",
      "+/** Planes que se cobran con Checkout (server/stripe/catalog.ts, `SELF_SERVICE_PLANS`). */",
      '+export const CHECKOUT_PLANS = ["essential", "business"] as const;',
      '+export const STRIPE_LIVE_PROVIDER = "stripe";',
      "+  return v(\"checkout_disabled\", `Checkout está desactivado (CP_STRIPE_CHECKOUT_ENABLED y URL de vuelta)`);",
    );
    expect(externalLockedChanges(diff)).toEqual([]);
  });
  it("una lectura real de un interruptor o un cambio en la configuración sigue siendo extraordinario", () => {
    expect(externalLockedChanges(diffOf("src/checkout.ts", "+  if (import.meta.env.VITE_PUBLIC_CHECKOUT_ENABLED === '1') {"))).toHaveLength(1);
    expect(externalLockedChanges(diffOf("src/x.ts", "+  const on = env['CHECKOUT_ENABLED'];"))).toHaveLength(1);
    expect(externalLockedChanges(diffOf("server.js", "-  if (process.env.STRIPE_WEBHOOK_PUBLIC) open();"))).toHaveLength(1);
    expect(externalLockedChanges(diffOf("vite.config.ts", "+  define: { 'import.meta.env.VITE_CHECKOUT_ENABLED': '\"1\"' },"))).toHaveLength(1);
    expect(externalLockedChanges(diffOf(".env.production", "+VITE_SELF_SERVICE_ENABLED=1"))).toHaveLength(1);
    expect(externalLockedChanges(diffOf("deploy/railway/Dockerfile", "+ENV STRIPE_WEBHOOK_PUBLIC=1"))).toHaveLength(1);
  });
  it("la lectura de una variable que no es interruptor es ordinaria", () => {
    expect(externalLockedChanges(diffOf("src/api.ts", "+  const base = import.meta.env.VITE_CP_URL;"))).toEqual([]);
  });
});

describe("Core: interruptores en código efectivo", () => {
  it("un comentario o un documento no bloquean; el código y las cadenas sí", () => {
    expect(coreLockedChanges(diffOf("server/stripe/purchasesApi.ts", " * mismo interruptor `CP_COMMERCE_PURCHASES_ENABLED`:"))).toEqual([]);
    expect(coreLockedChanges(diffOf("server/x.ts", "+  // CP_STRIPE_MODE lo fija el entorno"))).toEqual([]);
    expect(coreLockedChanges(diffOf("server/x.ts", "+  if (process.env.CP_PUBLIC_CHECKOUT_ENABLED === '1') {"))).toHaveLength(1);
    expect(coreLockedChanges(diffOf("server/x.ts", '+  const k = "CP_STRIPE_MODE";'))).toHaveLength(1);
  });
  it("extraordinaryChanges usa el mismo criterio (sin romper los fragmentos sueltos)", () => {
    const none = () => null;
    expect(extraordinaryChanges(["server/x.ts"], diffOf("server/x.ts", "+  // ver MAIL_MODE en la guía"), none)).toEqual([]);
    expect(extraordinaryChanges(["server/x.ts"], "+  const m = process.env.LLM_MODEL;", none)).toHaveLength(1);
  });
});

describe("verificación del dominio real del CRM", () => {
  it("cada despliegue sella su commit y production lo comprueba en admin.bigelephant.es", () => {
    expect(CRM_VERSION_FILE).toBe("public/version.txt");
    expect(CRM_VERSION_URL.production.url).toBe("https://admin.bigelephant.es/version.txt");
    expect(CRM_VERSION_URL.live.auth).toBe(true);
    const src = fs.readFileSync("scripts/deploy/esRailway.ts", "utf8");
    expect(src).toContain("fs.writeFileSync(path.join(dir, CRM_VERSION_FILE)");
    // Si el dominio no sirve el commit, la publicación falla y vuelve atrás
    expect(src).toContain('(ext.service !== "crm" || (await servedCrmVersion(env, sha)))');
    expect(src).toContain("blocked.push(...externalLockedChanges(");
  });
});
