/**
 * TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 cifras) para el segundo factor de los operadores. Compatible con
 * cualquier aplicación de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).
 * Sin dependencias: `node:crypto`.
 */
import crypto from "node:crypto";

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let k = 0; k < clean.length; k++) {
    const i = B32.indexOf(clean[k]);
    if (i < 0) throw new Error("base32 no válido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo de 160 bits (recomendación de la RFC 4226), en base32. */
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** Código HOTP de un contador (RFC 4226 §5.3). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

/**
 * Comprueba un código con una ventana de ±1 periodo (desfase de reloj). Devuelve el paso aceptado, o
 * `null`. Para impedir la reutilización, quien llama rechaza pasos <= al último aceptado.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, window = 1): number | null {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const step = totpStep(nowMs);
  let found: number | null = null;
  // Se comparan todas las ventanas (tiempo constante respecto a cuál coincide)
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(secret, step + w));
    if (crypto.timingSafeEqual(expected, Buffer.from(c)) && found === null) found = step + w;
  }
  return found;
}

/** URI `otpauth://` para dar de alta el secreto en la aplicación (código QR o enlace). */
export function otpauthUri(secretB32: string, account: string, issuer = "Big Elephant"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
}

/** Códigos de recuperación de un solo uso (10 × «xxxx-xxxx», ≈ 40 bits cada uno). */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => String(code ?? "").trim().toLowerCase().replace(/\s/g, "");
