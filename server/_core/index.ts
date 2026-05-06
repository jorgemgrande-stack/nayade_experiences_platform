import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createLocalContext } from "./context.local";
import { createLocalAuthRouter } from "../localAuth";
import { createPasswordResetRouter } from "../passwordReset";
import { createAuthGuardMiddleware } from "../authGuard";
import uploadRouter from "../uploadRoutes";
import redsysRouter from "../redsysRoutes";
import settlementExportRouter from "../settlementExportRoutes";
import invoicePreviewRouter from "../invoicePreviewRouter";
import { kbRouter } from "../kbRoute";
import ghlWebhookRouter from "../ghlWebhookRouter";
import ghlInboxRouter from "../routes/ghlInboxRouter";
import vapiWebhookRouter from "../vapiWebhookRouter";
import { startQuoteReminderJob } from "../quoteReminderJob";
import { startCommercialFollowupJob } from "../commercialFollowupJob";
import { startCancellationStaleJob } from "../cancellationStaleJob";
import { startEmailIngestionJob } from "../services/emailTpvIngestionService";
import { startExpenseEmailIngestionJob } from "../services/expenseEmailIngestionService";
import { startCommercialEmailSyncJob } from "../services/commercialEmailService";
import { startMatchingJob } from "../services/cardTerminalMatchingService";
import { startRelinkJob } from "../services/cardTerminalRelinkService";
import { serveStatic, setupVite } from "./vite";
import { getFeatureFlag } from "../config";

// ─── RATE LIMITERS ────────────────────────────────────────────────────────────

/**
 * Formularios públicos de lead/presupuesto: 10 req/min por IP.
 * Protege submitLead y submitBudget contra spam y bots.
 */
const leadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes. Por favor espera 1 minuto antes de volver a intentarlo.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Autenticación local: 5 req/min por IP.
 * Previene ataques de fuerza bruta en login y recuperación de contraseña.
 */
const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Endpoints de pago Redsys (IPN): 30 req/min por IP.
 * Las notificaciones IPN legítimas de Redsys son infrecuentes; este límite
 * bloquea intentos de replay o fuzzing del endpoint de notificación.
 */
const redsysRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas peticiones al endpoint de pago.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

/**
 * Endpoint de subida de archivos: 20 req/min por IP.
 * Previene abuso de almacenamiento S3.
 */
const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Demasiadas subidas. Espera 1 minuto.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

