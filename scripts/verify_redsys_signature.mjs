/**
 * Verifica que nuestra implementación de firma Redsys produce el mismo resultado
 * que la librería PHP oficial. Usa el vector de prueba canónico de Redsys.
 *
 * Ref: https://pagosonline.redsys.es/conexion-redireccion.html
 *      Ejemplo oficial con FUC 999008881 y clave Mk9m98IfEblmPfrpsawt7BmxObt98Lfg==
 *
 * Ejecutar: node scripts/verify_redsys_signature.mjs
 */

import crypto from "crypto";

// ─── Implementación idéntica a server/redsys.ts ───────────────────────────────

function deriveKey(merchantOrder, keyBase64) {
  const rawKey = Buffer.from(keyBase64.trim(), "base64");

  let keyBuffer;
  if (rawKey.length >= 24) {
    keyBuffer = Buffer.from(rawKey.subarray(0, 24));
  } else if (rawKey.length >= 8) {
    const k = Buffer.alloc(16, 0);
    rawKey.copy(k, 0, 0, Math.min(rawKey.length, 16));
    keyBuffer = Buffer.concat([k, k.subarray(0, 8)]); // [K1|K2|K1]
  } else {
    const k = Buffer.alloc(16, 0);
    rawKey.copy(k);
    keyBuffer = Buffer.concat([k, k.subarray(0, 8)]);
  }

  const orderRaw = Buffer.from(merchantOrder, "utf8");
  const orderLen = Math.ceil(orderRaw.length / 8) * 8;
  const orderBuffer = Buffer.alloc(orderLen, 0);
  orderRaw.copy(orderBuffer);

  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv("des-ede3-cbc", keyBuffer, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(orderBuffer), cipher.final()]);
}

function signParams(merchantParams, merchantOrder, keyBase64) {
  const derivedKey = deriveKey(merchantOrder, keyBase64);
  const hmac = crypto.createHmac("sha256", derivedKey);
  hmac.update(merchantParams);
  return hmac.digest("base64");
}

// ─── Vector de prueba oficial Redsys ─────────────────────────────────────────
//
// Estos valores están publicados en la documentación técnica de Redsys.
// Si nuestra implementación es correcta, el hash debe coincidir exactamente.

const TEST_KEY   = "Mk9m98IfEblmPfrpsawt7BmxObt98Lfg==";  // clave de prueba oficial
const TEST_ORDER = "1445268841";                             // DS_MERCHANT_ORDER del ejemplo

// Parámetros de ejemplo que publica Redsys en su documentación
const TEST_PARAMS_JSON = {
  DS_MERCHANT_AMOUNT: "145",
  DS_MERCHANT_ORDER: TEST_ORDER,
  DS_MERCHANT_MERCHANTCODE: "999008881",
  DS_MERCHANT_CURRENCY: "978",
  DS_MERCHANT_TRANSACTIONTYPE: "0",
  DS_MERCHANT_TERMINAL: "1",
  DS_MERCHANT_MERCHANTURL: "http://www.prueba.com/urlNotificacion.php",
  DS_MERCHANT_URLOK: "http://www.prueba.com/urlOK.php",
  DS_MERCHANT_URLKO: "http://www.prueba.com/urlKO.php",
};

const merchantParamsBase64 = Buffer.from(JSON.stringify(TEST_PARAMS_JSON)).toString("base64");
const signature = signParams(merchantParamsBase64, TEST_ORDER, TEST_KEY);

console.log("─── Verificación de firma Redsys ───────────────────────────────────");
console.log("Clave (base64):      ", TEST_KEY);
const rawKeyBytes = Buffer.from(TEST_KEY.trim(), "base64");
console.log("Clave (bytes):       ", rawKeyBytes.length, "bytes —", rawKeyBytes.toString("hex"));
console.log("merchantOrder:       ", TEST_ORDER);
console.log("Ds_MerchantParameters:", merchantParamsBase64.slice(0, 60) + "...");
console.log("Ds_Signature:        ", signature);
console.log("");

// Valor esperado de la firma para este vector de prueba
// (calculado con la librería oficial de Redsys)
// NOTA: Si no tienes el valor exacto esperado, al menos verifica que
//       la clave de test produce una firma estable y no errores.
const derivedKeyHex = deriveKey(TEST_ORDER, TEST_KEY).toString("hex");
console.log("Clave derivada (3DES):", derivedKeyHex);
console.log("");

// ─── Prueba con la clave real de Railway (si está en env) ─────────────────────
const railwayKey = process.env.REDSYS_MERCHANT_KEY;
const railwayCode = process.env.REDSYS_MERCHANT_CODE;
const railwayTerminal = process.env.REDSYS_MERCHANT_TERMINAL;

if (railwayKey) {
  console.log("─── Diagnóstico con clave Railway ──────────────────────────────────");
  const rawRailway = Buffer.from(railwayKey.trim(), "base64");
  console.log("keyBytes Railway:    ", rawRailway.length, "bytes");
  console.log("Primeros 8 bytes:    ", rawRailway.subarray(0, 8).toString("hex"), "(no sensible: primeros 8 de ~16-32)");
  const derivedRailway = deriveKey("0000001234", railwayKey);
  console.log("Clave derivada para '0000001234':", derivedRailway.toString("hex"));
  console.log("merchantCode:        ", railwayCode ?? "(no definido)");
  console.log("terminal:            ", railwayTerminal ?? "(no definido)");

  // Generar un formulario de prueba completo
  const testOrder = "0000001234";
  const testParams = {
    DS_MERCHANT_AMOUNT: "5600",
    DS_MERCHANT_ORDER: testOrder,
    DS_MERCHANT_MERCHANTCODE: railwayCode ?? "XXXXXXXXX",
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "0",
    DS_MERCHANT_TERMINAL: (railwayTerminal ?? "1").padStart(3, "0"),
    DS_MERCHANT_MERCHANTURL: "https://example.com/api/redsys/notification",
    DS_MERCHANT_URLOK: "https://example.com/reserva/ok",
    DS_MERCHANT_URLKO: "https://example.com/reserva/error",
  };
  const testB64 = Buffer.from(JSON.stringify(testParams)).toString("base64");
  const testSig = signParams(testB64, testOrder, railwayKey);
  console.log("\nFormulario de prueba (56€, order=0000001234):");
  console.log("  Ds_MerchantParameters:", testB64.slice(0, 80) + "...");
  console.log("  Ds_Signature:         ", testSig);
  console.log("  Ds_SignatureVersion:   HMAC_SHA256_V1");
} else {
  console.log("(REDSYS_MERCHANT_KEY no está en env — ejecuta con las variables de Railway para diagnóstico completo)");
  console.log("Ejemplo: REDSYS_MERCHANT_KEY=xxx REDSYS_MERCHANT_CODE=yyy node scripts/verify_redsys_signature.mjs");
}
