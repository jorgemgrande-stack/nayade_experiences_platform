/**
 * Webhook de Stripe con CRIPTOGRAFÍA REAL: las firmas se generan con el SDK oficial
 * (`webhooks.generateTestHeaderString`) y se verifican con `constructEvent` sobre el cuerpo original,
 * montado igual que en el plano de control (`express.raw` antes de cualquier analizador JSON).
 * Cubre las 10 pruebas obligatorias del §16.4 de docs/elephant-source/STRIPE_FASE_A.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import Stripe from "stripe";
import { stripeWebhookVerifier } from "./gateway";
import { MemoryStripeStore } from "./store";
import { stripeWebhookHandler } from "./webhook";
import type { StripeConfig } from "./config";

// Valores ficticios construidos en tiempo de ejecución (no son credenciales)
const SECRET = ["whsec", "z".repeat(32)].join("_");
const OTHER = ["whsec", "q".repeat(32)].join("_");
const config: StripeConfig = { mode: "test", apiKey: ["sk", "test", "x".repeat(24)].join("_"), webhookSecret: SECRET, apiVersion: "2026-09-30.endive", keyKind: "secret", namespace: "local", eventsRetentionDays: 180, taxPolicy: "test_net_no_tax" };
const sdk = new Stripe(config.apiKey, { apiVersion: "2026-09-30.endive" as Stripe.LatestApiVersion });

const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "evt_test_0000000001", object: "event", type: "invoice.paid", created: Math.floor(Date.now() / 1000), livemode: false, api_version: "2026-09-30.endive", data: { object: { id: "in_test_0000000001", object: "invoice" } }, ...over });
const sign = (payload: string, o: { secret?: string; timestamp?: number } = {}) => sdk.webhooks.generateTestHeaderString({ payload, secret: o.secret ?? SECRET, ...(o.timestamp ? { timestamp: o.timestamp } : {}) });

let store: MemoryStripeStore;
let recorded: string[];
let server: http.Server;
let base: string;

async function post(body: string | Buffer, headers: Record<string, string>) {
  const r = await fetch(`${base}/cp/v1/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeEach(async () => {
  store = new MemoryStripeStore();
  recorded = [];
  const app = express();
  app.post("/cp/v1/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) =>
    void stripeWebhookHandler({ verify: stripeWebhookVerifier(config), store, onRecorded: (id) => recorded.push(id) })(req, res),
  );
  // Igual que el plano de control: un analizador JSON global que NO debe tocar la ruta del webhook
  app.use(express.json());
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return () => new Promise<void>((r) => server.close(() => r()));
});

describe("webhook de Stripe: firma y cuerpo original", () => {
  it("firma válida: se guarda una vez y se responde 200", async () => {
    const body = event();
    const r = await post(body, { "stripe-signature": sign(body) });
    expect(r).toMatchObject({ status: 200, json: { received: true, duplicate: false } });
    expect(await store.event("evt_test_0000000001")).toMatchObject({ type: "invoice.paid", objectId: "in_test_0000000001", source: "webhook", status: "received" });
    await new Promise((r) => setImmediate(r));
    expect(recorded).toEqual(["evt_test_0000000001"]);
  });

  it("1. sin cabecera Stripe-Signature: 400 y nada guardado", async () => {
    expect((await post(event(), {})).status).toBe(400);
    expect(store.events.size).toBe(0);
  });

  it("2. firmado con otro secreto: 400", async () => {
    const body = event();
    expect((await post(body, { "stripe-signature": sign(body, { secret: OTHER }) })).json).toEqual({ error: "invalid_signature" });
    expect(store.events.size).toBe(0);
  });

  it("3. cuerpo alterado en un byte: 400", async () => {
    const body = event();
    const sig = sign(body);
    expect((await post(body.replace("invoice.paid", "invoice.paiD"), { "stripe-signature": sig })).status).toBe(400);
  });

  it("4. JSON reformateado (mismo contenido, otros bytes): 400", async () => {
    const body = event();
    const sig = sign(body);
    expect((await post(JSON.stringify(JSON.parse(body), null, 2), { "stripe-signature": sig })).status).toBe(400);
  });

  it("5. marca de tiempo fuera de la tolerancia (repetición antigua): 400", async () => {
    const body = event();
    expect((await post(body, { "stripe-signature": sign(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }) })).status).toBe(400);
  });

  it("6. varios v1 (rotación del secreto) con uno válido: 200", async () => {
    const body = event();
    const valid = sign(body);
    const wrong = sign(body, { secret: OTHER }).split(",").find((p) => p.startsWith("v1="))!;
    expect((await post(body, { "stripe-signature": `${valid},${wrong},v0=abcdef` })).status).toBe(200);
  });

  it("7. evento live con firma válida: 400 y nada guardado", async () => {
    const body = event({ livemode: true, id: "evt_test_live0000001" });
    expect((await post(body, { "stripe-signature": sign(body) })).json).toEqual({ error: "live_event_rejected" });
    expect(store.events.size).toBe(0);
  });

  it("8. tipo no gestionado: 200 sin guardar", async () => {
    const body = event({ type: "customer.created", id: "evt_test_other000001" });
    expect((await post(body, { "stripe-signature": sign(body) })).json).toEqual({ received: true, ignored: true });
    expect(store.events.size).toBe(0);
  });

  it("9. el mismo evento dos veces: una sola fila y un solo aviso al procesador", async () => {
    const body = event();
    await post(body, { "stripe-signature": sign(body) });
    const again = await post(body, { "stripe-signature": sign(body) });
    expect(again.json).toEqual({ received: true, duplicate: true });
    expect(store.events.size).toBe(1);
    await new Promise((r) => setImmediate(r));
    expect(recorded).toHaveLength(1);
  });

  it("10. cuerpo de más de 1 MB: rechazado antes de verificar", async () => {
    const big = event({ padding: "a".repeat(1_100_000) });
    expect((await post(big, { "stripe-signature": sign(big) })).status).toBe(413);
    expect(store.events.size).toBe(0);
  });

  it("si no se puede guardar, 500 (Stripe reintentará la entrega)", async () => {
    store.recordEvent = async () => {
      throw new Error("BD caída");
    };
    const body = event();
    expect((await post(body, { "stripe-signature": sign(body) })).status).toBe(500);
  });
});

describe("webhook de Stripe en modo live: firma real y livemode según el modo", () => {
  const liveConfig: StripeConfig = { ...config, mode: "live", apiKey: ["rk", "live", "x".repeat(24)].join("_"), keyKind: "restricted", namespace: "live", taxPolicy: null };
  let liveStore: MemoryStripeStore;
  let liveBase: string;
  let liveServer: http.Server;

  beforeEach(async () => {
    liveStore = new MemoryStripeStore("live");
    const app = express();
    app.post("/cp/v1/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => void stripeWebhookHandler({ verify: stripeWebhookVerifier(liveConfig), store: liveStore, mode: "live" })(req, res));
    await new Promise<void>((r) => (liveServer = app.listen(0, () => r())));
    liveBase = `http://127.0.0.1:${(liveServer.address() as { port: number }).port}`;
    return () => new Promise<void>((r) => liveServer.close(() => r()));
  });

  const livePost = async (body: string) => {
    const r = await fetch(`${liveBase}/cp/v1/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sign(body) }, body });
    return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
  };

  it("un evento live con firma válida se guarda", async () => {
    const r = await livePost(event({ livemode: true, id: "evt_live_0000000001" }));
    expect(r).toMatchObject({ status: 200, json: { received: true, duplicate: false } });
    expect(await liveStore.event("evt_live_0000000001")).toMatchObject({ type: "invoice.paid", status: "received" });
  });

  it("un evento de PRUEBAS con firma válida: 400 y nada guardado (el mismo trato que un live en pruebas)", async () => {
    expect(await livePost(event({ livemode: false }))).toEqual({ status: 400, json: { error: "test_event_rejected" } });
    expect(liveStore.events.size).toBe(0);
  });

  it("livemode ausente o no booleano: 400 en los dos modos", async () => {
    for (const lm of [undefined, "true", 1]) {
      const body = event({ livemode: lm, id: `evt_raro_${String(lm)}0000` });
      expect((await livePost(body)).status).toBe(400);
      expect((await post(body, { "stripe-signature": sign(body) })).status).toBe(400);
    }
    expect(liveStore.events.size).toBe(0);
    expect(store.events.size).toBe(0);
  });
});
