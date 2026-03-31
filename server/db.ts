import { eq, desc, and, like, sql, isNull, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  users, InsertUser,
  experiences, categories, locations, experienceVariants,
  leads, quotes, bookings, bookingMonitors, dailyOrders,
  transactions, slideshowItems, menuItems, mediaFiles, siteSettings,
  ghlWebhookLogs,
  homeModuleItems,
  packs, InsertPack,
  packCrossSells,
  pageBlocks,
  staticPages,
  clients, Client, InsertClient,
  invoices,
  crmActivityLog,
  reservations,
  reavExpedients,
  reavDocuments,
  reavCosts,
  reservationOperational,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── ACTIVITY LOG ────────────────────────────────────────────────────────────

/**
 * Registra una acción en crm_activity_log.
 * Función centralizada para que TODOS los flujos del sistema
 * (CRM, web pública, Redsys, TPV, Ticketing, Anulaciones) puedan
 * escribir en el mismo log y aparecer en "Actividad reciente" del dashboard.
 */
export async function logActivity(
  entityType: "lead" | "quote" | "reservation" | "invoice",
  entityId: number,
  action: string,
  actorId: number | null = null,
  actorName: string | null = null,
  details: Record<string, unknown> = {}
) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(crmActivityLog).values({
      entityType,
      entityId,
      action,
      actorId,
      actorName,
      details,
      createdAt: new Date(),
    });
  } catch (e) {
    // No bloquear el flujo principal si el log falla
    console.warn("[logActivity] Error registrando actividad:", action, e);
  }
}

// ─── USERS ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

// ─── PUBLIC QUERIES ───────────────────────────────────────────────────────────

export async function getFeaturedExperiences() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(experiences)
    .where(and(eq(experiences.isFeatured, true), eq(experiences.isActive, true)))
    .orderBy(experiences.sortOrder)
    .limit(8);
}

export async function getPublicExperiences(params: {
  categorySlug?: string;
  locationSlug?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(experiences)
    .where(eq(experiences.isActive, true))
    .orderBy(experiences.sortOrder)
    .limit(params.limit ?? 12)
    .offset(params.offset ?? 0);
}

export async function getExperienceBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(experiences).where(eq(experiences.slug, slug)).limit(1);
  return result[0] ?? null;
}

export async function getPublicCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(categories.sortOrder);
}

export async function getPublicLocations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(locations)
    .where(eq(locations.isActive, true))
    .orderBy(locations.sortOrder);
}

export async function getSlideshowItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(slideshowItems)
    .where(eq(slideshowItems.isActive, true))
    .orderBy(slideshowItems.sortOrder);
}

// ─── LEADS ────────────────────────────────────────────────────────────────────

