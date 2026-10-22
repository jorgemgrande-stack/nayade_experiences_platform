/**
 * Sistema transaccional: vistas previas con datos ficticios (todas las plantillas que envía Elephant, con el diseño
 * común, sin restos de variables y solo con enlaces https), trazabilidad de la bandeja (sin direcciones completas ni
 * cuerpos, filtros, historial con eventos del proveedor y separación por empresa) y sus rutas protegidas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { TEMPLATE_CATALOG } from "./notifications/catalog";
import { allPreviews, hasPreview, previewTemplate } from "./notifications/preview";
import { DEFAULT_MAIL_LOGO_URL, PLATFORM_LEGAL_LINE, mailPolicyFromEnv } from "./mail/policy";
import { memoryProvider } from "./mail/providers";
import { MailService, mailRef } from "./mail/service";
import { MemoryMailStore, templateOfKey } from "./mail/store";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

describe("vistas previas de las comunicaciones", () => {
  it("todas las que envía Elephant tienen vista previa; las de Stripe y las que aún no tienen disparador, no", () => {
    for (const t of TEMPLATE_CATALOG) {
      const expected = t.sentBy !== "stripe" && t.status !== "contract";
      expect(hasPreview(t), t.id).toBe(expected);
    }
    expect(allPreviews().length).toBe(TEMPLATE_CATALOG.filter((t) => t.sentBy !== "stripe" && t.status !== "contract").length);
    expect(previewTemplate("subscription.dunning_reminder")).toBeNull();
    expect(previewTemplate("security.new_login")).toBeNull();
    expect(previewTemplate("no.existe")).toBeNull();
  });

  it("diseño común, sin variables sin rellenar, solo enlaces https, en español y con versión de texto", () => {
    for (const p of allPreviews()) {
      expect(p.sample).toBe(true);
      expect(p.subject.length, p.id).toBeGreaterThan(5);
      expect(p.subject, p.id).not.toMatch(/[\r\n]/);
      expect(p.html, p.id).toMatch(/<html lang="es">/);
      expect(p.html, p.id).toMatch(/<table role="presentation"/);
      expect(p.text, p.id).toMatch(/No es publicidad/);
      for (const x of [p.subject, p.html, p.text]) expect(x, p.id).not.toMatch(/undefined|NaN|\[object |\bnull\b/);
      for (const m of p.html.matchAll(/href="([^"]+)"/g)) expect(m[1], p.id).toMatch(/^https:\/\//);
    }
  });

  it("plataforma: logotipo oficial y emisor; empresa (aviso de seguridad del Core): su marca, sin logotipo ni datos de la plataforma", () => {
    const platform = previewTemplate("subscription.renewal_paid")!;
    expect(platform.html).toContain(`<img src="${DEFAULT_MAIL_LOGO_URL}"`);
    expect(platform.text).toContain(PLATFORM_LEGAL_LINE);
    const tenant = previewTemplate("security.password_changed")!;
    expect(tenant.html).not.toContain("<img");
    expect(tenant.html).not.toContain("Elephant Source");
    expect(tenant.html).not.toMatch(/https?:\/\//);
    expect(tenant.html).toContain("Hotel Ejemplo");
  });

  it("los valores dinámicos se escapan siempre", () => {
    const t = TEMPLATE_CATALOG.find((x) => x.id === "module.activated")!;
    const c = t.render!({ productName: "<script>alert(1)</script>", host: "acme.example" }, { supportEmail: null });
    expect(c.html).not.toContain("<script>alert");
    expect(c.html).toContain("&lt;script&gt;");
  });
});

describe("trazabilidad de la bandeja", () => {
  const policy = mailPolicyFromEnv({ MAIL_MODE: "sandbox", MAIL_SANDBOX_ALLOWLIST: "pruebas.example", MAIL_SENDING_DOMAIN: "envios.example" } as NodeJS.ProcessEnv);
  const sender = { lane: "platform" as const };

  async function seed() {
    const store = new MemoryMailStore();
    const svc = new MailService({ lane: "platform", store, provider: memoryProvider(), policy });
    const send = (tenantId: string, key: string, to: string) => svc.send({ tenantId, idempotencyKey: key, category: "operational", to, subject: `Aviso ${key}`, html: "<p>cuerpo</p>", sender });
    const a = await send("acme", "notif:subscription.suspended:v1:evt-1", "ana@pruebas.example");
    await send("acme", "trial:7:expiry:1800000000:3", "ana@pruebas.example");
    await send("costa", "notif:module.activated:v1:evt-2", "luis@pruebas.example");
    await send("costa", "notif:module.activated:v1:evt-3", "fuera@otro.example"); // fuera de la lista de pruebas: no sale
    return { store, svc, a };
  }

  it("lista sin direcciones completas ni cuerpos; plantilla deducida de la clave; filtros y paginación", async () => {
    const { store } = await seed();
    const all = await store.list({});
    expect(all.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(all.map((r) => r.template)).toEqual(["module.activated", "module.activated", "trial", "subscription.suspended"]);
    const json = JSON.stringify(all);
    expect(json).not.toContain("ana@pruebas.example");
    expect(json).not.toContain("<p>cuerpo</p>");
    expect(all[3].recipient).toMatch(/\*/);
    expect((await store.list({ tenantId: "costa" })).map((r) => r.tenantId)).toEqual(["costa", "costa"]);
    expect((await store.list({ template: "module.activated" })).length).toBe(2);
    expect((await store.list({ template: "trial" })).map((r) => r.id)).toEqual([2]);
    expect((await store.list({ status: "skipped" })).map((r) => [r.id, r.reason])).toEqual([[4, "sandbox_recipient_not_allowed"]]);
    expect((await store.list({ beforeId: 3, limit: 1 })).map((r) => r.id)).toEqual([2]);
    expect(templateOfKey("notif:billing.incident:v1:x")).toBe("billing.incident");
  });

  it("historial con los eventos del proveedor; un evento repetido no se duplica", async () => {
    const { store, svc, a } = await seed();
    const ev = { kind: "delivered" as const, ref: mailRef("platform", "acme", a.id!), messageId: null, email: "ana@pruebas.example", eventId: "pm-1", reason: null };
    expect(await svc.applyEvent(ev)).toBe("applied");
    expect(await svc.applyEvent(ev)).toBe("duplicate");
    const h = (await store.history(a.id!))!;
    expect(h.row.status).toBe("delivered");
    expect(h.events.filter((e) => e.fromProvider).map((e) => e.kind)).toEqual(["provider_delivered"]);
    expect(await store.history(999)).toBeNull();
  });
});