// Modo de autenticación: LOCAL_AUTH=true usa email+password local en lugar de Manus OAuth
const USE_LOCAL_AUTH = process.env.LOCAL_AUTH === "true";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Confiar en el proxy de Railway (necesario para que express-rate-limit identifique IPs correctamente)
  app.set("trust proxy", 1);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  if (USE_LOCAL_AUTH) {
    // Rate limiting en endpoints de autenticación (5 req/min por IP)
    app.use("/api/auth/login", authRateLimit);
    app.use("/api/auth/forgot-password", authRateLimit);
    // Modo local: rutas de auth propias (login/logout/me) en lugar de Manus OAuth
    app.use(createLocalAuthRouter());
    app.use(createPasswordResetRouter());
    console.log("[Auth] Modo LOCAL_AUTH activado — usando email+password local");
  } else {
    // Modo Manus: OAuth callback
    registerOAuthRoutes(app);
  }

  // Rate limiting en formularios públicos de lead/presupuesto (10 req/min por IP)
  app.use("/api/trpc/submitLead", leadRateLimit);
  app.use("/api/trpc/submitBudget", leadRateLimit);

  // Rate limiting en endpoints de pago Redsys (30 req/min por IP)
  app.use("/api/redsys/notification", redsysRateLimit);
  app.use("/api/redsys/restaurant-notification", redsysRateLimit);

  // Rate limiting en endpoint de subida de archivos (20 req/min por IP)
  app.use("/api/upload", uploadRateLimit);
  app.use("/api/upload-media", uploadRateLimit);

  // Middleware de protección: bloquea rutas /api/trpc de procedimientos protegidos
  // si no hay sesión válida. Funciona en ambos modos (local y Manus OAuth).
  app.use("/api/trpc", createAuthGuardMiddleware(USE_LOCAL_AUTH));
  // Servir archivos del storage local (fallback cuando S3/Forge no está configurado)
  const localStorageDir = process.env.LOCAL_STORAGE_PATH ?? "/tmp/local-storage";
  app.use("/local-storage", express.static(localStorageDir));
  // File upload endpoint
  app.use(uploadRouter);

  // Redsys IPN notification endpoint
  app.use(redsysRouter);
  // Settlement Excel export endpoint
  app.use(settlementExportRouter);
  // Invoice HTML on-demand preview (no storage required)
  app.use(invoicePreviewRouter);
  app.use(kbRouter);
  // GHL webhook receiver (leads/contactos — existente)
  app.use(ghlWebhookRouter);
  // GHL Inbox — WhatsApp conversations, mensajes y SSE
  app.use(ghlInboxRouter);
  // VAPI webhook receiver (lead + presupuesto síncrono)
  app.use(vapiWebhookRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: USE_LOCAL_AUTH ? createLocalContext : createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

async function runMigrations() {
  try {
    const mysql = await import("mysql2/promise");
    const { drizzle } = await import("drizzle-orm/mysql2");
    const { migrate } = await import("drizzle-orm/mysql2/migrator");
    const { resolve } = await import("path");
    const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
    const db = drizzle(pool);
    // En producción el binario está en dist/, las migraciones en drizzle/ (mismo nivel que package.json)
    const migrationsFolder = resolve(process.cwd(), "drizzle");
    await migrate(db, { migrationsFolder });
    await pool.end();
    console.log("[DB] Migraciones aplicadas correctamente");
  } catch (err) {
    console.error("[DB] Error al aplicar migraciones:", err);
    // No abortamos el arranque — si la BD ya está al día, el error es esperado
  }
}

// ─── SEED: garantizar flags y settings críticos independiente de migraciones ──
async function ensureCriticalSeeds() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    // Feature flag omitido por migración ya marcada como aplicada en __drizzle_migrations
    await conn.execute(
      `INSERT IGNORE INTO feature_flags (\`key\`, \`name\`, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, ?, 1, 1, 'medium')`,
      [
        "card_terminal_matching_enabled",
        "Job conciliación datáfono",
        "Ejecuta el job periódico que concilia batches de datáfono con movimientos bancarios",
        "card_terminal",
      ]
    );

    // Teléfono de contacto — actualizar si tiene valor vacío o el número antiguo
    await conn.execute(
      `UPDATE system_settings
       SET value = ?
       WHERE \`key\` = 'brand_phone' AND (value IS NULL OR value = '' OR value = ?)`,
      ["+34 911 67 51 89", "+34 930 34 77 91"]
    );

    // Refactor fiscal: migrar general_21 → general en todas las tablas afectadas.
    // Desactivamos strict mode para esta sesión: MySQL lanza WARN_DATA_TRUNCATED
    // (errno 1265) en modo estricto al comparar ENUM con un valor que ya no existe.
    await conn.execute(`SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode, 'STRICT_TRANS_TABLES', ''), 'STRICT_ALL_TABLES', '')`);
    for (const tbl of ["experiences", "packs", "room_types", "spa_treatments"]) {
      const col = "fiscalRegime";
      const [colRows] = await conn.execute(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tbl, col]
      ) as any[];
      const colType: string = (colRows as any[])[0]?.COLUMN_TYPE ?? "";
      // Corregir datos: CAST evita comparación ENUM estricta; OR col+0=0 cubre filas
      // que quedaron como '' por un ALTER previo parcialmente aplicado.
      await conn.execute(`UPDATE \`${tbl}\` SET \`${col}\` = 'general' WHERE CAST(\`${col}\` AS CHAR) = 'general_21' OR \`${col}\` + 0 = 0`);
      if (colType.includes("general_21")) {
        await conn.execute(`ALTER TABLE \`${tbl}\` MODIFY COLUMN \`${col}\` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general'`);
        console.log(`[DB] Fiscal refactor aplicado en ${tbl}`);
      }
      const hasRate = await conn.execute(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='taxRate'`, [tbl]) as any[];
      if (!((hasRate as any[][])[0] as any[]).length) {
        await conn.execute(`ALTER TABLE \`${tbl}\` ADD COLUMN \`taxRate\` DECIMAL(5,2) NOT NULL DEFAULT 21.00`);
      }
    }
    // tpv_sale_items → columna fiscalRegime_tsi
    {
      const [cr] = await conn.execute(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tpv_sale_items' AND COLUMN_NAME='fiscalRegime_tsi'`
      ) as any[];
      await conn.execute(`UPDATE \`tpv_sale_items\` SET \`fiscalRegime_tsi\` = 'general' WHERE CAST(\`fiscalRegime_tsi\` AS CHAR) = 'general_21' OR \`fiscalRegime_tsi\` + 0 = 0`);
      if ((String((cr as any[])[0]?.COLUMN_TYPE ?? "")).includes("general_21")) {
        await conn.execute(`ALTER TABLE \`tpv_sale_items\` MODIFY COLUMN \`fiscalRegime_tsi\` ENUM('reav','general','mixed') DEFAULT 'general'`);
        console.log("[DB] Fiscal refactor aplicado en tpv_sale_items");
      }
    }
    // transactions → fiscalRegime_tx
    {
      const [cr] = await conn.execute(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='fiscalRegime_tx'`
      ) as any[];
      await conn.execute(`UPDATE \`transactions\` SET \`fiscalRegime_tx\` = 'general' WHERE CAST(\`fiscalRegime_tx\` AS CHAR) = 'general_21' OR \`fiscalRegime_tx\` + 0 = 0`);
      if ((String((cr as any[])[0]?.COLUMN_TYPE ?? "")).includes("general_21")) {
        await conn.execute(`ALTER TABLE \`transactions\` MODIFY COLUMN \`fiscalRegime_tx\` ENUM('reav','general','mixed') DEFAULT 'general'`);
        console.log("[DB] Fiscal refactor aplicado en transactions");
      }
      const hasTxRate = await conn.execute(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transactions' AND COLUMN_NAME='taxRate_tx'`) as any[];
      if (!((hasTxRate as any[][])[0] as any[]).length) {
        await conn.execute(`ALTER TABLE \`transactions\` ADD COLUMN \`taxRate_tx\` DECIMAL(5,2) DEFAULT 21.00`);
      }
    }
    // invoices → taxBreakdown JSON
    {
      const hasBreakdown = await conn.execute(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND COLUMN_NAME='taxBreakdown'`) as any[];
      if (!((hasBreakdown as any[][])[0] as any[]).length) {
        await conn.execute(`ALTER TABLE \`invoices\` ADD COLUMN \`taxBreakdown\` JSON NULL`);
        console.log("[DB] Columna taxBreakdown añadida a invoices");
      }
    }

    // Garantizar que 'controler' existe en el ENUM role de users
    const [enumRows] = await conn.execute(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
    ) as any[];
    const columnType: string = (enumRows as any[])[0]?.COLUMN_TYPE ?? "";
    if (!columnType.includes("controler")) {
      await conn.execute(
        `ALTER TABLE \`users\` MODIFY COLUMN \`role\`
         enum('user','admin','monitor','agente','adminrest','controler')
         NOT NULL DEFAULT 'user'`
      );
      console.log("[DB] ENUM role actualizado con 'controler'");
    }

    // ─── Propuestas Comerciales: crear tablas si no existen ─────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`proposals\` (
        \`id\`                 INT AUTO_INCREMENT PRIMARY KEY,
        \`proposalNumber\`     VARCHAR(32)  NOT NULL,
        \`leadId\`             INT          NOT NULL,
        \`agentId\`            INT          NOT NULL,
        \`title\`              VARCHAR(256) NOT NULL,
        \`description\`        TEXT,
        \`mode\`               ENUM('configurable','multi_option') NOT NULL DEFAULT 'configurable',
        \`items\`              JSON,
        \`subtotal\`           DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`discount\`           DECIMAL(10,2) DEFAULT 0,
        \`tax\`                DECIMAL(10,2) DEFAULT 0,
        \`total\`              DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`currency\`           VARCHAR(8)   NOT NULL DEFAULT 'EUR',
        \`status\`             ENUM('borrador','enviado','visualizado','aceptado','rechazado','expirado') NOT NULL DEFAULT 'borrador',
        \`token\`              VARCHAR(128) UNIQUE,
        \`publicUrl\`          TEXT,
        \`validUntil\`         TIMESTAMP NULL,
        \`conditions\`         TEXT,
        \`notes\`              TEXT,
        \`sentAt\`             TIMESTAMP NULL,
        \`viewedAt\`           TIMESTAMP NULL,
        \`acceptedAt\`         TIMESTAMP NULL,
        \`selectedOptionId\`   INT NULL,
        \`convertedToQuoteId\` INT NULL,
        \`ghlOpportunityId\`   VARCHAR(128) NULL,
        \`createdAt\`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`proposals_proposalNumber_unique\` (\`proposalNumber\`),
        INDEX \`idx_proposals_leadId\`  (\`leadId\`),
        INDEX \`idx_proposals_status\`  (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`proposal_options\` (
        \`id\`            INT AUTO_INCREMENT PRIMARY KEY,
        \`proposalId\`    INT          NOT NULL,
        \`title\`         VARCHAR(256) NOT NULL,
        \`description\`   TEXT,
        \`items\`         JSON,
        \`subtotal\`      DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`discount\`      DECIMAL(10,2) DEFAULT 0,
        \`tax\`           DECIMAL(10,2) DEFAULT 0,
        \`total\`         DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`isRecommended\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`sortOrder\`     INT NOT NULL DEFAULT 0,
        \`createdAt\`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_proposal_options_proposalId\` (\`proposalId\`),
        CONSTRAINT \`fk_proposal_options_proposal\`
          FOREIGN KEY (\`proposalId\`) REFERENCES \`proposals\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[DB] Tablas proposals/proposal_options verificadas");

    await conn.end();
    console.log("[DB] Seeds críticos verificados");
  } catch (err) {
    console.error("[DB] Error en seeds críticos:", err);
  }
}

// ─── MIGRATE: site_settings → system_settings (fuente de verdad única) ───────
async function migrateSiteSettingsToSystemSettings() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    // 1. Seed nuevas claves en system_settings (INSERT IGNORE preserva valores existentes)
    const seeds: [string, string, string, string, string, number, number][] = [
      ["site_business_email",           "string", "negocio",       "Email de contacto",                        "Email público de contacto del negocio",                      0, 0],
      ["site_business_description",     "string", "negocio",       "Descripción breve del negocio",            "Usada en SEO y cabeceras de email",                          0, 1],
      ["site_schedule_high_open",       "string", "horarios",      "Temporada alta — apertura",                "Hora de apertura en temporada alta (HH:MM)",                 0, 1],
      ["site_schedule_high_close",      "string", "horarios",      "Temporada alta — cierre",                  "Hora de cierre en temporada alta (HH:MM)",                   0, 1],
      ["site_schedule_low_open",        "string", "horarios",      "Temporada baja — apertura",                "Hora de apertura en temporada baja (HH:MM)",                 0, 1],
      ["site_schedule_low_close",       "string", "horarios",      "Temporada baja — cierre",                  "Hora de cierre en temporada baja (HH:MM)",                   0, 1],
      ["site_schedule_days",            "string", "horarios",      "Días de apertura",                         "Texto libre de días operativos (ej: Lunes a Domingo)",       0, 1],
      ["site_payment_currency",         "string", "pagos",         "Moneda",                                   "Código ISO de la moneda principal (EUR, USD…)",              0, 0],
      ["site_payment_deposit_restaurant","number","pagos",         "Depósito por comensal en restaurante (€)", "Importe del depósito en reservas de restaurante",            0, 0],
      ["site_legal_name",               "string", "fiscal",        "Razón social",                             "Nombre legal de la empresa facturadora",                     0, 0],
      ["site_legal_phone",              "string", "fiscal",        "Teléfono fiscal",                          "Teléfono registrado ante la Agencia Tributaria",             0, 0],
      ["site_legal_zip",                "string", "fiscal",        "Código postal",                            "CP del domicilio fiscal",                                    0, 0],
      ["site_legal_city",               "string", "fiscal",        "Municipio",                                "Ciudad del domicilio fiscal",                                0, 0],
      ["site_legal_province",           "string", "fiscal",        "Provincia",                                "Provincia del domicilio fiscal",                             0, 0],
      ["site_legal_email",              "string", "fiscal",        "Email fiscal",                             "Email registrado en la Agencia Tributaria",                  0, 0],
      ["site_legal_iban",               "string", "fiscal",        "IBAN (para liquidaciones)",                "Número de cuenta que aparece en documentos de liquidación",  0, 0],
      ["site_notif_email_restaurant",   "string", "emails",        "Email de alertas de restaurante",          "Recibe notificaciones de nuevas reservas de restaurante",    0, 0],
      ["site_ghl_api_key",              "string", "integraciones", "GoHighLevel API Key",                      "Credencial de API de GoHighLevel",                           1, 0],
      ["site_ghl_location_id",          "string", "integraciones", "GoHighLevel Location ID",                  "Location ID del workspace de GoHighLevel",                   0, 0],
    ];

    for (const [key, valueType, category, label, description, isSensitive, isPublic] of seeds) {
      await conn.execute(
        `INSERT IGNORE INTO system_settings (\`key\`, value_type, category, label, description, is_sensitive, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [key, valueType, category, label, description, isSensitive, isPublic],
      );
    }

    // 2. Migrar datos existentes de site_settings → system_settings (solo si destino vacío)
    const KEY_MAP: Record<string, string> = {
      businessName:             "brand_name",
      businessPhone:            "brand_phone",
      businessEmail:            "site_business_email",
      businessAddress:          "brand_location",
      businessWebsite:          "brand_website_url",
      businessDescription:      "site_business_description",
      scheduleHighOpen:         "site_schedule_high_open",
      scheduleHighClose:        "site_schedule_high_close",
      scheduleLowOpen:          "site_schedule_low_open",
      scheduleLowClose:         "site_schedule_low_close",
      scheduleDays:             "site_schedule_days",
      paymentVat:               "tax_rate_general",
      paymentCurrency:          "site_payment_currency",
      paymentQuoteValidity:     "quote_validity_days",
      paymentDepositRestaurant: "site_payment_deposit_restaurant",
      legalCompanyName:         "site_legal_name",
      legalCompanyCif:          "brand_nif",
      legalCompanyPhone:        "site_legal_phone",
      legalCompanyAddress:      "brand_address",
      legalCompanyZip:          "site_legal_zip",
      legalCompanyCity:         "site_legal_city",
      legalCompanyProvince:     "site_legal_province",
      legalCompanyEmail:        "site_legal_email",
      legalCompanyIban:         "site_legal_iban",
      notifEmailBooking:        "email_reservations",
      notifEmailRestaurant:     "site_notif_email_restaurant",
      ghlApiKey:                "site_ghl_api_key",
      ghlLocationId:            "site_ghl_location_id",
    };

    const [tableCheck] = await conn.execute(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_settings'`,
    ) as any[];

    if ((tableCheck as any[]).length > 0) {
      const [siteRows] = await conn.execute("SELECT `key`, `value` FROM site_settings") as any[];
      for (const row of siteRows as any[]) {
        const sysKey = KEY_MAP[row.key];
        if (!sysKey || !row.value) continue;
        await conn.execute(
          `UPDATE system_settings SET value = ? WHERE \`key\` = ? AND (value IS NULL OR value = '')`,
          [row.value, sysKey],
        );
      }
      console.log("[DB] Migración site_settings → system_settings completada");
    }

    await conn.end();
  } catch (err) {
    console.error("[DB] Error en migración site_settings:", err);
  }
}

