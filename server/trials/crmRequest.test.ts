/**
 * Prueba gratuita → solicitud «Prueba de 15 días» en el CRM desde que se recibe (incidencia Quantum Soulrise,
 * 13/11/2026): antes solo llegaba al CRM al verificar el correo y su aviso nunca se generaba. Datos sintéticos.
 */
import { describe, expect, it } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { WebRequestService } from "../crm/webRequests";
import type { LeadRequest } from "../crm/types";
import { MemoryTrialStore } from "./store";
import { TrialService } from "./service";
import { TrialOnboardingService } from "./onboarding";
import { recordTrialRequest } from "./crmRequest";

const T0 = Date.UTC(2026, 10, 13, 11, 21);
const flush = () => new Promise((r) => setImmediate(r));

function harness(o: { failCrm?: boolean } = {}) {
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => T0 });
  const notices: LeadRequest[] = [];
  const requests = new WebRequestService({ store: crmStore, crm, now: () => T0, onCreated: async (r) => void notices.push(r) });
  const store = new MemoryTrialStore();
  const trials = new TrialService({ store, now: () => T0 });
  const sent: string[] = [];
  const ob = new TrialOnboardingService({
    trials,
    now: () => T0,
    platformDomain: "app.example",
    notify: { verification: async () => void sent.push("verification"), welcome: async () => undefined, expiryNotice: async () => undefined },
    provision: async () => ({ status: "completed", tenantId: "x", domain: "x.app.example", adminInviteToken: "i" }),
    priceOf: async () => 7,
    companies: { byTenant: async () => null, create: async () => ({ id: 1 }) },
    subscriptions: { list: async () => [], create: async () => ({ id: 1, status: "trialing" }) },
    licensing: { apply: async () => ({ applied: [], desired: [] }) },
    onRegistered: async (t) => {
      if (o.failCrm) throw new Error("CRM caído");
      await recordTrialRequest(requests, t);
    },
  } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
  return { crmStore, requests, notices, ob, sent, trials };
}

const form = (over: Record<string, unknown> = {}) => ({
  email: "persona@empresa-bienestar.example",
  companyName: "Empresa Bienestar Demo",
  profile: { fullName: "Persona Demo", sector: "salud-bienestar", phone: "+34 600000000", country: "ES", termsAccepted: true, termsVersion: "2026-10-21", marketingConsent: true },
  attribution: { landingPath: "/prueba-gratuita" },
  terms: { accepted: true, version: "2026-10-21", privacyVersion: "2026-11-10" },
  idempotencyKey: "idem-prueba-000001",
  ...over,
});

describe("prueba gratuita en el CRM desde la recepción", () => {
  it("el alta crea el lead y la solicitud «trial» (con su aviso) aunque el correo aún no esté verificado", async () => {
    const h = harness();
    const r = await h.ob.register(form() as never);
    expect(r).toMatchObject({ created: true, state: "pending_verification" });
    expect(h.sent).toEqual(["verification"]);
    const reqs = await h.crmStore.list("leadRequests", {});
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ type: "trial", interest: "essential", sourcePage: "/prueba-gratuita", status: "pending", marketingConsent: true });
    expect(reqs[0].message).toMatch(/prueba n\.º \d+[\s\S]*pendiente de verificación/);
    const leads = await h.crmStore.list("leads", {});
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ email: "persona@empresa-bienestar.example", companyName: "Empresa Bienestar Demo" });
    await flush();
    expect(h.notices.map((n) => n.type)).toEqual(["trial"]);
  });

  it("reintentos (mismo formulario, misma prueba o recuperación desde «Pruebas») no duplican solicitudes ni avisos", async () => {
    const h = harness();
    const r = await h.ob.register(form() as never);
    await h.ob.register(form() as never).catch(() => undefined);
    const t = await h.trials.must(r.trialId);
    expect(await h.ob.recordInCrm(t)).toBe(true);
    expect(await h.ob.recordInCrm(t)).toBe(true);
    expect(await h.crmStore.list("leadRequests", {})).toHaveLength(1);
    await flush();
    expect(h.notices).toHaveLength(1);
    expect(h.sent).toEqual(["verification"]);
  });

  it("si el CRM falla, la prueba se registra igual y el correo de verificación sale (se recupera después)", async () => {
    const h = harness({ failCrm: true });
    const r = await h.ob.register(form({ idempotencyKey: "idem-prueba-000002" }) as never);
    expect(r.created).toBe(true);
    expect(h.sent).toEqual(["verification"]);
    expect(await h.crmStore.list("leadRequests", {})).toHaveLength(0);
  });

  it("sin consentimiento comercial también entra (el aviso interno es operativo)", async () => {
    const h = harness();
    await h.ob.register(form({ idempotencyKey: "idem-prueba-000003", profile: { fullName: "Otra Persona", country: "ES", termsAccepted: true, termsVersion: "2026-10-21", marketingConsent: false } }) as never);
    const reqs = await h.crmStore.list("leadRequests", {});
    expect(reqs).toHaveLength(1);
    expect(reqs[0].marketingConsent).toBe(false);
    await flush();
    expect(h.notices).toHaveLength(1);
  });
});
