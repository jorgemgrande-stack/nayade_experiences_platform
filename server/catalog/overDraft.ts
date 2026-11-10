/**
 * Revisión de catálogo sobre un producto que tiene un BORRADOR AJENO sin publicar en el CRM (10/11/2026).
 *
 * Hasta ahora una revisión dejaba ese producto como conflicto («no se publica un borrador ajeno»). Con este mecanismo la
 * revisión se aplica sobre lo PUBLICADO y el borrador se vuelve a guardar con los mismos cambios, sin perder nada de él.
 *
 * Fusión a tres bandas, campo a campo (los objetos se recorren hasta sus hojas; las listas son un solo campo, y también
 * un objeto que el borrador o la revisión crean o borran entero):
 *  - PUBLICADO: la versión del historial que está publicada (el punto de partida de los dos).
 *  - BORRADOR: el borrador ajeno pendiente.
 *  - REVISIÓN: lo publicado con la revisión aplicada (`reviewed`).
 *
 * De ahí salen dos documentos:
 *  - LO QUE SE PUBLICA: lo publicado + la revisión + los cambios del borrador que la política de la revisión permite publicar.
 *  - EL BORRADOR NUEVO: lo que se publica + los cambios RETENIDOS del borrador (los que la política no publica: siguen
 *    pendientes en el CRM, como estaban).
 *
 * Por campo:
 *  · Solo lo cambia la revisión → vale la revisión (en lo publicado y en el borrador).
 *  · La política RETIRA el campo (`drop`) → el cambio del borrador se descarta: ni se publica ni sigue en el borrador («retirado»).
 *  · Solo lo cambia el borrador → si la política lo retiene (`retain`), no se publica y sigue en el borrador («retenido»);
 *    si no, se publica el valor del borrador.
 *  · Los dos lo dejan igual → ese valor.
 *  · Los dos lo cambian con valores distintos → la política puede resolverlo con una regla declarada (`auto`, que consta en
 *    el informe); si no, es un CAMPO EN DISPUTA: se lista con los tres valores y no se guarda ni se publica NADA de ese
 *    producto hasta que haya una decisión escrita (`decisions`), ligada a la versión del borrador sobre la que se tomó.
 *
 * Escritura (solo con `apply`, sin disputas y con el resultado publicable), siempre por el flujo del CRM, con autor e
 * historial: guarda lo que se publica; si hay cambios retenidos, guarda encima el borrador nuevo y publica la versión
 * anterior (`republishVersion`): lo retenido nunca se publica y siempre está en el historial. Una ejecución interrumpida
 * se retoma desde el último borrador ajeno del historial; si entre el corte y la reanudación alguien editó el producto en
 * el CRM sobre un borrador sin lo retenido, no se escribe nada y se avisa (lo retenido está en el historial). Idempotente.
 */
import { productDraft, type ProductDraft } from "../web/schemas";
import type { WebAdminService } from "../web/service";
import type { WebStore } from "../web/store";

export type OverDraftWinner = "borrador" | "revision";
/** Decisión escrita sobre un campo en disputa. Solo vale para la versión del borrador sobre la que se tomó. */
export interface OverDraftDecision {
  key: string;
  /** Ruta del campo, como la imprime la simulación (p. ej. `commercial.faq`). */
  campo: string;
  gana: OverDraftWinner;
  borradorVersion: number;
  /** Quién lo decidió y cuándo. */
  nota: string;
}

