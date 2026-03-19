import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createLocalContext } from "./context.local";
import { createLocalAuthRouter } from "../localAuth";
import { createPasswordResetRouter } from "../passwordReset";
import { createAuthGuardMiddleware } from "../authGuard";
import uploadRouter from "../uploadRoutes";
import redsysRouter from "../redsysRoutes";
import { serveStatic, setupVite } from "./vite";

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
    // Modo local: rutas de auth propias (login/logout/me) en lugar de Manus OAuth
    app.use(createLocalAuthRouter());
    app.use(createPasswordResetRouter());
    console.log("[Auth] Modo LOCAL_AUTH activado — usando email+password local");
  } else {
    // Modo Manus: OAuth callback
    registerOAuthRoutes(app);
  }

  // Middleware de protección: bloquea rutas /api/trpc de procedimientos protegidos
  // si no hay sesión válida. Funciona en ambos modos (local y Manus OAuth).
  app.use("/api/trpc", createAuthGuardMiddleware(USE_LOCAL_AUTH));
  // File upload endpoint
  app.use(uploadRouter);
  // Redsys IPN notification endpoint
  app.use(redsysRouter);
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

startServer().catch(console.error);
