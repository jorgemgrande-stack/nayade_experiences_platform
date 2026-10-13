/**
 * Tematización por tenant: identidad corporativa pública (marca, logotipo, colores, fuente).
 *
 * - Todo valor sale de los ajustes del tenant y se SANEA: son texto editable por el cliente
 *   que acaba en CSS y en atributos del navegador.
 * - En `single` no se devuelve ninguna sustitución (el sitio actual no cambia) salvo que se
 *   hayan definido ajustes `theme_*` explícitamente.
 * - `neutralSite` (solo multi): la web pública usa el shell neutro del tenant (sus páginas y
 *   menús), no las páginas específicas de otra empresa.
 * - `poweredBy`: identificación discreta de Big Elephant como proveedor (activa por defecto
 *   en multi; el tenant no la oculta salvo plan que lo permita: `brand_show_powered_by`).
 */

export interface PublicTheme {
  brandName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  radius: string | null;
  neutralSite: boolean;
  poweredBy: { label: string; url: string } | null;
  contact: { phone: string | null; email: string | null; address: string | null };
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FN_COLOR = /^(?:rgb|hsl|oklch)\(\s*[0-9.,%\s/deg-]+\)$/;
const FONT = /^[A-Za-z0-9 ,'"._-]{1,120}$/;
const RADIUS = /^\d{1,2}(?:\.\d{1,2})?(?:px|rem)$/;

export function safeColor(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return HEX.test(s) || FN_COLOR.test(s) ? s : null;
}

export function safeHttpUrl(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const text = (v: string | undefined, max: number): string | null => {
  const s = (v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim();
  return s ? s.slice(0, max) : null;
};

export function buildTheme(
  get: (key: string) => string | undefined,
  opts: { multi: boolean },
): PublicTheme {
  const font = (get("theme_font_family") ?? "").trim();
  const radius = (get("theme_radius") ?? "").trim();
  const showPowered = get("brand_show_powered_by");
  const poweredOn = opts.multi ? showPowered !== "false" : showPowered === "true";
  return {
    brandName: text(get("brand_name"), 120),
    logoUrl: safeHttpUrl(get("brand_logo_url")),
    faviconUrl: safeHttpUrl(get("brand_favicon_url")),
    // En single solo cuentan los ajustes `theme_*` explícitos: `brand_*_color` ya existen en
    // instalaciones previas y no deben alterar su aspecto (p. ej. Náyade).
    primaryColor: safeColor(get("theme_primary_color") ?? (opts.multi ? get("brand_primary_color") : undefined)),
    accentColor: safeColor(get("theme_accent_color") ?? (opts.multi ? get("brand_accent_color") : undefined)),
    fontFamily: FONT.test(font) ? font : null,
    radius: RADIUS.test(radius) ? radius : null,
    neutralSite: opts.multi,
    poweredBy: poweredOn ? { label: "Plataforma Big Elephant", url: "https://bigelephant.es" } : null,
    contact: {
      phone: text(get("brand_phone"), 40),
      email: text(get("email_reservations") ?? get("site_business_email"), 160),
      address: text(get("brand_location"), 200),
    },
  };
}

/** Color de texto legible (blanco/negro) sobre un fondo hexadecimal. */
export function contrastOn(hex: string | null): string | null {
  if (!hex || !HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? "#111111" : "#ffffff";
}
