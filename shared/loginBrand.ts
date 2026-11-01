/**
 * Aspecto de la pantalla de acceso de una empresa a partir de su tema público (`public.getTheme`). Lógica pura: la
 * usan el inicio de sesión, la vista previa del administrador y las pruebas.
 *
 *  - Estructura común: panel de marca a la izquierda (logotipo, titular, mensaje y, si hay, imagen de fondo) y
 *    formulario a la derecha sobre blanco.
 *  - Colores de la empresa con contraste COMPROBADO (WCAG 2.x): un color que no se lee no se usa y se sustituye
 *    por el grafito neutro. Sin colores, grafito neutro: nunca el rojo de Big Elephant en la marca de un cliente.
 *  - Con imagen de fondo, el texto del panel va en blanco sobre un velo oscuro.
 *  - Instalación única (Náyade): sus colores y textos de siempre.
 */
import { authBrand, type AuthBrand, type AuthBrandThemeInput } from "./authBrand";

export interface LoginThemeInput extends AuthBrandThemeInput {
  primaryColor?: string | null;
  accentColor?: string | null;
  poweredBy?: { label: string; url: string } | null;
  login?: { backgroundUrl: string | null; title: string | null; message: string | null } | null;
}

export interface LoginLook {
  brand: AuthBrand;
  /** Panel de marca. */
  panelBg: string;
  panelFg: string;
  panelMuted: string;
  /** Realce del titular sobre el panel (o el mismo color del texto si el acento no se lee). */
  highlight: string;
  backgroundUrl: string | null;
  /** Botón principal y su texto. */
  button: string;
  buttonFg: string;
  /** Enlaces y foco sobre el formulario (blanco). */
  link: string;
  title: string;
  /** Parte del titular que se resalta («Administración» en Náyade); vacío si ninguna. */
  titleHighlight: string;
  message: string;
  poweredBy: { label: string; url: string } | null;
}