// ─── SEED: restaurar experiencias si la tabla está vacía ──────────────────────
async function seedExperiencesIfEmpty() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    // Comprobar si ya hay experiencias
    const [rows] = await conn.execute("SELECT COUNT(*) as cnt FROM experiences") as any[];
    const count = rows[0].cnt;
    if (count > 0) {
      console.log(`[Seed] Experiencias ya presentes (${count}), se omite el seed`);
      await conn.end();
      return;
    }

    console.log("[Seed] Tabla de experiencias vacía — restaurando productos...");

    const CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads";

    // Categorías
    await conn.execute(`INSERT IGNORE INTO categories (slug,name,isActive,sortOrder) VALUES
      ('actividades-acuaticas','Actividades Acuáticas',1,1),
      ('deportes-acuaticos','Deportes Acuáticos',1,2),
      ('spa-bienestar','SPA & Bienestar',1,3),
      ('piscina','Piscina & Baño',1,4)`);

    await conn.execute(`INSERT IGNORE INTO locations (slug,name,address,isActive,sortOrder) VALUES
      ('los-angeles-de-san-rafael','Los Ángeles de San Rafael','Club Náutico Los Ángeles de San Rafael, Segovia',1,1)`);

    const [[cat1]] = await conn.execute("SELECT id FROM categories WHERE slug='actividades-acuaticas'") as any;
    const [[cat2]] = await conn.execute("SELECT id FROM categories WHERE slug='deportes-acuaticos'") as any;
    const [[cat3]] = await conn.execute("SELECT id FROM categories WHERE slug='spa-bienestar'") as any;
    const [[cat4]] = await conn.execute("SELECT id FROM categories WHERE slug='piscina'") as any;
    const [[loc]]  = await conn.execute("SELECT id FROM locations WHERE slug='los-angeles-de-san-rafael'") as any;

    const A = cat1.id, D = cat2.id, S = cat3.id, P = cat4.id, L = loc.id;

    const experiences = [
      { slug:"paseo-en-barco", title:"Paseo en Barco", shortDescription:"Navega por las tranquilas aguas del embalse rodeado de vegetación y vistas panorámicas a la Sierra de Guadarrama.", description:"Una experiencia única surcando las apacibles aguas del embalse de Los Ángeles de San Rafael. A bordo disfrutarás de paisajes de ensueño, rodeado de vegetación frondosa y con las cumbres de la Sierra de Guadarrama como telón de fondo.", coverImageUrl:`${CDN}/1775049168929-vx1e7i.png`, image1:`${CDN}/1775049168929-vx1e7i.png`, image2:`${CDN}/1775049603095-8rkwvh.png`, image3:`${CDN}/1775049607679-rxudag.png`, image4:`${CDN}/1775049612665-6ts80x.png`, basePrice:"15.00", duration:"20 minutos", minPersons:1, maxPersons:50, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:1 },
      { slug:"entrada-general-piscina-club-nautico", title:"Entrada General Piscina Club Náutico", shortDescription:"Relájate en nuestra piscina a orillas del embalse con amplias zonas de solárium y baño.", description:"Disfruta de la piscina del Club Náutico de Los Ángeles de San Rafael con vistas a la Sierra de Guadarrama. Amplias zonas de solárium, acceso al lago y todas las comodidades para una jornada de descanso en familia o con amigos.", coverImageUrl:`${CDN}/1774281603494-er84vo.png`, image1:`${CDN}/1774281603494-er84vo.png`, image2:`${CDN}/1774281608106-4fqd45.png`, image3:`${CDN}/1774281619410-lefaql.png`, image4:null, basePrice:"7.00", duration:null, minPersons:11, maxPersons:100, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:P, locationId:L, includes:'["Acceso a las instalaciones","Seguro de accidentes"]', excludes:'["Acceso a Bahía VIP"]', sortOrder:2 },
      { slug:"alquiler-dia-completo-tabla-de-wakeboard", title:"Alquiler Día Completo Tabla de Wakeboard", shortDescription:"Alquila tu tabla de wakeboard para todo el día y disfruta del embalse a tu ritmo combinando velocidad, equilibrio y adrenalina.", description:"Vive la experiencia del wakeboard durante un día completo en el embalse de Los Ángeles de San Rafael. La tabla te permitirá deslizarte sobre el agua combinando velocidad, equilibrio y adrenalina. Mínimo 2 personas.", coverImageUrl:`${CDN}/1775074493261-jccylv.jpg`, image1:`${CDN}/1775074493261-jccylv.jpg`, image2:`${CDN}/1775074605323-iygad1.webp`, image3:null, image4:null, basePrice:"45.00", duration:"1 día", minPersons:1, maxPersons:5, difficulty:"facil", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:D, locationId:L, includes:'["Tabla de wakeboard","Fijaciones/herrajes","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:3 },
      { slug:"cableski-wakeboard", title:"Cableski & Wakeboard", shortDescription:"El sistema de cable aéreo continuo te propulsará sobre el agua haciendo wakeboard o esquí acuático. ¡Una experiencia que engancha desde la primera vuelta!", description:"El cableski de Náyade te permite practicar wakeboard o esquí acuático impulsado por un sistema de cable aéreo continuo, sin necesidad de lancha motora. No hace falta experiencia previa. Disponible por vueltas o en formato media jornada/jornada completa.", coverImageUrl:`${CDN}/1773766863713-7gry6r.jpg`, image1:`${CDN}/1773766863713-7gry6r.jpg`, image2:`${CDN}/1773766869680-r66be7.png`, image3:`${CDN}/1773766880496-2l6cdm.png`, image4:`${CDN}/1773766883661-g2yblj.png`, basePrice:"30.00", duration:null, minPersons:1, maxPersons:100, difficulty:"moderado", isFeatured:0, isActive:1, isPublished:1, isPresentialSale:1, categoryId:D, locationId:L, includes:'["Esquís, mono-ski o kneeboard","Chaleco salvavidas/protector","Seguro de accidentes"]', excludes:'["Tabla de wakeboard","Neopreno"]', sortOrder:4 },
      { slug:"blob-jump", title:"Blob Jump", shortDescription:"Lánzate desde una plataforma elevada sobre un giant blob inflable y sal despedido al aire antes de caer al lago. ¡Pura adrenalina!", description:"El Blob Jump es la actividad más impactante de Náyade. Te lanzas desde una plataforma elevada sobre un enorme colchón inflable (blob) que propulsa al compañero del extremo opuesto por los aires antes de caer al embalse. Disponible por saltos individuales o en bonos de 3 y 5 saltos.", coverImageUrl:`${CDN}/1773762402377-dymd02.png`, image1:`${CDN}/1773762402377-dymd02.png`, image2:`${CDN}/1773762413686-d56xu2.png`, image3:null, image4:null, basePrice:"8.00", duration:null, minPersons:1, maxPersons:20, difficulty:"dificil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Equipo protector (parachoques)","Seguro de accidentes","Chaleco salvavidas"]', excludes:'["Casco"]', sortOrder:5 },
      { slug:"canoas-kayaks", title:"Canoas & Kayaks", shortDescription:"Explora el embalse en canoa o kayak a tu propio ritmo. Deporte, paisaje y tranquilidad con vistas a la Sierra de Guadarrama.", description:"Navega por el embalse de Los Ángeles de San Rafael en canoa o kayak y descubre rincones únicos a tu ritmo. Actividad perfecta para todos los niveles que combina ejercicio suave, naturaleza y vistas espectaculares. Disponible en 1, 2 o 3 horas y Fórmula Familiar.", coverImageUrl:`${CDN}/1775063728570-x1kzd8.png`, image1:`${CDN}/1775063728570-x1kzd8.png`, image2:`${CDN}/1775063736967-y2tlnu.png`, image3:`${CDN}/1775063750522-nke2gs.png`, image4:`${CDN}/1775063846540-gcz3jp.png`, basePrice:"12.00", duration:"1 hora", minPersons:2, maxPersons:4, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Embarcación para 2 pasajeros","Remos para 2 personas","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Bolsa impermeable"]', sortOrder:6 },
      { slug:"paddle-surf", title:"Paddle Surf", shortDescription:"Practica el stand-up paddleboarding en las tranquilas aguas del embalse. Equilibrio, calma y diversión para todos los niveles.", description:"El Paddle Surf (SUP) es perfecto para disfrutar del embalse de manera activa y serena. De pie sobre la tabla, remando con una pala, explorarás las orillas del embalse. Accesible para principiantes y apto para toda la familia. Sesiones de 1 hora, 2 horas o Fórmula Familiar.", coverImageUrl:`${CDN}/1773774376430-cmec06.png`, image1:`${CDN}/1773774376430-cmec06.png`, image2:`${CDN}/1773774379647-stk79l.jpg`, image3:`${CDN}/1773774382023-qz52s0.jpg`, image4:`${CDN}/1773774392088-2ldmdb.jpg`, basePrice:"20.00", duration:"1 hora", minPersons:1, maxPersons:6, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Tabla individual","Remo/pala","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Bolsa estanca impermeable"]', sortOrder:7 },
      { slug:"banana-ski-donuts-copia-dRMV", title:"Donuts Ski", shortDescription:"La actividad más divertida para grupos: flota sobre un donut inflable remolcado por una lancha a alta velocidad, con giros y salpicones garantizados.", description:"El Donuts Ski es la actividad más divertida de Náyade. Subidos en un flotador circular de goma, serás remolcado por una lancha a alta velocidad por el embalse. Giros inesperados, saltos y salpicones constantes hacen de esta experiencia una risa garantizada. Grupos de 2 a 8 personas.", coverImageUrl:`${CDN}/1773863507321-ywvj6b.png`, image1:`${CDN}/1773863507321-ywvj6b.png`, image2:`${CDN}/1775034710820-bwhf5y.jpg`, image3:`${CDN}/1773702422261-h5ajd3.png`, image4:`${CDN}/1773702434768-wegear.png`, basePrice:"35.00", duration:"20 minutos", minPersons:2, maxPersons:8, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Equipo y flotador","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:8 },
      { slug:"circuito-spa", title:"Circuito SPA Hidrotermal", shortDescription:"Circuito hidrotérmico completo con piscinas a distintas temperaturas, sauna finlandesa, baño turco y duchas de contraste.", description:"El Circuito SPA Hidrotermal de Náyade te ofrece una experiencia de bienestar completa. Incluye piscinas a diferentes temperaturas, chorros cervicales y lumbares, sauna finlandesa, baño turco y duchas de contraste. Precio especial para clientes del hotel.", coverImageUrl:`${CDN}/1773867774581-gde9k3.png`, image1:`${CDN}/1773867774581-gde9k3.png`, image2:`${CDN}/1773867780249-4it3ac.png`, image3:`${CDN}/1773867847070-xh6y0d.png`, image4:`${CDN}/1773867967358-gmcgyp.png`, basePrice:"18.00", duration:null, minPersons:6, maxPersons:20, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:S, locationId:L, includes:'["Acceso a todo el circuito hidrotermal","Piscinas a distintas temperaturas","Sauna finlandesa","Baño turco","Duchas de contraste","Seguro de accidentes"]', excludes:'[]', sortOrder:9 },
      { slug:"banana-ski-donuts", title:"Banana Ski", shortDescription:"La actividad más divertida y apta para todos los públicos: sentados en el flotador banana, la lancha os arrastrará a alta velocidad por el embalse.", description:"El Banana Ski es la actividad más popular de Náyade, ideal para grupos y familias. Sentados en un flotador en forma de banana, la lancha motora os remolcará a alta velocidad. Risas y emociones garantizadas. Mínimo 4 personas para la tarifa estándar.", coverImageUrl:`${CDN}/1773702396972-kd9hrk.png`, image1:`${CDN}/1773702396972-kd9hrk.png`, image2:`${CDN}/1773702409563-u54xhb.png`, image3:`${CDN}/1773702422261-h5ajd3.png`, image4:`${CDN}/1773702434768-wegear.png`, basePrice:"15.00", duration:"20 minutos", minPersons:4, maxPersons:8, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:10 },
      { slug:"hidropedales", title:"Hidrobicis", shortDescription:"Pedalea sobre el agua y explora el embalse a tu ritmo. Una actividad tranquila y relajante perfecta para toda la familia.", description:"Las hidrobicis (hidropedales) son la opción perfecta para disfrutar del embalse de forma relajada. Pedaleando sobre el agua explorarás los rincones más tranquilos. Ideal para familias con niños. Sesiones de 1 hora, 2 horas o Fórmula Familiar.", coverImageUrl:`${CDN}/1773777174336-io6lvw.jpg`, image1:`${CDN}/1773777174336-io6lvw.jpg`, image2:`${CDN}/1773777177100-p1hzuw.jpg`, image3:`${CDN}/1773777198906-716boe.png`, image4:null, basePrice:"20.00", duration:"1 hora", minPersons:2, maxPersons:4, difficulty:"moderado", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Hidropedal","Chaleco salvavidas","Seguro de accidentes"]', excludes:'["Neopreno"]', sortOrder:11 },
      { slug:"aventura-hinchable", title:"Aventura Hinchable Acuática", shortDescription:"Parque inflable flotante en el lago con toboganes, trampolines y circuitos de obstáculos. ¡Diversión garantizada para todas las edades!", description:"La Aventura Hinchable Acuática es el parque de atracciones flotante de Náyade: un enorme recorrido inflable en el embalse con toboganes, trampolines y circuitos de obstáculos. Diversión para toda la familia. Sesiones de 30 y 60 minutos.", coverImageUrl:`${CDN}/1773778862239-e30o1s.png`, image1:`${CDN}/1773778862239-e30o1s.png`, image2:`${CDN}/1773778867350-w70k1r.png`, image3:`${CDN}/1773779017020-g7xxyf.png`, image4:null, basePrice:"8.00", duration:"1 hora", minPersons:1, maxPersons:30, difficulty:"facil", isFeatured:1, isActive:1, isPublished:1, isPresentialSale:1, categoryId:A, locationId:L, includes:'["Seguro de accidentes"]', excludes:'[]', sortOrder:12 },
    ];

    for (const exp of experiences) {
      const cols = ["slug","title","shortDescription","description","coverImageUrl","image1","image2","image3","image4","basePrice","duration","minPersons","maxPersons","difficulty","isFeatured","isActive","isPublished","isPresentialSale","categoryId","locationId","includes","excludes","fiscalRegime","productType","pricing_type","sortOrder"];
      const vals = [exp.slug,exp.title,exp.shortDescription,exp.description,exp.coverImageUrl,exp.image1,exp.image2??null,exp.image3??null,exp.image4??null,exp.basePrice,exp.duration??null,exp.minPersons,exp.maxPersons,exp.difficulty,exp.isFeatured,exp.isActive,exp.isPublished,exp.isPresentialSale,exp.categoryId,exp.locationId,exp.includes,exp.excludes,"general","actividad","per_person",exp.sortOrder];
      const placeholders = cols.map(() => "?").join(",");
      await conn.execute(`INSERT IGNORE INTO experiences (${cols.join(",")}) VALUES (${placeholders})`, vals);
      console.log(`[Seed]  ✓ ${exp.title}`);
    }

    console.log("[Seed] ✅ 12 experiencias restauradas correctamente");
    await conn.end();
  } catch (err) {
    console.error("[Seed] Error al hacer seed de experiencias:", err);
    // No abortamos el arranque
  }
}

async function ensurePricingColumns() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experiences'
       AND COLUMN_NAME IN ('pricing_type','unit_capacity','max_units','has_time_slots')`
    ) as any[];
    const found = new Set(cols.map((c: any) => c.COLUMN_NAME));
    console.log("[DB] Columnas pricing encontradas:", [...found].join(", ") || "ninguna");

    if (!found.has("pricing_type")) {
      await conn.execute("ALTER TABLE `experiences` ADD COLUMN `pricing_type` ENUM('per_person','per_unit') NOT NULL DEFAULT 'per_person'");
      console.log("[DB] ✅ Columna pricing_type añadida");
    }
    if (!found.has("unit_capacity")) {
      await conn.execute("ALTER TABLE `experiences` ADD COLUMN `unit_capacity` INT NULL");
      console.log("[DB] ✅ Columna unit_capacity añadida");
    }
    if (!found.has("max_units")) {
      await conn.execute("ALTER TABLE `experiences` ADD COLUMN `max_units` INT NULL");
      console.log("[DB] ✅ Columna max_units añadida");
    }
    if (!found.has("has_time_slots")) {
      await conn.execute("ALTER TABLE `experiences` ADD COLUMN `has_time_slots` BOOLEAN NOT NULL DEFAULT false");
      console.log("[DB] ✅ Columna has_time_slots añadida");
    }

    // Check reservations columns too
    const [resCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
       AND COLUMN_NAME IN ('pricing_type','unit_capacity','units_booked')`
    ) as any[];
    const foundRes = new Set(resCols.map((c: any) => c.COLUMN_NAME));
    if (!foundRes.has("pricing_type")) {
      await conn.execute("ALTER TABLE `reservations` ADD COLUMN `pricing_type` VARCHAR(16) NULL");
      console.log("[DB] ✅ reservations.pricing_type añadida");
    }
    if (!foundRes.has("unit_capacity")) {
      await conn.execute("ALTER TABLE `reservations` ADD COLUMN `unit_capacity` INT NULL");
      console.log("[DB] ✅ reservations.unit_capacity añadida");
    }
    if (!foundRes.has("units_booked")) {
      await conn.execute("ALTER TABLE `reservations` ADD COLUMN `units_booked` INT NULL");
      console.log("[DB] ✅ reservations.units_booked añadida");
    }

    // Check leads.cart_metadata column
    const [leadsCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'
       AND COLUMN_NAME = 'cart_metadata'`
    ) as any[];
    if (leadsCols.length === 0) {
      await conn.execute("ALTER TABLE `leads` ADD COLUMN `cart_metadata` JSON NULL");
      console.log("[DB] ✅ leads.cart_metadata añadida");
    }

    // Asegurar que el enum de quotes.status incluye 'pago_fallido'
    const [enumInfo] = await conn.execute(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'status'`
    ) as any[];
    const currentEnum: string = enumInfo[0]?.COLUMN_TYPE ?? "";
    if (!currentEnum.includes("pago_fallido")) {
      await conn.execute(`ALTER TABLE \`quotes\` MODIFY COLUMN \`status\` ENUM(
        'borrador','enviado','visualizado','aceptado','convertido_carrito','pago_fallido',
        'pagado','convertido_reserva','facturado','rechazado','expirado','perdido'
      ) NOT NULL DEFAULT 'borrador'`);
      console.log("[DB] ✅ quotes.status enum actualizado con 'pago_fallido'");
    }

    // ── Planes de pago fraccionado ────────────────────────────────────────────
    // Columna nullable en quotes (sin romper flujo existente)
    const [quotePlanCol] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
       AND COLUMN_NAME = 'payment_plan_id'`
    ) as any[];
    if ((quotePlanCol as any[]).length === 0) {
      await conn.execute("ALTER TABLE `quotes` ADD COLUMN `payment_plan_id` INT NULL");
      console.log("[DB] ✅ quotes.payment_plan_id añadida");
    }

    // Tabla payment_plans
    const [ppTables] = await conn.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_plans'`
    ) as any[];
    if ((ppTables as any[]).length === 0) {
      await conn.execute(`
        CREATE TABLE \`payment_plans\` (
          \`id\`                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`quote_id\`          INT NOT NULL,
          \`plan_type\`         ENUM('full','installment') NOT NULL DEFAULT 'installment',
          \`total_amount_cents\` INT NOT NULL,
          \`created_by\`        INT NOT NULL,
          \`createdAt\`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_pp_quote (\`quote_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("[DB] ✅ Tabla payment_plans creada");
    }

    // Tabla payment_installments
    const [piTables] = await conn.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_installments'`
    ) as any[];
    if ((piTables as any[]).length === 0) {
      await conn.execute(`
        CREATE TABLE \`payment_installments\` (
          \`id\`                          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`plan_id\`                     INT NOT NULL,
          \`quote_id\`                    INT NOT NULL,
          \`installment_number\`          INT NOT NULL,
          \`amount_cents\`                INT NOT NULL,
          \`due_date\`                    VARCHAR(20) NOT NULL,
          \`status\`                      ENUM('pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
          \`is_required_for_confirmation\` BOOLEAN NOT NULL DEFAULT FALSE,
          \`merchant_order\`              VARCHAR(30) NULL,
          \`reservation_id\`              INT NULL,
          \`payment_method\`              VARCHAR(32) NULL,
          \`paidAt\`                      TIMESTAMP NULL,
          \`paid_by\`                     VARCHAR(128) NULL,
          \`reminders_sent\`              INT NOT NULL DEFAULT 0,
          \`lastReminderAt\`              TIMESTAMP NULL,
          \`notes\`                       TEXT NULL,
          \`createdAt\`                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\`                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_pi_plan (\`plan_id\`),
          INDEX idx_pi_quote (\`quote_id\`),
          INDEX idx_pi_merchant (\`merchant_order\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("[DB] ✅ Tabla payment_installments creada");
    }

    // Final test
    try {
      const [rows] = await conn.execute(
        "SELECT id, pricing_type, unit_capacity, max_units, has_time_slots FROM experiences LIMIT 1"
      ) as any[];
      console.log(`[DB] ✅ Test query OK — ${rows.length} fila(s)`);
    } catch (qErr: any) {
      console.error("[DB] ❌ Test query FALLÓ:", qErr.message);
    }

    // ── Columnas de anulaciones parciales ────────────────────────────────────
    const [cancelCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cancellation_requests'
       AND COLUMN_NAME IN ('cancellation_scope','cancelled_items_json')`
    ) as any[];
    const foundCancel = new Set((cancelCols as any[]).map((c: any) => c.COLUMN_NAME));

    if (!foundCancel.has("cancellation_scope")) {
      await conn.execute(
        "ALTER TABLE `cancellation_requests` ADD COLUMN `cancellation_scope` VARCHAR(10) NOT NULL DEFAULT 'total' AFTER `cancellation_number`"
      );
      console.log("[DB] ✅ cancellation_requests.cancellation_scope añadida");
    }
    if (!foundCancel.has("cancelled_items_json")) {
      await conn.execute(
        "ALTER TABLE `cancellation_requests` ADD COLUMN `cancelled_items_json` TEXT NULL AFTER `cancellation_scope`"
      );
      console.log("[DB] ✅ cancellation_requests.cancelled_items_json añadida");
    }

    await conn.end();
  } catch (err: any) {
    console.error("[DB] Error en ensurePricingColumns:", err.message);
  }
}

