/**
 * Aplica una revisión de estados comerciales al catálogo por el flujo NORMAL del CRM (guardar borrador → publicar), con
 * autor, versión e historial: cualquier cambio se deshace desde el CRM restaurando la versión anterior.
 *
 * Seguro e idempotente:
 *  - Solo cambia un producto si su estado actual es el de partida (`from`). Si ya está en el de llegada, no hace nada;
 *    si tiene otro (alguien lo cambió desde el CRM), no lo toca y lo informa.
 *  - No publica nunca un borrador ajeno: si el producto tiene cambios sin publicar, se informa y se deja.
 *  - No toca precios, licencias, módulos de las empresas, Stripe ni cobros: solo el estado comercial, la evidencia y la
 *    nota interna del producto.
 *  - Por defecto es una SIMULACIÓN.
 */
import { productDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";
import type { StatusChange } from "./review20261025";

export interface ReviewReport {
  apply: boolean;
  changed: string[];
  already: string[];
  conflicts: string[];
}

export async function applyStatusReview(svc: WebAdminService, store: WebStore, changes: readonly StatusChange[], o: { apply?: boolean; author: string }): Promise<ReviewReport> {
  const r: ReviewReport = { apply: !!o.apply, changed: [], already: [], conflicts: [] };
  for (const c of changes) {
    const cur = await store.getEntry("product", c.key);
    if (!cur) {
      r.conflicts.push(`${c.key}: no existe en el catálogo`);
      continue;
    }
    const d = productDraft.parse(cur.draft);
    const status = d.catalog.commercialStatus;
    if (status === c.to && cur.publication === "published" && cur.publishedVersion === cur.draftVersion) {
      r.already.push(c.key);
      continue;
    }
    if (status !== c.from) {
      r.conflicts.push(`${c.key}: está en «${status}» (se esperaba «${c.from}»); se deja como lo decidió el CRM`);
      continue;
    }
    if (cur.publication === "published" && cur.publishedVersion !== cur.draftVersion) {
      r.conflicts.push(`${c.key}: tiene cambios sin publicar en el CRM; no se publica un borrador ajeno`);
      continue;
    }
    r.changed.push(`${c.key}: ${c.from} → ${c.to}`);
    if (!o.apply) continue;
    const draft = { ...d, catalog: { ...d.catalog, commercialStatus: c.to }, internal: { ...d.internal, evidence: c.evidence, ...(c.notes !== undefined ? { notes: c.notes } : {}) } };
    const saved = await svc.save("product", c.key, { draft, expectedVersion: cur.draftVersion }, o.author);
    if (cur.publication === "published") await svc.publish("product", c.key, saved.draftVersion, o.author);
  }
  return r;
}

/** Evidencia de los productos que no cambian: solo se rellena donde falta (nunca sustituye la escrita en el CRM). */
export async function fillEvidence(svc: WebAdminService, store: WebStore, evidence: Readonly<Record<string, string>>, o: { apply?: boolean; author: string }): Promise<string[]> {
  const filled: string[] = [];
  for (const [key, text] of Object.entries(evidence)) {
    const cur = await store.getEntry("product", key);
    if (!cur) continue;
    const d = productDraft.parse(cur.draft);
    if (d.internal.evidence) continue;
    filled.push(key);
    // La evidencia es interna (nunca se publica): basta con el borrador; si estaba al día, se vuelve a publicar igual
    if (o.apply) {
      const saved = await svc.save("product", key, { draft: { ...d, internal: { ...d.internal, evidence: text } }, expectedVersion: cur.draftVersion }, o.author);
      if (cur.publication === "published" && cur.publishedVersion === cur.draftVersion) await svc.publish("product", key, saved.draftVersion, o.author);
    }
  }
  return filled;
}