export async function createLead(data: {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  experienceId?: number;
  locationId?: number;
  preferredDate?: string;
  numberOfPersons?: number;
  numberOfAdults?: number;
  numberOfChildren?: number;
  budget?: string;
  source?: string;
  selectedCategory?: string;
  selectedProduct?: string;
  activitiesJson?: {
    experienceId: number;
    experienceTitle: string;
    family: string;
    participants: number;
    details: Record<string, string | number>;
  }[] | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Insertar el lead
  const result = await db.insert(leads).values({
    name: data.name,
    email: data.email,
    phone: data.phone ?? null,
    company: data.company ?? null,
    message: data.message ?? null,
    experienceId: data.experienceId ?? null,
    locationId: data.locationId ?? null,
    preferredDate: data.preferredDate ? new Date(data.preferredDate) : null,
    numberOfPersons: data.numberOfPersons ?? null,
    numberOfAdults: data.numberOfAdults ?? null,
    numberOfChildren: data.numberOfChildren ?? null,
    budget: data.budget ?? null,
    status: "nuevo",
    source: data.source ?? "web",
    selectedCategory: data.selectedCategory ?? null,
    selectedProduct: data.selectedProduct ?? null,
    activitiesJson: data.activitiesJson ?? null,
  });
  const leadId = Number(result[0].insertId);

  // 2. Upsert de cliente — SOLUCIÓN ROBUSTA
  // Usa INSERT ... ON DUPLICATE KEY UPDATE para que sea atómico.
  // - Si no existe cliente con ese email → crea uno nuevo vinculado a este lead.
  // - Si ya existe → actualiza el leadId al nuevo lead (el más reciente) y refresca
  //   nombre/teléfono/empresa SOLO si los campos actuales están vacíos, preservando
  //   los datos ya enriquecidos por el agente.
  try {
    await db.insert(clients).values({
      leadId,
      source: "lead",
      name: data.name,
      email: data.email,
      phone: data.phone ?? "",
      company: data.company ?? "",
      tags: [],
      isConverted: false,
      totalBookings: 0,
    }).onDuplicateKeyUpdate({
      set: {
        // Siempre actualizar el leadId al lead más reciente
        leadId,
        // Actualizar nombre/teléfono/empresa solo si el campo está vacío en el cliente existente
        // (usa COALESCE-like: si ya tiene valor, lo conserva; si está vacío, usa el del lead)
        name: sql`IF(TRIM(${clients.name}) = '' OR ${clients.name} IS NULL, ${data.name}, ${clients.name})`,
        phone: sql`IF(TRIM(${clients.phone}) = '' OR ${clients.phone} IS NULL, ${data.phone ?? ''}, ${clients.phone})`,
        company: sql`IF(TRIM(${clients.company}) = '' OR ${clients.company} IS NULL, ${data.company ?? ''}, ${clients.company})`,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    // No bloquear el lead si falla la creación del cliente
    console.warn("[createLead] No se pudo crear/vincular cliente:", e);
  }

  // 3. Registrar en el log de actividad
  await logActivity("lead", leadId, "lead_created", null, null, {
    name: data.name,
    source: data.source ?? "web",
  });

  return { id: leadId, success: true };
}

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

export async function createBooking(data: {
  experienceId: number;
  quoteId?: number;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  scheduledDate: string;
  numberOfPersons: number;
  totalAmount: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bookingNumber = `BK-${Date.now()}-${nanoid(4).toUpperCase()}`;
  const result = await db.insert(bookings).values({
    bookingNumber,
    experienceId: data.experienceId,
    quoteId: data.quoteId ?? null,
    clientName: data.clientName,
    clientEmail: data.clientEmail,
    clientPhone: data.clientPhone ?? null,
    scheduledDate: new Date(data.scheduledDate),
    numberOfPersons: data.numberOfPersons,
    totalAmount: data.totalAmount,
    notes: data.notes ?? null,
    status: "pendiente",
  });
  return { id: Number(result[0].insertId), bookingNumber, success: true };
}

/**
 * Crea automáticamente un booking operativo a partir de una reserva pagada.
 * Se llama desde el callback de Redsys, confirmTransfer y confirmManualPayment.
 * Idempotente: si ya existe un booking con el mismo reservationId, no crea otro.
 */
export async function createBookingFromReservation(data: {
  reservationId: number;
  productId: number;
  productName: string;
  bookingDate: string; // YYYY-MM-DD
  people: number;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  quoteId?: number | null;
  notes?: string | null;
  sourceChannel: "redsys" | "transferencia" | "efectivo" | "otro";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Idempotency: skip if booking already exists for this reservation
  const existing = await db.select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.reservationId, data.reservationId))
    .limit(1);
  if (existing.length > 0) return { id: existing[0].id, bookingNumber: null, alreadyExisted: true };
  const bookingNumber = `BK-${Date.now()}-${nanoid(4).toUpperCase()}`;
  const totalAmount = (data.amountCents / 100).toFixed(2);
  const scheduledDate = new Date(data.bookingDate + "T10:00:00Z");
  const result = await db.insert(bookings).values({
    bookingNumber,
    experienceId: data.productId,
    quoteId: data.quoteId ?? null,
    clientName: data.customerName,
    clientEmail: data.customerEmail,
    clientPhone: data.customerPhone ?? null,
    scheduledDate,
    numberOfPersons: data.people,
    totalAmount,
    status: "confirmado",
    notes: data.notes ?? `Reserva automática desde ${data.sourceChannel} — ${data.productName}`,
    reservationId: data.reservationId,
    sourceChannel: data.sourceChannel,
  });
  return { id: Number(result[0].insertId), bookingNumber, alreadyExisted: false };
}

export async function getAllBookings(params: { status?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bookings)
    .orderBy(desc(bookings.scheduledDate))
    .limit(params.limit ?? 20)
    .offset(params.offset ?? 0);
}

export async function updateBookingStatus(id: number, status: string, internalNotes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bookings).set({
    status: status as any,
    ...(internalNotes ? { internalNotes } : {}),
  }).where(eq(bookings.id, id));
  return { success: true };
}

// ──// ─── TRANSACTIONS ─────────────────────────────────────────────────────

type TxFilters = {
  type?: string; status?: string;
  from?: string; to?: string;
  saleChannel?: string; fiscalRegime?: string;
  search?: string;
  limit?: number; offset?: number;
};

function buildTxWhere(db: any, params: TxFilters) {
  const conditions: any[] = [];
  if (params.type)        conditions.push(eq(transactions.type, params.type as any));
  if (params.status)      conditions.push(eq(transactions.status, params.status as any));
  if (params.saleChannel) conditions.push(eq((transactions as any).saleChannel, params.saleChannel as any));
  if (params.fiscalRegime)conditions.push(eq((transactions as any).fiscalRegime, params.fiscalRegime as any));
  if (params.from) {
    const fromDate = new Date(params.from);
    conditions.push(sql`${transactions.createdAt} >= ${fromDate}`);
  }
  if (params.to) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(sql`${transactions.createdAt} <= ${toDate}`);
  }
  if (params.search) {
    const s = `%${params.search}%`;
    conditions.push(sql`(
      ${transactions.transactionNumber} LIKE ${s} OR
      ${transactions.description} LIKE ${s} OR
      ${(transactions as any).clientName} LIKE ${s} OR
      ${(transactions as any).clientEmail} LIKE ${s} OR
      ${(transactions as any).productName} LIKE ${s}
    )`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getAllTransactions(params: TxFilters) {
  const db = await getDb();
  if (!db) return [];
  const where = buildTxWhere(db, params);
  const q = db.select().from(transactions).orderBy(desc(transactions.createdAt))
    .limit(params.limit ?? 50).offset(params.offset ?? 0);
  return where ? q.where(where) : q;
}

export async function getTransactionsCount(params: TxFilters) {
  const db = await getDb();
  if (!db) return { total: 0 };
  const where = buildTxWhere(db, params);
  const q = db.select({ total: sql<number>`COUNT(*)` }).from(transactions);
  const [row] = await (where ? q.where(where) : q);
  return { total: Number(row?.total ?? 0) };
}

export async function getAccountingReports(params: { from?: string; to?: string }) {
  const db = await getDb();
  if (!db) return null;

  const conditions: any[] = [eq(transactions.status, "completado")];
  if (params.from) conditions.push(sql`${transactions.createdAt} >= ${new Date(params.from)}`);
  if (params.to) {
    const d = new Date(params.to); d.setHours(23, 59, 59, 999);
    conditions.push(sql`${transactions.createdAt} <= ${d}`);
  }
  const where = and(...conditions);

  // Totales globales
  const [totals] = await db.select({
    totalRevenue:  sql<string>`COALESCE(SUM(amount), 0)`,
    totalTaxBase:  sql<string>`COALESCE(SUM(taxBase), 0)`,
    totalTaxAmount:sql<string>`COALESCE(SUM(taxAmount), 0)`,
    totalReavMargin:sql<string>`COALESCE(SUM(reavMargin), 0)`,
    count:         sql<number>`COUNT(*)`,
  }).from(transactions).where(where);

  // Por canal de venta
  const byChannel = await db.select({
    channel: (transactions as any).saleChannel,
    total:   sql<string>`COALESCE(SUM(amount), 0)`,
    count:   sql<number>`COUNT(*)`,
  }).from(transactions).where(where).groupBy((transactions as any).saleChannel);

  // Por método de pago
  const byMethod = await db.select({
    method: transactions.paymentMethod,
    total:  sql<string>`COALESCE(SUM(amount), 0)`,
    count:  sql<number>`COUNT(*)`,
  }).from(transactions).where(where).groupBy(transactions.paymentMethod);

  // Por régimen fiscal
  const byFiscal = await db.select({
    regime: (transactions as any).fiscalRegime,
    total:  sql<string>`COALESCE(SUM(amount), 0)`,
    taxBase:sql<string>`COALESCE(SUM(taxBase), 0)`,
    iva:    sql<string>`COALESCE(SUM(taxAmount), 0)`,
    reav:   sql<string>`COALESCE(SUM(reavMargin), 0)`,
    count:  sql<number>`COUNT(*)`,
  }).from(transactions).where(where).groupBy((transactions as any).fiscalRegime);

  // Ventas por día (para gráfica)
  const byDay = await db.select({
    day:   sql<string>`DATE(createdAt)`,
    total: sql<string>`COALESCE(SUM(amount), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(transactions).where(where).groupBy(sql`DATE(createdAt)`).orderBy(sql`DATE(createdAt)`);

  return {
    totals: {
      revenue:     parseFloat(totals?.totalRevenue ?? "0"),
      taxBase:     parseFloat(totals?.totalTaxBase ?? "0"),
      taxAmount:   parseFloat(totals?.totalTaxAmount ?? "0"),
      reavMargin:  parseFloat(totals?.totalReavMargin ?? "0"),
      count:       Number(totals?.count ?? 0),
    },
    byChannel: byChannel.map(r => ({ channel: r.channel ?? "admin", total: parseFloat(String(r.total)), count: Number(r.count) })),
    byMethod:  byMethod.map(r => ({ method: r.method ?? "otro", total: parseFloat(String(r.total)), count: Number(r.count) })),
    byFiscal:  byFiscal.map(r => ({
      regime: r.regime ?? "general_21",
      total:  parseFloat(String(r.total)),
      taxBase:parseFloat(String(r.taxBase)),
      iva:    parseFloat(String(r.iva)),
      reav:   parseFloat(String(r.reav)),
      count:  Number(r.count),
    })),
    byDay: byDay.map(r => ({ day: r.day, total: parseFloat(String(r.total)), count: Number(r.count) })),
  };
}

export async function getTpvReservationsToday() {
  const db = await getDb();
  if (!db) return [];
  const todayStr = new Date().toISOString().slice(0, 10);
  return db.select().from(reservations)
    .where(sql`notes LIKE '%[ORIGEN_TPV]%' AND DATE(FROM_UNIXTIME(created_at / 1000)) = ${todayStr}`)
    .orderBy(desc(reservations.createdAt));
}

export async function getDashboardMetrics() {
  const db = await getDb();
  if (!db) return {
    totalRevenue: 0, totalBookings: 0, totalLeads: 0, pendingQuotes: 0,
    revenueThisMonth: 0, bookingsThisMonth: 0, conversionRate: 0,
  };

  const [totalBookingsResult] = await db.select({ count: sql<number>`count(*)` }).from(bookings);
  const [totalLeadsResult] = await db.select({ count: sql<number>`count(*)` }).from(leads);
  const [pendingQuotesResult] = await db.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.status, "enviado"));
  const [revenueResult] = await db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` }).from(transactions).where(eq(transactions.status, "completado"));

  return {
    totalRevenue: parseFloat(revenueResult?.total ?? "0"),
    totalBookings: Number(totalBookingsResult?.count ?? 0),
    totalLeads: Number(totalLeadsResult?.count ?? 0),
    pendingQuotes: Number(pendingQuotesResult?.count ?? 0),
    revenueThisMonth: 0,
    bookingsThisMonth: 0,
    conversionRate: 0,
  };
}

// ─── CMS: SLIDESHOW ───────────────────────────────────────────────────────────

export async function getAllSlideshowItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(slideshowItems).orderBy(slideshowItems.sortOrder);
}

export async function createSlideshowItem(data: {
  imageUrl: string;
  badge?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  ctaText?: string;
  ctaUrl?: string;
  reserveUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(slideshowItems).values({
    imageUrl: data.imageUrl,
    badge: data.badge ?? null,
    title: data.title ?? null,
    subtitle: data.subtitle ?? null,
    description: data.description ?? null,
    ctaText: data.ctaText ?? null,
    ctaUrl: data.ctaUrl ?? null,
    reserveUrl: data.reserveUrl ?? null,
    sortOrder: data.sortOrder ?? 0,
    isActive: data.isActive ?? true,
  });
  return { id: Number(result[0].insertId), success: true };
}
export async function updateSlideshowItem(id: number, data: Partial<{
  imageUrl: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  reserveUrl: string;
  sortOrder: number;
  isActive: boolean;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(slideshowItems).set(data as any).where(eq(slideshowItems.id, id));
  return { success: true };
}

export async function deleteSlideshowItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(slideshowItems).where(eq(slideshowItems.id, id));
  return { success: true };
}

// ─── CMS: MEDIA ───────────────────────────────────────────────────────────────

export async function getAllMediaFiles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mediaFiles).orderBy(desc(mediaFiles.createdAt));
}

export async function createMediaFile(data: {
  filename: string;
  originalName: string;
  url: string;
  fileKey: string;
  mimeType: string;
  size: number;
  type: "image" | "video" | "document";
  altText?: string;
  uploadedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(mediaFiles).values(data);
  return { id: Number(result[0].insertId), url: data.url, success: true };
}

export async function deleteMediaFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(mediaFiles).where(eq(mediaFiles.id, id));
  return { success: true };
}

// ─── ADMIN: EXPERIENCES ───────────────────────────────────────────────────────

export async function getAllExperiences() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(experiences).orderBy(desc(experiences.createdAt));
}

export async function createExperience(data: {
  slug: string;
  title: string;
  shortDescription?: string;
  description?: string;
  categoryId: number;
  locationId: number;
  coverImageUrl?: string;
  image1?: string;
  image2?: string;
  image3?: string;
  image4?: string;
  basePrice: string;
  duration?: string;
  minPersons?: number;
  maxPersons?: number;
  difficulty?: "facil" | "moderado" | "dificil" | "experto";
  isFeatured?: boolean;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(experiences).values({
    ...data,
    shortDescription: data.shortDescription ?? null,
    description: data.description ?? null,
    coverImageUrl: data.image1 ?? data.coverImageUrl ?? null,
    image1: data.image1 ?? null,
    image2: data.image2 ?? null,
    image3: data.image3 ?? null,
    image4: data.image4 ?? null,
    duration: data.duration ?? null,
    minPersons: data.minPersons ?? 1,
    maxPersons: data.maxPersons ?? null,
    difficulty: data.difficulty ?? "facil",
    isFeatured: data.isFeatured ?? false,
    isActive: data.isActive ?? true,
  });
  return { id: Number(result[0].insertId), success: true };
}

export async function updateExperience(id: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(experiences).set(data as any).where(eq(experiences.id, id));
  return { success: true };
}

export async function deleteExperience(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(experiences).set({ isActive: false }).where(eq(experiences.id, id));
  return { success: true };
}

// ─── ADMIN: CATEGORIES ────────────────────────────────────────────────────────

export async function getAllCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).orderBy(categories.sortOrder);
}

export async function createCategory(data: {
  slug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  image1?: string;
  iconName?: string;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(categories).values({
    ...data,
    description: data.description ?? null,
    imageUrl: data.image1 ?? data.imageUrl ?? null,
    image1: data.image1 ?? null,
    iconName: data.iconName ?? null,
    sortOrder: data.sortOrder ?? 0,
    isActive: true,
  });
  return { id: Number(result[0].insertId), success: true };
}

export async function updateCategory(id: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(categories).set(data as any).where(eq(categories.id, id));
  return { success: true };
}

export async function deleteCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
  return { success: true };
}

// ─── ADMIN: LOCATIONS ─────────────────────────────────────────────────────────

export async function getAllLocations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(locations).orderBy(locations.sortOrder);
}

