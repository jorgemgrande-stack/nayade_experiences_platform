/**
 * Listado de entradas del catálogo (`GET /web/entries`, `WebAdminService.list`): cada producto dice si es HEREDADO
 * (`catalog.legacy`: retirado de la venta) y qué producto lo sustituye, para que el CRM lo marque sin abrir cada ficha.
 * Campo aditivo: `null` en los productos que no lo son y en las entradas que no son productos.
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

describe("listado de entradas: productos heredados", () => {
  it("marca el producto heredado con su fecha y el que lo sustituye; el resto, null", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
    await seedElephantSource(svc, store);
    const e = (await store.getEntry("product", "hotel-net-pms"))!;
    const d = productDraft.parse(e.draft);
    await svc.save("product", "hotel-net-pms", { draft: { ...d, catalog: { ...d.catalog, legacy: { since: "2026-11-09", replacedBy: "hotel-net-complete" } } }, expectedVersion: e.draftVersion }, "operator:1");

    const products = await svc.list("product");
    expect(products.find((p) => p.key === "hotel-net-pms")!.legacy).toEqual({ since: "2026-11-09", replacedBy: "hotel-net-complete" });
    expect(products.find((p) => p.key === "hotel-net-complete")!.legacy).toBeNull();
    expect(products.find((p) => p.key === "essential")!.legacy).toBeNull();
    // El resto del resumen no cambia de forma
    expect(products.find((p) => p.key === "hotel-net-pms")).toMatchObject({ kind: "product", family: "net_module", name: "Hotel Net · PMS", pendingChanges: true });
    // Las entradas que no son productos nunca lo llevan
    for (const c of await svc.list("capability")) expect(c.legacy, c.key).toBeNull();
  });
});
