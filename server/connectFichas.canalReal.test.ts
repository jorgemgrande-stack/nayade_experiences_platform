/**
 * Marketplace del Core con la forma REAL del canal (PR #567): el catálogo del panel que publica el plano de control a
 * partir del catálogo oficial sembrado (con `card` y la entrada de cada producto) pasa por la lectura tolerante del
 * Core sin perder productos ni inventar nada, y el cuerpo de las solicitudes del Core cumple el esquema del canal.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { WebAdminService, type SiteDocument } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { panelCatalog, type PanelCatalog } from "./commerce/panelCatalog";
import { panelRequestBody } from "./commerce/panelRequests";
import { buildConnectCatalog } from "./connectMarketplace";
import { advertisesRequests, parseConnectCard } from "./connectCard";
import type { ModuleRequestInput } from "./commerceClient";

const NOW = Date.UTC(2026, 10, 1, 12);
let site: SiteDocument;
let published: PanelCatalog;

beforeAll(async () => {
  const store = new MemoryWebStore();
  const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
  await seedElephantSource(web, store);
  site = await web.site("published");
  published = panelCatalog(quoteCatalogFromSite(site).products, { version: "v", purchasesEnabled: false, site });
});

describe("canal real → marketplace del Core", () => {
  it("cada producto trae `card` (objeto o null) y el Core la lee sin errores", () => {
    expect(published.items.length).toBeGreaterThan(20);
    for (const i of published.items) {
      expect("card" in i).toBe(true);
      expect(() => parseConnectCard(i.card)).not.toThrow();
    }
    // La versión del canal con fichas trae también las solicitudes
    expect(advertisesRequests(published)).toBe(true);
  });

  it("ningún producto se pierde; la ficha sale del catálogo central y nada interno llega al panel", () => {
    const items = buildConnectCatalog(published, [], NOW, "business");
    expect(items.map((i) => i.key).sort()).toEqual(published.items.map((i) => i.key).sort());
    const withCard = published.items.filter((i) => i.card).map((i) => i.key);
    expect(withCard.length).toBeGreaterThan(0);
    for (const i of items) {
      if (withCard.includes(i.key)) expect(i.contentSource).toBe("card");
      for (const p of i.prices) expect(p.amountCents).toBeGreaterThanOrEqual(0);
      expect(i.sheet.related.every((k) => published.items.some((x) => x.key === k))).toBe(true);
    }
    expect(JSON.stringify(items)).not.toMatch(/"internal"|costCents|marginNote|evidence|reasons":\["(?:Se ofrecerá|La prueba|El checkout)/);
  });

  it("el cuerpo de la solicitud del Core cumple el esquema del canal (`info` y `waitlist`)", () => {
    for (const type of ["info", "waitlist"] as const) {
      const body: ModuleRequestInput = { type, interest: "connect-people", message: "Somos 12", requester: { name: "Ana Pérez", email: "ana@empresa.example" }, idempotencyKey: "cx-" + "a".repeat(40) };
      expect(panelRequestBody.safeParse(body).success).toBe(true);
    }
  });
});