export async function createLocation(data: {
  slug: string;
  name: string;
  description?: string;
  imageUrl?: string;
  address?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(locations).values({
    ...data,
    description: data.description ?? null,
    imageUrl: data.imageUrl ?? null,
    address: data.address ?? null,
    isActive: true,
  });
  return { id: Number(result[0].insertId), success: true };
}

export async function updateLocation(id: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(locations).set(data as any).where(eq(locations.id, id));
  return { success: true };
}

export async function deleteLocation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(locations).set({ isActive: false }).where(eq(locations.id, id));
  return { success: true };
}

// ─── HOME MODULES ─────────────────────────────────────────────────────────────
export async function getHomeModuleItems(moduleKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const items = await db
    .select({
      id: homeModuleItems.id,
      moduleKey: homeModuleItems.moduleKey,
      experienceId: homeModuleItems.experienceId,
      sortOrder: homeModuleItems.sortOrder,
      // Join experience data
      title: experiences.title,
      slug: experiences.slug,
      shortDescription: experiences.shortDescription,
      basePrice: experiences.basePrice,
      currency: experiences.currency,
      image1: experiences.image1,
      difficulty: experiences.difficulty,
      isFeatured: experiences.isFeatured,
      isActive: experiences.isActive,
    })
    .from(homeModuleItems)
    .innerJoin(experiences, eq(homeModuleItems.experienceId, experiences.id))
    .where(eq(homeModuleItems.moduleKey, moduleKey))
    .orderBy(homeModuleItems.sortOrder);
  return items;
}

export async function setHomeModuleItems(moduleKey: string, experienceIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing items for this module
  await db.delete(homeModuleItems).where(eq(homeModuleItems.moduleKey, moduleKey));
  // Insert new items
  if (experienceIds.length > 0) {
    const now = Date.now();
    await db.insert(homeModuleItems).values(
      experienceIds.map((experienceId, index) => ({
        moduleKey,
        experienceId,
        sortOrder: index,
        createdAt: now,
      }))
    );
  }
  return { success: true };
}

