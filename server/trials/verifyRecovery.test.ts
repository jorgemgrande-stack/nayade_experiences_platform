/**
 * Enlace de verificación de la prueba gratuita (incidencia del 13/11/2026: la activación tardó 23 s, el navegador
 * cortó la petición a los 15 s y el reintento con el mismo enlace dijo «no válido» aunque el correo ya estaba
 * confirmado). Casos: válido, activación lenta, ya usado, caducado y renovado desde el propio enlace, reenvío sin
 * duplicados, enlace falso o ajeno, y escáner de correo (una visita no consume nada). Datos sintéticos.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryTrialStore } from "./store";
import { TrialService } from "./service";
import { TrialOnboardingService } from "./onboarding";
import { createPublicTrialRouter } from "./api";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 13, 11, 0);

function harness(o: { provisionMs?: number } = {}) {
  let clock = T0;
  const store = new MemoryTrialStore();
  const trials = new TrialService({ store, now: () => clock });
  const links: Array<{ to: string; trialId: number; token: string; resend?: boolean }> = [];
  const welcomes: string[] = [];
  let provisions = 0;
  const ob = new TrialOnboardingService({
    trials,
    now: () => clock,
    platformDomain: "app.example",
    notify: {
      verification: async (to: string, p: { trialId: number; token: string; resend?: boolean }) => void links.push({ to, ...p }),
      welcome: async (to: string) => void welcomes.push(to),
      expiryNotice: async () => undefined,
    },
    provision: async (req: { tenantId: string }) => {
      provisions++;
      if (o.provisionMs) await new Promise((r) => setTimeout(r, o.provisionMs));
      return { status: "completed", tenantId: req.tenantId, domain: `${req.tenantId}.app.example`, adminInviteToken: "inv" };
    },
    priceOf: async () => 7,
    companies: { byTenant: async () => null, create: async (i: { name: string; tenantId: string }) => ({ id: 1, name: i.name, tenantId: i.tenantId }) },
    subscriptions: { list: async () => [], create: async () => ({ id: 1, status: "trialing" }) },
    licensing: { apply: async () => ({ applied: [], desired: [] }) },
  } as unknown as ConstructorParameters<typeof TrialOnboardingService>[0]);
  return { store, trials, ob, links, welcomes, provisions: () => provisions, tick: (ms: number) => void (clock += ms) };
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function serve(ob: TrialOnboardingService, verifyWaitMs?: number) {
  const app = express();
  app.use(express.json());
  app.use("/trial", createPublicTrialRouter({ onboarding: ob, autoProvision: true, ...(verifyWaitMs !== undefined ? { verifyWaitMs } : {}) }));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/trial`;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  };
  return { base, post };
}

const form = (email: string) => ({ email, companyName: "Bienestar Demo", idempotencyKey: `idem-${email.replace(/[^A-Za-z0-9]/g, "-")}`.padEnd(20, "0") });
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("enlace de verificación de la prueba gratuita", () => {
  it("válido: verifica y activa; el mismo enlace abierto otra vez dice «ya confirmado» (no «no válido») y no repite nada", async () => {
    const h = harness();
    await h.ob.register(form("ana@bienestar.example"));
    const link = h.links[0];
    const { post } = await serve(h.ob);
    const first = await post("/verify", { id: link.trialId, token: link.token });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "active", activationPending: false });
    const again = await post("/verify", { id: link.trialId, token: link.token });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: "active", alreadyVerified: true, activationPending: false, domain: expect.stringContaining(".app.example") });
    expect(h.provisions()).toBe(1);
    expect(h.welcomes).toEqual(["ana@bienestar.example"]);
  });

  it("activación lenta: se responde «en preparación» sin hacer esperar y la plataforma se activa igual en segundo plano", async () => {
    const h = harness({ provisionMs: 400 });
    await h.ob.register(form("lenta@bienestar.example"));
    const link = h.links[0];
    const { post } = await serve(h.ob, 50);
    const started = Date.now();
    const r = await post("/verify", { id: link.trialId, token: link.token });
    expect(Date.now() - started).toBeLessThan(350);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ activationPending: true });
    // Reintento mientras tanto (corte de red, otra pestaña): confirmado, nunca «no válido»
    const retry = await post("/verify", { id: link.trialId, token: link.token });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ alreadyVerified: true });
    await new Promise((res) => setTimeout(res, 600));
    expect((await h.trials.must(link.trialId)).state).toBe("active");
    expect(h.provisions()).toBe(1);
  });

  it("caducado: 403 renovable para su dueño; el enlace nuevo llega SOLO al correo registrado, sin otra solicitud", async () => {
    const h = harness();
    const reg = await h.ob.register(form("eva@bienestar.example"));
    const old = h.links[0];
    h.tick(2 * DAY);
    const { post } = await serve(h.ob);
    const expired = await post("/verify", { id: old.trialId, token: old.token });
    expect(expired.status).toBe(403);
    expect(expired.body).toMatchObject({ error: "invalid_link", renewable: true });
    const renew = await post("/renew", { id: old.trialId, token: old.token });
    expect(renew.status).toBe(202);
    await flush();
    expect(h.links).toHaveLength(2);
    const fresh = h.links[1];
    expect(fresh).toMatchObject({ to: "eva@bienestar.example", trialId: reg.trialId, resend: true });
    // El anterior deja de valer y renovarlo de nuevo no hace nada (ya no es el enlace vigente)
    expect((await post("/verify", { id: old.trialId, token: old.token })).status).toBe(403);
    h.tick(5 * 60_000);
    await post("/renew", { id: old.trialId, token: old.token });
    await flush();
    expect(h.links).toHaveLength(2);
    expect((await post("/verify", { id: fresh.trialId, token: fresh.token })).body).toMatchObject({ state: "active" });
    expect((await h.store.list({})).length).toBe(1);
  });

  it("reenvío: espera mínima entre envíos (dos clics ⇒ un solo enlace nuevo) y respuesta idéntica exista o no la solicitud", async () => {
    const h = harness();
    await h.ob.register(form("rep@bienestar.example"));
    const link = h.links[0];
    h.tick(DAY + 1);
    const { post } = await serve(h.ob);
    const a = await post("/renew", { id: link.trialId, token: link.token });
    const b = await post("/renew", { id: link.trialId, token: link.token });
    const ghost = await post("/renew", { id: 999, token: "x".repeat(43) });
    const byEmail = await post("/resend", { email: "nadie@bienestar.example" });
    await flush();
    expect(h.links).toHaveLength(2);
    expect([a.body, b.body, ghost.body, byEmail.body]).toEqual([a.body, a.body, a.body, a.body]);
    expect([a.status, ghost.status, byEmail.status]).toEqual([202, 202, 202]);
    // Volver a registrarse con el enlace caducado no crea otra solicitud
    await expect(h.ob.register({ ...form("rep@bienestar.example"), idempotencyKey: "idem-otra-vez-00000001" })).rejects.toMatchObject({ code: "conflict" });
    expect((await h.store.list({})).length).toBe(1);
  });

  it("alta repetida sin verificar (enlace caducado o alias del mismo buzón): misma solicitud, datos del alta nueva y enlace nuevo al correo registrado", async () => {
    const h = harness();
    await h.ob.register({ ...form("ana.ruiz@gmail.com"), companyName: "Datos Antiguos", profile: { fullName: "Otra Persona", country: "ES", termsAccepted: true, termsVersion: "2026-10-21", marketingConsent: true } });
    const first = h.links[0];
    h.tick(2 * DAY);
    const again = await h.ob.register({ ...form("anaruiz@gmail.com"), companyName: "Bienestar Ana", profile: { fullName: "Ana Ruiz", country: "ES", termsAccepted: true, termsVersion: "2026-10-21", marketingConsent: false } });
    expect(again).toMatchObject({ trialId: first.trialId, created: false });
    expect(h.links).toHaveLength(2);
    expect(h.links[1]).toMatchObject({ to: "ana.ruiz@gmail.com", trialId: first.trialId, resend: true });
    const t = await h.trials.must(first.trialId);
    expect(t.companyName).toBe("Bienestar Ana");
    expect(t.configuration.profile).toMatchObject({ fullName: "Ana Ruiz", marketingConsent: false });
    expect((await h.store.list({})).length).toBe(1);
  });

  it("enlace falso o de otra solicitud: 403 sin pistas (ni «renovable» ni «ya confirmado») y no envía nada", async () => {
    const h = harness();
    await h.ob.register(form("uno@bienestar.example"));
    await h.ob.register(form("dos@bienestar.example"));
    const [one, two] = h.links;
    const { post } = await serve(h.ob);
    await post("/verify", { id: one.trialId, token: one.token });
    for (const body of [{ id: two.trialId, token: one.token }, { id: one.trialId, token: two.token }, { id: 999, token: one.token }]) {
      const r = await post("/verify", body);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: "invalid_link", message: "El enlace no es válido o ha caducado" });
    }
    h.tick(2 * DAY);
    await post("/renew", { id: two.trialId, token: one.token });
    await flush();
    expect(h.links).toHaveLength(2);
    expect((await h.trials.must(two.trialId)).state).toBe("pending_verification");
  });

  it("escáner de correo: abrir la dirección con GET o HEAD no verifica ni consume el enlace", async () => {
    const h = harness();
    await h.ob.register(form("scan@bienestar.example"));
    const link = h.links[0];
    const { base, post } = await serve(h.ob);
    for (const method of ["GET", "HEAD"]) {
      const r = await fetch(`${base}/verify?id=${link.trialId}&token=${encodeURIComponent(link.token)}`, { method });
      expect(r.status).toBe(404);
    }
    expect((await h.trials.must(link.trialId)).state).toBe("pending_verification");
    expect((await post("/verify", { id: link.trialId, token: link.token })).body).toMatchObject({ state: "active" });
  });
});
