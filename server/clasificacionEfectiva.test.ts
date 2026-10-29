/**
 * Clasificación de despliegues por cambios EFECTIVOS (docs/elephant-source/AUTONOMIA_DESPLIEGUES.md): un comentario, un
 * documento o una prueba que mencionan un interruptor no convierten un despliegue ordinario en extraordinario; una lectura
 * real del interruptor o un cambio en la configuración, sí.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { CRM_VERSION_FILE, CRM_VERSION_URL, codeOfLine, coreLockedChanges, criticalChanges, effectiveChangedLines, externalLockedChanges, extraordinaryChanges } from "../scripts/deploy/esRailwayLib";

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
    expect(effectiveChangedLines(diff)).toEqual([{ file: "src/c.ts", code: " const ok = 1;", sign: "+" }]);
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
  it("un nombre parecido o un texto que cita el interruptor no lo leen", () => {
    expect(coreLockedChanges(diffOf("server/_core/llm.ts", "+    if (usage?.prompt_tokens) meter(Metrics.LLM_TOKENS_INPUT, usage.prompt_tokens, \"token\");"))).toEqual([]);
    expect(coreLockedChanges(diffOf("server/x.ts", '+  if (o.policy.mode === "off") return "MAIL_MODE=off";'))).toEqual([]);
    expect(coreLockedChanges(diffOf("server/x.ts", "-  const mode = env[\"MAIL_MODE\"] ?? 'off';"))).toHaveLength(1);
    expect(coreLockedChanges(diffOf("deploy/x.env", "+MAIL_MODE=live"))).toHaveLength(1);
  });
});

describe("política del correo real", () => {
  const none = () => null;
  const policy = "server/mail/policy.ts";
  it("cambiar solo la identidad de los avisos (marca, línea legal, logotipo) es ordinario", () => {
    const d = diffOf(policy, '-export const PLATFORM_BRAND = "Elephant Source";\n+export const PLATFORM_BRAND = "Big Elephant";\n+export const PLATFORM_LEGAL_LINE = "Big Elephant es un servicio de X";');
    expect(extraordinaryChanges([policy], d, none)).toEqual([]);
  });
  it("cualquier otro cambio de la política sigue siendo extraordinario", () => {
    expect(extraordinaryChanges([policy], diffOf(policy, '+export const PLATFORM_BRAND = "Big Elephant";\n+  if (allow.length === 0) return true;'), none)).toHaveLength(1);
    expect(extraordinaryChanges([policy], "", none)).toHaveLength(1);
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

describe("cobros, autorización, seguridad y borrados: protegidos aunque no toquen interruptores", () => {
  const none = () => null;
  const x = (files: string[], diff: string) => extraordinaryChanges(files, diff, none);
  it("la envolvente de cobros, autorización y seguridad es extraordinaria por fichero (fuera de las pruebas)", () => {
    for (const f of [
      "server/stripe/config.ts",
      "server/stripe/webhook.ts",
      "server/stripe/liveReadiness.ts",
      "server/stripe/eligibility.ts",
      "server/controlPlane/auth.ts",
      "server/controlPlane/operatorAuth.ts",
      "server/controlPlane/operatorRoles.ts",
      "server/authGuard.ts",
      "server/localAuth.ts",
      "server/passwordReset.ts",
      "server/_core/rbac.ts",
      "server/_core/oauth.ts",
      "server/_core/credentials/vault.ts",
      "server/_core/opsAccess/token.ts",
      "server/_core/tenantRegistry/crypto.ts",
      "server/_core/publicEndpointGuards.ts",
    ])
      expect(x([f], diffOf(f, "+  const a = 1;")), f).not.toEqual([]);
    expect(criticalChanges(["server/stripe/config.test.ts"], "")).toEqual([]);
    // Los flujos que se apoyan en la envolvente siguen siendo ordinarios
    for (const f of ["server/stripe/checkout.ts", "server/stripe/purchases.ts", "server/_core/credentials/catalog.ts", "server/_core/opsAccess/actions.ts"]) expect(x([f], diffOf(f, "+  const a = 1;")), f).toEqual([]);
  });
  it("borrados destructivos y modo live de Stripe en cualquier fichero de código", () => {
    expect(x(["server/a.ts"], diffOf("server/a.ts", '+  await pool.query("DELETE FROM tenants WHERE id = ?", [id]);'))).not.toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  await db.execute(sql`TRUNCATE TABLE leads`);"))).not.toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  await databases.dropDatabase(tenantId);"))).not.toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  fs.rmSync(dir, { recursive: true, force: true });"))).not.toEqual([]);
    expect(x(["server/stripe/gateway.ts"], diffOf("server/stripe/gateway.ts", "-  assertModeObject(c, mode);"))).not.toEqual([]);
    // Cambiar la verificación de firma (p. ej. la tolerancia) debilita; una comprobación nueva no
    expect(x(["server/stripe/gateway.ts"], diffOf("server/stripe/gateway.ts", "-  const e = stripe.webhooks.constructEvent(raw, sig, secret, 300);", "+  const e = stripe.webhooks.constructEvent(raw, sig, secret, 600);"))).not.toEqual([]);
    expect(x(["server/stripe/gateway.ts"], diffOf("server/stripe/gateway.ts", "+    assertModeObject(created, mode);"))).toEqual([]);
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  const k = \"sk_live_abc\";"))).not.toEqual([]);
    // En un comentario, no
    expect(x(["server/a.ts"], diffOf("server/a.ts", "+  // nunca DELETE FROM: se archiva"))).toEqual([]);
  });
  it("retirar o cambiar una comprobación de autorización es extraordinario; añadir rutas con permisos existentes, no", () => {
    const f = "server/stripe/purchasesApi.ts";
    expect(x([f], diffOf(f, '+  r.post("/companies/:id/purchases", requireScope("orders:write"), wrap(fn));'))).toEqual([]);
    expect(x([f], diffOf(f, '-  r.post("/x", requireScope("orders:write"), wrap(fn));', '+  r.post("/x", wrap(fn));'))).not.toEqual([]);
    expect(x([f], diffOf(f, '-  r.post("/x", requireScope("orders:write"), wrap(fn));', '+  r.post("/x", requireScope("ops:read"), wrap(fn));'))).not.toEqual([]);
    // Reescribir la línea conservando el mismo permiso (p. ej. añadir otra guarda) es ordinario
    expect(x([f], diffOf(f, '-  r.post("/x", requireScope("orders:write"), wrap(fn));', '+  r.post("/x", requireScope("orders:write"), wrap(async (q, s) => fn(q, s)));'))).toEqual([]);
    expect(x(["server/routers.ts"], diffOf("server/routers.ts", "-  list: protectedProcedure.query(() => all()),", "+  list: publicProcedure.query(() => all()),"))).not.toEqual([]);
  });
});

describe("vuelta atrás emparejada de Core y CRM", () => {
  it("si el CRM no queda publicado, el Core de esa misma ejecución vuelve a su despliegue anterior", () => {
    const wf = fs.readFileSync(".github/workflows/deploy-elephant-source.yml", "utf8");
    expect(wf).toContain('--record "${RUNNER_TEMP}/es-core-published.json"');
    expect(wf).toContain("id: crm");
    expect(wf).toContain("if: failure() && inputs.action == 'publicar' && steps.crm.outcome == 'failure'");
    expect(wf).toContain('rollback-recorded --env "${ES_ENV}" --file "${RUNNER_TEMP}/es-core-published.json"');
    const src = fs.readFileSync("scripts/deploy/esRailway.ts", "utf8");
    expect(src).toContain('if (cmd === "rollback-recorded")');
    expect(src).toContain("if (!(ORDINARY_SERVICES as readonly string[]).includes(d.name))");
  });
});

describe("debilitamiento frente a salvaguardas nuevas (clientes externos, #380)", () => {
  const none = () => null;
  it("un interruptor NUEVO (no existía en lo publicado) es ordinario; uno existente o modificado, extraordinario", () => {
    const nuevo = diffOf("server/external/service.ts", '+    if (this.d.mode === "live" && !this.d.liveEnabled) throw new Error("CP_EXTERNAL_LIVE_ENABLED");', '+  liveEnabled: process.env.CP_EXTERNAL_LIVE_ENABLED === "1",');
    expect(extraordinaryChanges(["server/external/service.ts"], nuevo, none, { existsInBase: () => false })).toEqual([]);
    // Si ya existía en lo publicado, añadir una lectura puede encender algo con él
    expect(extraordinaryChanges(["server/x.ts"], nuevo, none, { existsInBase: () => true })).not.toEqual([]);
    // Sin saber qué hay publicado, lo prudente: extraordinario
    expect(extraordinaryChanges(["server/x.ts"], nuevo, none)).not.toEqual([]);
    // Cambiar la lectura de un interruptor existente (aunque sea nuevo en la petición) siempre es extraordinario
    const cambio = diffOf("server/x.ts", '-  const on = process.env.CP_EXTERNAL_LIVE_ENABLED === "1";', '+  const on = process.env.CP_EXTERNAL_LIVE_ENABLED !== "0";');
    expect(extraordinaryChanges(["server/x.ts"], cambio, none, { existsInBase: () => false })).not.toEqual([]);
  });
  it("separación live/pruebas: filas nuevas con livemode son ordinarias; cambiar el filtro existente, no", () => {
    expect(extraordinaryChanges(["server/external/store.ts"], diffOf("server/external/store.ts", '+    const [rows] = await this.pool.query("SELECT * FROM external_subscriptions WHERE id = ? AND livemode = ?", [id, this.lm]);'), none)).toEqual([]);
    expect(extraordinaryChanges(["server/stripe/store.ts"], diffOf("server/stripe/store.ts", '-    "SELECT * FROM stripe_prices WHERE livemode = ?"', '+    "SELECT * FROM stripe_prices WHERE livemode IN (0, 1)"'), none)).not.toEqual([]);
    // Mover una línea sin cambiarla no debilita nada
    expect(extraordinaryChanges(["server/stripe/store.ts"], diffOf("server/stripe/store.ts", "-    assertModeObject(c, mode);", "+    assertModeObject(c, mode);"), none)).toEqual([]);
  });
});
