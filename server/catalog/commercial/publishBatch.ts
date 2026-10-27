/**
 * Publicación por lotes de las fichas comerciales (borradores cargados con `importSpecs.ts`): segura, idempotente,
 * con simulación previa y reversión del último lote. Solo vuelve a publicar productos que YA estaban publicados y cuyo
 * borrador solo cambia en la ficha, la política o los datos internos; cada uno pasa las mismas comprobaciones que el
 * botón «Publicar» del CRM (incluidas las comerciales de `checks.ts`). Lo bloqueado queda en borrador con su causa.
 *
 * Nunca cambia precios ni estados: los precios viven en sus propias entradas y la política comercial sigue apagada
 * (lo que se publica no lleva reglas). La web se regenera aparte, con la siguiente publicación del Core.
 */
import { productDraft } from "../../web/schemas";
import type { WebAdminService } from "../../web/service";
import type { WebStore } from "../../web/store";
import { foreignChanges } from "./importSpecs";
import { PRODUCT_SPECS } from "./specs";

export const PUBLISH_AUTHOR = "catalogo:publicacion-fichas";
const BATCH_ACTION = "batch-publish";
const REVERT_ACTION = "batch-revert";

export interface PlanItem {
  key: string;
  decision: "publish" | "already" | "blocked";
  reasons: string[];
  /** Versión publicada antes y la que se publicaría */
  from: number | null;
  to: number;
}

