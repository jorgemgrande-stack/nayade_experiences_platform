/**
 * Primera sesión de la prueba (encargo del 09/11/2026, fases 5 a 7):
 *  - guía de tres pasos con el estado real y solo los pasos que la persona puede dar, sin datos fiscales;
 *  - hitos de activación al plano de control: una vez por proceso y empresa, sin datos personales y sin fallar nunca;
 *  - contratar el plan que se prueba: el mismo destino antes y después del fin de la prueba.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { firstActionOf, trialFirstSteps } from "../shared/trialFirstSteps";
import { trialConversionHref, resolveRecovery, PLANS_HREF } from "../shared/subscriptionRecovery";
import { _resetTrialMilestonesForTests, reportTrialMilestones } from "./trialMilestones";
import { CommerceError, commerceClientFromEnv, type CommerceClient } from "./commerceClient";

const facts = (over: Partial<Parameters<typeof trialFirstSteps>[0]> = {}) => ({ identity: false, clients: 0, quotes: 0, documents: 0, products: 0, sales: 0, ...over });

describe("guía de primeros pasos de la prueba", () => {
  it("tres pasos en orden con su estado real; el de la empresa no pide datos fiscales", () => {
    const s = trialFirstSteps(facts({ identity: true, clients: 2 }), { clients: true, quotes: true });
    expect(s.map((x) => [x.id, x.done])).toEqual([["company", true], ["client", true], ["quote", false]]);
    expect(s[0].text).toMatch(/fiscales pueden esperar/);
    expect(s[2].href).toBe("/admin/crm?tab=quotes&nuevo=1");
  });
  it("solo los pasos que la persona puede dar; sin el recuento de presupuestos cuenta los documentos", () => {
    expect(trialFirstSteps(facts(), { clients: false, quotes: false }).map((x) => x.id)).toEqual(["company"]);
    const legacy = { identity: false, clients: 0, documents: 1, products: 0, sales: 0 };
    expect(trialFirstSteps(legacy, { clients: true, quotes: true }).find((x) => x.id === "quote")?.done).toBe(true);
  });
  it("primera acción útil: la primera que exista", () => {
    expect(firstActionOf(facts())).toBeNull();
    expect(firstActionOf(facts({ products: 1 }))).toBe("product");
    expect(firstActionOf(facts({ quotes: 1, sales: 1 }))).toBe("document");
    expect(firstActionOf(facts({ clients: 1, quotes: 1 }))).toBe("client");
  });
});

describe("hitos de activación hacia el plano de control", () => {
  beforeEach(() => _resetTrialMilestonesForTests());
  const fake = (fail?: () => Error) => {
    const calls: Array<[string, string, string | null]> = [];
    const client = { trialMilestone: async (t: string, m: string, d: string | null) => { calls.push([t, m, d]); if (fail) throw fail(); return { recorded: true }; } } as unknown as CommerceClient;
    return { client, calls };
  };

  it("primer acceso siempre y primera acción cuando la hay, una sola vez por proceso y empresa", async () => {
    const { client, calls } = fake();
    expect(await reportTrialMilestones(client, "t-1", facts(), 1)).toEqual(["first_access"]);
    expect(await reportTrialMilestones(client, "t-1", facts(), 2)).toEqual([]);
    expect(await reportTrialMilestones(client, "t-1", facts({ clients: 1 }), 3)).toEqual(["first_action"]);
    expect(await reportTrialMilestones(client, "t-1", facts({ clients: 5 }), 4)).toEqual([]);
    expect(await reportTrialMilestones(client, "t-2", facts(), 5)).toEqual(["first_access"]);
    expect(calls).toEqual([["t-1", "first_access", null], ["t-1", "first_action", "client"], ["t-2", "first_access", null]]);
  });

  it("sin canal o sin empresa no hace nada; un 404 deja de intentarlo un rato y nunca lanza", async () => {
    expect(await reportTrialMilestones(null, "t-1", facts(), 1)).toEqual([]);
    expect(await reportTrialMilestones(fake().client, null, facts(), 1)).toEqual([]);
    const missing = fake(() => new CommerceError(404, "not_found", "No"));
    expect(await reportTrialMilestones(missing.client, "t-1", facts({ clients: 1 }), 1)).toEqual([]);
    expect(await reportTrialMilestones(missing.client, "t-1", facts({ clients: 1 }), 2)).toEqual([]);
    expect(missing.calls).toHaveLength(1);
    // Pasado el plazo se vuelve a intentar
    _resetTrialMilestonesForTests();
    const down = fake(() => new CommerceError(503, "unreachable", "No"));
    await expect(reportTrialMilestones(down.client, "t-1", facts(), 1)).resolves.toEqual([]);
    expect(await reportTrialMilestones(down.client, "t-1", facts(), 31 * 60_000)).toEqual([]);
    expect(down.calls.filter((c) => c[1] === "first_access")).toHaveLength(2);
  });

  it("el cliente llama a la ruta del plano de control con el tenant en la ruta y sin datos personales", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const f = async (url: string, init: { body?: string }) => (seen.push({ url, body: init.body ? JSON.parse(init.body) : null }), { status: 202, json: async () => ({ recorded: true, trialId: 7 }) });
    const c = commerceClientFromEnv({ CP_COMMERCE_URL: "https://cp.example/", CP_COMMERCE_TOKEN: "t".repeat(40), NODE_ENV: "production" } as NodeJS.ProcessEnv, f as never)!;
    expect(await c.trialMilestone!("estudio-norte", "first_action", "client")).toMatchObject({ recorded: true });
    expect(seen[0].url).toMatch(/\/tenants\/estudio-norte\/trial-milestones$/);
    expect(seen[0].body).toEqual({ milestone: "first_action", detail: "client" });
  });
});

describe("contratar el plan que se prueba", () => {
  it("antes y después del fin de la prueba, el mismo destino", () => {
    expect(trialConversionHref("essential", true)).toBe("/admin/suscripcion?contratar=essential#contratar");
    expect(trialConversionHref("essential", false)).toBe(PLANS_HREF);
    expect(trialConversionHref("enterprise", true)).toBe(PLANS_HREF);
    const ended = resolveRecovery({ overview: { licensing: "capabilities", state: "trial_expired", plan: { key: "essential" } }, isAdmin: true, conversionEnabled: true });
    expect(ended?.cta?.action).toEqual({ type: "link", href: trialConversionHref("essential", true) });
  });
});
