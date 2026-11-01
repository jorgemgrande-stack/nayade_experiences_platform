/**
 * Canal del Core con el plano de control (scripts/deploy/esRailwayLib.ts, commerceChannelPlan): conserva las demás
 * entradas de CP_TOKENS, es idempotente, no duplica «core-commerce», no reescribe lo que no entiende y nunca abre la
 * compra en línea. Datos sintéticos.
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { CORE_COMMERCE_SCOPES, commerceChannelPlan, coreCommerceUrlRef } from "../scripts/deploy/esRailwayLib";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NEW = sha("token-nuevo-sintetico");
const OTHER = { id: "operador-crm", sha256: sha("otro"), scopes: ["tenants:read"], actorType: "crm" };
const URL = coreCommerceUrlRef("4100");

describe("canal del Core con el plano de control", () => {
  it("sin canal: añade core-commerce conservando las demás entradas y pone URL y token en core", () => {
    const plan = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: JSON.stringify([OTHER]) }, core: {} }, { newTokenSha256: NEW });
    expect(plan.problems).toEqual([]);
    expect(JSON.parse(plan.cpTokens!)).toEqual([OTHER, { id: "core-commerce", sha256: NEW, scopes: [...CORE_COMMERCE_SCOPES] }]);
    expect(plan.core).toEqual([{ name: "CP_COMMERCE_TOKEN", generate: true }, { name: "CP_COMMERCE_URL", value: "http://${{controlplane.RAILWAY_PRIVATE_DOMAIN}}:4100" }]);
    expect(plan.status).toMatchObject({ url: null, tokenDefined: false, acceptedBy: null, purchasesEnabled: false });
  });

  it("idempotente: con el canal correcto no cambia nada", () => {
    const tokens = [OTHER, { id: "core-commerce", sha256: sha("vigente"), scopes: [...CORE_COMMERCE_SCOPES] }];
    const plan = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: JSON.stringify(tokens) }, core: { CP_COMMERCE_URL: URL, CP_COMMERCE_TOKEN: "vigente" } }, { newTokenSha256: NEW });
    expect(plan).toMatchObject({ cpTokens: null, core: [], problems: [] });
    expect(plan.status.acceptedBy).toBe("core-commerce");
  });

  it("una entrada core-commerce que ya no corresponde al token del Core se sustituye, nunca se duplica", () => {
    const tokens = [OTHER, { id: "core-commerce", sha256: sha("antiguo"), scopes: ["commerce:purchase"] }];
    const plan = commerceChannelPlan({ controlplane: { CP_TOKENS: JSON.stringify(tokens) }, core: { CP_COMMERCE_URL: URL, CP_COMMERCE_TOKEN: "perdido" } }, { newTokenSha256: NEW });
    const next = JSON.parse(plan.cpTokens!) as Array<{ id: string; sha256: string }>;
    expect(next.filter((t) => t.id === "core-commerce")).toEqual([{ id: "core-commerce", sha256: NEW, scopes: [...CORE_COMMERCE_SCOPES] }]);
    expect(next[0]).toEqual(OTHER);
    expect(plan.core).toEqual([{ name: "CP_COMMERCE_TOKEN", generate: true }]);
  });

  it("le faltan ámbitos a core-commerce: se rota con los ámbitos completos", () => {
    const tokens = [{ id: "core-commerce", sha256: sha("vigente"), scopes: ["commerce:purchase"] }];
    const plan = commerceChannelPlan({ controlplane: { CP_TOKENS: JSON.stringify(tokens) }, core: { CP_COMMERCE_URL: URL, CP_COMMERCE_TOKEN: "vigente" } }, { newTokenSha256: NEW });
    expect(plan.status.missingScopes).toEqual(["commerce:withdrawal", "commerce:support"]);
    expect(JSON.parse(plan.cpTokens!)).toEqual([{ id: "core-commerce", sha256: NEW, scopes: [...CORE_COMMERCE_SCOPES] }]);
  });

  it("un token del Core aceptado por otra entrada no se toca (solo se corrige la URL)", () => {
    const boot = { id: "arranque-live", sha256: sha("arranque"), scopes: [...CORE_COMMERCE_SCOPES, "ops:read"] };
    const plan = commerceChannelPlan({ controlplane: { PORT: "4100", CP_TOKENS: JSON.stringify([boot]) }, core: { CP_COMMERCE_URL: "http://otro:1", CP_COMMERCE_TOKEN: "arranque" } }, { newTokenSha256: NEW });
    expect(plan.cpTokens).toBeNull();
    expect(plan.core).toEqual([{ name: "CP_COMMERCE_URL", value: URL }]);
    expect(plan.status.acceptedBy).toBe("arranque-live");
  });

  it("no reescribe un CP_TOKENS ausente, que no sea JSON o que sea una referencia", () => {
    for (const CP_TOKENS of [undefined, "no-json", '{"id":"x"}', "${{shared.CP_TOKENS}}"]) {
      const plan = commerceChannelPlan({ controlplane: CP_TOKENS === undefined ? {} : { CP_TOKENS }, core: {} }, { newTokenSha256: NEW });
      expect(plan.problems.length).toBe(1);
      expect(plan).toMatchObject({ cpTokens: null, core: [] });
    }
  });

  it("usa el puerto del plano de control y nunca propone abrir la compra en línea", () => {
    const plan = commerceChannelPlan({ controlplane: { PORT: "4200", CP_TOKENS: "[]", CP_COMMERCE_PURCHASES_ENABLED: "1" }, core: {} }, { newTokenSha256: NEW });
    expect(plan.core.find((c) => c.name === "CP_COMMERCE_URL")?.value).toBe(coreCommerceUrlRef("4200"));
    expect(plan.status.purchasesEnabled).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/PURCHASES_ENABLED"?\s*[,:]?\s*"?name/);
    expect(plan.core.map((c) => c.name)).not.toContain("CP_COMMERCE_PURCHASES_ENABLED");
  });

  it("el plan nunca lleva el token del Core en claro", () => {
    const plan = commerceChannelPlan({ controlplane: { CP_TOKENS: "[]" }, core: { CP_COMMERCE_TOKEN: "secreto-sintetico-del-core" } }, { newTokenSha256: NEW });
    expect(JSON.stringify(plan)).not.toContain("secreto-sintetico-del-core");
  });
});
