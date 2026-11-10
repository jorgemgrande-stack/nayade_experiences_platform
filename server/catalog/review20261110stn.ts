/**
 * Revisión del catálogo del 10/11/2026 — Social Token Net (`social-token-net-complete`): ámbito por empresa.
 *
 * El catálogo publicado lo tenía como producto «por sede» (`catalog.scope: "site"`, heredado de la plantilla común de
 * las soluciones Net), pero Social Token Net es por empresa en todo el Core:
 *  - sus datos (comunidades, miembros, publicaciones, monederos, movimientos y recompensas; migraciones 0026–0030)
 *    viven en la BD de cada empresa, sin ninguna columna de sede;
 *  - sus capacidades (`social-token-net`, `social-token-net-tokens`) se comprueban por empresa (server/stnIntegration.ts,
 *    licencias por empresa), nunca por sede;
 *  - la compra del panel lo añade con cantidad 1 por empresa, y sus dos módulos heredados ya eran `scope: "company"`;
 *  - su ficha ya decía «Por empresa» (capacityRules).
 * Además, su descripción larga deja de hablar de «paquete»: es una solución integral.
 *
 * Solo cambia `catalog.scope` y `commercial.longDescription`, cada uno desde su valor publicado de partida (los «from» son
 * los publicados en production el 10/11/2026, https://admin.bigelephant.es/cp/v1/public/site). Nunca toca precios,
 * Prices de Stripe, licencias, capacidades, estados ni la oferta (sigue en venta directa); nunca publica un borrador
 * ajeno; idempotente; simulación por defecto. Se aplica con `catalog-review` (server/controlPlane/backupJob.ts).
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import type { ListingReport } from "./review20261108fichas";

export const REVIEW_ID_2026_11_10_STN = "revision-catalogo-2026-11-10-stn-ambito";

type Scope = ProductDraft["catalog"]["scope"];

export interface StnScopeChange {
  key: string;
  evidence: string;
  scope: { from: Scope; to: Scope };
  longDescription: { from: string; to: string };
}

export const STN_SCOPE_2026_11_10: StnScopeChange = {
  key: "social-token-net-complete",
  evidence:
    "Ámbito real de Social Token Net (10/11/2026): datos en la BD de cada empresa sin columna de sede (migraciones 0026–0030), capacidades social-token-net y social-token-net-tokens comprobadas por empresa (server/stnIntegration.ts), compra del panel con cantidad 1 por empresa y módulos heredados ya «company». Precio, Price de Stripe y licencias sin cambios.",
  scope: { from: "site", to: "company" },
  longDescription: {
    from: "Comunidad y fidelización en un solo paquete: comunidades y tokens internos.",
    to: "Solución integral de comunidades y fidelización: comunidades propias de clientes y socios y un programa de puntos internos canjeables por recompensas.",
  },
};

function target(d: ProductDraft, c: StnScopeChange): ProductDraft {
  return {
    ...d,
    catalog: { ...d.catalog, scope: c.scope.to },
    commercial: { ...(d.commercial as NonNullable<ProductDraft["commercial"]>), longDescription: c.longDescription.to },
    internal: { ...d.internal, evidence: c.evidence },
  };
}
const isDone = (d: ProductDraft, c: StnScopeChange) => d.catalog.scope === c.scope.to && d.commercial?.longDescription === c.longDescription.to;

export async function applyStnScopeReview(svc: WebAdminService, store: WebStore, o: { apply?: boolean; author: string; change?: StnScopeChange }): Promise<ListingReport> {
  const c = o.change ?? STN_SCOPE_2026_11_10;
  const r: ListingReport = { apply: !!o.apply, changed: [], already: [], conflicts: [] };
  const cur = await store.getEntry("product", c.key);
  if (!cur) {
    r.conflicts.push(`${c.key}: no existe en el catálogo`);
    return r;
  }
  const d = productDraft.parse(cur.draft);
  const upToDate = cur.publication === "published" && cur.publishedVersion === cur.draftVersion;
  if (isDone(d, c) && upToDate) {
    r.already.push(c.key);
    return r;
  }
  // Cambio propio guardado y sin publicar (una ejecución anterior se interrumpió): se publica
  if (isDone(d, c) && cur.publication === "published" && !upToDate && cur.updatedBy === o.author) {
    r.changed.push(`${c.key}: se publica el cambio ya guardado`);
    if (o.apply) await svc.publish("product", c.key, cur.draftVersion, o.author).catch((e) => void r.conflicts.push(`${c.key}: no se pudo publicar (${e instanceof Error ? e.message : String(e)})`));
    return r;
  }
  if (cur.publication !== "published") {
    r.conflicts.push(`${c.key}: no está publicado (${cur.publication}); se decide en el CRM`);
    return r;
  }
  if (!upToDate) {
    r.conflicts.push(`${c.key}: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno`);
    return r;
  }
  if (!d.commercial) {
    r.conflicts.push(`${c.key}: no tiene ficha comercial`);
    return r;
  }
  const problems: string[] = [];
  if (d.catalog.scope !== c.scope.from && d.catalog.scope !== c.scope.to) problems.push(`ámbito «${d.catalog.scope}» (se esperaba «${c.scope.from}»)`);
  const ld = d.commercial.longDescription;
  if (ld !== c.longDescription.from && ld !== c.longDescription.to) problems.push("la descripción larga ya no es la de partida");
  if (problems.length) {
    r.conflicts.push(`${c.key}: ${problems.join("; ")}; se deja como lo decidió el CRM`);
    return r;
  }
  r.changed.push(`${c.key}: ámbito ${d.catalog.scope} → ${c.scope.to}; ficha (longDescription)`);
  if (!o.apply) return r;
  try {
    const saved = await svc.save("product", c.key, { draft: target(d, c), expectedVersion: cur.draftVersion }, o.author);
    await svc.publish("product", c.key, saved.draftVersion, o.author);
  } catch (e) {
    r.changed.pop();
    r.conflicts.push(`${c.key}: no se pudo publicar (${e instanceof Error ? e.message : String(e)}); se revisa en el CRM`);
  }
  return r;
}
