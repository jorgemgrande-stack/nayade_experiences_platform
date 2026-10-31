/**
 * Recordatorios de «Primeros pasos» (onboarding.reminder): a los 3 días del primer acceso registrado, una sola vez,
 * idempotente por empresa (reserva persistida), nunca sin primer acceso, con los pasos reales y nunca si están hechos. El correo lleva los pasos pendientes y el enlace al panel de la empresa.
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
  it("a los 3 días del primer acceso, una sola vez (también tras reinicios: la reserva está persistida)", async () => {
    const c = company();
    expect(await runOnboardingReminders(T0 + DAY, c.deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 3 * DAY - 1, c.deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 3 * DAY, c.deps)).toBe(3);
    for (const d of [3.1, 4, 8, 15, 60]) expect(await runOnboardingReminders(T0 + d * DAY, c.deps)).toBeNull();
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:reminder:3"]);
    expect(sent[0]).toMatchObject({ to: who.email, category: "onboarding", subject: "Termina de configurar tu espacio de Big Elephant" });
    expect(sent[0].html).toContain("https://empresa-demo.app.bigelephant.example/admin/primeros-pasos");
  });

  it("pasada tardía (tarea parada): se envía una vez y no se repite", async () => {
    const c = company();
    expect(await runOnboardingReminders(T0 + 9 * DAY, c.deps)).toBe(3);
    expect(await runOnboardingReminders(T0 + 10 * DAY, c.deps)).toBeNull();
    expect(sent.map((s) => s.idempotencyKey)).toEqual(["onboarding:reminder:3"]);
    expect(Object.keys(c.state!.sent)).toEqual(["3"]);
  });

  it("comprueba los pasos reales antes de enviar: solo los pendientes y nada si están hechos", async () => {
    const c = company();
    let p = markStep(emptyProgress(), "company", "done", T0 + DAY);
    p = markStep(p, "activity", "skipped", T0 + DAY);
    c.setProgress(p);
    expect(await runOnboardingReminders(T0 + 3 * DAY, c.deps)).toBe(3);
    expect(sent[0].html).not.toContain(">Identidad de empresa<");
    expect(sent[0].html).toContain("CRM");
    expect(sent[0].html).toContain("Datos fiscales y comerciales");
    expect(sent[0].html).not.toContain("Bienvenida");
    // Asistente completado antes del día 3: no se envía nada
    const done = company();
    done.setProgress(markStep(p, "finish", "done", T0 + 2 * DAY));
    expect(await runOnboardingReminders(T0 + 3 * DAY, done.deps)).toBeNull();
    expect(done.state!.sent).toEqual({});
    expect(sent).toHaveLength(1);
  });

  it("nunca sin el primer acceso registrado, sin destinatario activo o sin correo enviado (se reintenta)", async () => {
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ firstAccessAt: null }).deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ userId: null }).deps)).toBeNull();
    expect(await runOnboardingReminders(T0 + 30 * DAY, company({ userId: 99 }).deps)).toBeNull();
    expect(sent).toHaveLength(0);
    const c = company();
    mailOk = false;
    expect(await runOnboardingReminders(T0 + 3 * DAY, c.deps)).toBeNull();
    expect(c.state!.sent).toEqual({});
    mailOk = true;
    expect(await runOnboardingReminders(T0 + 3 * DAY + 3600_000, c.deps)).toBe(3);
    expect(sent).toHaveLength(1);
  });

  it("hito debido (puro) y lectura tolerante del estado guardado", () => {
    const st = { firstAccessAt: T0, userId: 1, sent: {} };
    expect(dueReminder(null, emptyProgress(), T0 + 30 * DAY)).toBeNull();
    expect(dueReminder(st, emptyProgress(), T0 + 3 * DAY - 1)).toBeNull();
    expect(dueReminder(st, emptyProgress(), T0 + 3 * DAY)).toBe(3);
    expect(dueReminder({ ...st, sent: { "3": T0 } }, emptyProgress(), T0 + 7 * DAY)).toBeNull();
    expect(parseReminderState(null)).toBeNull();
    expect(parseReminderState("no-json")).toBeNull();
    expect(parseReminderState(JSON.stringify({ userId: 1 }))).toBeNull();
    expect(parseReminderState(JSON.stringify({ firstAccessAt: T0, userId: 3, sent: { "3": T0, "7": "x" } }))).toEqual({ firstAccessAt: T0, userId: 3, sent: { "3": T0 } });
  });
});