export interface OverDraftFieldDiff {
  campo: string;
  publicado: unknown;
  resultado: unknown;
  /** «borrador», «revisión», «ambos», «revisión (regla)», «decisión: …». */
  origen: string;
  /** El valor del borrador, cuando una regla o una decisión lo descarta (queda en el historial). */
  borradorDescartado?: unknown;
}
export interface OverDraftRetained {
  campo: string;
  publicado: unknown;
  borrador: unknown;
  /** Solo si la revisión también lo cambia: es lo que se publica. */
  revision?: unknown;
}
export interface OverDraftDropped {
  campo: string;
  publicado: unknown;
  borrador: unknown;
}
export interface OverDraftDispute {
  campo: string;
  publicado: unknown;
  borrador: unknown;
  revision: unknown;
}
export interface OverDraftReport {
  key: string;
  /** El borrador ajeno: su versión, la publicada y su autor. */
  borrador: { version: number; versionPublicada: number; autor: string; guardado: string };
  /** Publicado → lo que se publica, campo a campo, con su origen. */
  diff: OverDraftFieldDiff[];
  /** Cambios del borrador que NO se publican: siguen en el borrador pendiente. */
  retenido: OverDraftRetained[];
  /** Cambios del borrador que se descartan: ni se publican ni siguen en el borrador. */
  retirado: OverDraftDropped[];
  enDisputa: OverDraftDispute[];
  decisionesAplicadas: string[];
  decisionesIgnoradas: string[];
}
export type OverDraftOutcome =
  /** No hay borrador pendiente: la revisión sigue su camino habitual. */
  | { state: "none" }
  /** Nada que publicar ni que guardar (lo retenido sigue en el borrador). */
  | { state: "already"; report: OverDraftReport }
  /** No se escribe nada: disputa, punto de partida distinto o resultado no publicable. */
  | { state: "blocked"; reason: string; report?: OverDraftReport }
  /** Cambia (simulado, o hecho con `apply`). */
  | { state: "changed"; summary: string; report: OverDraftReport };

export interface OverDraftPolicy {
  /** Lo publicado con la revisión aplicada. */
  reviewed: (base: ProductDraft) => ProductDraft;
  /** Lo que impide aplicar la revisión sobre lo publicado (vacío = se puede). */
  startProblems?: (base: ProductDraft) => string[];
  /** Cambios del borrador que NO se publican (siguen pendientes en el borrador). */
  retain: (campo: string) => boolean;
  /**
   * Un cambio retenido que choca con la revisión (los dos cambian el campo con valores distintos) deja el borrador con su
   * valor: si después se publica desde el CRM, pisa el de la revisión. Con `true`, ese choque bloquea el producto (no se
   * escribe nada) en lugar de publicarse la revisión y quedar el aviso solo en `retenido[].revision`.
   */
  retainedClashBlocks?: boolean;
  /** Cambios del borrador que se descartan (ni se publican ni siguen en el borrador). Va antes que `retain`. */
  drop?: (campo: string) => boolean;
  /**
   * Regla declarada para un campo que el borrador cambia y no se retiene (`revisionChanged`: la revisión también lo cambia
   * con otro valor). Devuelve el valor que vale y su origen para el informe, o nada (se aplica la regla general).
   */
  auto?: (campo: string, v: { publicado: unknown; borrador: unknown; revision: unknown; revisionChanged: boolean }) => { value: unknown; origen: string } | undefined;
  /** Última comprobación de lo que se publicaría (un texto = no se publica). */
  checkResult?: (result: ProductDraft) => string | null;
}

/** Igualdad estructural de JSON (orden de claves indiferente; `undefined` ≠ cualquier otro valor). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameJson(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** `undefined` se imprime como null (JSON no tiene `undefined`). */
const shown = (v: unknown) => (v === undefined ? null : v);

interface MergeCtx {
  policy: OverDraftPolicy;
  report: OverDraftReport;
  decide: (campo: string) => OverDraftWinner | undefined;
  used: Set<string>;
}
/** `p`: lo que se publica; `n`: el borrador nuevo. */
type Pair = { p: unknown; n: unknown };

