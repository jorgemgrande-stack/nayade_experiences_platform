/** Avisos de «Primeros pasos»: primer acceso y progreso, una sola vez, solo con URL pública y destinatario. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; subject: string; category?: string; idempotencyKey?: string; html: string }> = [];
let base = "https://empresa-demo.app.bigelephant.example";
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async (p: { to: string; subject: string; category?: string; idempotencyKey?: string; html: string }) => (sent.push(p), true)) }));
vi.mock("./_core/publicUrl", () => ({ getTrustedBaseUrl: () => base }));

import { onboardingFirstAccess, onboardingProgressed } from "./onboardingNotices";
import { buildSetupPlan, configurationSteps, emptyProgress, markStep, type SetupFacts, type SetupProgress } from "../shared/setupWizard";
import { capabilitiesOfTier } from "./catalog/capabilities";

const who = { email: "ana@empresa-demo.example", name: "Ana Demo" };
const steps = (n: number): SetupProgress => {
  let p = emptyProgress();
  for (const s of (["company", "fiscal", "brand", "activity", "client", "product", "web"] as const).slice(0, n)) p = markStep(p, s, "done", 1);
  return p;
};

// Recorrido real de una empresa Essential (el mismo que ve el asistente): los pasos se completan con datos
const ESSENTIAL = new Set(capabilitiesOfTier("essential"));
const NO_FACTS: SetupFacts = { identity: false, fiscal: false, brand: false, activity: false, clients: 0, products: 0, sales: 0, documents: 0, webEdited: false, comms: false };
const FILLS: Array<Partial<SetupFacts>> = [{ identity: true }, { fiscal: true }, { brand: true }, { activity: true }, { clients: 1 }, { products: 1 }, { webEdited: true }];
const plan = (n: number) => buildSetupPlan({ progress: emptyProgress(), activity: n >= 4 ? "servicios" : null, capabilities: ESSENTIAL, facts: Object.assign({ ...NO_FACTS }, ...FILLS.slice(0, n)) });

beforeEach(() => {
  sent.length = 0;
  base = "https://empresa-demo.app.bigelephant.example";
});

describe("avisos de primeros pasos", () => {
  it("primer acceso: guía con enlace al panel de la empresa; nunca después de empezar", async () => {
    expect(await onboardingFirstAccess(emptyProgress(), who)).toBe(true);
    expect(sent[0]).toMatchObject({ to: who.email, category: "onboarding", idempotencyKey: "onboarding:steps", subject: "Tus primeros pasos en Big Elephant" });
    expect(sent[0].html).toContain("https://empresa-demo.app.bigelephant.example/admin/primeros-pasos");
    expect(await onboardingFirstAccess(steps(1), who)).toBe(false);
    expect(await onboardingFirstAccess(emptyProgress(), { email: null, name: null })).toBe(false);
    expect(sent).toHaveLength(1);
  });
  it("progreso: solo al cruzar la mitad y sin haber terminado", async () => {
    expect(await onboardingProgressed(plan(3), plan(4), who)).toBe(false);
    expect(await onboardingProgressed(plan(4), plan(5), who)).toBe(true);
    expect(await onboardingProgressed(plan(5), plan(6), who)).toBe(false);
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:progress:50"]);
    // El mismo total que el asistente («10 pasos en orden»)
    expect(configurationSteps(plan(5).steps)).toHaveLength(10);
    expect(sent[0].subject).toBe("Tu configuración va por buen camino: 5 de 10 pasos");
  });
  it("sin URL pública válida no se envía (los enlaces no tendrían destino)", async () => {
    base = "no es una url";
    expect(await onboardingFirstAccess(emptyProgress(), who)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
