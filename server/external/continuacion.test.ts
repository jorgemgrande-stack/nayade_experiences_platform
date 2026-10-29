/**
 * Continuación tras aceptar el contrato (incidencia NEXTAIR, 29/10/2026): enlace firmado propio en la página y por correo,
 * que solo abre la autorización del método de pago (Stripe modo setup, sin cargo), sin duplicar sesiones ni clientes.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { ExternalService, type PaymentSetupMail } from "./service";
import { MemoryExternalStore } from "./store";

const T = Date.UTC(2026, 9, 29, 14);
const DAY = 86_400_000;
const urls = { acceptance: "https://admin.example/cp/v1/public/contract-acceptance", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };
const signer = { name: "Laura Representante", email: "laura@nextair.example", role: "Administradora" };

async function setup(o: { ipSalt?: string | null; mail?: boolean } = {}) {
  let now = T;
  const crmStore = new MemoryCrmStore();
  const crm = new CrmService({ store: crmStore, now: () => now });
  const store = new MemoryExternalStore("test");
  const gw = new FakeStripeGateway();
  const sent: Array<{ to: string; key: string; i: PaymentSetupMail }> = [];
  const svc = new ExternalService({
    store, crm, crmStore, stripeStore: new MemoryStripeStore("test"), gateway: gw, mode: "test", namespace: "beta", urls,
    ipSalt: o.ipSalt === null ? undefined : (o.ipSalt ?? "sal-de-pruebas-larga-0123456789abcdef"),
    mail: o.mail === false ? undefined : { invite: async () => ({ status: "queued", reason: null, duplicate: false }), paymentSetup: async (to, key, i) => (sent.push({ to, key, i }), { status: "queued", reason: null, duplicate: false, id: sent.length }) },
    now: () => now,
  });
  const c = await crm.createCompany({ name: "Nextair", legalName: "Nextair SL" }, "operator:test");
  const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
  const req = await svc.requestAcceptance(x.id, signer, "operator:jorge");
  const accepted = await svc.accept(new URL(req.url).searchParams.get("token")!, { name: "Laura Representante", accept: true }, { ip: null, userAgent: null });
  return { svc, store, gw, x, sent, accepted, tick: (ms: number) => (now += ms) };
}
const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;

describe("continuación tras la aceptación", () => {
  it("la aceptación devuelve el enlace propio (no el token de aceptación) y lo envía al firmante, sin cargo", async () => {
    const { accepted, sent, store, x } = await setup();
    expect(accepted.continueUrl).toMatch(/^https:\/\/admin\.example\/cp\/v1\/public\/contract-acceptance\/autorizar\?t=\d+\.\d+\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "laura@nextair.example", i: { url: accepted.continueUrl, amountCents: 100_000, serviceName: "SkiNet", companyName: "Nextair SL" } });
    expect((await store.events(x.id)).find((e) => e.kind === "setup_link_email")?.detail).toMatchObject({ status: "queued", outboxId: 1 });
    expect((await store.get(x.id))!.status).toBe("awaiting_payment_method");
  });

  it("abrir el enlace crea UNA sesión de Stripe en modo setup; volver a abrirlo la reutiliza (sin duplicar cliente ni sesión)", async () => {
    const { svc, gw, accepted, x, store } = await setup();
    const a = await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!));
    const b = await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!));
    expect(a).toMatchObject({ kind: "redirect", url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\/c\/setup\//) });
    expect(b).toEqual(a);
    expect(gw.setupSessions.size).toBe(1);
    expect(gw.calls.filter((c) => c.op === "customers.create")).toHaveLength(1);
    // Ningún cobro: ni pagos ni suscripciones
    expect(gw.calls.some((c) => /payment|subscriptions\.create|invoices\.pay/.test(c.op))).toBe(false);
    expect((await store.events(x.id)).filter((e) => e.kind === "setup_session")).toHaveLength(1);
  });

  it("sesión de Stripe caducada: al abrir el enlace se crea otra de forma controlada", async () => {
    const { svc, gw, accepted, tick } = await setup();
    await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!));
    tick(24 * 3600_000);
    const again = await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!));
    expect(again.kind).toBe("redirect");
    expect(gw.setupSessions.size).toBe(2);
  });

  it("autorizado en Stripe y a la espera del webhook: no abre otra sesión; confirmado: «ya autorizado»", async () => {
    const { svc, gw, accepted, store, x } = await setup();
    await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!));
    const sid = (await store.get(x.id))!.stripeSetupSessionId!;
    gw.completeSetupSession(sid);
    expect(await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!))).toEqual({ kind: "done", status: "confirming" });
    expect(gw.setupSessions.size).toBe(1);
    const cur = (await store.get(x.id))!;
    await store.update(cur.id, cur.version, { status: "scheduled" }, T);
    expect(await svc.continuePaymentSetup(tokenOf(accepted.continueUrl!))).toEqual({ kind: "done", status: "scheduled" });
  });

  it("enlace manipulado, de otra aceptación o caducado: rechazado sin tocar Stripe", async () => {
    const { svc, gw, accepted, tick } = await setup();
    const t = tokenOf(accepted.continueUrl!);
    const [id, acc, exp, sig] = t.split(".");
    await expect(svc.continuePaymentSetup(`${id}.${acc}.${Number(exp) + 1}.${sig}`)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.continuePaymentSetup(`${id}.${Number(acc) + 1}.${exp}.${sig}`)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.continuePaymentSetup("cualquier-cosa")).rejects.toMatchObject({ code: "not_found" });
    tick(31 * DAY);
    await expect(svc.continuePaymentSetup(t)).rejects.toMatchObject({ code: "invalid_state", message: expect.stringMatching(/caducado/) });
    expect(gw.setupSessions.size).toBe(0);
  });

  it("operador: copiar el enlace vigente o reenviarlo (otro correo con otra clave, sin crear sesiones); queda en el historial", async () => {
    const { svc, sent, store, x, gw } = await setup();
    const copy = await svc.setupLink(x.id, "operator:jorge");
    expect(copy.mail).toBeNull();
    expect(copy.url).toMatch(/\/autorizar\?t=/);
    const resend = await svc.setupLink(x.id, "operator:jorge", { send: true });
    expect(resend.mail).toMatchObject({ status: "queued" });
    expect(sent.map((s) => s.key)).toEqual([expect.stringMatching(/:1$/), expect.stringMatching(/:2$/)]);
    const kinds = (await store.events(x.id)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["setup_link_issued", "setup_link_email"]));
    expect(gw.setupSessions.size).toBe(0);
  });

  it("sin clave para firmar (CP_PUBLIC_FORM_SECRET) o sin correo: la aceptación sigue registrándose y se avisa del motivo", async () => {
    const noKey = await setup({ ipSalt: null });
    expect(noKey.accepted.accepted).toBe(true);
    expect(noKey.accepted.continueUrl).toBeNull();
    await expect(noKey.svc.setupLink(noKey.x.id, "operator:jorge")).rejects.toMatchObject({ code: "unavailable" });
    const noMail = await setup({ mail: false });
    expect((await noMail.store.events(noMail.x.id)).find((e) => e.kind === "setup_link_email")?.detail).toMatchObject({ status: "unavailable" });
  });
});
