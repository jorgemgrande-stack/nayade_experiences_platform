import {
  bigint,
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── USERS & AUTH ────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "monitor", "agente", "adminrest"]).default("user").notNull(),
  phone: varchar("phone", { length: 32 }),
  avatarUrl: text("avatarUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  passwordHash: text("passwordHash"),
  inviteToken: varchar("inviteToken", { length: 128 }),
  inviteTokenExpiry: timestamp("inviteTokenExpiry"),
  inviteAccepted: boolean("inviteAccepted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── CMS: SITE SETTINGS ──────────────────────────────────────────────────────

export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  type: mysqlEnum("type", ["text", "json", "image", "boolean"]).default("text").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const slideshowItems = mysqlTable("slideshow_items", {
  id: int("id").autoincrement().primaryKey(),
  imageUrl: text("imageUrl").notNull(),
  badge: varchar("badge", { length: 128 }),
  title: varchar("title", { length: 256 }),
  subtitle: text("subtitle"),
  description: text("description"),
  ctaText: varchar("ctaText", { length: 128 }),
  ctaUrl: varchar("ctaUrl", { length: 512 }),
  reserveUrl: varchar("reserveUrl", { length: 512 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const menuItems = mysqlTable("menu_items", {
  id: int("id").autoincrement().primaryKey(),
  parentId: int("parentId"),
  label: varchar("label", { length: 128 }).notNull(),
  url: varchar("url", { length: 512 }),
  target: mysqlEnum("target", ["_self", "_blank"]).default("_self").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  menuZone: mysqlEnum("menuZone", ["header", "footer"]).default("header").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const mediaFiles = mysqlTable("media_files", {
  id: int("id").autoincrement().primaryKey(),
  filename: varchar("filename", { length: 256 }).notNull(),
  originalName: varchar("originalName", { length: 256 }).notNull(),
  url: text("url").notNull(),
  fileKey: text("fileKey").notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  size: int("size").notNull(),
  type: mysqlEnum("type", ["image", "video", "document"]).default("image").notNull(),
  altText: text("altText"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const staticPages = mysqlTable("static_pages", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  content: text("content"),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  isPublished: boolean("isPublished").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

export const locations = mysqlTable("locations", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl"),
  address: text("address"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl"),
  image1: text("image1"),
  iconName: varchar("iconName", { length: 64 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── EXPERIENCES (PRODUCTS) ──────────────────────────────────────────────────

export const experiences = mysqlTable("experiences", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  shortDescription: text("shortDescription"),
  description: text("description"),
  categoryId: int("categoryId").notNull(),
  locationId: int("locationId").notNull(),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  duration: varchar("duration", { length: 128 }),
  minPersons: int("minPersons").default(1),
  maxPersons: int("maxPersons"),
  difficulty: mysqlEnum("difficulty", ["facil", "moderado", "dificil", "experto"]).default("facil"),
  includes: json("includes").$type<string[]>().default([]),
  excludes: json("excludes").$type<string[]>().default([]),
  requirements: text("requirements"),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const experienceVariants = mysqlTable("experience_variants", {
  id: int("id").autoincrement().primaryKey(),
  experienceId: int("experienceId").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  priceModifier: decimal("priceModifier", { precision: 10, scale: 2 }).default("0"),
  priceType: mysqlEnum("priceType", ["fixed", "percentage", "per_person"]).default("fixed").notNull(),
  options: json("options").$type<{ label: string; value: string; priceAdjustment: number }[]>().default([]),
  isRequired: boolean("isRequired").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── LEADS & QUOTES ──────────────────────────────────────────────────────────

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  company: varchar("company", { length: 256 }),
  message: text("message"),
  experienceId: int("experienceId"),
  locationId: int("locationId"),
  preferredDate: timestamp("preferredDate"),
  numberOfPersons: int("numberOfPersons"),
  budget: decimal("budget", { precision: 10, scale: 2 }),
  status: mysqlEnum("status", ["nuevo", "contactado", "en_proceso", "convertido", "perdido"]).default("nuevo").notNull(),
  // CRM fields
  opportunityStatus: mysqlEnum("opportunityStatus", ["nueva", "enviada", "ganada", "perdida"]).default("nueva").notNull(),
  priority: mysqlEnum("priority", ["baja", "media", "alta"]).default("media").notNull(),
  lastContactAt: timestamp("lastContactAt"),
  lostReason: text("lostReason"),
  seenAt: timestamp("seenAt"),
  internalNotes: json("internalNotes").$type<{ text: string; authorId: number; authorName: string; createdAt: string }[]>().default([]),
  assignedTo: int("assignedTo"),
  ghlContactId: varchar("ghlContactId", { length: 128 }),
  source: varchar("source", { length: 128 }).default("web"),
  selectedCategory: varchar("selectedCategory", { length: 128 }),
  selectedProduct: varchar("selectedProduct", { length: 256 }),
  activitiesJson: json("activitiesJson").$type<{
    experienceId: number;
    experienceTitle: string;
    family: string;
    participants: number;
    details: Record<string, string | number>;
  }[]>(),
  numberOfAdults: int("numberOfAdults"),
  numberOfChildren: int("numberOfChildren"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const quotes = mysqlTable("quotes", {
  id: int("id").autoincrement().primaryKey(),
  quoteNumber: varchar("quoteNumber", { length: 32 }).notNull().unique(),
  leadId: int("leadId").notNull(),
  agentId: int("agentId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  validUntil: timestamp("validUntil"),
  status: mysqlEnum("status", [
    "borrador",
    "enviado",
    "visualizado",
    "aceptado",
    "convertido_carrito",
    "pagado",
    "convertido_reserva",
    "facturado",
    "rechazado",
    "expirado",
    "perdido",
  ]).default("borrador").notNull(),
  // CRM fields
  sentAt: timestamp("sentAt"),
  viewedAt: timestamp("viewedAt"),
  acceptedAt: timestamp("acceptedAt"),
  conditions: text("conditions"),
  redsysOrderId: varchar("redsysOrderId", { length: 32 }),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }),
  invoicePdfUrl: text("invoicePdfUrl"),
  invoiceGeneratedAt: timestamp("invoiceGeneratedAt"),
  paymentLinkToken: varchar("paymentLinkToken", { length: 128 }).unique(),
  paymentLinkUrl: text("paymentLinkUrl"),
  paidAt: timestamp("paidAt"),
  notes: text("notes"),
  reminderCount: int("reminderCount").default(0),
  lastReminderAt: timestamp("lastReminderAt"),
  ghlOpportunityId: varchar("ghlOpportunityId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── CRM ACTIVITY LOG ─────────────────────────────────────────────────────────
export const crmActivityLog = mysqlTable("crm_activity_log", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["lead", "quote", "reservation", "invoice"]).notNull(),
  entityId: int("entityId").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  actorId: int("actorId"),
  actorName: varchar("actorName", { length: 256 }),
  details: json("details").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CrmActivityLog = typeof crmActivityLog.$inferSelect;
export type InsertCrmActivityLog = typeof crmActivityLog.$inferInsert;

// ─── INVOICES ─────────────────────────────────────────────────────────────────
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }).notNull().unique(),
  quoteId: int("quoteId"),
  reservationId: int("reservationId"),
  clientName: varchar("clientName", { length: 256 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  clientPhone: varchar("clientPhone", { length: 32 }),
  clientNif: varchar("clientNif", { length: 32 }),
  clientAddress: text("clientAddress"),
  itemsJson: json("itemsJson").$type<{ description: string; quantity: number; unitPrice: number; total: number }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  taxAmount: decimal("taxAmount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  status: mysqlEnum("status", ["generada", "enviada", "anulada"]).default("generada").notNull(),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ─── BOOKINGS & CALENDAR ─────────────────────────────────────────────────────

export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  bookingNumber: varchar("bookingNumber", { length: 32 }).notNull().unique(),
  experienceId: int("experienceId").notNull(),
  quoteId: int("quoteId"),
  clientName: varchar("clientName", { length: 256 }).notNull(),
  clientEmail: varchar("clientEmail", { length: 320 }).notNull(),
  clientPhone: varchar("clientPhone", { length: 32 }),
  scheduledDate: timestamp("scheduledDate").notNull(),
  endDate: timestamp("endDate"),
  numberOfPersons: int("numberOfPersons").notNull(),
  totalAmount: decimal("totalAmount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pendiente", "confirmado", "en_curso", "completado", "cancelado"]).default("pendiente").notNull(),
  notes: text("notes"),
  internalNotes: text("internalNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const bookingMonitors = mysqlTable("booking_monitors", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  monitorId: int("monitorId").notNull(),
  role: varchar("role", { length: 128 }).default("monitor"),
  notifiedAt: timestamp("notifiedAt"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const dailyOrders = mysqlTable("daily_orders", {
  id: int("id").autoincrement().primaryKey(),
  date: timestamp("date").notNull(),
  bookingId: int("bookingId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  meetingPoint: text("meetingPoint"),
  equipment: json("equipment").$type<string[]>().default([]),
  specialInstructions: text("specialInstructions"),
  status: mysqlEnum("status", ["borrador", "publicado", "completado"]).default("borrador").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── TRANSACTIONS & ACCOUNTING ───────────────────────────────────────────────

export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  transactionNumber: varchar("transactionNumber", { length: 32 }).notNull().unique(),
  bookingId: int("bookingId"),
  quoteId: int("quoteId"),
  type: mysqlEnum("type", ["ingreso", "reembolso", "comision", "gasto"]).default("ingreso").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["tarjeta", "transferencia", "efectivo", "link_pago", "otro"]).default("tarjeta"),
  status: mysqlEnum("status", ["pendiente", "completado", "fallido", "reembolsado"]).default("pendiente").notNull(),
  description: text("description"),
  externalRef: varchar("externalRef", { length: 256 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── GHL INTEGRATION ─────────────────────────────────────────────────────────

export const ghlWebhookLogs = mysqlTable("ghl_webhook_logs", {
  id: int("id").autoincrement().primaryKey(),
  event: varchar("event", { length: 128 }).notNull(),
  payload: json("payload"),
  status: mysqlEnum("status", ["recibido", "procesado", "error"]).default("recibido").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── HOME MODULES ────────────────────────────────────────────────────────────
export const homeModuleItems = mysqlTable("home_module_items", {
  id: int("id").autoincrement().primaryKey(),
  moduleKey: varchar("module_key", { length: 64 }).notNull(),
  experienceId: int("experience_id").notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ─── RESERVATIONS (Redsys) ─────────────────────────────────────────────────────────────────────────────────
export const reservations = mysqlTable("reservations", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  bookingDate: varchar("booking_date", { length: 20 }).notNull(),
  people: int("people").default(1).notNull(),
  extrasJson: text("extras_json"),
  amountTotal: int("amount_total").notNull(),
  amountPaid: int("amount_paid").default(0),
  status: mysqlEnum("status", ["draft", "pending_payment", "paid", "failed", "cancelled"]).default("draft").notNull(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 50 }),
  merchantOrder: varchar("merchant_order", { length: 12 }).notNull().unique(),
  redsysResponse: text("redsys_response"),
  redsysDsResponse: varchar("redsys_ds_response", { length: 10 }),
  notes: text("notes"),
  quoteId: int("quote_id"),
  quoteSource: varchar("quoteSource", { length: 32 }), // 'presupuesto' | 'directo'
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  paidAt: bigint("paid_at", { mode: "number" }),
});

// ─── PACKS ──────────────────────────────────────────────────────────────────

export const packs = mysqlTable("packs", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  category: mysqlEnum("category", ["dia", "escolar", "empresa"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  subtitle: varchar("subtitle", { length: 512 }),
  shortDescription: text("shortDescription"),
  description: text("description"),
  includes: json("includes").$type<string[]>().default([]),
  excludes: json("excludes").$type<string[]>().default([]),
  schedule: text("schedule"),
  note: text("note"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull().default("0"),
  priceLabel: varchar("priceLabel", { length: 128 }),
  duration: varchar("duration", { length: 128 }),
  minPersons: int("minPersons").default(1),
  maxPersons: int("maxPersons"),
  targetAudience: varchar("targetAudience", { length: 256 }),
  badge: varchar("badge", { length: 64 }),
  hasStay: boolean("hasStay").default(false).notNull(),
  isOnlinePurchase: boolean("isOnlinePurchase").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const packCrossSells = mysqlTable("pack_cross_sells", {
  id: int("id").autoincrement().primaryKey(),
  packId: int("packId").notNull(),
  relatedPackId: int("relatedPackId").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
});

export type Pack = typeof packs.$inferSelect;
export type InsertPack = typeof packs.$inferInsert;

// ─── TYPE EXPORTS ─────────────────────────────────────────────────────────────────────────────────
export type Reservation = typeof reservations.$inferSelect;
export type HomeModuleItem = typeof homeModuleItems.$inferSelect;
export type SlideshowItem = typeof slideshowItems.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Experience = typeof experiences.$inferSelect;
export type ExperienceVariant = typeof experienceVariants.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type BookingMonitor = typeof bookingMonitors.$inferSelect;
export type DailyOrder = typeof dailyOrders.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

// ─── PAGE BLOCKS ─────────────────────────────────────────────────────────────
export const pageBlocks = mysqlTable("page_blocks", {
  id: int("id").autoincrement().primaryKey(),
  pageSlug: varchar("pageSlug", { length: 256 }).notNull(),
  blockType: varchar("blockType", { length: 64 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  data: json("data").notNull(),
  isVisible: boolean("isVisible").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PageBlock = typeof pageBlocks.$inferSelect;
export type InsertPageBlock = typeof pageBlocks.$inferInsert;

// ─── HOTEL ───────────────────────────────────────────────────────────────────

/** Tipologías de habitación (equivalente a experiences) */
export const roomTypes = mysqlTable("room_types", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  shortDescription: text("shortDescription"),
  description: text("description"),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  maxAdults: int("maxAdults").default(2).notNull(),
  maxChildren: int("maxChildren").default(0).notNull(),
  maxOccupancy: int("maxOccupancy").default(2).notNull(),
  surfaceM2: int("surfaceM2"),
  amenities: json("amenities").$type<string[]>().default([]),
  basePrice: decimal("basePrice", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  totalUnits: int("totalUnits").default(1).notNull(),
  internalTags: json("internalTags").$type<string[]>().default([]),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Temporadas de precio (ej: alta, media, baja) */
export const roomRateSeasons = mysqlTable("room_rate_seasons", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(), // YYYY-MM-DD
  endDate: varchar("endDate", { length: 10 }).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Tarifas por tipología + temporada + día semana */
export const roomRates = mysqlTable("room_rates", {
  id: int("id").autoincrement().primaryKey(),
  roomTypeId: int("roomTypeId").notNull(),
  seasonId: int("seasonId"),
  dayOfWeek: int("dayOfWeek"), // 0=Dom … 6=Sáb, null=todos
  specificDate: varchar("specificDate", { length: 10 }), // YYYY-MM-DD override
  pricePerNight: decimal("pricePerNight", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  supplement: decimal("supplement", { precision: 10, scale: 2 }).default("0"),
  supplementLabel: varchar("supplementLabel", { length: 128 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Bloqueos y ajustes de inventario por fecha */
export const roomBlocks = mysqlTable("room_blocks", {
  id: int("id").autoincrement().primaryKey(),
  roomTypeId: int("roomTypeId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  availableUnits: int("availableUnits").default(0).notNull(), // 0 = cerrado
  reason: varchar("reason", { length: 256 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RoomType = typeof roomTypes.$inferSelect;
export type InsertRoomType = typeof roomTypes.$inferInsert;
export type RoomRateSeason = typeof roomRateSeasons.$inferSelect;
export type RoomRate = typeof roomRates.$inferSelect;
export type RoomBlock = typeof roomBlocks.$inferSelect;

// ─── SPA ─────────────────────────────────────────────────────────────────────

/** Categorías de tratamiento SPA */
export const spaCategories = mysqlTable("spa_categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  iconName: varchar("iconName", { length: 64 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Tratamientos y circuitos SPA (equivalente a experiences) */
export const spaTreatments = mysqlTable("spa_treatments", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  categoryId: int("categoryId"),
  shortDescription: text("shortDescription"),
  description: text("description"),
  benefits: json("benefits").$type<string[]>().default([]),
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  gallery: json("gallery").$type<string[]>().default([]),
  durationMinutes: int("durationMinutes").default(60).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  maxPersons: int("maxPersons").default(1).notNull(),
  cabinRequired: boolean("cabinRequired").default(true).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Recursos SPA: cabinas y terapeutas */
export const spaResources = mysqlTable("spa_resources", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["cabina", "terapeuta"]).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Slots de agenda SPA (franjas horarias disponibles) */
export const spaSlots = mysqlTable("spa_slots", {
  id: int("id").autoincrement().primaryKey(),
  treatmentId: int("treatmentId").notNull(),
  resourceId: int("resourceId"),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  startTime: varchar("startTime", { length: 5 }).notNull(), // HH:MM
  endTime: varchar("endTime", { length: 5 }).notNull(),
  capacity: int("capacity").default(1).notNull(),
  bookedCount: int("bookedCount").default(0).notNull(),
  status: mysqlEnum("status", ["disponible", "reservado", "bloqueado"]).default("disponible").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Plantillas de horario semanal para auto-generar slots */
export const spaScheduleTemplates = mysqlTable("spa_schedule_templates", {
  id: int("id").autoincrement().primaryKey(),
  treatmentId: int("treatmentId").notNull(),
  resourceId: int("resourceId"),
  dayOfWeek: int("dayOfWeek").notNull(), // 0=Dom … 6=Sáb
  startTime: varchar("startTime", { length: 5 }).notNull(),
  endTime: varchar("endTime", { length: 5 }).notNull(),
  capacity: int("capacity").default(1).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SpaCategory = typeof spaCategories.$inferSelect;
export type SpaTreatment = typeof spaTreatments.$inferSelect;
export type InsertSpaTreatment = typeof spaTreatments.$inferInsert;
export type SpaResource = typeof spaResources.$inferSelect;
export type SpaSlot = typeof spaSlots.$inferSelect;
export type SpaScheduleTemplate = typeof spaScheduleTemplates.$inferSelect;

// ─── REVIEWS ─────────────────────────────────────────────────────────────────

/**
 * Reseñas y valoraciones de usuarios para habitaciones del hotel y tratamientos del SPA.
 * entityType: 'hotel' | 'spa'
 * entityId: id de la room_type o spa_treatment correspondiente
 */
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["hotel", "spa"]).notNull(),
  entityId: int("entityId").notNull(),
  authorName: varchar("authorName", { length: 256 }).notNull(),
  authorEmail: varchar("authorEmail", { length: 320 }),
  rating: int("rating").notNull(), // 1-5
  title: varchar("title", { length: 256 }),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  adminReply: text("adminReply"),
  adminRepliedAt: timestamp("adminRepliedAt"),
  stayDate: varchar("stayDate", { length: 10 }), // YYYY-MM-DD (fecha de la estancia/tratamiento)
  verifiedBooking: boolean("verifiedBooking").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

// ─── PASSWORD RESET TOKENS ───────────────────────────────────────────────────
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── RESTAURANTS ─────────────────────────────────────────────────────────────

export const restaurants = mysqlTable("restaurants", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  shortDesc: text("shortDesc"),
  longDesc: text("longDesc"),
  cuisine: varchar("cuisine", { length: 256 }),
  heroImage: text("heroImage"),
  galleryImages: json("galleryImages").$type<string[]>().default([]),
  menuUrl: text("menuUrl"),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  location: varchar("location", { length: 512 }),
  badge: varchar("badge", { length: 128 }),
  // Configuración operativa
  depositPerGuest: decimal("depositPerGuest", { precision: 8, scale: 2 }).default("5.00").notNull(),
  maxGroupSize: int("maxGroupSize").default(20).notNull(),
  minAdvanceHours: int("minAdvanceHours").default(2).notNull(),
  maxAdvanceDays: int("maxAdvanceDays").default(60).notNull(),
  cancellationHours: int("cancellationHours").default(24).notNull(),
  cancellationPolicy: text("cancellationPolicy"),
  legalText: text("legalText"),
  operativeEmail: varchar("operativeEmail", { length: 320 }),
  acceptsOnlineBooking: boolean("acceptsOnlineBooking").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Restaurant = typeof restaurants.$inferSelect;
export type InsertRestaurant = typeof restaurants.$inferInsert;

// Turnos / franjas horarias por restaurante
export const restaurantShifts = mysqlTable("restaurant_shifts", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  name: varchar("name", { length: 128 }).notNull(), // ej: "Comida", "Cena", "Brunch"
  startTime: varchar("startTime", { length: 5 }).notNull(), // HH:MM
  endTime: varchar("endTime", { length: 5 }).notNull(),
  maxCapacity: int("maxCapacity").notNull(),
  daysOfWeek: json("daysOfWeek").$type<number[]>().default([0,1,2,3,4,5,6]), // 0=Dom..6=Sáb
  slotMinutes: int("slotMinutes").default(30).notNull(), // Granularidad de slots: 15, 30 o 60 min
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
});
export type RestaurantShift = typeof restaurantShifts.$inferSelect;
export type InsertRestaurantShift = typeof restaurantShifts.$inferInsert;

// Cierres puntuales
export const restaurantClosures = mysqlTable("restaurant_closures", {
  id: int("id").autoincrement().primaryKey(),
  restaurantId: int("restaurantId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  shiftId: int("shiftId"), // null = cierre total del día
  reason: varchar("reason", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantClosure = typeof restaurantClosures.$inferSelect;

// Reservas de restaurante
export const restaurantBookings = mysqlTable("restaurant_bookings", {
  id: int("id").autoincrement().primaryKey(),
  locator: varchar("locator", { length: 16 }).notNull().unique(), // ej: NR-A3F9K2
  restaurantId: int("restaurantId").notNull(),
  shiftId: int("shiftId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  time: varchar("time", { length: 5 }).notNull(), // HH:MM
  guests: int("guests").notNull(),
  depositAmount: decimal("depositAmount", { precision: 8, scale: 2 }).notNull(),
  // Datos del titular
  guestName: varchar("guestName", { length: 256 }).notNull(),
  guestLastName: varchar("guestLastName", { length: 256 }),
  guestEmail: varchar("guestEmail", { length: 320 }).notNull(),
  guestPhone: varchar("guestPhone", { length: 32 }),
  // Observaciones
  highchair: boolean("highchair").default(false),
  allergies: text("allergies"),
  birthday: boolean("birthday").default(false),
  specialRequests: text("specialRequests"),
  accessibility: boolean("accessibility").default(false),
  isVip: boolean("isVip").default(false),
  // Estado
  status: mysqlEnum("status", ["pending_payment", "confirmed", "payment_failed", "cancelled", "modified", "no_show", "completed"]).default("pending_payment").notNull(),
  cancellationReason: text("cancellationReason"),
  adminNotes: text("adminNotes"),
  // Canal y admin
  channel: mysqlEnum("channel", ["web", "manual", "admin"]).default("web").notNull(),
  createdByUserId: int("createdByUserId"),
  // Pago
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "failed", "refunded"]).default("pending").notNull(),
  paymentTransactionId: varchar("paymentTransactionId", { length: 256 }),
  paymentMethod: varchar("paymentMethod", { length: 64 }),
  merchantOrder: varchar("merchantOrder", { length: 32 }),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RestaurantBooking = typeof restaurantBookings.$inferSelect;
export type InsertRestaurantBooking = typeof restaurantBookings.$inferInsert;

// Log de actividad de reservas
export const restaurantBookingLogs = mysqlTable("restaurant_booking_logs", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  details: text("details"),
  userId: int("userId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantBookingLog = typeof restaurantBookingLogs.$inferSelect;

// Asignación de staff a restaurantes (para rol adminrest)
export const restaurantStaff = mysqlTable("restaurant_staff", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  restaurantId: int("restaurantId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RestaurantStaff = typeof restaurantStaff.$inferSelect;

// ─── GALLERY ─────────────────────────────────────────────────────────────────
export const galleryItems = mysqlTable("gallery_items", {
  id: int("id").autoincrement().primaryKey(),
  imageUrl: text("imageUrl").notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  title: varchar("title", { length: 256 }).default(""),
  category: varchar("category", { length: 128 }).notNull().default("General"),
  sortOrder: int("sortOrder").notNull().default(0),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type GalleryItem = typeof galleryItems.$inferSelect;
export type NewGalleryItem = typeof galleryItems.$inferInsert;

// ─── CLIENTS (CRM) ───────────────────────────────────────────────────────────
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  // Origen del cliente
  leadId: int("leadId"),                          // Lead que originó este cliente (puede ser null si se creó manualmente)
  source: varchar("source", { length: 64 }).default("lead").notNull(), // 'lead' | 'manual' | 'reservation'
  // Datos básicos (rellenados desde el lead)
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).notNull().unique(),
  phone: varchar("phone", { length: 64 }).default(""),
  company: varchar("company", { length: 256 }).default(""),
  // Datos ampliados (se completan cuando el presupuesto se convierte en reserva)
  nif: varchar("nif", { length: 64 }).default(""),
  address: text("address"),
  city: varchar("city", { length: 128 }).default(""),
  postalCode: varchar("postalCode", { length: 16 }).default(""),
  country: varchar("country", { length: 64 }).default("ES"),
  birthDate: varchar("birthDate", { length: 10 }),  // YYYY-MM-DD
  // Preferencias y notas
  notes: text("notes"),
  tags: json("tags").$type<string[]>().default([]),
  // Estado del cliente
  isConverted: boolean("isConverted").default(false).notNull(), // true cuando ha tenido al menos una reserva confirmada
  totalBookings: int("totalBookings").default(0).notNull(),
  totalSpent: decimal("totalSpent", { precision: 10, scale: 2 }).default("0"),
  lastBookingAt: timestamp("lastBookingAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;
