/**
 * `catalog.stripePrepared` se guarda en la ficha del producto (CRM): sin él en el esquema, marcar a mano un producto
 * «bajo solicitud» para preparar su Product y su Price en Stripe (server/stripe/catalog.ts) era imposible.
 */
import { describe, it, expect } from "vitest";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { seedElephantSource } from "./catalog/seed";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const NOW = Date.UTC(2026, 10, 2, 9);

describe("preparación en Stripe desde la ficha del producto", () => {
  it("stripePrepared se guarda, se publica y se lee; un valor que no es booleano se rechaza", async () => {
    const store = new MemoryWebStore();
    const web = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => NOW });
    await seedElephantSource(web, store);
    const { entry: e } = await web.get("product", "connect-tax");
    const draft = structuredClone(e.draft) as { catalog?: Record<string, unknown> };
    draft.catalog = { ...(draft.catalog ?? {}), stripePrepared: true };
    const saved = await web.save("product", "connect-tax", { draft, expectedVersion: e.draftVersion }, "operator:test");
    await web.publish("product", "connect-tax", saved.draftVersion, "operator:test");
    const { entry: after } = await web.get("product", "connect-tax");
    expect((after.draft as { catalog?: { stripePrepared?: boolean } }).catalog?.stripePrepared).toBe(true);

    const bad = structuredClone(after.draft) as { catalog?: Record<string, unknown> };
    bad.catalog = { ...(bad.catalog ?? {}), stripePrepared: "sí" };
    await expect(web.save("product", "connect-tax", { draft: bad, expectedVersion: after.draftVersion }, "operator:test")).rejects.toThrow();
  });
});
