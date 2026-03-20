/**
 * seed-restaurants.mjs
 * Inserta los 4 restaurantes de Náyade Experiences con sus turnos.
 * Uso: node scripts/seed-restaurants.mjs
 */

import mysql from "mysql2/promise";
import { config } from "dotenv";

config({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL no definida en .env");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

// ─── RESTAURANTES ────────────────────────────────────────────────────────────

const restaurants = [
  {
    slug: "el-galeon",
    name: "El Galeón",
    shortDesc: "Cocina tradicional marinera con vistas al lago",
    longDesc: `El Galeón es el restaurante principal del complejo Náyade, ubicado junto al lago con vistas panorámicas al agua y a la naturaleza circundante. Su cocina se inspira en la tradición marinera castellana, con platos elaborados con productos frescos de temporada y pescados de primera calidad. El ambiente es cálido y acogedor, perfecto para celebraciones familiares y eventos especiales.`,
    cuisine: "Cocina marinera castellana",
    heroImage: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
    galleryImages: JSON.stringify([
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80",
      "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&q=80",
    ]),
    phone: "+34 921 000 001",
    email: "galeon@nayade.es",
    location: "Edificio Principal, Planta Baja",
    badge: "Restaurante Principal",
    depositPerGuest: "5.00",
    maxGroupSize: 30,
    minAdvanceHours: 2,
    maxAdvanceDays: 60,
    cancellationHours: 24,
    cancellationPolicy: "Cancelación gratuita hasta 24 horas antes. El depósito se reembolsa íntegramente si se cancela con más de 24h de antelación.",
    legalText: "El depósito de 5€/comensal se descuenta del total de la cuenta. En caso de no presentarse sin cancelar previamente, el depósito no será reembolsado.",
    operativeEmail: "reservas.galeon@nayade.es",
    acceptsOnlineBooking: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    slug: "nassau-bar",
    name: "Nassau Bar & Music",
    shortDesc: "Bar de copas con música en vivo y ambiente tropical",
    longDesc: `Nassau Bar & Music es el espacio de ocio nocturno del complejo, con una decoración inspirada en el Caribe y una programación musical en vivo los fines de semana. Ofrece una amplia carta de cócteles artesanales, cervezas artesanas y tapas creativas. El ambiente es vibrante y cosmopolita, ideal para disfrutar de una velada especial.`,
    cuisine: "Tapas y cócteles",
    heroImage: "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1200&q=80",
    galleryImages: JSON.stringify([
      "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80",
      "https://images.unsplash.com/photo-1543007630-9710e4a00a20?w=800&q=80",
      "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&q=80",
    ]),
    phone: "+34 921 000 002",
    email: "nassau@nayade.es",
    location: "Zona de Ocio, Junto a la Piscina",
    badge: "Bar & Music",
    depositPerGuest: "5.00",
    maxGroupSize: 20,
    minAdvanceHours: 1,
    maxAdvanceDays: 30,
    cancellationHours: 12,
    cancellationPolicy: "Cancelación gratuita hasta 12 horas antes.",
    legalText: "El depósito de 5€/persona se descuenta del consumo. Válido para grupos de 4 o más personas.",
    operativeEmail: "reservas.nassau@nayade.es",
    acceptsOnlineBooking: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    slug: "la-cabana-del-lago",
    name: "La Cabaña del Lago",
    shortDesc: "Gastronomía de montaña en un entorno natural privilegiado",
    longDesc: `La Cabaña del Lago es un restaurante de cocina de montaña ubicado en un enclave natural único, a orillas del lago. Su carta combina la tradición culinaria serrana con técnicas modernas, ofreciendo platos elaborados con productos de proximidad: carnes a la brasa, quesos artesanales, setas de temporada y postres caseros. El espacio tiene capacidad para grupos y es ideal para celebraciones al aire libre.`,
    cuisine: "Cocina de montaña y brasa",
    heroImage: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=80",
    galleryImages: JSON.stringify([
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80",
      "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80",
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80",
    ]),
    phone: "+34 921 000 003",
    email: "cabana@nayade.es",
    location: "Orilla del Lago, Zona Norte",
    badge: "Cocina de Montaña",
    depositPerGuest: "5.00",
    maxGroupSize: 40,
    minAdvanceHours: 4,
    maxAdvanceDays: 90,
    cancellationHours: 48,
    cancellationPolicy: "Cancelación gratuita hasta 48 horas antes. Para grupos de más de 15 personas, se requiere cancelación con 72h de antelación.",
    legalText: "El depósito de 5€/comensal se descuenta del total. Para grupos de más de 20 personas se requiere menú cerrado.",
    operativeEmail: "reservas.cabana@nayade.es",
    acceptsOnlineBooking: true,
    isActive: true,
    sortOrder: 3,
  },
  {
    slug: "arroceria-la-cabana",
    name: "Arrocería La Cabaña",
    shortDesc: "Los mejores arroces y paellas en un ambiente único",
    longDesc: `La Arrocería La Cabaña es la propuesta gastronómica especializada en arroces del complejo Náyade. Con una carta que incluye más de 15 variedades de arroces y paellas elaborados con ingredientes de primera calidad, este restaurante se ha convertido en un referente de la zona. El ambiente es distendido y familiar, con una terraza con vistas al lago perfecta para los días soleados.`,
    cuisine: "Arroces y paellas",
    heroImage: "https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=1200&q=80",
    galleryImages: JSON.stringify([
      "https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=800&q=80",
      "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=800&q=80",
      "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=800&q=80",
    ]),
    phone: "+34 921 000 004",
    email: "arroceria@nayade.es",
    location: "Terraza del Lago, Zona Sur",
    badge: "Especialidad Arroces",
    depositPerGuest: "5.00",
    maxGroupSize: 25,
    minAdvanceHours: 24,
    maxAdvanceDays: 60,
    cancellationHours: 48,
    cancellationPolicy: "Los arroces requieren reserva con mínimo 24h de antelación. Cancelación gratuita hasta 48h antes.",
    legalText: "El depósito de 5€/comensal se descuenta del total. Los arroces se elaboran por encargo y requieren un mínimo de 2 personas.",
    operativeEmail: "reservas.arroceria@nayade.es",
    acceptsOnlineBooking: true,
    isActive: true,
    sortOrder: 4,
  },
];

// ─── TURNOS POR RESTAURANTE ──────────────────────────────────────────────────

const shiftsConfig = {
  "el-galeon": [
    { name: "Comida", startTime: "13:00", endTime: "15:30", maxCapacity: 80, daysOfWeek: [0,1,2,3,4,5,6], sortOrder: 1 },
    { name: "Cena", startTime: "20:00", endTime: "23:00", maxCapacity: 80, daysOfWeek: [0,1,2,3,4,5,6], sortOrder: 2 },
  ],
  "nassau-bar": [
    { name: "Aperitivo", startTime: "12:00", endTime: "14:00", maxCapacity: 40, daysOfWeek: [5,6,0], sortOrder: 1 },
    { name: "Tarde-Noche", startTime: "18:00", endTime: "22:00", maxCapacity: 50, daysOfWeek: [0,1,2,3,4,5,6], sortOrder: 2 },
    { name: "Noche", startTime: "22:00", endTime: "01:00", maxCapacity: 60, daysOfWeek: [4,5,6], sortOrder: 3 },
  ],
  "la-cabana-del-lago": [
    { name: "Comida", startTime: "13:30", endTime: "16:00", maxCapacity: 60, daysOfWeek: [0,1,2,3,4,5,6], sortOrder: 1 },
    { name: "Cena", startTime: "20:30", endTime: "23:00", maxCapacity: 60, daysOfWeek: [4,5,6,0], sortOrder: 2 },
  ],
  "arroceria-la-cabana": [
    { name: "Comida (Arroces)", startTime: "14:00", endTime: "16:30", maxCapacity: 50, daysOfWeek: [0,1,2,3,4,5,6], sortOrder: 1 },
    { name: "Cena (Arroces)", startTime: "21:00", endTime: "23:00", maxCapacity: 40, daysOfWeek: [4,5,6,0], sortOrder: 2 },
  ],
};

// ─── EJECUCIÓN ───────────────────────────────────────────────────────────────

console.log("🍽️  Iniciando seed de restaurantes Náyade...\n");

let insertedRestaurants = 0;
let insertedShifts = 0;
let skippedRestaurants = 0;

for (const r of restaurants) {
  // Comprobar si ya existe
  const [existing] = await conn.execute(
    "SELECT id FROM restaurants WHERE slug = ?",
    [r.slug]
  );

  if (existing.length > 0) {
    console.log(`  ⏭️  Restaurante "${r.name}" ya existe (slug: ${r.slug}), saltando...`);
    skippedRestaurants++;
    continue;
  }

  // Insertar restaurante
  const [result] = await conn.execute(
    `INSERT INTO restaurants (
      slug, name, shortDesc, longDesc, cuisine, heroImage, galleryImages,
      phone, email, location, badge,
      depositPerGuest, maxGroupSize, minAdvanceHours, maxAdvanceDays,
      cancellationHours, cancellationPolicy, legalText, operativeEmail,
      acceptsOnlineBooking, isActive, sortOrder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.slug, r.name, r.shortDesc, r.longDesc, r.cuisine, r.heroImage, r.galleryImages,
      r.phone, r.email, r.location, r.badge,
      r.depositPerGuest, r.maxGroupSize, r.minAdvanceHours, r.maxAdvanceDays,
      r.cancellationHours, r.cancellationPolicy, r.legalText, r.operativeEmail,
      r.acceptsOnlineBooking ? 1 : 0, r.isActive ? 1 : 0, r.sortOrder,
    ]
  );

  const restaurantId = result.insertId;
  insertedRestaurants++;
  console.log(`  ✅ Restaurante "${r.name}" insertado (ID: ${restaurantId})`);

  // Insertar turnos
  const shifts = shiftsConfig[r.slug] ?? [];
  for (const s of shifts) {
    await conn.execute(
      `INSERT INTO restaurant_shifts (restaurantId, name, startTime, endTime, maxCapacity, daysOfWeek, isActive, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [restaurantId, s.name, s.startTime, s.endTime, s.maxCapacity, JSON.stringify(s.daysOfWeek), s.sortOrder]
    );
    insertedShifts++;
    console.log(`     → Turno "${s.name}" (${s.startTime}-${s.endTime}, cap. ${s.maxCapacity})`);
  }
}

await conn.end();

console.log(`\n🎉 Seed completado:`);
console.log(`   Restaurantes insertados: ${insertedRestaurants}`);
console.log(`   Restaurantes omitidos:   ${skippedRestaurants}`);
console.log(`   Turnos insertados:       ${insertedShifts}`);
console.log(`\n✨ Los restaurantes ya están disponibles en /restaurantes`);
