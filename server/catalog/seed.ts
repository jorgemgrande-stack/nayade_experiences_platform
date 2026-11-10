/**
 * Carga el catálogo oficial de Elephant Source v1 en el catálogo comercial (server/web) por el flujo
 * NORMAL: crear o guardar borrador → publicar → añadir precio → aprobar (que retira el anterior).
 * Todo queda auditado con el autor de la semilla.
 *
 * Idempotente: lo que ya coincide no se toca. Con `dryRun` solo calcula el plan de cambios.
 * Nunca despublica ni borra: si algo sobra, se informa y se decide a mano desde el CRM.
 *
 * LA SEMILLA SOLO ESCRIBE SOBRE LO SUYO (10/11/2026). En una BD con vida (production), el catálogo lo deciden el CRM y
 * las revisiones de catálogo (review*.ts), con su historial. Como las revisiones, la semilla respeta lo que otro autor
 * guardó o publicó y lo LISTA como conflicto, sin escribir:
 *  - Crea lo que falta (entrada, publicación y precios).
 *  - Actualiza una entrada solo si sigue siendo suya: el último guardado es de la semilla y, si está publicada, también
 *    la publicó ella. Si otro autor la guardó, la publicó o la despublicó, no la toca: las diferencias con la semilla
 *    salen en `conflicts` y, si además tiene un borrador pendiente, en `pending`. Nunca sobrescribe ni publica un borrador
 *    ajeno, ni vuelve a publicar lo que el CRM despublicó.
 *  - Precios: aprueba una tarifa solo en una entrada suya y si todos los precios de ese tipo los creó, aprobó y retiró la
 *    propia semilla. Si alguien aprobó o retiró un precio en el CRM, manda el CRM: la semilla nunca vuelve a aprobar un
 *    precio retirado ni sustituye el vigente; la diferencia sale en `conflicts`.
 */
import { CAPABILITIES } from "./capabilities";
import { CATALOG_VERSION, PRODUCTS, TAX_RATE_BP, type SeedProduct } from "./elephantSourceV1";
import { DRAFT_SCHEMAS, productDraft, type EntryKind } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebEntry, WebPrice, WebStore } from "../web/store";

export const SEED_AUTHOR = `catalogo:${CATALOG_VERSION}`;

export interface SeedReport {
  dryRun: boolean;
  created: string[];
  updated: string[];
  published: string[];
  pricesApproved: string[];
  unchanged: number;
  /** Lo que la semilla no ha escrito por respetar lo guardado o publicado por otro autor (con sus diferencias), y lo que no se pudo publicar. */
  conflicts: string[];
  /** Borradores pendientes que no son de la semilla (fichas importadas, ediciones del CRM): ni los sobrescribe ni los publica. */
  pending: string[];
}

const normal = (kind: EntryKind, v: unknown) => DRAFT_SCHEMAS[kind].parse(v) as Record<string, unknown>;
const same = (kind: EntryKind, a: unknown, b: unknown) => JSON.stringify(normal(kind, a)) === JSON.stringify(normal(kind, b));

/**
 * El borrador de la semilla con lo que decide el CRM y ya tiene la BD: estado comercial y su evidencia, ficha
 * comercial, política (inclusiones, cupos propuestos, ampliación por presupuesto, regla de paquetes, nivel de
 * implantación) y su información interna de revisión. La semilla nunca los borra ni los revierte.
 * `catalog.coreIncluded` NO se conserva: la regla «Core incluido» está retirada (10/11/2026).
 */
export function keepCommercialState(seedDraft: unknown, dbDraft: unknown): unknown {
  const s = productDraft.parse(seedDraft);
  const d = productDraft.parse(dbDraft);
  const kept = <T extends object>(o: T, keys: Array<keyof T>) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    ...s,
    ...(d.commercial ? { commercial: d.commercial } : {}),
    catalog: { ...s.catalog, commercialStatus: d.catalog.commercialStatus, ...kept(d.catalog, ["inclusions", "quotaProposals", "quoteOnRequest", "bundleRule", "implementationLevel", "legacy", "offer", "stripePrepared"]) },
    internal: { ...s.internal, evidence: d.internal.evidence ?? s.internal.evidence, ...kept(d.internal, ["functionalGrade", "sources", "pendingDecisions"]) },
  };
}