describe("rutas de trazabilidad y vista previa", () => {
  const OPS = "token-operaciones-0000000000000000000000";
  const OTHER = "token-sin-ambito-000000000000000000000000";
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    const store = new MemoryMailStore();
    const svc = new MailService({ lane: "platform", store, provider: memoryProvider(), policy: mailPolicyFromEnv({ MAIL_MODE: "off", MAIL_SENDING_DOMAIN: "bigelephant.es" } as NodeJS.ProcessEnv) });
    await svc.send({ tenantId: "acme", idempotencyKey: "notif:subscription.ended:v1:e", category: "operational", to: "ana@pruebas.example", subject: "Fin", html: "<p>x</p>", sender: { lane: "platform" } });
    const regStore = new MemoryTenantRegistryStore();
    const registry = new TenantRegistryService(regStore, () => keyringFromEnv({ REGISTRY_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv));
    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "ops", sha256: hashToken(OPS), scopes: ["ops:read"] },
          { id: "otro", sha256: hashToken(OTHER), scopes: ["tenants:read"] },
        ],
        registry,
        reader: regStore,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined as never, setStatus: async () => undefined as never, revoke: async () => undefined as never },
        quotas: { listQuotas: async () => [], set: async () => undefined as never, remove: async () => undefined as never },
        platformTarget: "edge.example.com",
        mail: { platform: null, ledger: store },
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const get = async (p: string, token: string | null = OPS) => {
    const r = await fetch(`${base}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: (await r.json()) as any };
  };

  it("exigen el ámbito ops:read", async () => {
    for (const p of ["/mail/outbox", "/mail/outbox/1", "/notifications/preview", "/notifications/preview/trial.reminder"]) {
      expect((await get(p, null)).status, p).toBe(401);
      expect((await get(p, OTHER)).status, p).toBe(403);
    }
  });

  it("bandeja: lista, detalle, filtros validados y 404", async () => {
    const list = await get("/mail/outbox?limit=10");
    expect(list.status).toBe(200);
    expect(list.body.messages).toEqual([expect.objectContaining({ id: 1, template: "subscription.ended", status: "skipped", reason: "mode_off" })]);
    expect(JSON.stringify(list.body)).not.toContain("ana@pruebas.example");
    expect((await get("/mail/outbox/1")).body.row).toMatchObject({ id: 1 });
    expect((await get("/mail/outbox/99")).status).toBe(404);
    expect((await get("/mail/outbox?status=inventado")).status).toBe(400);
    expect((await get("/mail/outbox?template=x%27%20OR%201%3D1")).status).toBe(400);
  });

  it("vista previa: lista de ids y contenido con datos ficticios; 404 para lo que no tiene", async () => {
    const ids = (await get("/notifications/preview")).body.ids as string[];
    expect(ids).toContain("trial.reminder");
    expect(ids).not.toContain("subscription.dunning_reminder");
    const p = await get("/notifications/preview/trial.reminder");
    expect(p.body.preview).toMatchObject({ id: "trial.reminder", sample: true });
    expect(p.body.preview.subject).toMatch(/termina en 7 días/);
    expect((await get("/notifications/preview/security.new_login")).status).toBe(404);
  });
});
