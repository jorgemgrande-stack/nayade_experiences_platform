/**
 * Cabecera de «Suscripción»: cada estado real de la suscripción (prueba activa y finalizada, activa, pago pendiente,
 * cancelada con acceso, finalizada, restringida, pendiente y sin plan) con su fecha, su cobro, los datos y la acción.
 */
import { describe, expect, it } from "vitest";
import { subscriptionHeader, type SubscriptionHeaderInput } from "../shared/subscriptionHeader";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12);
const base = (o: Partial<SubscriptionHeaderInput["overview"]> = {}, rest: Partial<SubscriptionHeaderInput> = {}): SubscriptionHeaderInput => ({
  overview: { licensing: "capabilities", state: "active", plan: { key: "essential", name: "Essential" }, trial: null, consultation: { available: true, until: null, endedAt: null }, ...o },
  contract: null,
  isAdmin: true,
  portalEnabled: false,
  conversionEnabled: true,
  hasPlans: true,
  ...rest,
});
const contract = (state: string, o: { cancelAt?: number | null; renewsAt?: number | null; graceEndsAt?: number | null; billing?: string | null } = {}) => ({
  contract: { state, interval: "month" as const, recurringNetCents: 7900, currency: "EUR", graceEndsAt: o.graceEndsAt ?? null },
  period: { renewsAt: o.renewsAt ?? null, cancelAt: o.cancelAt ?? null },
  billing: { status: o.billing ?? null, cancelAtPeriodEnd: !!o.cancelAt },
});

describe("cabecera de la suscripción", () => {
  it("prueba activa: días que quedan, sin cobro y contratar (solo la administración con el alta abierta)", () => {
    const h = subscriptionHeader(base({ state: "trial", trial: { endsAt: NOW + 5 * DAY, daysLeft: 5 } }));
    expect(h.eyebrow).toBe("Plan en prueba");
    expect(h.status).toEqual({ label: "Prueba gratuita activa", tone: "info" });
    expect(h.facts[0].label).toBe("Te quedan 5 días");
    expect(h.dataNote).toMatch(/no se te ha cobrado nada/);
    expect(h.primary).toEqual({ kind: "convert", label: "Contratar un plan" });
    expect(subscriptionHeader(base({ state: "trial", trial: { endsAt: NOW + DAY, daysLeft: 1 } }, { conversionEnabled: false })).primary).toEqual({ kind: "plans", label: "Ver planes" });
    expect(subscriptionHeader(base({ state: "trial", trial: { endsAt: NOW + DAY, daysLeft: 1 } }, { isAdmin: false })).primary?.kind).toBe("plans");
  });

  it("prueba finalizada: destaca que se contrata conservando los datos sin ocultar el solo lectura", () => {
    const h = subscriptionHeader(base({ state: "trial_expired", trial: { endsAt: Date.UTC(2026, 10, 8, 10), daysLeft: 0 } }));
    expect(h.status.label).toBe("Prueba finalizada");
    expect(h.facts[0]).toMatchObject({ label: "Terminó el", value: "8 de noviembre de 2026" });
    expect(h.dataNote).toMatch(/se conservan tus datos/);
    expect(h.restriction).toBeTruthy();
    expect(h.primary).toEqual({ kind: "convert", label: "Contratar un plan" });
    // Quien no administra no ve un botón que no puede usar
    expect(subscriptionHeader(base({ state: "trial_expired", trial: { endsAt: NOW - DAY, daysLeft: 0 } }, { isAdmin: false })).primary).toBeNull();
  });

  it("suscripción activa: renovación, importe sin IVA y cobro al corriente", () => {
    const h = subscriptionHeader(base({}, { contract: contract("active", { renewsAt: Date.UTC(2026, 11, 9, 12) }), portalEnabled: true }));
    expect(h.status).toEqual({ label: "Suscripción activa", tone: "success" });
    expect(h.facts.map((f) => f.id)).toEqual(["renewal", "amount", "payment"]);
    expect(h.facts[1].value.replace(/\s/g, " ")).toBe("79,00 € + IVA");
    expect(h.primary?.kind).toBe("plans");
    expect(h.secondary?.kind).toBe("portal");
  });

  it("pago pendiente o fallido: estado del cobro, plazo y actualizar el pago (portal si existe)", () => {
    const h = subscriptionHeader(base({}, { contract: contract("past_due", { graceEndsAt: NOW + 7 * DAY }), portalEnabled: true }));
    expect(h.status.label).toBe("Pago pendiente");
    expect(h.facts.map((f) => f.id)).toEqual(["payment", "grace", "amount"]);
    expect(h.primary).toEqual({ kind: "portal", label: "Actualizar el pago" });
    const fromStripe = subscriptionHeader(base({}, { contract: contract("active", { billing: "past_due" }) }));
    expect(fromStripe.status.label).toBe("Pago pendiente");
    expect(fromStripe.primary?.kind).toBe("billing");
  });

  it("cancelada con acceso vigente: fecha de fin y mantener la suscripción", () => {
    const h = subscriptionHeader(base({}, { contract: contract("cancel_scheduled", { cancelAt: Date.UTC(2026, 11, 1, 12) }) }));
    expect(h.status.label).toBe("Cancelada · acceso vigente");
    expect(h.facts[0]).toMatchObject({ id: "end", value: "1 de diciembre de 2026" });
    expect(h.primary).toEqual({ kind: "billing", label: "Mantener mi suscripción" });
  });

  it("finalizada: el texto de consulta real y reactivar el plan", () => {
    const h = subscriptionHeader(base({ state: "read_only", consultation: { available: true, until: NOW + 10 * DAY, endedAt: null } }));
    expect(h.eyebrow).toBe("Tu plan anterior");
    expect(h.status.label).toBe("Finalizada");
    expect(h.dataNote).toMatch(/^Tu suscripción ha finalizado\. Puedes consultar tus datos en solo lectura hasta el/);
    expect(h.primary).toEqual({ kind: "plans", label: "Reactivar mi plan" });
    const closed = subscriptionHeader(base({ state: "read_only", consultation: { available: false, until: null, endedAt: NOW - DAY } }));
    expect(closed.dataNote).toMatch(/el plazo de consulta terminó/);
  });

  it("estados excepcionales: restringida, pendiente de activar y sin plan", () => {
    expect(subscriptionHeader(base({ state: "suspended" })).primary).toEqual({ kind: "link", label: "Contactar con soporte", href: "/admin/soporte" });
    expect(subscriptionHeader(base({ state: "pending" })).status.label).toBe("Pendiente de activar");
    const none = subscriptionHeader(base({ state: "none", plan: null }, { hasPlans: false }));
    expect(none.planName).toBe("Sin plan asignado");
    expect(none.primary).toBeNull();
  });
});
