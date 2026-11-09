/** SEO Control: una sola auditoría a la vez por empresa (candado en memoria → CONFLICT), sin red ni base real. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageGetter, PageResponse } from "./seoControl/crawler";

const state = { tenant: "empresa-a" };
vi.mock("./_core/tenant", async (orig) => ({ ...(await orig<object>()), isMultiTenant: () => true, getTenantIdOrDefault: () => state.tenant }));
vi.mock("./_core/tenantIdentity", () => ({
  warmTenantIdentity: async () => ({ publicHost: `${state.tenant}.qa.example`, publicHostKind: "platform", customDomains: [] }),
}));
// Base de datos falsa: consultas vacías e inserciones con identificador
const fakeDb = {
  execute: async (q: unknown) => {
    const text = JSON.stringify(q);
    return /SELECT/i.test(text) ? [[]] : [{ insertId: 1, affectedRows: 1 }];
  },
};
vi.mock("./db", () => ({ getDb: async () => fakeDb }));

const { runAudit, AUDIT_RUNNING_MESSAGE, __setSeoCrawlDepsForTests } = await import("./seoControlDb");

const page = (status: number, body = ""): PageResponse => ({ status, location: null, contentType: "text/html; charset=utf-8", xRobotsTag: null, body, bytes: body.length });
const actor = { userId: 1, role: "admin" };

describe("candado de la auditoría de SEO Control", () => {
  afterEach(() => {
    __setSeoCrawlDepsForTests(null);
    state.tenant = "empresa-a";
  });

  it("con una auditoría en curso, otra de la misma empresa responde CONFLICT; al terminar se puede lanzar de nuevo", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let gets = 0;
    const get: PageGetter = async () => {
      gets++;
      await gate;
      return page(404);
    };
    __setSeoCrawlDepsForTests({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], get });

    const first = runAudit({}, actor);
    await expect(runAudit({}, actor)).rejects.toMatchObject({ code: "CONFLICT", message: AUDIT_RUNNING_MESSAGE });

    // Otra empresa no queda bloqueada por la primera
    state.tenant = "empresa-b";
    const other = runAudit({}, actor);
    state.tenant = "empresa-a";

    release();
    await first;
    await other;
    expect(gets).toBeGreaterThan(0);
    // Liberado: una nueva auditoría de la misma empresa ya no da CONFLICT
    await expect(runAudit({}, actor)).resolves.toBeDefined();
  });

  it("si la auditoría falla, el candado también se libera", async () => {
    __setSeoCrawlDepsForTests({
      resolve: async () => {
        throw new Error("sin DNS");
      },
      get: async () => page(200),
    });
    await runAudit({}, actor).catch(() => undefined);
    __setSeoCrawlDepsForTests({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], get: async () => page(404) });
    await expect(runAudit({}, actor)).resolves.toBeDefined();
  });
});
