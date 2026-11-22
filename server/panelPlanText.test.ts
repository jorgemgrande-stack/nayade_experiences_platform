import { describe, expect, it } from "vitest";
import { panelText, panelTextMissing } from "../shared/i18n/panelText";
import { subscriptionHeader, type SubscriptionHeaderInput } from "../shared/subscriptionHeader";
import {
  blockedNotice,
  exportAccountNotice,
  readOnlyBlockText,
  resolveRecovery,
  subscriptionEndedText,
  type RecoveryConsultation,
  type RecoveryState,
} from "../shared/subscriptionRecovery";
import { COMPARISON_GROUP_LABELS, planPresentation, taxLabel as planTaxLabel } from "../shared/planPresentation";
import { COMMERCIAL_LABELS, PLAN_REQUEST_KIND_LABEL, PLAN_REQUEST_STATUS_LABEL, buildPlanComparison, parsePanelPlans } from "../shared/subscriptionPlans";
import { CHECKOUT_STEPS, EXTENSION_GROUPS, validateBuyer, checkoutExtensions, EMPTY_BUYER } from "../shared/subscriptionCheckout";
import {
  CONNECT_BRANDS,
  CONNECT_CATEGORIES,
  CONNECT_STATE_LABELS,
  CONNECT_STATE_SHORT,
  PURCHASE_BLOCK_TEXT,
  TRIAL_CONVERSION_TEXT,
  applyConversionRequest,
  conversionPlanText,
  conversionSupportText,
  deriveConnectState,
  lapsedLicenceText,
  withPendingOrders,
} from "../shared/connectMarketplace";
import { periodLabel, taxLabel } from "../shared/connectCard";
import { ASSISTED_CONTRACT_COPY, NET_SALE_LABEL, NET_SALE_STATE_LABEL } from "../shared/netOffer";
import { ACTIVATION_LABELS, CONTRACT_NOW_LABEL, VIEW_SHEET_LABEL, activationActions, activationLabel, primaryAction, type ConnectActivation } from "../shared/connectShowcase";

const NOW = Date.UTC(2026, 10, 22, 10, 0);
const DAY = 86_400_000;
const consultations: Array<RecoveryConsultation | null> = [
  null,
  { available: true, until: null, endedAt: null },
  { available: true, until: NOW + 5 * DAY, endedAt: null },
  { available: false, until: null, endedAt: NOW - DAY },
  { available: false, until: null, endedAt: null },
];
const states: RecoveryState[] = ["trial", "trial_expired", "active", "read_only", "suspended", "cancelled", "pending", "none"];

