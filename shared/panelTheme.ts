/**
 * Color principal de la empresa en el panel, con contraste AA (WCAG 2.x, 4,5:1) garantizado en modo claro y oscuro.
 * Lógica pura: la usan el cargador del tema (`TenantThemeLoader`) y las pruebas.
 *
 *  - Modo claro: el color de la marca si se lee sobre las superficies claras del panel; si se queda corto, una versión
 *    algo más oscura del mismo tono; si para leerse habría que cambiarlo demasiado, la tinta neutra.
 *  - Modo oscuro: lo mismo hacia el blanco (una marca oscura, como un verde botella, se aclara para leerse sobre el
 *    fondo oscuro); si no llega, un gris claro neutro.
 *  - Sin color propio: la identidad de Big Elephant (rojo corporativo), igual que `brandTokens`.
 *  - El texto de los botones (blanco o tinta) es siempre el que más se lee sobre el color elegido, con 4,5:1 o más.
 * Instalación de una sola empresa (Náyade): `null`, su aspecto no cambia.
 */
import { BIG_ELEPHANT, NEUTRAL_INK, contrastRatio, type LoginThemeInput } from "./loginBrand";

/** Contraste mínimo de texto normal (WCAG AA). */
export const AA = 4.5;
/** Superficie clara más desfavorable del panel (gris arena de `--muted`). */
export const LIGHT_SURFACE = "#f7f1e7";
/** Superficie oscura más desfavorable del panel (`--muted` del modo oscuro). */
export const DARK_SURFACE = "#05131d";
/** Tinta neutra para el modo oscuro cuando la marca no llega. */
export const NEUTRAL_LIGHT = "#e5e7eb";
/** Texto oscuro de los botones claros en modo oscuro. */
const DARK_TEXT = "#0a0d14";
const WHITE = "#ffffff";
/** Cuánto se puede aclarar u oscurecer la marca antes de dejar de ser «su» color. */
const MAX_SHIFT = 0.45;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function expand(hex: string): string {
  const h = hex.slice(1);
  return ("#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h)).toLowerCase();
}

/** Mezcla lineal (en sRGB) de `a` hacia `b` en la proporción `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [expand(a), expand(b)];
  const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(x, i) + (ch(y, i) - ch(x, i)) * t).toString(16).padStart(2, "0")).join("");
}

/** El texto (de los dos dados) que más se lee sobre `bg`. */
function bestText(bg: string, options: readonly string[]): string {
  return options.reduce((best, c) => ((contrastRatio(bg, c) ?? 0) > (contrastRatio(bg, best) ?? 0) ? c : best));
}

export interface ShiftResult {
  color: string;
  /** Proporción de mezcla aplicada (0 = el color tal cual). */
  shift: number;
}

/**
 * Acerca `color` a `toward` (negro o blanco) en pasos pequeños hasta que se lee sobre `surface` (≥ `min`) y su texto
 * (blanco u oscuro) también se lee sobre él. Devuelve el primer color que cumple, o null si ni mezclándolo del todo.
 */
export function shiftUntilReadable(color: string, surface: string, toward: string, min = AA): ShiftResult | null {
  if (!HEX.test(color)) return null;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const c = mixHex(color, toward, t);
    const fg = bestText(c, [WHITE, DARK_TEXT]);
    if ((contrastRatio(c, surface) ?? 0) >= min && (contrastRatio(c, fg) ?? 0) >= min) return { color: c, shift: t };
  }
  return null;
}

export interface PanelPalette {
  /** De dónde sale el color: el de la empresa, el predeterminado (Big Elephant) o la tinta neutra. */
  source: "own" | "default" | "neutral";
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Botón secundario neutro (sin el turquesa de la instalación original), por modo. */
const SECONDARY = { light: ["#eef1f4", NEUTRAL_INK], dark: ["#1b2533", "#f1f5f9"] } as const;

function vars(primary: string, fg: string, mode: "light" | "dark"): Record<string, string> {
  return {
    "--secondary": SECONDARY[mode][0],
    "--secondary-foreground": SECONDARY[mode][1],
    "--primary": primary,
    "--primary-foreground": fg,
    "--ring": primary,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": fg,
    "--sidebar-ring": primary,
  };
}

export function panelPalette(theme: Pick<LoginThemeInput, "neutralSite" | "primaryColor"> | null | undefined): PanelPalette | null {
  if (!theme || !theme.neutralSite) return null;
  const own = theme.primaryColor && HEX.test(theme.primaryColor) ? expand(theme.primaryColor) : null;
  const base = own ?? BIG_ELEPHANT.redInk;
  const light = shiftUntilReadable(base, LIGHT_SURFACE, "#000000");
  const dark = shiftUntilReadable(own ?? BIG_ELEPHANT.red, DARK_SURFACE, WHITE);
  const lightOk = light && light.shift <= MAX_SHIFT;
  const darkOk = dark && dark.shift <= MAX_SHIFT;
  const lightColor = lightOk ? light!.color : NEUTRAL_INK;
  const darkColor = darkOk ? dark!.color : NEUTRAL_LIGHT;
  return {
    source: !own ? "default" : lightOk ? "own" : "neutral",
    light: vars(lightColor, bestText(lightColor, [WHITE, DARK_TEXT]), "light"),
    dark: vars(darkColor, bestText(darkColor, [WHITE, DARK_TEXT]), "dark"),
  };
}

/** Variables de `panelPalette` como hoja de estilos: más específica que `:root` y `.dark` de index.css. */
export function panelPaletteCss(p: PanelPalette): string {
  const block = (sel: string, v: Record<string, string>) => `${sel}{${Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";")}}`;
  // También para zonas que se fuerzan a oscuro dentro de una página clara (la pantalla de caja)
  return block("html:root", p.light) + block("html.dark:root,html .dark", p.dark);
}

/** Claves que gestiona la paleta del panel (el resto de `brandTokens` se aplica como siempre). */
export const PANEL_PALETTE_KEYS = Object.keys(vars(WHITE, WHITE, "light"));

/**
 * Colores por significado (variables `--success`, `--warning`, `--danger` e `--info` de index.css), por modo. Iguales
 * para todas las empresas: un aviso se reconoce igual con cualquier marca. Las pruebas comprueban el contraste AA sobre
 * las superficies del panel y que index.css los declara tal cual.
 */
export const SEMANTIC_COLORS = {
  light: { success: "#046c4e", warning: "#92400e", danger: "#b91c1c", info: "#0369a1" },
  dark: { success: "#6ee7b7", warning: "#fcd34d", danger: "#fca5a5", info: "#7dd3fc" },
} as const;