async function ensureExpenseEmailIngestionSchema() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    // Columnas nuevas en expenses (ingesta email)
    const [expCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
       AND COLUMN_NAME IN ('source','emailMessageId','emailFrom','missingAttachment')`
    ) as any[];
    const foundExpCols = new Set((expCols as any[]).map((c: any) => c.COLUMN_NAME));

    if (!foundExpCols.has("source")) {
      await conn.execute("ALTER TABLE `expenses` ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'manual'");
      console.log("[DB] ✅ expenses.source añadida");
    }
    if (!foundExpCols.has("emailMessageId")) {
      await conn.execute("ALTER TABLE `expenses` ADD COLUMN `emailMessageId` VARCHAR(512) NULL");
      console.log("[DB] ✅ expenses.emailMessageId añadida");
    }
    if (!foundExpCols.has("emailFrom")) {
      await conn.execute("ALTER TABLE `expenses` ADD COLUMN `emailFrom` VARCHAR(256) NULL");
      console.log("[DB] ✅ expenses.emailFrom añadida");
    }
    if (!foundExpCols.has("missingAttachment")) {
      await conn.execute("ALTER TABLE `expenses` ADD COLUMN `missingAttachment` BOOLEAN NOT NULL DEFAULT FALSE");
      console.log("[DB] ✅ expenses.missingAttachment añadida");
    }

    // Tabla de logs de ingesta
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`expense_email_ingestion_logs\` (
        \`id\`               INT AUTO_INCREMENT PRIMARY KEY,
        \`message_id\`       VARCHAR(512) NOT NULL,
        \`subject\`          VARCHAR(512) NULL,
        \`sender\`           VARCHAR(256) NULL,
        \`received_at\`      TIMESTAMP NULL,
        \`status\`           ENUM('processed','duplicated','invalid_subject','missing_amount','error') NOT NULL,
        \`expense_id\`       INT NULL,
        \`amount_detected\`  DECIMAL(12,2) NULL,
        \`attachments_count\` INT NOT NULL DEFAULT 0,
        \`error_message\`    TEXT NULL,
        \`processed_at\`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_eeil_message_id (\`message_id\`),
        INDEX idx_eeil_status     (\`status\`),
        INDEX idx_eeil_processed  (\`processed_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Feature flag para el job
    await conn.execute(
      `INSERT IGNORE INTO feature_flags (\`key\`, \`name\`, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, ?, 0, 0, 'low')`,
      [
        "expense_email_ingestion_enabled",
        "Ingesta gastos por email",
        "Activa el job periódico que lee emails con asunto #gasto y crea gastos automáticamente",
        "expenses",
      ]
    );

    // Feature flag — módulo de Email Comercial (bandeja IMAP/SMTP multi-cuenta)
    await conn.execute(
      `INSERT IGNORE INTO feature_flags (\`key\`, \`name\`, description, module, enabled, default_enabled, risk_level)
       VALUES (?, ?, ?, ?, 0, 0, 'low')`,
      [
        "commercial_email_enabled",
        "Email Comercial",
        "Activa la bandeja de email comercial con sincronización IMAP multi-cuenta y el módulo de configuración de cuentas.",
        "commercial_email",
      ]
    );

    // Tablas del módulo de Email Comercial
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`email_accounts\` (
        \`id\`                  INT AUTO_INCREMENT PRIMARY KEY,
        \`name\`                VARCHAR(100) NOT NULL,
        \`email\`               VARCHAR(320) NOT NULL,
        \`imap_host\`           VARCHAR(255) NOT NULL DEFAULT '',
        \`imap_port\`           INT NOT NULL DEFAULT 993,
        \`imap_secure\`         TINYINT(1) NOT NULL DEFAULT 1,
        \`imap_user\`           VARCHAR(320) NOT NULL DEFAULT '',
        \`imap_password_enc\`   TEXT NOT NULL,
        \`smtp_host\`           VARCHAR(255) NOT NULL DEFAULT '',
        \`smtp_port\`           INT NOT NULL DEFAULT 587,
        \`smtp_secure\`         TINYINT(1) NOT NULL DEFAULT 0,
        \`smtp_user\`           VARCHAR(320) NOT NULL DEFAULT '',
        \`smtp_password_enc\`   TEXT NOT NULL,
        \`from_name\`           VARCHAR(255) NOT NULL DEFAULT '',
        \`from_email\`          VARCHAR(320) NOT NULL DEFAULT '',
        \`is_active\`           TINYINT(1) NOT NULL DEFAULT 1,
        \`is_default\`          TINYINT(1) NOT NULL DEFAULT 0,
        \`sync_enabled\`        TINYINT(1) NOT NULL DEFAULT 1,
        \`sync_interval_min\`   INT NOT NULL DEFAULT 5,
        \`last_sync_at\`        TIMESTAMP NULL,
        \`last_sync_error\`     TEXT NULL,
        \`folder_inbox\`        VARCHAR(100) NOT NULL DEFAULT 'INBOX',
        \`folder_sent\`         VARCHAR(100) NOT NULL DEFAULT 'Sent',
        \`folder_archive\`      VARCHAR(100) NOT NULL DEFAULT 'Archive',
        \`folder_trash\`        VARCHAR(100) NOT NULL DEFAULT 'Trash',
        \`max_emails_per_sync\` INT NOT NULL DEFAULT 50,
        \`created_at\`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`commercial_emails\` (
        \`id\`                    INT AUTO_INCREMENT PRIMARY KEY,
        \`account_id\`            INT NOT NULL,
        \`message_id\`            VARCHAR(512) NOT NULL,
        \`in_reply_to\`           VARCHAR(512) NULL,
        \`from_email\`            VARCHAR(320) NOT NULL,
        \`from_name\`             VARCHAR(255) NULL,
        \`to_emails\`             JSON NOT NULL,
        \`cc_emails\`             JSON NOT NULL,
        \`subject\`               VARCHAR(512) NOT NULL,
        \`body_html\`             MEDIUMTEXT NULL,
        \`body_text\`             MEDIUMTEXT NULL,
        \`snippet\`               VARCHAR(300) NULL,
        \`sent_at\`               TIMESTAMP NULL,
        \`is_read\`               TINYINT(1) NOT NULL DEFAULT 0,
        \`is_answered\`           TINYINT(1) NOT NULL DEFAULT 0,
        \`is_archived\`           TINYINT(1) NOT NULL DEFAULT 0,
        \`is_deleted\`            TINYINT(1) NOT NULL DEFAULT 0,
        \`is_sent\`               TINYINT(1) NOT NULL DEFAULT 0,
        \`folder\`                VARCHAR(100) NOT NULL DEFAULT 'INBOX',
        \`has_attachments\`       TINYINT(1) NOT NULL DEFAULT 0,
        \`labels\`                JSON NULL,
        \`assigned_user_id\`      INT NULL,
        \`linked_lead_id\`        INT NULL,
        \`linked_client_id\`      INT NULL,
        \`linked_quote_id\`       INT NULL,
        \`linked_reservation_id\` INT NULL,
        \`imap_uid\`              INT NULL,
        \`created_at\`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_ce_msg_id\` (\`message_id\`(255)),
        INDEX \`idx_ce_account\`    (\`account_id\`),
        INDEX \`idx_ce_sent_at\`    (\`sent_at\`),
        INDEX \`idx_ce_from_email\` (\`from_email\`(100)),
        INDEX \`idx_ce_folder\`     (\`folder\`),
        INDEX \`idx_ce_is_read\`    (\`is_read\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("[DB] Tablas email_accounts y commercial_emails verificadas");

    // Columna de metadatos de adjuntos (añadida en mayo 2026)
    await conn.execute(
      "ALTER TABLE commercial_emails ADD COLUMN IF NOT EXISTS attachments_meta JSON NULL"
    ).catch(() => {});

    await conn.end();
    console.log("[DB] Schema expense email ingestion verificado");
  } catch (err: any) {
    console.error("[DB] Error en ensureExpenseEmailIngestionSchema:", err.message);
  }
}

async function ensureRefundColumns() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cancellation_requests'
       AND COLUMN_NAME IN ('refund_executed_at', 'refund_proof_url')`
    ) as any[];
    const found = new Set(cols.map((c: any) => c.COLUMN_NAME));

    if (!found.has("refund_executed_at")) {
      await conn.execute("ALTER TABLE `cancellation_requests` ADD COLUMN `refund_executed_at` TIMESTAMP NULL");
      console.log("[DB] ✅ cancellation_requests.refund_executed_at añadida");
    }
    if (!found.has("refund_proof_url")) {
      await conn.execute("ALTER TABLE `cancellation_requests` ADD COLUMN `refund_proof_url` VARCHAR(512) NULL");
      console.log("[DB] ✅ cancellation_requests.refund_proof_url añadida");
    }

    await conn.end();
  } catch (err: any) {
    console.error("[DB] Error en ensureRefundColumns:", err.message);
  }
}

