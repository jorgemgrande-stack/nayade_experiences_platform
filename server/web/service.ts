/**
 * Administración del catálogo comercial y de los contenidos de www.bigelephant.es.
 *
 * Flujo editorial común a todo: borrador versionado → vista previa → publicación → (despublicación)
 * con historial, restauración y auditoría. Nada nuevo se publica solo.
 *
 * Reglas comerciales:
 *  - Un producto solo se publica si sus dependencias están publicadas y sus referencias técnicas
 *    (módulo de licencia o plan de facturación) existen; no se despublica si otro publicado depende de él.
 *  - Precios inmutables: aprobar uno nuevo retira el anterior del mismo tipo (el historial queda).
 *    Un producto en hoja de ruta PUEDE tener precio aprobado (la web muestra el portfolio con sus
 *    tarifas), pero no es contratable: lo decide su estado comercial (`catalog.commercialStatus`).
 *  - Honestidad: «Disponible» (commercialStatus available) exige estado técnico «available».
 *  - El catálogo público solo contiene lo publicado y nunca datos internos (costes, márgenes, notas).
 *  - Nada de esto toca facturación ni contratos: los contratos guardan su propio importe.
 *  - Política comercial (inclusiones de los planes, cupos propuestos, regla de paquetes): vive en los borradores con
 *    su estado (aprobada o propuesta). Lo propuesto se simula en el CRM pero nunca se publica
 *    (server/catalog/commercial/checks.ts y la proyección pública de schemas.ts).
 */
import crypto from "node:crypto";
import { ZodError } from "zod";
import { CAPABILITY_IDS } from "../catalog/capabilities";
import { commercialChecks, shapeProblems, type CheckEntry, type CommercialCheck } from "../catalog/commercial/checks";
import { policyFromProducts, type PolicyMode, type PolicySource } from "../catalog/commercial/fromCatalog";
import type { CommercialPolicy } from "../catalog/commercial/policy";
import type { QuoteCatalog } from "../catalog/quote";
import { quoteCatalogFromSite } from "../catalog/snapshot";
import {
  BUNDLE_FAMILIES,
  DRAFT_SCHEMAS,
  FAMILIES,
  productDraft,
  KEY_RE,
  PRICE_KINDS,
  publicView,
  type EntryKind,
  type Family,
  type PriceKind,
  type ProductDraft,
} from "./schemas";
import { DuplicateEntryError, PriceStateError, VersionConflictError, type WebEntry, type WebPrice, type WebStore } from "./store";

