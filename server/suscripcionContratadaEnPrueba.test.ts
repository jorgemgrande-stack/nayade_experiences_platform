/**
 * «Suscripción» durante la prueba: dos escenarios para CUALQUIER empresa.
 *  A) Prueba sin contratación: la presentación comercial de siempre (contratar un plan).
 *  B) Prueba con contratación ya aceptada: se muestra el plan de prueba y, por separado, el plan contratado con sus
 *     extensiones, lo formalizado, la cuota pactada y el primer cobro PREVISTO (nunca como cobro efectuado); no se invita a
 *     contratar de nuevo y se explica qué pasa al terminar la prueba. Solo se afirma lo que confirman las fuentes reales.
 */
import { describe, expect, it } from "vitest";
import { subscriptionHeader, type ContractingInput, type SubscriptionHeaderInput } from "../shared/subscriptionHeader";

const DAY = 86_400_000;
const TRIAL_END = Date.UTC(2026, 10, 28, 20, 53); // 28/11/2026 21:53 (Madrid)

const input = (contracting?: ContractingInput | null, o: Partial<SubscriptionHeaderInput> = {}, state: "trial" | "trial_expired" = "trial"): SubscriptionHeaderInput => ({
  overview: { licensing: "capabilities", state, plan: { key: "essential", name: "Essential" }, trial: { endsAt: TRIAL_END, daysLeft: state === "trial" ? 5 : 0 }, consultation: { available: true, until: null, endedAt: null } },
  contract: contracting === undefined ? null : { contract: null, period: null, billing: { status: null, cancelAtPeriodEnd: false }, customTerms: { contracting, current: { interval: "month" } } },
  isAdmin: true,
  portalEnabled: false,
  conversionEnabled: true,
  hasPlans: true,
  ...o,
});
const contracted = (o: Partial<ContractingInput> = {}): ContractingInput => ({
  planName: "Business",
  extensions: ["Elephant WhatsApp AI", "Elephant Campaigns"],
  acceptedAt: Date.UTC(2026, 10, 19, 10, 16),
  stage: "activation_scheduled",
  paymentMethodAuthorized: true,
  trialActive: true,
  trialEndsAt: TRIAL_END,
  nextChargeAt: TRIAL_END,
  recurring: { netCents: 5200, taxCents: 1092, totalCents: 6292, currency: "EUR" },
  ...o,
});

describe("escenario A — prueba sin contratación: presentación comercial intacta", () => {
  const cases: Array<[string, ContractingInput | null | undefined]> = [
    ["sin dato", undefined],
    ["null", null],
    ["sin fecha de aceptación", { ...contracted(), acceptedAt: null }],
  ];
  for (const [name, c] of cases) {
    it(`sin acuerdo aceptado (${name})`, () => {
      const h = subscriptionHeader(input(c));
      expect(h.contracted ?? null).toBeNull();
      expect(h.primary).toEqual({ kind: "convert", label: "Contratar un plan" });
      expect(h.secondary).toEqual({ kind: "plans", label: "Comparar planes" });
      expect(h.dataNote).toMatch(/Al contratar se conserva todo/);
    });
  }
});

