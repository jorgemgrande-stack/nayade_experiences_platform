/**
 * inventory.* — inventario de la empresa (capacidad Business `inventory-basic`) desde su panel.
 *
 * La licencia la aplica el guardián de rutas (`inventory` → inventory-basic en TRPC_ROUTER_CAPABILITIES) y cada
 * procedimiento la comprueba además aquí. Consultar: el equipo del panel (con sedes asignadas, solo las suyas).
 * Marcar artículos, entradas, ajustes y traspasos: solo administración. Traspasos entre sedes: además `multi-site`.
 * El descuento por ventas y la reposición por anulaciones están en server/inventoryDb.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  MOVEMENT_KINDS,
  OPERATION_KEY_RE,
  OVERSELL_POLICIES,
  QTY_MAX,
  REASON_MAX,
  REFERENCE_MAX,
  SOURCE_LABELS,
  effectiveMin,
  isLowStock,
  itemLabel,
  movementsCsv,
  stockCsv,
} from "../../shared/inventory";
import { madridMidnightMs, nextDateKey } from "../utils/timezone";
import { SITE_ID_PATTERN, siteOfStored, storedSiteId } from "../../shared/sites";
import { assertMultiSite, companySites, multiSiteLicensed, resolveSiteFilter, resolveSiteForWrite, userSiteScope } from "../sitesDb";
import {
  adjustStock,
  assertInventory,
  catalogForTracking,
  listMovements,
  listTrackedItems,
  receiveStock,
  setLevelMin,
  trackItem,
  transferStock,
  untrackItem,
  updateItem,
  type MovementFilter,
} from "../inventoryDb";

const id = z.number().int().positive();
const siteId = z.string().regex(SITE_ID_PATTERN);
const opKey = z.string().regex(OPERATION_KEY_RE);
const qty = z.number().int().min(1).max(QTY_MAX);
const minStock = z.number().int().min(0).max(QTY_MAX);
const reason = z.string().trim().max(REASON_MAX);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const actorOf = (u: { id: number; name?: string | null; email?: string | null }) => ({ id: u.id, name: u.name || u.email || `usuario-${u.id}` });

/** El equipo del panel consulta (nunca la cuenta de cliente). */
const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role === "user") throw new TRPCError({ code: "FORBIDDEN", message: "Sin acceso al panel" });
  return next();
});

/** Sedes visibles para el usuario (valores guardados; NULL = principal). undefined = todas. */
async function visibleSites(user: { id: number; role: string }, primarySiteId: string): Promise<Array<string | null> | undefined> {
  const scope = await userSiteScope(user);
  return scope ? scope.map((s) => storedSiteId(s, primarySiteId)) : undefined;
}


const movementFilter = z.object({
  itemId: id.optional(),
  siteId: siteId.optional(),
  kind: z.enum(MOVEMENT_KINDS).optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
});

async function movementQuery(input: z.infer<typeof movementFilter>, user: { id: number; role: string }, limit: number, offset: number): Promise<MovementFilter> {
  const sites = await companySites();
  const filter = await resolveSiteFilter(input.siteId);
  return {
    itemId: input.itemId,
    site: filter ? { stored: storedSiteId(filter.siteId, sites.primarySiteId) } : undefined,
    scope: await visibleSites(user, sites.primarySiteId),
    kind: input.kind,
    fromMs: input.dateFrom ? madridMidnightMs(input.dateFrom) : undefined,
    toMs: input.dateTo ? madridMidnightMs(nextDateKey(input.dateTo)) : undefined,
    limit,
    offset,
  };
}

