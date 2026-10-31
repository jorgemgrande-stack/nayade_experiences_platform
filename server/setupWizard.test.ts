/**
 * «Primeros pasos» y límite de usuarios del plan: reglas puras (progreso, validación de la empresa,
 * plan deducido de las licencias y plazas de usuario).
 */
import { describe, it, expect } from "vitest";
import {
  SETUP_STEPS,
  COMPANY_SETTING_KEYS,
  companySchema,
  emptyProgress,
  markStep,
  nextPendingStep,
  parseProgress,
  progressPercent,
  SetupWizardError,
  shouldOpenSetupWizard,
} from "../shared/setupWizard";
import { includedUsers, licenceSummary, seatDecision } from "./planSeats";
import type { CapabilityGrant } from "./_core/capabilities/model";
import { capabilitiesOfTier } from "./catalog/capabilities";
import { trialTenantId } from "./trials/onboarding";
import { TENANT_ID_RE } from "./_core/provisioning/types";

const NOW = Date.UTC(2026, 9, 16, 9);
const DAY = 86_400_000;
const grant = (capabilityId: string, o: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  tenantId: "t1-acme",
  capabilityId,
  siteId: "",
  status: "active",
  validUntil: null,
  source: "subscription:1",
  updatedAt: NOW,
  updatedBy: "test",
  ...o,
});
const tier = (t: "essential" | "business" | "enterprise", o: Partial<CapabilityGrant> = {}) => capabilitiesOfTier(t).map((c) => grant(c, o));

describe("primera entrada: llevar a Primeros pasos", () => {
  it("solo si nadie ha tocado el asistente y no está terminado", () => {
    expect(shouldOpenSetupWizard(emptyProgress())).toBe(true);
    expect(shouldOpenSetupWizard({ completedAt: null, updatedAt: 1 })).toBe(false);
    expect(shouldOpenSetupWizard({ completedAt: 2, updatedAt: 2 })).toBe(false);
    expect(shouldOpenSetupWizard(null)).toBe(false);
    expect(shouldOpenSetupWizard(undefined)).toBe(false);
  });
});

describe("progreso del asistente", () => {
  it("empieza vacío, avanza por pasos, se pueden omitir y finalizar deja fecha", () => {
    let p = emptyProgress();
    expect(nextPendingStep(p)).toBe("welcome");
    expect(progressPercent(p)).toBe(0);
    p = markStep(p, "welcome", "done", NOW);
    p = markStep(p, "company", "done", NOW);
    p = markStep(p, "activity", "skipped", NOW + 1);
    expect(nextPendingStep(p)).toBe("fiscal");
    expect(p.steps.activity).toEqual({ status: "skipped", at: NOW + 1 });
    for (const s of SETUP_STEPS) if (p.steps[s].status === "pending" && s !== "finish") p = markStep(p, s, "skipped", NOW + 2);
    expect(nextPendingStep(p)).toBe("finish");
    expect(p.completedAt).toBeNull();
    p = markStep(p, "finish", "done", NOW + 3);
    expect(p.completedAt).toBe(NOW + 3);
    expect(nextPendingStep(p)).toBeNull();
    expect(progressPercent(p)).toBe(100);
    // Rehacer un paso no cambia la fecha de finalización
    expect(markStep(p, "client", "done", NOW + 9).completedAt).toBe(NOW + 3);
  });

  it("el último paso no se puede omitir", () => {
    expect(() => markStep(emptyProgress(), "finish", "skipped", NOW)).toThrow(SetupWizardError);
  });

  it("el progreso guardado se lee de forma tolerante (ilegible o ajeno → inicio)", () => {
    const p = markStep(emptyProgress(), "client", "done", NOW);
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    expect(parseProgress("no-es-json")).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 2, steps: {} }))).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 1, steps: { client: { status: "hackeado" }, otro: { status: "done" } } }))).toEqual(emptyProgress());
    expect(parseProgress(null)).toEqual(emptyProgress());
  });
});