// ─── RESERVATIONS (Redsys) ────────────────────────────────────────────────────
export async function createReservation(data: {
  productId: number;
  productName: string;
  bookingDate: string;
  people: number;
  extrasJson?: string;
  amountTotal: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  merchantOrder: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = Date.now();
  const result = await db.insert(reservations).values({
    productId: data.productId,
    productName: data.productName,
    bookingDate: data.bookingDate,
    people: data.people,
    extrasJson: data.extrasJson ?? null,
    amountTotal: data.amountTotal,
    amountPaid: 0,
    status: "pending_payment",
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone ?? null,
    merchantOrder: data.merchantOrder,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id: Number(result[0].insertId), merchantOrder: data.merchantOrder };
}

export async function getReservationByMerchantOrder(merchantOrder: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(reservations)
    .where(eq(reservations.merchantOrder, merchantOrder))
    .limit(1);
  return result[0] ?? null;
}

export async function updateReservationPayment(
  merchantOrder: string,
  status: "paid" | "failed",
  redsysResponse: string,
  redsysDsResponse: string,
  amountPaid?: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = Date.now();
  await db.update(reservations).set({
    status,
    redsysResponse,
    redsysDsResponse,
    amountPaid: amountPaid ?? 0,
    updatedAt: now,
    ...(status === "paid" ? {
      paidAt: now,
      statusReservation: "CONFIRMADA",
      statusPayment: "PAGADO",
    } : {}),
  }).where(eq(reservations.merchantOrder, merchantOrder));
  return { success: true };
}

export async function getAllReservations(params: { status?: string; channel?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (params.status) conditions.push(eq(reservations.status, params.status as any));
  if (params.channel) conditions.push(eq(reservations.channel, params.channel as any));
  return db.select().from(reservations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(reservations.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);
}

export async function getReservationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getExperienceById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1);
  return result[0] ?? null;
}

// ─── EXPERIENCE VARIANTS ──────────────────────────────────────────────────────

export async function getVariantsByExperience(experienceId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(experienceVariants)
    .where(eq(experienceVariants.experienceId, experienceId))
    .orderBy(experienceVariants.sortOrder, experienceVariants.id);
}

export async function getAllVariantsGrouped() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(experienceVariants)
    .orderBy(experienceVariants.experienceId, experienceVariants.sortOrder);
}

export async function createVariant(data: {
  experienceId: number;
  name: string;
  description?: string;
  priceModifier: string;
  priceType: "fixed" | "percentage" | "per_person";
  isRequired?: boolean;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(experienceVariants).values({
    experienceId: data.experienceId,
    name: data.name,
    description: data.description ?? null,
    priceModifier: data.priceModifier,
    priceType: data.priceType,
    isRequired: data.isRequired ?? false,
    sortOrder: data.sortOrder ?? 0,
    options: [],
  });
  return { id: Number(result[0].insertId) };
}

export async function updateVariant(
  id: number,
  data: Partial<{
    name: string;
    description: string | null;
    priceModifier: string;
    priceType: "fixed" | "percentage" | "per_person";
    isRequired: boolean;
    sortOrder: number;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(experienceVariants).set(data).where(eq(experienceVariants.id, id));
  return { success: true };
}

export async function deleteVariant(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(experienceVariants).where(eq(experienceVariants.id, id));
  return { success: true };
}

// ─── ADMIN: ACCIONES EXTENDIDAS (toggle, hard delete, clone) ─────────────────

export async function hardDeleteExperience(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(experiences).where(eq(experiences.id, id));
  return { success: true };
}

export async function toggleExperienceActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(experiences).set({ isActive }).where(eq(experiences.id, id));
  return { success: true };
}

export async function cloneExperience(id: number, newName?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orig] = await db.select().from(experiences).where(eq(experiences.id, id));
  if (!orig) throw new Error("Experience not found");
  // Si se proporciona un nombre nuevo, generar slug desde ese nombre; si no, añadir sufijo
  const resolvedTitle = newName?.trim() || orig.title + " (Copia)";
  const baseSlug = resolvedTitle
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // quitar tildes
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const newSlug = baseSlug + "-" + nanoid(4);
  const newTitle = resolvedTitle;
  await db.insert(experiences).values({
    slug: newSlug,
    title: newTitle,
    shortDescription: orig.shortDescription,
    description: orig.description,
    categoryId: orig.categoryId,
    locationId: orig.locationId,
    coverImageUrl: orig.coverImageUrl,
    image1: orig.image1,
    image2: orig.image2,
    image3: orig.image3,
    image4: orig.image4,
    gallery: orig.gallery,
    basePrice: orig.basePrice,
    currency: orig.currency,
    duration: orig.duration,
    minPersons: orig.minPersons,
    maxPersons: orig.maxPersons,
    difficulty: orig.difficulty,
    includes: orig.includes,
    excludes: orig.excludes,
    requirements: orig.requirements,
    isFeatured: false,
    isActive: false,
    sortOrder: orig.sortOrder,
    metaTitle: orig.metaTitle,
    metaDescription: orig.metaDescription,
  });
  return { success: true, slug: newSlug };
}

export async function hardDeleteCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(categories).where(eq(categories.id, id));
  return { success: true };
}

export async function toggleCategoryActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(categories).set({ isActive }).where(eq(categories.id, id));
  return { success: true };
}

export async function cloneCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orig] = await db.select().from(categories).where(eq(categories.id, id));
  if (!orig) throw new Error("Category not found");
  const newSlug = orig.slug + "-copia-" + nanoid(4);
  await db.insert(categories).values({
    slug: newSlug,
    name: orig.name + " (Copia)",
    description: orig.description,
    imageUrl: orig.imageUrl,
    image1: orig.image1,
    iconName: orig.iconName,
    sortOrder: orig.sortOrder,
    isActive: false,
  });
  return { success: true, slug: newSlug };
}

export async function hardDeleteLocation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(locations).where(eq(locations.id, id));
  return { success: true };
}

export async function toggleLocationActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(locations).set({ isActive }).where(eq(locations.id, id));
  return { success: true };
}

export async function cloneLocation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orig] = await db.select().from(locations).where(eq(locations.id, id));
  if (!orig) throw new Error("Location not found");
  const newSlug = orig.slug + "-copia-" + nanoid(4);
  await db.insert(locations).values({
    slug: newSlug,
    name: orig.name + " (Copia)",
    description: orig.description,
    imageUrl: orig.imageUrl,
    address: orig.address,
    latitude: orig.latitude,
    longitude: orig.longitude,
    isActive: false,
    sortOrder: orig.sortOrder,
  });
  return { success: true, slug: newSlug };
}

export async function getAllPacksAdmin(params: { category?: string; search?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(packs).orderBy(packs.category, packs.sortOrder)
    .limit(params.limit ?? 50).offset(params.offset ?? 0);
}

export async function createPack(data: Omit<InsertPack, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(packs).values(data);
  return { id: Number(result[0].insertId), success: true };
}

export async function updatePack(id: number, data: Partial<Omit<InsertPack, "id" | "createdAt">>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(packs).set(data).where(eq(packs.id, id));
  return { success: true };
}

export async function togglePackActive(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [pack] = await db.select({ isActive: packs.isActive }).from(packs).where(eq(packs.id, id));
  if (!pack) throw new Error("Pack not found");
  await db.update(packs).set({ isActive: !pack.isActive }).where(eq(packs.id, id));
  return { success: true, isActive: !pack.isActive };
}

export async function hardDeletePack(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(packCrossSells).where(eq(packCrossSells.packId, id));
  await db.delete(packs).where(eq(packs.id, id));
  return { success: true };
}

export async function clonePack(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orig] = await db.select().from(packs).where(eq(packs.id, id));
  if (!orig) throw new Error("Pack not found");
  const newSlug = orig.slug + "-copia-" + nanoid(4);
  const result = await db.insert(packs).values({
    slug: newSlug,
    category: orig.category,
    title: orig.title + " (Copia)",
    subtitle: orig.subtitle,
    shortDescription: orig.shortDescription,
    description: orig.description,
    includes: orig.includes,
    excludes: orig.excludes,
    schedule: orig.schedule,
    note: orig.note,
    image1: orig.image1,
    image2: orig.image2,
    image3: orig.image3,
    image4: orig.image4,
    basePrice: orig.basePrice,
    priceLabel: orig.priceLabel,
    duration: orig.duration,
    minPersons: orig.minPersons,
    maxPersons: orig.maxPersons,
    targetAudience: orig.targetAudience,
    badge: orig.badge,
    hasStay: orig.hasStay,
    isOnlinePurchase: orig.isOnlinePurchase,
    isFeatured: false,
    isActive: false,
    sortOrder: orig.sortOrder,
  });
  return { success: true, id: Number(result[0].insertId), slug: newSlug };
}

