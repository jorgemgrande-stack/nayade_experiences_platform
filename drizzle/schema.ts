import {
  bigint,
  boolean,
  decimal,
  int,
  json,
  mediumtext,
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
  role: mysqlEnum("role", ["user", "admin", "monitor", "agente", "adminrest", "controler"]).default("user").notNull(),
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
  // Fiscal regime (REAV module) — "general" + taxRate sustituye a "general_21"
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
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
  // Pricing mode (retrocompatible: default = per_person)
  pricingType: mysqlEnum("pricing_type", ["per_person", "per_unit"]).default("per_person").notNull(),
  unitCapacity: int("unit_capacity"),   // personas por unidad (solo si pricingType=per_unit)
  maxUnits: int("max_units"),           // máximo de unidades disponibles (opcional)
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
  cartMetadata: json("cart_metadata").$type<{
    merchantOrder: string;
    items: { productId: number; productName: string; people: number; amountCents: number; bookingDate: string }[];
    totalAmountCents: number;
    checkoutAt: string;
  } | null>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── PROPOSALS (Propuestas Comerciales) ───────────────────────────────────────
export const proposals = mysqlTable("proposals", {
  id: int("id").autoincrement().primaryKey(),
  proposalNumber: varchar("proposalNumber", { length: 32 }).notNull().unique(),
  leadId: int("leadId").notNull(),
  agentId: int("agentId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  mode: mysqlEnum("mode", ["configurable", "multi_option"]).default("configurable").notNull(),
  // For "configurable" mode — same shape as quotes.items
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
    isOptional?: boolean;
    productId?: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  status: mysqlEnum("status", [
    "borrador",
    "enviado",
    "visualizado",
    "aceptado",
    "rechazado",
    "expirado",
  ]).default("borrador").notNull(),
  token: varchar("token", { length: 128 }).unique(),
  publicUrl: text("publicUrl"),
  validUntil: timestamp("validUntil"),
  conditions: text("conditions"),
  notes: text("notes"),
  sentAt: timestamp("sentAt"),
  viewedAt: timestamp("viewedAt"),
  acceptedAt: timestamp("acceptedAt"),
  // Which multi_option was selected by the client
  selectedOptionId: int("selectedOptionId"),
  // If proposal was converted to a quote
  convertedToQuoteId: int("convertedToQuoteId"),
  ghlOpportunityId: varchar("ghlOpportunityId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = typeof proposals.$inferInsert;

// Options for multi_option proposals — each option is a full alternative
export const proposalOptions = mysqlTable("proposal_options", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  items: json("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
    productId?: number;
  }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull().default("0"),
  isRecommended: boolean("isRecommended").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProposalOption = typeof proposalOptions.$inferSelect;
export type InsertProposalOption = typeof proposalOptions.$inferInsert;

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
    fiscalRegime?: "reav" | "general";
    taxRate?: number;
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
    "pago_fallido",
    "pagado",
    "convertido_reserva",
    "facturado",
    "rechazado",
    "expirado",
    "perdido",
  ]).default("borrador").notNull(),
  // Plan de pagos fraccionado (null = pago total clásico, sin cambios en el flujo)
  paymentPlanId: int("payment_plan_id"),
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
  paymentMethod: mysqlEnum("payment_method", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]),
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
  itemsJson: json("itemsJson").$type<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general"; taxRate?: number; productId?: number }[]>().default([]),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
  taxAmount: decimal("taxAmount", { precision: 10, scale: 2 }).default("0"),
  taxBreakdown: json("taxBreakdown").$type<{ rate: number; base: number; amount: number }[]>(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  pdfUrl: text("pdfUrl"),
  pdfKey: text("pdfKey"),
  status: mysqlEnum("status", ["generada", "enviada", "cobrada", "anulada", "abonada"]).default("generada").notNull(),
  invoiceType: mysqlEnum("invoiceType", ["factura", "abono"]).default("factura").notNull(),
  // Payment traceability
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]).default("redsys"),
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
  paymentMethod: mysqlEnum("paymentMethod", ["tarjeta", "transferencia", "efectivo", "link_pago", "otro", "tarjeta_fisica", "tarjeta_redsys"]).default("tarjeta"),
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
  taxRate:         decimal("taxRate_tx",      { precision: 5,  scale: 2 }).default("21"),
  reavMargin:      decimal("reavMargin",      { precision: 10, scale: 2 }).default("0"),
  fiscalRegime:    mysqlEnum("fiscalRegime_tx", ["reav", "general", "mixed"]).default("general"),
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

// ─── GHL INBOX (WhatsApp) ─────────────────────────────────────────────────────

export const ghlConversations = mysqlTable("ghl_conversations", {
  id: int("id").autoincrement().primaryKey(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }).notNull().unique(),
  ghlContactId: varchar("ghlContactId", { length: 64 }),
  locationId: varchar("locationId", { length: 64 }),
  channel: varchar("channel", { length: 32 }).notNull().default("whatsapp"),
  customerName: varchar("customerName", { length: 255 }),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  lastMessagePreview: text("lastMessagePreview"),
  lastMessageAt: timestamp("lastMessageAt"),
  unreadCount: int("unreadCount").notNull().default(0),
  inbox: varchar("inbox", { length: 64 }),
  starred: boolean("starred").notNull().default(false),
  status: mysqlEnum("status", ["new", "open", "pending", "replied", "closed"]).notNull().default("new"),
  assignedUserId: int("assignedUserId"),
  linkedQuoteId: int("linkedQuoteId"),
  linkedReservationId: int("linkedReservationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const ghlMessages = mysqlTable("ghl_messages", {
  id: int("id").autoincrement().primaryKey(),
  ghlMessageId: varchar("ghlMessageId", { length: 64 }).notNull().unique(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull().default("inbound"),
  messageType: varchar("messageType", { length: 32 }).default("text"),
  body: text("body"),
  attachmentsJson: json("attachmentsJson"),
  senderName: varchar("senderName", { length: 255 }),
  sentAt: timestamp("sentAt"),
  deliveryStatus: varchar("deliveryStatus", { length: 32 }),
  rawPayloadJson: json("rawPayloadJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ghlWebhookEvents = mysqlTable("ghl_webhook_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 128 }),
  eventType: varchar("eventType", { length: 128 }).notNull(),
  ghlConversationId: varchar("ghlConversationId", { length: 64 }),
  ghlContactId: varchar("ghlContactId", { length: 64 }),
  locationId: varchar("locationId", { length: 64 }),
  rawPayloadJson: json("rawPayloadJson"),
  processedStatus: mysqlEnum("processedStatus", ["pending", "processed", "failed", "ignored"]).notNull().default("pending"),
  errorMessage: text("errorMessage"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
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
  merchantOrder: varchar("merchant_order", { length: 30 }).notNull(),
  redsysResponse: text("redsys_response"),
  redsysDsResponse: varchar("redsys_ds_response", { length: 10 }),
  notes: text("notes"),
  quoteId: int("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  quoteSource: varchar("quoteSource", { length: 32 }), // 'presupuesto' | 'directo'
  // Invoice link
  invoiceId: int("invoiceId"),
  invoiceNumber: varchar("invoiceNumber", { length: 32 }),
  // Payment details
  paymentMethod: mysqlEnum("paymentMethod", ["redsys", "transferencia", "efectivo", "otro", "tarjeta_fisica", "tarjeta_redsys"]),
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
  // Pricing snapshot (retrocompatible: null = per_person legacy)
  pricingType: varchar("pricing_type", { length: 16 }),      // "per_person" | "per_unit"
  unitCapacity: int("unit_capacity"),                         // personas por unidad al reservar
  unitsBooked: int("units_booked"),                          // unidades reservadas
  // Time slots (optional, retrocompatible - null = no time slot required)
  selectedTimeSlotId: int("selected_time_slot_id"),
  selectedTime: varchar("selected_time", { length: 10 }),
  // REAV link
  reavExpedientId: int("reav_expedient_id"),
  // Número de referencia interna (RES-2026-XXXX)
  reservationNumber: varchar("reservation_number", { length: 32 }).unique(),
  // Anulación vinculada (FK → cancellation_requests.id)
  cancellationRequestId: int("cancellation_request_id"),
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
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
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
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
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
  fiscalRegime: mysqlEnum("fiscalRegime", ["reav", "general", "mixed"]).default("general").notNull(),
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("21"),
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
  entityType: mysqlEnum("entityType", ["hotel", "spa", "experience", "pack", "restaurant"]).notNull(),
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
  fiscalRegime: mysqlEnum("fiscalRegime_tsi", ["reav", "general", "mixed"]).default("general"),
  taxBase:      decimal("taxBase_tsi",   { precision: 10, scale: 2 }).default("0"),
  taxAmount:    decimal("taxAmount_tsi", { precision: 10, scale: 2 }).default("0"),
  taxRate:      decimal("taxRate_tsi",   { precision: 5,  scale: 2 }).default("21"),
  reavCost:     decimal("reavCost_tsi",  { precision: 10, scale: 2 }).default("0"),
  reavMargin:   decimal("reavMargin_tsi",{ precision: 10, scale: 2 }).default("0"),
  reavTax:      decimal("reavTax_tsi",   { precision: 10, scale: 2 }).default("0"),
  isManual:     boolean("is_manual").notNull().default(false),
  conceptText:  varchar("concept_text",  { length: 500 }),
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
  status: mysqlEnum("status", ["pending", "justified", "accounted", "conciliado"]).notNull().default("pending"),
  reservationId: int("reservationId"),
  productId: int("productId"),
  notes: text("notes"),
  source: varchar("source", { length: 32 }).default("manual"),
  emailMessageId: varchar("emailMessageId", { length: 512 }),
  emailFrom: varchar("emailFrom", { length: 256 }),
  missingAttachment: boolean("missingAttachment").default(false),
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
  attachmentUrl: mediumtext("attachmentUrl"), // URL S3 o data URL base64 del PDF/imagen del cupón

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
  // Scope of cancellation: "total" = whole reservation, "lineas" = specific extra lines only
  cancellationScope: varchar("cancellation_scope", { length: 10 }),
  cancelledItemsJson: text("cancelled_items_json"),
  refundExecutedAt: timestamp("refund_executed_at"),
  refundProofUrl: varchar("refund_proof_url", { length: 512 }),
  adminNotes: text("admin_notes"),
  assignedUserId: int("assigned_user_id"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CancellationRequest = typeof cancellationRequests.$inferSelect;
export type InsertCancellationRequest = typeof cancellationRequests.$inferInsert;

// ── Importaciones de ficheros bancarios ────────────────────────────────────────
export const bankFileImports = mysqlTable("bank_file_imports", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 10 }).notNull(), // xls, xlsx, csv
  importedRows: int("imported_rows").default(0).notNull(),
  duplicatesSkipped: int("duplicates_skipped").default(0).notNull(),
  status: mysqlEnum("status", ["ok", "error", "parcial"]).default("ok").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankFileImport = typeof bankFileImports.$inferSelect;
export type InsertBankFileImport = typeof bankFileImports.$inferInsert;

// ── Movimientos bancarios ──────────────────────────────────────────────────────
export const bankMovements = mysqlTable("bank_movements", {
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(), // → bank_file_imports.id
  fecha: varchar("fecha", { length: 12 }).notNull(),           // YYYY-MM-DD
  fechaValor: varchar("fecha_valor", { length: 12 }),          // YYYY-MM-DD
  movimiento: varchar("movimiento", { length: 255 }),
  masDatos: text("mas_datos"),
  importe: decimal("importe", { precision: 12, scale: 2 }).notNull(),
  saldo: decimal("saldo", { precision: 12, scale: 2 }),
  duplicateKey: varchar("duplicate_key", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["pendiente", "ignorado"]).default("pendiente").notNull(),
  conciliationStatus: mysqlEnum("conciliation_status", ["pendiente", "conciliado"]).default("pendiente").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankMovement = typeof bankMovements.$inferSelect;
export type InsertBankMovement = typeof bankMovements.$inferInsert;

// ── Vínculos movimiento bancario ↔ entidad ─────────────────────────────────────
export const bankMovementLinks = mysqlTable("bank_movement_links", {
  id: int("id").autoincrement().primaryKey(),
  bankMovementId: int("bank_movement_id").notNull(),
  entityType: mysqlEnum("entity_type", ["quote", "reservation", "invoice", "expense", "card_terminal_batch", "manual"]).notNull(),
  entityId: int("entity_id").notNull(),
  linkType: mysqlEnum("link_type", ["income_transfer", "card_income", "cash_income", "expense_payment", "manual_conciliation"]).notNull().default("income_transfer"),
  amountLinked: decimal("amount_linked", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["proposed", "confirmed", "rejected", "unlinked"]).notNull().default("proposed"),
  confidenceScore: int("confidence_score").default(0),
  matchedBy: varchar("matched_by", { length: 255 }),
  matchedAt: timestamp("matched_at"),
  rejectedAt: timestamp("rejected_at"),
  unlinkedAt: timestamp("unlinked_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type BankMovementLink = typeof bankMovementLinks.$inferSelect;
export type InsertBankMovementLink = typeof bankMovementLinks.$inferInsert;

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
  activitiesOpJson: json("activities_op_json").$type<Array<{ index: number; monitorId?: number | null; arrivalTime?: string; opNotes?: string }>>(),
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

// ─── PLANES DE PAGO FRACCIONADO ──────────────────────────────────────────────
// Un presupuesto puede tener como máximo UN plan de pagos.
// Si paymentPlanId en quotes es NULL → flujo de pago total clásico (sin cambios).
// Si existe un plan → el cobro se gestiona mediante cuotas/installments.

export const paymentPlans = mysqlTable("payment_plans", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quote_id").notNull(),
  planType: mysqlEnum("plan_type", ["full", "installment"]).default("installment").notNull(),
  totalAmountCents: int("total_amount_cents").notNull(),
  createdBy: int("created_by").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentPlan = typeof paymentPlans.$inferSelect;

export const paymentInstallments = mysqlTable("payment_installments", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  quoteId: int("quote_id").notNull(),        // denormalizado para queries directas
  installmentNumber: int("installment_number").notNull(),
  amountCents: int("amount_cents").notNull(),
  dueDate: varchar("due_date", { length: 20 }).notNull(),
  status: mysqlEnum("status", [
    "pending",
    "paid",
    "overdue",
    "cancelled",
  ]).default("pending").notNull(),
  // Si true, el pago de esta cuota permite confirmar la reserva principal
  isRequiredForConfirmation: boolean("is_required_for_confirmation").default(false).notNull(),
  // Referencia al intento de pago Redsys para esta cuota (su propio merchantOrder)
  merchantOrder: varchar("merchant_order", { length: 30 }),
  // Reserva creada para el pago de esta cuota vía Redsys
  reservationId: int("reservation_id"),
  // Datos del pago confirmado
  paymentMethod: varchar("payment_method", { length: 32 }),
  paidAt: timestamp("paidAt"),
  paidBy: varchar("paid_by", { length: 128 }),   // "redsys" | "admin:userId"
  // Trazabilidad de recordatorios
  remindersSent: int("reminders_sent").default(0).notNull(),
  lastReminderAt: timestamp("lastReminderAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentInstallment = typeof paymentInstallments.$inferSelect;

// ── TPV (Datafono / Card Terminal) Operations ─────────────────────────────────

export const cardTerminalOperations = mysqlTable("card_terminal_operations", {
  id: int("id").primaryKey().autoincrement(),
  // Datos del extracto
  operationDatetime: timestamp("operation_datetime").notNull(),
  operationNumber: varchar("operation_number", { length: 64 }).notNull(),
  commerceCode: varchar("commerce_code", { length: 64 }),
  terminalCode: varchar("terminal_code", { length: 64 }),
  operationType: mysqlEnum("operation_type", ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"]).notNull().default("VENTA"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  card: varchar("card", { length: 32 }),
  authorizationCode: varchar("authorization_code", { length: 32 }),
  // Conciliación
  linkedEntityType: mysqlEnum("linked_entity_type", ["reservation", "quote", "none"]).default("none"),
  linkedEntityId: int("linked_entity_id"),
  linkedAt: timestamp("linked_at"),
  linkedBy: varchar("linked_by", { length: 128 }),
  // Estado
  status: mysqlEnum("status", ["pendiente", "conciliado", "incidencia", "ignorado", "included_in_batch", "settled"]).notNull().default("pendiente"),
  incidentReason: text("incident_reason"),
  notes: text("notes"),
  // Importación
  importId: int("import_id"),
  duplicateKey: varchar("duplicate_key", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const tpvFileImports = mysqlTable("tpv_file_imports", {
  id: int("id").primaryKey().autoincrement(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 16 }).notNull(),
  importedRows: int("imported_rows").notNull().default(0),
  duplicatesSkipped: int("duplicates_skipped").notNull().default(0),
  status: mysqlEnum("status", ["ok", "error"]).notNull().default("ok"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CardTerminalOperation = typeof cardTerminalOperations.$inferSelect;
export type TpvFileImport = typeof tpvFileImports.$inferSelect;

// ── Remesas TPV (Card Terminal Batches) ──────────────────────────────────────

export const cardTerminalBatches = mysqlTable("card_terminal_batches", {
  id: int("id").primaryKey().autoincrement(),
  batchDate: varchar("batch_date", { length: 12 }).notNull(),
  commerceCode: varchar("commerce_code", { length: 64 }),
  terminalCode: varchar("terminal_code", { length: 64 }),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  totalSales: decimal("total_sales", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalRefunds: decimal("total_refunds", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalNet: decimal("total_net", { precision: 12, scale: 2 }).notNull().default("0.00"),
  operationCount: int("operation_count").notNull().default(0),
  linkedOperationsCount: int("linked_operations_count").notNull().default(0),
  status: mysqlEnum("status", ["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"]).notNull().default("pending"),
  bankMovementId: int("bank_movement_id"),
  suggestedBankMovementId: int("suggested_bank_movement_id"),
  suggestedScore: int("suggested_score"),
  matchingRunAt: timestamp("matching_run_at"),
  suggestionRejected: boolean("suggestion_rejected").notNull().default(false),
  reconciledAt: timestamp("reconciled_at"),
  reconciledBy: varchar("reconciled_by", { length: 128 }),
  differenceAmount: decimal("difference_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type CardTerminalBatch = typeof cardTerminalBatches.$inferSelect;
export type InsertCardTerminalBatch = typeof cardTerminalBatches.$inferInsert;

export const cardTerminalBatchOperations = mysqlTable("card_terminal_batch_operations", {
  id: int("id").primaryKey().autoincrement(),
  batchId: int("batch_id").notNull(),
  cardTerminalOperationId: int("card_terminal_operation_id").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  operationType: mysqlEnum("operation_type", ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"]).notNull().default("VENTA"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CardTerminalBatchOperation = typeof cardTerminalBatchOperations.$inferSelect;

// ── Audit log for batch matching and reconciliation ───────────────────────────

export const cardTerminalBatchAuditLogs = mysqlTable("card_terminal_batch_audit_logs", {
  id: int("id").primaryKey().autoincrement(),
  batchId: int("batch_id").notNull(),
  action: mysqlEnum("action", [
    "match_suggested",
    "match_auto_ready",
    "match_no_candidate",
    "match_review_required",
    "suggestion_accepted",
    "suggestion_rejected",
    "auto_reconciled",
    "manual_reconciled",
    "unreconciled",
    "review_flagged",
  ]).notNull(),
  bankMovementId: int("bank_movement_id"),
  score: int("score"),
  autoReconciled: boolean("auto_reconciled").notNull().default(false),
  performedBy: varchar("performed_by", { length: 128 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CardTerminalBatchAuditLog = typeof cardTerminalBatchAuditLogs.$inferSelect;

export const emailIngestionLogs = mysqlTable("email_ingestion_logs", {
  id: int("id").primaryKey().autoincrement(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 255 }),
  receivedAt: timestamp("received_at"),
  status: mysqlEnum("status", ["ok", "error", "skipped"]).notNull().default("ok"),
  parsingStrategy: varchar("parsing_strategy", { length: 16 }),
  operationsDetected: int("operations_detected").notNull().default(0),
  operationsInserted: int("operations_inserted").notNull().default(0),
  operationsDuplicate: int("operations_duplicate").notNull().default(0),
  operationsLinked: int("operations_linked").notNull().default(0),
  operationsFailed: int("operations_failed").notNull().default(0),
  retryCount: int("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailIngestionLog = typeof emailIngestionLogs.$inferSelect;

// ─── Logs de ingesta de gastos por email ─────────────────────────────────────
export const expenseEmailIngestionLogs = mysqlTable("expense_email_ingestion_logs", {
  id: int("id").primaryKey().autoincrement(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 256 }),
  receivedAt: timestamp("received_at"),
  status: mysqlEnum("status", ["processed", "duplicated", "invalid_subject", "missing_amount", "error"]).notNull(),
  expenseId: int("expense_id"),
  amountDetected: decimal("amount_detected", { precision: 12, scale: 2 }),
  attachmentsCount: int("attachments_count").default(0),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});
export type ExpenseEmailIngestionLog = typeof expenseEmailIngestionLogs.$inferSelect;

// ─── MÓDULO CAJA CONTABLE (Financial Cash Register) ──────────────────────────

export const finCashAccounts = mysqlTable("fin_cash_accounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["principal", "secondary", "petty_cash", "other"]).notNull().default("principal"),
  currentBalance: decimal("current_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  initialBalance: decimal("initial_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FinCashAccount = typeof finCashAccounts.$inferSelect;
export type InsertFinCashAccount = typeof finCashAccounts.$inferInsert;

export const finCashMovements = mysqlTable("fin_cash_movements", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  type: mysqlEnum("type_fcm", ["income", "expense", "transfer_in", "transfer_out", "opening_balance", "adjustment"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  concept: varchar("concept", { length: 512 }).notNull(),
  counterparty: varchar("counterparty", { length: 256 }),
  category: varchar("category", { length: 128 }),
  relatedEntityType: mysqlEnum("related_entity_type", ["reservation", "expense", "tpv_sale", "bank_deposit", "manual"]).default("manual"),
  relatedEntityId: int("related_entity_id"),
  transferToAccountId: int("transfer_to_account_id"),
  notes: text("notes"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashMovement = typeof finCashMovements.$inferSelect;
export type InsertFinCashMovement = typeof finCashMovements.$inferInsert;

export const finCashClosures = mysqlTable("fin_cash_closures", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  openingBalance: decimal("opening_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalIncome: decimal("total_income", { precision: 12, scale: 2 }).notNull().default("0.00"),
  totalExpenses: decimal("total_expenses", { precision: 12, scale: 2 }).notNull().default("0.00"),
  closingBalance: decimal("closing_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  countedAmount: decimal("counted_amount", { precision: 12, scale: 2 }),
  difference: decimal("difference", { precision: 12, scale: 2 }),
  status: mysqlEnum("status_fcc", ["open", "closed", "reconciled", "balanced", "difference", "reviewed", "adjusted", "accepted_difference"]).notNull().default("open"),
  sourceEntityType: varchar("source_entity_type", { length: 32 }),
  sourceEntityId: int("source_entity_id"),
  notes: text("notes"),
  closedBy: int("closed_by"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashClosure = typeof finCashClosures.$inferSelect;
export type InsertFinCashClosure = typeof finCashClosures.$inferInsert;

export const finCashAlerts = mysqlTable("fin_cash_alerts", {
  id: int("id").autoincrement().primaryKey(),
  type: varchar("type", { length: 64 }).notNull().default("cash_difference"),
  severity: mysqlEnum("severity_fca", ["info", "warning", "critical"]).notNull().default("warning"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  closureId: int("closure_id"),
  sessionId: int("session_id"),
  message: text("message"),
  isRead: boolean("is_read").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 128 }),
  resolutionNotes: text("resolution_notes"),
  resolutionAction: varchar("resolution_action", { length: 64 }),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashAlert = typeof finCashAlerts.$inferSelect;
export type InsertFinCashAlert = typeof finCashAlerts.$inferInsert;

export const finCashClosureActions = mysqlTable("fin_cash_closure_actions", {
  id: int("id").autoincrement().primaryKey(),
  closureId: int("closure_id").notNull(),
  actionType: mysqlEnum("action_type_fcca", ["review", "adjustment_created", "accepted_difference", "note_added", "alert_resolved"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdById: int("created_by_id"),
  createdByName: varchar("created_by_name", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FinCashClosureAction = typeof finCashClosureActions.$inferSelect;

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

export const featureFlags = mysqlTable("feature_flags", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  module: varchar("module", { length: 64 }).notNull().default("general"),
  enabled: boolean("enabled").notNull().default(true),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  riskLevel: mysqlEnum("risk_level", ["low", "medium", "high"]).notNull().default("low"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type FeatureFlag = typeof featureFlags.$inferSelect;

// ─── SYSTEM SETTINGS ─────────────────────────────────────────────────────────

export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  valueType: mysqlEnum("value_type", ["string", "number", "boolean", "json"]).notNull().default("string"),
  category: varchar("category", { length: 64 }).notNull().default("general"),
  label: varchar("label", { length: 256 }).notNull(),
  description: text("description"),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type SystemSetting = typeof systemSettings.$inferSelect;

// ─── CONFIG CHANGE LOGS ───────────────────────────────────────────────────────

export const configChangeLogs = mysqlTable("config_change_logs", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entity_type", ["feature_flag", "system_setting"]).notNull(),
  key: varchar("key", { length: 128 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedById: int("changed_by_id"),
  changedByName: varchar("changed_by_name", { length: 128 }),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});
export type ConfigChangeLog = typeof configChangeLogs.$inferSelect;

// ─── ORGANIZATIONS ────────────────────────────────────────────────────────────

export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  status: mysqlEnum("status", ["active", "inactive", "onboarding"]).notNull().default("onboarding"),
  ownerUserId: int("owner_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type Organization = typeof organizations.$inferSelect;

// ─── ONBOARDING STATUS ────────────────────────────────────────────────────────

export const onboardingStatus = mysqlTable("onboarding_status", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organization_id").notNull().unique(),
  businessInfoCompleted: boolean("business_info_completed").notNull().default(false),
  fiscalCompleted: boolean("fiscal_completed").notNull().default(false),
  brandingCompleted: boolean("branding_completed").notNull().default(false),
  emailsCompleted: boolean("emails_completed").notNull().default(false),
  modulesCompleted: boolean("modules_completed").notNull().default(false),
  integrationsReviewed: boolean("integrations_reviewed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
export type OnboardingStatus = typeof onboardingStatus.$inferSelect;

// ─── RBAC: ROLES ─────────────────────────────────────────────────────────────
// Catálogo de roles. Los roles con is_legacy=true mapean 1:1 con users.role enum.
// Los nuevos roles (is_legacy=false) están preparados para la siguiente fase
// donde se asignarán permisos y se migrará users.role al sistema RBAC completo.

// ─── RBAC: USER ROLE ASSIGNMENTS ─────────────────────────────────────────────
// Asigna roles RBAC a usuarios. Coexiste con users.role (legacy) sin reemplazarlo.
// Composite PK (user_id, role_id) enforced at DB level.

export const rbacUserRoles = mysqlTable("rbac_user_roles", {
  userId: int("user_id").notNull(),
  roleId: int("role_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacUserRole = typeof rbacUserRoles.$inferSelect;

// ─── RBAC: PERMISSIONS ───────────────────────────────────────────────────────

export const rbacPermissions = mysqlTable("rbac_permissions", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  module: varchar("module", { length: 64 }).notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacPermission = typeof rbacPermissions.$inferSelect;

// Composite PK (role_id, permission_id) enforced at DB level in the migration.
export const rbacRolePermissions = mysqlTable("rbac_role_permissions", {
  roleId: int("role_id").notNull(),
  permissionId: int("permission_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacRolePermission = typeof rbacRolePermissions.$inferSelect;

// ─── RBAC: ROLES ─────────────────────────────────────────────────────────────
// Catálogo de roles. Los roles con is_legacy=true mapean 1:1 con users.role enum.
// Los nuevos roles (is_legacy=false) están preparados para la siguiente fase
// donde se asignarán permisos y se migrará users.role al sistema RBAC completo.

export const rbacRoles = mysqlTable("rbac_roles", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isLegacy: boolean("is_legacy").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type RbacRole = typeof rbacRoles.$inferSelect;

// ─── MÓDULO ATENCIÓN COMERCIAL ────────────────────────────────────────────────

export const commercialFollowupSettings = mysqlTable("commercial_followup_settings", {
  id: int("id").autoincrement().primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  maxTotalRemindersPerQuote: int("maxTotalRemindersPerQuote").notNull().default(3),
  maxEmailsPerRun: int("maxEmailsPerRun").notNull().default(50),
  allowedSendStart: varchar("allowedSendStart", { length: 5 }).notNull().default("09:00"),
  allowedSendEnd: varchar("allowedSendEnd", { length: 5 }).notNull().default("21:00"),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Europe/Madrid"),
  stopAfterDays: int("stopAfterDays").notNull().default(30),
  internalCcEmail: varchar("internalCcEmail", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CommercialFollowupSettings = typeof commercialFollowupSettings.$inferSelect;

export const commercialFollowupRules = mysqlTable("commercial_followup_rules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  isActive: boolean("isActive").notNull().default(true),
  delayHours: int("delayHours").notNull().default(24),
  triggerFrom: mysqlEnum("triggerFrom", ["quote_sent_at", "last_reminder_at"]).notNull().default("quote_sent_at"),
  onlyIfNotViewed: boolean("onlyIfNotViewed").notNull().default(false),
  allowIfViewedButUnpaid: boolean("allowIfViewedButUnpaid").notNull().default(true),
  maxSendsPerQuoteForThisRule: int("maxSendsPerQuoteForThisRule").notNull().default(1),
  emailSubject: varchar("emailSubject", { length: 500 }).notNull(),
  emailBody: text("emailBody").notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CommercialFollowupRule = typeof commercialFollowupRules.$inferSelect;

export const quoteCommercialTracking = mysqlTable("quote_commercial_tracking", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull().unique(),
  commercialStatus: mysqlEnum("commercialStatus", [
    "pending_followup", "reminder_1_sent", "reminder_2_sent", "reminder_3_sent",
    "interested", "paused", "lost", "converted", "discarded",
  ]).notNull().default("pending_followup"),
  reminderPaused: boolean("reminderPaused").notNull().default(false),
  reminderPausedReason: text("reminderPausedReason"),
  reminderCount: int("reminderCount").notNull().default(0),
  lastReminderAt: timestamp("lastReminderAt"),
  nextFollowupAt: timestamp("nextFollowupAt"),
  lastContactAt: timestamp("lastContactAt"),
  lastContactChannel: mysqlEnum("lastContactChannel", ["email", "phone", "whatsapp", "internal"]),
  lostReason: text("lostReason"),
  internalNotes: text("internalNotes"),
  assignedToUserId: int("assignedToUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type QuoteCommercialTracking = typeof quoteCommercialTracking.$inferSelect;

export const commercialCommunications = mysqlTable("commercial_communications", {
  id: int("id").autoincrement().primaryKey(),
  quoteId: int("quoteId").notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }),
  customerPhone: varchar("customerPhone", { length: 32 }),
  type: mysqlEnum("type", [
    "quote_sent", "automatic_reminder", "manual_reminder", "payment_link_sent",
    "internal_note", "phone_call", "whatsapp", "lost_reason",
  ]).notNull(),
  channel: mysqlEnum("channel", ["email", "phone", "whatsapp", "internal"]).notNull().default("email"),
  subject: varchar("subject", { length: 500 }),
  bodySnapshot: text("bodySnapshot"),
  ruleId: int("ruleId"),
  status: mysqlEnum("status", ["sent", "failed", "skipped"]).notNull().default("sent"),
  errorMessage: text("errorMessage"),
  sentByUserId: int("sentByUserId"),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CommercialCommunication = typeof commercialCommunications.$inferSelect;

// ─── VAPI CALLS ───────────────────────────────────────────────────────────────

export const vapiCalls = mysqlTable("vapi_calls", {
  id: int("id").autoincrement().primaryKey(),
  vapiCallId: varchar("vapiCallId", { length: 128 }).notNull().unique(),
  assistantId: varchar("assistantId", { length: 128 }),
  phoneNumber: varchar("phoneNumber", { length: 32 }),
  customerName: varchar("customerName", { length: 255 }),
  customerEmail: varchar("customerEmail", { length: 320 }),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  durationSeconds: int("durationSeconds"),
  status: varchar("status", { length: 64 }),
  endedReason: varchar("endedReason", { length: 128 }),
  recordingUrl: text("recordingUrl"),
  transcript: mediumtext("transcript"),
  summary: text("summary"),
  structuredData: json("structuredData"),
  rawPayload: json("rawPayload"),
  linkedLeadId: int("linkedLeadId"),
  linkedBudgetId: int("linkedBudgetId"),
  linkedReservationId: int("linkedReservationId"),
  reviewed: boolean("reviewed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VapiCall = typeof vapiCalls.$inferSelect;
export type InsertVapiCall = typeof vapiCalls.$inferInsert;

export type InsertFinCashClosureAction = typeof finCashClosureActions.$inferInsert;

// ─── COMMERCIAL EMAIL MODULE ──────────────────────────────────────────────────

export const emailAccounts = mysqlTable("email_accounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  imapHost: varchar("imap_host", { length: 255 }).notNull().default(""),
  imapPort: int("imap_port").notNull().default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  imapUser: varchar("imap_user", { length: 320 }).notNull().default(""),
  imapPasswordEnc: text("imap_password_enc").notNull().default(""),
  smtpHost: varchar("smtp_host", { length: 255 }).notNull().default(""),
  smtpPort: int("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: varchar("smtp_user", { length: 320 }).notNull().default(""),
  smtpPasswordEnc: text("smtp_password_enc").notNull().default(""),
  fromName: varchar("from_name", { length: 255 }).notNull().default(""),
  fromEmail: varchar("from_email", { length: 320 }).notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncIntervalMinutes: int("sync_interval_min").notNull().default(5),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  folderInbox: varchar("folder_inbox", { length: 100 }).notNull().default("INBOX"),
  folderSent: varchar("folder_sent", { length: 100 }).notNull().default("Sent"),
  folderArchive: varchar("folder_archive", { length: 100 }).notNull().default("Archive"),
  folderTrash: varchar("folder_trash", { length: 100 }).notNull().default("Trash"),
  maxEmailsPerSync: int("max_emails_per_sync").notNull().default(50),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type InsertEmailAccount = typeof emailAccounts.$inferInsert;

export const commercialEmails = mysqlTable("commercial_emails", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("account_id").notNull(),
  messageId: varchar("message_id", { length: 512 }).notNull(),
  inReplyTo: varchar("in_reply_to", { length: 512 }),
  fromEmail: varchar("from_email", { length: 320 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  toEmails: json("to_emails").$type<string[]>().notNull(),
  ccEmails: json("cc_emails").$type<string[]>().default([]),
  subject: varchar("subject", { length: 512 }).notNull(),
  bodyHtml: mediumtext("body_html"),
  bodyText: mediumtext("body_text"),
  snippet: varchar("snippet", { length: 300 }),
  sentAt: timestamp("sent_at"),
  isRead: boolean("is_read").notNull().default(false),
  isAnswered: boolean("is_answered").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  isSent: boolean("is_sent").notNull().default(false),
  folder: varchar("folder", { length: 100 }).notNull().default("INBOX"),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  labels: json("labels").$type<string[]>().default([]),
  assignedUserId: int("assigned_user_id"),
  linkedLeadId: int("linked_lead_id"),
  linkedClientId: int("linked_client_id"),
  linkedQuoteId: int("linked_quote_id"),
  linkedReservationId: int("linked_reservation_id"),
  imapUid: int("imap_uid"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CommercialEmail = typeof commercialEmails.$inferSelect;
export type InsertCommercialEmail = typeof commercialEmails.$inferInsert;
