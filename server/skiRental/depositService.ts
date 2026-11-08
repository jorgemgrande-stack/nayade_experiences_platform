/**
 * Ski Net · Fianzas del alquiler de material (incluidas en la capacidad `ski-rental`, sin extensión de pago).
 *
 *  - Mismo orden que el resto del alquiler: sede válida → licencia `ski-rental` de la sede → para operar, el módulo
 *    activado en la sede. Cada fianza, cargo y sesión de caja se comprueba contra la sede de la petición.
 *  - Fianza por contrato (una por entrega): importe sugerido por modelo o por tipo de material, modificable en cada
 *    contrato; se registra al entregar en efectivo (entrada en la caja del TPV), con tarjeta en el datáfono o como
 *    retención externa anotada.
 *  - Al devolver: devolución total, o retención parcial o total con motivo, nota y fotos; la parte retenida es una venta
 *    del TPV del Core («Cargo por daños», con ticket e IVA) y lo que la fianza no cubre queda como cargo pendiente.
 *  - Idempotencia: una fianza por entrega (índice único), la liquidación reserva la fianza («settling») con su plan y la
 *    venta del TPV lleva su clave; repetir (doble clic, red lenta) devuelve el mismo resultado.
 *  - Criterio contable: shared/skiDeposits.ts.
 */
import { ModuleNotActive, assertSite, runWithSite, type ModuleGate } from "../sdk";
import {
  DepositRuleError,
  assertCents,
  assertChargeTransition,
  assertSettlementReason,

  chargeSaleKey,
  collectMovements,
  dayTotals,
  madridDay,
  needsCashSession,
  planSettlement,
  retentionPayMethod,
  retentionSaleKey,
  ruleKey,
  settlementMovements,
  suggestDamage,
  suggestDeposit,
  DEPOSIT_METHODS,
  PAY_METHODS,
  REQUEST_KEY_RE,
  type DepositMethod,
  type PayMethod,
} from "../../shared/skiDeposits";
import { SKI_RENTAL_ID } from "./manifest";
import { SkiRentalError } from "./service";
import type { SkiRentalStore } from "./store";
import type { CashSessionInfo, TenantDbDepositStore } from "./depositStore";
import type { SkiRentalUnitStore } from "./unitStore";

/** Venta del TPV del Core (el router pasa tpv.createSale con la sesión de quien cobra). */
export interface DamageSale {
  sessionId: number;
  idempotencyKey: string;
  customerName: string;
  concept: string;
  amountCents: number;
  method: PayMethod;
  notes: string;
}
export type CreateDamageSale = (s: DamageSale) => Promise<{ saleId: number; ticketNumber: string | null }>;

export interface DepositDeps {
  store: TenantDbDepositStore;
  units: Pick<SkiRentalUnitStore, "delivery" | "lines" | "unit" | "model" | "models">;
  activation: Pick<SkiRentalStore, "site">;
  gate: () => ModuleGate;
  assertSite?: (siteId: string) => Promise<void>;
  /** ¿Es la sede principal de la empresa? (las cajas sin sede, NULL, son de la principal). */
  isPrimarySite: (siteId: string) => Promise<boolean>;
  /** ¿Hay almacén privado de ficheros? Sin él no se admiten fotos de los daños. */
  photosEnabled: () => boolean;
}

