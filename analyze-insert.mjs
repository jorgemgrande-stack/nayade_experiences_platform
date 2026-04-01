// Analizar el INSERT fallido
const cols = ['id', 'slug', 'title', 'shortDescription', 'description', 'categoryId', 'locationId', 'coverImageUrl', 'image1', 'image2', 'image3', 'image4', 'gallery', 'basePrice', 'currency', 'duration', 'minPersons', 'maxPersons', 'difficulty', 'includes', 'excludes', 'requirements', 'discountPercent', 'discountExpiresAt', 'fiscalRegime', 'productType', 'providerPercent', 'agencyMarginPercent', 'supplierId', 'supplierCommissionPercent', 'supplierCostType', 'settlementFrequency', 'isSettlable', 'isFeatured', 'isActive', 'isPresentialSale', 'has_time_slots', 'sortOrder', 'metaTitle', 'metaDescription', 'createdAt', 'updatedAt'];

// Values from the INSERT: default = no param, ? = param
const placeholders = ['default', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', 'default', '?', 'default', '?', '?', '?', '?', '?', '?', 'default', 'default', 'default', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', 'default', 'default', 'default', 'default', 'default', 'default'];

// Params from the error
const params = 'paseo,paseo,fff,Sumérgete en una experiencia diferente...TRUNCATED,30001,30001,https://cdn.../image.png,https://cdn.../image.png,,,,15,,1,50,facil,[],[],reav,actividad,80,20,1,20,comision_sobre_venta,mensual,true,true,true,true'.split(',');

console.log('Total columns:', cols.length);
console.log('Total placeholders:', placeholders.length);
const paramCount = placeholders.filter(p => p === '?').length;
console.log('Param placeholders (?): ', paramCount);

// Map each column to its placeholder and value
console.log('\nColumn mapping:');
let paramIdx = 0;
for (let i = 0; i < cols.length; i++) {
  const ph = placeholders[i];
  const val = ph === '?' ? `PARAM[${paramIdx++}]` : 'DEFAULT';
  console.log(`  ${cols[i]}: ${ph} = ${val}`);
}

// The actual params from the error (parsed)
const actualParams = ['paseo','paseo','fff','<description>','30001','30001','https://cdn.../img.png','https://cdn.../img.png','','','','15','','1','50','facil','[]','[]','reav','actividad','80','20','1','20','comision_sobre_venta','mensual','true','true','true','true'];
console.log('\nActual params count:', actualParams.length);
console.log('Expected params (?): ', paramCount);
console.log('MISMATCH:', paramCount !== actualParams.length ? `YES - ${paramCount} expected, ${actualParams.length} provided` : 'NO');