async function ensureDiscountColumns() {
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discount_codes'
       AND COLUMN_NAME IN ('discount_type', 'discount_amount', 'origin', 'compensation_voucher_id', 'client_email', 'client_name')`
    ) as any[];
    const found = new Set(cols.map((c: any) => c.COLUMN_NAME));

    if (!found.has("discount_type")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `discount_type` enum('percent','fixed') NOT NULL DEFAULT 'percent'");
      console.log("[DB] ✅ discount_codes.discount_type añadida");
    }
    if (!found.has("discount_amount")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `discount_amount` decimal(10,2) NULL");
      console.log("[DB] ✅ discount_codes.discount_amount añadida");
    }
    if (!found.has("origin")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `origin` enum('manual','voucher') NOT NULL DEFAULT 'manual'");
      console.log("[DB] ✅ discount_codes.origin añadida");
    }
    if (!found.has("compensation_voucher_id")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `compensation_voucher_id` int NULL");
      console.log("[DB] ✅ discount_codes.compensation_voucher_id añadida");
    }
    if (!found.has("client_email")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `client_email` varchar(256) NULL");
      console.log("[DB] ✅ discount_codes.client_email añadida");
    }
    if (!found.has("client_name")) {
      await conn.execute("ALTER TABLE `discount_codes` ADD COLUMN `client_name` varchar(256) NULL");
      console.log("[DB] ✅ discount_codes.client_name añadida");
    }

    // Corregir retroactivamente bonos de compensación: si discount_amount > 0 y discount_type = 'percent' → fijar como 'fixed'
    const [fixed] = await conn.execute(
      `UPDATE \`discount_codes\` SET \`discount_type\` = 'fixed'
       WHERE \`origin\` = 'voucher' AND \`discount_amount\` > 0 AND \`discount_type\` = 'percent'`
    ) as any[];
    if ((fixed as any).affectedRows > 0) {
      console.log(`[DB] ✅ ${(fixed as any).affectedRows} código(s) bono corregidos a discount_type='fixed'`);
    }

    await conn.end();
  } catch (err: any) {
    console.error("[DB] Error en ensureDiscountColumns:", err.message);
  }
}