// ─── USER MANAGEMENT (ADMIN) ─────────────────────────────────────────────────

export async function createInvitedUser(data: {
  name: string;
  email: string;
  role: "user" | "admin" | "monitor" | "agente" | "adminrest";
  inviteToken: string;
  inviteTokenExpiry: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (existing) throw new Error("Ya existe un usuario con ese email");
  const openId = "local-" + nanoid(16);
  const result = await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email,
    role: data.role,
    loginMethod: "local",
    isActive: true,
    inviteToken: data.inviteToken,
    inviteTokenExpiry: data.inviteTokenExpiry,
    inviteAccepted: false,
  });
  return { success: true, id: Number(result[0].insertId) };
}

export async function changeUserRole(userId: number, role: "user" | "admin" | "monitor" | "agente" | "adminrest") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  return { success: true };
}

export async function toggleUserActive(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [user] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");
  await db.update(users).set({ isActive: !user.isActive, updatedAt: new Date() }).where(eq(users.id, userId));
  return { success: true, isActive: !user.isActive };
}

export async function getUserByInviteToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select().from(users).where(eq(users.inviteToken, token));
  return user ?? null;
}

export async function setUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    passwordHash,
    inviteToken: null,
    inviteTokenExpiry: null,
    inviteAccepted: true,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
  return { success: true };
}

export async function resendUserInvite(userId: number, inviteToken: string, inviteTokenExpiry: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ inviteToken, inviteTokenExpiry, updatedAt: new Date() }).where(eq(users.id, userId));
  return { success: true };
}

export async function deleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(users).where(eq(users.id, userId));
  return { success: true };
}

// ─── MENU ITEMS ──────────────────────────────────────────────────────────────

export async function getAllMenuItems(zone: "header" | "footer" = "header") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(menuItems)
    .where(eq(menuItems.menuZone, zone))
    .orderBy(menuItems.sortOrder);
}

export async function createMenuItem(data: {
  label: string;
  url?: string | null;
  parentId?: number | null;
  target?: "_self" | "_blank";
  sortOrder?: number;
  isActive?: boolean;
  menuZone?: "header" | "footer";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(menuItems).values({
    label: data.label,
    url: data.url ?? null,
    parentId: data.parentId ?? null,
    target: data.target ?? "_self",
    sortOrder: data.sortOrder ?? 0,
    isActive: data.isActive ?? true,
    menuZone: data.menuZone ?? "header",
  });
  return { success: true, id: Number(result[0].insertId) };
}

export async function updateMenuItem(id: number, data: {
  label?: string;
  url?: string | null;
  parentId?: number | null;
  target?: "_self" | "_blank";
  sortOrder?: number;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(menuItems).set({ ...data, updatedAt: new Date() }).where(eq(menuItems.id, id));
  return { success: true };
}

export async function deleteMenuItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete children first
  await db.delete(menuItems).where(eq(menuItems.parentId, id));
  await db.delete(menuItems).where(eq(menuItems.id, id));
  return { success: true };
}

export async function reorderMenuItems(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(menuItems).set({ sortOrder, updatedAt: new Date() }).where(eq(menuItems.id, id))
    )
  );
  return { success: true };
}

// ─── REORDENACIÓN GENÉRICA ────────────────────────────────────────────────────

export async function reorderExperiences(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(experiences).set({ sortOrder, updatedAt: new Date() }).where(eq(experiences.id, id))
    )
  );
  return { success: true };
}

export async function reorderPacks(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(packs).set({ sortOrder, updatedAt: new Date() }).where(eq(packs.id, id))
    )
  );
  return { success: true };
}

export async function reorderCategories(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(categories).set({ sortOrder, updatedAt: new Date() }).where(eq(categories.id, id))
    )
  );
  return { success: true };
}

export async function reorderLocations(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(locations).set({ sortOrder, updatedAt: new Date() }).where(eq(locations.id, id))
    )
  );
  return { success: true };
}

export async function reorderSlideshowItems(items: { id: number; sortOrder: number }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await Promise.all(
    items.map(({ id, sortOrder }) =>
      db.update(slideshowItems).set({ sortOrder, updatedAt: new Date() }).where(eq(slideshowItems.id, id))
    )
  );
  return { success: true };
}

// ─── PAGES & PAGE BLOCKS ──────────────────────────────────────────────────────

export async function getAllPages() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(staticPages).orderBy(staticPages.id);
}

export async function getPageBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(staticPages).where(eq(staticPages.slug, slug)).limit(1);
  return result[0] ?? null;
}

export async function upsertPage(data: { slug: string; title: string; isPublished: boolean; metaTitle?: string; metaDescription?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(staticPages).values({
    slug: data.slug,
    title: data.title,
    isPublished: data.isPublished,
    metaTitle: data.metaTitle ?? null,
    metaDescription: data.metaDescription ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      title: data.title,
      isPublished: data.isPublished,
      metaTitle: data.metaTitle ?? null,
      metaDescription: data.metaDescription ?? null,
      updatedAt: new Date(),
    },
  });
  return { success: true };
}

export async function getPageBlocks(pageSlug: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pageBlocks)
    .where(eq(pageBlocks.pageSlug, pageSlug))
    .orderBy(pageBlocks.sortOrder);
}

