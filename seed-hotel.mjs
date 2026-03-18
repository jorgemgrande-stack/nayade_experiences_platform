import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not found");

const conn = await createConnection(DATABASE_URL);
console.log("Connected to DB");

// ── 1. CREATE TABLES (TiDB-compatible syntax) ─────────────────────────────────
await conn.execute(`
  CREATE TABLE IF NOT EXISTS room_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(256) NOT NULL UNIQUE,
    name VARCHAR(256) NOT NULL,
    shortDescription TEXT,
    description TEXT,
    coverImageUrl TEXT,
    image1 TEXT,
    image2 TEXT,
    image3 TEXT,
    image4 TEXT,
    gallery JSON,
    maxAdults INT NOT NULL DEFAULT 2,
    maxChildren INT NOT NULL DEFAULT 0,
    maxOccupancy INT NOT NULL DEFAULT 2,
    surfaceM2 INT,
    amenities JSON,
    basePrice DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
    totalUnits INT NOT NULL DEFAULT 1,
    isFeatured TINYINT(1) NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    sortOrder INT NOT NULL DEFAULT 0,
    metaTitle VARCHAR(256),
    metaDescription TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✓ room_types table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS room_rate_seasons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    startDate VARCHAR(10) NOT NULL,
    endDate VARCHAR(10) NOT NULL,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    sortOrder INT NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ room_rate_seasons table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS room_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    roomTypeId INT NOT NULL,
    seasonId INT,
    dayOfWeek INT,
    specificDate VARCHAR(10),
    pricePerNight DECIMAL(10,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
    supplement DECIMAL(10,2) DEFAULT 0,
    supplementLabel VARCHAR(128),
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✓ room_rates table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS room_blocks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    roomTypeId INT NOT NULL,
    date VARCHAR(10) NOT NULL,
    availableUnits INT NOT NULL DEFAULT 0,
    reason VARCHAR(256),
    createdBy INT,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✓ room_blocks table ready");

// SPA tables
await conn.execute(`
  CREATE TABLE IF NOT EXISTS spa_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    iconName VARCHAR(64),
    sortOrder INT NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ spa_categories table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS spa_resources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('cabina','terapeuta') NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    sortOrder INT NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ spa_resources table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS spa_treatments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(256) NOT NULL UNIQUE,
    name VARCHAR(256) NOT NULL,
    categoryId INT,
    shortDescription TEXT,
    description TEXT,
    benefits JSON,
    coverImageUrl TEXT,
    image1 TEXT,
    image2 TEXT,
    gallery JSON,
    durationMinutes INT NOT NULL DEFAULT 60,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
    maxPersons INT NOT NULL DEFAULT 1,
    cabinRequired TINYINT(1) NOT NULL DEFAULT 1,
    isFeatured TINYINT(1) NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    sortOrder INT NOT NULL DEFAULT 0,
    metaTitle VARCHAR(256),
    metaDescription TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✓ spa_treatments table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS spa_schedule_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    treatmentId INT NOT NULL,
    resourceId INT,
    dayOfWeek INT NOT NULL,
    startTime VARCHAR(5) NOT NULL,
    endTime VARCHAR(5) NOT NULL,
    capacity INT NOT NULL DEFAULT 1,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ spa_schedule_templates table ready");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS spa_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    treatmentId INT NOT NULL,
    resourceId INT,
    date VARCHAR(10) NOT NULL,
    startTime VARCHAR(5) NOT NULL,
    endTime VARCHAR(5) NOT NULL,
    capacity INT NOT NULL DEFAULT 1,
    bookedCount INT NOT NULL DEFAULT 0,
    status ENUM('disponible','reservado','bloqueado') NOT NULL DEFAULT 'disponible',
    notes TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log("✓ spa_slots table ready");

// ── 2. SEED room_types ────────────────────────────────────────────────────────
await conn.execute("DELETE FROM room_rates");
await conn.execute("DELETE FROM room_rate_seasons");
await conn.execute("DELETE FROM room_blocks");
await conn.execute("DELETE FROM room_types");
console.log("✓ Cleared existing hotel data");

const amenitiesEstandar = JSON.stringify(["WiFi gratuito","Desayuno incluido","Aire acondicionado","TV pantalla plana","Baño completo","Caja fuerte","Minibar","Terraza o balcón"]);
const amenitiesLago = JSON.stringify(["WiFi gratuito","Desayuno buffet incluido","Aire acondicionado","TV 4K","Baño con ducha de lluvia","Amenities premium","Caja fuerte","Minibar","Terraza privada con vistas al lago","Albornoz y zapatillas"]);
const amenitiesFamiliar = JSON.stringify(["WiFi gratuito","Desayuno buffet incluido","Aire acondicionado","TV 4K","Baño completo","Zona de estar","Caja fuerte","Minibar","Terraza","Acceso SPA con descuento","Amenities infantiles","Cuna disponible bajo petición"]);
const amenitiesSuite = JSON.stringify(["WiFi premium","Desayuno en habitación incluido","Aire acondicionado","TV 4K 65\"","Jacuzzi privado con vistas","Baño de mármol","Ducha de lluvia y bañera","Amenities de lujo","Caja fuerte grande","Minibar premium","Terraza panorámica","Servicio habitaciones 24h","Acceso SPA ilimitado","Albornoz y zapatillas","Champán de bienvenida"]);

const [r1] = await conn.execute(
  `INSERT INTO room_types (slug, name, shortDescription, description, maxAdults, maxChildren, maxOccupancy, surfaceM2, amenities, basePrice, totalUnits, isFeatured, isActive, sortOrder)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['doble-estandar','Doble Estándar',
   'Habitación doble con todas las comodidades esenciales para una estancia perfecta junto al embalse.',
   'Nuestra habitación Doble Estándar ofrece un espacio acogedor con vistas al entorno natural de Los Ángeles de San Rafael. Equipada con cama doble o dos camas individuales, baño completo, aire acondicionado, WiFi gratuito y desayuno incluido. Ideal para parejas o viajeros que buscan confort y naturaleza a partes iguales.',
   2, 0, 2, 22, amenitiesEstandar, '110.00', 15, 1, 1, 1]
);
const id1 = r1.insertId;

const [r2] = await conn.execute(
  `INSERT INTO room_types (slug, name, shortDescription, description, maxAdults, maxChildren, maxOccupancy, surfaceM2, amenities, basePrice, totalUnits, isFeatured, isActive, sortOrder)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['doble-superior-vistas-lago','Doble Superior Vistas Lago',
   'Habitación doble superior con vistas privilegiadas al embalse de Los Ángeles de San Rafael.',
   'La Doble Superior Vistas Lago es nuestra habitación más demandada. Disfruta de vistas panorámicas al embalse desde tu cama o desde la terraza privada. Cuenta con cama doble king size, baño con ducha de lluvia, amenities premium, WiFi de alta velocidad y desayuno buffet incluido. Una experiencia única frente al agua.',
   2, 0, 2, 28, amenitiesLago, '140.00', 12, 1, 1, 2]
);
const id2 = r2.insertId;

const [r3] = await conn.execute(
  `INSERT INTO room_types (slug, name, shortDescription, description, maxAdults, maxChildren, maxOccupancy, surfaceM2, amenities, basePrice, totalUnits, isFeatured, isActive, sortOrder)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['familiar','Familiar (3-4 personas)',
   'Amplia habitación familiar perfecta para familias de hasta 4 personas con acceso directo a todas las instalaciones.',
   'La habitación Familiar está diseñada para que toda la familia disfrute de una estancia cómoda y memorable. Dispone de una zona de dormitorio para adultos y otra para niños, baño completo, zona de estar, y acceso preferente a las actividades acuáticas del complejo. Incluye desayuno buffet para todos los huéspedes y acceso al SPA con descuento.',
   2, 2, 4, 38, amenitiesFamiliar, '170.00', 8, 0, 1, 3]
);
const id3 = r3.insertId;

const [r4] = await conn.execute(
  `INSERT INTO room_types (slug, name, shortDescription, description, maxAdults, maxChildren, maxOccupancy, surfaceM2, amenities, basePrice, totalUnits, isFeatured, isActive, sortOrder)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['junior-suite-premium','Junior Suite Premium',
   'Suite de lujo con salón independiente, jacuzzi privado y las mejores vistas al embalse.',
   'La Junior Suite Premium es la experiencia más exclusiva del Hotel Náyade. Cuenta con dormitorio king size, salón independiente, jacuzzi privado con vistas al lago, baño de mármol con ducha de lluvia y bañera, terraza panorámica, servicio de habitaciones 24h y acceso ilimitado al SPA. Desayuno en la habitación incluido. Para quienes buscan lo mejor.',
   2, 1, 3, 55, amenitiesSuite, '210.00', 4, 1, 1, 4]
);
const id4 = r4.insertId;

console.log(`✓ Inserted 4 room types: IDs ${id1}, ${id2}, ${id3}, ${id4}`);

// ── 3. SEED rate_seasons ──────────────────────────────────────────────────────
const [s1] = await conn.execute(
  `INSERT INTO room_rate_seasons (name, startDate, endDate, isActive, sortOrder) VALUES (?, ?, ?, ?, ?)`,
  ['Temporada Baja (Marzo)', '2026-03-01', '2026-03-31', 1, 1]
);
const seasonBaja = s1.insertId;

const [s2] = await conn.execute(
  `INSERT INTO room_rate_seasons (name, startDate, endDate, isActive, sortOrder) VALUES (?, ?, ?, ?, ?)`,
  ['Temporada Media (Abr-May)', '2026-04-01', '2026-05-31', 1, 2]
);
const seasonMedia = s2.insertId;

const [s3] = await conn.execute(
  `INSERT INTO room_rate_seasons (name, startDate, endDate, isActive, sortOrder) VALUES (?, ?, ?, ?, ?)`,
  ['Temporada Alta (Jun-Sep)', '2026-06-01', '2026-09-30', 1, 3]
);
const seasonAlta = s3.insertId;

console.log(`✓ Inserted 3 rate seasons: IDs ${seasonBaja}, ${seasonMedia}, ${seasonAlta}`);

// ── 4. SEED room_rates ────────────────────────────────────────────────────────
const ratesData = [
  // Doble Estándar: 110-130-150
  [id1, seasonBaja, '110.00'],
  [id1, seasonMedia, '130.00'],
  [id1, seasonAlta, '150.00'],
  // Doble Superior Vistas Lago: 140-160-180
  [id2, seasonBaja, '140.00'],
  [id2, seasonMedia, '160.00'],
  [id2, seasonAlta, '180.00'],
  // Familiar: 170-195-220
  [id3, seasonBaja, '170.00'],
  [id3, seasonMedia, '195.00'],
  [id3, seasonAlta, '220.00'],
  // Junior Suite Premium: 210-235-260
  [id4, seasonBaja, '210.00'],
  [id4, seasonMedia, '235.00'],
  [id4, seasonAlta, '260.00'],
];

for (const [roomTypeId, seasonId, pricePerNight] of ratesData) {
  await conn.execute(
    `INSERT INTO room_rates (roomTypeId, seasonId, pricePerNight, currency, isActive) VALUES (?, ?, ?, 'EUR', 1)`,
    [roomTypeId, seasonId, pricePerNight]
  );
}
console.log("✓ Inserted 12 room rates (4 tipologías × 3 temporadas)");

// ── 5. SEED room_blocks (inventario abierto Mar-Sep 2026) ─────────────────────
const roomsConfig = [
  { id: id1, units: 15 },
  { id: id2, units: 12 },
  { id: id3, units: 8 },
  { id: id4, units: 4 },
];

const startDate = new Date('2026-03-01');
const endDate = new Date('2026-09-30');

let blockCount = 0;
const batchSize = 200;
let batch = [];

for (const { id: roomTypeId, units } of roomsConfig) {
  const current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    batch.push([roomTypeId, dateStr, units, 'Temporada 2026 abierta']);
    current.setDate(current.getDate() + 1);

    if (batch.length >= batchSize) {
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',');
      await conn.execute(
        `INSERT INTO room_blocks (roomTypeId, date, availableUnits, reason) VALUES ${placeholders}`,
        batch.flat()
      );
      blockCount += batch.length;
      batch = [];
    }
  }
}

if (batch.length > 0) {
  const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',');
  await conn.execute(
    `INSERT INTO room_blocks (roomTypeId, date, availableUnits, reason) VALUES ${placeholders}`,
    batch.flat()
  );
  blockCount += batch.length;
}

console.log(`✓ Inserted ${blockCount} inventory blocks (Mar-Sep 2026, 4 tipologías)`);

await conn.end();
console.log("\n🏨 Hotel Náyade seed completado exitosamente!");
console.log("   - 4 tipologías de habitación");
console.log("   - 3 temporadas de precio (Baja/Media/Alta)");
console.log("   - 12 tarifas (4 tipologías × 3 temporadas)");
console.log(`   - ${blockCount} registros de inventario (Mar-Sep 2026)`);
