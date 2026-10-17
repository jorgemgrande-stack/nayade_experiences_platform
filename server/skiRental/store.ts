/**
 * Persistencia de Ski Rental en la BD de la empresa (migración `db/migrations/0003_ski_rental.sql`).
 * Nada se borra: el material se archiva (`active = 0`), los alquileres cambian de estado y la sede se
 * desactiva. Si las tablas no existen (migración no aplicada) se lanza `ModuleNotInstalled`.
 */
import { sql, type SQL } from "drizzle-orm";
import { getTenantDatabase } from "../_core/dbRegistry";
import { ModuleNotInstalled } from "../sdk";
import { OCCUPYING, type ItemCategory, type Occupation, type RentalStatus } from "./availability";
import { SKI_RENTAL_ID } from "./manifest";

export interface SiteActivation {
  siteId: string;
  active: boolean;
}
export interface Item {
  id: number;
  siteId: string;
  category: ItemCategory;
  name: string;
  size: string;
  quantity: number;
  active: boolean;
}
export interface Rental {
  id: number;
  siteId: string;
  itemId: number;
  quantity: number;
  customerName: string;
  startDate: string;
  endDate: string;
  status: RentalStatus;
}
export type NewItem = Omit<Item, "id" | "active">;
export type NewRental = Omit<Rental, "id" | "status">;

export interface SkiRentalStore {
  site(siteId: string): Promise<SiteActivation | null>;
  setSiteActive(siteId: string, active: boolean, actor: string): Promise<void>;
  items(siteId: string): Promise<Item[]>;
  item(id: number): Promise<Item | null>;
  insertItem(x: NewItem): Promise<number>;
  updateItem(id: number, patch: Partial<Pick<Item, "name" | "quantity" | "active">>): Promise<void>;
  rentals(siteId: string, status?: RentalStatus): Promise<Rental[]>;
  rental(id: number): Promise<Rental | null>;
  /** Alquileres que ocupan unidades de los artículos y se solapan con [from, to]. */
  occupying(itemIds: number[], from: string, to: string): Promise<Array<Occupation & { itemId: number }>>;
  /**
   * Inserta el alquiler de forma atómica: bloquea el artículo, lee lo ocupado en el rango y llama a
   * `check(item, ocupado)`, que lanza si no hay unidades. Dos reservas simultáneas se serializan.
   */
  insertRental(x: NewRental, actor: string, check: (item: Item, occupied: Occupation[]) => void): Promise<number>;
  /** Cambia el estado solo si el actual está en `from`; devuelve si cambió. */
  transitionRental(id: number, from: RentalStatus[], to: RentalStatus): Promise<boolean>;
}

export class MemorySkiRentalStore implements SkiRentalStore {
  private sites = new Map<string, SiteActivation>();
  private itemRows: Item[] = [];
  private rentalRows: Rental[] = [];
  async site(siteId: string) {
    const s = this.sites.get(siteId);
    return s ? { ...s } : null;
  }
  async setSiteActive(siteId: string, active: boolean) {
    this.sites.set(siteId, { siteId, active });
  }
  async items(siteId: string) {
    return this.itemRows.filter((i) => i.siteId === siteId).map((i) => ({ ...i }));
  }
  async item(id: number) {
    const i = this.itemRows.find((x) => x.id === id);
    return i ? { ...i } : null;
  }
  async insertItem(x: NewItem) {
    if (this.itemRows.some((i) => i.siteId === x.siteId && i.category === x.category && i.name === x.name && i.size === x.size)) throw Object.assign(new Error("duplicado"), { code: "ER_DUP_ENTRY" });
    const id = this.itemRows.length + 1;
    this.itemRows.push({ ...x, id, active: true });
    return id;
  }
  async updateItem(id: number, patch: Partial<Item>) {
    const i = this.itemRows.find((x) => x.id === id);
    if (i) Object.assign(i, patch);
  }
  async rentals(siteId: string, status?: RentalStatus) {
    return this.rentalRows.filter((r) => r.siteId === siteId && (!status || r.status === status)).map((r) => ({ ...r }));
  }
  async rental(id: number) {
    const r = this.rentalRows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async occupying(itemIds: number[], from: string, to: string) {
    return this.rentalRows
      .filter((r) => itemIds.includes(r.itemId) && OCCUPYING.includes(r.status) && r.startDate <= to && r.endDate >= from)
      .map((r) => ({ itemId: r.itemId, startDate: r.startDate, endDate: r.endDate, quantity: r.quantity }));
  }
  // Sin `await` entre la lectura y la inserción: atómico en memoria
  async insertRental(x: NewRental, _actor: string, check: (item: Item, occupied: Occupation[]) => void) {
    const item = this.itemRows.find((i) => i.id === x.itemId)!;
    const occupied = this.rentalRows.filter((r) => r.itemId === x.itemId && OCCUPYING.includes(r.status) && r.startDate <= x.endDate && r.endDate >= x.startDate);
    check({ ...item }, occupied);
    const id = this.rentalRows.length + 1;
    this.rentalRows.push({ ...x, id, status: "reserved" });
    return id;
  }
  async transitionRental(id: number, from: RentalStatus[], to: RentalStatus) {
    const r = this.rentalRows.find((x) => x.id === id);
    if (!r || !from.includes(r.status)) return false;
    r.status = to;
    return true;
  }
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as [Row[]])[0];

/** Tabla inexistente (ER_NO_SUCH_TABLE), también envuelta por el ORM. */
function isMissingTable(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return /ski_rental_/.test(String(e.sqlMessage ?? e.message ?? ""));
  }
  return false;
}