export async function savePageBlocks(pageSlug: string, blocks: { id?: number; blockType: string; sortOrder: number; data: unknown; isVisible: boolean }[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete all existing blocks for this page and re-insert
  await db.delete(pageBlocks).where(eq(pageBlocks.pageSlug, pageSlug));
  if (blocks.length > 0) {
    await db.insert(pageBlocks).values(
      blocks.map((b, i) => ({
        pageSlug,
        blockType: b.blockType,
        sortOrder: i,
        data: b.data as any,
        isVisible: b.isVisible,
      }))
    );
  }
  return { success: true };
}


// ─── DASHBOARD OVERVIEW ───────────────────────────────────────────────────────
export async function getDashboardOverview() {
  const db = await getDb();
  const empty = {
    kpis: {
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      revenueTotal: 0,
      bookingsThisMonth: 0,
      bookingsPending: 0,
      bookingsConfirmed: 0,
      leadsNew: 0,
      leadsTotal: 0,
      quotesEnviados: 0,
      quotesPendingAmount: 0,
      invoicesPendingCount: 0,
      invoicesPendingAmount: 0,
      reservationsPaidThisMonth: 0,
    },
    funnel: { leads: 0, quotes: 0, reservations: 0, invoices: 0 },
    recentActivity: [] as { id: number; entityType: string; action: string; actorName: string | null; entityId: number; details: Record<string, unknown> | null; createdAt: Date }[],
    todayBookings: [] as { id: number; bookingNumber: string; clientName: string; scheduledDate: Date; numberOfPersons: number; status: string; experienceName: string }[],
    upcomingBookings: [] as { id: number; bookingNumber: string; clientName: string; scheduledDate: Date; numberOfPersons: number; status: string; experienceName: string }[],
    topExperiences: [] as { experienceId: number; experienceName: string; count: number; revenue: number }[],
    pendingAlerts: {
      transfersToValidate: 0,
      quotesExpiringSoon: 0,
      invoicesOverdue: 0,
    },
  };

  if (!db) return empty;

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonthMs = startOfMonth.getTime();

    // ── Ejecutar TODAS las queries en paralelo con Promise.all ──────────────
    // Antes: 26 queries secuenciales (~2-4s). Ahora: 1 ronda paralela (~200-400ms)
    const [
      [revTotal], [revLastMonth], [revAllTime],
      [bookingsThisMonth], [bookingsPending], [bookingsConfirmed],
      [leadsNew], [leadsTotal],
      [quotesEnviados], [quotesPendingAmt],
      [invoicesPendingCount], [invoicesPendingAmt],
      [resPaidThisMonth],
      [fLeads], [fQuotes], [fReservationsPaid], [fBookingsCompleted], [fInvoices],
      recentActivity,
      todayBookingsRaw,
      upcomingRaw,
      topRaw,
      [transfersToValidate], [quotesExpiring], [invoicesOverdue],
    ] = await Promise.all([
      // KPIs: Ingresos
      db.select({ total: sql<string>`COALESCE(SUM(total), 0)` }).from(invoices).where(sql`status = 'cobrada' AND issuedAt >= ${startOfMonth}`),
      db.select({ total: sql<string>`COALESCE(SUM(total), 0)` }).from(invoices).where(sql`status = 'cobrada' AND issuedAt >= ${startOfLastMonth} AND issuedAt <= ${endOfLastMonth}`),
      db.select({ total: sql<string>`COALESCE(SUM(total), 0)` }).from(invoices).where(sql`status = 'cobrada'`),
      // KPIs: Reservas (migrado desde bookings → reservations)
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(sql`status IN ('paid','pending_payment') AND created_at >= ${startOfMonthMs}`),
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(sql`status = 'pending_payment'`),
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(sql`status = 'paid'`),
      // KPIs: Leads
      db.select({ count: sql<number>`count(*)` }).from(leads).where(sql`createdAt >= ${startOfMonth}`),
      db.select({ count: sql<number>`count(*)` }).from(leads),
      // KPIs: Presupuestos
      db.select({ count: sql<number>`count(*)` }).from(quotes).where(sql`status IN ('enviado', 'visualizado')`),
      db.select({ total: sql<string>`COALESCE(SUM(total), 0)` }).from(quotes).where(sql`status IN ('enviado', 'visualizado')`),
      // KPIs: Facturas
      db.select({ count: sql<number>`count(*)` }).from(invoices).where(sql`status IN ('generada', 'enviada')`),
      db.select({ total: sql<string>`COALESCE(SUM(total), 0)` }).from(invoices).where(sql`status IN ('generada', 'enviada')`),
      // KPIs: Reservas online
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(sql`status = 'paid' AND created_at >= ${startOfMonthMs}`),
      // Funnel
      db.select({ count: sql<number>`count(*)` }).from(leads),
      db.select({ count: sql<number>`count(*)` }).from(quotes),
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(eq(reservations.status, "paid")),
      db.select({ count: sql<number>`count(*)` }).from(reservationOperational).where(eq(reservationOperational.opStatus, "completado")),
      db.select({ count: sql<number>`count(*)` }).from(invoices),
      // Recent activity
      db.select({ id: crmActivityLog.id, entityType: crmActivityLog.entityType, action: crmActivityLog.action, actorName: crmActivityLog.actorName, entityId: crmActivityLog.entityId, details: crmActivityLog.details, createdAt: crmActivityLog.createdAt }).from(crmActivityLog).orderBy(desc(crmActivityLog.createdAt)).limit(10),
      // Today's bookings (migrado desde bookings → reservations)
      db.select({ id: reservations.id, bookingNumber: reservations.merchantOrder, clientName: reservations.customerName, scheduledDate: reservations.bookingDate, numberOfPersons: reservations.people, status: reservations.status, experienceId: reservations.productId }).from(reservations).where(sql`booking_date >= ${startOfToday.toISOString().slice(0,10)} AND booking_date <= ${endOfToday.toISOString().slice(0,10)} AND status NOT IN ('cancelled','failed')`).orderBy(reservations.bookingDate).limit(10),
      // Upcoming bookings (migrado desde bookings → reservations)
      db.select({ id: reservations.id, bookingNumber: reservations.merchantOrder, clientName: reservations.customerName, scheduledDate: reservations.bookingDate, numberOfPersons: reservations.people, status: reservations.status, experienceId: reservations.productId }).from(reservations).where(sql`booking_date > ${endOfToday.toISOString().slice(0,10)} AND booking_date <= ${in7Days.toISOString().slice(0,10)} AND status NOT IN ('cancelled','failed')`).orderBy(reservations.bookingDate).limit(5),
      // Top experiencias
      db.select({ productId: reservations.productId, productName: reservations.productName, count: sql<number>`count(*)`, revenue: sql<string>`COALESCE(SUM(amount_total), 0)` }).from(reservations).where(sql`status = 'paid' AND created_at >= ${startOfMonthMs}`).groupBy(reservations.productId, reservations.productName).orderBy(sql`count(*) DESC`).limit(5),
      // Alertas
      db.select({ count: sql<number>`count(*)` }).from(reservations).where(sql`paymentMethod = 'transferencia' AND status = 'pending_payment'`),
      db.select({ count: sql<number>`count(*)` }).from(quotes).where(sql`validUntil IS NOT NULL AND validUntil <= ${in7Days} AND validUntil >= ${now} AND status IN ('enviado', 'visualizado')`),
      db.select({ count: sql<number>`count(*)` }).from(invoices).where(sql`status IN ('generada', 'enviada') AND issuedAt <= ${thirtyDaysAgo}`),
    ]);

    // Enriquecer reservas con nombres de experiencias
    const allExpIds = Array.from(new Set([...todayBookingsRaw, ...upcomingRaw].map(b => b.experienceId ?? 0).filter(id => id > 0)));
    let expMap: Record<number, string> = {};
    if (allExpIds.length > 0) {
      const exps = await db.select({ id: experiences.id, title: experiences.title })
        .from(experiences).where(inArray(experiences.id, allExpIds));
      expMap = Object.fromEntries(exps.map(e => [e.id, e.title]));
    }
    const todayBookings = todayBookingsRaw.map(b => ({ ...b, experienceName: expMap[b.experienceId ?? 0] ?? "Actividad" }));
    const upcomingBookings = upcomingRaw.map(b => ({ ...b, experienceName: expMap[b.experienceId ?? 0] ?? "Actividad" }));
    const topExperiences = topRaw.map(r => ({ experienceId: r.productId, experienceName: r.productName, count: Number(r.count), revenue: Math.round(parseFloat(r.revenue ?? "0")) / 100 }));

    return {
      kpis: {
        revenueThisMonth: parseFloat(revTotal?.total ?? "0"),
        revenueLastMonth: parseFloat(revLastMonth?.total ?? "0"),
        revenueTotal: parseFloat(revAllTime?.total ?? "0"),
        bookingsThisMonth: Number(bookingsThisMonth?.count ?? 0),
        bookingsPending: Number(bookingsPending?.count ?? 0),
        bookingsConfirmed: Number(bookingsConfirmed?.count ?? 0),
        leadsNew: Number(leadsNew?.count ?? 0),
        leadsTotal: Number(leadsTotal?.count ?? 0),
        quotesEnviados: Number(quotesEnviados?.count ?? 0),
        quotesPendingAmount: parseFloat(quotesPendingAmt?.total ?? "0"),
        invoicesPendingCount: Number(invoicesPendingCount?.count ?? 0),
        invoicesPendingAmount: parseFloat(invoicesPendingAmt?.total ?? "0"),
        reservationsPaidThisMonth: Number(resPaidThisMonth?.count ?? 0),
      },
      funnel: {
        leads: Number(fLeads?.count ?? 0),
        quotes: Number(fQuotes?.count ?? 0),
        reservations: Number(fReservationsPaid?.count ?? 0) + Number(fBookingsCompleted?.count ?? 0),
        invoices: Number(fInvoices?.count ?? 0),
      },
      recentActivity,
      todayBookings,
      upcomingBookings,
      topExperiences,
      pendingAlerts: {
        transfersToValidate: Number(transfersToValidate?.count ?? 0),
        quotesExpiringSoon: Number(quotesExpiring?.count ?? 0),
        invoicesOverdue: Number(invoicesOverdue?.count ?? 0),
      },
    };
  } catch (err) {
    console.error("[getDashboardOverview] Error:", err);
    return empty;
  }
}