export class WebError extends Error {
  constructor(
    public code: "not_found" | "invalid_input" | "invalid_state" | "conflict" | "version_conflict",
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface WebRefs {
  /** Módulos de licencia existentes (manifiestos del Core). */
  moduleIds: string[];
  /** Planes del catálogo de facturación, si está configurado (null = no se puede comprobar). */
  planIds: () => string[] | null;
  /** Ids estables de capacidades (por defecto, el registro de server/catalog/capabilities.ts). */
  capabilityIds?: readonly string[];
}

/** Singletons de contenido: claves fijas que la web sabe consumir. */
export const DOCUMENT_KEYS: Record<Exclude<EntryKind, "product" | "promotion" | "capability">, string[]> = {
  faq: ["general"],
  menu: ["main", "footer"],
  seo: ["routes"],
  page: ["nosotros", "legal-privacidad", "legal-cookies", "legal-condiciones", "legal-prueba-y-datos"],
  forms: ["settings"],
};

export interface PublicPrice {
  kind: PriceKind;
  amountCents: number;
  currency: string;
  unit: string | null;
  taxRateBp: number;
  taxIncluded: boolean;
  draft?: boolean;
}
export interface SiteDocument {
  version: string;
  generatedAt: number;
  preview: boolean;
  catalog: {
    products: Array<Record<string, unknown> & { key: string; family: string; sortOrder: number; prices: PublicPrice[] }>;
    promotions: Array<Record<string, unknown>>;
    /** Capacidades publicadas (ids estables y textos). */
    capabilities: Array<Record<string, unknown> & { key: string; sortOrder: number }>;
  };
  content: {
    faq: Record<string, unknown> | null;
    menus: Record<string, Record<string, unknown>>;
    seo: Record<string, unknown> | null;
    pages: Record<string, Record<string, unknown>>;
    forms: Record<string, unknown> | null;
  };
}

const ENTITY = (k: EntryKind) => k;
const publicPrice = (p: WebPrice, draft = false): PublicPrice => ({
  kind: p.kind,
  amountCents: p.amountCents,
  currency: p.currency,
  unit: p.unit,
  taxRateBp: p.taxRateBp,
  taxIncluded: p.taxIncluded,
  ...(draft ? { draft: true } : {}),
});

export class WebAdminService {
  private now: () => number;
  constructor(
    private d: {
      store: WebStore;
      refs: WebRefs;
      now?: () => number;
      onPublish?: (version: string) => void;
      /**
       * Política comercial activa en este entorno (por defecto, no): solo entonces se publican las reglas aprobadas
       * (inclusiones de los planes, ampliación por presupuesto, regla de paquetes). Activarla exige antes que los
       * pedidos y los cobros (orquestador y Stripe) usen el mismo cotizador comercial.
       */
      commercialPolicy?: boolean;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  async list(kind?: EntryKind) {
    const entries = await this.d.store.listEntries({ kind });
    return entries.map((e) => ({
      kind: e.kind,
      key: e.key,
      family: e.family,
      sortOrder: e.sortOrder,
      name: String((e.draft as { name?: string; title?: string }).name ?? (e.draft as { title?: string }).title ?? e.key),
      technicalStatus: (e.draft as { technicalStatus?: string }).technicalStatus ?? null,
      // Disponibilidad comercial (borrador) y si su evidencia está registrada (el texto es interno y no viaja aquí)
      commercialStatus: e.kind === "product" ? ((e.draft as { catalog?: { commercialStatus?: string } }).catalog?.commercialStatus ?? "on_request") : null,
      hasEvidence: e.kind === "product" ? !!(e.draft as { internal?: { evidence?: string | null } }).internal?.evidence : null,
      publication: e.publication,
      draftVersion: e.draftVersion,
      publishedVersion: e.publishedVersion,
      pendingChanges: hasPendingChanges(e),
      updatedAt: e.updatedAt,
      updatedBy: e.updatedBy,
      publishedAt: e.publishedAt,
    }));
  }

  async get(kind: EntryKind, key: string) {
    const entry = await this.must(kind, key);
    const [versions, prices, events] = await Promise.all([
      this.d.store.versions(entry.id),
      kind === "product" ? this.d.store.listPrices(entry.id) : Promise.resolve([]),
      this.d.store.listEvents({ entity: ENTITY(kind), key, limit: 50 }),
    ]);
    return { entry, versions, prices, events };
  }

  async overview() {
    const [entries, prices, events] = await Promise.all([this.d.store.listEntries(), this.d.store.listPrices(), this.d.store.listEvents({ limit: 20 })]);
    const pending = entries.filter(hasPendingChanges);
    return {
      published: entries.filter((e) => e.publication === "published").length,
      drafts: entries.filter((e) => e.publication === "draft").length,
      unpublished: entries.filter((e) => e.publication === "unpublished").length,
      pendingChanges: pending.map((e) => ({ kind: e.kind, key: e.key, publication: e.publication, draftVersion: e.draftVersion, publishedVersion: e.publishedVersion })),
      pendingPrices: prices.filter((p) => p.status === "draft").length,
      byFamily: Object.fromEntries(FAMILIES.map((f) => [f, entries.filter((e) => e.kind === "product" && e.family === f).length])),
      recentEvents: events,
    };
  }

  async events(f: { entity?: string; key?: string; limit?: number } = {}) {
    return this.d.store.listEvents(f);
  }

  /** Auditoría de los enlaces de vista previa emitidos (dan acceso temporal a los borradores). */
  async recordPreview(author: string, expiresAt: number) {
    await this.audit("preview", "site", "issue", author, `Enlace de vista previa hasta ${new Date(expiresAt).toISOString()}`);
  }

  // ── Edición ────────────────────────────────────────────────────────────────

  async create(input: { kind: EntryKind; key: string; family?: string | null; sortOrder?: number; draft: unknown }, author: string): Promise<WebEntry> {
    if (!KEY_RE.test(input.key)) throw new WebError("invalid_input", "Clave no válida: minúsculas, números y guiones");
    if (input.kind === "product") {
      if (!FAMILIES.includes(input.family as Family)) throw new WebError("invalid_input", "Familia no válida");
    } else if (input.kind === "capability") {
      if (!this.capabilityIds().includes(input.key)) throw new WebError("invalid_input", "Capacidad desconocida: la clave debe ser un id del registro de capacidades");
    } else if (input.kind !== "promotion") {
      if (!DOCUMENT_KEYS[input.kind].includes(input.key)) throw new WebError("invalid_input", `Clave no admitida para ${input.kind}: ${DOCUMENT_KEYS[input.kind].join(", ")}`);
    }
    const draft = this.parse(input.kind, input.draft);
    if (input.kind === "product") this.checkProductShape(input.family as Family, draft as ProductDraft);
    const now = this.now();
    try {
      const e = await this.d.store.createEntry({
        kind: input.kind,
        key: input.key,
        family: input.kind === "product" ? (input.family as string) : null,
        sortOrder: input.sortOrder ?? 0,
        publication: "draft",
        draft,
        draftVersion: 1,
        published: null,
        publishedVersion: null,
        createdAt: now,
        createdBy: author,
        updatedAt: now,
        updatedBy: author,
        publishedAt: null,
        publishedBy: null,
      });
      await this.audit(input.kind, input.key, "create", author, "Borrador creado (sin publicar)");
      return e;
    } catch (err) {
      if (err instanceof DuplicateEntryError) throw new WebError("conflict", "Ya existe una entrada con esa clave");
      throw err;
    }
  }

  async save(kind: EntryKind, key: string, input: { draft: unknown; sortOrder?: number; expectedVersion: number }, author: string): Promise<WebEntry> {
    const cur = await this.must(kind, key);
    const draft = this.parse(kind, input.draft);
    if (kind === "product") this.checkProductShape(cur.family as Family, draft as ProductDraft);
    try {
      const e = await this.d.store.saveDraft(cur.id, input.expectedVersion, draft, input.sortOrder ?? cur.sortOrder, author, this.now());
      await this.audit(kind, key, "save", author, `Borrador v${e.draftVersion}`);
      return e;
    } catch (err) {
      if (err instanceof VersionConflictError) throw new WebError("version_conflict", `Otra persona guardó antes (versión actual ${err.current}). Recarga para no perder cambios.`, { current: err.current });
      throw err;
    }
  }

  async restore(kind: EntryKind, key: string, version: number, author: string): Promise<WebEntry> {
    const cur = await this.must(kind, key);
    const v = (await this.d.store.versions(cur.id)).find((x) => x.version === version);
    if (!v) throw new WebError("not_found", "Versión no encontrada");
    const e = await this.save(kind, key, { draft: v.snapshot, expectedVersion: cur.draftVersion }, author);
    await this.audit(kind, key, "restore", author, `Borrador restaurado desde v${version} (queda sin publicar hasta publicarlo)`);
    return e;
  }

  // ── Publicación ────────────────────────────────────────────────────────────

  async publish(kind: EntryKind, key: string, expectedVersion: number, author: string): Promise<WebEntry> {
    const cur = await this.must(kind, key);
    if (cur.draftVersion !== expectedVersion) throw new WebError("version_conflict", `El borrador cambió (versión actual ${cur.draftVersion}). Revísalo antes de publicar.`, { current: cur.draftVersion });
    const draft = this.parse(kind, cur.draft);
    if (kind === "product") await this.checkPublishable(cur, draft as ProductDraft);
    if (kind === "capability" && !this.capabilityIds().includes(key)) throw new WebError("invalid_state", "Capacidad desconocida en el registro");
    if (kind === "promotion") {
      const missing: string[] = [];
      for (const p of (draft as { products: string[] }).products) if ((await this.d.store.getEntry("product", p))?.publication !== "published") missing.push(p);
      if (missing.length) throw new WebError("invalid_state", `La promoción usa productos no publicados: ${missing.join(", ")}`, { missing });
    }
    const now = this.now();
    const e = await this.d.store.setPublication(cur.id, {
      publication: "published",
      published: publicView(kind, draft, { policy: !!this.d.commercialPolicy }),
      publishedVersion: cur.draftVersion,
      publishedAt: now,
      publishedBy: author,
      updatedAt: now,
      updatedBy: author,
    });
    await this.audit(kind, key, "publish", author, `Publicada la v${cur.draftVersion}`);
    await this.notify();
    return e;
  }

  async unpublish(kind: EntryKind, key: string, author: string): Promise<WebEntry> {
    const cur = await this.must(kind, key);
    if (cur.publication !== "published") throw new WebError("invalid_state", "No está publicada");
    if (kind === "product" || kind === "capability") {
      const refsOf = (e: WebEntry) => {
        const p = (e.published ?? {}) as { dependencies?: string[]; compatibleWith?: string[]; catalog?: { bundleOf?: string[]; inherits?: string | null; capabilities?: string[]; inclusions?: Array<{ key: string; overflowKey?: string }> } };
        return kind === "capability"
          ? p.catalog?.capabilities ?? []
          : [
              ...(p.dependencies ?? []),
              ...(p.compatibleWith ?? []),
              ...(p.catalog?.bundleOf ?? []),
              ...(p.catalog?.inherits ? [p.catalog.inherits] : []),
              ...(p.catalog?.inclusions ?? []).flatMap((i) => [i.key, ...(i.overflowKey ? [i.overflowKey] : [])]),
            ];
      };
      const dependents = (await this.d.store.listEntries({ kind: "product" })).filter((e) => e.publication === "published" && e.key !== key && refsOf(e).includes(key));
      const promos = (await this.d.store.listEntries({ kind: "promotion" })).filter((e) => e.publication === "published" && ((e.published as { products?: string[] })?.products ?? []).includes(key));
      if (dependents.length || promos.length) {
        const list = [...dependents.map((e) => e.key), ...promos.map((e) => `promoción ${e.key}`)];
        throw new WebError("invalid_state", `Hay elementos publicados que dependen de este producto: ${list.join(", ")}. Despublícalos o cambia sus dependencias antes.`, { dependents: list });
      }
    }
    const now = this.now();
    const e = await this.d.store.setPublication(cur.id, { publication: "unpublished", published: null, publishedVersion: null, publishedAt: cur.publishedAt, publishedBy: cur.publishedBy, updatedAt: now, updatedBy: author });
    await this.audit(kind, key, "unpublish", author, "Retirada de la web");
    await this.notify();
    return e;
  }

  // ── Precios ────────────────────────────────────────────────────────────────

  async addPrice(
    key: string,
    input: { kind: PriceKind; amountCents: number; currency?: string; unit?: string | null; taxRateBp: number; taxIncluded?: boolean; note?: string | null },
    author: string,
  ): Promise<WebPrice> {
    const entry = await this.must("product", key);
    if (!PRICE_KINDS.includes(input.kind)) throw new WebError("invalid_input", "Tipo de precio no válido");
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new WebError("invalid_input", "El importe debe ser un número entero de céntimos ≥ 0");
    if (!Number.isInteger(input.taxRateBp) || input.taxRateBp < 0 || input.taxRateBp > 10_000) throw new WebError("invalid_input", "Impuesto no válido (puntos básicos 0–10000)");
    const currency = (input.currency ?? "EUR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new WebError("invalid_input", "Moneda no válida (ISO 4217)");
    const unit = input.unit?.trim() || null;
    if (input.kind === "usage" && !unit) throw new WebError("invalid_input", "Un precio por consumo necesita unidad (minuto, mensaje…)");
    const p = await this.d.store.insertPrice({
      entryId: entry.id,
      kind: input.kind,
      amountCents: input.amountCents,
      currency,
      unit,
      taxRateBp: input.taxRateBp,
      taxIncluded: !!input.taxIncluded,
      status: "draft",
      note: input.note?.trim().slice(0, 300) || null,
      createdAt: this.now(),
      createdBy: author,
      approvedAt: null,
      approvedBy: null,
      retiredAt: null,
      retiredBy: null,
    });
    await this.audit("price", `${key}#${p.id}`, "create", author, `Precio en borrador: ${input.kind} ${input.amountCents} ${currency}`);
    return p;
  }

  async approvePrice(id: number, author: string): Promise<WebPrice> {
    const p = await this.mustPrice(id);
    if (p.status !== "draft") throw new WebError("invalid_state", "Solo se aprueban precios en borrador");
    const entry = (await this.d.store.listEntries({ kind: "product" })).find((e) => e.id === p.entryId)!;
    // Un solo precio vigente por tipo, moneda y unidad: el anterior se retira (y queda en el
    // historial) en la misma transacción que la aprobación, con su auditoría.
    let out: WebPrice;
    try {
      ({ approved: out } = await this.d.store.approvePrice(id, { author, now: this.now(), entryKey: entry.key, detail: `${p.kind} ${p.amountCents} ${p.currency}` }));
    } catch (err) {
      if (err instanceof PriceStateError) throw new WebError("invalid_state", "Otra persona cambió este precio antes: recarga para ver su estado actual");
      throw err;
    }
    if (entry.publication === "published") await this.notify();
    return out;
  }

  async retirePrice(id: number, author: string): Promise<WebPrice> {
    const p = await this.mustPrice(id);
    if (p.status !== "approved") throw new WebError("invalid_state", "Solo se retiran precios aprobados");
    const out = await this.d.store.setPriceStatus(id, { status: "retired", approvedAt: p.approvedAt, approvedBy: p.approvedBy, retiredAt: this.now(), retiredBy: author });
    const entry = (await this.d.store.listEntries({ kind: "product" })).find((e) => e.id === p.entryId)!;
    await this.audit("price", `${entry.key}#${id}`, "retire", author, null);
    if (entry.publication === "published") await this.notify();
    return out;
  }

  async deletePrice(id: number, author: string): Promise<void> {
    const p = await this.mustPrice(id);
    if (p.status !== "draft") throw new WebError("invalid_state", "Los precios aprobados o retirados no se borran: forman parte del historial");
    if (!(await this.d.store.deleteDraftPrice(id))) throw new WebError("invalid_state", "Otra persona cambió este precio antes: recarga para ver su estado actual");
    await this.audit("price", `#${id}`, "delete", author, "Borrador de precio eliminado");
  }

  // ── Sitio público ──────────────────────────────────────────────────────────

  /** Documento que consume la web: solo lo publicado (o, en vista previa, los borradores). */
  async site(mode: "published" | "preview" = "published"): Promise<SiteDocument> {
    const preview = mode === "preview";
    const [entries, prices] = await Promise.all([this.d.store.listEntries(), this.d.store.listPrices()]);
    const now = this.now();
    // Vista previa: todo lo que no esté retirado, con su borrador actual (como quedaría al publicarlo)
    const visible = (e: WebEntry) => (preview ? e.publication !== "unpublished" : e.publication === "published");
    const body = (e: WebEntry) => (preview ? publicView(e.kind, e.draft, { policy: !!this.d.commercialPolicy }) : (e.published as Record<string, unknown>));
    const products = entries
      .filter((e) => e.kind === "product" && visible(e))
      .map((e) => {
        const b = body(e) as Record<string, unknown> & { technicalStatus?: string };
        const own = prices.filter((p) => p.entryId === e.id);
        const list = [...own.filter((p) => p.status === "approved").map((p) => publicPrice(p)), ...(preview ? own.filter((p) => p.status === "draft").map((p) => publicPrice(p, true)) : [])];
        return { ...b, key: e.key, family: e.family as string, sortOrder: e.sortOrder, prices: list };
      });
    const productKeys = new Set(products.map((p) => p.key));
    const promotions = entries
      .filter((e) => e.kind === "promotion" && visible(e))
      .map((e) => ({ ...body(e), key: e.key }) as Record<string, unknown> & { startsAt?: number | null; endsAt?: number | null; products?: string[] })
      .filter((p) => (preview || ((!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now))) && (p.products ?? []).every((k) => productKeys.has(k)));
    const doc = (kind: EntryKind, key: string) => {
      const e = entries.find((x) => x.kind === kind && x.key === key && visible(x));
      return e ? body(e) : null;
    };
    const content: SiteDocument["content"] = {
      faq: doc("faq", "general"),
      menus: Object.fromEntries(DOCUMENT_KEYS.menu.map((k) => [k, doc("menu", k)]).filter(([, v]) => v)) as Record<string, Record<string, unknown>>,
      seo: doc("seo", "routes"),
      pages: Object.fromEntries(DOCUMENT_KEYS.page.map((k) => [k, doc("page", k)]).filter(([, v]) => v)) as Record<string, Record<string, unknown>>,
      forms: doc("forms", "settings"),
    };
    const capabilities = entries.filter((e) => e.kind === "capability" && visible(e)).map((e) => ({ ...(body(e) as Record<string, unknown>), key: e.key, sortOrder: e.sortOrder }));
    const catalog = { products, promotions, capabilities };
    const version = crypto.createHash("sha256").update(JSON.stringify({ catalog, content, preview })).digest("hex").slice(0, 16);
    return { version, generatedAt: now, preview, catalog, content };
  }

  /**
   * Sitio PÚBLICO: el documento de `site()` sin los productos internos de pruebas (`catalog.internalOnly`) ni
   * nada que los nombre (paquetes, dependencias o promociones). Toda salida pública usa esta vista; `site()` sigue
   * completo para los usos internos (cotización del equipo, licencias, compra de las empresas de prueba).
   */
  async publicSite(mode: "published" | "preview" = "published"): Promise<SiteDocument> {
    return withoutInternal(await this.site(mode));
  }

  // ── Política comercial ─────────────────────────────────────────────────────

  /** Revisión comercial de todos los productos (borradores): bloqueos de publicación, avisos y reglas pendientes. */
  async commercialReview(): Promise<{ policyEnabled: boolean; products: Array<CommercialCheck & { name: string; family: string | null; publication: string; pendingChanges: boolean }> }> {
    const entries = (await this.d.store.listEntries({ kind: "product" })).filter((e) => e.publication !== "unpublished");
    const all = checkEntries(entries);
    const policyEnabled = !!this.d.commercialPolicy;
    const products = all.map((c) => {
      const e = entries.find((x) => x.key === c.key)!;
      const check = commercialChecks(c, all, { policyEnabled: !!this.d.commercialPolicy });
      const cat = c.draft.catalog;
      const approved = [
        ...(cat.inclusions ?? []).filter((i) => i.status === "approved" && (!i.cap || i.cap.status === "approved")).map((i) => `inclusión ${i.key}`),
        ...(cat.quoteOnRequest?.status === "approved" ? ["ampliaciones por presupuesto"] : []),
        ...(cat.bundleRule?.status === "approved" ? [`regla de paquetes ${cat.bundleRule.kind}`] : []),
      ];
      if (!policyEnabled && approved.length) check.warnings.push(`Reglas aprobadas sin efecto todavía (política comercial desactivada en este entorno): ${approved.join(", ")}`);
      return { ...check, name: c.draft.name, family: c.family, publication: e.publication, pendingChanges: hasPendingChanges(e) };
    });
    return { policyEnabled, products };
  }

  /**
   * Catálogo del cotizador y política comercial. «published»: lo publicado, solo reglas aprobadas (propuestas del
   * CRM). «proposed»: los borradores con sus reglas propuestas y los precios aprobados (solo el simulador del CRM).
   */
  async commercialCatalog(mode: PolicyMode): Promise<{ catalog: QuoteCatalog; policy: CommercialPolicy }> {
    if (mode === "published") {
      const site = await this.site("published");
      return { catalog: quoteCatalogFromSite(site), policy: policyFromProducts(site.catalog.products as unknown as PolicySource[], "published") };
    }
    const [entries, prices] = await Promise.all([this.d.store.listEntries({ kind: "product" }), this.d.store.listPrices()]);
    const products = entries
      .filter((e) => e.publication !== "unpublished")
      .map((e) => ({ ...e.draft, key: e.key, family: e.family as string, sortOrder: e.sortOrder, prices: prices.filter((p) => p.entryId === e.id && p.status === "approved").map((p) => publicPrice(p)) }));
    const version = `borradores-${crypto.createHash("sha256").update(JSON.stringify(products)).digest("hex").slice(0, 12)}`;
    return { catalog: quoteCatalogFromSite({ version, catalog: { products, promotions: [], capabilities: [] } }), policy: policyFromProducts(products as unknown as PolicySource[], "proposed") };
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  private parse(kind: EntryKind, draft: unknown): Record<string, unknown> {
    try {
      return DRAFT_SCHEMAS[kind].parse(draft) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ZodError) throw new WebError("invalid_input", e.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`).join("; "), { fields: e.issues.map((i) => i.path.join(".")) });
      throw e;
    }
  }

  /** Coherencia entre familia, activación y facturación (sin consultar otras entradas). */
  private checkProductShape(family: Family, d: ProductDraft) {
    if (d.dependencies.length !== new Set(d.dependencies).size) throw new WebError("invalid_input", "Dependencias repetidas");
    if (family === "core_plan" && d.activation.kind !== "plan") throw new WebError("invalid_input", "Un plan de Elephant Core se activa como «plan»");
    if (family === "industry_module" && d.technicalStatus === "available" && d.activation.kind !== "module" && d.activation.kind !== "feature")
      throw new WebError("invalid_input", "Un módulo sectorial disponible se activa como módulo de licencia (o función del núcleo)");
    if (family === "service" && d.billingModel !== "one_time" && d.billingModel !== "recurring_addon") throw new WebError("invalid_input", "Un servicio es de pago único o recurrente");
    if (family === "usage" && d.billingModel !== "usage" && d.billingModel !== "credits") throw new WebError("invalid_input", "Un consumo se factura por uso o por créditos");
    // Un módulo sectorial disponible apunta a un módulo de licencia real. Un plan comercial puede no estar
    // enlazado aún a un plan de facturación (ref null): hoy nada se contrata automáticamente.
    if (d.activation.kind === "module" && !d.activation.ref && d.technicalStatus !== "planned") throw new WebError("invalid_input", "Indica el módulo de licencia");
    const cat = d.catalog;
    if (cat.commercialStatus === "available" && d.technicalStatus !== "available") throw new WebError("invalid_input", "«Disponible» exige que el producto esté técnicamente disponible: usa «Implantación acompañada», «En preparación» o «Próximamente»");
    if (BUNDLE_FAMILIES.includes(family) && cat.bundleOf.length < 2) throw new WebError("invalid_input", "Un paquete incluye al menos dos productos");
    if (!BUNDLE_FAMILIES.includes(family) && cat.bundleOf.length) throw new WebError("invalid_input", "Solo los paquetes tienen componentes");
    if (cat.internalOnly && family === "core_plan") throw new WebError("invalid_input", "Un plan de Elephant Core no puede ser interno: los planes son públicos");
    if (cat.inherits && family !== "core_plan") throw new WebError("invalid_input", "Solo un plan de Elephant Core hereda de otro plan");
    if (family === "addon" && !cat.addonFor) throw new WebError("invalid_input", "Un complemento de cantidad indica la métrica que amplía");
    if (family !== "addon" && cat.addonFor) throw new WebError("invalid_input", "Solo los complementos de cantidad amplían una métrica");
    const policyProblems = shapeProblems(family, d);
    if (policyProblems.length) throw new WebError("invalid_input", policyProblems.join("; "));
    const unknown = cat.capabilities.filter((x) => !this.capabilityIds().includes(x));
    if (unknown.length) throw new WebError("invalid_input", `Capacidades desconocidas: ${unknown.join(", ")}`);
    if (new Set(cat.capabilities).size !== cat.capabilities.length) throw new WebError("invalid_input", "Capacidades repetidas");
  }

  private capabilityIds(): readonly string[] {
    return this.d.refs.capabilityIds ?? CAPABILITY_IDS;
  }

  /** Antes de publicar: referencias técnicas y dependencias publicadas. */
  private async checkPublishable(cur: WebEntry, d: ProductDraft) {
    const problems: string[] = [];
    if (d.activation.kind === "module" && d.activation.ref && !this.d.refs.moduleIds.includes(d.activation.ref)) problems.push(`el módulo de licencia «${d.activation.ref}» no existe`);
    const plans = this.d.refs.planIds();
    if (d.activation.kind === "plan" && d.activation.ref && plans && !plans.includes(d.activation.ref)) problems.push(`el plan de facturación «${d.activation.ref}» no existe`);
    const products = await this.d.store.listEntries({ kind: "product" });
    for (const dep of d.dependencies) {
      if (dep === cur.key) problems.push("no puede depender de sí mismo");
      else if (products.find((p) => p.key === dep)?.publication !== "published") problems.push(`la dependencia «${dep}» no está publicada`);
    }
    for (const c of d.compatibleWith) {
      const p = products.find((x) => x.key === c);
      if (!p || p.family !== "core_plan") problems.push(`«${c}» no es un plan de Elephant Core`);
      else if (p.publication !== "published") problems.push(`el plan compatible «${c}» no está publicado`);
    }
    if (hasCycle(cur.key, d.dependencies, products)) problems.push("las dependencias forman un ciclo");
    for (const b of d.catalog.bundleOf) {
      if (b === cur.key) problems.push("un paquete no se incluye a sí mismo");
      else if (products.find((p) => p.key === b)?.publication !== "published") problems.push(`el componente «${b}» no está publicado`);
    }
    if (d.catalog.inherits) {
      const base = products.find((p) => p.key === d.catalog.inherits);
      if (!base || base.family !== "core_plan") problems.push(`«${d.catalog.inherits}» no es un plan de Elephant Core`);
      else if (base.publication !== "published") problems.push(`el plan base «${d.catalog.inherits}» no está publicado`);
    }
    if (d.catalog.capabilities.length) {
      const caps = await this.d.store.listEntries({ kind: "capability" });
      for (const x of d.catalog.capabilities) if (caps.find((e) => e.key === x)?.publication !== "published") problems.push(`la capacidad «${x}» no está publicada`);
    }
    const all = checkEntries(products.filter((p) => p.key !== cur.key)).concat({ key: cur.key, family: cur.family, publication: cur.publication, draft: d });
    problems.push(...commercialChecks(all[all.length - 1], all, { policyEnabled: !!this.d.commercialPolicy }).blocking);
    if (problems.length) throw new WebError("invalid_state", `No se puede publicar: ${problems.join("; ")}`, { problems });
  }

  private async must(kind: EntryKind, key: string) {
    const e = await this.d.store.getEntry(kind, key);
    if (!e) throw new WebError("not_found", "Entrada no encontrada");
    return e;
  }
  private async mustPrice(id: number) {
    const p = await this.d.store.getPrice(id);
    if (!p) throw new WebError("not_found", "Precio no encontrado");
    return p;
  }
  private async audit(entity: EntryKind | "price" | "preview", key: string, action: string, author: string, detail: string | null) {
    await this.d.store.addEvent({ entity, entityKey: key.slice(0, 120), action, author: author.slice(0, 100), detail: detail?.slice(0, 500) ?? null, createdAt: this.now() });
  }
  /** Avisa (p. ej. a un hook de regeneración de la web) con la nueva versión publicada. */
  private async notify() {
    if (!this.d.onPublish) return;
    try {
      this.d.onPublish((await this.publicSite("published")).version);
    } catch {
      /* un aviso fallido nunca deshace una publicación */
    }
  }
}

/** Productos con su borrador validado (los que no validan se omiten: el CRM ya los marca al abrirlos). */
function checkEntries(entries: WebEntry[]): CheckEntry[] {
  const out: CheckEntry[] = [];
  for (const e of entries) {
    if (e.kind !== "product") continue;
    const r = productDraft.safeParse(e.draft);
    if (r.success) out.push({ key: e.key, family: e.family, publication: e.publication, draft: r.data });
  }
  return out;
}

/** Pendiente de publicar: borrador nunca publicado o publicada con cambios posteriores. Lo retirado no lo está: se retiró a propósito. */
function hasPendingChanges(e: WebEntry): boolean {
  return e.publication === "draft" || (e.publication === "published" && e.publishedVersion !== e.draftVersion);
}

/** ¿Seguir las dependencias desde `start` vuelve a `start`? (con el borrador nuevo de `start`) */
function hasCycle(start: string, deps: string[], products: WebEntry[]): boolean {
  const graph = new Map(products.map((p) => [p.key, ((p.draft as ProductDraft).dependencies ?? []) as string[]]));
  graph.set(start, deps);
  const stack = [...deps];
  const seen = new Set<string>();
  while (stack.length) {
    const k = stack.pop()!;
    if (k === start) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...(graph.get(k) ?? []));
  }
  return false;
}

/** Claves de los productos internos de un documento del sitio. */
export function internalKeys(site: SiteDocument): Set<string> {
  return new Set(site.catalog.products.filter((p) => (p as { catalog?: { internalOnly?: boolean } }).catalog?.internalOnly === true).map((p) => p.key));
}

/**
 * Quita del documento los productos internos y todo lo que los nombre: paquetes que los incluyen, productos que
 * dependen de ellos y promociones que los aplican, y retira la propia marca. Recalcula la versión (ETag de la web)
 * sobre lo que queda.
 */
export function withoutInternal(site: SiteDocument): SiteDocument {
  const internal = internalKeys(site);
  const names = (p: Record<string, unknown>) => {
    const cat = (p.catalog ?? {}) as { bundleOf?: string[] };
    return [...(cat.bundleOf ?? []), ...((p.dependencies as string[] | undefined) ?? [])].some((k) => internal.has(k));
  };
  // La marca tampoco se publica: lo público no revela que exista un catálogo interno
  const strip = <T extends Record<string, unknown>>(p: T): T => {
    const cat = p.catalog as Record<string, unknown> | undefined;
    if (!cat || !("internalOnly" in cat)) return p;
    const { internalOnly: _x, ...rest } = cat;
    return { ...p, catalog: rest };
  };
  const products = site.catalog.products.filter((p) => !internal.has(p.key) && !names(p as Record<string, unknown>)).map((p) => strip(p as Record<string, unknown>) as typeof p);
  const promotions = site.catalog.promotions.filter((p) => !((p as { products?: string[] }).products ?? []).some((k) => internal.has(k)));
  const catalog = { ...site.catalog, products, promotions };
  const version = crypto.createHash("sha256").update(JSON.stringify({ catalog, content: site.content, preview: site.preview })).digest("hex").slice(0, 16);
  return { ...site, catalog, version };
}