// ─── WIPE TEST DATA (one-shot, gated by WIPE_TEST_DATA=true env var) ──────────
async function wipeTestDataIfRequested() {
  if (process.env.WIPE_TEST_DATA !== "true" || process.env.NODE_ENV === "production") return;

  console.log("[Wipe] ⚠️  WIPE_TEST_DATA=true detectado — limpiando datos de prueba...");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);

  // Helper: count + truncate with log
  async function wipe(table: string) {
    const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``) as any[];
    const cnt = rows[0].cnt;
    if (cnt > 0) {
      await conn.execute(`DELETE FROM \`${table}\``);
      console.log(`[Wipe] ✓ ${table}: ${cnt} registros eliminados`);
    } else {
      console.log(`[Wipe] — ${table}: ya vacía`);
    }
  }

  try {
    await conn.execute("SET FOREIGN_KEY_CHECKS=0");

    // Child tables first (FK dependencies)
    await wipe("discount_code_uses");      // Bonos (usos)
    await wipe("booking_monitors");        // Reservas (hijos de bookings)
    await wipe("reservation_operational"); // Reservas operacional
    await wipe("cancellation_requests");   // Anulaciones
    await wipe("crm_activity_log");        // Leads activity
    await wipe("ghl_webhook_logs");        // Leads GHL

    // Parent tables
    await wipe("pending_payments");        // Pagos Pendientes
    await wipe("daily_orders");            // Calendario / Actividades del día
    await wipe("invoices");                // Facturas
    await wipe("bookings");                // Reservas
    await wipe("reservations");            // Reservas principal
    await wipe("quotes");                  // Presupuestos
    await wipe("leads");                   // Leads

    await conn.execute("SET FOREIGN_KEY_CHECKS=1");
    console.log("[Wipe] ✅ Limpieza completada. REAV, liquidaciones, transacciones y catálogo intactos.");
    console.log("[Wipe] ⚠️  Retira la variable WIPE_TEST_DATA del entorno para el próximo deploy.");
  } catch (err: any) {
    await conn.execute("SET FOREIGN_KEY_CHECKS=1").catch(() => {});
    console.error("[Wipe] ❌ Error durante la limpieza:", err.message);
  } finally {
    await conn.end();
  }
}

