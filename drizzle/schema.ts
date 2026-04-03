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
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Fiscal regime (REAV module)
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general_21", "mixed"]).default("general_21").notNull(),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("actividad").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Supplier / Liquidaciones module
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
  // Time slots module (optional, retrocompatible)
  hasTimeSlots: boolean("has_time_slots").default(false).notNull(),
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
    fiscalRegime?: "reav" | "general_21";
    productId?: number;
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
  // Justificante de pago por transferencia bancaria
  transferProofUrl: text("transfer_proof_url"),
  transferProofKey: text("transfer_proof_key"),
  transferConfirmedAt: timestamp("transfer_confirmed_at"),
  transferConfirmedBy: varchar("transfer_confirmed_by", { length: 255 }),
  paymentMethod: mysqlEnum("payment_method", ["redsys", "transferencia", "efectivo", "otro"]),
  paymentLinkToken: varchar("paymentLinkToken", { length: 128 }).unique(),
  paymentLinkUrl: text("paymentLinkUrl"),
  paidAt: timestamp("paidAt"),
  notes: text("notes"),
  isAutoGenerated: boolean("isAutoGenerated").default(false).notNull(),
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
  itemsJson: json("itemsJson").$type<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21"; productId?: number }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  taxAmount: decimal("taxAmount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  status: mysqlEnum("status", ["generada", "enviada", "cobrada", "anulada", "abonada"]).default("generada").notNull(),
  invoiceType: mysqlEnum("invoiceType", ["factura", "abono"]).default("factura").notNull(),
  // Payment traceability
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro"]).default("redsys"),
  paymentValidatedBy: int("paymentValidatedBy"),   // userId who validated manual payment
  paymentValidatedAt: timestamp("paymentValidatedAt"),
  transferProofUrl: text("transferProofUrl"),       // S3 URL of bank transfer proof
  transferProofKey: text("transferProofKey"),
  isAutomatic: boolean("isAutomatic").default(true).notNull(), // true = Redsys, false = manual
  // Credit note (abono) fields
  creditNoteForId: int("creditNoteForId"),          // FK to original invoice if this is a credit note
  creditNoteReason: text("creditNoteReason"),
  // Email tracking
  sentAt: timestamp("sentAt"),
  lastSentAt: timestamp("lastSentAt"),
  sentCount: int("sentCount").default(0).notNull(),
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
  // Link to source reservation (when auto-created from a paid reservation)
  reservationId: int("reservationId"),
  sourceChannel: mysqlEnum("sourceChannel", ["manual", "redsys", "transferencia", "efectivo", "otro"]).default("manual"),
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
  // Libro maestro ampliado
  clientName:      varchar("clientName",      { length: 200 }),
  clientEmail:     varchar("clientEmail",     { length: 200 }),
  clientPhone:     varchar("clientPhone",     { length: 50 }),
  productName:     varchar("productName",     { length: 300 }),
  operativeCenter: varchar("operativeCenter", { length: 100 }),
  sellerUserId:    int("sellerUserId"),
  sellerName:      varchar("sellerName",      { length: 200 }),
  saleChannel:     mysqlEnum("saleChannel", ["tpv", "online", "crm", "admin", "delegado"]).default("admin"),
  taxBase:         decimal("taxBase",         { precision: 10, scale: 2 }).default("0"),
  taxAmount:       decimal("taxAmount",       { precision: 10, scale: 2 }).default("0"),
  reavMargin:      decimal("reavMargin",      { precision: 10, scale: 2 }).default("0"),
  fiscalRegime:    mysqlEnum("fiscalRegime_tx", ["reav", "general_21", "mixed"]).default("general_21"),
  tpvSaleId:       int("tpvSaleId"),
  reservationId:   int("reservationId_tx"),
  invoiceNumber:   varchar("invoiceNumber",   { length: 32 }),
  reservationRef:  varchar("reservationRef",  { length: 32 }),
  operationStatus: mysqlEnum("operationStatus", ["confirmada", "anulada", "reembolsada"]).default("confirmada"),
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
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 50 }),
  merchantOrder: varchar("merchant_order", { length: 30 }).notNull().unique(),
  redsysResponse: text("redsys_response"),
  redsysDsResponse: varchar("redsys_ds_response", { length: 10 }),
  notes: text("notes"),
  quoteId: int("quote_id"),
  quoteSource: varchar("quoteSource", { length: 32 }), // 'presupuesto' | 'directo'
  // Invoice link
  invoiceId: int("invoiceId"),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }),
  // Payment details
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro"]),
  paymentValidatedBy: int("paymentValidatedBy"),
  paymentValidatedAt: bigint("paymentValidatedAt", { mode: "number" }),
  transferProofUrl: text("transferProofUrl"),
  // Channel & metadata
  channel: mysqlEnum("channel", [
    "ONLINE_DIRECTO", "ONLINE_ASISTIDO", "VENTA_DELEGADA", "TPV_FISICO",
    "PARTNER", "MANUAL", "API",
    // legacy values kept for backward compat
    "web", "crm", "telefono", "email", "otro", "tpv", "groupon"
  ]).default("ONLINE_DIRECTO"),
  channelDetail: varchar("channel_detail", { length: 128 }), // e.g. "Groupon", "Smartbox"
  originSource: varchar("origin_source", { length: 64 }), // 'coupon_redemption' | null
  platformName: varchar("platform_name", { length: 128 }), // Nombre de plataforma (Groupon, Smartbox, etc.)
  redemptionId: int("redemption_id"), // FK → coupon_redemptions.id
  // ─── Separación de estados (Fase 3) ─────────────────────────────────────────
  statusReservation: mysqlEnum("status_reservation", [
    "PENDIENTE_CONFIRMACION", "CONFIRMADA", "EN_CURSO", "FINALIZADA", "NO_SHOW", "ANULADA"
  ]).default("PENDIENTE_CONFIRMACION"),
  statusPayment: mysqlEnum("status_payment", [
    "PENDIENTE", "PAGO_PARCIAL", "PENDIENTE_VALIDACION", "PAGADO"
  ]).default("PENDIENTE"),
  // ─── Cambio de fecha ──────────────────────────────────────────────────────
  dateChangedReason: text("date_changed_reason"),
  dateModified: boolean("date_modified").default(false),
  // ─── Trazabilidad ─────────────────────────────────────────────────────────
  changesLog: json("changes_log").$type<Array<{
    ts: number;
    actor: string;
    action: string;
    from?: string;
    to?: string;
    reason?: string;
  }>>().default([]),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  paidAt: bigint("paid_at", { mode: "number" }),
  // Time slots (optional, retrocompatible - null = no time slot required)
  selectedTimeSlotId: int("selected_time_slot_id"),
  selectedTime: varchar("selected_time", { length: 10 }),
  // REAV link
  reavExpedientId: int("reav_expedient_id"),
  // Número de referencia interna (RES-2026-XXXX)
  reservationNumber: varchar("reservation_number", { length: 32 }),
});

// ─── PRODUCT TIME SLOTS ────────────────────────────────────────────────────────

