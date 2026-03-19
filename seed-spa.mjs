import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not found");

const conn = await createConnection(DATABASE_URL);
console.log("Connected to DB");

// Clear existing SPA data
await conn.execute("DELETE FROM spa_slots");
await conn.execute("DELETE FROM spa_schedule_templates");
await conn.execute("DELETE FROM spa_treatments");
await conn.execute("DELETE FROM spa_resources");
await conn.execute("DELETE FROM spa_categories");
console.log("Cleared existing SPA data");

// CATEGORIES
const [c1] = await conn.execute(
  `INSERT INTO spa_categories (slug, name, description, iconName, sortOrder, isActive) VALUES (?, ?, ?, ?, ?, 1)`,
  ['circuito-hidrotermal', 'Circuito Hidrotermal',
   'Piscinas a diferentes temperaturas, chorros cervicales y lumbares. La experiencia termal completa.',
   'Waves', 1]
);
const catCircuito = c1.insertId;

const [c2] = await conn.execute(
  `INSERT INTO spa_categories (slug, name, description, iconName, sortOrder, isActive) VALUES (?, ?, ?, ?, ?, 1)`,
  ['zona-wellness', 'Zona Wellness',
   'Sauna finlandesa, baño turco y duchas de contrastes. Bienestar total para cuerpo y mente.',
   'Flame', 2]
);
const catWellness = c2.insertId;

const [c3] = await conn.execute(
  `INSERT INTO spa_categories (slug, name, description, iconName, sortOrder, isActive) VALUES (?, ?, ?, ?, ?, 1)`,
  ['masajes', 'Masajes',
   'Masajes relajantes, deportivos y descontracturantes realizados por terapeutas especializados.',
   'Hand', 3]
);
const catMasajes = c3.insertId;

const [c4] = await conn.execute(
  `INSERT INTO spa_categories (slug, name, description, iconName, sortOrder, isActive) VALUES (?, ?, ?, ?, ?, 1)`,
  ['clinic-spa', 'Clinic Spa',
   'Tratamientos faciales y corporales de ultima generacion. Rituales sensoriales y aromaterapia.',
   'Sparkles', 4]
);
const catClinic = c4.insertId;

console.log("Inserted 4 categories: " + [catCircuito, catWellness, catMasajes, catClinic].join(', '));

// RESOURCES
const [res1] = await conn.execute(
  `INSERT INTO spa_resources (type, name, description, isActive, sortOrder) VALUES ('cabina', 'Cabina 1 Masajes', 'Cabina principal para masajes y tratamientos corporales', 1, 1)`
);
const [res2] = await conn.execute(
  `INSERT INTO spa_resources (type, name, description, isActive, sortOrder) VALUES ('cabina', 'Cabina 2 Facial', 'Cabina especializada en tratamientos faciales y Clinic Spa', 1, 2)`
);
const cabina1 = res1.insertId;
const cabina2 = res2.insertId;
console.log("Inserted 2 resources: " + [cabina1, cabina2].join(', '));

// TREATMENTS
const bCircuito = JSON.stringify(["Mejora la circulacion sanguinea","Reduce el estres y la tension muscular","Estimula el sistema inmunologico","Efecto detox y regenerador"]);
const bWellness = JSON.stringify(["Purificacion profunda de la piel","Relajacion muscular total","Mejora del sistema circulatorio","Equilibrio cuerpo-mente"]);
const bMasaje = JSON.stringify(["Alivio de contracturas y tensiones","Mejora de la circulacion","Reduccion del estres","Recuperacion muscular"]);
const bFacial = JSON.stringify(["Hidratacion profunda","Luminosidad y firmeza","Reduccion de lineas de expresion","Efecto lifting inmediato"]);

const treatments = [
  ['circuito-hidrotermal-90', 'Circuito Hidrotermal 90 min', catCircuito,
   'La experiencia termal completa: piscinas a diferentes temperaturas, chorros cervicales y lumbares.',
   'Sumergete en nuestro circuito hidrotermal de 90 minutos. Disfruta de piscinas a diferentes temperaturas, chorros cervicales y lumbares, zona de relajacion y acceso a la Zona Wellness (sauna finlandesa, bano turco y duchas de contraste). Una experiencia de bienestar completa con vistas al embalse.',
   bCircuito, 90, '30.00', 1, 0, 1, 1],
  ['circuito-parejas', 'Circuito Spa Parejas', catCircuito,
   'Circuito hidrotermal exclusivo para dos personas. La experiencia perfecta para compartir en pareja.',
   'Disfruta del circuito hidrotermal completo en pareja: piscinas termales, zona de relajacion, sauna finlandesa, bano turco y duchas de contraste. Incluye acceso privado a la zona de relax con vistas al lago.',
   bCircuito, 90, '50.00', 2, 0, 1, 2],
  ['circuito-huespedes-hotel', 'Circuito Spa Huespedes Hotel', catCircuito,
   'Tarifa especial para huespedes del Hotel Nayade. Acceso al circuito hidrotermal completo.',
   'Tarifa exclusiva para huespedes del Hotel Nayade. Incluye acceso completo al circuito hidrotermal. Presenta tu tarjeta de habitacion en recepcion del SPA.',
   bCircuito, 90, '20.00', 1, 0, 0, 3],
  ['circuito-ninos', 'Circuito Spa Ninos hasta 12 anos', catCircuito,
   'Acceso al circuito hidrotermal adaptado para los mas pequenos. Menores de 12 anos.',
   'Los mas pequenos tambien pueden disfrutar del SPA Nayade. Acceso supervisado al circuito hidrotermal con zonas adaptadas. Siempre acompanados de un adulto.',
   bCircuito, 90, '15.00', 1, 0, 0, 4],
  ['zona-wellness-sauna', 'Zona Wellness Sauna y Bano Turco', catWellness,
   'Sauna finlandesa, bano turco y duchas de contraste. Purificacion total del cuerpo y la mente.',
   'Acceso a nuestra exclusiva Zona Wellness: sauna finlandesa a 85C, bano turco con aromas naturales y duchas de contraste. Una experiencia de purificacion profunda.',
   bWellness, 60, '20.00', 2, 0, 1, 1],
  ['masaje-relajante-50', 'Masaje Relajante 50 min', catMasajes,
   'Masaje relajante de cuerpo completo con aceites esenciales. Libera tensiones y recupera el equilibrio.',
   'Nuestro masaje relajante de 50 minutos combina tecnicas suecas y de aromaterapia para liberar tensiones acumuladas. Con aceites esenciales seleccionados segun tus necesidades.',
   bMasaje, 50, '65.00', 1, 1, 1, 1],
  ['masaje-deportivo-50', 'Masaje Deportivo 50 min', catMasajes,
   'Masaje descontracturante para deportistas. Recuperacion muscular profunda tras actividades fisicas.',
   'Masaje deportivo de 50 minutos especializado en la recuperacion muscular. Tecnicas de presion profunda y estiramientos para eliminar contracturas y mejorar la flexibilidad.',
   bMasaje, 50, '70.00', 1, 1, 0, 2],
  ['masaje-piedras-calientes', 'Masaje con Piedras Calientes 75 min', catMasajes,
   'Terapia de piedras volcanicas calientes. Calor profundo que libera tensiones y activa la circulacion.',
   'El masaje con piedras calientes de basalto volcanico combina el calor profundo con tecnicas de masaje para una relajacion sin igual.',
   bMasaje, 75, '85.00', 1, 1, 0, 3],
  ['facial-hidratacion-profunda', 'Facial Hidratacion Profunda 60 min', catClinic,
   'Tratamiento facial de hidratacion intensiva. Piel luminosa, firme e hidratada desde la primera sesion.',
   'Tratamiento facial de 60 minutos con productos de ultima generacion. Limpieza profunda, exfoliacion enzimatica, serum de acido hialuronico y mascarilla hidratante.',
   bFacial, 60, '75.00', 1, 1, 1, 1],
  ['ritual-sensorial-aromaterapia', 'Ritual Sensorial Aromaterapia 90 min', catClinic,
   'Ritual completo de aromaterapia: exfoliacion corporal, envoltura y masaje con aceites esenciales.',
   'Ritual de bienestar sensorial de 90 minutos. Exfoliacion corporal con sal del Himalaya, envoltura nutritiva y masaje de aromaterapia personalizado.',
   bFacial, 90, '110.00', 1, 1, 0, 2],
];

const treatmentIds = {};
for (const [slug, name, catId, shortDesc, desc, benefits, dur, price, maxP, cabinReq, isFeat, sortOrd] of treatments) {
  const [row] = await conn.execute(
    `INSERT INTO spa_treatments (slug, name, categoryId, shortDescription, description, benefits, durationMinutes, price, currency, maxPersons, cabinRequired, isFeatured, isActive, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, 1, ?)`,
    [slug, name, catId, shortDesc, desc, benefits, dur, price, maxP, cabinReq, isFeat, sortOrd]
  );
  treatmentIds[slug] = { id: row.insertId, dur, catId };
}
console.log("Inserted " + treatments.length + " treatments");

// SCHEDULE TEMPLATES
function addMins(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60)).padStart(2,'0') + ':' + String(total % 60).padStart(2,'0');
}

let templateCount = 0;

