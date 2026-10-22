/**
 * Reglas de Ski Rental. Cada operación, en este orden:
 *  1. Sede válida y activa en la empresa (directorio de sedes del SDK).
 *  2. Licencia por capacidad `ski-rental` para esa sede (`ModuleGate`): sin licencia → `ModuleNotLicensed`;
 *     `read_only` o caducada → consultas sí, operaciones `ModuleReadOnly`.
 *  3. Operaciones (no consultas): el módulo debe estar ACTIVADO en la sede (`ModuleNotActive`). Las
 *     consultas siguen disponibles en una sede desactivada: los datos se conservan y se pueden revisar.
 */
import { ModuleNotActive, assertSite, runWithSite, type EventBus, type ModuleGate } from "../sdk";
import { ITEM_CATEGORIES, availableUnits, checkRange, peakUsage, type ItemCategory, type RentalStatus } from "./availability";
import { SKI_RENTAL_ID, type SkiRentalEvents } from "./manifest";
import type { Item, Rental, SkiRentalStore } from "./store";

export class SkiRentalError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "SkiRentalError";
  }
}

const isDuplicate = (err: unknown) => {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  return false;
};

function range(from: string, to: string): void {
  try {
    checkRange(from, to);
  } catch (e) {
    throw new SkiRentalError("invalid_input", (e as Error).message);
  }
}

export interface SkiRentalDeps {
  store: SkiRentalStore;
  gate: () => ModuleGate;
  events: () => EventBus<SkiRentalEvents>;
  /** Por defecto, el directorio de sedes del SDK. */
  assertSite?: (siteId: string) => Promise<void>;
}

export class SkiRentalService {
  constructor(private d: SkiRentalDeps) {}

