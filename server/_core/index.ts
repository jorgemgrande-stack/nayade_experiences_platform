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
      const vals = [exp.slug,exp.title,exp.shortDescription,exp.description,exp.coverImageUrl,exp.image1,exp.image2??null,exp.image3??null,exp.image4??null,exp.basePrice,exp.duration??null,exp.minPersons,exp.maxPersons,exp.difficulty,exp.isFeatured,exp.isActive,exp.isPublished,exp.isPresentialSale,exp.categoryId,exp.locationId,exp.includes,exp.excludes,"general_21","actividad","per_person",exp.sortOrder];
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

    // Final test
    try {
      const [rows] = await conn.execute(
        "SELECT id, pricing_type, unit_capacity, max_units, has_time_slots FROM experiences LIMIT 1"
      ) as any[];
      console.log(`[DB] ✅ Test query OK — ${rows.length} fila(s)`);
    } catch (qErr: any) {
      console.error("[DB] ❌ Test query FALLÓ:", qErr.message);
    }

    await conn.end();
  } catch (err: any) {
    console.error("[DB] Error en ensurePricingColumns:", err.message);
  }
}

// ─── WIPE TEST DATA (one-shot, gated by WIPE_TEST_DATA=true env var) ──────────
async function wipeTestDataIfRequested() {
  if (process.env.WIPE_TEST_DATA !== "true") return;

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
  const CHECK_INTERVAL_MS = 20 * 60 * 1000;  // 20 min
  const STALE_AFTER_MS    = 60 * 60 * 1000;  // 60 min sin confirmar = abandonado

  async function run() {
    try {
      const mysql = await import("mysql2/promise");
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { reservations, quotes } = await import("../../drizzle/schema");
      const { eq, and, lte, isNotNull } = await import("drizzle-orm");
      const { createVentaPerdidaLead, logActivity } = await import("../db");

      const pool = mysql.default.createPool(process.env.DATABASE_URL!);
      const db = drizzle(pool);

      const staleThreshold = Date.now() - STALE_AFTER_MS;

      // ── Caso A: checkout directo ONLINE_DIRECTO sin presupuesto → Venta Perdida ──
      const stale = await db
        .select()
        .from(reservations)
        .where(and(
          eq(reservations.status, "pending_payment"),
          eq(reservations.channel, "ONLINE_DIRECTO"),
          lte(reservations.createdAt as any, staleThreshold)
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
          lte(reservations.createdAt as any, staleThreshold)
        ));

      for (const resv of staleQuoteReservations) {
        if (!resv.quoteId) continue;
        try {
          const [currentQuote] = await db
            .select({ id: quotes.id, status: quotes.status, viewedAt: quotes.viewedAt })
            .from(quotes).where(eq(quotes.id, resv.quoteId)).limit(1);

          if (!currentQuote || currentQuote.status === "pagado" || currentQuote.status === "aceptado") continue;

          const now = new Date();
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

          console.log(`[AbandonedCheckout] Presupuesto id=${resv.quoteId} → pago_fallido (reserva ${resv.merchantOrder} sin pago tras 60 min)`);
        } catch (qErr: any) {
          console.error(`[AbandonedCheckout] Error actualizando quote id=${resv.quoteId}:`, qErr.message);
        }
      }

      await pool.end();
    } catch (err: any) {
      console.error("[AbandonedCheckout] Error en limpieza:", err.message, err.cause ?? "");
    }
    setTimeout(run, CHECK_INTERVAL_MS);
  }

  // Primera ejecución tras arranque completo (evita competir con las migraciones)
  setTimeout(run, CHECK_INTERVAL_MS);
  console.log("[AbandonedCheckout] Job iniciado — checkeo de checkouts abandonados cada 20 min");
}

runMigrations()
  .then(() => ensurePricingColumns())
  .then(() => wipeTestDataIfRequested())
  .then(() => seedExperiencesIfEmpty())
  .then(() => startServer())
  .then(() => startQuoteReminderJob())
  .then(() => startAbandonedCheckoutCleanup())
  .catch(console.error);
