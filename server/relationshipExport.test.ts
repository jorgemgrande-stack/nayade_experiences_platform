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

describe("plazo de entrega: 5 días hábiles con el calendario laboral de Madrid", () => {
  it("cada caso, calculado a mano con los festivos oficiales", async () => {
    const { businessDeadline } = await import("./controlPlane/madridCalendar");
    const at = (iso: string) => businessDeadline(new Date(iso)).deadline;
    // Sin festivos: miércoles 21/10/2026 → miércoles 28/10
    expect(at("2026-10-21T10:00:00Z")).toBe("2026-10-28");
    // Viernes 30/10/2026: lunes 2/11 (traslado Todos los Santos) y lunes 9/11 (Almudena, local) → martes 10/11
    expect(at("2026-10-30T10:00:00Z")).toBe("2026-11-10");
    // Miércoles 2/12/2026: 7/12 (traslado Constitución) y 8/12 → viernes 11/12
    expect(at("2026-12-02T10:00:00Z")).toBe("2026-12-11");
    // Martes 22/12/2026: 25/12 → miércoles 30/12
    expect(at("2026-12-22T10:00:00Z")).toBe("2026-12-30");
    // Jueves 31/12/2026 cruza a 2027: 1/1 y 6/1 → lunes 11/01/2027
    expect(at("2026-12-31T10:00:00Z")).toBe("2027-01-11");
    // Miércoles 24/3/2027: Jueves y Viernes Santo → viernes 2/4
    expect(at("2027-03-24T10:00:00Z")).toBe("2027-04-02");
    // Lunes 11/5/2026: viernes 15/5 (San Isidro, local) → martes 19/5
    expect(at("2026-05-11T10:00:00Z")).toBe("2026-05-19");
    // Recibida en sábado festivo (2/5/2026): cuenta desde el lunes → viernes 8/5
    expect(at("2026-05-02T10:00:00Z")).toBe("2026-05-08");
  });

  it("zona horaria de Madrid: a las 23:30 UTC del 21/10 ya es día 22 en Madrid", async () => {
    const { businessDeadline } = await import("./controlPlane/madridCalendar");
    expect(businessDeadline(new Date("2026-10-21T23:30:00Z"))).toMatchObject({ receivedOn: "2026-10-22", deadline: "2026-10-29" });
  });

  it("festivo local provisional (2027) se cuenta como hábil (plazo más corto) y se avisa; año sin calendario → error", async () => {
    const { businessDeadline, CalendarUnavailableError } = await import("./controlPlane/madridCalendar");
    const r = businessDeadline(new Date("2027-11-05T10:00:00Z"));
    expect(r.deadline).toBe("2027-11-12");
    expect(r.provisionalIgnored).toEqual([expect.stringMatching(/^2027-11-09 /)]);
    expect(() => businessDeadline(new Date("2027-12-29T10:00:00Z"))).toThrow(CalendarUnavailableError);
  });

  it("el paquete incluye el plazo calculado", async () => {
    const b = await buildRelationshipExport("acme", sources, { now: NOW, by: "op", requestedAt: Date.parse("2026-10-30T10:00:00Z") });
    expect(b.request).toMatchObject({ receivedOn: "2026-10-30", deadline: "2026-11-10", skippedHolidays: ["2026-11-02 Traslado de Todos los Santos", "2026-11-09 Nuestra Señora de la Almudena"], provisionalIgnored: [] });
  });
});
