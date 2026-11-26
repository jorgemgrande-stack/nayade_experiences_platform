/**
 * Avisos internos de contratación y cobro a Dirección (PlatformMailer.billingNotice): entrega por la bandeja real,
 * idempotencia por hecho de negocio y manejo de errores del proveedor (nunca lanza). Datos sintéticos.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLogSink } from "../_core/ops/log";
import { PlatformMailer } from "./platform";
import { mailPolicyFromEnv } from "./policy";
import { memoryProvider } from "./providers";
import { MailService } from "./service";
import { MemoryMailStore } from "./store";
import { MailProviderError } from "./types";

const ENV = { MAIL_MODE: "live", MAIL_LIVE_AUTHORIZED: "1", MAIL_SENDING_DOMAIN: "bigelephant.example", ELEPHANT_SUPPORT_EMAIL: "soporte@bigelephant.example" };
function setup(o: { env?: Record<string, string>; failWith?: MailProviderError | null } = {}) {
  const store = new MemoryMailStore();
  const provider = memoryProvider({ failWith: o.failWith ?? null });
  const policy = mailPolicyFromEnv({ ...ENV, ...(o.env ?? {}) } as NodeJS.ProcessEnv);
  const m = new PlatformMailer(new MailService({ lane: "platform", store, provider, policy }), policy);
  return { store, provider, m };
}
beforeEach(() => setLogSink(() => undefined));
afterEach(() => {
  setLogSink(null);
  delete process.env.CP_BILLING_NOTICE_EMAIL;
});

const lines = ["PRUEBA", "Acontecimiento: Primer cobro real confirmado (SIMULADO)."];

describe("billingNotice", () => {
  it("va a administracion@bigelephant.es por la bandeja de plataforma y queda registrado", async () => {
    const { m, provider } = setup();
    const r = await m.billingNotice("test:1", "[PRUEBA] Aviso", lines);
    expect(r).toMatchObject({ status: expect.stringMatching(/pending|sending|accepted|delivered/), duplicate: false });
    await m.service.drain(5);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe("administracion@bigelephant.es");
    expect(provider.sent[0].subject).toContain("[PRUEBA]");
  });

  it("idempotente por hecho: la misma clave no se envía dos veces; otra clave sí", async () => {
    const { m, provider } = setup();
    const a = await m.billingNotice("invoice:in_1", "Cobro", lines);
    const b = await m.billingNotice("invoice:in_1", "Cobro", lines);
    expect(b?.duplicate).toBe(true);
    expect(b?.id).toBe(a?.id);
    await m.billingNotice("invoice:in_2", "Cobro", lines);
    await m.service.drain(10);
    expect(provider.sent).toHaveLength(2);
  });

  it("el destinatario se puede cambiar por CP_BILLING_NOTICE_EMAIL", async () => {
    process.env.CP_BILLING_NOTICE_EMAIL = "otro@bigelephant.example";
    const { m, provider } = setup();
    await m.billingNotice("x:1", "Aviso", lines);
    await m.service.drain(5);
    expect(provider.sent[0].to).toBe("otro@bigelephant.example");
  });

  it("un fallo del proveedor nunca lanza: el mensaje queda en la bandeja para reintentarse", async () => {
    const { m, provider } = setup({ failWith: new MailProviderError("provider_down", true) });
    await expect(m.billingNotice("fallo:1", "Aviso", lines)).resolves.toBeDefined();
    await m.service.drain(5).catch(() => undefined);
    expect(provider.sent).toHaveLength(0);
    // Recuperado el proveedor, el reintento de la misma clave no crea otro mensaje
    provider.failWith = null;
    const again = await m.billingNotice("fallo:1", "Aviso", lines);
    expect(again?.duplicate).toBe(true);
  });

  it("con el correo apagado (MAIL_MODE=off) no se envía nada", async () => {
    const { m, provider } = setup({ env: { MAIL_MODE: "off" } });
    await m.billingNotice("off:1", "Aviso", lines);
    await m.service.drain(5).catch(() => undefined);
    expect(provider.sent).toHaveLength(0);
  });
});