export const NEUTRAL_INK = "#171d28";
const WHITE = "#ffffff";
const LEGACY = { panel: "#0d1b2a", accent: "#f5a623" };
const DEFAULT_MESSAGE = "Accede a tu panel para gestionar tu negocio.";
/** Identidad oficial de Big Elephant (tokens de bigelephant.es: --ink, --red, --red-ink; logotipo de /brand). */
export const BIG_ELEPHANT = {
  ink: "#171d28",
  red: "#ff3035",
  redInk: "#d0161c",
  logoUrl: "https://www.bigelephant.es/brand/big-elephant-logo.png",
} as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function rgb(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number | null {
  const c = rgb(hex);
  if (!c) return null;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Relación de contraste WCAG entre dos colores hexadecimales (1 a 21); null si alguno no es hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto (blanco o grafito) con más contraste sobre `bg`. */
export function readableOn(bg: string): string {
  return (contrastRatio(bg, WHITE) ?? 0) >= (contrastRatio(bg, NEUTRAL_INK) ?? 0) ? WHITE : NEUTRAL_INK;
}

/**
 * Muestra y avisos de un campo de color del editor de marca: la muestra enseña SIEMPRE el color que se está usando
 * (el elegido o, sin elegir, el predeterminado `fallback`), nunca un blanco que no existe.
 */
export function colorFieldState(value: string, fallback: string): { swatch: string; note: string | null; error: string | null } {
  const v = value.trim();
  if (!v) return { swatch: fallback, note: `Sin elegir: se usa el color predeterminado (${fallback}).`, error: null };
  if (!HEX.test(v)) return { swatch: fallback, note: null, error: "Escribe el color con # y 6 cifras o letras de la a a la f (por ejemplo, #1f3a5f)." };
  const six = v.length === 4 ? "#" + v.slice(1).split("").map((c) => c + c).join("") : v;
  return { swatch: six.toLowerCase(), note: null, error: null };
}

/** Solo hex: los colores funcionales (rgb, hsl, oklch) no se pueden comprobar aquí y no se usan en el acceso. */
const hex = (c: string | null | undefined) => (c && HEX.test(c) ? c : null);

export function loginLook(theme: LoginThemeInput | null | undefined): LoginLook {
  const brand = authBrand(theme);
  if (theme && !theme.neutralSite) {
    return {
      brand,
      panelBg: LEGACY.panel,
      panelFg: WHITE,
      panelMuted: "#94a3b8",
      highlight: LEGACY.accent,
      backgroundUrl: null,
      button: LEGACY.panel,
      buttonFg: WHITE,
      link: LEGACY.panel,
      title: "Panel de Administración",
      titleHighlight: "Administración",
      message: brand.description,
      poweredBy: null,
    };
  }
  const primary = hex(theme?.primaryColor);
  const accent = hex(theme?.accentColor);
  const backgroundUrl = theme?.login?.backgroundUrl ?? null;

  // Empresa sin ninguna personalización (ni logotipo, ni colores, ni fondo): identidad predeterminada de Big Elephant
  // (decisión del propietario, 23/10/2026). En cuanto configure algo propio, se usa lo suyo. El logotipo de Big Elephant
  // no se presenta como el de la empresa: con nombre, un marcador neutro con su inicial; solo sin nombre, el de Big Elephant.
  if (theme && !theme.logoUrl && !primary && !accent && !backgroundUrl) {
    const name = brand.name;
    return {
      brand: name ? { ...brand, logoUrl: null } : { ...brand, logoUrl: BIG_ELEPHANT.logoUrl, logoAlt: "Big Elephant" },
      panelBg: BIG_ELEPHANT.ink,
      panelFg: WHITE,
      panelMuted: "rgba(255,255,255,0.78)",
      highlight: BIG_ELEPHANT.red,
      backgroundUrl: null,
      button: BIG_ELEPHANT.redInk,
      buttonFg: WHITE,
      link: BIG_ELEPHANT.redInk,
      title: theme.login?.title || (name ? `Te damos la bienvenida a ${name}` : "Te damos la bienvenida"),
      titleHighlight: theme.login?.title ? "" : name,
      message: theme.login?.message || DEFAULT_MESSAGE,
      poweredBy: theme.poweredBy ?? null,
    };
  }

  const panelBg = primary ?? NEUTRAL_INK;
  // Con imagen, velo oscuro y texto blanco; sin ella, el que más se lee sobre el color del panel
  const panelFg = backgroundUrl ? WHITE : readableOn(panelBg);
  const panelMuted = panelFg === WHITE ? "rgba(255,255,255,0.78)" : "rgba(23,29,40,0.78)";
  // Titular grande: basta 3:1 (texto grande); con imagen se compara con el velo (casi negro)
  const highlightBase = backgroundUrl ? "#111111" : panelBg;
  const highlight = accent && (contrastRatio(accent, highlightBase) ?? 0) >= 3 ? accent : panelFg;

  // Botón: el color principal si su texto se lee (4.5:1) y destaca sobre el blanco (3:1); si no, grafito
  const usable = primary && (contrastRatio(primary, WHITE) ?? 0) >= 3 && (contrastRatio(primary, readableOn(primary)) ?? 0) >= 4.5;
  const button = usable ? primary : NEUTRAL_INK;
  const buttonFg = readableOn(button);
  // Enlaces sobre blanco: texto normal, 4.5:1
  const link = primary && (contrastRatio(primary, WHITE) ?? 0) >= 4.5 ? primary : NEUTRAL_INK;

  const name = brand.name;
  return {
    brand,
    panelBg,
    panelFg,
    panelMuted,
    highlight,
    backgroundUrl,
    button,
    buttonFg,
    link,
    title: theme?.login?.title || (name ? `Te damos la bienvenida a ${name}` : "Te damos la bienvenida"),
    titleHighlight: theme?.login?.title ? "" : name,
    message: theme?.login?.message || DEFAULT_MESSAGE,
    poweredBy: theme?.poweredBy ?? null,
  };
}

/**
 * Variables CSS de la identidad de una empresa en TODA su experiencia (acceso, panel, primeros pasos, avisos), para
 * que el paso de una pantalla a otra no parezca otro producto:
 *  - sin colores propios: la identidad de Big Elephant (rojo corporativo sobre grafito y blanco);
 *  - con color propio: el suyo, pero solo si se lee (≥ 3:1 sobre blanco); si no, el grafito neutro, para no romper la
 *    legibilidad. El acento propio solo se usa si también se lee.
 * Instalación de una sola empresa (Náyade): `null`, su aspecto no cambia.
 */
export function brandTokens(theme: Pick<LoginThemeInput, "neutralSite" | "primaryColor" | "accentColor"> | null | undefined): Record<string, string> | null {
  if (!theme || !theme.neutralSite) return null;
  const own = hex(theme.primaryColor);
  const primary = own ? ((contrastRatio(own, WHITE) ?? 0) >= 3 ? own : NEUTRAL_INK) : BIG_ELEPHANT.redInk;
  const ownAccent = hex(theme.accentColor);
  const accent = ownAccent && (contrastRatio(ownAccent, WHITE) ?? 0) >= 3 ? ownAccent : own ? primary : BIG_ELEPHANT.red;
  const fg = readableOn(primary);
  return {
    "--primary": primary,
    "--primary-foreground": fg,
    "--ring": primary,
    "--accent": accent,
    "--accent-foreground": readableOn(accent),
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": fg,
    "--sidebar-ring": primary,
    "--brand-accent": accent,
    // Superficies oscuras compartidas (aviso de cookies y paneles flotantes): grafito de Big Elephant
    "--brand-surface": NEUTRAL_INK,
    "--brand-surface-2": "#222a38",
    "--brand-line": "rgba(255,255,255,0.14)",
    "--brand-muted": "#4b5668",
    "--brand-icon": "rgba(255,255,255,0.82)",
  };
}
