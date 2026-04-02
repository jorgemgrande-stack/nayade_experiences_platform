/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Redsys Helper — Náyade Experiences
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementa la generación de parámetros de pago y validación de notificación
 * IPN (Notificación Online) según la especificación técnica de Redsys.
 *
 * Algoritmo: HMAC-SHA256 con clave derivada por 3DES del merchantOrder.
 * Referencia: https://pagosonline.redsys.es/conexion-redireccion.html
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from "crypto";

// ─── Configuración ────────────────────────────────────────────────────────────

const REDSYS_URLS = {
  test: "https://sis-t.redsys.es:25443/sis/realizarPago",
  production: "https://sis.redsys.es/sis/realizarPago",
};

export function getRedsysUrl(): string {
  const env = process.env.REDSYS_ENVIRONMENT ?? "test";
  return env === "production" ? REDSYS_URLS.production : REDSYS_URLS.test;
}

export function getMerchantCode(): string {
  return process.env.REDSYS_MERCHANT_CODE ?? "";
}

export function getMerchantKey(): string {
  return process.env.REDSYS_MERCHANT_KEY ?? "";
}

export function getMerchantTerminal(): string {
  const t = process.env.REDSYS_MERCHANT_TERMINAL ?? "001";
  // Redsys requires terminal as 3-digit zero-padded string (e.g. "001")
  return t.padStart(3, "0");
}

// ─── Utilidades de cifrado ────────────────────────────────────────────────────

/**
 * Deriva la clave de firma usando 3DES con el merchantOrder como IV.
 * Esto garantiza que cada pedido tenga una clave única.
 */
function deriveKey(merchantOrder: string): Buffer {
  const keyBase64 = getMerchantKey();
  const keyBuffer = Buffer.from(keyBase64, "base64");

  // Padding del merchantOrder a 8 bytes con ceros
  const orderBuffer = Buffer.alloc(8, 0);
  Buffer.from(merchantOrder, "utf8").copy(orderBuffer);

  // Cifrado 3DES en modo CBC con IV de ceros
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv("des-ede3-cbc", keyBuffer, iv);
  cipher.setAutoPadding(false);

  return Buffer.concat([cipher.update(orderBuffer), cipher.final()]);
}

/**
 * Genera la firma HMAC-SHA256 para los parámetros del comercio.
 */
function signParams(merchantParams: string, merchantOrder: string): string {
  const derivedKey = deriveKey(merchantOrder);
  const hmac = crypto.createHmac("sha256", derivedKey);
  hmac.update(merchantParams);
  return hmac.digest("base64");
}

// ─── Generación de parámetros de pago ────────────────────────────────────────

export interface RedsysPaymentParams {
  /** Importe en céntimos (ej: 1500 = 15,00€) */
  amount: number;
  /** Referencia única del pedido (máx 12 chars alfanuméricos) */
  merchantOrder: string;
  /** Descripción del producto */
  productDescription: string;
  /** URL de notificación IPN (backend) */
  notifyUrl: string;
  /** URL de retorno OK (frontend) */
  okUrl: string;
  /** URL de retorno KO (frontend) */
  koUrl: string;
  /** Nombre del titular (opcional) */
  holderName?: string;
}

export interface RedsysFormData {
  /** URL del TPV Redsys */
  url: string;
  /** Parámetros del comercio en Base64 */
  Ds_MerchantParameters: string;
  /** Firma HMAC-SHA256 */
  Ds_Signature: string;
  /** Versión del algoritmo */
  Ds_SignatureVersion: string;
}

/**
 * Genera los datos necesarios para el formulario de redirección a Redsys.
 * El importe SIEMPRE se calcula en backend para evitar manipulación.
 */
