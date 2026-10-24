/**
 * Carrera entre réplicas con la MISMA clave de idempotencia (causa de la prueba intermitente de crm.mysql.test.ts):
 * B consulta la clave (aún no existe), A inserta y B llega a la comprobación de «repetida por contenido». Debe responder
 * «replayed» (es un reintento), no «duplicate», y no anotar una solicitud repetida en el lead.
 */
import { describe, it, expect } from "vitest";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { WebRequestService, type WebRequestInput } from "./crm/webRequests";

const input: WebRequestInput = {
  type: "trial",
  name: "Carrera",
  email: "carrera@ejemplo.example",
  company: "Empresa Carrera",
  configuration: { plan: "business", extensions: [], industries: [], interests: [] },
  marketingConsent: false,
  privacyVersion: "v",
} as WebRequestInput;

describe("solicitudes web: carrera entre réplicas con la misma clave", () => {
  it("la segunda réplica responde «replayed» aunque la clave no existiera al empezar", async () => {
    const store = new MemoryCrmStore();
    const crm = new CrmService({ store });
    const a = new WebRequestService({ store, crm });
    // Réplica B: su primera consulta por clave llega ANTES de que A inserte (devuelve vacío)
    let firstLookup = true;
    const storeB = new Proxy(store, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r);
        if (p !== "list" || typeof v !== "function") return typeof v === "function" ? v.bind(t) : v;
        return async (table: string, filter: Record<string, unknown>, opts?: unknown) => {
          if (table === "leadRequests" && filter && "idempotencyKey" in filter && firstLookup) {
            firstLookup = false;
            await a.receive(input, { idempotencyKey: "clave-1", ipHash: null }); // A inserta en ese hueco
            return [];
          }
          return v.call(t, table, filter, opts);
        };
      },
    }) as MemoryCrmStore;
    const b = new WebRequestService({ store: storeB, crm });
    const rb = await b.receive(input, { idempotencyKey: "clave-1", ipHash: null });
    expect(rb.outcome).toBe("replayed");
    const all = await store.list("leadRequests", {});
    expect(all).toHaveLength(1);
    expect(rb.request.id).toBe(all[0].id);
    const notes = (await store.list("activities", {})).map((x) => x.summary);
    expect(notes.some((s) => s.startsWith("Solicitud web repetida"))).toBe(false);
  });

  it("con OTRA clave y el mismo contenido sigue siendo «duplicate»", async () => {
    const store = new MemoryCrmStore();
    const s = new WebRequestService({ store, crm: new CrmService({ store }) });
    expect((await s.receive(input, { idempotencyKey: "k1", ipHash: null })).outcome).toBe("created");
    expect((await s.receive(input, { idempotencyKey: "k2", ipHash: null })).outcome).toBe("duplicate");
  });
});