describe("datos de la empresa", () => {
  const ok = { tradeName: "Hotel Sol", legalName: "Hotel Sol, S.L.", taxId: "b12345678", address: "Calle Mayor 1", country: "ES", currency: "EUR", timezone: "Europe/Madrid" };
  it("acepta datos válidos y normaliza el NIF", () => {
    const r = companySchema.parse(ok);
    expect(r.taxId).toBe("B12345678");
    expect(r.postalCode).toBe("");
  });
  it("rechaza con mensajes en español", () => {
    const r = companySchema.safeParse({ ...ok, tradeName: "", taxId: "1", country: "XX", currency: "BTC", timezone: "Marte/Olympus" });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(["Indica el nombre comercial (mínimo 2 caracteres)", "El NIF debe tener entre 5 y 20 letras o números", "Elige un país de la lista", "Elige una moneda de la lista", "Elige una zona horaria de la lista"]));
  });
  it("contacto público opcional: vacío por defecto, email validado, guardado en los ajustes que lee la web", () => {
    const r = companySchema.parse(ok);
    expect([r.publicPhone, r.publicEmail, r.publicLocation]).toEqual(["", "", ""]);
    expect(companySchema.parse({ ...ok, publicEmail: " hola@hotelsol.es ", publicPhone: "+34 600 000 000" }).publicEmail).toBe("hola@hotelsol.es");
    const bad = companySchema.safeParse({ ...ok, publicEmail: "no-es-un-email" });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.message)).toContain("Indica un email válido");
    expect([COMPANY_SETTING_KEYS.publicPhone, COMPANY_SETTING_KEYS.publicEmail, COMPANY_SETTING_KEYS.publicLocation]).toEqual(["brand_phone", "site_business_email", "brand_location"]);
  });
});

describe("plan, prueba y plazas de usuario", () => {
  it("usuarios incluidos según el catálogo oficial", () => {
    expect(includedUsers("essential")).toBe(3);
    expect(includedUsers("business")).toBe(15);
    expect(includedUsers("enterprise")).toBeNull();
  });

  it("sin licencias (instalación anterior o modo single): sin plan ni límite", () => {
    expect(licenceSummary(null, NOW)).toMatchObject({ plan: null, userLimit: null, readOnly: false });
    expect(licenceSummary([], NOW).plan).toBeNull();
    expect(seatDecision({ plan: null, userLimit: null }, 999)).toEqual({ allowed: true });
  });

  it("prueba Essential: plan, días restantes y solo lectura al vencer", () => {
    const g = tier("essential", { validUntil: NOW + 15 * DAY });
    expect(licenceSummary(g, NOW)).toEqual({ plan: "essential", userLimit: 3, endsAt: NOW + 15 * DAY, daysLeft: 15, readOnly: false });
    expect(licenceSummary(g, NOW + 14.5 * DAY)).toMatchObject({ daysLeft: 1, readOnly: false });
    expect(licenceSummary(g, NOW + 15 * DAY)).toMatchObject({ daysLeft: 0, readOnly: true });
    expect(licenceSummary(tier("essential", { status: "read_only" }), NOW).readOnly).toBe(true);
  });

  it("Business y Enterprise por sus capacidades propias; los extras no cambian el plan", () => {
    expect(licenceSummary([...tier("essential"), ...tier("business")], NOW)).toMatchObject({ plan: "business", userLimit: 15, endsAt: null });
    expect(licenceSummary([...tier("essential"), ...tier("business"), ...tier("enterprise")], NOW)).toMatchObject({ plan: "enterprise", userLimit: null });
    expect(licenceSummary([...tier("essential"), grant("people-hr")], NOW).plan).toBe("essential");
    // Una licencia cancelada no cuenta para el plan
    expect(licenceSummary([...tier("essential"), grant("roles-custom", { status: "cancelled" })], NOW).plan).toBe("essential");
  });

  it("límite de usuarios: cabe hasta el máximo, no uno más", () => {
    const s = { plan: "essential" as const, userLimit: 3 };
    expect(seatDecision(s, 2)).toEqual({ allowed: true });
    const no = seatDecision(s, 3);
    expect(no.allowed).toBe(false);
    expect(!no.allowed && no.reason).toMatch(/Essential incluye 3 usuarios y ya tienes 3/);
    expect(seatDecision(s, 1, 3).allowed).toBe(false);
  });
});

describe("identificador de plataforma de la prueba", () => {
  it("siempre válido para el aprovisionamiento, también con nombres largos o sin letras", () => {
    for (const [id, name] of [
      [1, "Hotel Sol, S.L."],
      [123456, "Asociación de Empresarios de Hostelería y Turismo de la Comarca del Alto Aragón"],
      [7, "!!!"],
      [99, "Ñandú & Cía."],
    ] as const) {
      const t = trialTenantId(id, name);
      expect(t).toMatch(TENANT_ID_RE);
      expect(t.startsWith(`t${id}-`)).toBe(true);
    }
    expect(trialTenantId(1, "Hotel Sol, S.L.")).toBe("t1-hotel-sol-s-l");
    expect(trialTenantId(7, "!!!")).toBe("t7-empresa");
  });
});