// Circuito Hidrotermal + Wellness: Viernes, Sabados, Domingos
const circuitoSlugs = ['circuito-hidrotermal-90','circuito-parejas','circuito-huespedes-hotel','circuito-ninos'];
const circuitoSchedule = [
  { dow: 5, slots: ['15:00','16:30','18:00','19:30','21:00'], cap: 8 },  // Viernes
  { dow: 6, slots: ['10:00','11:30','13:00','15:00','16:30','18:00','19:30','21:00'], cap: 8 }, // Sabados
  { dow: 0, slots: ['10:00','11:30','13:00','14:30','16:00'], cap: 8 }, // Domingos
];

for (const slug of circuitoSlugs) {
  const { id } = treatmentIds[slug];
  for (const { dow, slots, cap } of circuitoSchedule) {
    for (const startTime of slots) {
      await conn.execute(
        `INSERT INTO spa_schedule_templates (treatmentId, resourceId, dayOfWeek, startTime, endTime, capacity, isActive) VALUES (?, NULL, ?, ?, ?, ?, 1)`,
        [id, dow, startTime, addMins(startTime, 90), cap]
      );
      templateCount++;
    }
  }
}

// Wellness: mismos dias que circuito
const wellnessId = treatmentIds['zona-wellness-sauna'].id;
const wellnessSchedule = [
  { dow: 5, start: '15:00', end: '22:00' },
  { dow: 6, start: '10:00', end: '22:00' },
  { dow: 0, start: '10:00', end: '17:30' },
];
for (const { dow, start, end } of wellnessSchedule) {
  await conn.execute(
    `INSERT INTO spa_schedule_templates (treatmentId, resourceId, dayOfWeek, startTime, endTime, capacity, isActive) VALUES (?, NULL, ?, ?, ?, 6, 1)`,
    [wellnessId, dow, start, end]
  );
  templateCount++;
}

// Masajes y Clinic: Lunes-Domingo 10:00-20:00
const masajeSlugs = ['masaje-relajante-50','masaje-deportivo-50','masaje-piedras-calientes','facial-hidratacion-profunda','ritual-sensorial-aromaterapia'];
for (const slug of masajeSlugs) {
  const { id, dur } = treatmentIds[slug];
  for (let dow = 0; dow <= 6; dow++) {
    let cur = '10:00';
    while (true) {
      const [h, m] = cur.split(':').map(Number);
      if ((h * 60 + m + dur) > 20 * 60) break;
      const endTime = addMins(cur, dur);
      await conn.execute(
        `INSERT INTO spa_schedule_templates (treatmentId, resourceId, dayOfWeek, startTime, endTime, capacity, isActive) VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [id, cabina1, dow, cur, endTime]
      );
      templateCount++;
      cur = addMins(cur, dur + 10);
    }
  }
}

console.log("Inserted " + templateCount + " schedule templates");

// GENERATE SLOTS Mar-Sep 2026
const [allTemplates] = await conn.execute('SELECT * FROM spa_schedule_templates WHERE isActive = 1');
console.log("Generating slots from " + allTemplates.length + " templates...");

let slotCount = 0;
let batch = [];
const BATCH = 500;

const startD = new Date('2026-03-20');
const endD = new Date('2026-09-30');
const cur = new Date(startD);

while (cur <= endD) {
  const dateStr = cur.toISOString().split('T')[0];
  const dow = cur.getDay();

  for (const tpl of allTemplates) {
    if (tpl.dayOfWeek !== dow) continue;
    batch.push([tpl.treatmentId, tpl.resourceId, dateStr, tpl.startTime, tpl.endTime, tpl.capacity, 0, 'disponible']);
    if (batch.length >= BATCH) {
      const ph = batch.map(() => '(?,?,?,?,?,?,?,?)').join(',');
      await conn.execute(
        `INSERT INTO spa_slots (treatmentId, resourceId, date, startTime, endTime, capacity, bookedCount, status) VALUES ${ph}`,
        batch.flat()
      );
      slotCount += batch.length;
      batch = [];
    }
  }
  cur.setDate(cur.getDate() + 1);
}

if (batch.length > 0) {
  const ph = batch.map(() => '(?,?,?,?,?,?,?,?)').join(',');
  await conn.execute(
    `INSERT INTO spa_slots (treatmentId, resourceId, date, startTime, endTime, capacity, bookedCount, status) VALUES ${ph}`,
    batch.flat()
  );
  slotCount += batch.length;
}

console.log("Generated " + slotCount + " availability slots");

await conn.end();
console.log("\nSPA Nayade seed completado!");
console.log("  - 4 categorias");
console.log("  - " + treatments.length + " tratamientos con precios reales");
console.log("  - " + templateCount + " plantillas de horario");
console.log("  - " + slotCount + " slots de disponibilidad (Mar-Sep 2026)");
