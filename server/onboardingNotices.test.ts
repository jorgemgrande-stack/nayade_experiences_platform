/** Avisos de «Primeros pasos»: primer acceso y progreso, una sola vez, solo con URL pública y destinatario. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; subject: string; category?: string; idempotencyKey?: string; html: string }> = [];
let base = "https://empresa-demo.app.bigelephant.example";
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async (p: { to: string; subject: string; category?: string; idempotencyKey?: string; html: string }) => (sent.push(p), true)) }));
vi.mock("./_core/publicUrl", () => ({ getTrustedBaseUrl: () => base }));

import { onboardingFirstAccess, onboardingProgressed } from "./onboardingNotices";
import { emptyProgress, markStep, type SetupProgress } from "../shared/setupWizard";

const who = { email: "ana@empresa-demo.example", name: "Ana Demo" };
const steps = (n: number): SetupProgress => {
  let p = emptyProgress();
  for (const s of (["company", "activity", "brand", "client", "product", "operation", "users"] as const).slice(0, n)) p = markStep(p, s, "done", 1);
  return p;
};

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
    expect(await onboardingProgressed(steps(2), steps(3), who)).toBe(false);
    expect(await onboardingProgressed(steps(3), steps(4), who)).toBe(true);
    expect(await onboardingProgressed(steps(4), steps(5), who)).toBe(false);
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:progress:50"]);
    expect(sent[0].subject).toBe("Tu configuración va por buen camino: 4 de 8 pasos");
  });
  it("sin URL pública válida no se envía (los enlaces no tendrían destino)", async () => {
    base = "no es una url";
    expect(await onboardingFirstAccess(emptyProgress(), who)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