/** Campos (hasta dos niveles) en los que dos borradores difieren, para el informe. */
function differingFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  for (const k of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const x = a[k];
    const y = b[k];
    if (isObj(x) && isObj(y)) {
      for (const j of Array.from(new Set([...Object.keys(x), ...Object.keys(y)])).sort()) if (JSON.stringify(x[j]) !== JSON.stringify(y[j])) out.push(`${k}.${j}`);
    } else out.push(k);
  }
  return out;
}

const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
const kindName = (k: string) => (k === "monthly" ? "mensual" : k === "yearly" ? "anual" : k);

/**
 * `products`: otra lista de productos en lugar de la oficial. Solo para pruebas que necesitan el catálogo de una fecha
 * anterior (server/catalog/seedHistory.testkit.ts); la orden de siembra usa siempre la oficial.
 */
export async function seedElephantSource(svc: WebAdminService, store: WebStore, opts: { dryRun?: boolean; author?: string; products?: readonly SeedProduct[] } = {}): Promise<SeedReport> {
  const dryRun = !!opts.dryRun;
  const author = opts.author ?? SEED_AUTHOR;
  const products = opts.products ?? PRODUCTS;
  const r: SeedReport = { dryRun, created: [], updated: [], published: [], pricesApproved: [], unchanged: 0, conflicts: [], pending: [] };
  /** Productos que la semilla puede seguir escribiendo: los crea ahora o siguen siendo suyos. */
  const own = new Set<string>();

  /** La entrada sigue siendo de la semilla: su último guardado y, si está publicada, su publicación. */
  const isOwn = (e: WebEntry) => e.updatedBy === author && (e.publication === "draft" || (e.publication === "published" && e.publishedBy === author));

  const upsert = async (kind: EntryKind, key: string, seedDraft: unknown, sortOrder: number, family: string | null) => {
    const id = `${kind}:${key}`;
    const cur = await store.getEntry(kind, key);
    if (cur && kind === "product" && cur.family !== family) {
      r.conflicts.push(`${key}: familia ${cur.family} en BD frente a ${family} en el catálogo (no se cambia; revisar a mano)`);
      return;
    }
    // Fuente de verdad única: en una BD existente, el estado comercial y su evidencia los decide el CRM (con historial);
    // la semilla nunca los revierte. Para cambiarlos en bloque, una revisión con estado de partida (review*.ts)
    const draftFor = (db: unknown) => (kind === "product" ? keepCommercialState(seedDraft, db) : seedDraft);

    if (cur && !isOwn(cur)) {
      // De otro autor (el CRM o una revisión): se respeta. Solo se informa de en qué difiere de la semilla
      const upToDate = cur.publication === "published" && cur.publishedVersion === cur.draftVersion;
      if (cur.publication === "published" && !upToDate) r.pending.push(id);
      const reference = cur.publication === "published" && cur.published ? cur.published : cur.draft;
      // La información interna (notas, evidencia) no se publica ni viaja en lo publicado: no cuenta como diferencia
      const diff = differingFields(normal(kind, reference), normal(kind, draftFor(reference))).filter((x) => x !== "internal" && !x.startsWith("internal."));
      if (cur.sortOrder !== sortOrder) diff.push("orden");
      const who = cur.publication === "published" ? `publicado por «${cur.publishedBy ?? "?"}»` : cur.publication === "unpublished" ? `despublicado (último guardado de «${cur.updatedBy}»)` : `en borrador de «${cur.updatedBy}»`;
      const draftNote = cur.publication === "published" && !upToDate ? `; tiene un borrador pendiente de «${cur.updatedBy}» que no se sobrescribe ni se publica` : "";
      if (diff.length || cur.publication !== "published") r.conflicts.push(`${key}: ${who}${diff.length ? `; difiere de la semilla en ${diff.join(", ")}` : ""}${draftNote}; se respeta lo decidido en el CRM`);
      else if (upToDate) r.unchanged++;
      return;
    }

    if (kind === "product") own.add(key);
    const draft = cur ? draftFor(cur.draft) : seedDraft;
    let changed = false;
    if (!cur) {
      r.created.push(id);
      changed = true;
      if (!dryRun) await svc.create({ kind, key, family, sortOrder, draft }, author);
    } else if (!same(kind, cur.draft, draft) || cur.sortOrder !== sortOrder) {
      r.updated.push(id);
      changed = true;
      if (!dryRun) await svc.save(kind, key, { draft, sortOrder, expectedVersion: cur.draftVersion }, author);
    }
    const now = dryRun ? cur : await store.getEntry(kind, key);
    const needsPublish = !now || now.publication !== "published" || now.publishedVersion !== now.draftVersion || changed;
    if (needsPublish) {
      r.published.push(id);
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
  for (const p of products) await upsert("product", p.key, p.draft, p.sortOrder, p.family);

  // 3. Precios aprobados: se añade y aprueba solo si no hay ya uno vigente idéntico, y solo sobre lo que es de la semilla
  const bySeed = (x: WebPrice) => x.createdBy === author && (x.approvedBy ?? author) === author && (x.retiredBy ?? author) === author;
  for (const p of products) {
    const entry = await store.getEntry("product", p.key);
    const existing = entry ? await store.listPrices(entry.id) : [];
    for (const sp of p.prices) {
      const unit = sp.unit ?? null;
      const ofKind = existing.filter((x) => x.kind === sp.kind && x.currency === "EUR");
      const approved = ofKind.filter((x) => x.status === "approved");
      const vigente = approved.find((x) => (x.unit ?? null) === unit);
      if (vigente && approved.length === 1 && vigente.amountCents === sp.amountCents && vigente.taxRateBp === TAX_RATE_BP && !vigente.taxIncluded) continue;
      const wanted = `${eur(sp.amountCents)}${unit ? ` por ${unit}` : ""}`;
      const current = approved.length ? approved.map((x) => `${eur(x.amountCents)}${x.unit ? ` por ${x.unit}` : ""}${x.taxIncluded ? " con IVA incluido" : ""} (aprobado por «${x.approvedBy ?? "?"}»)`).join(" y ") : null;
      // Tarifa decidida fuera de la semilla (un precio aprobado o retirado en el CRM, o un producto que ya no es suyo)
      if (entry && (!own.has(p.key) || !ofKind.every(bySeed) || approved.some((x) => (x.unit ?? null) !== unit))) {
        const retired = ofKind.filter((x) => x.status === "retired");
        const state = current ? `vigente ${current}` : retired.length ? `sin precio vigente (retirado por ${Array.from(new Set(retired.map((x) => `«${x.retiredBy ?? "?"}»`))).join(", ")})` : "sin precio";
        r.conflicts.push(`${p.key}: precio ${kindName(sp.kind)} ${state} frente a ${wanted} de la semilla; se respeta el del CRM (la semilla no aprueba ni retira precios ajenos)`);
        continue;
      }
      r.pricesApproved.push(`${p.key} ${sp.kind} ${sp.amountCents}`);
      if (dryRun) continue;
      const draft = await svc.addPrice(p.key, { kind: sp.kind, amountCents: sp.amountCents, currency: "EUR", unit, taxRateBp: TAX_RATE_BP, taxIncluded: false, note: `Tarifa oficial ${CATALOG_VERSION}` }, author);
      await svc.approvePrice(draft.id, author);
    }
  }
  return r;
}
