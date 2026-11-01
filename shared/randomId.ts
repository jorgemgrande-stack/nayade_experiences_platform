/**
 * Identificador aleatorio (UUID v4) que funciona en cualquier navegador: `crypto.randomUUID` solo existe en
 * contexto seguro (HTTPS) y desde Safari/iPad 15.4; si falta, se construye con `crypto.getRandomValues`, que está
 * disponible en todos. Para claves de idempotencia e identificadores locales (no es un secreto).
 */
type CryptoLike = { randomUUID?: () => string; getRandomValues?: <T extends Uint8Array>(a: T) => T };

export function randomId(c: CryptoLike | undefined = (globalThis as { crypto?: CryptoLike }).crypto): string {
  if (typeof c?.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fuera de contexto seguro algunos navegadores la exponen pero fallan: se sigue con getRandomValues
    }
  }
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
