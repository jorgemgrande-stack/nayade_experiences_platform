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
import { startQuoteReminderJob } from "../quoteReminderJob";
import { serveStatic, setupVite } from "./vite";

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
    const pool = mysql.createPool(process.env.DATABASE_URL!);
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

runMigrations()
  .then(() => startServer())
  .then(() => startQuoteReminderJob())
  .catch(console.error);
