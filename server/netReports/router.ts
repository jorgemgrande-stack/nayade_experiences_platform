/**
 * Informes sectoriales de Elephant Net. Un namespace por producto, cada uno con su licencia y solo para los roles de
 * gestión; todos leen la BD de la empresa en curso (aislados por empresa) y aceptan periodo y sede, con CSV.
 *
 *  - `restaurantReports` (Restaurant Net): capacidad `restaurant-net` + licencia del módulo de restaurantes (manifiesto,
 *    panel.api). Administración ve todos los restaurantes; `adminrest`, solo los suyos.
 *  - `careReports` (Care Net): capacidad `care-net` + módulo de SPA (manifiesto). Gestión del centro (settings.manage).
 *  - `skiReports` (Ski Net): licencia POR SEDE de `ski-school` y/o `ski-rental` (como sus módulos, con la puerta del SDK).
 *    Administración.
 *  - `travelReports` (Travel Net): capacidad `travel-net` (TRPC_ROUTER_CAPABILITIES). Administración.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, adminrestProcedure, permissionProcedure, router } from "../_core/trpc";
import { getRestaurantsByUser } from "../restaurantsDb";
import { companySites, resolveSiteFilter } from "../sitesDb";
import { getSdkRuntime } from "../sdk";
import { careReport, csvEuros, restaurantReport, skiReport, toCsv, travelReport } from "./aggregate";
import * as store from "./store";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida (AAAA-MM-DD)");
const period = z
  .object({ from: day, to: day, siteId: z.string().max(63).optional() })
  .refine((p) => p.from <= p.to, "La fecha inicial debe ser anterior a la final")
  .refine((p) => (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000 <= 366, "El periodo máximo es de un año");

const pctCsv = (bp: number) => (bp / 100).toFixed(2).replace(".", ",");

// ─── Restaurant Net ───────────────────────────────────────────────────────────

async function restaurantScope(user: { id: number; role: string }, restaurantId: number | undefined): Promise<number[] | null> {
  if (user.role === "admin") return restaurantId != null ? [restaurantId] : null;
  const own = await getRestaurantsByUser(user.id);
  if (restaurantId != null) {
    if (!own.includes(restaurantId)) throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este restaurante" });
    return [restaurantId];
  }
  return own;
}

async function restaurant(input: z.infer<typeof period> & { restaurantId?: number }, user: { id: number; role: string }) {
  const site = await resolveSiteFilter(input.siteId);
  const d = await store.restaurantData(input, site, await restaurantScope(user, input.restaurantId));
  return restaurantReport(d.orders, d.items, d.sla);
}

const restaurantInput = period.and(z.object({ restaurantId: z.number().int().positive().optional() }));

export const restaurantReportsRouter = router({
  report: adminrestProcedure.input(restaurantInput).query(({ input, ctx }) => restaurant(input, ctx.user)),
  csv: adminrestProcedure
    .input(restaurantInput.and(z.object({ section: z.enum(["dias", "turnos", "salas", "camareros", "platos", "cocina"]) })))
    .query(async ({ input, ctx }) => {
      const r = await restaurant(input, ctx.user);
      const sales = (list: typeof r.byDay, label: string) =>
        list.map((x) => ({ [label]: (x as { label?: string }).label ?? x.key, Comandas: x.orders, Comensales: x.guests, "Ventas (€)": csvEuros(x.salesCents), "Ticket medio (€)": csvEuros(x.avgTicketCents) }));
      const rowsOf = {
        dias: () => sales(r.byDay, "Día"),
        turnos: () => sales(r.byShift, "Turno"),
        salas: () => sales(r.byRoom, "Sala"),
        camareros: () => sales(r.byWaiter, "Camarero"),
        platos: () => r.topDishes.map((x) => ({ Plato: x.name, Unidades: x.quantity, "Ventas (€)": csvEuros(x.salesCents) })),
        cocina: () => r.kitchen.map((x) => ({ Estación: x.station, Platos: x.items, "Media (min)": String(x.avgMinutes).replace(".", ","), "P90 (min)": String(x.p90Minutes).replace(".", ","), "Fuera de plazo (%)": pctCsv(x.lateBp) })),
      };
      return { fileName: `restaurante-${input.section}-${input.from}_${input.to}.csv`, csv: toCsv(rowsOf[input.section]()) };
    }),
});

// ─── Care Net ─────────────────────────────────────────────────────────────────

const careProc = permissionProcedure("settings.manage", ["admin"]);

async function care(input: z.infer<typeof period>) {
  const site = await resolveSiteFilter(input.siteId);
  return careReport(await store.careData(input, site));
}

export const careReportsRouter = router({
  report: careProc.input(period).query(({ input }) => care(input)),
  csv: careProc
    .input(period.and(z.object({ section: z.enum(["ocupacion", "tratamientos", "bonos"]) })))
    .query(async ({ input }) => {
      const r = await care(input);
      const rowsOf = {
        ocupacion: () => r.occupancy.map((o) => ({ Recurso: o.name, Tipo: o.type, Franjas: o.slots, "Minutos ofrecidos": o.offeredMinutes, "Minutos reservados": o.bookedMinutes, "Ocupación (%)": pctCsv(o.occupancyBp) })),
        tratamientos: () => r.byTreatment.map((t) => ({ Tratamiento: t.name, Citas: t.appointments, Personas: t.people, "Ingresos (€)": csvEuros(t.revenueCents) })),
        bonos: () => r.packs.byPack.map((b) => ({ Bono: b.name, Vendidos: b.sold, "Ingresos (€)": csvEuros(b.revenueCents) })),
      };
      return { fileName: `care-${input.section}-${input.from}_${input.to}.csv`, csv: toCsv(rowsOf[input.section]()) };
    }),
});

// ─── Ski Net ──────────────────────────────────────────────────────────────────

const skiInput = period.and(z.object({ siteId: z.string().min(1).max(63) }));

async function ski(input: { from: string; to: string; siteId: string }) {
  // Ski Net trabaja siempre por sede (también la principal, sin exigir varias sedes): la sede ha de ser de la empresa
  if (!(await companySites()).sites.some((x) => x.siteId === input.siteId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Sede no válida" });
  const gate = getSdkRuntime().gate;
  const [school, rental] = await Promise.all([
    gate.status("ski_school", { write: false, siteId: input.siteId }),
    gate.status("ski_rental", { write: false, siteId: input.siteId }),
  ]);
  if (!school.allowed && !rental.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Ski Net no está contratado en esta sede." });
  const d = await store.skiData(input, input.siteId, { school: school.allowed, rental: rental.allowed });
  return { school: school.allowed, rental: rental.allowed, ...skiReport(d) };
}

export const skiReportsRouter = router({
  report: adminProcedure.input(skiInput).query(({ input }) => ski(input as { from: string; to: string; siteId: string })),
  csv: adminProcedure
    .input(skiInput.and(z.object({ section: z.enum(["productos", "profesores", "material", "taller"]) })))
    .query(async ({ input }) => {
      const r = await ski(input as { from: string; to: string; siteId: string });
      const rowsOf = {
        productos: () => r.byProduct.map((p) => ({ Producto: p.product, Nivel: p.level, Sesiones: p.sessions, Alumnos: p.participants })),
        profesores: () => r.byInstructor.map((p) => ({ Profesor: p.name, Sesiones: p.sessions, Completadas: p.completed, Horas: String(p.hours).replace(".", ",") })),
        material: () => r.rotation.map((m) => ({ Tipo: m.assetType, Unidades: m.units, Salidas: m.rentals, Rotación: String(m.rotation).replace(".", ",") })),
        taller: () => r.workshop.byResolution.map((w) => ({ Resolución: w.resolution, Partes: w.tickets })),
      };
      return { fileName: `ski-${input.section}-${input.from}_${input.to}.csv`, csv: toCsv(rowsOf[input.section]()) };
    }),
});

// ─── Travel Net ───────────────────────────────────────────────────────────────

async function travel(input: z.infer<typeof period>) {
  const site = await resolveSiteFilter(input.siteId);
  return travelReport({ ...(await store.travelData(input, site)), now: Date.now() });
}

export const travelReportsRouter = router({
  report: adminProcedure.input(period).query(({ input }) => travel(input)),
  csv: adminProcedure
    .input(period.and(z.object({ section: z.enum(["estados", "proveedores", "meses", "operaciones"]) })))
    .query(async ({ input }) => {
      const r = await travel(input);
      const money = (x: { services: number; sellingCents: number; netCents: number; marginCents: number; marginBp: number; commissionCents: number }) => ({
        Servicios: x.services, "Venta (€)": csvEuros(x.sellingCents), "Coste (€)": csvEuros(x.netCents), "Margen (€)": csvEuros(x.marginCents), "Margen (%)": pctCsv(x.marginBp), "Comisiones (€)": csvEuros(x.commissionCents),
      });
      const rowsOf = {
        estados: () => r.byStatus.map((s) => ({ Estado: s.status, Expedientes: s.files })),
        proveedores: () => r.bySupplier.map((s) => ({ Proveedor: s.name, ...money(s) })),
        meses: () => r.byMonth.map((m) => ({ Mes: m.month, ...money(m) })),
        operaciones: () => r.operations.byStatus.map((o) => ({ Estado: o.status, Operaciones: o.operations })),
      };
      return { fileName: `travel-${input.section}-${input.from}_${input.to}.csv`, csv: toCsv(rowsOf[input.section]()) };
    }),
});
