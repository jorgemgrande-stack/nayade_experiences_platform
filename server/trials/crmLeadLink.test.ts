/**
 * Prueba gratuita verificada → alta automática completa en el CRM: el lead de su solicitud «Prueba de 15 días» pasa a
 * «Convertido» enlazado a la empresa creada, la solicitud queda atendida y nada se duplica. Datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { WebRequestService } from "../crm/webRequests";
import { MemoryTrialStore } from "./store";
import { TrialService } from "./service";
import { TrialOnboardingService } from "./onboarding";
import { linkTrialLead, recordTrialRequest } from "./crmRequest";

const T0 = Date.UTC(2026, 10, 13, 15, 0);

function harness() {
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => T0 });
  const requests = new WebRequestService({ store: crmStore, crm, now: () => T0 });
  const trials = new TrialService({ store: new MemoryTrialStore(), now: () => T0 });
  const tokens: Array<{ trialId: number; token: string }> = [];
  const welcomes: string[] = [];
  let provisions = 0;
  const ob = new TrialOnboardingService({
    trials,
    now: () => T0,
    platformDomain: "app.example",
    notify: { verification: async (_e: string, p: { trialId: number; token: string }) => void tokens.push(p), welcome: async (e: string) => void welcomes.push(e), expiryNotice: async () => undefined },
    provision: async (req: { tenantId: string }) => (provisions++, { status: "completed", tenantId: req.tenantId, domain: `${req.tenantId}.app.example`, adminInviteToken: "inv" }),
    priceOf: async () => 7,
    companies: {
      byTenant: async (tenantId: string) => (await crmStore.list("companies", { tenantId }, { limit: 1 }))[0] ?? null,
      create: async (input: { name: string; email: string; tenantId: string }, actor: string) => {
        const c = await crm.createCompany({ name: input.name, email: input.email }, actor);
        await crm.createContact(c.id, { firstName: "Persona", lastName: "Demo", email: input.email }, actor);
        return crmStore.update("companies", c.id, { tenantId: input.tenantId });
      },
    },
    subscriptions: { list: async () => [], create: async () => ({ id: 1, status: "trialing" }) },
    licensing: { apply: async () => ({ applied: [], desired: [] }) },
    onRegistered: async (t) => void (await recordTrialRequest(requests, t)),
    onProvisioned: (t, target, actor) => linkTrialLead({ store: crmStore, crm, requests }, t, target, actor),
  } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
  return { crmStore, crm, ob, tokens, welcomes, provisions: () => provisions, trials };
}

const form = { email: "persona@empresa-bienestar.example", companyName: "Empresa Bienestar Demo", profile: { fullName: "Persona Demo", country: "ES", termsAccepted: true, termsVersion: "2026-10-21", marketingConsent: false }, terms: { accepted: true, version: "2026-10-21", privacyVersion: "2026-11-10" }, idempotencyKey: "idem-enlace-000001" };

describe("alta automática: lead de la prueba → «Convertido» en su empresa", () => {
  it("al verificar el correo se aprovisiona sola, el lead queda convertido en ESA empresa y la solicitud atendida", async () => {
    const h = harness();
    await h.ob.register(form as never);
    const [{ trialId, token }] = h.tokens;
    const out = await h.ob.verify(trialId, token, { autoProvision: true });
    expect(out.activationError).toBeNull();
    expect(out.activation!.trial.state).toBe("active");
    const [lead] = await h.crmStore.list("leads", {});
    expect(lead).toMatchObject({ status: "converted", convertedCompanyId: out.activation!.companyId });
    // Reutiliza el contacto del responsable de la prueba (mismo correo): ninguno duplicado
    expect(await h.crmStore.list("contacts", { companyId: out.activation!.companyId })).toHaveLength(1);
    expect(await h.crmStore.list("companies", {})).toHaveLength(1);
    const [req] = await h.crmStore.list("leadRequests", {});
    expect(req).toMatchObject({ status: "attended", attendedBy: "system:trial", type: "trial" });
    const notes = (await h.crmStore.list("activities", {})).map((a) => a.summary).join("\n");
    expect(notes).toMatch(/Alta automática: al verificar el correo/);
    expect(notes).not.toMatch(/activación manual/);
    expect(notes).toMatch(/verificada y aprovisionada automáticamente/);
  });

  it("reanudar la activación (reintento automático u operador) no duplica empresa, conversión ni avisos", async () => {
    const h = harness();
    await h.ob.register(form as never);
    const [{ trialId, token }] = h.tokens;
    const first = await h.ob.verify(trialId, token, { autoProvision: true });
    const again = await h.ob.activate(trialId, "system:trial-scheduler");
    expect(again.companyId).toBe(first.activation!.companyId);
    expect(h.provisions()).toBe(1);
    expect(h.welcomes).toHaveLength(1);
    expect(await h.crmStore.list("companies", {})).toHaveLength(1);
    const t = await h.trials.must(trialId);
    expect(await linkTrialLead({ store: h.crmStore, crm: h.crm, requests: { setStatus: async () => { throw new Error("no debe tocar la solicitud"); } } as never }, t, { companyId: first.activation!.companyId, tenantId: t.tenantId! }, "x")).toBe("already_linked");
  });

  it("no toca un lead convertido en otra empresa ni uno descartado; sin solicitud no hace nada", async () => {
    const h = harness();
    await h.ob.register(form as never);
    const [{ trialId }] = h.tokens;
    const t = await h.trials.must(trialId);
    const [lead] = await h.crmStore.list("leads", {});
    await h.crm.setLeadStatus(lead.id, "disqualified", "op");
    const deps = { store: h.crmStore, crm: h.crm, requests: { setStatus: async () => undefined } as never };
    expect(await linkTrialLead(deps, t, { companyId: 99, tenantId: "t" }, "x")).toBe("disqualified");
    expect(await linkTrialLead(deps, { id: 12345 }, { companyId: 99, tenantId: "t" }, "x")).toBe("no_request");
  });
});