// ─── REAV MODULE ─────────────────────────────────────────────────────────────

export async function generateExpedientNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const year = new Date().getFullYear();
  const prefix = `EXP-REAV-${year}-`;
  const last = await db
    .select({ num: reavExpedients.expedientNumber })
    .from(reavExpedients)
    .where(like(reavExpedients.expedientNumber, `${prefix}%`))
    .orderBy(desc(reavExpedients.id))
    .limit(1);
  const seq = last.length > 0
    ? parseInt(last[0].num.split("-").pop() ?? "0") + 1
    : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function createReavExpedient(data: {
  invoiceId?: number;
  reservationId?: number;
  clientId?: number;
  agentId?: number;
  serviceDescription?: string;
  serviceDate?: string;
  serviceEndDate?: string;
  destination?: string;
  numberOfPax?: number;
  saleAmountTotal?: string;
  providerCostEstimated?: string;
  agencyMarginEstimated?: string;
  internalNotes?: string;
  // Datos del cliente
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientDni?: string;
  clientAddress?: string;
  // Canal y referencia
  channel?: "tpv" | "online" | "crm" | "manual";
  sourceRef?: string;
  tpvSaleId?: number;
  quoteId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const expedientNumber = await generateExpedientNumber();
  const [result] = await db.insert(reavExpedients).values({
    ...data,
    expedientNumber,
    fiscalStatus: "pendiente_documentacion",
    operativeStatus: "abierto",
  });
  return { id: (result as any).insertId, expedientNumber };
}

/**
 * Adjunta un documento (PDF, URL) a un expediente REAV.
 * Usado por TPV (ticket), CRM (factura/presupuesto) y online (confirmación).
 */
export async function attachReavDocument(data: {
  expedientId: number;
  side: "client" | "provider";
  docType: "factura_emitida" | "factura_recibida" | "contrato" | "voucher" | "confirmacion_proveedor" | "otro";
  title: string;
  fileUrl?: string;
  fileKey?: string;
  mimeType?: string;
  notes?: string;
  uploadedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(reavDocuments).values({
    expedientId: data.expedientId,
    side: data.side,
    docType: data.docType,
    title: data.title,
    fileUrl: data.fileUrl,
    fileKey: data.fileKey,
    mimeType: data.mimeType ?? "application/pdf",
    notes: data.notes,
    uploadedBy: data.uploadedBy,
  });
  return { id: (result as any).insertId };
}

export async function listReavExpedients(filters?: {
  fiscalStatus?: string;
  operativeStatus?: string;
  agentId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters?.fiscalStatus) conditions.push(eq(reavExpedients.fiscalStatus, filters.fiscalStatus as any));
  if (filters?.operativeStatus) conditions.push(eq(reavExpedients.operativeStatus, filters.operativeStatus as any));
  if (filters?.agentId) conditions.push(eq(reavExpedients.agentId, filters.agentId));
  const query = conditions.length > 0
    ? db.select().from(reavExpedients).where(and(...conditions))
    : db.select().from(reavExpedients);
  return query.orderBy(desc(reavExpedients.createdAt));
}

export async function getReavExpedientById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [exp] = await db.select().from(reavExpedients).where(eq(reavExpedients.id, id));
  if (!exp) return null;
  const documents = await db.select().from(reavDocuments).where(eq(reavDocuments.expedientId, id));
  const costs = await db.select().from(reavCosts).where(eq(reavCosts.expedientId, id));
  return { ...exp, documents, costs };
}

export async function updateReavExpedient(id: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reavExpedients).set(data as any).where(eq(reavExpedients.id, id));
  return getReavExpedientById(id);
}

export async function recalculateReavMargins(expedientId: number) {
  const db = await getDb();
  if (!db) return null;
  const exp = await getReavExpedientById(expedientId);
  if (!exp) return null;
  const totalCosts = exp.costs.reduce((sum, c) => sum + parseFloat(c.amount as string), 0);
  const sale = parseFloat(exp.saleAmountTotal as string ?? "0");
  const marginReal = sale - totalCosts;
  const taxBase = Math.max(0, marginReal);
  const taxAmount = taxBase * 0.21;
  await db.update(reavExpedients).set({
    providerCostReal: String(totalCosts.toFixed(2)),
    agencyMarginReal: String(marginReal.toFixed(2)),
    reavTaxBase: String(taxBase.toFixed(2)),
    reavTaxAmount: String(taxAmount.toFixed(2)),
  }).where(eq(reavExpedients.id, expedientId));
  return getReavExpedientById(expedientId);
}

export async function addReavDocument(data: {
  expedientId: number;
  side: "client" | "provider";
  docType: string;
  title: string;
  fileUrl?: string;
  fileKey?: string;
  mimeType?: string;
  fileSize?: number;
  notes?: string;
  uploadedBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(reavDocuments).values(data as any);
  return { id: (result as any).insertId };
}

export async function deleteReavDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(reavDocuments).where(eq(reavDocuments.id, id));
}

