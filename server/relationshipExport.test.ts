/**
 * Documentación de la relación contractual (plano de control): solo de la empresa pedida, sin notas internas de
 * soporte, «no disponible» (y no completo) cuando falta una fuente, y la ruta exige billing:read y tickets:read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildRelationshipExport, RelationshipNotFoundError } from "./controlPlane/relationshipExport";
import { createControlPlaneApp } from "./controlPlane/api";
import { hashToken } from "./controlPlane/auth";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";

const NOW = Date.UTC(2026, 9, 21, 9);
const sources = {
  tenant: async (id: string) => (id === "acme" ? { id: "acme", displayName: "Acme", status: "suspended" } : null),
  orders: async () => [
    { id: 1, tenantId: "acme", reference: "PED-1" },
    { id: 2, tenantId: "costa", reference: "PED-2" },
  ],
  billing: async () => ({ subscription: { plan: "essential" }, invoices: [{ id: 10 }] }),
  stripeInvoices: async (orderId: number) => [{ orderId, number: `F-${orderId}` }],
  fiscalDocuments: async (orderId: number) => [{ orderId, kind: "invoice" }],
  tickets: async () => [
    {
      ticket: { id: 5, title: "No veo las reservas" },
      events: [
        { kind: "created", comment: null, internal: false },
        { kind: "comment", comment: "Lo estamos mirando", internal: false },
        { kind: "comment", comment: "NOTA INTERNA: cliente moroso", internal: true },
      ],
    },
  ],
};

describe("paquete de la relación contractual", () => {
  it("solo los pedidos y documentos de la empresa; mensajes públicos de soporte; completo con todas las fuentes", async () => {
    const b = await buildRelationshipExport("acme", sources, { now: NOW, by: "op-1" });
    expect(b).toMatchObject({ format: "elephant-source-relationship", tenantId: "acme", complete: true, generatedBy: "op-1" });
    expect(b.orders.map((o) => o.reference)).toEqual(["PED-1"]);
    expect(b.stripeInvoices).toEqual([{ orderId: 1, number: "F-1" }]);
    expect(b.fiscalDocuments).toEqual([{ orderId: 1, kind: "invoice" }]);
    expect(b.tickets[0].messages).toEqual([{ kind: "comment", comment: "Lo estamos mirando" }]);
    expect(JSON.stringify(b)).not.toMatch(/NOTA INTERNA|PED-2|costa/);
  });

  it("una fuente no configurada queda «no disponible» y el paquete NO es completo; empresa inexistente → error", async () => {
    const b = await buildRelationshipExport("acme", { tenant: sources.tenant, tickets: sources.tickets }, { now: NOW, by: "op" });
    expect(b.complete).toBe(false);
    expect(b.sources).toMatchObject({ registro: "incluido", soporte: "incluido", stripe: "no disponible", facturacion: "no disponible" });
    expect(b.billing).toBeNull();
    await expect(buildRelationshipExport("nadie", sources, { now: NOW, by: "op" })).rejects.toBeInstanceOf(RelationshipNotFoundError);
  });
});

describe("ruta /cp/v1/tenants/:id/relationship-export", () => {
  const BOTH = "token-relacion-completo-00000000000000000";
  const BILLING = "token-relacion-solo-facturacion-0000000000";
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    const regStore = new MemoryTenantRegistryStore();
    const registry = new TenantRegistryService(regStore, () => keyringFromEnv({ REGISTRY_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv));
    server = http.createServer(
      createControlPlaneApp({
        tokens: [
          { id: "ambos", sha256: hashToken(BOTH), scopes: ["billing:read", "tickets:read"] },
          { id: "fact", sha256: hashToken(BILLING), scopes: ["billing:read"] },
        ],
        registry,
        reader: regStore,
        entitlements: { listEntitlements: async () => [], grant: async () => undefined as never, setStatus: async () => undefined as never, revoke: async () => undefined as never },
        quotas: { listQuotas: async () => [], set: async () => undefined as never, remove: async () => undefined as never },
        platformTarget: "edge.example.com",
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const get = async (p: string, token: string | null) => (await fetch(`${base}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).status;

  it("sin token 401; sin tickets:read 403; empresa inexistente 404", async () => {
    expect(await get("/tenants/acme-01/relationship-export", null)).toBe(401);
    expect(await get("/tenants/acme-01/relationship-export", BILLING)).toBe(403);
    expect(await get("/tenants/acme-01/relationship-export", BOTH)).toBe(404);
  });
});

describe("plazo de entrega (5 días hábiles)", () => {
  it("salta fines de semana y festivos indicados", async () => {
    const { businessDeadline } = await import("./controlPlane/relationshipExport");
    // Miércoles 21/10/2026 → miércoles 28/10/2026
    expect(businessDeadline(new Date("2026-10-21T10:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-28");
    // Viernes 23/10 → viernes 30/10; con el 26/10 festivo → lunes 02/11
    expect(businessDeadline(new Date("2026-10-23T10:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(businessDeadline(new Date("2026-10-23T10:00:00Z"), 5, new Set(["2026-10-26"])).toISOString().slice(0, 10)).toBe("2026-11-02");
    const b = await buildRelationshipExport("acme", sources, { now: NOW, by: "op", requestedAt: Date.parse("2026-10-21T10:00:00Z") });
    expect(b.request).toEqual({ requestedAt: "2026-10-21T10:00:00.000Z", deadline: "2026-10-28T23:59:59.000Z" });
  });
});
