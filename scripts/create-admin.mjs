#!/usr/bin/env node
/**
 * scripts/create-admin.mjs
 *
 * Crea o actualiza el usuario administrador en la base de datos local.
 * Uso:
 *   node scripts/create-admin.mjs
 *   ADMIN_EMAIL=admin@midominio.com ADMIN_PASS=MiClave123 node scripts/create-admin.mjs
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import readline from "readline";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL no está definida en el .env");
  process.exit(1);
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  const email = process.env.ADMIN_EMAIL || await prompt("Email del admin: ");
  const name  = process.env.ADMIN_NAME  || await prompt("Nombre del admin [Administrador]: ") || "Administrador";
  const pass  = process.env.ADMIN_PASS  || await prompt("Contraseña (mín. 8 caracteres): ");

  if (!email || !pass || pass.length < 8) {
    console.error("❌ Email y contraseña (mín. 8 caracteres) son obligatorios.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(pass, 12);
  const conn = await mysql.createConnection(DB_URL);

  try {
    // Upsert: si existe el email, actualiza; si no, inserta
    const [rows] = await conn.execute("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
    if (rows.length > 0) {
      await conn.execute(
        "UPDATE users SET passwordHash = ?, name = ?, role = 'admin', isActive = 1 WHERE email = ?",
        [hash, name, email.toLowerCase()]
      );
      console.log(`✅ Usuario admin actualizado: ${email}`);
    } else {
      await conn.execute(
        "INSERT INTO users (openId, email, name, passwordHash, role, isActive, loginMethod, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, 'admin', 1, 'local', NOW(), NOW(), NOW())",
        [`local_${Date.now()}`, email.toLowerCase(), name, hash]
      );
      console.log(`✅ Usuario admin creado: ${email}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });
