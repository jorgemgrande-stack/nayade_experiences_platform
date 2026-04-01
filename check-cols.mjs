import mysql from 'mysql2/promise';
import 'dotenv/config';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute('SHOW COLUMNS FROM experiences');
const bdCols = rows.map(r => r.Field);

const schemaCols = [
  'id','slug','title','shortDescription','description','categoryId','locationId',
  'coverImageUrl','image1','image2','image3','image4','gallery','basePrice',
  'currency','duration','minPersons','maxPersons','difficulty','includes',
  'excludes','requirements','discountPercent','discountExpiresAt','fiscalRegime',
  'productType','providerPercent','agencyMarginPercent','supplierId',
  'supplierCommissionPercent','supplierCostType','settlementFrequency',
  'isSettlable','isFeatured','isActive','isPresentialSale','has_time_slots',
  'sortOrder','metaTitle','metaDescription','createdAt','updatedAt'
];

const missing = schemaCols.filter(c => bdCols.indexOf(c) === -1);
const extra = bdCols.filter(c => schemaCols.indexOf(c) === -1);
console.log('BD columns:', bdCols.length, bdCols.join(', '));
console.log('Missing in BD:', missing);
console.log('Extra in BD:', extra);
await conn.end();
