/**
 * Fichas publicadas antes de que existiera un campo nuevo de la ficha (`forWho`): la publicación por lotes debe poder
 * reconstruir lo publicado desde el historial y volver a publicarlas. Si el esquema añadiera el campo con valor por
 * defecto, la reconstrucción no coincidiría con lo guardado y el lote bloquearía todas las fichas.
 */
import { describe, it, expect } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { importCommercialSpecs } from "./catalog/commercial/importSpecs";
import { planPublication, publishBatch } from "./catalog/commercial/publishBatch";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };

type Bag = { commercial?: Record<string, unknown> };
/** Quita `forWho` de lo publicado y del historial, como estaba todo antes del campo. */
function asLegacy(store: MemoryWebStore) {
  const s = store as unknown as { entries: Map<number, { published: Bag | null; draft: Bag }>; vers: Map<number, Array<{ snapshot: Bag }>> };
  for (const e of Array.from(s.entries.values())) {
    delete e.published?.commercial?.forWho;
    delete e.draft.commercial?.forWho;
  }
  for (const vs of Array.from(s.vers.values())) for (const v of vs) delete v.snapshot.commercial?.forWho;
}

describe("fichas publicadas antes del campo «para quién»", () => {
  it("se reconstruyen desde el historial y se vuelven a publicar con el campo nuevo", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    await importCommercialSpecs(svc, store, { dryRun: false });
    await publishBatch(svc, store, { apply: true });
    asLegacy(store);

    await importCommercialSpecs(svc, store, { dryRun: false });
    const plan = await planPublication(svc, store);
    const people = plan.find((p) => p.key === "connect-people")!;
    expect(people.reasons).toEqual([]);
    expect(people.decision).toBe("publish");
    expect(plan.filter((p) => p.reasons.some((r) => /reconstruir/.test(r)))).toEqual([]);

    await publishBatch(svc, store, { apply: true });
    const site = await svc.publicSite("published");
    const pub = site.catalog.products.find((p) => p.key === "connect-people") as unknown as { commercial: { forWho?: string } };
    expect(pub.commercial.forWho).toBe("Empresas con personal contratado.");
  });
});
