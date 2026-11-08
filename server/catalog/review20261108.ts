/**
 * Revisión del catálogo del 08/11/2026 (decisiones J1–J10 de Jorge del 08/11/2026; docs/life-net-alcance.md §3.5 y
 * docs/elephant-source/LIFE_CONTRATACION_PARTICULARES.md):
 *
 *  1. Alta del plan personal «Life» (familia `core_plan`), independiente de Essential: un tenant por hogar con la
 *     licencia LIFE_NET (`life-net`) y las capacidades base `admin-users` y `comms-email`, 5 miembros del hogar
 *     incluidos (`household_members`), solo tarifa mensual: 7,44 € sin IVA (21 %), 9 € IVA incluido para el particular.
 *     Entra «Próximamente» y con estado técnico «planned»: no se contrata, no tiene Price de Stripe y nadie lo cobra.
 *  2. Life Net deja de decir «Profesionales y familias» en su presentación (la ficha comercial va por las fichas).
 *
 * Mismas garantías que las revisiones de estados (server/catalog/review.ts), por el flujo normal del CRM (crear o
 * guardar borrador → publicar → precio en borrador → aprobar), con autor, versión e historial:
 *  - idempotente: lo que ya está hecho no se toca; lo que alguien cambió desde el CRM se respeta y se informa;
 *  - nunca publica un borrador ajeno ni toca precios, contratos, suscripciones, licencias de empresas ni Stripe de otros
 *    productos (el único precio que añade es el del plan nuevo);
 *  - por defecto, simulación.
 */
import { productDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import { PRODUCTS, TAX_RATE_BP } from "./elephantSourceV1";

export const REVIEW_ID_2026_11_08 = "revision-catalogo-2026-11-08";

/** Productos que la revisión da de alta (desde la semilla oficial) con su evidencia. */
export const PRODUCT_ADDITIONS_2026_11_08: ReadonlyArray<{ key: string; evidence: string }> = [
  {
    key: "life",
    evidence:
      "Plan personal aprobado por Jorge el 08/11/2026 (J1–J5): un hogar por tenant, independiente de Essential; Life Net y capacidades base; 5 miembros; 9 € al mes IVA incluido (base 7,44 €), solo mensual. Próximamente: Life Net en desarrollo y contratación de particulares apagada.",
  },
];

/** Cambio de un texto de la presentación del producto, solo desde su valor de partida. */
export interface PresentationPatch {
  key: string;
  field: "forWho";
  from: string;
  to: string;
}
export const PRESENTATION_PATCHES_2026_11_08: readonly PresentationPatch[] = [{ key: "life-net", field: "forWho", from: "Profesionales y familias.", to: "Particulares y familias." }];

export interface CatalogAdditionReport {
  apply: boolean;
  created: string[];
  patched: string[];
  already: string[];
  conflicts: string[];
}

const note = `Tarifa aprobada por Jorge el 08/11/2026 (${REVIEW_ID_2026_11_08})`;

export async function applyCatalogAdditions(
  svc: WebAdminService,
  store: WebStore,
  o: { apply?: boolean; author: string; additions?: typeof PRODUCT_ADDITIONS_2026_11_08; patches?: readonly PresentationPatch[] },
): Promise<CatalogAdditionReport> {
  const r: CatalogAdditionReport = { apply: !!o.apply, created: [], patched: [], already: [], conflicts: [] };
  for (const a of o.additions ?? PRODUCT_ADDITIONS_2026_11_08) {
    const seed = PRODUCTS.find((p) => p.key === a.key);
    if (!seed) {
      r.conflicts.push(`${a.key}: no está en la semilla oficial`);
      continue;
    }
    const cur = await store.getEntry("product", a.key);
    if (cur && cur.family !== seed.family) {
      r.conflicts.push(`${a.key}: existe con la familia ${cur.family} (se esperaba ${seed.family}); se deja como está`);
      continue;
    }
    // Solo se retoma un alta propia que se quedó a medias; lo creado por otra persona se decide en el CRM
    if (cur && cur.createdBy !== o.author) {
      r.conflicts.push(`${a.key}: ya existe en el catálogo (creado por ${cur.createdBy}); se deja como lo decidió el CRM`);
      continue;
    }
    const prices = cur ? await store.listPrices(cur.id) : [];
    const sameKind = (x: (typeof prices)[number], sp: (typeof seed.prices)[number]) => x.kind === sp.kind && x.currency === "EUR" && (x.unit ?? null) === (sp.unit ?? null);
    const missingPrices = seed.prices.filter((sp) => !prices.some((x) => x.status === "approved" && sameKind(x, sp)));
    // Solo se aprueba un borrador de precio que dejó esta misma revisión, con la tarifa exacta
    const ownDraft = (sp: (typeof seed.prices)[number]) => prices.find((x) => x.status === "draft" && sameKind(x, sp) && x.amountCents === sp.amountCents && x.taxRateBp === TAX_RATE_BP && !x.taxIncluded && x.createdBy === o.author);
    if (cur && cur.publication === "published" && !missingPrices.length) {
      r.already.push(a.key);
      continue;
    }
    // Lo que el CRM cambió después del alta (despublicado, borrador editado o precio retirado) no se rehace: se decide allí
    if (cur && (cur.publication === "unpublished" || cur.updatedBy !== o.author || cur.draftVersion !== 1 || missingPrices.some((sp) => prices.some((x) => x.status === "retired" && sameKind(x, sp))))) {
      r.conflicts.push(`${a.key}: cambió en el CRM después del alta (${cur.publication}, borrador v${cur.draftVersion} de ${cur.updatedBy}); se deja como está`);
      continue;
    }
    r.created.push(`${a.key}${cur ? " (se retoma el alta)" : ""}: ${seed.prices.map((p) => `${p.kind} ${p.amountCents} céntimos sin IVA`).join(", ")}`);
    // Las capacidades que concede tienen que estar publicadas (lo exige la publicación): se avisa ya en la simulación
    const unpublished: string[] = [];
    for (const c of seed.draft.catalog.capabilities) if ((await store.getEntry("capability", c))?.publication !== "published") unpublished.push(c);
    if (unpublished.length) {
      r.created.pop();
      r.conflicts.push(`${a.key}: capacidades sin publicar (${unpublished.join(", ")}); no se puede publicar el plan`);
      continue;
    }
    if (!o.apply) continue;
    try {
      let entry = cur;
      if (!entry) {
        const draft = productDraft.parse({ ...seed.draft, internal: { ...seed.draft.internal, evidence: a.evidence } });
        entry = await svc.create({ kind: "product", key: a.key, family: seed.family, sortOrder: seed.sortOrder, draft }, o.author);
      }
      if (entry.publication !== "published") entry = await svc.publish("product", a.key, entry.draftVersion, o.author);
      for (const sp of missingPrices) {
        // Un precio propio que se quedó en borrador (alta interrumpida) se aprueba; si no, se crea
        const p = ownDraft(sp) ?? (await svc.addPrice(a.key, { kind: sp.kind, amountCents: sp.amountCents, currency: "EUR", unit: sp.unit ?? null, taxRateBp: TAX_RATE_BP, taxIncluded: false, note }, o.author));
        await svc.approvePrice(p.id, o.author);
      }
    } catch (e) {
      // Queda a medias y con su causa en el informe; la siguiente ejecución retoma el alta propia
      r.conflicts.push(`${a.key}: alta sin terminar (${e instanceof Error ? e.message : String(e)}); se retoma en la siguiente ejecución`);
    }
  }
  for (const p of o.patches ?? PRESENTATION_PATCHES_2026_11_08) {
    const cur = await store.getEntry("product", p.key);
    if (!cur) {
      r.conflicts.push(`${p.key}: no existe en el catálogo`);
      continue;
    }
    const d = productDraft.parse(cur.draft);
    const value = d.presentation[p.field];
    const upToDate = cur.publication !== "published" || cur.publishedVersion === cur.draftVersion;
    if (value === p.to && upToDate) {
      r.already.push(`${p.key}.${p.field}`);
      continue;
    }
    // Cambio propio guardado y sin publicar (una ejecución anterior se interrumpió entre guardar y publicar): se publica
    if (value === p.to && cur.updatedBy === o.author) {
      r.patched.push(`${p.key}.${p.field}: se publica el cambio ya guardado`);
      if (o.apply) await svc.publish("product", p.key, cur.draftVersion, o.author);
      continue;
    }
    if (value !== p.from) {
      r.conflicts.push(`${p.key}.${p.field}: vale «${value ?? ""}» (se esperaba «${p.from}»); se deja como lo decidió el CRM`);
      continue;
    }
    if (!upToDate) {
      r.conflicts.push(`${p.key}: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno`);
      continue;
    }
    r.patched.push(`${p.key}.${p.field}: «${p.from}» → «${p.to}»`);
    if (!o.apply) continue;
    const saved = await svc.save("product", p.key, { draft: { ...d, presentation: { ...d.presentation, [p.field]: p.to } }, expectedVersion: cur.draftVersion }, o.author);
    if (cur.publication === "published") await svc.publish("product", p.key, saved.draftVersion, o.author);
  }
  return r;
}