// ─── ABANDONED CHECKOUT CLEANUP ───────────────────────────────────────────────
// Cada 20 minutos busca reservas pending_payment+ONLINE_DIRECTO sin pago durante
// más de 60 minutos. Las convierte en leads "Venta Perdida" y las cancela.
// Esto cubre el caso en que el cliente abandona el pago sin que Redsys envíe IPN.
function startAbandonedCheckoutCleanup() {
  const CHECK_INTERVAL_MS        = 10 * 60 * 1000;  // 10 min
  const STALE_DIRECT_MS          = 10 * 60 * 1000;  // Flujo 2: compra directa → Venta Perdida tras 10 min
  const STALE_QUOTE_MS           = 60 * 60 * 1000;  // Flujo 1: presupuesto → pago_fallido tras 60 min

  let _abandonedPool: any = null;
  let _abandonedDb: any = null;

  async function run() {
    try {
      const mysql = await import("mysql2/promise");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { reservations, quotes } = await import("../../drizzle/schema");
      const { eq, and, lte, isNotNull } = await import("drizzle-orm");
      const { createVentaPerdidaLead, logActivity } = await import("../db");

      if (!_abandonedPool) {
        _abandonedPool = mysql.default.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
        _abandonedDb = drizzle(_abandonedPool);
      }
      const db = _abandonedDb;

      const staleDirectThreshold = Date.now() - STALE_DIRECT_MS;
      const staleQuoteThreshold  = Date.now() - STALE_QUOTE_MS;

      // ── Caso A: checkout directo ONLINE_DIRECTO sin presupuesto → Venta Perdida ──
      const stale = await db
        .select()
        .from(reservations)
        .where(and(
          eq(reservations.status, "pending_payment"),
          eq(reservations.channel, "ONLINE_DIRECTO"),
          lte(reservations.createdAt as any, staleDirectThreshold)
        ));

      const byOrder = new Map<string, typeof stale>();
      for (const r of stale) {
        if ((r as any).quoteId) continue; // Reservas de presupuesto: se tratan en Caso B
        const key = r.merchantOrder;
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key)!.push(r);
      }

      for (const [order, group] of byOrder) {
        await createVentaPerdidaLead(group as any);
        await db
          .update(reservations)
          .set({ status: "cancelled", updatedAt: Date.now() } as any)
          .where(and(eq(reservations.merchantOrder, order), eq(reservations.status, "pending_payment")));
        console.log(`[AbandonedCheckout] Checkout abandonado ${order} cancelado → Lead Venta Perdida registrado`);
      }

      // ── Caso B: reserva vinculada a presupuesto + 60 min sin pago → pago_fallido ──
      const staleQuoteReservations = await db
        .select({ id: reservations.id, quoteId: reservations.quoteId, merchantOrder: reservations.merchantOrder })
        .from(reservations)
        .where(and(
          eq(reservations.status, "pending_payment"),
          isNotNull(reservations.quoteId),
          lte(reservations.createdAt as any, staleQuoteThreshold)
        ));

      for (const resv of staleQuoteReservations) {
        if (!resv.quoteId) continue;
        try {
          const [currentQuote] = await db
            .select({ id: quotes.id, status: quotes.status, viewedAt: quotes.viewedAt })
            .from(quotes).where(eq(quotes.id, resv.quoteId)).limit(1);

          if (!currentQuote || currentQuote.status === "pagado" || currentQuote.status === "aceptado") continue;

          const now = new Date();

          // Marcar la reserva como failed para que el próximo intento genere un nuevo merchantOrder
          // Sin esto, payWithToken reutiliza el mismo merchantOrder y Redsys devuelve "Número de pedido repetido"
          await db.update(reservations).set({ status: "failed", updatedAt: Date.now() } as any)
            .where(eq(reservations.id, resv.id));

          await db.update(quotes).set({
            status: "pago_fallido",
            viewedAt: currentQuote.viewedAt ?? now,
            updatedAt: now,
          }).where(eq(quotes.id, resv.quoteId));

          await logActivity("quote", resv.quoteId, "payment_abandoned_timeout", null, "Sistema (AbandonedCheckout)", {
            merchantOrder: resv.merchantOrder,
            reservationId: resv.id,
            staleAfterMinutes: 60,
          });

          console.log(`[AbandonedCheckout] Presupuesto id=${resv.quoteId} → pago_fallido, reserva ${resv.merchantOrder} → failed (sin pago tras 60 min)`);
        } catch (qErr: any) {
          console.error(`[AbandonedCheckout] Error actualizando quote id=${resv.quoteId}:`, qErr.message);
        }
      }

    } catch (err: any) {
      console.error("[AbandonedCheckout] Error en limpieza:", err.message, err.cause ?? "");
    }
    setTimeout(run, CHECK_INTERVAL_MS);
  }

  // Primera ejecución tras arranque completo (evita competir con las migraciones)
  setTimeout(run, CHECK_INTERVAL_MS);
  console.log("[AbandonedCheckout] Job iniciado — checkeo de checkouts abandonados cada 20 min");
}

