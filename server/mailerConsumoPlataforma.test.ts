/**
 * Política comercial del correo (08/11/2026): el Resource Manager mide como consumo de la PLATAFORMA (`email.sent`, con
 * coste y cuota) solo lo que sale por el servicio de correo central, incluido el envío alternativo cuando la cuenta propia
 * falla. Lo que sale por el Postmark o el SMTP propio de la empresa lo paga su titular: se mide aparte (`email.own.sent`)
 * y no consume la cuota de la plataforma. El envío real con MySQL está en `server/mail/tenantPostmark.mysql.test.ts`.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { MailRoute } from "./mail/tenantMail";

vi.mock("./config", () => ({
  getSystemSettingSync: (_k: string, fb = "") => fb,
  getSystemSetting: async (_k: string, fb = "") => fb,
}));
const outbox = vi.hoisted(() => ({ routes: [] as MailRoute[], predicted: null as MailRoute | null, result: true }));
vi.mock("./mail/tenantMail", async (orig) => {
  const real = await orig<typeof import("./mail/tenantMail")>();
  return {
    ...real,
    predictedMailRoute: (c: string | null | undefined) => outbox.predicted ?? real.predictedMailRoute(c),
    sendTenantMail: async (_p: unknown, onRoute?: (r: MailRoute) => void) => {
      for (const r of outbox.routes) onRoute?.(r);
      return outbox.result;
    },
  };
});
const quota = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("./_core/erm/runtime", async (orig) => ({
  ...(await orig<typeof import("./_core/erm/runtime")>()),
  enforceQuota: async (metric: string) => {
    quota.calls.push(metric);
  },
}));

import { sendEmail } from "./mailer";
import { InMemoryMeterSink, Metrics, setMeterSink } from "./_core/metering";
import { meteredMailRoute } from "./mail/tenantMail";
import { METRIC_CATALOG } from "./_core/erm/tenantMetrics";
import { ESTIMATED_COST_MODEL } from "./_core/erm/costs";
import { SHARED_COUNTER_METRICS } from "./_core/erm/usage";

let sink: InMemoryMeterSink;
beforeEach(() => {
  process.env.TENANT_MODE = "multi";
  outbox.routes = [];
  outbox.predicted = null;
  outbox.result = true;
  quota.calls = [];
  sink = new InMemoryMeterSink();
  setMeterSink(sink);
});
afterEach(() => {
  setMeterSink(null);
  delete process.env.TENANT_MODE;
});

const send = async (category = "operational") => {
  const { runWithTenant } = await import("./_core/tenant");
  return runWithTenant("hotel-sol", () => sendEmail({ to: "cliente@x.example", subject: "Pedido", html: "<p>x</p>", category } as any));
};
const mailEvents = () => sink.events.filter((e) => e.metric.startsWith("email.")).map((e) => [e.metric, e.meta?.route]);

describe("vía con la que se mide cada envío", () => {
  it("plataforma si algún mensaje salió por ella; si no, la cuenta propia que lo aceptó; sin aceptación, la prevista", () => {
    expect(meteredMailRoute(new Set<MailRoute>(["own_postmark", "platform"]), "own_postmark")).toBe("platform");
    expect(meteredMailRoute(new Set<MailRoute>(["own_postmark"]), "own_postmark")).toBe("own_postmark");
    expect(meteredMailRoute(new Set<MailRoute>(["own_smtp"]), "own_postmark")).toBe("own_smtp");
    expect(meteredMailRoute(new Set<MailRoute>(), "own_smtp")).toBe("own_smtp");
    expect(meteredMailRoute(new Set<MailRoute>(), "platform")).toBe("platform");
  });
});

describe("medición del correo en el Resource Manager", () => {
  it("servicio de la plataforma → email.sent y consume la cuota", async () => {
    outbox.routes = ["platform"];
    expect(await send()).toBe(true);
    expect(mailEvents()).toEqual([[Metrics.EMAIL_SENT, "platform"]]);
    expect(quota.calls).toEqual([Metrics.EMAIL_SENT]);
  });

  it("Postmark propio → email.own.sent, sin consumo ni cuota de la plataforma", async () => {
    outbox.predicted = "own_postmark";
    outbox.routes = ["own_postmark"];
    expect(await send()).toBe(true);
    expect(mailEvents()).toEqual([[Metrics.EMAIL_OWN_SENT, "own_postmark"]]);
    expect(quota.calls).toEqual([]);
  });

  it("SMTP propio → email.own.sent, sin consumo ni cuota de la plataforma", async () => {
    outbox.predicted = "own_smtp";
    outbox.routes = ["own_smtp"];
    expect(await send("marketing")).toBe(true);
    expect(mailEvents()).toEqual([[Metrics.EMAIL_OWN_SENT, "own_smtp"]]);
    expect(quota.calls).toEqual([]);
  });

  it("envío alternativo (la cuenta propia falla y sale por la plataforma) → email.sent", async () => {
    outbox.predicted = "own_postmark";
    outbox.routes = ["platform"];
    expect(await send()).toBe(true);
    expect(mailEvents()).toEqual([[Metrics.EMAIL_SENT, "platform"]]);
    // Sin reserva previa (vía prevista propia): se cuenta una vez al medir, sin crédito huérfano
    expect(quota.calls).toEqual([]);
  });

  it("un envío que no llega al proveedor se mide por la vía prevista, como hasta ahora (una unidad por envío)", async () => {
    outbox.result = false;
    expect(await send()).toBe(false);
    expect(sink.events.filter((e) => e.metric === Metrics.EMAIL_SENT)).toHaveLength(1);
    expect(sink.events.find((e) => e.metric === Metrics.EMAIL_SENT)?.meta).toMatchObject({ channel: "outbox", route: "platform", ok: false });
  });

  it("sin cuenta propia configurada, la vía prevista es la plataforma (también en monoempresa)", async () => {
    const real = await vi.importActual<typeof import("./mail/tenantMail")>("./mail/tenantMail");
    const { runWithTenant } = await import("./_core/tenant");
    expect(runWithTenant("hotel-sol", () => real.predictedMailRoute("payment_confirmed"))).toBe("platform");
    delete process.env.TENANT_MODE;
    expect(real.predictedMailRoute("payment_confirmed")).toBe("platform");
  });

  it("catálogo y costes: email.own.sent se mide pero no tiene tarifa de la plataforma ni contador de cuota", () => {
    expect(METRIC_CATALOG.find((m) => m.id === Metrics.EMAIL_OWN_SENT)).toMatchObject({ kind: "measured", group: "comunicaciones" });
    expect(ESTIMATED_COST_MODEL.rates.some((r) => r.metric === Metrics.EMAIL_SENT)).toBe(true);
    expect(ESTIMATED_COST_MODEL.rates.some((r) => r.metric === Metrics.EMAIL_OWN_SENT)).toBe(false);
    expect(SHARED_COUNTER_METRICS).toContain(Metrics.EMAIL_SENT);
    expect(SHARED_COUNTER_METRICS).not.toContain(Metrics.EMAIL_OWN_SENT);
  });
});

describe("Postmark y SMTP propios: capacidad incluida en los planes, no producto de pago", () => {
  it("comms-email está en Essential y Business y Enterprise lo heredan; ningún producto vende Postmark aparte", async () => {
    const { PRODUCTS } = await import("./catalog/elephantSourceV1");
    const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
    const caps = (key: string) => {
      const out = new Set<string>();
      for (let p = byKey.get(key), g = 0; p && g < 10; p = p.draft.catalog.inherits ? byKey.get(p.draft.catalog.inherits) : undefined, g++) p.draft.catalog.capabilities.forEach((c) => out.add(c));
      return out;
    };
    for (const plan of ["essential", "business", "enterprise"]) expect(caps(plan).has("comms-email")).toBe(true);
    expect(PRODUCTS.filter((p) => /postmark/i.test(`${p.key} ${p.draft.name} ${p.draft.tagline}`))).toEqual([]);
  });
});