export interface BatchReport {
  batch: string;
  dryRun: boolean;
  reviewed: number;
  publish: string[];
  already: string[];
  blocked: Array<{ key: string; reasons: string[] }>;
  published: string[];
  failed: Array<{ key: string; error: string }>;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Decide, sin escribir nada, qué ficha se publica, cuál ya lo está y cuál queda bloqueada (y por qué). */
export async function planPublication(svc: WebAdminService, store: WebStore, opts: { keys?: string[] } = {}): Promise<PlanItem[]> {
  const out: PlanItem[] = [];
  for (const spec of PRODUCT_SPECS) {
    if (opts.keys && !opts.keys.includes(spec.key)) continue;
    const cur = await store.getEntry("product", spec.key);
    const item: PlanItem = { key: spec.key, decision: "blocked", reasons: [], from: cur?.publishedVersion ?? null, to: cur?.draftVersion ?? 0 };
    out.push(item);
    if (!cur) {
      item.reasons.push("el producto no existe en el catálogo");
      continue;
    }
    const parsed = productDraft.safeParse(cur.draft);
    if (!parsed.success) {
      item.reasons.push("el borrador no es válido");
      continue;
    }
    if (!parsed.data.commercial) item.reasons.push("sin ficha comercial importada");
    if (cur.publication !== "published" || cur.publishedVersion === null) {
      item.reasons.push("no estaba publicado: darlo de alta en la web es una decisión aparte");
      continue;
    }
    if (cur.publishedVersion === cur.draftVersion) {
      if (!item.reasons.length) item.decision = "already";
      continue;
    }
    const prev = (await store.versions(cur.id)).find((v) => v.version === cur.publishedVersion);
    if (!prev) {
      item.reasons.push(`no se encuentra la versión publicada v${cur.publishedVersion} en el historial`);
      continue;
    }
    const foreign = foreignChanges(productDraft.parse(prev.snapshot) as unknown as Record<string, unknown>, parsed.data as unknown as Record<string, unknown>);
    if (foreign.length) item.reasons.push(`el borrador trae cambios ajenos a la ficha sin publicar (${foreign.join(", ")}): se publican desde el CRM`);
    // Reversión garantizada: lo publicado hoy debe poder reconstruirse exactamente desde su versión
    if (stable(await svc.publishedViewOf("product", cur.key, cur.publishedVersion)) !== stable(cur.published)) item.reasons.push(`lo publicado (v${cur.publishedVersion}) no se puede reconstruir desde el historial: no se garantizaría la reversión`);
    item.reasons.push(...(await svc.publishProblems("product", cur.key)));
    if (!item.reasons.length) item.decision = "publish";
  }
  return out;
}

/** Identificador del lote (minuto UTC). */
export const batchId = (now: number) => new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");

export async function publishBatch(svc: WebAdminService, store: WebStore, opts: { apply?: boolean; keys?: string[]; now?: number } = {}): Promise<BatchReport> {
  const batch = batchId(opts.now ?? Date.now());
  const plan = await planPublication(svc, store, { keys: opts.keys });
  const r: BatchReport = {
    batch,
    dryRun: !opts.apply,
    reviewed: plan.length,
    publish: plan.filter((p) => p.decision === "publish").map((p) => p.key),
    already: plan.filter((p) => p.decision === "already").map((p) => p.key),
    blocked: plan.filter((p) => p.decision === "blocked").map((p) => ({ key: p.key, reasons: p.reasons })),
    published: [],
    failed: [],
  };
  if (!opts.apply) return r;
  const author = `${PUBLISH_AUTHOR}#${batch}`;
  for (const p of plan.filter((x) => x.decision === "publish")) {
    try {
      await svc.publish("product", p.key, p.to, author);
      await store.addEvent({ entity: "product", entityKey: p.key, action: BATCH_ACTION, author, detail: `lote ${batch}: v${p.to} (antes v${p.from})`, createdAt: Date.now() });
      r.published.push(p.key);
    } catch (e) {
      r.failed.push({ key: p.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}

export interface RevertReport {
  batch: string | null;
  dryRun: boolean;
  revert: Array<{ key: string; to: number; from: number }>;
  skipped: Array<{ key: string; reason: string }>;
  reverted: string[];
  failed: Array<{ key: string; error: string }>;
}

/** Deshace el último lote no deshecho: vuelve a publicar la versión anterior de cada ficha que nadie haya cambiado. */
export async function revertLastBatch(svc: WebAdminService, store: WebStore, opts: { apply?: boolean } = {}): Promise<RevertReport> {
  const events = (await store.listEvents({ entity: "product", limit: 5000 })).filter((e) => e.action === BATCH_ACTION || e.action === REVERT_ACTION);
  const lote = (d: string | null) => /^lote (\d{12})/.exec(d ?? "")?.[1] ?? null;
  const reverted = new Set(events.filter((e) => e.action === REVERT_ACTION).map((e) => lote(e.detail)));
  const batches = Array.from(new Set(events.filter((e) => e.action === BATCH_ACTION).map((e) => lote(e.detail)))).filter((b): b is string => !!b && !reverted.has(b)).sort();
  const batch = batches[batches.length - 1] ?? null;
  const r: RevertReport = { batch, dryRun: !opts.apply, revert: [], skipped: [], reverted: [], failed: [] };
  if (!batch) return r;
  for (const e of events.filter((x) => x.action === BATCH_ACTION && lote(x.detail) === batch)) {
    const m = /: v(\d+) \(antes v(\d+)\)/.exec(e.detail ?? "");
    if (!m) continue;
    const [to, from] = [Number(m[1]), Number(m[2])];
    const cur = await store.getEntry("product", e.entityKey);
    if (!cur || cur.publication !== "published" || cur.publishedVersion !== to) r.skipped.push({ key: e.entityKey, reason: `lo publicado cambió después del lote (v${cur?.publishedVersion ?? "—"})` });
    else r.revert.push({ key: e.entityKey, to, from });
  }
  if (!opts.apply) return r;
  const author = `${PUBLISH_AUTHOR}#${batch}`;
  for (const x of r.revert) {
    try {
      await svc.republishVersion("product", x.key, x.from, x.to, author, `reversión del lote ${batch}`);
      r.reverted.push(x.key);
    } catch (e) {
      r.failed.push({ key: x.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Con algún fallo el lote sigue pendiente de deshacer (se puede repetir: lo ya deshecho se salta)
  if (r.failed.length) return r;
  await store.addEvent({ entity: "product", entityKey: "*", action: REVERT_ACTION, author, detail: `lote ${batch}: ${r.reverted.length} fichas vueltas a su versión anterior`, createdAt: Date.now() });
  return r;
}
