/**
 * Directorio de sedes de los módulos del SDK en multiempresa: misma fuente que el panel (canal con el plano de
 * control) o, sin canal, la sede principal implícita. Sin él, Ski Net y el resto de módulos por sede fallaban
 * cerrados en production («Directorio de sedes no configurado»).
 */
import { afterEach, describe, expect, it } from "vitest";
import { companySiteDirectory, setSiteSourceForTests, singleSite, type SiteSource } from "./sitesDb";
import { assertSite, configureSiteDirectory, SiteUnknown } from "./sdk";
import { runWithTenant } from "./_core/tenant";
import type { PanelSites } from "../shared/sites";

const sites = (rows: Array<{ siteId: string; status: string }>): PanelSites => ({
  ...singleSite(),
  sites: rows.map((r, i) => ({ ...singleSite().sites[0], siteId: r.siteId, name: r.siteId, status: r.status as "active", isPrimary: i === 0, virtual: false })),
});

const fakeSource = (byTenant: Record<string, PanelSites>, calls: string[]): SiteSource => {
  const no = async (): Promise<PanelSites> => {
    throw new Error("no");
  };
  return {
    list: async (t) => (calls.push(t), byTenant[t] ?? singleSite()),
    create: no,
    update: no,
    archive: no,
    restore: no,
  };
};

afterEach(() => {
  setSiteSourceForTests(undefined);
  configureSiteDirectory(null);
  delete process.env.TENANT_MODE;
});

describe("directorio de sedes del SDK", () => {
  it("sin canal con el plano de control: solo la sede principal implícita", async () => {
    process.env.TENANT_MODE = "multi";
    setSiteSourceForTests(null);
    expect(await companySiteDirectory.activeSites("acme")).toEqual(["principal"]);
  });

  it("con canal: solo las sedes activas de esa empresa", async () => {
    process.env.TENANT_MODE = "multi";
    const calls: string[] = [];
    setSiteSourceForTests(
      fakeSource(
        {
          acme: sites([
            { siteId: "principal", status: "active" },
            { siteId: "pista", status: "active" },
            { siteId: "vieja", status: "archived" },
          ]),
        },
        calls,
      ),
    );
    expect(await companySiteDirectory.activeSites("acme")).toEqual(["principal", "pista"]);
    expect(calls).toEqual(["acme"]);
  });

  it("assertSite con el directorio de la empresa: acepta la sede principal y rechaza las ajenas o archivadas", async () => {
    process.env.TENANT_MODE = "multi";
    setSiteSourceForTests(fakeSource({ acme: sites([{ siteId: "principal", status: "active" }, { siteId: "vieja", status: "archived" }]) }, []));
    configureSiteDirectory(companySiteDirectory);
    await runWithTenant("acme", () => assertSite("principal", "ski_rental"));
    await expect(runWithTenant("acme", () => assertSite("vieja", "ski_rental"))).rejects.toBeInstanceOf(SiteUnknown);
    await expect(runWithTenant("acme", () => assertSite("otra", "ski_rental"))).rejects.toBeInstanceOf(SiteUnknown);
  });
});
