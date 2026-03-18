import { eq, desc, and, like, sql, isNull, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import {
  users, InsertUser,
  experiences, categories, locations, experienceVariants,
  leads, quotes, bookings, bookingMonitors, dailyOrders,
  transactions, slideshowItems, menuItems, mediaFiles, staticPages, siteSettings,
  ghlWebhookLogs,
  homeModuleItems,
  packs, InsertPack,
  packCrossSells,
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
  budget?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
    budget: data.budget ?? null,
    status: "nuevo",
    source: "web",
  });
  return { id: Number(result[0].insertId), success: true };
}

export async function getAllLeads(params: { status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leads)
    .orderBy(desc(leads.createdAt))
    .limit(params.limit ?? 20)
    .offset(params.offset ?? 0);
}

export async function updateLeadStatus(id: number, status: string, assignedTo?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set({
    status: status as any,
    ...(assignedTo ? { assignedTo } : {}),
  }).where(eq(leads.id, id));
  return { success: true };
}

// ─── QUOTES ───────────────────────────────────────────────────────────────────

export async function createQuote(data: {
  leadId: number;
  agentId: number;
  title: string;
  description?: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  discount?: string;
  tax?: string;
  total: string;
  validUntil?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const quoteNumber = `QT-${Date.now()}-${nanoid(4).toUpperCase()}`;
  const paymentLinkToken = nanoid(32);
  const result = await db.insert(quotes).values({
    quoteNumber,
    leadId: data.leadId,
    agentId: data.agentId,
    title: data.title,
    description: data.description ?? null,
    items: data.items,
    subtotal: data.subtotal,
    discount: data.discount ?? "0",
    tax: data.tax ?? "0",
    total: data.total,
    validUntil: data.validUntil ? new Date(data.validUntil) : null,
    notes: data.notes ?? null,
    paymentLinkToken,
    status: "borrador",
  });
  return { id: Number(result[0].insertId), quoteNumber, paymentLinkToken, success: true };
}

export async function getAllQuotes(params: { status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quotes)
    .orderBy(desc(quotes.createdAt))
    .limit(params.limit ?? 20)
    .offset(params.offset ?? 0);
}

export async function updateQuoteStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(quotes).set({ status: status as any }).where(eq(quotes.id, id));
  return { success: true };
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

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

export async function getAllTransactions(params: { type?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(transactions)
    .orderBy(desc(transactions.createdAt))
    .limit(params.limit ?? 20)
    .offset(params.offset ?? 0);
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

import { reservations } from "../drizzle/schema";

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
    ...(status === "paid" ? { paidAt: now } : {}),
  }).where(eq(reservations.merchantOrder, merchantOrder));
  return { success: true };
}

export async function getAllReservations(params: { status?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = params.status
    ? [eq(reservations.status, params.status as any)]
    : [];
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

export async function cloneExperience(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orig] = await db.select().from(experiences).where(eq(experiences.id, id));
  if (!orig) throw new Error("Experience not found");
  const newSlug = orig.slug + "-copia-" + nanoid(4);
  const newTitle = orig.title + " (Copia)";
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

// ─── PACKS ────────────────────────────────────────────────────────────────────

export async function getPublicPacks(category?: "dia" | "escolar" | "empresa") {
  const db = await getDb();
  if (!db) return [];
  const conditions = category
    ? and(eq(packs.isActive, true), eq(packs.category, category))
    : eq(packs.isActive, true);
  return db.select().from(packs).where(conditions).orderBy(packs.sortOrder);
}

export async function getPackBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(packs).where(eq(packs.slug, slug)).limit(1);
  return result[0] ?? null;
}

export async function getPackCrossSells(packId: number) {
  const db = await getDb();
  if (!db) return [];
  const crosses = await db.select().from(packCrossSells)
    .where(eq(packCrossSells.packId, packId))
    .orderBy(packCrossSells.sortOrder);
  if (crosses.length === 0) return [];
  const ids = crosses.map(c => c.relatedPackId);
  return db.select().from(packs).where(and(inArray(packs.id, ids), eq(packs.isActive, true)));
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
  role: "user" | "admin" | "monitor" | "agente";
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

export async function changeUserRole(userId: number, role: "user" | "admin" | "monitor" | "agente") {
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