export async function addReavCost(data: {
  expedientId: number;
  description: string;
  providerName?: string;
  providerNif?: string;
  invoiceRef?: string;
  invoiceDate?: string;
  amount: string;
  currency?: string;
  category?: string;
  isPaid?: boolean;
  notes?: string;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(reavCosts).values(data as any);
  await recalculateReavMargins(data.expedientId);
  return { id: (result as any).insertId };
}

export async function updateReavCost(id: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(reavCosts).set(data as any).where(eq(reavCosts.id, id));
  const [cost] = await db.select().from(reavCosts).where(eq(reavCosts.id, id));
  if (cost) await recalculateReavMargins(cost.expedientId);
}

export async function deleteReavCost(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [cost] = await db.select().from(reavCosts).where(eq(reavCosts.id, id));
  await db.delete(reavCosts).where(eq(reavCosts.id, id));
  if (cost) await recalculateReavMargins(cost.expedientId);
}

// ─── UPSERT CLIENTE DESDE RESERVA ─────────────────────────────────────────────
// Helper centralizado para crear/actualizar el registro de cliente cuando se
// genera una reserva desde cualquier canal (TPV, Redsys IPN, CRM manual, etc.)
// Si el email ya existe → actualiza nombre/teléfono solo si los campos están vacíos.
// Si no existe → crea cliente nuevo con source = canal indicado.
export async function upsertClientFromReservation({
  name,
  email,
  phone,
  source,
  leadId,
}: {
  name: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  leadId?: number | null;
}) {
  if (!email) return; // Sin email no podemos hacer upsert por clave única
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(clients).values({
      leadId: leadId ?? null,
      source,
      name,
      email,
      phone: phone ?? "",
      company: "",
      tags: [],
      isConverted: false,
      totalBookings: 0,
    }).onDuplicateKeyUpdate({
      set: {
        // Actualizar leadId si se proporciona uno nuevo
        ...(leadId ? { leadId } : {}),
        // Actualizar nombre/teléfono solo si el campo está vacío en el cliente existente
        name: sql`IF(TRIM(${clients.name}) = '' OR ${clients.name} IS NULL, ${name}, ${clients.name})`,
        phone: sql`IF(TRIM(${clients.phone}) = '' OR ${clients.phone} IS NULL, ${phone ?? ''}, ${clients.phone})`,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    console.warn("[upsertClientFromReservation] No se pudo crear/vincular cliente:", e);
  }
}

// ─── POST-CONFIRM OPERATION — Capa de consolidación global ─────────────────────
// Este helper centraliza todos los efectos secundarios que deben ejecutarse
// cuando una operación queda confirmada/pagada, independientemente del canal:
//   • CRM (confirmPayment, confirmTransfer, confirmManualPayment)
//   • TPV (createSale)
//   • Redsys IPN (pago online)
//   • Cupones (convertToReservation)
//
// Garantiza: booking operativo en tabla bookings + transacción contable en transactions.
// Es idempotente: si el booking ya existe para la reserva, no lo duplica.
export async function postConfirmOperation(params: {
  // Datos de la reserva/operación
  reservationId: number;
  productId: number;
  productName: string;
  /** Fecha operativa del servicio (YYYY-MM-DD). Si no se pasa, usa hoy. */
  serviceDate?: string | null;
  people: number;
  amountCents: number;
  // Datos del cliente
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  // Datos de la transacción contable
  totalAmount: number;         // en euros (no centavos)
  paymentMethod: "redsys" | "transferencia" | "efectivo" | "otro" | "tarjeta" | "link_pago";
  saleChannel: "crm" | "tpv" | "online" | "admin" | "delegado";
  invoiceNumber?: string | null;
  reservationRef?: string | null;
  sellerUserId?: number | null;
  sellerName?: string | null;
  taxBase?: number;
  taxAmount?: number;
  reavMargin?: number;
  fiscalRegime?: "reav" | "general_21" | "mixed";
  description?: string;
  // Vínculo con presupuesto (CRM)
  quoteId?: number | null;
  sourceChannel?: "redsys" | "transferencia" | "efectivo" | "otro";
  // Vínculo con TPV
  tpvSaleId?: number | null;
}) {
  const db = await getDb();
  if (!db) return { bookingId: null, transactionId: null };

  const today = new Date().toISOString().split("T")[0];
  const bookingDate = params.serviceDate ?? today;

  // 1. Crear booking operativo (idempotente)
  let bookingId: number | null = null;
  try {
    const result = await createBookingFromReservation({
      reservationId: params.reservationId,
      productId: params.productId,
      productName: params.productName,
      bookingDate,
      people: params.people,
      amountCents: params.amountCents,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerPhone: params.customerPhone,
      quoteId: params.quoteId,
      sourceChannel: params.sourceChannel ?? "otro",
    });
    bookingId = result.id;
  } catch (e) {
    console.error("[postConfirmOperation] Error creando booking operativo:", e);
  }

  // 2. Crear transacción contable (idempotente por invoiceNumber si se proporciona)
  let transactionId: number | null = null;
  try {
    // Verificar si ya existe una transacción para esta reserva
    const existingTx = await db.select({ id: transactions.id })
      .from(transactions)
      .where(eq((transactions as any).reservationId, params.reservationId))
      .limit(1);
    if (existingTx.length === 0) {
      const txNumber = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const methodMap: Record<string, string> = {
        redsys: "tarjeta", transferencia: "transferencia", efectivo: "efectivo",
        tarjeta: "tarjeta", link_pago: "link_pago", otro: "otro",
      };
      const [txResult] = await db.insert(transactions).values({
        transactionNumber: txNumber,
        type: "ingreso",
        amount: String(params.totalAmount.toFixed(2)),
        currency: "EUR",
        paymentMethod: (methodMap[params.paymentMethod] ?? "otro") as any,
        status: "completado",
        description: params.description ?? `Operación confirmada — ${params.productName}`,
        processedAt: new Date(),
        clientName: params.customerName,
        clientEmail: params.customerEmail,
        clientPhone: params.customerPhone ?? null,
        productName: params.productName,
        saleChannel: params.saleChannel as any,
        sellerUserId: params.sellerUserId ?? null,
        sellerName: params.sellerName ?? null,
        taxBase: String((params.taxBase ?? 0).toFixed(2)),
        taxAmount: String((params.taxAmount ?? 0).toFixed(2)),
        reavMargin: String((params.reavMargin ?? 0).toFixed(2)),
        fiscalRegime: (params.fiscalRegime ?? "general_21") as any,
        tpvSaleId: params.tpvSaleId ?? null,
        reservationId: params.reservationId,
        invoiceNumber: params.invoiceNumber ?? null,
        reservationRef: params.reservationRef ?? null,
        operationStatus: "confirmada",
      } as any);
      transactionId = (txResult as { insertId: number }).insertId;
    } else {
      transactionId = existingTx[0].id;
    }
  } catch (e) {
    console.error("[postConfirmOperation] Error creando transacción contable:", e);
  }

  // 3. Crear/actualizar cliente en CRM (idempotente por email)
  try {
    if (params.customerEmail) {
      await upsertClientFromReservation({
        name: params.customerName,
        email: params.customerEmail,
        phone: params.customerPhone ?? null,
        source: `reserva_${params.saleChannel}`,
        leadId: null,
      });
    }
  } catch (e) {
    console.error("[postConfirmOperation] Error en upsertClientFromReservation:", e);
  }

  // 4. Crear registro en reservation_operational con op_status = 'confirmado'
  // Una reserva pagada debe aparecer como 'confirmado' en Operaciones desde el primer momento.
  // El admin puede cambiar a 'incidencia' si hay eventualidades (no-show, etc.).
  try {
    const existingOp = await db.select({ id: reservationOperational.id })
      .from(reservationOperational)
      .where(and(
        eq(reservationOperational.reservationId, params.reservationId),
        eq(reservationOperational.reservationType, "activity")
      ))
      .limit(1);
    if (existingOp.length === 0) {
      await db.insert(reservationOperational).values({
        reservationId: params.reservationId,
        reservationType: "activity",
        opStatus: "confirmado",
        clientConfirmed: false, // El cliente aún no ha confirmado asistencia física
      } as any);
    } else {
      // Si ya existe pero está en 'pendiente', actualizar a 'confirmado'
      const existing = existingOp[0];
      const [currentOp] = await db.select({ opStatus: reservationOperational.opStatus })
        .from(reservationOperational)
        .where(eq(reservationOperational.id, existing.id))
        .limit(1);
      if (currentOp && currentOp.opStatus === "pendiente") {
        await db.update(reservationOperational)
          .set({ opStatus: "confirmado" } as any)
          .where(eq(reservationOperational.id, existing.id));
      }
    }
  } catch (e) {
    console.error("[postConfirmOperation] Error en reservation_operational:", e);
  }

  return { bookingId, transactionId };
}