  private async guard(siteId: string, write: boolean, requireActive = write): Promise<void> {
    await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_RENTAL_ID)))(siteId);
    await this.d.gate().assert(SKI_RENTAL_ID, { write, siteId });
    if (requireActive && !(await this.d.store.site(siteId))?.active) throw new ModuleNotActive(SKI_RENTAL_ID, siteId);
  }

  private within<T>(siteId: string, write: boolean, fn: () => Promise<T>, requireActive = write): Promise<T> {
    return runWithSite(siteId, async () => {
      await this.guard(siteId, write, requireActive);
      return fn();
    });
  }

  private async siteItem(siteId: string, itemId: number): Promise<Item> {
    const it = await this.d.store.item(itemId);
    if (!it || it.siteId !== siteId) throw new SkiRentalError("not_found", "Material no encontrado en esta sede");
    return it;
  }

  private async siteRental(siteId: string, id: number): Promise<Rental> {
    const r = await this.d.store.rental(id);
    if (!r || r.siteId !== siteId) throw new SkiRentalError("not_found", "Alquiler no encontrado en esta sede");
    return r;
  }

  /** Estado del módulo en la sede (no lanza por licencia: es para pantallas de estado). */
  async status(siteId: string) {
    return runWithSite(siteId, async () => {
      await (this.d.assertSite ?? ((s: string) => assertSite(s, SKI_RENTAL_ID)))(siteId);
      const [read, write, site] = await Promise.all([
        this.d.gate().status(SKI_RENTAL_ID, { write: false, siteId }),
        this.d.gate().status(SKI_RENTAL_ID, { write: true, siteId }),
        this.d.store.site(siteId),
      ]);
      return { siteId, license: { read: read.allowed, write: write.allowed, code: write.code ?? read.code, reason: write.reason ?? read.reason }, active: !!site?.active };
    });
  }

  /** Activa el módulo en la sede (exige licencia de escritura para esa sede). */
  activateSite(siteId: string, actor: string) {
    return this.within(
      siteId,
      true,
      async () => {
        await this.d.store.setSiteActive(siteId, true, actor);
        await this.d.events().emit("ski_rental.site.activated", { siteId });
        return { siteId, active: true };
      },
      false,
    );
  }

  /** Desactiva el módulo en la sede. No borra material ni alquileres. */
  deactivateSite(siteId: string, actor: string) {
    return this.within(
      siteId,
      true,
      async () => {
        await this.d.store.setSiteActive(siteId, false, actor);
        await this.d.events().emit("ski_rental.site.deactivated", { siteId });
        return { siteId, active: false };
      },
      false,
    );
  }

  listItems(siteId: string) {
    return this.within(siteId, false, () => this.d.store.items(siteId));
  }

  createItem(siteId: string, input: { category: ItemCategory; name: string; size?: string; quantity: number }) {
    return this.within(siteId, true, async () => {
      const name = input.name.trim();
      const size = (input.size ?? "").trim();
      if (!ITEM_CATEGORIES.includes(input.category)) throw new SkiRentalError("invalid_input", "Categoría no válida");
      if (name.length < 2 || name.length > 120) throw new SkiRentalError("invalid_input", "Nombre de material no válido");
      if (size.length > 16) throw new SkiRentalError("invalid_input", "Talla no válida");
      if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 100_000) throw new SkiRentalError("invalid_input", "Existencias no válidas");
      try {
        const id = await this.d.store.insertItem({ siteId, category: input.category, name, size, quantity: input.quantity });
        return (await this.d.store.item(id))!;
      } catch (e) {
        if (isDuplicate(e)) throw new SkiRentalError("conflict", "Ya existe ese material con esa talla en la sede");
        throw e;
      }
    });
  }

  /** Cambia nombre o existencias, o archiva (`active: false`). No se borra material. */
  updateItem(siteId: string, itemId: number, patch: { name?: string; quantity?: number; active?: boolean }) {
    return this.within(siteId, true, async () => {
      await this.siteItem(siteId, itemId);
      if (patch.quantity !== undefined && (!Number.isInteger(patch.quantity) || patch.quantity < 0 || patch.quantity > 100_000)) throw new SkiRentalError("invalid_input", "Existencias no válidas");
      const name = patch.name?.trim();
      if (name !== undefined && (name.length < 2 || name.length > 120)) throw new SkiRentalError("invalid_input", "Nombre de material no válido");
      await this.d.store.updateItem(itemId, { name, quantity: patch.quantity, active: patch.active });
      return (await this.d.store.item(itemId))!;
    });
  }

  /** Unidades disponibles por artículo activo en [from, to] (ambos incluidos). */
  availability(siteId: string, from: string, to: string, category?: ItemCategory) {
    return this.within(siteId, false, async () => {
      range(from, to);
      const items = (await this.d.store.items(siteId)).filter((i) => i.active && (!category || i.category === category));
      const occ = await this.d.store.occupying(
        items.map((i) => i.id),
        from,
        to,
      );
      return items.map((i) => {
        const mine = occ.filter((o) => o.itemId === i.id);
        return { itemId: i.id, category: i.category, name: i.name, size: i.size, stock: i.quantity, available: availableUnits(i.quantity, mine, from, to) };
      });
    });
  }

  listRentals(siteId: string, status?: RentalStatus) {
    return this.within(siteId, false, () => this.d.store.rentals(siteId, status));
  }

  /** Reserva material para un rango de días. Falla con `conflict` si no hay unidades suficientes. */
  createRental(siteId: string, input: { itemId: number; quantity: number; customerName: string; startDate: string; endDate: string }, actor: string) {
    return this.within(siteId, true, async () => {
      range(input.startDate, input.endDate);
      const customerName = input.customerName.trim();
      if (customerName.length < 2 || customerName.length > 120) throw new SkiRentalError("invalid_input", "Nombre del cliente no válido");
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) throw new SkiRentalError("invalid_input", "Cantidad no válida");
      await this.siteItem(siteId, input.itemId);
      const id = await this.d.store.insertRental({ siteId, itemId: input.itemId, quantity: input.quantity, customerName, startDate: input.startDate, endDate: input.endDate }, actor, (item, occupied) => {
        if (item.siteId !== siteId || !item.active) throw new SkiRentalError("not_found", "Material no disponible en esta sede");
        const free = item.quantity - peakUsage(occupied, input.startDate, input.endDate);
        if (free < input.quantity) throw new SkiRentalError("conflict", `No hay unidades suficientes: disponibles ${Math.max(0, free)}`);
      });
      await this.d.events().emit("ski_rental.rental.created", { rentalId: id, itemId: input.itemId, quantity: input.quantity, startDate: input.startDate, endDate: input.endDate });
      return (await this.d.store.rental(id))!;
    });
  }

  private transition(siteId: string, id: number, from: RentalStatus[], to: RentalStatus) {
    return this.within(siteId, true, async () => {
      await this.siteRental(siteId, id);
      if (!(await this.d.store.transitionRental(id, from, to))) throw new SkiRentalError("conflict", `El alquiler no admite pasar a ${to} desde su estado actual`);
      const r = (await this.d.store.rental(id))!;
      if (to === "returned") await this.d.events().emit("ski_rental.rental.returned", { rentalId: id, itemId: r.itemId });
      return r;
    });
  }

  /** Entrega del material al cliente. */
  pickUp(siteId: string, id: number) {
    return this.transition(siteId, id, ["reserved"], "out");
  }
  /** Devolución: libera las unidades. */
  returnRental(siteId: string, id: number) {
    return this.transition(siteId, id, ["out"], "returned");
  }
  cancelRental(siteId: string, id: number) {
    return this.transition(siteId, id, ["reserved"], "cancelled");
  }
}