const toItem = (r: Row): Item => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  category: r.category as ItemCategory,
  name: String(r.name),
  size: String(r.size),
  quantity: Number(r.quantity),
  active: Number(r.active) === 1,
});
const toRental = (r: Row): Rental => ({
  id: Number(r.id),
  siteId: String(r.site_id),
  itemId: Number(r.item_id),
  quantity: Number(r.quantity),
  customerName: String(r.customer_name),
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  status: r.status as RentalStatus,
});
const RENTAL_COLS = sql.raw("id, site_id, item_id, quantity, customer_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, status");
const STAMP: Partial<Record<RentalStatus, string>> = { out: "picked_up_at", returned: "returned_at", cancelled: "cancelled_at" };

/** Almacén sobre la BD de la empresa en curso (contexto de tenant del Core). */
export class TenantDbSkiRentalStore implements SkiRentalStore {
  private async run<T>(fn: (db: NonNullable<Awaited<ReturnType<typeof getTenantDatabase>>>) => Promise<T>): Promise<T> {
    const db = await getTenantDatabase();
    if (!db) throw new Error("Base de datos no disponible");
    try {
      return await fn(db);
    } catch (e) {
      if (isMissingTable(e)) throw new ModuleNotInstalled(SKI_RENTAL_ID);
      throw e;
    }
  }

