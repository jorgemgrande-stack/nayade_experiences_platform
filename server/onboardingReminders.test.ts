/**
 * Recordatorios de «Primeros pasos» (onboarding.reminder): a los 2 y 7 días del primer acceso registrado, máximo dos,
 * idempotentes por empresa e hito, solo el más reciente con una pasada tardía, nunca sin primer acceso y se detienen al
 * completar el asistente. El correo lleva los pasos pendientes y el enlace al panel de la empresa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; subject: string; category?: string; idempotencyKey?: string; html: string }> = [];
let mailOk = true;
vi.mock("./mailer", () => ({ sendEmail: vi.fn(async (p: { to: string; subject: string; category?: string; idempotencyKey?: string; html: string }) => (mailOk ? (sent.push(p), true) : false)) }));
vi.mock("./_core/publicUrl", () => ({ getTrustedBaseUrl: () => "https://empresa-demo.app.bigelephant.example" }));

import { dueReminder, runOnboardingReminders, type ReminderDeps } from "./onboardingReminders";
import { onboardingReminder } from "./onboardingNotices";
import { parseReminderState, type OnboardingReminderState } from "./setupWizardDb";
import { emptyProgress, markStep, type SetupProgress } from "../shared/setupWizard";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9);
const who = { email: "ana@empresa-demo.example", name: "Ana Demo" };

/** Empresa en memoria con la misma semántica de reserva que la BD (fila bloqueada). */
function company(o: { firstAccessAt?: number | null; userId?: number | null; progress?: SetupProgress } = {}) {
  let state: OnboardingReminderState | null = o.firstAccessAt === null ? null : { firstAccessAt: o.firstAccessAt ?? T0, userId: o.userId === undefined ? 1 : o.userId, sent: {} };
  let progress = o.progress ?? emptyProgress();
  const deps: ReminderDeps = {
    readState: async () => (state ? structuredClone(state) : null),
    readProgress: async () => progress,
    contact: async (id) => (id === 1 ? who : null),
    claim: async (days, earlier, now) => {
      if (!state || state.sent[String(days)] !== undefined) return false;
      state.sent[String(days)] = now;
      for (const d of earlier) state.sent[String(d)] ??= now;
      return true;
    },
    release: async (days, earlier, at) => {
      for (const d of [days, ...earlier]) if (state?.sent[String(d)] === at) delete state.sent[String(d)];
    },
    send: onboardingReminder,
  };
  return { deps, get state() { return state; }, setProgress: (p: SetupProgress) => void (progress = p) };
}

beforeEach(() => {
  sent.length = 0;
  mailOk = true;
});

describe("recordatorios de primeros pasos", () => {
  it("a los 2 y a los 7 días del primer acceso, una sola vez cada uno (máximo dos)", async () => {
    const c = company();
    expect(await runOnboardingReminders(T0 + DAY, c.deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 2 * DAY, c.deps)).toBe(2);
    expect(await runOnboardingReminders(T0 + 2 * DAY + 3600_000, c.deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 6 * DAY, c.deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 7 * DAY, c.deps)).toBe(7);
    for (const d of [8, 15, 60]) expect(await runOnboardingReminders(T0 + d * DAY, c.deps)).toBeNull();
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:reminder:2", "onboarding:reminder:7"]);
    expect(sent[0]).toMatchObject({ to: who.email, category: "onboarding", subject: "Termina de configurar tu espacio de Big Elephant" });
    expect(sent[0].html).toContain("https://empresa-demo.app.bigelephant.example/admin/primeros-pasos");
  });

  it("pasada tardía (tarea parada): solo el hito más reciente; el anterior queda cubierto y no se envía después", async () => {
    const c = company();
    expect(await runOnboardingReminders(T0 + 9 * DAY, c.deps)).toBe(7);
    expect(await runOnboardingReminders(T0 + 10 * DAY, c.deps)).toBeNull();
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:reminder:7"]);
    expect(Object.keys(c.state!.sent).sort()).toEqual(["2", "7"]);
  });

  it("se detienen al completar el asistente; llevan solo los pasos pendientes", async () => {
    const c = company();
    let p = markStep(emptyProgress(), "company", "done", T0 + DAY);
    p = markStep(p, "activity", "skipped", T0 + DAY);
    c.setProgress(p);
    expect(await runOnboardingReminders(T0 + 2 * DAY, c.deps)).toBe(2);
    expect(sent[0].html).not.toContain(">Empresa<");
    expect(sent[0].html).toContain("Primer cliente");
    c.setProgress(markStep(p, "finish", "done", T0 + 3 * DAY));
    expect(await runOnboardingReminders(T0 + 7 * DAY, c.deps)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("nunca sin el primer acceso registrado, sin destinatario activo o sin correo enviado (se reintenta)", async () => {
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ firstAccessAt: null }).deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ userId: null }).deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ userId: 99 }).deps)).toBeNull();
    expect(sent).toHaveLength(0);
    const c = company();
    mailOk = false;
    expect(await runOnboardingReminders(T0 + 2 * DAY, c.deps)).toBeNull();
    expect(c.state!.sent).toEqual({});
    mailOk = true;
    expect(await runOnboardingReminders(T0 + 2 * DAY + 3600_000, c.deps)).toBe(2);
    expect(sent).toHaveLength(1);
  });

  it("hito debido (puro) y lectura tolerante del estado guardado", () => {
    const st = { firstAccessAt: T0, userId: 1, sent: {} };
    expect(dueReminder(null, emptyProgress(), T0 + 30 * DAY)).toBeNull();
    expect(dueReminder(st, emptyProgress(), T0 + 2 * DAY - 1)).toBeNull();
    expect(dueReminder(st, emptyProgress(), T0 + 2 * DAY)).toBe(2);
    expect(dueReminder({ ...st, sent: { "2": T0 } }, emptyProgress(), T0 + 3 * DAY)).toBeNull();
    expect(dueReminder({ ...st, sent: { "2": T0 } }, emptyProgress(), T0 + 7 * DAY)).toBe(7);
    expect(parseReminderState(null)).toBeNull();
    expect(parseReminderState("no-json")).toBeNull();
    expect(parseReminderState(JSON.stringify({ userId: 1 }))).toBeNull();
    expect(parseReminderState(JSON.stringify({ firstAccessAt: T0, userId: 3, sent: { "2": T0, "7": "x" } }))).toEqual({ firstAccessAt: T0, userId: 3, sent: { "2": T0 } });
  });
});
