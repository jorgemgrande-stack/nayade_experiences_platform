/**
 * Ski Net · Alquiler v1 por unidad: ajustes de la sede, tiendas y horarios, modelos, unidades con código, entrega y
 * devolución por unidad con compatibilidad, contrato con firma por clic en el mostrador y taller.
 *
 * Mismo orden que la v0.1 (`service.ts`): sede válida → licencia `ski-rental` de la sede (`ModuleGate`) → para operar,
 * el módulo activado en la sede (`ModuleNotActive`). La activación es la de la v0.1 (`ski_rental_sites`).
 *
 * La firma es en el mostrador (la tableta o el equipo del empleado, con sesión del panel): no hay página pública de
 * firma en esta entrega. Fianzas y cargos por daños con enlace de pago: fuera de esta entrega.
 */
import { ModuleNotActive, assertSite, runWithSite, type EventBus, type ModuleGate } from "../sdk";
import { SKI_RENTAL_ID, type SkiRentalEvents } from "./manifest";
import { SkiRentalError } from "./service";
import type { SkiRentalStore } from "./store";
import {
  MANUAL_TARGETS,
  NEUTRAL_CONTRACT_TERMS,
  UNIT_STATUSES,
  UnitRuleError,
  assertCompatible,
  assertUnitTransition,
  autoUnitCode,
  checkSignature,
  checkStoreHours,
  contractHash,
  canonicalContract,
  isReturnLate,
  normalizeAssetTypes,
  normalizeTerms,
  normalizeUnitCode,
  type CodeLabel,
  type ContractContent,
  type StoreHours,
  type UnitStatus,
} from "./units";
import type { Delivery, ReturnCondition, SkiRentalUnitStore } from "./unitStore";

const isDuplicate = (err: unknown) => {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  return false;
};
const missingCode = (err: unknown): string | null => (err && typeof err === "object" && "missingCode" in err ? String((err as { missingCode: unknown }).missingCode) : null);

function rule<T>(fn: () => T, code: SkiRentalError["code"] = "invalid_input"): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof UnitRuleError) throw new SkiRentalError(code, e.message);
    throw e;
  }
}
const text = (v: string | null | undefined, max: number, what: string, min = 0): string | null => {
  const t = (v ?? "").trim();
  if (!t) {
    if (min > 0) throw new SkiRentalError("invalid_input", `${what}: obligatorio`);
    return null;
  }
  if (t.length < min || t.length > max) throw new SkiRentalError("invalid_input", `${what}: entre ${min || 1} y ${max} caracteres`);
  return t;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function day(s: string, what: string) {
  if (!DAY_RE.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new SkiRentalError("invalid_input", `${what}: fecha no válida`);
  return s;
}

export interface UnitsDeps {
  store: SkiRentalUnitStore;
  /** Activación por sede de la v0.1. */
  activation: Pick<SkiRentalStore, "site">;
  gate: () => ModuleGate;
  events: () => EventBus<SkiRentalEvents>;
  assertSite?: (siteId: string) => Promise<void>;
  /** Fecha y minutos del día en la sede (para devoluciones tardías). Por defecto, hora de Madrid. */
  now?: () => { date: string; minutes: number };
}

function madridNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, minutes: Number(p("hour")) * 60 + Number(p("minute")) };
}

export interface DeliveryInput {
  storeId: number;
  customerName: string;
  reservationId?: number | null;
  startDate: string;
  expectedReturnDate: string;
  lines: Array<{ code: string; requestedType: string; requestedSize?: string | null; confirmSize?: boolean; reason?: string | null }>;
}

