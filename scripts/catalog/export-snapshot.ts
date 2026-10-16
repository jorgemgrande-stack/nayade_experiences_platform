/**
 * Exporta la instantánea PÚBLICA del catálogo oficial de Elephant Source (lo mismo que serviría
 * `/cp/v1/public/site` con la semilla publicada) para que la web la use en desarrollo y como
 * respaldo de compilación. Es un fichero GENERADO: la web no mantiene precios escritos a mano.
 *
 *   pnpm exec tsx scripts/catalog/export-snapshot.ts <ruta-de-salida.json>
 *
 * Determinista: misma semilla → mismo fichero (y misma `version`).
 */
import fs from "node:fs";
import { BUILTIN_MODULES } from "../../server/_core/modules/builtin";
import { CATALOG_VERSION, NET_FAMILIES } from "../../server/catalog/elephantSourceV1";
import { seedElephantSource } from "../../server/catalog/seed";
import { WebAdminService } from "../../server/web/service";
import { MemoryWebStore } from "../../server/web/store";

const FIXED_NOW = Date.UTC(2026, 9, 16);

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("Uso: export-snapshot.ts <ruta-de-salida.json>");
    process.exit(1);
  }
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => FIXED_NOW });
  await seedElephantSource(svc, store);
  const site = await svc.site("published");
  const doc = {
    _generated: `GENERADO desde nayade_experiences_platform (server/catalog/elephantSourceV1.ts, ${CATALOG_VERSION}). No editar a mano: regenerar con scripts/catalog/export-snapshot.ts.`,
    catalogVersion: CATALOG_VERSION,
    netFamilies: NET_FAMILIES,
    site: { version: site.version, generatedAt: site.generatedAt, preview: false, catalog: site.catalog, content: site.content },
  };
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Instantánea ${site.version}: ${site.catalog.products.length} productos, ${site.catalog.capabilities.length} capacidades → ${out}`);
}

void main();