describe("escenario B — prueba con contratación aceptada", () => {
  it("muestra por separado el plan contratado, sus extensiones, lo formalizado, la cuota y el primer cobro PREVISTO", () => {
    const h = subscriptionHeader(input(contracted()));
    expect(h.planName).toBe("Essential"); // el plan de prueba en uso no se confunde con el contratado
    expect(h.eyebrow).toBe("Plan en prueba");
    expect(h.status.label).toBe("Prueba gratuita activa");
    const c = h.contracted!;
    expect(c.title).toBe("Plan contratado");
    expect(c.planName).toBe("Business");
    expect(c.extensions).toEqual(["Elephant WhatsApp AI", "Elephant Campaigns"]);
    expect(c.confirmations.map((x) => [x.id, x.tone])).toEqual([["formalized", "success"], ["payment_method", "success"]]);
    expect(c.confirmations[0].label).toBe("Contratación formalizada el 19 de noviembre de 2026");
    expect(c.confirmations[1].label).toMatch(/Método de pago registrado y confirmado por Stripe/);
    expect(c.fee!.label).toBe("Cuota pactada");
    expect(c.fee!.value).toMatch(/52,00\s€ \+ IVA al mes \(62,92\s€ con IVA\)/);
    expect(c.firstCharge!.label).toBe("Primer cobro previsto");
    expect(c.firstCharge!.value).toMatch(/28 de noviembre de 2026 · 62,92\s€ con IVA/);
    expect(c.firstCharge!.note).toMatch(/Todavía no se ha cobrado nada/);
    expect(c.afterTrial).toMatch(/Al terminar la prueba \(28 de noviembre de 2026\), tu cuenta pasa del plan Essential a Business \+ Elephant WhatsApp AI \+ Elephant Campaigns/);
    expect(c.afterTrial).toMatch(/primer cobro con el método de pago registrado/);
  });

  it("no induce a contratar de nuevo y mantiene accesible la comparación de planes", () => {
    const h = subscriptionHeader(input(contracted()));
    expect(h.primary).toEqual({ kind: "plans", label: "Ver la comparación de planes" });
    expect(h.secondary).toBeNull();
    expect(JSON.stringify(h)).not.toMatch(/Contratar un plan|Contrata un plan/);
    expect(h.dataNote).toMatch(/no hace falta que contrates de nuevo/);
    // Sin planes publicados no hay botón, pero tampoco se ofrece contratar
    expect(subscriptionHeader(input(contracted(), { hasPlans: false })).primary).toBeNull();
  });

  it("no afirma el método de pago ni el primer cobro si Stripe aún no lo ha confirmado", () => {
    const c = subscriptionHeader(input(contracted({ paymentMethodAuthorized: false, stage: "payment_pending", nextChargeAt: null }))).contracted!;
    expect(c.confirmations[1]).toMatchObject({ id: "payment_method", tone: "warning", label: "Método de pago pendiente de autorizar" });
    expect(c.firstCharge).toBeNull();
    expect(c.afterTrial).toMatch(/falta autorizar el método de pago/);
    expect(JSON.stringify(c)).not.toMatch(/registrado y confirmado/);
  });

  it("vale para cualquier empresa y plan (sin extensiones, otra periodicidad e importe)", () => {
    const enterprise = contracted({ planName: "Enterprise", extensions: [], recurring: { netCents: 19900, taxCents: 4179, totalCents: 24079, currency: "EUR" } });
    const h = subscriptionHeader({ ...input(enterprise), contract: { contract: null, period: null, billing: { status: null, cancelAtPeriodEnd: false }, customTerms: { contracting: enterprise, current: { interval: "year" } } } });
    const c = h.contracted!;
    expect(c.planName).toBe("Enterprise");
    expect(c.extensions).toEqual([]);
    expect(c.fee!.value).toMatch(/199,00\s€ \+ IVA al año \(240,79\s€ con IVA\)/);
    expect(c.afterTrial).toMatch(/a Enterprise y se hace el primer cobro/);
  });

  it("la fecha de renovación interna no se presenta como cobro durante la prueba", () => {
    const h = subscriptionHeader(input(contracted(), { contract: { contract: null, period: { renewsAt: Date.UTC(2026, 11, 13), cancelAt: null }, billing: { status: null, cancelAtPeriodEnd: false }, customTerms: { contracting: contracted(), current: { interval: "month" } } } }));
    expect(h.facts.map((f) => f.id)).toEqual(["trial"]);
    expect(JSON.stringify(h)).not.toMatch(/13 de diciembre/);
  });

  it("prueba ya terminada con acuerdo aceptado: se aplica el plan contratado, sin pedir contratar", () => {
    const h = subscriptionHeader(input(contracted(), {}, "trial_expired"));
    expect(h.status.label).toBe("Prueba finalizada · activando tu plan contratado");
    expect(h.primary?.kind).toBe("plans");
    expect(h.contracted!.planName).toBe("Business");
    expect(JSON.stringify(h)).not.toMatch(/Contratar un plan|Contrata ahora/);
  });
});