export class SkiRentalUnitsService {
  constructor(private d: UnitsDeps) {}

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    return runWithSite(siteId, async () => {
      await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_RENTAL_ID)))(siteId);
      await this.d.gate().assert(SKI_RENTAL_ID, { write, siteId });
      if (write && !(await this.d.activation.site(siteId))?.active) throw new ModuleNotActive(SKI_RENTAL_ID, siteId);
      return fn();
    });
  }

  private async types(siteId: string): Promise<CodeLabel[]> {
    const s = await this.d.store.settings(siteId);
    try {
      return normalizeAssetTypes(s?.assetTypes ?? null);
    } catch {
      return normalizeAssetTypes(null);
    }
  }
  private async siteStore(siteId: string, id: number) {
    const s = await this.d.store.store(id);
    if (!s || s.siteId !== siteId) throw new SkiRentalError("not_found", "Tienda no encontrada en esta sede");
    return s;
  }
  private async siteModel(siteId: string, id: number) {
    const m = await this.d.store.model(id);
    if (!m || m.siteId !== siteId) throw new SkiRentalError("not_found", "Modelo no encontrado en esta sede");
    return m;
  }
  private async siteUnit(siteId: string, id: number) {
    const u = await this.d.store.unit(id);
    if (!u || u.siteId !== siteId) throw new SkiRentalError("not_found", "Unidad no encontrada en esta sede");
    return u;
  }
  private async siteDelivery(siteId: string, id: number) {
    const x = await this.d.store.delivery(id);
    if (!x || x.siteId !== siteId) throw new SkiRentalError("not_found", "Entrega no encontrada en esta sede");
    return x;
  }

  // ── Ajustes ──────────────────────────────────────────────────────────────────

  settings(siteId: string) {
    return this.within(siteId, false, () => this.settingsRaw(siteId));
  }

  /** Tipos de material y texto del contrato (null = volver a la plantilla neutra). Cambiar el texto crea versión nueva. */
  updateSettings(siteId: string, patch: { assetTypes?: CodeLabel[]; contractTerms?: string | null }, actor: string) {
    return this.within(siteId, true, async () => {
      const out: { assetTypes?: CodeLabel[]; contractTerms?: string | null } = {};
      if (patch.assetTypes !== undefined) out.assetTypes = rule(() => normalizeAssetTypes(patch.assetTypes));
      if (patch.contractTerms !== undefined) {
        const current = (await this.d.store.settings(siteId))?.contractTerms ?? null;
        const next = patch.contractTerms == null || !patch.contractTerms.trim() ? null : rule(() => normalizeTerms(patch.contractTerms));
        if (next !== current) out.contractTerms = next;
      }
      await this.d.store.saveSettings(siteId, out, actor);
      return this.settingsRaw(siteId);
    });
  }
  private async settingsRaw(siteId: string) {
    const s = await this.d.store.settings(siteId);
    return { assetTypes: await this.types(siteId), contractTerms: s?.contractTerms ?? NEUTRAL_CONTRACT_TERMS, defaultTerms: !s?.contractTerms, termsVersion: s?.termsVersion ?? 1 };
  }

  // ── Tiendas ──────────────────────────────────────────────────────────────────

  listStores(siteId: string) {
    return this.within(siteId, false, () => this.d.store.stores(siteId));
  }
  createStore(siteId: string, input: { name: string } & StoreHours) {
    return this.within(siteId, true, async () => {
      const name = text(input.name, 120, "Nombre de la tienda", 2)!;
      rule(() => checkStoreHours(input));
      try {
        const id = await this.d.store.insertStore({ siteId, name, openingTime: input.openingTime, closingTime: input.closingTime, overdueReturnTime: input.overdueReturnTime });
        return (await this.d.store.store(id))!;
      } catch (e) {
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Ya existe una tienda con ese nombre en la sede");
        throw e;
      }
    });
  }
  updateStore(siteId: string, id: number, patch: Partial<{ name: string } & StoreHours> & { active?: boolean }) {
    return this.within(siteId, true, async () => {
      const cur = await this.siteStore(siteId, id);
      const hours = { openingTime: patch.openingTime ?? cur.openingTime, closingTime: patch.closingTime ?? cur.closingTime, overdueReturnTime: patch.overdueReturnTime ?? cur.overdueReturnTime };
      rule(() => checkStoreHours(hours));
      const name = patch.name !== undefined ? text(patch.name, 120, "Nombre de la tienda", 2)! : undefined;
      try {
        await this.d.store.updateStore(id, { ...hours, ...(name ? { name } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) });
      } catch (e) {
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Ya existe una tienda con ese nombre en la sede");
        throw e;
      }
      return (await this.d.store.store(id))!;
    });
  }

  // ── Modelos y unidades ───────────────────────────────────────────────────────

  /** Modelos con sus unidades por estado (inventario y disponibilidad en tiempo real). */
  listModels(siteId: string) {
    return this.within(siteId, false, async () => {
      const [models, counts] = await Promise.all([this.d.store.models(siteId), this.d.store.unitCounts(siteId)]);
      return models.map((m) => {
        const byStatus = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<UnitStatus, number>;
        for (const c of counts) if (c.modelId === m.id) byStatus[c.status] = c.n;
        return { ...m, units: byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) - byStatus.retired };
      });
    });
  }
  createModel(siteId: string, input: { assetType: string; name: string; brand?: string | null; size?: string | null; replacementValueCents?: number | null }) {
    return this.within(siteId, true, async () => {
      const types = await this.types(siteId);
      if (!types.some((t) => t.code === input.assetType)) throw new SkiRentalError("invalid_input", `El tipo «${input.assetType}» no está configurado en la sede`);
      const size = (input.size ?? "").trim();
      if (size.length > 16) throw new SkiRentalError("invalid_input", "Talla no válida");
      const v = input.replacementValueCents;
      if (v != null && (!Number.isInteger(v) || v < 0 || v > 10_000_000)) throw new SkiRentalError("invalid_input", "Valor de reposición no válido");
      try {
        const id = await this.d.store.insertModel({ siteId, assetType: input.assetType, name: text(input.name, 120, "Nombre del modelo", 2)!, brand: text(input.brand, 80, "Marca"), size, replacementValueCents: v ?? null });
        return (await this.d.store.model(id))!;
      } catch (e) {
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Ya existe ese modelo con esa talla en la sede");
        throw e;
      }
    });
  }
  updateModel(siteId: string, id: number, patch: { name?: string; brand?: string | null; replacementValueCents?: number | null; active?: boolean }) {
    return this.within(siteId, true, async () => {
      await this.siteModel(siteId, id);
      const v = patch.replacementValueCents;
      if (v != null && (!Number.isInteger(v) || v < 0 || v > 10_000_000)) throw new SkiRentalError("invalid_input", "Valor de reposición no válido");
      await this.d.store.updateModel(id, {
        ...(patch.name !== undefined ? { name: text(patch.name, 120, "Nombre del modelo", 2)! } : {}),
        ...(patch.brand !== undefined ? { brand: text(patch.brand, 80, "Marca") } : {}),
        ...(v !== undefined ? { replacementValueCents: v } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      });
      return (await this.d.store.model(id))!;
    });
  }

  listUnits(siteId: string, f: { modelId?: number; status?: UnitStatus } = {}) {
    return this.within(siteId, false, () => this.d.store.units(siteId, f));
  }

  /** Alta de unidades: con códigos propios (etiquetas ya impresas) o `count` con código automático. */
  createUnits(siteId: string, input: { modelId: number; storeId?: number | null; codes?: string[]; count?: number }, actor: string) {
    return this.within(siteId, true, async () => {
      const model = await this.siteModel(siteId, input.modelId);
      if (!model.active) throw new SkiRentalError("invalid_input", "El modelo está archivado");
      if (input.storeId != null) await this.siteStore(siteId, input.storeId);
      let codes: string[] | null = null;
      if (input.codes && input.codes.length) {
        if (input.codes.length > 200) throw new SkiRentalError("invalid_input", "Como mucho 200 unidades por alta");
        codes = rule(() => input.codes!.map(normalizeUnitCode));
        if (new Set(codes).size !== codes.length) throw new SkiRentalError("invalid_input", "Hay códigos repetidos en la lista");
      } else if (!Number.isInteger(input.count) || input.count! < 1 || input.count! > 200) throw new SkiRentalError("invalid_input", "Indica cuántas unidades (1 a 200) o sus códigos");
      try {
        const ids = await this.d.store.insertUnits(siteId, model.id, input.storeId ?? null, codes, codes?.length ?? input.count!, (seq) => autoUnitCode(model.assetType, seq), actor);
        return Promise.all(ids.map(async (id) => (await this.d.store.unit(id))!));
      } catch (e) {
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Alguno de esos códigos ya existe en la sede");
        throw e;
      }
    });
  }

  /** Búsqueda por código escaneado (QR o código de barras de la etiqueta). */
  scan(siteId: string, code: string) {
    return this.within(siteId, false, async () => {
      const c = rule(() => normalizeUnitCode(code));
      const u = await this.d.store.unitByCode(siteId, c);
      if (!u) throw new SkiRentalError("not_found", `No hay ninguna unidad con el código ${c}`);
      return { unit: u, model: await this.d.store.model(u.modelId) };
    });
  }

  unitHistory(siteId: string, unitId: number) {
    return this.within(siteId, false, async () => {
      const unit = await this.siteUnit(siteId, unitId);
      return { unit, model: await this.d.store.model(unit.modelId), events: await this.d.store.unitEvents(unitId) };
    });
  }

  /** Cambio manual desde el inventario (disponible, incidencia o retirada). Entregas, devoluciones y taller van por su flujo. */
  setUnitStatus(siteId: string, unitId: number, to: UnitStatus, note: string | null | undefined, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteUnit(siteId, unitId);
      if (!MANUAL_TARGETS.includes(to)) throw new SkiRentalError("invalid_input", "Ese estado se cambia desde el mostrador o el taller");
      const n = text(note, 300, "Nota");
      return this.d.store.changeUnit(
        unitId,
        (u) => {
          if (u.status === "rented") throw new SkiRentalError("conflict", `La unidad ${u.code} está alquilada: regístrala con la devolución`);
          if (u.status === "workshop") throw new SkiRentalError("conflict", `La unidad ${u.code} está en el taller: ciérrala desde su orden`);
          rule(() => assertUnitTransition(u.status, to), "conflict");
          return { to, kind: "manual", note: n };
        },
        actor,
      );
    });
  }

  // ── Mostrador: entregas, devoluciones y contrato ─────────────────────────────

  private late(x: Delivery, hours: StoreHours | null) {
    if (x.status !== "open") return false;
    const now = (this.d.now ?? madridNow)();
    return hours ? isReturnLate(x.expectedReturnDate, now, hours) : now.date > x.expectedReturnDate;
  }

  listDeliveries(siteId: string, status?: Delivery["status"]) {
    return this.within(siteId, false, async () => {
      const [rows, stores] = await Promise.all([this.d.store.deliveries(siteId, status), this.d.store.stores(siteId)]);
      const lines = await this.d.store.lines(rows.map((r) => r.id));
      const contracts = await Promise.all(rows.map((r) => this.d.store.contract(r.id)));
      return rows.map((r, i) => {
        const st = stores.find((s) => s.id === r.storeId) ?? null;
        const mine = lines.filter((l) => l.deliveryId === r.id);
        return { ...r, storeName: st?.name ?? "—", units: mine.length, pending: mine.filter((l) => !l.returnedAt).length, contractStatus: contracts[i]?.status ?? null, late: this.late(r, st) };
      });
    });
  }

  getDelivery(siteId: string, deliveryId: number) {
    return this.within(siteId, false, async () => {
      const x = await this.siteDelivery(siteId, deliveryId);
      const [st, lines, contract] = await Promise.all([this.d.store.store(x.storeId), this.d.store.lines([x.id]), this.d.store.contract(x.id)]);
      const units = await Promise.all(lines.map((l) => this.d.store.unit(l.unitId)));
      const models = await Promise.all(units.map((u) => (u ? this.d.store.model(u.modelId) : null)));
      return {
        ...x,
        storeName: st?.name ?? "—",
        late: this.late(x, st),
        lines: lines.map((l, i) => ({ ...l, code: units[i]?.code ?? "—", modelName: models[i]?.name ?? "—", size: models[i]?.size || null })),
        contract,
      };
    });
  }

  /**
   * Entrega al cliente: cada unidad (por su código) debe estar disponible, en la sede y ser del tipo pedido; una talla
   * distinta exige confirmación y motivo. Pasa las unidades a alquiladas y deja el contrato pendiente de firma.
   */
  createDelivery(siteId: string, input: DeliveryInput, actor: string) {
    return this.within(siteId, true, async () => {
      const store = await this.siteStore(siteId, input.storeId);
      if (!store.active) throw new SkiRentalError("invalid_input", "La tienda está archivada");
      const customerName = text(input.customerName, 120, "Nombre del cliente", 2)!;
      const startDate = day(input.startDate, "Fecha de entrega");
      const expectedReturnDate = day(input.expectedReturnDate, "Fecha de devolución");
      if (expectedReturnDate < startDate) throw new SkiRentalError("invalid_input", "La devolución es anterior a la entrega");
      if (!input.lines.length || input.lines.length > 30) throw new SkiRentalError("invalid_input", "Indica entre 1 y 30 unidades");
      const types = await this.types(siteId);
      const lines = input.lines.map((l) => {
        if (!types.some((t) => t.code === l.requestedType)) throw new SkiRentalError("invalid_input", `El tipo «${l.requestedType}» no está configurado`);
        return { code: rule(() => normalizeUnitCode(l.code)), requestedType: l.requestedType, requestedSize: text(l.requestedSize, 16, "Talla"), confirmSize: !!l.confirmSize, reason: text(l.reason, 200, "Motivo") };
      });
      if (new Set(lines.map((l) => l.code)).size !== lines.length) throw new SkiRentalError("invalid_input", "Hay una unidad repetida en la entrega");
      let reservationId: number | null = null;
      if (input.reservationId != null) {
        if (!(await this.d.store.reservationExists(input.reservationId))) throw new SkiRentalError("not_found", `No existe la reserva #${input.reservationId}`);
        reservationId = input.reservationId;
      }
      const settings = await this.d.store.settings(siteId);
      const terms = settings?.contractTerms ?? NEUTRAL_CONTRACT_TERMS;
      const termsVersion = settings?.termsVersion ?? 1;
      let id: number;
      try {
        id = await this.d.store.createDelivery(
          { siteId, storeId: store.id, customerName, reservationId, startDate, expectedReturnDate },
          lines.map((l) => ({ code: l.code, requestedType: l.requestedType, requestedSize: l.requestedSize, reason: l.reason })),
          (picked) =>
            picked.forEach(({ unit, model }, i) => {
              if (unit.status !== "available") throw new SkiRentalError("conflict", `La unidad ${unit.code} no está disponible (${unit.status})`);
              rule(() => assertCompatible({ code: unit.code, assetType: model.assetType, size: model.size || null }, { assetType: lines[i].requestedType, size: lines[i].requestedSize, confirmSize: lines[i].confirmSize, reason: lines[i].reason }), "conflict");
            }),
          (deliveryId, picked) => {
            const content: ContractContent = {
              deliveryId,
              siteId,
              storeName: store.name,
              customerName,
              startDate,
              expectedReturnDate,
              lines: picked.map(({ unit, model }) => ({ code: unit.code, assetType: model.assetType, model: model.name, size: model.size || null })),
              termsVersion,
              terms,
            };
            return { termsVersion, content: canonicalContract(content), contentHash: contractHash(content) };
          },
          actor,
        );
      } catch (e) {
        const code = missingCode(e);
        if (code) throw new SkiRentalError("not_found", `No hay ninguna unidad con el código ${code} en esta sede`);
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Alguna unidad ya está en otra entrega abierta");
        throw e;
      }
      await this.d.events().emit("ski_rental.delivery.created", { deliveryId: id, units: lines.length });
      return this.getDeliveryRaw(siteId, id);
    });
  }
  private async getDeliveryRaw(siteId: string, id: number) {
    return { ...(await this.siteDelivery(siteId, id)), contract: await this.d.store.contract(id) };
  }

  /** Devolución de una unidad: en buen estado vuelve a disponible; con daño o perdida queda con incidencia. */
  returnLine(siteId: string, lineId: number, condition: ReturnCondition, note: string | null | undefined, actor: string) {
    return this.within(siteId, true, async () => {
      const line = await this.d.store.line(lineId);
      if (!line || line.siteId !== siteId) throw new SkiRentalError("not_found", "Línea de entrega no encontrada en esta sede");
      if (!["ok", "damaged", "lost"].includes(condition)) throw new SkiRentalError("invalid_input", "Estado de devolución no válido");
      const n = text(note, 300, "Nota");
      if (condition !== "ok" && !n) throw new SkiRentalError("invalid_input", "Describe el daño o la pérdida");
      const r = await this.d.store.returnLine(
        lineId,
        condition,
        n,
        (l, u) => {
          if (l.returnedAt) throw new SkiRentalError("conflict", `La unidad ${u.code} ya se devolvió`);
          const to: UnitStatus = condition === "ok" ? "available" : "incident";
          rule(() => assertUnitTransition(u.status, to), "conflict");
          return to;
        },
        actor,
      );
      if (r.deliveryClosed) await this.d.events().emit("ski_rental.delivery.returned", { deliveryId: line.deliveryId });
      return { deliveryId: line.deliveryId, deliveryClosed: r.deliveryClosed };
    });
  }

  /**
   * Firma por clic en el mostrador: nombre escrito y aceptación expresa, con IP y navegador del equipo y el empleado que
   * la recoge. Antes se comprueba que la huella guardada corresponde al contenido. Firmar dos veces no cambia nada.
   */
  signContract(siteId: string, deliveryId: number, input: { signerName: string; accepted: boolean }, evidence: { ip: string | null; userAgent: string | null }, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteDelivery(siteId, deliveryId);
      const c = await this.d.store.contract(deliveryId);
      if (!c) throw new SkiRentalError("not_found", "La entrega no tiene contrato");
      if (c.status === "signed") return { contract: c, alreadySigned: true };
      const signerName = rule(() => checkSignature(input));
      let content: ContractContent;
      try {
        content = JSON.parse(c.content) as ContractContent;
      } catch {
        throw new SkiRentalError("conflict", "El contenido del contrato no es válido");
      }
      if (contractHash(content) !== c.contentHash) throw new SkiRentalError("conflict", "El contrato no coincide con su huella: no se puede firmar");
      const signed = await this.d.store.signContract(deliveryId, { signerName, ip: evidence.ip, userAgent: evidence.userAgent, signedBy: actor });
      if (signed) await this.d.events().emit("ski_rental.contract.signed", { deliveryId, contentHash: c.contentHash });
      return { contract: (await this.d.store.contract(deliveryId))!, alreadySigned: !signed };
    });
  }

  listContracts(siteId: string, status?: "pending" | "signed") {
    return this.within(siteId, false, async () =>
      (await this.d.store.contracts(siteId, status)).map(({ content, ...c }) => {
        let customerName = "—";
        try {
          customerName = (JSON.parse(content) as ContractContent).customerName;
        } catch {
          /* contenido ilegible: se muestra sin nombre */
        }
        return { ...c, customerName };
      }),
    );
  }

  // ── Taller ───────────────────────────────────────────────────────────────────

  listTickets(siteId: string, status?: "open" | "done") {
    return this.within(siteId, false, async () => {
      const tickets = await this.d.store.tickets(siteId, status);
      const units = await Promise.all(tickets.map((t) => this.d.store.unit(t.unitId)));
      const models = await Promise.all(units.map((u) => (u ? this.d.store.model(u.modelId) : null)));
      return tickets.map((t, i) => ({ ...t, code: units[i]?.code ?? "—", modelName: models[i]?.name ?? "—", unitStatus: units[i]?.status ?? null }));
    });
  }

  /** Envía una unidad disponible o con incidencia al taller. */
  openTicket(siteId: string, unitId: number, reason: string, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteUnit(siteId, unitId);
      const r = text(reason, 300, "Motivo", 3)!;
      const id = await this.d.store.openTicket(siteId, unitId, r, (u) => {
        if (u.status === "rented") throw new SkiRentalError("conflict", `La unidad ${u.code} está alquilada: regístrala antes con la devolución`);
        rule(() => assertUnitTransition(u.status, "workshop"), "conflict");
      }, actor);
      return (await this.d.store.ticket(id))!;
    });
  }

  /** Cierra la orden: la unidad vuelve a disponible, queda con incidencia o se retira. */
  closeTicket(siteId: string, ticketId: number, resolution: "available" | "incident" | "retired", notes: string | null | undefined, actor: string) {
    return this.within(siteId, true, async () => {
      const t = await this.d.store.ticket(ticketId);
      if (!t || t.siteId !== siteId) throw new SkiRentalError("not_found", "Orden de taller no encontrada en esta sede");
      const n = text(notes, 500, "Notas");
      await this.d.store.closeTicket(ticketId, resolution, n, (tk, u) => {
        if (tk.status !== "open") throw new SkiRentalError("conflict", "La orden de taller ya está cerrada");
        rule(() => assertUnitTransition(u.status, resolution), "conflict");
      }, actor);
      return (await this.d.store.ticket(ticketId))!;
    });
  }
}