function rule<T>(fn: () => T, code: SkiRentalError["code"] = "invalid_input"): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DepositRuleError) throw new SkiRentalError(code, e.message);
    throw e;
  }
}
function storeErr(e: unknown, what: string): never {
  if (e && typeof e === "object" && "notFound" in e) throw new SkiRentalError("not_found", `${what} no encontrada en esta sede`);
  if (e && typeof e === "object" && "conflict" in e) throw new SkiRentalError("conflict", String((e as { message?: unknown }).message ?? "Conflicto"));
  throw e;
}
const text = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Tipo real de la imagen por la firma de sus primeros bytes (JPEG, PNG o WebP); null si no es ninguna. */
export function imageTypeOf(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 6;

export class SkiDepositService {
  constructor(private d: DepositDeps) {}

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    return runWithSite(siteId, async () => {
      await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_RENTAL_ID)))(siteId);
      await this.d.gate().assert(SKI_RENTAL_ID, { write, siteId });
      if (write && !(await this.d.activation.site(siteId))?.active) throw new ModuleNotActive(SKI_RENTAL_ID, siteId);
      return fn();
    });
  }
  private async siteDelivery(siteId: string, id: number) {
    const x = await this.d.units.delivery(id);
    if (!x || x.siteId !== siteId) throw new SkiRentalError("not_found", "Entrega no encontrada en esta sede");
    return x;
  }
  private async siteDeposit(siteId: string, id: number) {
    const x = await this.d.store.deposit(id);
    if (!x || x.siteId !== siteId) throw new SkiRentalError("not_found", "Fianza no encontrada en esta sede");
    return x;
  }
  private async siteCharge(siteId: string, id: number) {
    const x = await this.d.store.charge(id);
    if (!x || x.siteId !== siteId) throw new SkiRentalError("not_found", "Cargo no encontrado en esta sede");
    return x;
  }
  /** La sesión debe estar abierta y ser de una caja de esta sede (sin sede = la principal). */
  private async assertSession(siteId: string, s: CashSessionInfo | null) {
    if (!s) throw new SkiRentalError("not_found", "Sesión de caja no encontrada");
    if (!s.open) throw new SkiRentalError("conflict", "La sesión de caja está cerrada: abre la caja en el TPV");
    const ok = s.siteId === siteId || (s.siteId == null && (await this.d.isPrimarySite(siteId)));
    if (!ok) throw new SkiRentalError("invalid_input", "Esa caja es de otra sede");
  }

  // ── Reglas por modelo o tipo de material ─────────────────────────────────────

  listRules(siteId: string) {
    return this.within(siteId, false, () => this.d.store.rules(siteId));
  }
  /** Importe de fianza de un modelo o de un tipo (null = quitar la regla). */
  setRule(siteId: string, input: { modelId?: number | null; assetType?: string | null; amountCents: number | null }, actor: string) {
    return this.within(siteId, true, async () => {
      const modelId = input.modelId ?? null;
      const assetType = modelId == null ? text(input.assetType, 24) : null;
      if (modelId != null) {
        const m = await this.d.units.model(modelId);
        if (!m || m.siteId !== siteId) throw new SkiRentalError("not_found", "Modelo no encontrado en esta sede");
      }
      const key = rule(() => ruleKey({ modelId, assetType }));
      const cents = input.amountCents == null ? null : rule(() => assertCents(input.amountCents, "Fianza"));
      await this.d.store.saveRule(siteId, key, modelId, assetType, cents, actor);
      return this.d.store.rules(siteId);
    });
  }

  // ── Fianza de una entrega ────────────────────────────────────────────────────

  /** Fianza de la entrega (si la hay), importe sugerido, daños sugeridos, cargos, historial y fotos. */
  forDelivery(siteId: string, deliveryId: number) {
    return this.within(siteId, false, async () => {
      const x = await this.siteDelivery(siteId, deliveryId);
      const [deposit, lines, rules, charges, events] = await Promise.all([
        this.d.store.depositByDelivery(deliveryId),
        this.d.units.lines([deliveryId]),
        this.d.store.rules(siteId),
        this.d.store.charges(siteId, { deliveryId }),
        this.d.store.events(siteId, deliveryId),
      ]);
      const units = await Promise.all(lines.map((l) => this.d.units.unit(l.unitId)));
      const models = await Promise.all(units.map((u) => (u ? this.d.units.model(u.modelId) : null)));
      const suggestion = suggestDeposit(
        models.map((m) => ({ modelId: m?.id ?? 0, assetType: m?.assetType ?? "" })),
        rules,
      );
      const damage = suggestDamage(lines.map((l, i) => ({ returnCondition: l.returnCondition, replacementValueCents: models[i]?.replacementValueCents ?? null })));
      return {
        delivery: { id: x.id, customerName: x.customerName, status: x.status, startDate: x.startDate, expectedReturnDate: x.expectedReturnDate },
        deposit: deposit && deposit.siteId === siteId ? deposit : null,
        attachments: deposit && deposit.siteId === siteId ? await this.d.store.attachments(deposit.id) : [],
        photosEnabled: this.d.photosEnabled(),
        suggestedCents: suggestion.totalCents,
        suggestedDamageCents: damage,
        damagedLines: lines.flatMap((l, i) => (l.returnCondition && l.returnCondition !== "ok" ? [{ code: units[i]?.code ?? "—", condition: l.returnCondition, note: l.returnNote, replacementValueCents: models[i]?.replacementValueCents ?? null }] : [])),
        charges,
        events,
      };
    });
  }

  /** Sesiones de caja abiertas de la sede, para elegir dónde cobrar o devolver. */
  cashSessions(siteId: string) {
    return this.within(siteId, false, async () => {
      const all = await this.d.store.openCashSessions();
      const primary = all.some((s) => s.siteId == null) ? await this.d.isPrimarySite(siteId) : false;
      return all.filter((s) => s.siteId === siteId || (s.siteId == null && primary));
    });
  }

  /**
   * Cobro de la fianza al entregar. Una por entrega: registrarla otra vez devuelve la misma (`replayed`). En efectivo
   * exige una sesión de caja abierta de la sede y deja la entrada manual en esa caja.
   */
  register(siteId: string, input: { deliveryId: number; amountCents: number; method: DepositMethod; sessionId?: number | null; externalRef?: string | null }, actor: string, cashierName: string) {
    return this.within(siteId, true, async () => {
      const x = await this.siteDelivery(siteId, input.deliveryId);
      if (!DEPOSIT_METHODS.includes(input.method)) throw new SkiRentalError("invalid_input", "Forma de cobro de la fianza no válida");
      const amountCents = rule(() => assertCents(input.amountCents, "Fianza"));
      const externalRef = text(input.externalRef, 120);
      const sessionId = input.sessionId ?? null;
      if (input.method === "cash" && sessionId == null) throw new SkiRentalError("invalid_input", "Elige la caja abierta donde entra el efectivo de la fianza");
      if (input.method === "external" && !externalRef) throw new SkiRentalError("invalid_input", "Anota la referencia de la retención externa (p. ej. la preautorización del datáfono)");
      const prev = await this.d.store.depositByDelivery(x.id);
      if (prev) return { deposit: prev, replayed: true };
      if (x.status !== "open") throw new SkiRentalError("conflict", "La entrega ya está devuelta: la fianza se cobra al entregar");
      // Las cajas sin sede (NULL) son de la principal: se resuelve antes para comprobarlo con la sesión bloqueada
      const primary = sessionId != null ? await this.d.isPrimarySite(siteId) : false;
      const r = await this.d.store
        .register(
          { siteId, deliveryId: x.id, customerName: x.customerName, amountCents, method: input.method, externalRef, sessionId, movements: collectMovements(input.method, amountCents, x.id), cashierName },
          (s) => {
            if (sessionId == null) return;
            if (!s) throw Object.assign(new Error("Sesión de caja no encontrada"), { notFoundSession: true, conflict: true });
            if (!s.open) throw Object.assign(new Error("La sesión de caja está cerrada: abre la caja en el TPV"), { conflict: true });
            if (!(s.siteId === siteId || (s.siteId == null && primary))) throw Object.assign(new Error("Esa caja es de otra sede"), { conflict: true });
          },
          actor,
        )
        .catch((e) => storeErr(e, "Entrega"));
      return { deposit: (await this.d.store.deposit(r.id))!, replayed: r.replayed };
    });
  }

  /**
   * Liquidación al devolver el material: devolución total (daños 0) o retención parcial o total con motivo. Lo retenido
   * se registra como venta «Cargo por daños» en el TPV; lo que exceda de la fianza queda como cargo pendiente.
   */
  settle(siteId: string, depositId: number, input: { damageCents: number; reason?: string | null; note?: string | null; sessionId?: number | null }, actor: string, cashierName: string, getSale: () => Promise<CreateDamageSale>) {
    return this.within(siteId, true, async () => {
      const dep = await this.siteDeposit(siteId, depositId);
      if (dep.status !== "held" && dep.status !== "settling") return { deposit: dep, replayed: true, ticketNumber: null as string | null };
      const delivery = await this.siteDelivery(siteId, dep.deliveryId);
      // Un plan nuevo solo si la fianza sigue cobrada; si ya se está liquidando, se continúa con el guardado
      let claimed = await this.d.store
        .claimSettlement(
          depositId,
          async (d, lockSession) => {
            if (d.status !== "held") return null;
            if (delivery.status !== "returned") throw new SkiRentalError("conflict", "Registra antes la devolución de todo el material de la entrega");
            const plan = rule(() => planSettlement(d.amountCents, input.damageCents));
            const reason = text(input.reason, 300);
            rule(() => assertSettlementReason(plan, reason));
            // Licencia de caja y permiso de concepto libre ANTES de reservar: nunca un FORBIDDEN a mitad
            if (plan.retainedCents > 0) await getSale();
            const sessionId = input.sessionId ?? null;
            if (needsCashSession(d.method, plan)) {
              if (sessionId == null) throw new SkiRentalError("invalid_input", d.method === "cash" ? "Elige la caja abierta de donde sale el efectivo" : "Elige la caja abierta donde se registra el cargo por daños");
              await this.assertSession(siteId, await lockSession(sessionId));
            }
            return { plan, sessionId: needsCashSession(d.method, plan) ? sessionId : null, reason, note: text(input.note, 1000) };
          },
          actor,
        )
        .catch((e) => storeErr(e, "Fianza"));
      if (claimed.status !== "settling") return { deposit: claimed, replayed: true, ticketNumber: null as string | null };
      const plan = rule(() => planSettlement(claimed.amountCents, claimed.damageCents ?? 0));
      const fresh = claimed.fresh;

      // Se retoma una liquidación a medias cuya caja ya está cerrada: se pasa a otra caja abierta de la sede
      if (!fresh && claimed.settleSessionId != null) {
        const stored = await this.d.store.cashSession(claimed.settleSessionId);
        if (!stored?.open) {
          const next = input.sessionId ?? null;
          if (next == null || next === claimed.settleSessionId) throw new SkiRentalError("conflict", "La caja de esta liquidación ya está cerrada: elige otra caja abierta de la sede para terminarla");
          const primary = await this.d.isPrimarySite(siteId);
          const moved = await this.d.store.reassignSettlementSession(depositId, next, async (_d, s) => {
            if (!s) throw new SkiRentalError("not_found", "Sesión de caja no encontrada");
            if (!s.open) throw new SkiRentalError("conflict", "La sesión de caja está cerrada: abre la caja en el TPV");
            if (!(s.siteId === siteId || (s.siteId == null && primary))) throw new SkiRentalError("invalid_input", "Esa caja es de otra sede");
          });
          if (moved.status !== "settling") return { deposit: moved, replayed: true, ticketNumber: null as string | null };
          claimed = { ...claimed, settleSessionId: moved.settleSessionId };
        }
      }

      let saleId: number | null = claimed.damageSaleId;
      let ticketNumber: string | null = null;
      if (plan.retainedCents > 0 && saleId == null) {
        const key = retentionSaleKey(depositId, plan.retainedCents);
        // Una venta de un intento anterior (quizá en la caja ya cerrada) se recupera por su clave: no se duplica
        const prev = fresh ? null : await this.d.store.saleByKey(key);
        if (prev && prev.status !== "pending") saleId = prev.id;
        else {
          try {
            const createSale = await getSale();
            const s = await createSale({
              sessionId: claimed.settleSessionId!,
              idempotencyKey: key,
              customerName: claimed.customerName,
              concept: `Cargo por daños · alquiler #${claimed.deliveryId}${claimed.settleReason ? ` · ${claimed.settleReason}` : ""}`.slice(0, 500),
              amountCents: plan.retainedCents,
              method: retentionPayMethod(claimed.method),
              notes: `Fianza ${depositId} retenida (${plan.status === "retained_total" ? "total" : "parcial"})`,
            });
            saleId = s.saleId;
            ticketNumber = s.ticketNumber;
          } catch (e) {
            // El TPV no la registró: sin venta con esa clave, la fianza vuelve a «cobrada» para repetir la liquidación
            if (!(await this.d.store.saleByKey(key).catch(() => null))) await this.d.store.releaseSettlement(depositId).catch(() => undefined);
            throw e;
          }
        }
        await this.d.store.recordSettlementSale(depositId, saleId);
      }
      try {
        const done = await this.d.store.finishSettlement(
          depositId,
          { plan, movements: settlementMovements(claimed.method, plan, claimed.deliveryId), saleId, cashierName, extraReason: `Daños no cubiertos por la fianza · alquiler #${claimed.deliveryId}${claimed.settleReason ? ` · ${claimed.settleReason}` : ""}` },
          actor,
        );
        return { deposit: done, replayed: false, ticketNumber };
      } catch (e) {
        // Sin venta de daños no hay nada hecho fuera de la fianza: vuelve a «cobrada». Con venta, sigue «liquidándose»
        // con la venta anotada y se termina eligiendo otra caja abierta.
        if (saleId == null) await this.d.store.releaseSettlement(depositId).catch(() => undefined);
        return storeErr(e, "Fianza");
      }
    });
  }

  /** Foto de los daños (imagen JPEG/PNG/WebP, 5 MB como mucho) guardada como fichero privado del Core. */
  addPhoto(siteId: string, depositId: number, file: { fileName: string; mimeType: string; data: Buffer }, actor: string, put: (key: string, data: Buffer, mime: string, name: string) => Promise<string>) {
    return this.within(siteId, true, async () => {
      const dep = await this.siteDeposit(siteId, depositId);
      if (!this.d.photosEnabled()) throw new SkiRentalError("conflict", "Las fotos de los daños necesitan el almacén privado de ficheros, que no está activo en esta instalación: describe los daños en la nota");
      if (!file.data.length || file.data.length > MAX_PHOTO_BYTES) throw new SkiRentalError("invalid_input", "La foto ocupa demasiado (5 MB como mucho)");
      // El tipo se comprueba por el contenido, no por lo que declara el navegador
      const real = imageTypeOf(file.data);
      if (!real || real !== file.mimeType) throw new SkiRentalError("invalid_input", "La foto debe ser una imagen JPEG, PNG o WebP");
      if ((await this.d.store.attachments(dep.id)).length >= MAX_PHOTOS) throw new SkiRentalError("conflict", `Como mucho ${MAX_PHOTOS} fotos por fianza`);
      const name = (file.fileName || "foto").replace(/[^\w.-]+/g, "_").slice(0, 120);
      const url = await put(`ski-deposits/${dep.id}/${Date.now()}-${name}`, file.data, file.mimeType, name);
      await this.d.store.addAttachment(siteId, dep.id, { fileUrl: url, fileName: name, mimeType: file.mimeType }, actor);
      return this.d.store.attachments(dep.id);
    });
  }

  // ── Cargos por daños ─────────────────────────────────────────────────────────

  /** Cargo por daños posterior (o adicional) de una entrega; `requestKey` evita duplicarlo con un doble clic. */
  createCharge(siteId: string, input: { deliveryId: number; amountCents: number; reason: string; requestKey: string }, actor: string) {
    return this.within(siteId, true, async () => {
      const x = await this.siteDelivery(siteId, input.deliveryId);
      const amountCents = rule(() => assertCents(input.amountCents, "Cargo"));
      const reason = text(input.reason, 300);
      if (!reason || reason.length < 3) throw new SkiRentalError("invalid_input", "Indica el motivo del cargo por daños");
      if (!REQUEST_KEY_RE.test(input.requestKey)) throw new SkiRentalError("invalid_input", "Clave de la petición no válida");
      const r = await this.d.store.createCharge({ siteId, deliveryId: x.id, amountCents, reason, requestKey: input.requestKey }, actor);
      return { charge: (await this.d.store.charge(r.id))!, replayed: r.replayed };
    });
  }

  /** Cobro del cargo en el TPV del Core (ticket con IVA). Repetirlo devuelve el mismo cobro. */
  payCharge(siteId: string, chargeId: number, input: { sessionId: number; method: PayMethod }, actor: string, createSale: CreateDamageSale) {
    return this.within(siteId, true, async () => {
      await this.siteCharge(siteId, chargeId);
      if (!PAY_METHODS.includes(input.method)) throw new SkiRentalError("invalid_input", "Forma de pago no válida");
      const c = await this.d.store
        .claimCharge(
          chargeId,
          async (cur, lockSession) => {
            if (cur.status === "paid") return false;
            if (cur.status === "pending") {
              rule(() => assertChargeTransition(cur.status, "paying"), "conflict");
              await this.assertSession(siteId, await lockSession(input.sessionId));
            }
            if (cur.status === "cancelled") throw new SkiRentalError("conflict", "El cargo está anulado");
            return true;
          },
          input,
        )
        .catch((e) => storeErr(e, "Cargo"));
      if (c.status === "paid") return { charge: c, replayed: true, ticketNumber: null as string | null };
      let sale: Awaited<ReturnType<CreateDamageSale>>;
      try {
        sale = await createSale({
          sessionId: c.paySessionId!,
          idempotencyKey: chargeSaleKey(chargeId),
          customerName: (await this.d.units.delivery(c.deliveryId))?.customerName ?? "",
          concept: `Cargo por daños · alquiler #${c.deliveryId} · ${c.reason}`.slice(0, 500),
          amountCents: c.amountCents,
          method: c.payMethod ?? input.method,
          notes: `Cargo por daños ${c.id}`,
        });
      } catch (e) {
        await this.d.store.releaseCharge(chargeId).catch(() => undefined);
        throw e;
      }
      return { charge: await this.d.store.finishCharge(chargeId, sale.saleId, actor), replayed: false, ticketNumber: sale.ticketNumber };
    });
  }

  cancelCharge(siteId: string, chargeId: number, reason: string, actor: string) {
    return this.within(siteId, true, async () => {
      await this.siteCharge(siteId, chargeId);
      const r = text(reason, 300);
      if (!r || r.length < 3) throw new SkiRentalError("invalid_input", "Indica el motivo de la anulación");
      return this.d.store
        .cancelCharge(chargeId, r, (c) => {
          if (c.status !== "cancelled") rule(() => assertChargeTransition(c.status, "cancelled"), "conflict");
        }, actor)
        .catch((e) => storeErr(e, "Cargo"));
    });
  }

  // ── Mostrador y cierre de caja ───────────────────────────────────────────────

  /** Fianzas abiertas (en custodia) o cerradas, y cargos pendientes. */
  list(siteId: string, status: "open" | "closed") {
    return this.within(siteId, false, async () => {
      const [deposits, charges] = await Promise.all([this.d.store.deposits(siteId, { open: status === "open" }), this.d.store.charges(siteId, { open: true })]);
      return { deposits, pendingCharges: charges };
    });
  }

  /** Totales del día (Madrid) para el cierre de caja: cobrado, devuelto y retenido por forma, en custodia y cargos. */
  totals(siteId: string, day: string) {
    return this.within(siteId, false, async () => {
      if (!DAY_RE.test(day)) throw new SkiRentalError("invalid_input", "Fecha no válida");
      // Margen de un día por la zona horaria: el filtro exacto por día de Madrid lo hace dayTotals
      const since = Date.parse(`${day}T00:00:00Z`) - 86_400_000;
      if (Number.isNaN(since)) throw new SkiRentalError("invalid_input", "Fecha no válida");
      const [deposits, charges] = await Promise.all([this.d.store.deposits(siteId, { since }), this.d.store.charges(siteId, { since })]);
      return dayTotals(day, deposits, charges);
    });
  }

  static today() {
    return madridDay(Date.now());
  }
}