  site(siteId: string) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT site_id, active FROM ski_rental_sites WHERE site_id = ${siteId}`));
      return r ? { siteId: String(r.site_id), active: Number(r.active) === 1 } : null;
    });
  }
  setSiteActive(siteId: string, active: boolean, actor: string) {
    return this.run(async (db) => {
      await db.execute(sql`
        INSERT INTO ski_rental_sites (site_id, active, activated_at, deactivated_at, updated_by)
        VALUES (${siteId}, ${active ? 1 : 0}, ${active ? sql`CURRENT_TIMESTAMP(3)` : null}, ${active ? null : sql`CURRENT_TIMESTAMP(3)`}, ${actor.slice(0, 100)})
        ON DUPLICATE KEY UPDATE active = VALUES(active),
          activated_at = IF(VALUES(active) = 1, CURRENT_TIMESTAMP(3), activated_at),
          deactivated_at = IF(VALUES(active) = 0, CURRENT_TIMESTAMP(3), deactivated_at),
          updated_by = VALUES(updated_by)`);
    });
  }
  items(siteId: string) {
    return this.run(async (db) =>
      rowsOf(await db.execute(sql`SELECT id, site_id, category, name, size, quantity, active FROM ski_rental_items WHERE site_id = ${siteId} ORDER BY category, name, size, id`)).map(toItem),
    );
  }
  item(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT id, site_id, category, name, size, quantity, active FROM ski_rental_items WHERE id = ${id}`));
      return r ? toItem(r) : null;
    });
  }
  insertItem(x: NewItem) {
    return this.run(async (db) => {
      const res = await db.execute(sql`INSERT INTO ski_rental_items (site_id, category, name, size, quantity) VALUES (${x.siteId}, ${x.category}, ${x.name}, ${x.size}, ${x.quantity})`);
      return Number((res as unknown as [{ insertId: number }])[0].insertId);
    });
  }
  updateItem(id: number, patch: Partial<Pick<Item, "name" | "quantity" | "active">>) {
    const sets: SQL[] = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.quantity !== undefined) sets.push(sql`quantity = ${patch.quantity}`);
    if (patch.active !== undefined) sets.push(sql`active = ${patch.active ? 1 : 0}`);
    if (!sets.length) return Promise.resolve();
    return this.run(async (db) => {
      await db.execute(sql`UPDATE ski_rental_items SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    });
  }
  rentals(siteId: string, status?: RentalStatus) {
    return this.run(async (db) =>
      rowsOf(
        await db.execute(
          status
            ? sql`SELECT ${RENTAL_COLS} FROM ski_rental_rentals WHERE site_id = ${siteId} AND status = ${status} ORDER BY start_date, id`
            : sql`SELECT ${RENTAL_COLS} FROM ski_rental_rentals WHERE site_id = ${siteId} ORDER BY start_date, id`,
        ),
      ).map(toRental),
    );
  }
  rental(id: number) {
    return this.run(async (db) => {
      const [r] = rowsOf(await db.execute(sql`SELECT ${RENTAL_COLS} FROM ski_rental_rentals WHERE id = ${id}`));
      return r ? toRental(r) : null;
    });
  }
  occupying(itemIds: number[], from: string, to: string) {
    if (!itemIds.length) return Promise.resolve([]);
    return this.run(async (db) =>
      rowsOf(
        await db.execute(sql`
          SELECT item_id, quantity, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
          FROM ski_rental_rentals
          WHERE item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)}) AND status IN ('reserved', 'out') AND start_date <= ${to} AND end_date >= ${from}`),
      ).map((r) => ({ itemId: Number(r.item_id), quantity: Number(r.quantity), startDate: String(r.start_date), endDate: String(r.end_date) })),
    );
  }
  insertRental(x: NewRental, actor: string, check: (item: Item, occupied: Occupation[]) => void) {
    return this.run((db) =>
      db.transaction(async (tx) => {
        // El bloqueo de la fila del artículo serializa las reservas simultáneas del mismo material
        const [it] = rowsOf(await tx.execute(sql`SELECT id, site_id, category, name, size, quantity, active FROM ski_rental_items WHERE id = ${x.itemId} FOR UPDATE`));
        const occupied = rowsOf(
          await tx.execute(sql`
            SELECT quantity, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
            FROM ski_rental_rentals
            WHERE item_id = ${x.itemId} AND status IN ('reserved', 'out') AND start_date <= ${x.endDate} AND end_date >= ${x.startDate}`),
        ).map((r) => ({ quantity: Number(r.quantity), startDate: String(r.start_date), endDate: String(r.end_date) }));
        check(toItem(it), occupied);
        const res = await tx.execute(sql`
          INSERT INTO ski_rental_rentals (site_id, item_id, quantity, customer_name, start_date, end_date, status, created_by)
          VALUES (${x.siteId}, ${x.itemId}, ${x.quantity}, ${x.customerName}, ${x.startDate}, ${x.endDate}, 'reserved', ${actor.slice(0, 100)})`);
        return Number((res as unknown as [{ insertId: number }])[0].insertId);
      }),
    );
  }
  transitionRental(id: number, from: RentalStatus[], to: RentalStatus) {
    const stamp = STAMP[to];
    return this.run(async (db) => {
      const res = await db.execute(sql`
        UPDATE ski_rental_rentals SET status = ${to}${stamp ? sql`, ${sql.raw(stamp)} = CURRENT_TIMESTAMP(3)` : sql``}
        WHERE id = ${id} AND status IN (${sql.join(from.map((s) => sql`${s}`), sql`, `)})`);
      return Number((res as unknown as [{ affectedRows: number }])[0].affectedRows) === 1;
    });
  }
}