/** Existencias por artículo y sede (todas las sedes activas, aunque no tengan fila). */
async function stockOverview(user: { id: number; role: string }) {
  const [sites, items, multiSite] = await Promise.all([companySites(), listTrackedItems(), multiSiteLicensed(false)]);
  const scope = await visibleSites(user, sites.primarySiteId);
  // Sin varias sedes contratadas, solo la principal (como el resto del panel)
  const shown = sites.sites.filter((s) => (multiSite || s.siteId === sites.primarySiteId) && (s.status === "active" || s.siteId === sites.primarySiteId));
  const visible = scope ? shown.filter((s) => scope.includes(storedSiteId(s.siteId, sites.primarySiteId))) : shown;
  return {
    primarySiteId: sites.primarySiteId,
    sites: visible.map((s) => ({ siteId: s.siteId, name: s.name, isPrimary: s.siteId === sites.primarySiteId })),
    items: items.map((i) => {
      const levels = visible.map((s) => {
        const lv = i.levels.find((l) => siteOfStored(l.siteId, sites.primarySiteId) === s.siteId);
        const onHand = lv?.onHand ?? 0;
        const min = effectiveMin({ minStock: lv?.minStock ?? null }, i.minStock);
        return { siteId: s.siteId, onHand, minStock: lv?.minStock ?? null, effectiveMin: min, low: isLowStock(onHand, min) };
      });
      return {
        id: i.id, productId: i.productId, variantId: i.variantId, label: itemLabel(i.title, i.variantName, i.productId), policy: i.policy, minStock: i.minStock,
        levels, total: levels.reduce((n, l) => n + l.onHand, 0), low: levels.some((l) => l.low),
      };
    }),
  };
}

