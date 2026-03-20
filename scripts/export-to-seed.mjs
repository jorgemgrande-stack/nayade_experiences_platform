/**
 * export-to-seed.mjs
 * Conecta a la BD actual, lee todos los datos y genera scripts/seed-data.mjs
 * Uso: node scripts/export-to-seed.mjs
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no definida en .env');
  process.exit(1);
}

// Parsear DATABASE_URL mysql://user:pass@host:port/dbname
function parseDbUrl(url) {
  const u = new URL(url);
  // TiDB Cloud y otros proveedores usan ssl en el query param como JSON o boolean
  let sslParam = u.searchParams.get('ssl');
  let sslConfig;
  if (sslParam) {
    try { sslConfig = JSON.parse(sslParam); } catch { sslConfig = { rejectUnauthorized: false }; }
  } else if (u.hostname.includes('tidb') || u.hostname.includes('planetscale') || u.port === '4000') {
    sslConfig = { rejectUnauthorized: false };
  }
  return {
    host: u.hostname,
    port: parseInt(u.port || '3306'),
    user: u.username,
    password: u.password,
    database: u.pathname.replace('/', ''),
    ssl: sslConfig,
  };
}

function jsVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  // Date objects → ISO string
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  // JSON fields stored as objects/arrays
  if (typeof v === 'object') return JSON.stringify(JSON.stringify(v));
  // Escape string (including date strings that come as strings from mysql2)
  const s = String(v);
  return JSON.stringify(s);
}

function rowToObj(row) {
  const entries = Object.entries(row).map(([k, v]) => `    ${k}: ${jsVal(v)}`);
  return `  {\n${entries.join(',\n')}\n  }`;
}

async function fetchTable(conn, table) {
  const [rows] = await conn.query(`SELECT * FROM \`${table}\` ORDER BY id`);
  return rows;
}

async function fetchTableNoId(conn, table) {
  const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
  return rows;
}

async function main() {
  const config = parseDbUrl(DATABASE_URL);
  const conn = await mysql.createConnection(config);
  console.log('✅ Conectado a la base de datos');

  // Fetch all tables
  const tables = {
    categories: await fetchTable(conn, 'categories'),
    locations: await fetchTable(conn, 'locations'),
    site_settings: await fetchTableNoId(conn, 'site_settings'),
    menu_items: await fetchTable(conn, 'menu_items'),
    slideshow_items: await fetchTable(conn, 'slideshow_items'),
    static_pages: await fetchTable(conn, 'static_pages'),
    page_blocks: await fetchTable(conn, 'page_blocks'),
    home_module_items: await fetchTable(conn, 'home_module_items'),
    experiences: await fetchTable(conn, 'experiences'),
    experience_variants: await fetchTable(conn, 'experience_variants'),
    packs: await fetchTable(conn, 'packs'),
    pack_cross_sells: await fetchTable(conn, 'pack_cross_sells'),
    room_types: await fetchTable(conn, 'room_types'),
    room_rate_seasons: await fetchTable(conn, 'room_rate_seasons'),
    room_rates: await fetchTable(conn, 'room_rates'),
    spa_categories: await fetchTable(conn, 'spa_categories'),
    spa_treatments: await fetchTable(conn, 'spa_treatments'),
  };

  await conn.end();
  console.log('📊 Datos extraídos:');
  for (const [t, rows] of Object.entries(tables)) {
    console.log(`   ${t}: ${rows.length} registros`);
  }

  // Generate seed file
  const lines = [];
  lines.push(`/**`);
  lines.push(` * seed-data.mjs — Datos de producción de Nayade Experiences`);
  lines.push(` * Generado automáticamente el ${new Date().toISOString()}`);
  lines.push(` * Uso: node scripts/seed-data.mjs`);
  lines.push(` */`);
  lines.push(`import mysql from 'mysql2/promise';`);
  lines.push(`import { fileURLToPath } from 'url';`);
  lines.push(`import path from 'path';`);
  lines.push(`import dotenv from 'dotenv';`);
  lines.push(``);
  lines.push(`const __dirname = path.dirname(fileURLToPath(import.meta.url));`);
  lines.push(`dotenv.config({ path: path.join(__dirname, '..', '.env') });`);
  lines.push(``);
  lines.push(`function parseDbUrl(url) {`);
  lines.push(`  const u = new URL(url);`);
  lines.push(`  let sslParam = u.searchParams.get('ssl');`);
  lines.push(`  let sslConfig;`);
  lines.push(`  if (sslParam) {`);
  lines.push(`    try { sslConfig = JSON.parse(sslParam); } catch { sslConfig = { rejectUnauthorized: false }; }`);
  lines.push(`  } else if (u.hostname.includes('tidb') || u.hostname.includes('planetscale') || u.port === '4000') {`);
  lines.push(`    sslConfig = { rejectUnauthorized: false };`);
  lines.push(`  }`);
  lines.push(`  return {`);
  lines.push(`    host: u.hostname,`);
  lines.push(`    port: parseInt(u.port || '3306'),`);
  lines.push(`    user: u.username,`);
  lines.push(`    password: u.password,`);
  lines.push(`    database: u.pathname.replace('/', ''),`);
  lines.push(`    ssl: sslConfig,`);
  lines.push(`    multipleStatements: true,`);
  lines.push(`  };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function insertBatch(conn, table, rows, label) {`);
  lines.push(`  if (!rows.length) { console.log(\`  ⏭  \${label}: 0 registros (vacío)\`); return; }`);
  lines.push(`  const cols = Object.keys(rows[0]);`);
  lines.push(`  const placeholders = rows.map(() => \`(\${cols.map(() => '?').join(', ')})\`).join(', ');`);
  lines.push(`  const values = rows.flatMap(r => cols.map(c => r[c]));`);
  lines.push(`  await conn.query(\`INSERT INTO \\\`\${table}\\\` (\${cols.map(c => \`\\\`\${c}\\\`\`).join(', ')}) VALUES \${placeholders}\`, values);`);
  lines.push(`  console.log(\`  ✅ \${label}: \${rows.length} registros insertados\`);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function main() {`);
  lines.push(`  const DATABASE_URL = process.env.DATABASE_URL;`);
  lines.push(`  if (!DATABASE_URL) { console.error('❌ DATABASE_URL no definida en .env'); process.exit(1); }`);
  lines.push(`  const conn = await mysql.createConnection(parseDbUrl(DATABASE_URL));`);
  lines.push(`  console.log('🌱 Iniciando seed de datos Nayade Experiences...\\n');`);
  lines.push(``);
  lines.push(`  // Desactivar FK checks durante la inserción`);
  lines.push(`  await conn.query('SET FOREIGN_KEY_CHECKS = 0');`);
  lines.push(``);

  // Generate data blocks for each table
  const tableOrder = [
    ['categories', 'Categorías'],
    ['locations', 'Ubicaciones'],
    ['site_settings', 'Configuración del sitio'],
    ['menu_items', 'Ítems de menú'],
    ['slideshow_items', 'Slideshow'],
    ['static_pages', 'Páginas estáticas'],
    ['page_blocks', 'Bloques de página'],
    ['home_module_items', 'Módulos de la home'],
    ['experiences', 'Experiencias'],
    ['experience_variants', 'Variantes de experiencias'],
    ['packs', 'Packs'],
    ['pack_cross_sells', 'Pack cross-sells'],
    ['room_types', 'Tipos de habitación'],
    ['room_rate_seasons', 'Temporadas de tarifas'],
    ['room_rates', 'Tarifas de habitación'],
    ['spa_categories', 'Categorías SPA'],
    ['spa_treatments', 'Tratamientos SPA'],
  ];

  for (const [table, label] of tableOrder) {
    const rows = tables[table] || [];
    lines.push(`  // ─── ${label} (${rows.length} registros) ───`);
    lines.push(`  await conn.query('DELETE FROM \`${table}\`');`);
    if (rows.length > 0) {
      lines.push(`  const ${table.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Data = [`);
      for (const row of rows) {
        lines.push(rowToObj(row) + ',');
      }
      lines.push(`  ];`);
      lines.push(`  await insertBatch(conn, '${table}', ${table.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Data, '${label}');`);
    } else {
      lines.push(`  console.log('  ⏭  ${label}: 0 registros (tabla vacía)');`);
    }
    lines.push(``);
  }

  lines.push(`  // Reactivar FK checks`);
  lines.push(`  await conn.query('SET FOREIGN_KEY_CHECKS = 1');`);
  lines.push(`  await conn.end();`);
  lines.push(`  console.log('\\n🎉 Seed completado con éxito.');`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });`);

  const output = lines.join('\n');
  const outPath = path.join(__dirname, 'seed-data.mjs');
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`\n✅ Archivo generado: scripts/seed-data.mjs (${Math.round(output.length / 1024)} KB)`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
