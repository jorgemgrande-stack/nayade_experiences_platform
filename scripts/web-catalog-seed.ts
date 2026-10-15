/**
 * Carga inicial del catálogo comercial y los contenidos de la web (db/crm/seeds/web-catalog.seed.json).
 *
 *   WEB_SEED_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/web-catalog-seed.ts                       # simulación
 *   WEB_SEED_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/web-catalog-seed.ts --apply               # crea borradores
 *   WEB_SEED_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/web-catalog-seed.ts --apply --publish-baseline
 *
 * - Solo crea lo que no existe: nunca sobrescribe lo editado en el CRM.
 * - Crea BORRADORES sin precios: nada se inventa ni se publica por defecto.
 * - `--publish-baseline` publica (en orden de dependencias) las entradas de la semilla que sigan en su
 *   versión 1 sin publicar: reproduce lo que la web ya muestra hoy. Es una decisión explícita.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { BUILTIN_MODULES } from "../server/_core/modules/builtin";
import { WebAdminService } from "../server/web/service";
import { MemoryWebStore, MysqlWebStore, type WebStore } from "../server/web/store";
import type { EntryKind } from "../server/web/schemas";

const AUTHOR = "seed:baseline";
const FAMILY_ORDER = ["core_plan", "industry_module", "extension", "usage", "service"];

interface SeedEntry {
  kind: EntryKind;
  key: string;
  family?: string;
  sortOrder?: number;
  draft: unknown;
}
export function loadSeed(file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/crm/seeds/web-catalog.seed.json")): SeedEntry[] {
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { entries: SeedEntry[] }).entries;
}
const order = (e: SeedEntry) => (e.kind === "product" ? FAMILY_ORDER.indexOf(e.family ?? "") : e.kind === "promotion" ? 10 : 20);

export async function seed(store: WebStore, opts: { publish: boolean; log?: (s: string) => void }) {
  const log = opts.log ?? (() => undefined);
  const svc = new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
  const entries = loadSeed().sort((a, b) => order(a) - order(b));
  let created = 0;
  let published = 0;
  for (const e of entries) {
    if (await store.getEntry(e.kind, e.key)) {
      log(`  = ${e.kind}:${e.key} ya existe (no se toca)`);
      continue;
    }
    await svc.create({ kind: e.kind, key: e.key, family: e.family ?? null, sortOrder: e.sortOrder, draft: e.draft }, AUTHOR);
    created += 1;
    log(`  + ${e.kind}:${e.key} (borrador)`);
  }
  if (opts.publish) {
    for (const e of entries) {
      const cur = await store.getEntry(e.kind, e.key);
      if (!cur || cur.publication !== "draft" || cur.draftVersion !== 1 || cur.createdBy !== AUTHOR) continue;
      await svc.publish(e.kind, e.key, 1, AUTHOR);
      published += 1;
      log(`  ↑ ${e.kind}:${e.key} publicada`);
    }
  }
  return { created, published };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const publish = process.argv.includes("--publish-baseline");
  const url = process.env.WEB_SEED_DATABASE_URL;
  if (!apply) {
    // Simulación completa en memoria: valida la semilla y el orden de publicación sin tocar ninguna BD
    const r = await seed(new MemoryWebStore(), { publish, log: console.log });
    console.log(`[simulación] ${r.created} borradores${publish ? `, ${r.published} publicadas` : ""}. Usa --apply para escribir.`);
    return;
  }
  if (!url) throw new Error("Falta WEB_SEED_DATABASE_URL (BD del CRM con la migración 0004)");
  const pool = mysql.createPool({ uri: url, connectionLimit: 2 });
  try {
    const r = await seed(new MysqlWebStore(pool), { publish, log: console.log });
    console.log(`Hecho: ${r.created} borradores creados${publish ? `, ${r.published} publicadas` : ""}. Sin precios.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