export const inventoryRouter = router({
  /** Existencias por sede con alertas de mínimo, y qué puede hacer el usuario. */
  overview: staffProcedure.query(async ({ ctx }) => {
    await assertInventory(false);
    const [data, canWrite, multiSite] = await Promise.all([stockOverview(ctx.user), assertInventory(true).then(() => true, () => false), multiSiteLicensed(true)]);
    const isAdmin = ctx.user.role === "admin";
    return { ...data, canManage: isAdmin && canWrite, canTransfer: isAdmin && canWrite && multiSite && data.sites.length > 1 };
  }),

  /** Productos y variantes del catálogo para marcarlos como inventariables. */
  catalog: adminProcedure.query(async () => {
    await assertInventory(false);
    return catalogForTracking();
  }),

  track: adminProcedure
    .input(z.object({ productId: id, variantId: z.number().int().min(0), policy: z.enum(OVERSELL_POLICIES), minStock }).strict())
    .mutation(async ({ input }) => {
      await assertInventory(true);
      return trackItem(input);
    }),

  update: adminProcedure
    .input(z.object({ itemId: id, policy: z.enum(OVERSELL_POLICIES).optional(), minStock: minStock.optional() }).strict())
    .mutation(async ({ input }) => {
      await assertInventory(true);
      await updateItem(input.itemId, { policy: input.policy, minStock: input.minStock });
      return { success: true };
    }),

  untrack: adminProcedure.input(z.object({ itemId: id }).strict()).mutation(async ({ input }) => {
    await assertInventory(true);
    await untrackItem(input.itemId);
    return { success: true };
  }),

  /** Mínimo de alerta propio de una sede (null = el del artículo). */
  setSiteMin: adminProcedure
    .input(z.object({ itemId: id, siteId: siteId.optional(), minStock: minStock.nullable() }).strict())
    .mutation(async ({ input }) => {
      await assertInventory(true);
      await setLevelMin(input.itemId, await resolveSiteForWrite(input.siteId), input.minStock);
      return { success: true };
    }),

  /** Entrada de unidades (compra o recepción). */
  receive: adminProcedure
    .input(z.object({ itemId: id, siteId: siteId.optional(), quantity: qty, reason: reason.optional(), reference: z.string().trim().max(REFERENCE_MAX).optional(), key: opKey }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertInventory(true);
      const site = await resolveSiteForWrite(input.siteId);
      return receiveStock({ itemId: input.itemId, site, quantity: input.quantity, reason: input.reason || null, reference: input.reference || null, key: input.key, actor: actorOf(ctx.user) });
    }),

  /** Ajuste con motivo: sumar o restar unidades, o fijar el recuento. */
  adjust: adminProcedure
    .input(z.object({ itemId: id, siteId: siteId.optional(), mode: z.enum(["delta", "set"]), quantity: z.number().int().min(-QTY_MAX).max(QTY_MAX), reason: reason.min(3), key: opKey }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertInventory(true);
      if (input.mode === "set" && input.quantity < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El recuento no puede ser negativo" });
      if (input.mode === "delta" && input.quantity === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Indica cuántas unidades sumar o restar" });
      const site = await resolveSiteForWrite(input.siteId);
      return adjustStock({ itemId: input.itemId, site, mode: input.mode, quantity: input.quantity, reason: input.reason, key: input.key, actor: actorOf(ctx.user) });
    }),

  /** Traspaso entre dos sedes activas (Business con varias sedes). */
  transfer: adminProcedure
    .input(z.object({ itemId: id, fromSiteId: siteId, toSiteId: siteId, quantity: qty, reason: reason.optional(), key: opKey }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertInventory(true);
      await assertMultiSite(true);
      const [from, to] = [await resolveSiteForWrite(input.fromSiteId), await resolveSiteForWrite(input.toSiteId)];
      return transferStock({ itemId: input.itemId, from, to, quantity: input.quantity, reason: input.reason || null, key: input.key, actor: actorOf(ctx.user) });
    }),

  /** Historial filtrable (artículo, sede, tipo y fechas). */
  movements: staffProcedure
    .input(movementFilter.extend({ page: z.number().int().min(1).max(10_000).default(1), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input, ctx }) => {
      await assertInventory(false);
      const { page, limit, ...f } = input;
      const res = await listMovements(await movementQuery(f, ctx.user, limit, (page - 1) * limit));
      return { ...res, items: res.items.map((m) => ({ ...m, label: itemLabel(m.title, m.variantName, m.productId), sourceLabel: m.sourceType ? SOURCE_LABELS[m.sourceType] ?? m.sourceType : null })) };
    }),

  /** CSV de las existencias o del historial (con los mismos filtros). */
  exportCsv: staffProcedure
    .input(movementFilter.extend({ what: z.enum(["existencias", "movimientos"]) }))
    .query(async ({ input, ctx }) => {
      await assertInventory(false);
      const today = new Date().toISOString().slice(0, 10);
      if (input.what === "existencias") {
        const data = await stockOverview(ctx.user);
        const nameOf = new Map(data.sites.map((s) => [s.siteId, s.name]));
        const rows = data.items
          .filter((i) => !input.itemId || i.id === input.itemId)
          .flatMap((i) => i.levels.filter((l) => !input.siteId || l.siteId === input.siteId).map((l) => ({ label: i.label, siteName: nameOf.get(l.siteId) ?? l.siteId, onHand: l.onHand, min: l.effectiveMin, policy: i.policy })));
        return { filename: `existencias-${today}.csv`, csv: stockCsv(rows) };
      }
      const { what: _what, ...f } = input;
      const sites = await companySites();
      const res = await listMovements(await movementQuery(f, ctx.user, 10_000, 0));
      const nameOf = (stored: string | null) => {
        const sid = siteOfStored(stored, sites.primarySiteId);
        return sites.sites.find((s) => s.siteId === sid)?.name ?? sid;
      };
      return {
        filename: `movimientos-inventario-${today}.csv`,
        csv: movementsCsv(res.items.map((m) => ({
          createdAt: m.createdAt, label: itemLabel(m.title, m.variantName, m.productId), siteName: nameOf(m.siteId), kind: m.kind, quantity: m.quantity, balanceAfter: m.balanceAfter,
          reason: m.reason, source: [m.sourceType ? SOURCE_LABELS[m.sourceType] ?? m.sourceType : "", m.sourceRef ?? ""].filter(Boolean).join(" · "), userName: m.userName, shortfall: m.shortfall,
        }))),
      };
    }),
});
