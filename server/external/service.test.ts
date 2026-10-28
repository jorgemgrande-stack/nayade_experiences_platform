/**
 * Reglas del servicio de clientes externos que no necesitan la aplicación completa: cobros reales bloqueados sin el
 * interruptor y calendario del día 1 en Europe/Madrid.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "../crm/service";
import { MemoryCrmStore } from "../crm/store";
import { MemoryStripeStore } from "../stripe/store";
import { FakeStripeGateway } from "../stripe/testing";
import { ExternalService } from "./service";
import { MemoryExternalStore } from "./store";
import { chargeInstant, graceEnd, localDate, nextChargeAfter } from "./schedule";

const T = Date.UTC(2026, 9, 27, 9);
const urls = { acceptance: "https://admin.example/a", setupSuccess: "https://admin.example/ok", setupCancel: "https://admin.example/ko", portalReturn: "https://admin.example" };

describe("servicios externos: reglas", () => {
  it("en live, sin CP_EXTERNAL_LIVE_ENABLED, nunca se abre la autorización del método de pago", async () => {
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore, now: () => T });
    const store = new MemoryExternalStore("live");
    const gw = new FakeStripeGateway();
    const svc = new ExternalService({ store, crm, crmStore, stripeStore: new MemoryStripeStore("live"), gateway: gw, mode: "live", namespace: "live", urls, now: () => T });
    const c = await crm.createCompany({ name: "Cliente Real SL" }, "operator:test");
    const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
    await store.update(x.id, x.version, { status: "awaiting_payment_method" }, T);
    await expect(svc.paymentSetup(x.id, "operator:test")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/CP_EXTERNAL_LIVE_ENABLED/) });
    expect(gw.calls.filter((k) => k.op.startsWith("checkout.sessions.create"))).toHaveLength(0);
  });

  it("calendario: día 1 a las 08:00 de Madrid en invierno y verano; margen hasta el día 5 a las 23:59:59", () => {
    expect(new Date(chargeInstant("2026-11-01", 8, "Europe/Madrid")).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(new Date(chargeInstant("2027-07-01", 8, "Europe/Madrid")).toISOString()).toBe("2027-07-01T06:00:00.000Z");
    // El día de cambio de hora (último domingo de marzo) y meses de 28, 30 y 31 días
    for (const d of ["2027-02-01", "2027-03-01", "2027-04-01", "2027-11-01"]) expect(localDate(chargeInstant(d, 8, "Europe/Madrid"), "UTC").day).toBe(1);
    expect(new Date(graceEnd(chargeInstant("2027-01-01", 8, "Europe/Madrid"), 5, "Europe/Madrid")).toISOString()).toBe("2027-01-05T22:59:59.000Z");
    expect(new Date(nextChargeAfter(chargeInstant("2026-11-01", 8, "Europe/Madrid"), 1, 8, "Europe/Madrid")).toISOString()).toBe("2026-12-01T07:00:00.000Z");
  });
});

describe("dominio público del CRM para la aceptación", () => {
  it("toma el primer origen https de CP_ALLOWED_ORIGINS aunque lleve barra o espacios; si no, el del entorno", async () => {
    const { crmPublicOrigin } = await import("./urls");
    expect(crmPublicOrigin({ CP_ALLOWED_ORIGINS: "https://admin.bigelephant.es/" })).toBe("https://admin.bigelephant.es");
    expect(crmPublicOrigin({ CP_ALLOWED_ORIGINS: " http://localhost:5173 , https://admin.bigelephant.es " })).toBe("https://admin.bigelephant.es");
    expect(crmPublicOrigin({ CP_ALLOWED_ORIGINS: "", RAILWAY_ENVIRONMENT_NAME: "production" })).toBe("https://admin.bigelephant.es");
    expect(crmPublicOrigin({ RAILWAY_ENVIRONMENT_NAME: "live" })).toBe("https://elephant-source-crm-live.up.railway.app");
    expect(crmPublicOrigin({})).toBeNull();
  });
});

describe("servicios externos: envío del contrato por correo", () => {
  const setup = async (mail?: ConstructorParameters<typeof ExternalService>[0]["mail"]) => {
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore, now: () => T });
    const store = new MemoryExternalStore("test");
    const svc = new ExternalService({ store, crm, crmStore, mode: "test", namespace: "beta", urls, mail, now: () => T });
    const c = await crm.createCompany({ name: "Nextair", legalName: "Nextair SL" }, "operator:test");
    const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
    return { svc, store, x };
  };
  const signer = { name: "Laura Representante", email: "Laura@Nextair.example", role: "Administradora" };

  it("envía la invitación al representante con su enlace; reenviar crea otro enlace y otro correo; queda en el historial", async () => {
    const sent: Array<{ to: string; key: string; url: string; companyName: string; amountCents: number }> = [];
    const notices: string[] = [];
    const { svc, store, x } = await setup({
      invite: async (to, key, i) => (sent.push({ to, key, url: i.url, companyName: i.companyName, amountCents: i.amountCents }), { status: "pending", reason: null, duplicate: false }),
      opsNotice: async (_k, title) => void notices.push(title),
    });
    const a = await svc.requestAcceptance(x.id, signer, "operator:test", { send: true });
    expect(a.mail).toEqual({ status: "pending", reason: null });
    expect(sent).toEqual([{ to: "laura@nextair.example", key: `contract-invite:beta:${a.acceptanceId}`, url: a.url, companyName: "Nextair SL", amountCents: 100_000 }]);
    const b = await svc.requestAcceptance(x.id, signer, "operator:test", { send: true });
    expect(sent.map((s) => s.url)).toEqual([a.url, b.url]);
    expect(b.url).not.toBe(a.url);
    // Solo el último enlace sirve
    await expect(svc.accept(new URL(a.url).searchParams.get("token")!, { name: "Laura Representante", accept: true }, { ip: null, userAgent: null })).rejects.toMatchObject({ code: "invalid_state" });
    await svc.accept(new URL(b.url).searchParams.get("token")!, { name: "Laura Representante", accept: true }, { ip: null, userAgent: null });
    expect(notices).toEqual(["Contrato aceptado: Nextair SL · SkiNet"]);
    const ev = (await store.events(x.id)).filter((e) => e.kind === "acceptance_email");
    expect(ev.map((e) => [e.ref, e.detail?.status])).toEqual([[String(a.acceptanceId), "pending"], [String(b.acceptanceId), "pending"]]);
  });

  it("sin envío o sin correo configurado: el enlace se entrega al operador y el fallo de correo no rompe la contratación", async () => {
    const plain = await setup();
    expect((await plain.svc.requestAcceptance(plain.x.id, signer, "operator:test")).mail).toBeNull();
    const none = await setup();
    expect((await none.svc.requestAcceptance(none.x.id, signer, "operator:test", { send: true })).mail).toMatchObject({ status: "unavailable" });
    const broken = await setup({ invite: async () => { throw new Error("proveedor caído"); } });
    const r = await broken.svc.requestAcceptance(broken.x.id, signer, "operator:test", { send: true });
    expect(r.mail).toEqual({ status: "failed", reason: "proveedor caído" });
    expect(r.url).toMatch(/token=/);
  });
});

describe("servicios externos: estado del correo de cada enlace", () => {
  it("sin envío, «solo enlace»; con envío, el estado actual del mensaje (entregado tras el evento del proveedor) o el motivo del bloqueo", async () => {
    const crmStore = new MemoryCrmStore();
    const crm = new CrmService({ store: crmStore, now: () => T });
    const store = new MemoryExternalStore("test");
    const outbox = new Map<number, { status: string; reason: string | null }>();
    let next = 1;
    const svc = new ExternalService({
      store, crm, crmStore, mode: "test", namespace: "beta", urls, now: () => T,
      mail: {
        invite: async (to) => {
          const id = next++;
          const blocked = to.endsWith("@bloqueado.example");
          outbox.set(id, blocked ? { status: "skipped", reason: "sandbox_recipient_not_allowed" } : { status: "pending", reason: null });
          return { ...outbox.get(id)!, duplicate: false, id };
        },
        status: async (id) => outbox.get(id) ?? null,
      },
    });
    const c = await crm.createCompany({ name: "Nextair", legalName: "NEXTAIR SL" }, "operator:test");
    const x = await svc.create({ companyId: c.id, service: { key: "skinet", name: "SkiNet" }, amountCents: 100_000, taxRateBp: 2100, firstChargeDate: "2026-11-01", conditions: "Condiciones del servicio de prueba suficientemente largas." }, "operator:test");
    await svc.requestAcceptance(x.id, { name: "Laura Representante", email: "laura@bloqueado.example" }, "operator:test", { send: true });
    let d = await svc.detail(x.id);
    expect(d.acceptances[0].mail).toEqual({ status: "skipped", reason: "sandbox_recipient_not_allowed", to: "laura@bloqueado.example" });
    await svc.requestAcceptance(x.id, { name: "Laura Representante", email: "laura@nextair.example" }, "operator:test", { send: true });
    outbox.set(2, { status: "delivered", reason: null });
    d = await svc.detail(x.id);
    const latest = d.acceptances.find((a) => a.status === "pending")!;
    expect(latest.mail).toEqual({ status: "delivered", reason: null, to: "laura@nextair.example" });
    await svc.requestAcceptance(x.id, { name: "Laura Representante", email: "laura@nextair.example" }, "operator:test");
    d = await svc.detail(x.id);
    expect(d.acceptances.find((a) => a.status === "pending")!.mail).toBeNull();
  });
});