// ─── INSTALLMENT OVERDUE + REMINDER JOB ──────────────────────────────────────
// Cada hora: marca como 'overdue' las cuotas vencidas y envía recordatorio
// por email a los clientes con cuotas que vencen en 3 días.
function startInstallmentOverdueJob() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

  let _installmentPool: any = null;
  let _installmentDb: any = null;

  async function run() {
    try {
      const mysql = await import("mysql2/promise");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { paymentInstallments, quotes, leads } = await import("../../drizzle/schema");
      const { eq, and, lte, lt, ne, sql } = await import("drizzle-orm");
      const { sendEmail } = await import("../mailer");
      const { buildInstallmentReminderHtml } = await import("../emailTemplates");

      if (!_installmentPool) {
        _installmentPool = mysql.default.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
        _installmentDb = drizzle(_installmentPool);
      }
      const db = _installmentDb;
      const todayStr = new Date().toISOString().split("T")[0];

      // 1. Marcar como vencidas cuotas pending cuya fecha de vencimiento ha pasado
      const overdueResult = await db
        .update(paymentInstallments)
        .set({ status: "overdue", updatedAt: new Date() })
        .where(and(
          eq(paymentInstallments.status, "pending"),
          lte(paymentInstallments.dueDate, todayStr),
        ));
      const overdueCount = (overdueResult[0] as any).affectedRows ?? 0;
      if (overdueCount > 0) {
        console.log(`[InstallmentJob] ${overdueCount} cuota(s) marcadas como vencidas`);
      }

      // 2. Enviar recordatorio por email a cuotas que vencen en exactamente 3 días
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + 3);
      const reminderDateStr = reminderDate.toISOString().split("T")[0];

      const dueIn3Days = await db
        .select({
          id: paymentInstallments.id,
          quoteId: paymentInstallments.quoteId,
          installmentNumber: paymentInstallments.installmentNumber,
          amountCents: paymentInstallments.amountCents,
          dueDate: paymentInstallments.dueDate,
          remindersSent: paymentInstallments.remindersSent,
          quoteNumber: quotes.quoteNumber,
          clientEmail: leads.email,
          clientName: leads.name,
        })
        .from(paymentInstallments)
        .innerJoin(quotes, eq(quotes.id, paymentInstallments.quoteId))
        .leftJoin(leads, eq(leads.id, quotes.leadId))
        .where(and(
          eq(paymentInstallments.status, "pending"),
          eq(paymentInstallments.dueDate, reminderDateStr),
          lt(paymentInstallments.remindersSent, 1),
          sql.raw(`EXISTS (SELECT 1 FROM payment_installments pi2 WHERE pi2.quote_id = payment_installments.quote_id AND pi2.status = 'paid')`),
        ));

      for (const inst of dueIn3Days) {
        if (!inst.clientEmail) continue;
        // Contar total cuotas del mismo quote
        const allInstallments = await db
          .select({ id: paymentInstallments.id })
          .from(paymentInstallments)
          .where(eq(paymentInstallments.quoteId, inst.quoteId));

        try {
          const html = buildInstallmentReminderHtml({
            clientName: inst.clientName ?? "Cliente",
            clientEmail: inst.clientEmail,
            quoteNumber: inst.quoteNumber ?? "",
            installmentNumber: inst.installmentNumber,
            totalInstallments: allInstallments.length,
            amountFormatted: `${(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`,
            dueDate: inst.dueDate,
          });
          await sendEmail({
            to: inst.clientEmail,
            subject: `Recordatorio: cuota ${inst.installmentNumber}/${allInstallments.length} vence el ${inst.dueDate}`,
            html,
          });
          await db
            .update(paymentInstallments)
            .set({ remindersSent: (inst.remindersSent ?? 0) + 1, lastReminderAt: new Date(), updatedAt: new Date() })
            .where(eq(paymentInstallments.id, inst.id));
          console.log(`[InstallmentJob] Recordatorio enviado a ${inst.clientEmail} — cuota #${inst.installmentNumber} de ${inst.quoteNumber}`);
        } catch (emailErr: any) {
          console.error(`[InstallmentJob] Error enviando recordatorio cuota ${inst.id}:`, emailErr.message);
        }
      }
    } catch (err: any) {
      console.error("[InstallmentJob] Error en job:", err.message);
    }
    setTimeout(run, CHECK_INTERVAL_MS);
  }

  setTimeout(run, 5 * 60 * 1000); // Primera ejecución 5 min tras arranque
  console.log("[InstallmentJob] Job iniciado — cuotas vencidas + recordatorios cada hora");
}

async function fixBrokenInvoicePdfUrls() {
  try {
    const mysql = await import("mysql2/promise");
    const { drizzle } = await import("drizzle-orm/mysql2");
    const { sql } = await import("drizzle-orm");
    const conn = await mysql.default.createConnection(process.env.DATABASE_URL!);
    const db = drizzle(conn);
    const result = await db.execute(sql`
      UPDATE invoices
      SET \`pdfUrl\` = CONCAT('/api/invoices/preview?n=', \`invoiceNumber\`),
          \`pdfKey\` = ''
      WHERE \`pdfUrl\` LIKE '/local-storage/%'
    `);
    const affected = (result[0] as any).affectedRows ?? 0;
    if (affected > 0) console.log(`[Startup] Corregidas ${affected} facturas con URL /local-storage/ rota → on-demand`);
    await conn.end();
  } catch (e) {
    console.error("[Startup] Error corrigiendo URLs de facturas:", e);
  }
}

async function conditionallyStartJob(
  flagKey: string,
  start: () => void,
  label: string,
  defaultEnabled = false,
): Promise<void> {
  const enabled = await getFeatureFlag(flagKey, defaultEnabled);
  if (enabled) {
    start();
  } else {
    console.log(`[Jobs] '${label}' desactivado — feature flag '${flagKey}' está inactivo`);
  }
}

runMigrations()
  .then(() => ensureCriticalSeeds())
  .then(() => migrateSiteSettingsToSystemSettings())
  .then(() => ensurePricingColumns())
  .then(() => ensureRefundColumns())
  .then(() => ensureDiscountColumns())
  .then(() => ensureExpenseEmailIngestionSchema())
  .then(() => fixBrokenInvoicePdfUrls())
  .then(() => wipeTestDataIfRequested())
  .then(() => seedExperiencesIfEmpty())
  .then(() => startServer())
  .then(() => conditionallyStartJob("quote_reminder_job_enabled",          startQuoteReminderJob,         "Quote Reminder"))
  .then(() => conditionallyStartJob("commercial_followup_job_enabled",     startCommercialFollowupJob,    "Commercial Followup"))
  .then(() => conditionallyStartJob("abandoned_checkout_cleanup_enabled",  startAbandonedCheckoutCleanup, "Abandoned Checkout"))
  .then(() => conditionallyStartJob("installment_overdue_job_enabled",     startInstallmentOverdueJob,    "Installment Overdue"))
  .then(() => conditionallyStartJob("cancellation_stale_job_enabled",      startCancellationStaleJob,     "Cancellation Stale"))
  .then(() => conditionallyStartJob("email_ingestion_enabled",             startEmailIngestionJob,              "Email Ingestion"))
  .then(() => conditionallyStartJob("expense_email_ingestion_enabled",     startExpenseEmailIngestionJob,       "Expense Email Ingestion"))
  .then(() => conditionallyStartJob("commercial_email_enabled",            startCommercialEmailSyncJob,          "Commercial Email Sync"))
  .then(() => conditionallyStartJob("card_terminal_matching_enabled", startMatchingJob, "Card Terminal Matching", true))
  .then(() => conditionallyStartJob("card_terminal_relink_enabled",   startRelinkJob,   "Card Terminal Relink",   true))
  .catch(console.error);

