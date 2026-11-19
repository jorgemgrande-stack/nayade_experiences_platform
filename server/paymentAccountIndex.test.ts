/**
 * Índice global de cuentas de cobro: canal firmado Core → plano de control (endpoint real de la API del plano de control,
 * cliente real del Core) y reglas de reserva. La concurrencia sobre MySQL real está en paymentAccountIndex.mysql.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { createControlPlaneApp } from "./controlPlane/api";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { AccountIndexUnavailable, PAYMENT_CLAIM_PATH, httpAccountIndexClient, signPaymentClaim, verifyPaymentClaim } from "./paymentsConnect/accountIndex";
import { MemoryAccountIndex } from "./paymentsConnect/testing";
import { signSupportAudit } from "./_core/support/audit";

const SECRET = "s".repeat(40);
const A1 = "acct_1CuentaUnica00001";
const A2 = "acct_1CuentaDos0000002";
let server: http.Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function start(o: { withIndex?: boolean } = {}) {
  const reg = new MemoryTenantRegistryStore();
  const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
  const registry = new TenantRegistryService(reg, () => ring);
  for (const id of ["quantum", "otra"]) await registry.createTenant({ id, displayName: id }, { type: "operator", id: "test" });
  const index = new MemoryAccountIndex();
  const app = createControlPlaneApp({ tokens: [], registry, reader: reg, platformTarget: "edge.example.com", supportSecret: SECRET, ...(o.withIndex === false ? {} : { paymentAccounts: index }) } as never);
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PAYMENT_CLAIM_PATH}`;
  const client = httpAccountIndexClient({ url, secret: SECRET });
  const rawPost = (token: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  return { index, client, rawPost };
}

describe("reserva de la cuenta por el plano de control", () => {
  it("la primera empresa la reserva; otra no puede; la misma empresa es idempotente", async () => {
    const s = await start();
    expect(await s.client.claim("quantum", "test", A1)).toEqual({ ok: true, alreadyOwned: false });
    expect(await s.client.claim("quantum", "test", A1)).toEqual({ ok: true, alreadyOwned: true });
    expect(await s.client.claim("otra", "test", A1)).toEqual({ ok: false, reason: "taken" });
    expect(await s.index.tenantOf(A1)).toBe("quantum");
    // una empresa no acumula otra cuenta en el mismo modo, pero sí en el otro
    expect(await s.client.claim("quantum", "test", A2)).toEqual({ ok: false, reason: "tenant_has_other" });
    expect(await s.client.claim("quantum", "live", A2)).toEqual({ ok: true, alreadyOwned: false });
  });

  it("dos altas simultáneas de la misma cuenta: solo una gana", async () => {
    const s = await start();
    const r = await Promise.all([s.client.claim("quantum", "test", A1), s.client.claim("otra", "test", A1)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok)).toEqual([{ ok: false, reason: "taken" }]);
  });

  it("rechaza tokens ajenos: sin firma, firmados con otro secreto, de otro tipo (soporte), caducados o repetidos", async () => {
    const s = await start();
    expect((await s.rawPost("no-es-un-token")).status).toBe(401);
    expect((await s.rawPost(await signPaymentClaim("x".repeat(40), { tid: "quantum", mode: "test", acct: A1 }))).status).toBe(401);
    // Un token de auditoría de soporte (mismo secreto) NO vale como reserva
    expect((await s.rawPost(await signSupportAudit(SECRET, { gid: "a".repeat(32), tid: "quantum", ev: "entered", d: {} }))).status).toBe(401);
    const expired = await new SignJWT({ typ: "es_payment_account_claim", tid: "quantum", mode: "test", acct: A1 })
      .setProtectedHeader({ alg: "HS256" }).setJti("j".repeat(8)).setExpirationTime(Math.floor(Date.now() / 1000) - 120).sign(new TextEncoder().encode(SECRET));
    expect((await s.rawPost(expired)).status).toBe(401);
    const ok = await signPaymentClaim(SECRET, { tid: "quantum", mode: "test", acct: A1 });
    expect((await s.rawPost(ok)).status).toBe(201);
    expect((await s.rawPost(ok)).status).toBe(409); // repetición del mismo token
    expect(await s.index.tenantOf(A1)).toBe("quantum");
  });

  it("empresa inexistente: 404; sin índice configurado: 501; el cliente falla cerrado (error, no «ok»)", async () => {
    const s = await start();
    expect((await s.rawPost(await signPaymentClaim(SECRET, { tid: "fantasma", mode: "test", acct: A1 }))).status).toBe(404);
    const n = await start({ withIndex: false });
    expect((await n.rawPost(await signPaymentClaim(SECRET, { tid: "quantum", mode: "test", acct: A1 }))).status).toBe(501);
    await expect(n.client.claim("quantum", "test", A1)).rejects.toBeInstanceOf(AccountIndexUnavailable);
    await expect(httpAccountIndexClient({ url: "http://127.0.0.1:1/x", secret: SECRET }).claim("quantum", "test", A1)).rejects.toBeInstanceOf(AccountIndexUnavailable);
    await expect(httpAccountIndexClient({ secret: "corto" }).claim("quantum", "test", A1)).rejects.toBeInstanceOf(AccountIndexUnavailable);
  });

  it("el token solo admite cuentas y empresas bien formadas", async () => {
    const bad = await signPaymentClaim(SECRET, { tid: "../x", mode: "test", acct: A1 });
    expect(await verifyPaymentClaim(bad, SECRET)).toBeNull();
    const bad2 = await signPaymentClaim(SECRET, { tid: "quantum", mode: "test", acct: "cuenta-rara" });
    expect(await verifyPaymentClaim(bad2, SECRET)).toBeNull();
    expect((await verifyPaymentClaim(await signPaymentClaim(SECRET, { tid: "quantum", mode: "test", acct: A1 }), SECRET))?.acct).toBe(A1);
  });
});
