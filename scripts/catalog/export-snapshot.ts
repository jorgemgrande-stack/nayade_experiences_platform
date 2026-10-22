/**
 * Exporta la instantánea PÚBLICA del catálogo oficial de Elephant Source (lo mismo que serviría
 * `/cp/v1/public/site` con la semilla publicada) para que la web la use en desarrollo y como
 * respaldo de compilación. Es un fichero GENERADO: la web no mantiene precios escritos a mano.
 *
 *   pnpm exec tsx scripts/catalog/export-snapshot.ts <ruta-de-salida.json>
 *
 * Determinista: misma semilla → mismo fichero (y misma `version`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_MODULES } from "../../server/_core/modules/builtin";
import { CATALOG_VERSION, NET_FAMILIES } from "../../server/catalog/elephantSourceV1";
import { seedElephantSource } from "../../server/catalog/seed";
import { WebAdminService } from "../../server/web/service";
import { MemoryWebStore } from "../../server/web/store";
import { REPOSITORIES } from "../../shared/repositories";

const FIXED_NOW = Date.UTC(2026, 9, 16);

/** SHA-256 de server/catalog/quote.ts con finales de línea LF (igual en Windows y en Linux). */
function quoteEngineSha256(): string {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/catalog/quote.ts"), "utf8").split("\r\n").join("\n");
  return crypto.createHash("sha256").update(src).digest("hex");
}

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("Uso: export-snapshot.ts <ruta-de-salida.json>");
    process.exit(1);
  }
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null }, now: () => FIXED_NOW });
  await seedElephantSource(svc, store);
  const site = await svc.publicSite("published");
  const doc = {
    _generated: `GENERADO desde ${REPOSITORIES.core} (server/catalog/elephantSourceV1.ts, ${CATALOG_VERSION}). No editar a mano: regenerar con scripts/catalog/export-snapshot.ts.`,
    catalogVersion: CATALOG_VERSION,
    // Huella del cotizador (server/catalog/quote.ts, finales de línea LF): la web guarda una copia
    // generada y su CI comprueba que coincide; así nunca calcula con una versión distinta.
    quoteEngineSha256: quoteEngineSha256(),
    netFamilies: NET_FAMILIES,
    site: { version: site.version, generatedAt: site.generatedAt, preview: false, catalog: site.catalog, content: site.content },
  };
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Instantánea ${site.version}: ${site.catalog.products.length} productos, ${site.catalog.capabilities.length} capacidades → ${out}`);
}

void main();
