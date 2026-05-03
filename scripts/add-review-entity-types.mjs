/**
 * Amplía el ENUM reviews.entityType añadiendo 'experience' y 'pack'.
 * Idempotente: lee los valores actuales y solo modifica si faltan.
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Obtener valores actuales del ENUM
const [rows] = await conn.execute(
  `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'reviews'
     AND COLUMN_NAME = 'entityType'`
);

const colType = rows[0]?.COLUMN_TYPE ?? "";
console.log("Valor actual:", colType);

const needed = ["hotel", "spa", "experience", "pack"];
const missing = needed.filter((v) => !colType.includes(`'${v}'`));

if (missing.length === 0) {
  console.log("✅ El ENUM ya contiene todos los valores necesarios. Nada que hacer.");
  await conn.end();
  process.exit(0);
}

const newEnum = needed.map((v) => `'${v}'`).join(", ");
const sql = `ALTER TABLE reviews MODIFY COLUMN entityType ENUM(${newEnum}) NOT NULL`;
console.log("Ejecutando:", sql);
await conn.execute(sql);
console.log(`✅ ENUM actualizado. Valores añadidos: ${missing.join(", ")}`);

await conn.end();
