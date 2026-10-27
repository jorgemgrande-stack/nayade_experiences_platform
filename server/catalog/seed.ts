/**
 * Carga el catálogo oficial de Elephant Source v1 en el catálogo comercial (server/web) por el flujo
 * NORMAL: crear o guardar borrador → publicar → añadir precio → aprobar (que retira el anterior).
 * Todo queda auditado con el autor de la semilla.
 *
 * Idempotente: lo que ya coincide no se toca. Con `dryRun` solo calcula el plan de cambios.
 * Nunca despublica ni borra: si algo sobra, se informa y se decide a mano desde el CRM.
 */
import { CAPABILITIES } from "./capabilities";
import { CATALOG_VERSION, PRODUCTS, TAX_RATE_BP } from "./elephantSourceV1";
import { DRAFT_SCHEMAS, productDraft, type EntryKind } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";

export const SEED_AUTHOR = `catalogo:${CATALOG_VERSION}`;

export interface SeedReport {
  dryRun: boolean;
  created: string[];
  updated: string[];
  published: string[];
  pricesApproved: string[];
  unchanged: number;
  conflicts: string[];
  /** Borradores pendientes que no son de la semilla (fichas importadas, ediciones del CRM): no los publica. */
  pending: string[];
}

const same = (kind: EntryKind, a: unknown, b: unknown) => JSON.stringify(DRAFT_SCHEMAS[kind].parse(a)) === JSON.stringify(DRAFT_SCHEMAS[kind].parse(b));

/**
 * El borrador de la semilla con lo que decide el CRM y ya tiene la BD: estado comercial y su evidencia, ficha
 * comercial, política (inclusiones, cupos propuestos, ampliación por presupuesto, regla de paquetes, nivel de
 * implantación) y su información interna de revisión. La semilla nunca los borra ni los revierte.
 */
export function keepCommercialState(seedDraft: unknown, dbDraft: unknown): unknown {
  const s = productDraft.parse(seedDraft);
  const d = productDraft.parse(dbDraft);
  const kept = <T extends object>(o: T, keys: Array<keyof T>) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    ...s,
    ...(d.commercial ? { commercial: d.commercial } : {}),
    catalog: { ...s.catalog, commercialStatus: d.catalog.commercialStatus, ...kept(d.catalog, ["inclusions", "quotaProposals", "quoteOnRequest", "bundleRule", "implementationLevel"]) },
    internal: { ...s.internal, evidence: d.internal.evidence ?? s.internal.evidence, ...kept(d.internal, ["functionalGrade", "sources", "pendingDecisions"]) },
  };
}

export async function seedElephantSource(svc: WebAdminService, store: WebStore, opts: { dryRun?: boolean; author?: string } = {}): Promise<SeedReport> {
  const dryRun = !!opts.dryRun;
  const author = opts.author ?? SEED_AUTHOR;
  const r: SeedReport = { dryRun, created: [], updated: [], published: [], pricesApproved: [], unchanged: 0, conflicts: [], pending: [] };

  const upsert = async (kind: EntryKind, key: string, seedDraft: unknown, sortOrder: number, family: string | null) => {
    const cur = await store.getEntry(kind, key);
    // Fuente de verdad única: en una BD existente, el estado comercial y su evidencia los decide el CRM (con historial);
    // la semilla nunca los revierte. Para cambiarlos en bloque, una revisión con estado de partida (review*.ts)
    const draft = kind === "product" && cur ? keepCommercialState(seedDraft, cur.draft) : seedDraft;
    let changed = false;
    if (!cur) {
      r.created.push(`${kind}:${key}`);
      changed = true;
      if (!dryRun) await svc.create({ kind, key, family, sortOrder, draft }, author);
    } else {
      if (kind === "product" && cur.family !== family) {
        r.conflicts.push(`${key}: familia ${cur.family} en BD frente a ${family} en el catálogo (no se cambia; revisar a mano)`);
        return;
      }
      if (!same(kind, cur.draft, draft) || cur.sortOrder !== sortOrder) {
        r.updated.push(`${kind}:${key}`);
        changed = true;
        if (!dryRun) await svc.save(kind, key, { draft, sortOrder, expectedVersion: cur.draftVersion }, author);
      }
    }
    const now = dryRun ? cur : await store.getEntry(kind, key);
    // Un borrador pendiente que no ha escrito la semilla (una ficha importada, una edición del CRM) se publica desde el
    // CRM o con la publicación por lotes, con sus comprobaciones: la semilla nunca lo publica de rebote
    if (now && !changed && now.publication === "published" && now.publishedVersion !== now.draftVersion) {
      r.pending.push(`${kind}:${key}`);
      return;
    }
    const needsPublish = !now || now.publication !== "published" || changed;
    if (needsPublish) {
      r.published.push(`${kind}:${key}`);
      if (!dryRun) {
        const e = (await store.getEntry(kind, key))!;
        try {
          await svc.publish(kind, key, e.draftVersion, author);
        } catch (err) {
          // Queda en borrador con su causa (p. ej. una ficha que todavía no puede publicarse)
          r.published.pop();
          r.conflicts.push(`${key}: no publicado (${err instanceof Error ? err.message : String(err)})`);
        }
      }
    } else r.unchanged++;
  };

  // 1. Capacidades (antes que los productos que las referencian)
  let i = 0;
  for (const c of CAPABILITIES) {
    i += 1;
    await upsert("capability", c.id, { name: c.name, description: "", tier: c.tier, group: c.group, technicalStatus: c.technicalStatus }, i, null);
  }
  // 2. Productos en orden: planes base → módulos → paquetes (dependencias antes que dependientes)
  for (const p of PRODUCTS) await upsert("product", p.key, p.draft, p.sortOrder, p.family);

  // 3. Precios aprobados: se añade y aprueba solo si no hay ya uno vigente idéntico
  for (const p of PRODUCTS) {
    const entry = await store.getEntry("product", p.key);
    const existing = entry ? await store.listPrices(entry.id) : [];
    for (const sp of p.prices) {
      const unit = sp.unit ?? null;
      const vigente = existing.find((x) => x.status === "approved" && x.kind === sp.kind && x.currency === "EUR" && (x.unit ?? null) === unit);
      if (vigente && vigente.amountCents === sp.amountCents && vigente.taxRateBp === TAX_RATE_BP && !vigente.taxIncluded) continue;
      r.pricesApproved.push(`${p.key} ${sp.kind} ${sp.amountCents}`);
      if (dryRun) continue;
      const draft = await svc.addPrice(p.key, { kind: sp.kind, amountCents: sp.amountCents, currency: "EUR", unit, taxRateBp: TAX_RATE_BP, taxIncluded: false, note: `Tarifa oficial ${CATALOG_VERSION}` }, author);
      await svc.approvePrice(draft.id, author);
    }
  }
  return r;
}
