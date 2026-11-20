import { describe, expect, it, vi } from "vitest";
import { activatePlatformAfterPayment, type PlatformActivationDeps } from "./platformActivation";

const planLine = { kind: "catalog", chargeClass: "recurring", catalog: { family: "core_plan" } };
const terms = (over: Record<string, unknown> = {}) => ({ id: 7, companyId: 9, subscriptionId: 3, contractId: 13, status: "active", acceptanceStatus: "accepted", lines: [planLine], ...over });

function fixture(o: { terms?: unknown[]; company?: Record<string, unknown>; contacts?: unknown[]; sub?: Record<string, unknown> | null; activateFails?: boolean } = {}) {
  const company: Record<string, unknown> = { id: 9, name: "Several Energy", tenantId: null, ...(o.company ?? {}) };
  const sub = o.sub === null ? null : { id: 3, companyId: 9, tenantId: null as string | null, version: 1, status: "active", ...(o.sub ?? {}) };
  const log: Array<{ kind: string; syncResult: string }> = [];
  const activate = vi.fn(async () => {
    if (o.activateFails) throw new Error("El alta no se completó (dns): reintentar");
    return { tenantId: "several-energy" };
  });
  const linkTenant = vi.fn(async (_id: number, i: { tenantId: string }) => void (sub && (sub.tenantId = i.tenantId)));
  const update = vi.fn(async (_e: string, _id: number, patch: Record<string, unknown>) => void Object.assign(company, patch));
  const afterChange = vi.fn(async () => undefined);
  const deps: PlatformActivationDeps = {
    subscriptions: { get: async () => sub, linkTenant },
    terms: { get: async () => null, list: async () => (o.terms ?? [terms()]) as never, log: async (_id: number, e: Record<string, unknown>) => void log.push({ kind: String(e.kind), syncResult: String(e.syncResult) }) },
    crmStore: { get: async (e: string) => (e === "companies" ? company : { id: 13, modules: [], planId: null }), list: async () => (o.contacts ?? [{ id: 1, email: "admin@cliente.test", isPrimary: true, status: "active" }]) as never, update },
    platform: { activate },
    afterChange,
    now: () => 1_000,
  };
  return { deps, activate, linkTenant, update, afterChange, log, company, sub };
}

describe("alta de la plataforma tras el pago", () => {
  it("da de alta la plataforma, enlaza la suscripción y reaplica licencias y límites", async () => {
    const f = fixture();
    const r = await activatePlatformAfterPayment(f.deps, 3);
    expect(r).toEqual({ status: "activated", tenantId: "several-energy" });
    expect(f.activate).toHaveBeenCalledTimes(1);
    expect(f.company.tenantId).toBe("several-energy");
    expect(f.linkTenant).toHaveBeenCalledTimes(1);
    expect(f.afterChange).toHaveBeenCalledTimes(1);
    expect(f.log).toEqual([{ kind: "platform_activated", syncResult: "applied" }]);
  });

  it("una notificación repetida de Stripe o un reintento no crean otra plataforma", async () => {
    const f = fixture();
    await activatePlatformAfterPayment(f.deps, 3);
    const again = await activatePlatformAfterPayment(f.deps, 3);
    const third = await activatePlatformAfterPayment(f.deps, 3);
    expect(again).toEqual({ status: "already", tenantId: "several-energy" });
    expect(third.status).toBe("already");
    expect(f.activate).toHaveBeenCalledTimes(1);
    expect(f.linkTenant).toHaveBeenCalledTimes(1);
  });

  it("si la empresa ya tenía plataforma, solo enlaza la suscripción", async () => {
    const f = fixture({ company: { tenantId: "ya-existe" } });
    const r = await activatePlatformAfterPayment(f.deps, 3);
    expect(r).toEqual({ status: "already", tenantId: "ya-existe" });
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.linkTenant).toHaveBeenCalledWith(3, expect.objectContaining({ tenantId: "ya-existe" }), expect.any(String));
  });

  it("sin contacto con correo no se da de alta y queda el punto exacto para recuperarlo", async () => {
    const f = fixture({ contacts: [] });
    const r = await activatePlatformAfterPayment(f.deps, 3);
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.reason).toMatch(/contacto activo con correo/);
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.log).toEqual([{ kind: "platform_activation_failed", syncResult: "failed" }]);
  });

  it("un fallo del aprovisionamiento no lanza, queda registrado y el reintento lo completa", async () => {
    const f = fixture({ activateFails: true });
    const r = await activatePlatformAfterPayment(f.deps, 3);
    expect(r.status).toBe("failed");
    expect(f.company.tenantId).toBeNull();
    expect(f.log[0]).toEqual({ kind: "platform_activation_failed", syncResult: "failed" });
    f.deps.platform.activate = vi.fn(async () => ({ tenantId: "several-energy" }));
    expect((await activatePlatformAfterPayment(f.deps, 3)).status).toBe("activated");
  });

  it("un acuerdo sin plan Core o sin aceptar no da de alta nada", async () => {
    const economic = fixture({ terms: [terms({ lines: [{ kind: "custom", chargeClass: "recurring", catalog: null }] })] });
    expect((await activatePlatformAfterPayment(economic.deps, 3)).status).toBe("skipped");
    const pending = fixture({ terms: [terms({ acceptanceStatus: "pending" })] });
    expect((await activatePlatformAfterPayment(pending.deps, 3)).status).toBe("skipped");
    expect(economic.activate).not.toHaveBeenCalled();
    expect(pending.activate).not.toHaveBeenCalled();
  });

  it("una suscripción cancelada o inexistente se ignora", async () => {
    expect((await activatePlatformAfterPayment(fixture({ sub: null }).deps, 3)).status).toBe("skipped");
    expect((await activatePlatformAfterPayment(fixture({ sub: { status: "canceled" } }).deps, 3)).status).toBe("skipped");
  });
});
