/**
 * Alta de dominios propios en Railway (server/controlPlane/domainProvider.ts): idempotente, estado del certificado y
 * modo manual sin token. Railway simulado (sin red).
 */
import { describe, it, expect } from "vitest";
import { certificateState, domainProviderFromEnv, railwayDomainProvider } from "./controlPlane/domainProvider";

const TOKEN = "ci-only-placeholder-not-a-secret-1";

function fakeRailway(initial: Array<{ id: string; domain: string; status?: { certificateStatus?: string } }> = []) {
  const domains = [...initial];
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetch = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    headers.push(init.headers);
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, any> };
    const reply = (data: unknown) => ({ status: 200, json: async () => ({ data }) });
    if (query.includes("projectToken")) return (calls.push("scope"), reply({ projectToken: { projectId: "p1", environmentId: "e1" } }));
    if (query.includes("project(id")) return reply({ project: { services: { edges: [{ node: { id: "s-web", name: "web" } }, { node: { id: "s-gw", name: "core-gateway" } }] } } });
    if (query.includes("customDomains")) return (calls.push("list"), reply({ domains: { customDomains: domains } }));
    if (query.includes("customDomainCreate")) {
      calls.push(`create:${variables.i.domain}:${variables.i.serviceId}:${variables.i.targetPort}`);
      domains.push({ id: "d2", domain: variables.i.domain, status: { certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP" } });
      return reply({ customDomainCreate: { id: "d2" } });
    }
    return { status: 400, json: async () => ({ errors: [{ message: "consulta desconocida" }] }) };
  };
  return { fetch, calls, headers, domains };
}

describe("dominios propios en Railway", () => {
  it("da de alta el dominio en core-gateway una sola vez y devuelve el estado del certificado", async () => {
    const r = fakeRailway();
    const p = railwayDomainProvider({ token: TOKEN, fetch: r.fetch });
    const first = await p.ensure("Reservas.Cliente.example");
    expect(first).toMatchObject({ provider: "railway", registered: true, certificate: "pending" });
    expect(r.calls.filter((c) => c.startsWith("create"))).toEqual(["create:reservas.cliente.example:s-gw:8080"]);
    await p.ensure("reservas.cliente.example");
    expect(r.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
    expect(r.calls.filter((c) => c === "scope")).toHaveLength(1);
    expect(r.headers.every((h) => h["Project-Access-Token"] === TOKEN)).toBe(true);
  });

  it("estado de un dominio existente, inexistente y emitido", async () => {
    const r = fakeRailway([{ id: "d1", domain: "tienda.cliente.example", status: { certificateStatus: "CERTIFICATE_STATUS_TYPE_ISSUED" } }]);
    const p = railwayDomainProvider({ token: TOKEN, fetch: r.fetch });
    expect(await p.status("tienda.cliente.example")).toMatchObject({ registered: true, certificate: "issued" });
    expect(await p.status("otro.cliente.example")).toMatchObject({ registered: false, certificate: "unknown" });
  });

  it("un error de Railway se propaga sin el token", async () => {
    const p = railwayDomainProvider({ token: TOKEN, fetch: async () => ({ status: 401, json: async () => ({ errors: [{ message: "Not Authorized" }] }) }) });
    const e = (await p.status("x.cliente.example").catch((x) => x)) as Error;
    expect(e.message).toMatch(/Not Authorized/);
    expect(e.message).not.toContain(TOKEN);
  });

  it("sin token, proveedor manual; traducción de estados", async () => {
    const m = domainProviderFromEnv({});
    expect(m.name).toBe("manual");
    expect(await m.ensure("x.cliente.example")).toMatchObject({ provider: "manual", registered: false });
    expect(domainProviderFromEnv({ CP_RAILWAY_DOMAIN_TOKEN: TOKEN }).name).toBe("railway");
    expect(certificateState("CERTIFICATE_STATUS_TYPE_ISSUED")).toBe("issued");
    expect(certificateState("CERTIFICATE_STATUS_TYPE_FAILED")).toBe("failed");
    expect(certificateState("CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP")).toBe("pending");
    expect(certificateState(undefined)).toBe("unknown");
  });
});