function merge3(b: unknown, d: unknown, u: unknown, path: string, ctx: MergeCtx): Pair {
  // Un campo retirado (entero, aunque sea un objeto): el cambio del borrador se descarta
  if (ctx.policy.drop?.(path) && !sameJson(b, d)) {
    if (d !== undefined) ctx.report.retirado.push({ campo: path, publicado: shown(b), borrador: shown(d) });
    d = b;
  }
  // Se recorre por dentro solo si el borrador y la revisión conservan el objeto; si uno de los dos lo crea o lo borra
  // entero, es un solo campo (así un objeto borrado no reaparece vacío)
  if (isObj(d) && isObj(u) && (b === undefined || isObj(b))) {
    const all = [b, d, u];
    const keys = Array.from(new Set(all.flatMap((v) => (isObj(v) ? Object.keys(v) : []))));
    const p: Obj = {};
    const n: Obj = {};
    for (const k of keys) {
      const r = merge3((b as Obj | undefined)?.[k], (d as Obj | undefined)?.[k], (u as Obj | undefined)?.[k], path ? `${path}.${k}` : k, ctx);
      if (r.p !== undefined) p[k] = r.p;
      if (r.n !== undefined) n[k] = r.n;
    }
    return { p, n };
  }
  const draftChanged = !sameJson(b, d);
  const revisionChanged = !sameJson(b, u);
  if (!draftChanged && !revisionChanged) return { p: b, n: b };
  const row = (resultado: unknown, origen: string): Pair => {
    ctx.report.diff.push({ campo: path, publicado: shown(b), resultado: shown(resultado), origen });
    return { p: resultado, n: resultado };
  };
  if (!draftChanged) return row(u, "revisión");
  if (sameJson(d, u)) return row(d, "ambos");
  if (ctx.policy.retain(path)) {
    const clash = revisionChanged && !sameJson(d, u);
    ctx.report.retenido.push({ campo: path, publicado: shown(b), borrador: shown(d), ...(clash ? { revision: shown(u) } : {}) });
    if (revisionChanged) row(u, "revisión");
    return { p: u, n: d };
  }
  const auto = ctx.policy.auto?.(path, { publicado: b, borrador: d, revision: u, revisionChanged });
  // Cuando se descarta el valor del borrador, el informe lo enseña
  const discard = (r: Pair): Pair => {
    if (!sameJson(r.p, d)) ctx.report.diff[ctx.report.diff.length - 1].borradorDescartado = shown(d);
    return r;
  };
  if (auto) return discard(row(auto.value, auto.origen));
  if (!revisionChanged) return row(d, "borrador");
  const decision = ctx.decide(path);
  if (decision) {
    ctx.used.add(path);
    return discard(row(decision === "borrador" ? d : u, `decisión: ${decision}`));
  }
  ctx.report.enDisputa.push({ campo: path, publicado: shown(b), borrador: shown(d), revision: shown(u) });
  return { p: d, n: d };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Aplica una revisión a un producto con borrador ajeno pendiente. `{ state: "none" }` si no lo hay (publicado al día).
 * Sin `apply` no escribe nada: devuelve lo que haría, con el diff completo.
 */
export async function reviewOverDraft(
  svc: WebAdminService,
  store: WebStore,
  o: {
    key: string;
    author: string;
    apply?: boolean;
    /** La política, o cómo obtenerla del borrador ajeno (para ligar una autorización a su versión). */
    policy: OverDraftPolicy | ((borrador: { version: number; versionPublicada: number }) => OverDraftPolicy);
    decisions?: readonly OverDraftDecision[];
  },
): Promise<OverDraftOutcome> {
  const { key, author } = o;
  const policyFor = (version: number, versionPublicada: number) => (typeof o.policy === "function" ? o.policy({ version, versionPublicada }) : o.policy);
  const cur = await store.getEntry("product", key);
  if (!cur) return { state: "blocked", reason: "no existe en el catálogo" };
  if (cur.publication !== "published" || cur.publishedVersion === null) return { state: "blocked", reason: `no está publicado (${cur.publication}); se decide en el CRM` };
  if (cur.publishedVersion === cur.draftVersion) return { state: "none" };
  const publishedVersion = cur.publishedVersion;

  const versions = await store.versions(cur.id);
  const baseSnapshot = versions.find((v) => v.version === publishedVersion)?.snapshot;
  if (!baseSnapshot) return { state: "blocked", reason: `la versión publicada (v${publishedVersion}) no está en el historial; se revisa en el CRM` };
  // El borrador ajeno: el actual o, si el último guardado es de esta revisión (ejecución interrumpida), el último ajeno
  // posterior a lo publicado; si todos los posteriores son de esta revisión, el actual (ya lleva lo retenido)
  const foreign = cur.updatedBy === author ? versions.filter((v) => v.version > publishedVersion && v.author !== author).sort((a, b) => b.version - a.version)[0] : undefined;
  const base = productDraft.safeParse(baseSnapshot);
  const draft = productDraft.safeParse(foreign?.snapshot ?? cur.draft);
  const head = productDraft.safeParse(cur.draft);
  if (!base.success || !draft.success || !head.success) return { state: "blocked", reason: `${!base.success ? "la versión publicada" : "el borrador"} no valida con el esquema actual; se revisa en el CRM` };

  const report: OverDraftReport = {
    key,
    borrador: { version: foreign?.version ?? cur.draftVersion, versionPublicada: publishedVersion, autor: foreign?.author ?? cur.updatedBy, guardado: new Date(foreign?.createdAt ?? cur.updatedAt).toISOString() },
    diff: [],
    retenido: [],
    retirado: [],
    enDisputa: [],
    decisionesAplicadas: [],
    decisionesIgnoradas: [],
  };
  const policy = policyFor(report.borrador.version, publishedVersion);
  let reviewed: ProductDraft;
  try {
    reviewed = policy.reviewed(base.data);
  } catch (e) {
    return { state: "blocked", reason: `la revisión no se puede aplicar sobre lo publicado (${message(e)}); se revisa en el CRM`, report };
  }
  const mine = (o.decisions ?? []).filter((x) => x.key === key);
  // Corte entre los dos guardados de una ejecución anterior (quedó como borrador lo que se iba a publicar, sin lo
  // retenido) y edición posterior en el CRM: el borrador actual ya no lleva lo retenido. No se escribe nada
  if (cur.updatedBy !== author) {
    const own = versions.filter((v) => v.version > publishedVersion && v.author === author).sort((a, b) => b.version - a.version)[0];
    const before = own ? versions.filter((v) => v.version > publishedVersion && v.version < own.version && v.author !== author).sort((a, b) => b.version - a.version)[0] : undefined;
    const ownDraft = own ? productDraft.safeParse(own.snapshot) : undefined;
    const beforeDraft = before ? productDraft.safeParse(before.snapshot) : undefined;
    if (own && before && ownDraft?.success && beforeDraft?.success) {
      const probe: OverDraftReport = { ...report, diff: [], retenido: [], retirado: [], enDisputa: [] };
      const prevPolicy = policyFor(before.version, publishedVersion);
      const prevValid = new Map(mine.filter((x) => x.borradorVersion === before.version).map((x) => [x.campo, x.gana]));
      const prev = merge3(base.data, beforeDraft.data, prevPolicy.reviewed(base.data), "", { policy: prevPolicy, report: probe, decide: (campo) => prevValid.get(campo), used: new Set() });
      const prevPublish = productDraft.safeParse(prev.p);
      if (prevPublish.success && probe.retenido.length && sameJson(ownDraft.data, prevPublish.data))
        return {
          state: "blocked",
          reason: `una ejecución anterior de esta revisión quedó a medias (su v${own.version} no lleva los cambios retenidos del borrador v${before.version}: ${probe.retenido.map((x) => x.campo).join(", ")}) y después se editó en el CRM; lo retenido está en la v${before.version} del historial; se revisa en el CRM`,
          report,
        };
    }
  }
  const valid = new Map(mine.filter((x) => x.borradorVersion === report.borrador.version).map((x) => [x.campo, x.gana]));
  const ctx: MergeCtx = { policy, report, decide: (campo) => valid.get(campo), used: new Set() };
  const merged = merge3(base.data, draft.data, reviewed, "", ctx);
  const applied = (x: OverDraftDecision) => x.borradorVersion === report.borrador.version && ctx.used.has(x.campo);
  report.decisionesAplicadas = mine.filter(applied).map((x) => `${x.campo}: ${x.gana} (${x.nota})`);
  report.decisionesIgnoradas = mine
    .filter((x) => !applied(x))
    .map((x) => `${x.campo}: ${x.gana} — ${x.borradorVersion !== report.borrador.version ? `se tomó sobre el borrador v${x.borradorVersion} y el actual es el v${report.borrador.version}` : "no corresponde a ningún campo en disputa"}`);

  const start = policy.startProblems?.(base.data) ?? [];
  if (start.length) return { state: "blocked", reason: `la revisión no se puede aplicar sobre lo publicado (${start.join("; ")}); no se guarda ni se publica`, report };
  if (report.enDisputa.length) return { state: "blocked", reason: `${report.enDisputa.length} campo(s) en disputa (${report.enDisputa.map((p) => p.campo).join(", ")}); el borrador v${report.borrador.version} queda intacto, sin guardar ni publicar`, report };
  const clashes = report.retenido.filter((x) => "revision" in x);
  if (policy.retainedClashBlocks && clashes.length)
    return { state: "blocked", reason: `el borrador v${report.borrador.version} cambia campo(s) que también cambia la revisión (${clashes.map((x) => x.campo).join(", ")}); no se guarda ni se publica: se resuelve en el CRM`, report };
  const toPublish = productDraft.safeParse(merged.p);
  const nextDraft = productDraft.safeParse(merged.n);
  const invalid = !toPublish.success ? toPublish.error : !nextDraft.success ? nextDraft.error : null;
  if (!toPublish.success || !nextDraft.success) return { state: "blocked", reason: `el resultado no valida (${invalid!.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}); no se guarda ni se publica`, report };
  const bad = policy.checkResult?.(toPublish.data);
  if (bad) return { state: "blocked", reason: bad, report };

  const changesPublished = !sameJson(toPublish.data, base.data);
  const keepsDraft = !sameJson(nextDraft.data, toPublish.data);
  const savesDraft = !sameJson(nextDraft.data, head.data);
  // Con cambios retenidos el producto sigue con borrador pendiente; sin ellos queda publicado al día (aunque lo publicado
  // no cambie: se publica la versión nueva, idéntica, para que no quede un borrador pendiente)
  if (keepsDraft && !changesPublished && !savesDraft) return { state: "already", report };
  const publishes = changesPublished || !keepsDraft;
  if (publishes) {
    const problems = await svc.publishProblems("product", key, toPublish.data);
    if (problems.length) return { state: "blocked", reason: `el resultado no se puede publicar (${problems.join("; ")}); el borrador queda intacto`, report };
  }
  const count = (f: (x: OverDraftFieldDiff) => boolean) => report.diff.filter(f).length;
  const summary = [
    `sobre el borrador v${report.borrador.version} de ${report.borrador.autor}`,
    changesPublished ? `se publica: ${count((x) => x.origen.startsWith("revisión") || x.origen === "decisión: revision")} campo(s) de la revisión, ${count((x) => x.origen.startsWith("borrador") || x.origen === "decisión: borrador")} del borrador, ${count((x) => x.origen.startsWith("ambos"))} de ambos` : "lo publicado no cambia",
    ...(report.retirado.length ? [`se retira(n) del borrador: ${report.retirado.map((x) => x.campo).join(", ")}`] : []),
    keepsDraft ? `${report.retenido.length} cambio(s) del borrador retenido(s) sin publicar (${report.retenido.map((x) => x.campo).join(", ")})` : "no queda borrador pendiente",
  ].join("; ");
  if (!o.apply) return { state: "changed", summary, report };

  try {
    let version = cur.draftVersion;
    if (!publishes) {
      // Solo falta reponer el borrador con lo retenido (ejecución interrumpida después de publicar)
      await svc.save("product", key, { draft: nextDraft.data, expectedVersion: version }, author);
    } else {
      if (!sameJson(head.data, toPublish.data)) version = (await svc.save("product", key, { draft: toPublish.data, expectedVersion: version }, author)).draftVersion;
      if (!keepsDraft) await svc.publish("product", key, version, author);
      else {
        // Primero se repone el borrador con lo retenido y después se publica la versión anterior: lo retenido nunca deja
        // de estar en el borrador vigente ni se publica
        await svc.save("product", key, { draft: nextDraft.data, expectedVersion: version }, author);
        await svc.republishVersion("product", key, version, publishedVersion, author, "revisión de catálogo sobre un borrador ajeno: lo retenido sigue en el borrador");
      }
    }
  } catch (e) {
    return { state: "blocked", reason: `no se pudo guardar o publicar (${message(e)}); se revisa en el CRM`, report };
  }
  return { state: "changed", summary, report };
}