export function buildRedsysForm(params: RedsysPaymentParams): RedsysFormData {
  const merchantCode = getMerchantCode();
  const terminal = getMerchantTerminal();

  // Construir el objeto de parámetros según especificación Redsys
  const merchantData: Record<string, string> = {
    DS_MERCHANT_AMOUNT: String(params.amount),
    DS_MERCHANT_ORDER: params.merchantOrder,
    DS_MERCHANT_MERCHANTCODE: merchantCode,
    DS_MERCHANT_CURRENCY: "978", // EUR
    DS_MERCHANT_TRANSACTIONTYPE: "0", // Autorización
    DS_MERCHANT_TERMINAL: terminal,
    DS_MERCHANT_MERCHANTURL: params.notifyUrl,
    DS_MERCHANT_URLOK: params.okUrl,
    DS_MERCHANT_URLKO: params.koUrl,
    DS_MERCHANT_PRODUCTDESCRIPTION: params.productDescription.slice(0, 125),
  };

  if (params.holderName) {
    merchantData.DS_MERCHANT_TITULAR = params.holderName.slice(0, 60);
  }

  // Serializar y codificar en Base64
  const merchantParamsJson = JSON.stringify(merchantData);
  const merchantParamsBase64 = Buffer.from(merchantParamsJson).toString("base64");

  // Generar firma
  const signature = signParams(merchantParamsBase64, params.merchantOrder);

  console.log("[Redsys] buildRedsysForm →", {
    amount: params.amount,
    merchantOrder: params.merchantOrder,
    merchantCode,
    terminal,
    url: getRedsysUrl(),
    paramsJson: merchantParamsJson,
    paramsBase64: merchantParamsBase64.slice(0, 40) + "...",
    signature: signature.slice(0, 20) + "...",
    keyConfigured: !!getMerchantKey(),
  });

  return {
    url: getRedsysUrl(),
    Ds_MerchantParameters: merchantParamsBase64,
    Ds_Signature: signature,
    Ds_SignatureVersion: "HMAC_SHA256_V1",
  };
}

// ─── Validación de notificación IPN ──────────────────────────────────────────

export interface RedsysNotification {
  Ds_SignatureVersion: string;
  Ds_MerchantParameters: string;
  Ds_Signature: string;
}

export interface RedsysNotificationData {
  /** true si la firma es válida */
  isValid: boolean;
  /** true si el pago fue autorizado (código 0000-0099) */
  isAuthorized: boolean;
  /** Referencia del pedido */
  merchantOrder: string;
  /** Código de respuesta Redsys */
  responseCode: string;
  /** Importe en céntimos */
  amount: number;
  /** Número de autorización del banco */
  authCode: string;
  /** Datos completos decodificados */
  rawData: Record<string, string>;
}

/**
 * Valida la firma de la notificación IPN de Redsys y extrae los datos.
 * NUNCA marcar una reserva como pagada sin pasar por esta validación.
 */
export function validateRedsysNotification(
  notification: RedsysNotification
): RedsysNotificationData {
  const { Ds_MerchantParameters, Ds_Signature } = notification;

  // Decodificar parámetros
  let rawData: Record<string, string> = {};
  try {
    const decoded = Buffer.from(Ds_MerchantParameters, "base64").toString("utf8");
    rawData = JSON.parse(decoded);
  } catch {
    return {
      isValid: false,
      isAuthorized: false,
      merchantOrder: "",
      responseCode: "",
      amount: 0,
      authCode: "",
      rawData: {},
    };
  }

  const merchantOrder =
    rawData.Ds_Order ?? rawData.DS_MERCHANT_ORDER ?? "";

  // Verificar firma
  const expectedSignature = signParams(Ds_MerchantParameters, merchantOrder);
  // Comparación segura para evitar timing attacks
  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(Ds_Signature)
    );
  } catch {
    isValid = false;
  }

  const responseCode = rawData.Ds_Response ?? "";
  const responseNum = parseInt(responseCode, 10);
  // Redsys: 0000-0099 = autorizado; cualquier otro = denegado
  const isAuthorized = isValid && !isNaN(responseNum) && responseNum >= 0 && responseNum <= 99;

  return {
    isValid,
    isAuthorized,
    merchantOrder,
    responseCode,
    amount: parseInt(rawData.Ds_Amount ?? "0", 10),
    authCode: rawData.Ds_AuthorisationCode ?? "",
    rawData,
  };
}

// ─── Generación de merchantOrder único ───────────────────────────────────────

/**
 * Genera un merchantOrder único de 12 caracteres alfanuméricos.
 * Formato: NY + timestamp reducido + random (evita duplicados).
 */
export function generateMerchantOrder(): string {
  // Redsys exige que los primeros 4 caracteres sean numéricos
  const now = Date.now();
  const numeric = String(now).slice(-6); // 6 dígitos numéricos del timestamp
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6); // 4 alfanum
  return `${numeric}${rand}`.slice(0, 12); // máx 12 chars, empieza por dígitos
}
