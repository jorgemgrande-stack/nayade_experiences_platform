/**
 * export-seed.mjs
 * Exports all catalog and configuration data from the database to /data/seed.json
 * Run: node scripts/export-seed.mjs
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const pool = mysql.createPool(process.env.DATABASE_URL);

async function exportTable(tableName) {
  const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
  return rows;
}

async function main() {
  console.log("🔄 Exporting seed data from database...");

  const seed = {
    _meta: {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      description: "Nayade Experiences - Full catalog seed for local development",
    },
    // Core catalog
    categories: await exportTable("categories"),
    locations: await exportTable("locations"),
    experiences: await exportTable("experiences"),
    experience_variants: await exportTable("experience_variants"),
    product_time_slots: await exportTable("product_time_slots"),
    packs: await exportTable("packs"),
    pack_cross_sells: await exportTable("pack_cross_sells"),
    lego_packs: await exportTable("lego_packs"),
    lego_pack_lines: await exportTable("lego_pack_lines"),
    // Hotel
    room_types: await exportTable("room_types"),
    room_rates: await exportTable("room_rates"),
    room_rate_seasons: await exportTable("room_rate_seasons"),
    // SPA
    spa_treatments: await exportTable("spa_treatments"),
    spa_categories: await exportTable("spa_categories"),
    spa_resources: await exportTable("spa_resources"),
    // Restaurantes
    restaurants: await exportTable("restaurants"),
    menu_items: await exportTable("menu_items"),
    restaurant_shifts: await exportTable("restaurant_shifts"),
    restaurant_staff: await exportTable("restaurant_staff"),
    // CMS & contenido
    site_settings: await exportTable("site_settings"),
    static_pages: await exportTable("static_pages"),
    page_blocks: await exportTable("page_blocks"),
    slideshow_items: await exportTable("slideshow_items"),
    gallery_items: await exportTable("gallery_items"),
    home_module_items: await exportTable("home_module_items"),
    // Configuración fiscal y operativa
    suppliers: await exportTable("suppliers"),
    platforms: await exportTable("platforms"),
    ticketing_products: await exportTable("ticketing_products"),
    monitors: await exportTable("monitors"),
    // Email templates
    email_templates: await exportTable("email_templates"),
    // Cupones y descuentos
    discount_codes: await exportTable("discount_codes"),
    coupon_email_config: await exportTable("coupon_email_config"),
    // Contadores de documentos
    document_counters: await exportTable("document_counters"),
    // Media files (metadata only, not binary content)
    media_files: await exportTable("media_files"),
    // Reviews
    reviews: await exportTable("reviews"),
    // Platform products
    platform_products: await exportTable("platform_products"),
    // Cash registers
    cash_registers: await exportTable("cash_registers"),
    // Expense categories
    expense_categories: await exportTable("expense_categories"),
  };

  // Serialize BigInt values
  const json = JSON.stringify(seed, (key, value) =>
    typeof value === "bigint" ? value.toString() : value,
    2
  );

  const outputPath = path.join(dataDir, "seed.json");
  fs.writeFileSync(outputPath, json, "utf-8");

  // Summary
  console.log("\n✅ Seed exported successfully to data/seed.json");
  console.log("\n📊 Summary:");
  for (const [table, rows] of Object.entries(seed)) {
    if (table.startsWith("_")) continue;
    if (Array.isArray(rows)) {
      console.log(`  ${table}: ${rows.length} rows`);
    }
  }
  console.log(`\n📁 Output: ${outputPath}`);
  console.log(`📦 File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});