/** Todos los textos en español que los modelos puros ofrecen a la pantalla. */
function allTexts(): string[] {
  const out: string[] = [];
  const add = (...s: Array<string | null | undefined>) => s.forEach((x) => x && out.push(x));

  for (const state of states)
    for (const consultation of consultations)
      for (const isAdmin of [true, false])
        for (const portalEnabled of [true, false])
          for (const conversionEnabled of [true, false]) {
            for (const canExport of [true, false]) add(exportAccountNotice(state, consultation, canExport));
            add(subscriptionEndedText(consultation));
            const contracts: SubscriptionHeaderInput["contract"][] = [
              null,
              {
                contract: { state: "active", interval: "month", recurringNetCents: 2900, currency: "EUR", graceEndsAt: null },
                period: { renewsAt: NOW + 20 * DAY, cancelAt: null },
                billing: { status: "active", cancelAtPeriodEnd: false },
              },
              {
                contract: { state: "past_due", interval: "year", recurringNetCents: 29000, currency: "EUR", graceEndsAt: NOW + 3 * DAY },
                period: { renewsAt: null, cancelAt: null },
                billing: { status: "past_due", cancelAtPeriodEnd: false },
              },
              {
                contract: { state: "suspended", interval: "month", recurringNetCents: 2900, currency: "EUR", graceEndsAt: null },
                period: null,
                billing: { status: "unpaid", cancelAtPeriodEnd: false },
              },
              {
                contract: { state: "cancel_scheduled", interval: "month", recurringNetCents: 2900, currency: "EUR", graceEndsAt: null },
                period: { renewsAt: null, cancelAt: NOW + 9 * DAY },
                billing: { status: "active", cancelAtPeriodEnd: true },
              },
            ];
            for (const contract of contracts) {
              const overview = { licensing: "capabilities" as const, state, plan: { key: "essential", name: "Essential" }, trial: { endsAt: NOW + 4 * DAY, daysLeft: 4 }, consultation };
              const v = resolveRecovery({ overview, contract, isAdmin, portalEnabled, conversionEnabled });
              if (v) {
                add(v.title, v.text, v.secondary, v.cta?.label);
                for (const st of ["read_only", "expired"] as const) {
                  const b = blockedNotice(v, st);
                  add(b.title, b.description, b.action?.label);
                }
              }
              for (const hasPlans of [true, false]) {
                for (const daysLeft of [0, 1, 4]) {
                  const h = subscriptionHeader({
                    overview: { ...overview, trial: { endsAt: NOW + daysLeft * DAY, daysLeft } },
                    contract,
                    isAdmin,
                    portalEnabled,
                    conversionEnabled,
                    hasPlans,
                  });
                  add(h.eyebrow, h.planName === "Essential" ? null : h.planName, h.status.label, h.dataNote, h.restriction, h.primary?.label, h.secondary?.label);
                  h.facts.forEach((f) => add(f.label, f.value));
                }
              }
            }
          }
  for (const st of ["read_only", "expired"] as const) {
    add(readOnlyBlockText(st));
    const b = blockedNotice(null, st);
    add(b.title, b.description, b.action?.label);
  }
  // Sin plan asignado
  add(subscriptionHeader({ overview: { licensing: "capabilities", state: "none", plan: null, trial: null }, isAdmin: true, portalEnabled: false, conversionEnabled: false, hasPlans: true }).planName);

  // Planes
  for (const key of ["essential", "business", "enterprise"]) {
    const p = planPresentation({ key, tagline: null });
    add(p.audience, p.headline);
  }
  add(...Object.values(COMPARISON_GROUP_LABELS), ...Object.values(COMMERCIAL_LABELS), ...Object.values(PLAN_REQUEST_STATUS_LABEL), ...Object.values(PLAN_REQUEST_KIND_LABEL));
  add(planTaxLabel({ amountCents: 1, currency: "EUR", taxIncluded: true }), planTaxLabel({ amountCents: 1, currency: "EUR", taxIncluded: false }));
  const plans = parsePanelPlans([{ key: "essential", name: "Essential" }]);
  for (const state of ["trial", "trial_expired", "active", "read_only"])
    for (const c of buildPlanComparison({ plans, currentPlanKey: "essential", state, isAdmin: true, conversion: { enabled: true }, planChange: null })) add(c.currentLabel);

  // Alta
  EXTENSION_GROUPS.forEach((g) => add(g.title, g.intro));
  CHECKOUT_STEPS.forEach((s) => add(s.title, s.short));
  Object.values(validateBuyer({ ...EMPTY_BUYER, legalName: "x", taxId: "x", line1: "x", postalCode: "", city: "", country: "" })).forEach((e) => add(e));
  Object.values(validateBuyer({ legalName: "x".repeat(200), taxId: "x".repeat(50), line1: "x".repeat(300), postalCode: "x".repeat(20), city: "x".repeat(200), country: "ES" })).forEach((e) => add(e));
  Object.values(validateBuyer({ ...EMPTY_BUYER, legalName: "Empresa", taxId: "@@@@@", line1: "Calle 1", postalCode: "1", city: "A" })).forEach((e) => add(e));
  const item = (o: Record<string, unknown>) => ({ key: "k", name: "Módulo", kind: "module" as const, state: "available" as const, commercialStatus: "available" as const, plans: [], dependencies: [], prices: [{}], reasons: [], ...o });
  for (const e of checkoutExtensions(
    [
      item({ state: "active", legacy: {} }),
      item({ state: "available", checkoutVia: "conversion", plans: ["business"] }),
      item({ state: "available", checkoutVia: "conversion", plans: ["zzz"] }),
      item({ state: "available" }),
      item({ state: "not_eligible" }),
    ],
    "essential",
  ))
    add(e.note);

  // Escaparate
  add(...Object.values(CONNECT_STATE_LABELS), ...Object.values(CONNECT_STATE_SHORT), ...Object.values(PURCHASE_BLOCK_TEXT), TRIAL_CONVERSION_TEXT);
  CONNECT_CATEGORIES.forEach((c) => add(c.label));
  CONNECT_BRANDS.forEach((b) => add(b.title, b.subtitle));
  add(conversionSupportText("Módulo"), conversionPlanText("Módulo", "business"));
  const cc = applyConversionRequest({ plan: "business", modules: ["a", "b"] }, { offered: [{ key: "a", name: "Alfa" }], currentPlan: "essential" });
  cc.notes.forEach((n) => add(n));
  for (const consultation of consultations) for (const ro of [true, false]) add(lapsedLicenceText(ro, consultation));
  const ctx = (o: Record<string, unknown>) => ({ capabilityStatus: () => "none" as never, plan: "essential", productActive: () => false, ...o });
  const base = { kind: "module" as const, commercialStatus: "available" as const, capabilities: ["x"], dependencies: [], plans: [] as string[] };
  for (const st of ["suspended", "read_only", "expired", "pending_setup", "contracted", "active"])
    for (const other of ["active", "suspended"]) {
      let n = 0;
      add(...deriveConnectState({ ...base, capabilities: ["a", "b"] }, ctx({ capabilityStatus: () => (n++ % 2 ? other : st) }) as never).reasons);
    }
  for (const cs of ["in_preparation", "on_request", "available"] as const) {
    add(...deriveConnectState({ ...base, capabilities: [], commercialStatus: cs }, ctx({}) as never).reasons);
    add(...deriveConnectState({ ...base, capabilities: [], commercialStatus: cs, plans: ["business", "enterprise"] }, ctx({}) as never).reasons);
    add(...deriveConnectState({ ...base, capabilities: [], commercialStatus: cs, plans: ["business"] }, ctx({ plan: null }) as never).reasons);
    add(...deriveConnectState({ ...base, capabilities: [], commercialStatus: cs, dependencies: ["x", "y"] as never }, ctx({ productName: (k: string) => k }) as never).reasons);
  }
  add(...deriveConnectState({ ...base, capabilities: [] }, ctx({ pendingOrder: true }) as never).reasons);
  withPendingOrders([{ key: "a", state: "available" as const, reasons: [] as string[] }], new Set(["a"])).forEach((i) => add(...i.reasons));
  add(periodLabel("monthly"), periodLabel("yearly"), periodLabel("one_time"), periodLabel("setup"));
  add(taxLabel({ taxIncluded: true, taxRateBp: 2100 }), taxLabel({ taxIncluded: false, taxRateBp: 2100 }), taxLabel({ taxIncluded: false, taxRateBp: null }));
  Object.values(NET_SALE_LABEL).forEach((x) => add(x));
  Object.values(NET_SALE_STATE_LABEL).forEach((x) => add(x));
  const c = ASSISTED_CONTRACT_COPY;
  add(c.title("Net"), c.intro, ...c.steps, c.noPayment, c.availableTitle, c.inImplementationTitle, c.planLine("Essential"), c.planLine(null), c.priceLine("29 €", true), c.priceLine("29 €"), c.confirm, c.done);
  Object.values(ACTIVATION_LABELS).forEach((x) => add(x));
  add(CONTRACT_NOW_LABEL, VIEW_SHEET_LABEL);
  const act = (o: Partial<ConnectActivation>) => ({ state: "active", payment: "confirmed", renewal: "active", ...o }) as unknown as ConnectActivation;
  for (const a of [
    act({}),
    act({ payment: "overdue" }),
    act({ renewal: "cancelled", activeUntil: "2026-12-31T10:00:00Z", canReactivate: true }),
    act({ state: "suspended" }),
    act({ state: "processing", nextRetryAt: "2026-12-31T10:00:00Z" }),
    act({ state: "pending", payment: "failed" }),
    act({ state: "pending", payment: "expired" }),
    act({ state: "pending", payment: "pending" }),
    act({ state: "pending", payment: "confirmed" }),
    act({ state: "error", payment: "confirmed", error: { kind: "activation" }, retryable: true }),
    act({ state: "error", payment: "confirmed" }),
  ]) {
    add(activationLabel(a));
    const x = activationActions(a);
    add(x.nextRetry, x.reactivate?.label);
  }
  const pa = (state: string, o: Record<string, unknown> = {}) => primaryAction({ key: "k", state: state as never, kind: "module", purchasable: true, ...o } as never, { canPurchase: true, interestEnabled: true });
  for (const st of ["available", "active", "pending_setup", "on_request", "coming_soon", "incident", "not_eligible", "activating"]) {
    add(pa(st).label, pa(st, { openPath: "/x" }).label, pa(st, { assisted: {} }).label, pa(st, { checkoutVia: "conversion", conversionPlan: "essential" }).label, pa(st, { activation: { state: "error", retryable: true, error: { kind: "pay" } } }).label);
  }
  add(primaryAction({ key: "k", state: "available", kind: "quantity", purchasable: true } as never, { canPurchase: true, interestEnabled: false }).label);
  return out;
}

describe("textos de suscripción y escaparate en alemán", () => {
  it("todo texto que ofrecen los modelos tiene traducción alemana", () => {
    const missing = new Set<string>();
    for (const t of allTexts()) for (const m of panelTextMissing(t)) missing.add(m);
    expect([...missing].sort()).toEqual([]);
  });

  it("el español no se toca", () => {
    for (const t of allTexts()) expect(panelText(t, "es")).toBe(t);
  });

  it("las fechas salen en alemán y las plantillas conservan sus datos", () => {
    expect(panelText("hasta el 28 de noviembre de 2026", "de")).toBe("bis zum 28. November 2026");
    expect(panelText("Puedes consultar tu información en solo lectura hasta el 9 de diciembre de 2026 a las 11:00.", "de")).toContain("9. Dezember 2026 um 11:00 Uhr");
    expect(panelText("Te quedan 5 días", "de")).toBe("Noch 5 Tage");
    expect(panelText("Te queda 1 día", "de")).toBe("Noch 1 Tag");
    expect(panelText("29 € + IVA", "de")).toBe("29 € zzgl. MwSt.");
  });

  it("un texto desconocido (contenido del catálogo) se queda como está", () => {
    expect(panelText("Texto libre del catálogo publicado", "de")).toBe("Texto libre del catálogo publicado");
  });

  it("los textos traducidos no dejan marcadores sin sustituir", () => {
    for (const t of allTexts()) expect(panelText(t, "de")).not.toMatch(/\{date\}|\$\d|#TAX#|#PER#/);
  });
});
