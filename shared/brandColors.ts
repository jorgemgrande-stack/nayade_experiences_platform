/**
 * Colores de marca: funciones puras (sin DOM ni servidor) para derivar una paleta coherente a partir del color
 * principal de una empresa: mezclas con blanco (fondos crema, bordes), luminancia, contraste WCAG y el color de texto
 * legible sobre un fondo. Las usan el kit visual de la empresa (correos y páginas públicas) y sus pruebas.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** ¿Es un color hexadecimal (#abc o #aabbcc)? */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v.trim());
}

/** Hex normalizado a 6 cifras en minúsculas («#ABC» → «#aabbcc»), o null si no es hex. */
export function normalizeHex(v: unknown): string | null {
  if (!isHexColor(v)) return null;
  const h = v.trim().slice(1);
  const six = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return `#${six.toLowerCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Mezcla lineal de dos colores: `weight` es la proporción del SEGUNDO (0 = solo `a`, 1 = solo `b`).
 * `mixHex("#8f7454", "#ffffff", 0.92)` da un crema derivado del color principal.
 */
export function mixHex(a: string, b: string, weight: number): string | null {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return null;
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * w, ca[1] + (cb[1] - ca[1]) * w, ca[2] + (cb[2] - ca[2]) * w);
}

/** Aclara hacia el blanco: `tint(c, 0.92)` = 92 % de blanco. */
export const tint = (hex: string, amount: number) => mixHex(hex, "#ffffff", amount);
/** Oscurece hacia el negro: `shade(c, 0.3)` = 30 % de negro. */
export const shade = (hex: string, amount: number) => mixHex(hex, "#000000", amount);

/** Luminancia relativa (WCAG), de 0 a 1; null si no es hex. */
export function relativeLuminance(hex: string): number | null {
  const c = hexToRgb(hex);
  if (!c) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Relación de contraste WCAG entre dos colores (1 a 21); null si alguno no es hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto blanco o casi negro, el que más contraste tenga sobre `bg` (para botones). Sin hex válido, blanco. */
export function contrastOn(bg: string | null | undefined, dark = "#111111", light = "#ffffff"): string {
  if (!bg) return light;
  const cl = contrastRatio(bg, light);
  const cd = contrastRatio(bg, dark);
  if (cl === null || cd === null) return light;
  return cl >= cd ? light : dark;
}

/** ¿Se lee texto blanco encima (WCAG AA, 4,5:1)? */
export function readableWithWhiteText(bg: string): boolean {
  return (contrastRatio(bg, "#ffffff") ?? 0) >= 4.5;
}

/**
 * Tinta de texto legible sobre blanco: el color dado si contrasta al menos 4,5:1; si no, se oscurece hasta que lo
 * haga (o se devuelve el neutro si no es hex). Evita que un acento claro acabe como texto ilegible.
 */
export function readableInk(hex: string | null | undefined, neutral = "#2b2622"): string {
  let c = normalizeHex(hex);
  if (!c) return neutral;
  for (let i = 0; i < 10 && (contrastRatio(c, "#ffffff") ?? 0) < 4.5; i++) c = shade(c, 0.15) ?? c;
  return (contrastRatio(c, "#ffffff") ?? 0) >= 4.5 ? c : neutral;
}

export interface BrandPalette {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  background: string;
  surface: string;
  border: string;
  buttonText: string;
}

/** Colores neutros cálidos cuando la empresa no ha definido los suyos. */
export const NEUTRAL_WARM = { primary: "#4a4036", accent: "#8a7760", ink: "#2b2622" } as const;

/**
 * Paleta completa a partir del principal, el acento y la tinta de texto de la empresa (cualquiera puede faltar):
 *  - background: crema derivado del principal (≈92 % blanco); border: ≈80 % blanco; surface: blanco.
 *  - muted: tinta apagada (mezcla de la tinta con blanco al 45 %), siempre legible sobre blanco.
 *  - buttonText: blanco o negro según el contraste con el principal.
 */
export function buildPalette(input: { primary?: string | null; accent?: string | null; ink?: string | null }): BrandPalette {
  const primary = normalizeHex(input.primary) ?? NEUTRAL_WARM.primary;
  const accent = normalizeHex(input.accent) ?? (normalizeHex(input.primary) ? primary : NEUTRAL_WARM.accent);
  const ink = readableInk(normalizeHex(input.ink) ?? NEUTRAL_WARM.ink);
  const muted = readableInk(tint(ink, 0.45) ?? ink, ink);
  return {
    primary,
    accent,
    ink,
    muted,
    background: tint(primary, 0.92) ?? "#f6f3ee",
    surface: "#ffffff",
    border: tint(primary, 0.8) ?? "#e6e0d6",
    buttonText: contrastOn(primary),
  };
}