export const productTimeSlots = mysqlTable("product_time_slots", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  type: mysqlEnum("type", ["fixed", "flexible", "range"]).notNull().default("fixed"),
  label: varchar("label", { length: 128 }).notNull(),
  startTime: varchar("start_time", { length: 10 }),   // e.g. "10:00"
  endTime: varchar("end_time", { length: 10 }),         // e.g. "14:00"
  daysOfWeek: varchar("days_of_week", { length: 32 }), // e.g. "1,2,3,4,5" (Mon-Fri)
  capacity: int("capacity"),
  priceOverride: decimal("price_override", { precision: 10, scale: 2 }),
  sortOrder: int("sort_order").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProductTimeSlot = typeof productTimeSlots.$inferSelect;
export type InsertProductTimeSlot = typeof productTimeSlots.$inferInsert;

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
   discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Fiscal regime (REAV module)
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general_21", "mixed"]).default("general_21").notNull(),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("pack").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Supplier / Liquidaciones module
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
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
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountLabel: varchar("discountLabel", { length: 128 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Régimen fiscal
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general_21", "mixed"]).default("general_21").notNull(),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("alojamiento").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Proveedor y liquidaciones
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
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
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountLabel: varchar("discountLabel", { length: 128 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Régimen fiscal
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general_21", "mixed"]).default("general_21").notNull(),
  productType: mysqlEnum("productType", ["own", "semi_own", "third_party", "actividad", "alojamiento", "restauracion", "transporte", "pack"]).default("actividad").notNull(),
  providerPercent: decimal("providerPercent", { precision: 5, scale: 2 }).default("0"),
  agencyMarginPercent: decimal("agencyMarginPercent", { precision: 5, scale: 2 }).default("0"),
  // Proveedor y liquidaciones
  supplierId: int("supplierId"),
  supplierCommissionPercent: decimal("supplierCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  supplierCostType: mysqlEnum("supplierCostType", ["comision_sobre_venta", "coste_fijo", "porcentaje_margen", "hibrido"]).default("comision_sobre_venta"),
  settlementFrequency: mysqlEnum("settlementFrequency", ["semanal", "quincenal", "mensual", "manual"]).default("manual"),
  isSettlable: boolean("isSettlable").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(false).notNull(),
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

// ─── REAV MODULE ─────────────────────────────────────────────────────────────

/**
 * Expediente REAV: se crea automáticamente cuando se emite una factura con
 * al menos una línea en régimen REAV. Agrupa toda la documentación fiscal,
 * los costes internos y el estado del expediente.
 */
export const reavExpedients = mysqlTable("reav_expedients", {
  id: int("id").autoincrement().primaryKey(),
  expedientNumber: varchar("expedientNumber", { length: 32 }).notNull().unique(), // EXP-REAV-2026-0001
  // Relaciones
  invoiceId: int("invoiceId"),          // Factura que originó el expediente
  reservationId: int("reservationId"),  // Reserva asociada (si existe)
  clientId: int("clientId"),            // Cliente
  agentId: int("agentId"),              // Agente responsable
  // Datos del servicio
  serviceDescription: text("serviceDescription"),
  serviceDate: varchar("serviceDate", { length: 10 }),   // YYYY-MM-DD
  serviceEndDate: varchar("serviceEndDate", { length: 10 }),
  destination: varchar("destination", { length: 256 }),
  numberOfPax: int("numberOfPax").default(1),
  // Importes (calculados al crear / recalculados al introducir costes reales)
  saleAmountTotal: decimal("saleAmountTotal", { precision: 10, scale: 2 }).default("0"),
  providerCostEstimated: decimal("providerCostEstimated", { precision: 10, scale: 2 }).default("0"),
  providerCostReal: decimal("providerCostReal", { precision: 10, scale: 2 }).default("0"),
  agencyMarginEstimated: decimal("agencyMarginEstimated", { precision: 10, scale: 2 }).default("0"),
  agencyMarginReal: decimal("agencyMarginReal", { precision: 10, scale: 2 }).default("0"),
  reavTaxBase: decimal("reavTaxBase", { precision: 10, scale: 2 }).default("0"),    // margen bruto tributable
  reavTaxAmount: decimal("reavTaxAmount", { precision: 10, scale: 2 }).default("0"), // 21% sobre margen
  // Estado fiscal
  fiscalStatus: mysqlEnum("fiscalStatus", [
    "pendiente_documentacion",
    "documentacion_completa",
    "en_revision",
    "cerrado",
    "anulado",
  ]).default("pendiente_documentacion").notNull(),
  // Estado operativo
  operativeStatus: mysqlEnum("operativeStatus", [
    "abierto",
    "en_proceso",
    "cerrado",
    "anulado",
  ]).default("abierto").notNull(),
  // Datos del cliente (copiados en el momento de creación para trazabilidad)
  clientName: varchar("clientName", { length: 256 }),
  clientEmail: varchar("clientEmail", { length: 256 }),
  clientPhone: varchar("clientPhone", { length: 64 }),
  clientDni: varchar("clientDni", { length: 64 }),
  clientAddress: varchar("clientAddress", { length: 512 }),
  // Canal de origen y referencia
  channel: mysqlEnum("channel", ["tpv", "online", "crm", "manual"]).default("manual"),
  sourceRef: varchar("sourceRef", { length: 128 }), // Nº ticket, factura, presupuesto...
  tpvSaleId: int("tpvSaleId"),
  quoteId: int("quoteId"),
  // Notas internas
  internalNotes: text("internalNotes"),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReavExpedient = typeof reavExpedients.$inferSelect;
export type InsertReavExpedient = typeof reavExpedients.$inferInsert;

/**
 * Documentos del expediente REAV.
 * Bloque 2: documentos del cliente (facturas emitidas, contratos, vouchers)
 * Bloque 3: documentos del proveedor (facturas recibidas, confirmaciones)
 */
export const reavDocuments = mysqlTable("reav_documents", {
  id: int("id").autoincrement().primaryKey(),
  expedientId: int("expedientId").notNull(),
  side: mysqlEnum("side", ["client", "provider"]).notNull(), // Bloque 2 o Bloque 3
  docType: mysqlEnum("docType", [
    "factura_emitida",
    "factura_recibida",
    "contrato",
    "voucher",
    "confirmacion_proveedor",
    "otro",
  ]).default("otro").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileSize: int("fileSize"),
  notes: text("notes"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReavDocument = typeof reavDocuments.$inferSelect;
export type InsertReavDocument = typeof reavDocuments.$inferInsert;

/**
 * Costes internos del expediente REAV (Bloque 4: panel económico).
 * Cada línea representa un coste real de proveedor.
 */
export const reavCosts = mysqlTable("reav_costs", {
  id: int("id").autoincrement().primaryKey(),
  expedientId: int("expedientId").notNull(),
  description: varchar("description", { length: 256 }).notNull(),
  providerName: varchar("providerName", { length: 256 }),
  providerNif: varchar("providerNif", { length: 64 }),
  invoiceRef: varchar("invoiceRef", { length: 128 }),
  invoiceDate: varchar("invoiceDate", { length: 10 }), // YYYY-MM-DD
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  category: mysqlEnum("category", [
    "transporte",
    "alojamiento",
    "actividad",
    "restauracion",
    "guia",
    "seguro",
    "otros",
  ]).default("otros").notNull(),
  isPaid: boolean("isPaid").default(false).notNull(),
  paidAt: timestamp("paidAt"),
  // Si el importe incluye IVA (true) o es neto sin IVA (false)
  includesVat: boolean("includes_vat").default(true).notNull(),
  notes: text("notes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReavCost = typeof reavCosts.$inferSelect;
export type InsertReavCost = typeof reavCosts.$inferInsert;

// ─── SUPPLIERS (Proveedores) ──────────────────────────────────────────────────

/**
 * Tabla de proveedores del sistema.
 * Contiene datos fiscales, comerciales, bancarios y operativos.
 */
export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  // Datos fiscales
  fiscalName: varchar("fiscalName", { length: 256 }).notNull(),
  commercialName: varchar("commercialName", { length: 256 }),
  nif: varchar("nif", { length: 32 }),
  fiscalAddress: text("fiscalAddress"),
  // Datos de contacto
  adminEmail: varchar("adminEmail", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  contactPerson: varchar("contactPerson", { length: 256 }),
  // Datos bancarios
  iban: varchar("iban", { length: 64 }),
  paymentMethod: mysqlEnum("paymentMethod", [
    "transferencia",
    "confirming",
    "efectivo",
    "compensacion",
  ]).default("transferencia").notNull(),
  // Datos operativos
  standardCommissionPercent: decimal("standardCommissionPercent", { precision: 5, scale: 2 }).default("0.00"),
  // Configuración de liquidaciones
  settlementFrequency: mysqlEnum("settlementFrequency", [
    "quincenal",
    "mensual",
    "trimestral",
    "semestral",
    "anual",
    "manual",
  ]).default("manual").notNull(),
  settlementDayOfMonth: int("settlementDayOfMonth").default(1), // Día del mes para liquidar (1-28)
  autoGenerateSettlements: boolean("autoGenerateSettlements").default(false).notNull(),
  internalNotes: text("internalNotes"),
  status: mysqlEnum("status", ["activo", "inactivo", "bloqueado"]).default("activo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ─── SUPPLIER SETTLEMENTS (Liquidaciones) ────────────────────────────────────

/**
 * Cabecera de cada liquidación generada para un proveedor.
 */
export const supplierSettlements = mysqlTable("supplier_settlements", {
  id: int("id").autoincrement().primaryKey(),
  settlementNumber: varchar("settlementNumber", { length: 64 }).notNull().unique(),
  supplierId: int("supplierId").notNull(),
  // Periodo liquidado
  periodFrom: varchar("periodFrom", { length: 10 }).notNull(), // YYYY-MM-DD
  periodTo: varchar("periodTo", { length: 10 }).notNull(),     // YYYY-MM-DD
  // Totales calculados
  grossAmount: decimal("grossAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  commissionAmount: decimal("commissionAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  netAmountProvider: decimal("netAmountProvider", { precision: 12, scale: 2 }).default("0.00").notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  // Workflow de estados
  status: mysqlEnum("status", [
    "borrador",
    "emitida",
    "pendiente_abono",
    "abonada",
    "incidencia",
    "recalculada",
  ]).default("emitida").notNull(),
  // Trazabilidad
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  sentAt: timestamp("sentAt"),
  paidAt: timestamp("paidAt"),
  internalNotes: text("internalNotes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SupplierSettlement = typeof supplierSettlements.$inferSelect;
export type InsertSupplierSettlement = typeof supplierSettlements.$inferInsert;

// ─── SETTLEMENT LINES (Líneas de liquidación) ────────────────────────────────

/**
 * Cada línea representa una reserva/servicio incluido en la liquidación.
 */
export const settlementLines = mysqlTable("settlement_lines", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  reservationId: int("reservationId"),
  invoiceId: int("invoiceId"),
  productId: int("productId"),
  productName: varchar("productName", { length: 256 }),
  serviceDate: varchar("serviceDate", { length: 10 }), // YYYY-MM-DD
  paxCount: int("paxCount").default(1).notNull(),
  // Importes
  saleAmount: decimal("saleAmount", { precision: 12, scale: 2 }).notNull(),       // Importe cobrado al cliente
  commissionPercent: decimal("commissionPercent", { precision: 5, scale: 2 }).notNull(), // % comisión Nayade
  commissionAmount: decimal("commissionAmount", { precision: 12, scale: 2 }).notNull(),  // Importe comisión
  netAmountProvider: decimal("netAmountProvider", { precision: 12, scale: 2 }).notNull(), // Neto proveedor
  costType: mysqlEnum("costType", [
    "comision_sobre_venta",
    "coste_fijo",
    "porcentaje_margen",
    "hibrido",
  ]).default("comision_sobre_venta").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementLine = typeof settlementLines.$inferSelect;
export type InsertSettlementLine = typeof settlementLines.$inferInsert;

// ─── SETTLEMENT DOCUMENTS (Documentos adjuntos) ──────────────────────────────

export const settlementDocuments = mysqlTable("settlement_documents", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  docType: mysqlEnum("docType", [
    "factura_recibida",
    "contrato",
    "justificante_pago",
    "email",
    "acuerdo_comision",
    "otro",
  ]).default("otro").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  notes: text("notes"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementDocument = typeof settlementDocuments.$inferSelect;
export type InsertSettlementDocument = typeof settlementDocuments.$inferInsert;

// ─── SETTLEMENT STATUS LOG (Historial de estados) ────────────────────────────

export const settlementStatusLog = mysqlTable("settlement_status_log", {
  id: int("id").autoincrement().primaryKey(),
  settlementId: int("settlementId").notNull(),
  fromStatus: varchar("fromStatus", { length: 64 }),
  toStatus: varchar("toStatus", { length: 64 }).notNull(),
  changedBy: int("changedBy"),
  changedByName: varchar("changedByName", { length: 256 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type SettlementStatusLog = typeof settlementStatusLog.$inferSelect;
export type InsertSettlementStatusLog = typeof settlementStatusLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// TPV — TERMINAL PUNTO DE VENTA
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CASH REGISTERS (Cajas físicas) ──────────────────────────────────────────
export const cashRegisters = mysqlTable("cash_registers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  location: varchar("location", { length: 200 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type CashRegister = typeof cashRegisters.$inferSelect;

// ─── CASH SESSIONS (Turnos de caja) ──────────────────────────────────────────
export const cashSessions = mysqlTable("cash_sessions", {
  id: int("id").autoincrement().primaryKey(),
  registerId: int("registerId").notNull(),
  cashierUserId: int("cashierUserId").notNull(),
  cashierName: varchar("cashierName", { length: 200 }).notNull(),
  openingAmount: decimal("openingAmount", { precision: 10, scale: 2 }).notNull().default("0"),
  closingAmount: decimal("closingAmount", { precision: 10, scale: 2 }),
  countedCash: decimal("countedCash", { precision: 10, scale: 2 }),
  cashDifference: decimal("cashDifference", { precision: 10, scale: 2 }),
  totalCash: decimal("totalCash", { precision: 10, scale: 2 }).default("0"),
  totalCard: decimal("totalCard", { precision: 10, scale: 2 }).default("0"),
  totalBizum: decimal("totalBizum", { precision: 10, scale: 2 }).default("0"),
  totalMixed: decimal("totalMixed", { precision: 10, scale: 2 }).default("0"),
  totalManualOut: decimal("totalManualOut", { precision: 10, scale: 2 }).default("0"),
  totalManualIn: decimal("totalManualIn", { precision: 10, scale: 2 }).default("0"),
  status: mysqlEnum("status_cs", ["open", "closed"]).default("open").notNull(),
  notes: text("notes"),
  openedAt: bigint("openedAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  closedAt: bigint("closedAt", { mode: "number" }),
});
export type CashSession = typeof cashSessions.$inferSelect;

// ─── CASH MOVEMENTS (Movimientos manuales) ───────────────────────────────────
export const cashMovements = mysqlTable("cash_movements", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  type: mysqlEnum("type_cm", ["out", "in"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  cashierName: varchar("cashierName", { length: 200 }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type CashMovement = typeof cashMovements.$inferSelect;

// ─── TPV SALES (Ventas TPV) ───────────────────────────────────────────────────
export const tpvSales = mysqlTable("tpv_sales", {
  id: int("id").autoincrement().primaryKey(),
  ticketNumber: varchar("ticketNumber", { length: 50 }).notNull().unique(),
  sessionId: int("sessionId").notNull(),
  reservationId: int("reservationId"),
  invoiceId: int("invoiceId"),
  customerName: varchar("customerName", { length: 200 }),
  customerEmail: varchar("customerEmail", { length: 200 }),
  customerPhone: varchar("customerPhone", { length: 50 }),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).default("0"),
  discountReason: varchar("discountReason", { length: 200 }),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  status: mysqlEnum("status_ts", ["pending", "paid", "cancelled", "refunded"]).default("pending").notNull(),
  notes: text("notes"),
  serviceDate: varchar("serviceDate", { length: 10 }), // YYYY-MM-DD fecha de la actividad
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
  paidAt: bigint("paidAt", { mode: "number" }),
  // Fiscalidad
  taxBase:        decimal("taxBase",        { precision: 10, scale: 2 }).default("0"),
  taxAmount:      decimal("taxAmount",      { precision: 10, scale: 2 }).default("0"),
  taxRate:        decimal("taxRate",        { precision: 5,  scale: 2 }).default("21"),
  reavMargin:     decimal("reavMargin",     { precision: 10, scale: 2 }).default("0"),
  reavCost:       decimal("reavCost",       { precision: 10, scale: 2 }).default("0"),
  reavTax:        decimal("reavTax",        { precision: 10, scale: 2 }).default("0"),
  fiscalSummary:  varchar("fiscalSummary",  { length: 20 }).default("mixed"),
  // Canal y vendedor
  saleChannel:    varchar("saleChannel",    { length: 20 }).default("tpv"),
  sellerUserId:   int("sellerUserId"),
  sellerName:     varchar("sellerName",     { length: 200 }),
  operativeCenter:varchar("operativeCenter",{ length: 100 }),
});
export type TpvSale = typeof tpvSales.$inferSelect;

// ─── TPV SALE ITEMS (Líneas de venta) ────────────────────────────────────────
export const tpvSaleItems = mysqlTable("tpv_sale_items", {
  id: int("id").autoincrement().primaryKey(),
  saleId: int("saleId").notNull(),
  productType: mysqlEnum("productType_tsi", ["experience", "pack", "spa", "hotel", "restaurant", "extra"]).notNull(),
  productId: int("productId").notNull(),
  productName: varchar("productName", { length: 300 }).notNull(),
  quantity: int("quantity").notNull().default(1),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  discountPercent: decimal("discountPercent_tsi", { precision: 5, scale: 2 }).default("0"),
  subtotal: decimal("subtotal_tsi", { precision: 10, scale: 2 }).notNull(),
  eventDate: varchar("eventDate", { length: 10 }),
  eventTime: varchar("eventTime", { length: 10 }),
  participants: int("participants").default(1),
  notes: varchar("notes_tsi", { length: 500 }),
  // Fiscalidad por línea
  fiscalRegime: mysqlEnum("fiscalRegime_tsi", ["reav", "general_21", "mixed"]).default("general_21"),
  taxBase:      decimal("taxBase_tsi",   { precision: 10, scale: 2 }).default("0"),
  taxAmount:    decimal("taxAmount_tsi", { precision: 10, scale: 2 }).default("0"),
  taxRate:      decimal("taxRate_tsi",   { precision: 5,  scale: 2 }).default("21"),
  reavCost:     decimal("reavCost_tsi",  { precision: 10, scale: 2 }).default("0"),
  reavMargin:   decimal("reavMargin_tsi",{ precision: 10, scale: 2 }).default("0"),
  reavTax:      decimal("reavTax_tsi",   { precision: 10, scale: 2 }).default("0"),
});
export type TpvSaleItem = typeof tpvSaleItems.$inferSelect;

// ─── TPV SALE PAYMENTS (Subpagos) ────────────────────────────────────────────
export const tpvSalePayments = mysqlTable("tpv_sale_payments", {
  id: int("id").autoincrement().primaryKey(),
  saleId: int("saleId").notNull(),
  payerName: varchar("payerName", { length: 200 }),
  method: mysqlEnum("method_tsp", ["cash", "card", "bizum", "other"]).notNull(),
  amount: decimal("amount_tsp", { precision: 10, scale: 2 }).notNull(),
  amountTendered: decimal("amountTendered", { precision: 10, scale: 2 }),
  changeGiven: decimal("changeGiven", { precision: 10, scale: 2 }).default("0"),
  status: mysqlEnum("status_tsp", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  reference: varchar("reference", { length: 200 }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now()),
});
export type TpvSalePayment = typeof tpvSalePayments.$inferSelect;

// ─── DISCOUNT CODES ──────────────────────────────────────────────────────────
export const discountCodes = mysqlTable("discount_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  // Tipo de descuento: percent = porcentaje, fixed = importe fijo en euros
  discountType: mysqlEnum("discount_type", ["percent", "fixed"]).default("percent").notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
  expiresAt: timestamp("expires_at"),
  status: mysqlEnum("status", ["active", "inactive", "expired"]).default("active").notNull(),
  maxUses: int("max_uses"),
  currentUses: int("current_uses").default(0).notNull(),
  observations: text("observations"),
  // Origen del código: manual (creado por admin), voucher (bono compensatorio de anulación)
  origin: mysqlEnum("origin", ["manual", "voucher"]).default("manual").notNull(),
  // FK al bono compensatorio que originó este código (solo si origin=voucher)
  compensationVoucherId: int("compensation_voucher_id"),
  // Email del cliente al que se emitió (para uso exclusivo)
  clientEmail: varchar("client_email", { length: 256 }),
  clientName: varchar("client_name", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type DiscountCode = typeof discountCodes.$inferSelect;
export type InsertDiscountCode = typeof discountCodes.$inferInsert;

// ─── DISCOUNT CODE USES (Trazabilidad) ───────────────────────────────────────
export const discountCodeUses = mysqlTable("discount_code_uses", {
  id: int("id").autoincrement().primaryKey(),
  discountCodeId: int("discount_code_id").notNull(),
  code: varchar("code_use", { length: 50 }).notNull(),
  discountPercent: decimal("discount_percent_use", { precision: 5, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),
  originalAmount: decimal("original_amount_use", { precision: 10, scale: 2 }).notNull(),
  finalAmount: decimal("final_amount", { precision: 10, scale: 2 }).notNull(),
  channel: mysqlEnum("channel_dcu", ["tpv", "online", "crm", "delegated"]).notNull(),
  reservationId: int("reservation_id"),
  tpvSaleId: int("tpv_sale_id"),
  appliedByUserId: varchar("applied_by_user_id", { length: 100 }),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
});
export type DiscountCodeUse = typeof discountCodeUses.$inferSelect;

// ─── LEGO PACKS ──────────────────────────────────────────────────────────────
// Un Lego Pack es un producto compuesto preconfigurado exclusivamente por el
// administrador. El cliente solo puede activar/desactivar líneas opcionales.
export const legoPacks = mysqlTable("lego_packs", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  subtitle: varchar("subtitle", { length: 512 }),
  shortDescription: text("shortDescription"),
  description: text("description"),
  // Galería
  coverImageUrl: text("coverImageUrl"),
  image1: text("image1"),
  image2: text("image2"),
  image3: text("image3"),
  image4: text("image4"),
  gallery: json("gallery").$type<string[]>().default([]),
  // Comercial
  badge: varchar("badge", { length: 64 }),
  priceLabel: varchar("priceLabel", { length: 128 }),
  // Categorías / filtros
  categoryId: int("categoryId"),
  category: mysqlEnum("category", ["dia", "escolar", "empresa", "estancia"]).default("dia").notNull(),
  targetAudience: varchar("targetAudience", { length: 256 }),
  // Disponibilidad
  availabilityMode: mysqlEnum("availabilityMode", ["strict", "flexible"]).default("strict").notNull(),
  // Descuento promocional
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }),
  discountExpiresAt: timestamp("discountExpiresAt"),
  // Estado
  isActive: boolean("isActive").default(true).notNull(),
  isPublished: boolean("isPublished").default(false).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  isPresentialSale: boolean("isPresentialSale").default(true).notNull(),
  isOnlineSale: boolean("isOnlineSale").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  // SEO
  metaTitle: varchar("metaTitle", { length: 256 }),
  metaDescription: text("metaDescription"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LegoPack = typeof legoPacks.$inferSelect;
export type InsertLegoPack = typeof legoPacks.$inferInsert;

// ─── LEGO PACK LINES (Líneas de composición) ─────────────────────────────────
// Cada línea referencia un producto simple (experience o pack) del catálogo.
// Hereda fiscalidad, proveedor, variables y disponibilidad del producto origen.
export const legoPackLines = mysqlTable("lego_pack_lines", {
  id: int("id").autoincrement().primaryKey(),
  legoPackId: int("legoPackId").notNull(),
  // Producto origen
  sourceType: mysqlEnum("sourceType", ["experience", "pack"]).notNull(),
  sourceId: int("sourceId").notNull(),
  // Metadatos de línea
  internalName: varchar("internalName", { length: 256 }),
  groupLabel: varchar("groupLabel", { length: 128 }),   // ej: "alojamiento", "experiencia", "spa"
  sortOrder: int("sortOrder").default(0).notNull(),
  // Flags de comportamiento
  isActive: boolean("isActive").default(true).notNull(),
  isRequired: boolean("isRequired").default(true).notNull(),    // obligatorio: no se puede quitar
  isOptional: boolean("isOptional").default(false).notNull(),   // opcional: cliente puede quitar
  isClientEditable: boolean("isClientEditable").default(false).notNull(), // cliente puede quitar si es opcional
  isClientVisible: boolean("isClientVisible").default(true).notNull(),
  // Cantidad
  defaultQuantity: int("defaultQuantity").default(1).notNull(),
  isQuantityEditable: boolean("isQuantityEditable").default(false).notNull(),
  // Descuento específico por pack
  discountType: mysqlEnum("discountType", ["percent", "fixed"]).default("percent").notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).default("0").notNull(),
  // Precio override para líneas de alojamiento u otros productos sin precio estático
  // Solo visual — NO afecta al cálculo final del carrito ni a reservas reales
  overridePrice: decimal("overridePrice", { precision: 10, scale: 2 }),
  overridePriceLabel: varchar("overridePriceLabel", { length: 64 }),  // ej: "/ noche", "/ persona", "estimado"
  // Texto informativo para frontend
  frontendNote: text("frontendNote"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LegoPackLine = typeof legoPackLines.$inferSelect;
export type InsertLegoPackLine = typeof legoPackLines.$inferInsert;

// ─── LEGO PACK SNAPSHOTS (Snapshot por operación) ────────────────────────────
// Guarda el estado exacto del pack en el momento de la operación.
// Las operaciones históricas no se alteran si el pack cambia en catálogo.
export const legoPackSnapshots = mysqlTable("lego_pack_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  legoPackId: int("legoPackId").notNull(),
  legoPackTitle: varchar("legoPackTitle", { length: 256 }).notNull(),
  // Referencia a la operación
  operationType: mysqlEnum("operationType", ["reservation", "quote", "tpv_sale", "invoice"]).notNull(),
  operationId: int("operationId").notNull(),
  // Snapshot completo de líneas activas en JSON
  linesSnapshot: json("linesSnapshot").$type<{
    lineId: number;
    sourceType: string;
    sourceId: number;
    sourceName: string;
    internalName?: string;
    groupLabel?: string;
    isRequired: boolean;
    isOptional: boolean;
    isActive: boolean;         // estado elegido por cliente/cajero
    quantity: number;
    basePrice: number;
    discountType: string;
    discountValue: number;
    finalPrice: number;
    fiscalRegime: string;      // heredado del producto origen
    supplierId?: number;
    supplierName?: string;
    supplierCommissionPercent?: number;
    parentLegoPackId: number;
    parentLegoPackName: string;
  }[]>().notNull(),
  // Totales calculados
  totalOriginal: decimal("totalOriginal", { precision: 12, scale: 2 }).notNull(),
  totalDiscount: decimal("totalDiscount", { precision: 12, scale: 2 }).notNull(),
  totalFinal: decimal("totalFinal", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LegoPackSnapshot = typeof legoPackSnapshots.$inferSelect;
export type InsertLegoPackSnapshot = typeof legoPackSnapshots.$inferInsert;

// ─── FINANCIAL MODULE — GASTOS & CUENTA DE RESULTADOS ────────────────────────

// ── Centros de coste ──────────────────────────────────────────────────────────
export const costCenters = mysqlTable("cost_centers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CostCenter = typeof costCenters.$inferSelect;
export type InsertCostCenter = typeof costCenters.$inferInsert;

// ── Categorías de gasto ───────────────────────────────────────────────────────
export const expenseCategories = mysqlTable("expense_categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = typeof expenseCategories.$inferInsert;

// ── Proveedores de gasto ──────────────────────────────────────────────────────
export const expenseSuppliers = mysqlTable("expense_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  fiscalName: varchar("fiscalName", { length: 256 }),
  vatNumber: varchar("vatNumber", { length: 32 }),
  address: text("address"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  iban: varchar("iban", { length: 64 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ExpenseSupplier = typeof expenseSuppliers.$inferSelect;
export type InsertExpenseSupplier = typeof expenseSuppliers.$inferInsert;

// ── Gastos ────────────────────────────────────────────────────────────────────
export const expenses = mysqlTable("expenses", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 20 }).notNull(),
  concept: varchar("concept", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: int("categoryId").notNull(),
  supplierId: int("supplierId"),
  costCenterId: int("costCenterId").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", [
    "cash", "card", "transfer", "direct_debit", "tpv_cash",
  ]).notNull().default("transfer"),
  status: mysqlEnum("status", ["pending", "justified", "accounted"]).notNull().default("pending"),
  reservationId: int("reservationId"),
  productId: int("productId"),
  notes: text("notes"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = typeof expenses.$inferInsert;

// ── Adjuntos de gasto ─────────────────────────────────────────────────────────
export const expenseFiles = mysqlTable("expense_files", {
  id: int("id").autoincrement().primaryKey(),
  expenseId: int("expenseId").notNull(),
  filePath: varchar("filePath", { length: 1024 }).notNull(),
  fileName: varchar("fileName", { length: 256 }),
  mimeType: varchar("mimeType", { length: 128 }),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});
export type ExpenseFile = typeof expenseFiles.$inferSelect;
export type InsertExpenseFile = typeof expenseFiles.$inferInsert;

// ── Gastos recurrentes ────────────────────────────────────────────────────────
export const recurringExpenses = mysqlTable("recurring_expenses", {
  id: int("id").autoincrement().primaryKey(),
  concept: varchar("concept", { length: 512 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  categoryId: int("categoryId").notNull(),
  costCenterId: int("costCenterId").notNull(),
  supplierId: int("supplierId"),
  recurrenceType: mysqlEnum("recurrenceType", ["monthly", "weekly", "yearly"]).notNull().default("monthly"),
  nextExecutionDate: varchar("nextExecutionDate", { length: 20 }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type InsertRecurringExpense = typeof recurringExpenses.$inferInsert;

// ─── TICKETING / CUPONES GROUPON ─────────────────────────────────────────────

// Catálogo de productos ticketing (ocultos en frontend normal)
export const ticketingProducts = mysqlTable("ticketing_products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull().default("Groupon"),
  linkedProductId: int("linkedProductId"), // → experiences.id
  stationsAllowed: json("stationsAllowed"), // array de strings
  rules: text("rules"),
  commission: decimal("commission", { precision: 5, scale: 2 }).default("20.00"),
  expectedPrice: decimal("expectedPrice", { precision: 10, scale: 2 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TicketingProduct = typeof ticketingProducts.$inferSelect;
export type InsertTicketingProduct = typeof ticketingProducts.$inferInsert;

// Solicitudes de canje de cupones
export const couponRedemptions = mysqlTable("coupon_redemptions", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull().default("Groupon"),
  productTicketingId: int("productTicketingId"), // → ticketingProducts.id
  productRealId: int("productRealId"), // → experiences.id (asignado tras validación)

  // Datos cliente
  customerName: varchar("customerName", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 32 }),

  // Datos cupón
  couponCode: varchar("couponCode", { length: 128 }).notNull(),
  securityCode: varchar("securityCode", { length: 128 }),
  attachmentUrl: text("attachmentUrl"), // S3 URL del PDF/imagen del cupón

  // Datos de experiencia solicitada
  requestedDate: varchar("requestedDate", { length: 20 }),
  station: varchar("station", { length: 128 }),
  participants: int("participants").default(1),
  children: int("children").default(0),
  comments: text("comments"),

  // Estados
  statusOperational: mysqlEnum("statusOperational", [
    "recibido", "pendiente", "reserva_generada"
  ]).default("recibido").notNull(),
  statusFinancial: mysqlEnum("statusFinancial", [
    "pendiente_canjear", "canjeado", "incidencia"
  ]).default("pendiente_canjear").notNull(),

  // OCR
  ocrConfidenceScore: int("ocrConfidenceScore"), // 0-100
  ocrStatus: mysqlEnum("ocrStatus", ["alta", "media", "baja", "conflicto"]),
  ocrRawData: json("ocrRawData"), // datos extraídos por OCR

  // Antifraude
  duplicateFlag: boolean("duplicateFlag").default(false).notNull(),
  duplicateNotes: text("duplicateNotes"),

  // Conciliación financiera
  realAmount: decimal("realAmount", { precision: 10, scale: 2 }),
  settlementJustificantUrl: text("settlementJustificantUrl"),
  settledAt: timestamp("settledAt"),

  // Conversión a reserva
  reservationId: int("reservationId"),           // → reservations.id si se convirtió
  platformProductId: int("platformProductId"),   // → platform_products.id (producto de plataforma usado en la conversión)
  settlementId: int("settlementId"),             // → platform_settlements.id (liquidación a la que pertenece este cupón)

  // Agrupación multi-cupón
  submissionId: varchar("submissionId", { length: 64 }), // UUID del envío (varios cupones = mismo submissionId)
  // Origen y canal
  originSource: mysqlEnum("originSource", ["web", "admin_manual_entry"]).default("web").notNull(),
  channelEntry: mysqlEnum("channelEntry", ["web", "email", "whatsapp", "telefono", "presencial", "manual"]).default("web").notNull(),
  createdByAdminId: int("createdByAdminId"), // → users.id si fue alta manual
  // Admin
  adminUserId: int("adminUserId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type InsertCouponRedemption = typeof couponRedemptions.$inferInsert;

// ── Configuración de emails automáticos de cupones ──────────────────────────
export const couponEmailConfig = mysqlTable("coupon_email_config", {
  id: int("id").autoincrement().primaryKey(),
  autoSendCouponReceived: boolean("autoSendCouponReceived").default(true).notNull(),
  autoSendCouponValidated: boolean("autoSendCouponValidated").default(true).notNull(),
  autoSendInternalAlert: boolean("autoSendInternalAlert").default(true).notNull(),
  emailMode: mysqlEnum("emailMode", ["per_submission", "per_coupon"]).default("per_submission").notNull(),
  internalAlertEmail: varchar("internalAlertEmail", { length: 320 }).default("reservas@nayadeexperiences.es").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CouponEmailConfig = typeof couponEmailConfig.$inferSelect;

// ── Plataformas de venta externa (Groupon, Smartbox, etc.) ──────────────────
export const platforms = mysqlTable("platforms", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  logoUrl: text("logo_url"),
  active: boolean("active").default(true).notNull(),
  settlementFrequency: mysqlEnum("settlement_frequency", ["quincenal", "mensual", "trimestral"]).default("mensual").notNull(),
  commissionPct: decimal("commission_pct", { precision: 5, scale: 2 }).default("20.00"),
  externalUrl: text("external_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = typeof platforms.$inferInsert;
// ── Productos publicados en plataformas ──────────────────────────────────────────────
export const platformProducts = mysqlTable("platform_products", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platform_id").notNull(),           // → platforms.id
  experienceId: int("experience_id"),                 // → experiences.id (producto interno)
  externalLink: text("external_link"),                // URL del producto en la plataforma
  externalProductName: varchar("external_product_name", { length: 256 }),
  pvpPrice: decimal("pvp_price", { precision: 10, scale: 2 }),  // Precio PVP público en la plataforma
  netPrice: decimal("net_price", { precision: 10, scale: 2 }),  // Precio neto que recibimos de la plataforma
  expiresAt: timestamp("expires_at"),                           // Fecha de caducidad del producto en la plataforma
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PlatformProduct = typeof platformProducts.$inferSelect;
export type InsertPlatformProduct = typeof platformProducts.$inferInsert;

// ── Liquidaciones de plataformas ───────────────────────────────────────────
export const platformSettlements = mysqlTable("platform_settlements", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platform_id").notNull(), // → platforms.id
  periodLabel: varchar("period_label", { length: 64 }).notNull(), // ej: "2025-01"
  periodFrom: varchar("period_from", { length: 20 }),
  periodTo: varchar("period_to", { length: 20 }),
  totalCoupons: int("total_coupons").default(0).notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).default("0.00").notNull(),
  status: mysqlEnum("status", ["pendiente", "emitida", "pagada"]).default("pendiente").notNull(),
  justificantUrl: text("justificant_url"),
  invoiceRef: varchar("invoice_ref", { length: 128 }),  // Referencia de factura / número de liquidación emitida
  couponIds: json("coupon_ids").$type<number[]>().default([]),  // IDs de cupones incluidos en esta liquidación
  netTotal: decimal("net_total", { precision: 10, scale: 2 }).default("0.00"), // Suma de precios netos de los cupones
  notes: text("notes"),
  emittedAt: timestamp("emitted_at"),  // Fecha en que se emitió la liquidación al proveedor
  paidAt: timestamp("paid_at"),        // Fecha en que el proveedor pagó
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PlatformSettlement = typeof platformSettlements.$inferSelect;
export type InsertPlatformSettlement = typeof platformSettlements.$inferInsert;

// ─── SOLICITUDES DE ANULACIÓN ─────────────────────────────────────────────────
export const cancellationRequests = mysqlTable("cancellation_requests", {
  id: int("id").autoincrement().primaryKey(),
  fullName: varchar("full_name", { length: 256 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  activityDate: varchar("activity_date", { length: 32 }).notNull(),
  reason: mysqlEnum("reason", [
    "meteorologicas",
    "accidente",
    "enfermedad",
    "desistimiento",
    "otra",
  ]).notNull(),
  reasonDetail: text("reason_detail"),
  termsChecked: boolean("terms_checked").default(false).notNull(),
  source: varchar("source", { length: 64 }).default("landing_publica").notNull(),
  locator: varchar("locator", { length: 128 }),
  originUrl: text("origin_url"),
  ipAddress: varchar("ip_address", { length: 64 }),
  formLanguage: varchar("form_language", { length: 8 }).default("es"),
  linkedReservationId: int("linked_reservation_id"),
  linkedQuoteId: int("linked_quote_id"),
  linkedInvoiceId: int("linked_invoice_id"),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }),
  refundableAmount: decimal("refundable_amount", { precision: 10, scale: 2 }),
  resolvedAmount: decimal("resolved_amount", { precision: 10, scale: 2 }),
  activityType: varchar("activity_type", { length: 128 }),
  saleChannel: varchar("sale_channel", { length: 64 }),
  invoiceRef: varchar("invoice_ref", { length: 128 }),
  operationalStatus: mysqlEnum("operational_status", [
    "recibida",
    "en_revision",
    "pendiente_documentacion",
    "pendiente_decision",
    "resuelta",
    "cerrada",
    "incidencia",
  ]).default("recibida").notNull(),
  resolutionStatus: mysqlEnum("resolution_status", [
    "sin_resolver",
    "rechazada",
    "aceptada_total",
    "aceptada_parcial",
  ]).default("sin_resolver").notNull(),
  financialStatus: mysqlEnum("financial_status", [
    "sin_compensacion",
    "pendiente_devolucion",
    "devuelta_economicamente",
    "pendiente_bono",
    "compensada_bono",
    "compensacion_mixta",
    "incidencia_economica",
  ]).default("sin_compensacion").notNull(),
  compensationType: mysqlEnum("compensation_type", [
    "ninguna",
    "devolucion",
    "bono",
    "mixta",
  ]).default("ninguna"),
  voucherId: int("voucher_id"),
  cancellationNumber: varchar("cancellation_number", { length: 32 }),
  adminNotes: text("admin_notes"),
  assignedUserId: int("assigned_user_id"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CancellationRequest = typeof cancellationRequests.$inferSelect;
export type InsertCancellationRequest = typeof cancellationRequests.$inferInsert;

// ─── LOGS / TIMELINE DE SOLICITUDES DE ANULACIÓN ─────────────────────────────
export const cancellationLogs = mysqlTable("cancellation_logs", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("request_id").notNull(),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  oldStatus: varchar("old_status", { length: 64 }),
  newStatus: varchar("new_status", { length: 64 }),
  payload: json("payload").$type<Record<string, unknown>>(),
  adminUserId: int("admin_user_id"),
  adminUserName: varchar("admin_user_name", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CancellationLog = typeof cancellationLogs.$inferSelect;
export type InsertCancellationLog = typeof cancellationLogs.$inferInsert;

// ─── BONOS DE COMPENSACIÓN ────────────────────────────────────────────────────
export const compensationVouchers = mysqlTable("compensation_vouchers", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("request_id").notNull(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  type: mysqlEnum("type", ["actividad", "servicio", "monetario"]).default("actividad").notNull(),
  activityId: int("activity_id"),
  activityName: varchar("activity_name", { length: 256 }),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  status: mysqlEnum("status", [
    "generado",
    "enviado",
    "canjeado",
    "caducado",
    "anulado",
  ]).default("generado").notNull(),
  pdfUrl: text("pdf_url"),
  conditions: text("conditions"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CompensationVoucher = typeof compensationVouchers.$inferSelect;
export type InsertCompensationVoucher = typeof compensationVouchers.$inferInsert;

// ─── Email Templates (editable desde el CRM) ─────────────────────────────────
export const emailTemplates = mysqlTable("email_templates", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  recipient: varchar("recipient", { length: 20 }).notNull().default("cliente"),
  subject: varchar("subject", { length: 300 }).notNull(),
  headerImageUrl: text("header_image_url"),
  headerTitle: varchar("header_title", { length: 200 }),
  headerSubtitle: varchar("header_subtitle", { length: 300 }),
  bodyHtml: text("body_html").notNull(),
  footerText: text("footer_text"),
  ctaLabel: varchar("cta_label", { length: 100 }),
  ctaUrl: text("cta_url"),
  variables: text("variables"),
  isCustom: boolean("is_custom").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

// ─── PDF Templates (editable desde el CRM) ───────────────────────────────────
export const pdfTemplates = mysqlTable("pdf_templates", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  logoUrl: text("logo_url"),
  headerColor: varchar("header_color", { length: 20 }).default("#0a1628"),
  accentColor: varchar("accent_color", { length: 20 }).default("#f97316"),
  companyName: varchar("company_name", { length: 200 }),
  companyAddress: text("company_address"),
  companyPhone: varchar("company_phone", { length: 50 }),
  companyEmail: varchar("company_email", { length: 200 }),
  companyNif: varchar("company_nif", { length: 50 }),
  footerText: text("footer_text"),
  legalText: text("legal_text"),
  showLogo: boolean("show_logo").default(true).notNull(),
  showWatermark: boolean("show_watermark").default(false).notNull(),
  bodyHtml: text("body_html").notNull(),
  variables: text("variables"),
  isCustom: boolean("is_custom").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type PdfTemplate = typeof pdfTemplates.$inferSelect;
export type InsertPdfTemplate = typeof pdfTemplates.$inferInsert;

// ─── MONITORS (Personal Operativo) ───────────────────────────────────────────
export const monitors = mysqlTable("monitors", {
  id: int("id").autoincrement().primaryKey(),
  // Datos personales
  fullName: varchar("full_name", { length: 255 }).notNull(),
  dni: varchar("dni", { length: 20 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  birthDate: timestamp("birth_date"),
  photoUrl: text("photo_url"),
  photoKey: varchar("photo_key", { length: 512 }),
  // Contacto de emergencia
  emergencyName: varchar("emergency_name", { length: 255 }),
  emergencyRelation: varchar("emergency_relation", { length: 128 }),
  emergencyPhone: varchar("emergency_phone", { length: 30 }),
  // Datos bancarios
  iban: varchar("iban", { length: 34 }),
  ibanHolder: varchar("iban_holder", { length: 255 }),
  // Contrato
  contractType: mysqlEnum("contract_type", ["indefinido", "temporal", "autonomo", "practicas", "otro"]).default("temporal"),
  contractStart: timestamp("contract_start"),
  contractEnd: timestamp("contract_end"),
  contractConditions: text("contract_conditions"),
  // Estado
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  // Vínculo con usuario del sistema (opcional)
  userId: int("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Monitor = typeof monitors.$inferSelect;
export type InsertMonitor = typeof monitors.$inferInsert;

// ─── MONITOR DOCUMENTS ───────────────────────────────────────────────────────
export const monitorDocuments = mysqlTable("monitor_documents", {
  id: int("id").autoincrement().primaryKey(),
  monitorId: int("monitor_id").notNull(),
  type: mysqlEnum("type", ["dni", "contrato", "certificado", "otro"]).notNull().default("otro"),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  uploadedBy: int("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MonitorDocument = typeof monitorDocuments.$inferSelect;

// ─── MONITOR PAYROLL (Nóminas) ───────────────────────────────────────────────
export const monitorPayroll = mysqlTable("monitor_payroll", {
  id: int("id").autoincrement().primaryKey(),
  monitorId: int("monitor_id").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(), // 1-12
  baseSalary: decimal("base_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  extras: json("extras").$type<Array<{concept: string; amount: number; type: string}>>().default([]),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  status: mysqlEnum("status", ["pendiente", "pagado"]).default("pendiente").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type MonitorPayroll = typeof monitorPayroll.$inferSelect;

// ─── RESERVATION OPERATIONAL FIELDS (campos operativos en reservas) ──────────
export const reservationOperational = mysqlTable("reservation_operational", {
  id: int("id").autoincrement().primaryKey(),
  reservationId: int("reservation_id").notNull().unique(),
  reservationType: mysqlEnum("reservation_type", ["activity", "restaurant", "hotel", "spa", "pack"]).notNull().default("activity"),
  clientConfirmed: boolean("client_confirmed").default(false).notNull(),
  clientConfirmedAt: timestamp("client_confirmed_at"),
  clientConfirmedBy: int("client_confirmed_by"),
  arrivalTime: varchar("arrival_time", { length: 10 }), // "HH:MM"
  opNotes: text("op_notes"),
  monitorId: int("monitor_id"),
  opStatus: mysqlEnum("op_status", ["pendiente", "confirmado", "incidencia", "completado", "anulado"]).default("pendiente").notNull(),
  updatedBy: int("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ReservationOperational = typeof reservationOperational.$inferSelect;

// ─── DOCUMENT COUNTERS (sistema de numeración correlativa centralizado) ───────
export const documentCounters = mysqlTable("document_counters", {
  id: int("id").autoincrement().primaryKey(),
  documentType: varchar("document_type", { length: 32 }).notNull(), // presupuesto, factura, reserva, tpv, cupon, liquidacion, anulacion
  year: int("year").notNull(),
  currentNumber: int("current_number").notNull().default(0),
  prefix: varchar("prefix", { length: 16 }).notNull(), // PRES, FAC, RES, TPV, CUP, LIQ, ANU
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type DocumentCounter = typeof documentCounters.$inferSelect;

// ─── DOCUMENT NUMBER LOGS (auditoría de generación de números) ────────────────
export const documentNumberLogs = mysqlTable("document_number_logs", {
  id: int("id").autoincrement().primaryKey(),
  documentType: varchar("document_type", { length: 32 }).notNull(),
  documentNumber: varchar("document_number", { length: 64 }).notNull(),
  year: int("year").notNull(),
  sequence: int("sequence").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  generatedBy: varchar("generated_by", { length: 64 }), // userId o 'system'
  context: varchar("context", { length: 128 }), // e.g. 'crm:confirmPayment', 'tpv:createSale'
});
export type DocumentNumberLog = typeof documentNumberLogs.$inferSelect;

// ─── PENDING PAYMENTS (pagos pendientes de cobro) ────────────────────────────
export const pendingPayments = mysqlTable("pending_payments", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quote_id").notNull(),
  reservationId: int("reservation_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientEmail: varchar("client_email", { length: 255 }),
  clientPhone: varchar("client_phone", { length: 64 }),
  productName: varchar("product_name", { length: 255 }),
  amountCents: int("amount_cents").notNull(),
  dueDate: varchar("due_date", { length: 32 }).notNull(),
  reason: text("reason").notNull(),
  status: mysqlEnum("pp_status", ["pending", "paid", "cancelled", "incidentado"]).default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 32 }),
  paymentNote: text("payment_note"),
  transferProofUrl: text("transfer_proof_url"),
  paidAt: bigint("paid_at", { mode: "number" }),
  reminderSentAt: bigint("reminder_sent_at", { mode: "number" }),
  createdBy: int("created_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type PendingPayment = typeof pendingPayments.$inferSelect;
