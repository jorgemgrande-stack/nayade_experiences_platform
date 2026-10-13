// Falla si el informe de scripts/audit-schema-drift.ts indica columnas que faltan en la BD.
// Uso: node scripts/ci/assert-no-missing-columns.cjs drift.json
const report = require(require("path").resolve(process.argv[2] ?? "drift.json"));
const missing = report.missingColumns ?? [];
console.log("columnas que faltan:", missing.length);
for (const m of missing.slice(0, 40)) console.log(`  - ${m.table}.${m.column}`);
process.exit(missing.length > 0 ? 1 : 0);
