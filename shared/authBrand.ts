/**
 * Marca de las páginas de acceso (login, recuperar, restablecer y establecer contraseña). Lógica pura:
 * la usan el cliente y las pruebas.
 *
 *  - single (Náyade, `neutralSite` falso): exactamente los textos y el logotipo de siempre.
 *  - multi: el nombre, el logotipo y la dirección de la empresa que sirve el dominio; sin dato, vacío
 *    (nunca los de Náyade).
 *  - Sin tema todavía (cargando o error): marca neutra, sin nombre.
 */

export interface AuthBrand {
  /** Inicial para el distintivo cuando no hay logotipo. */
  initial: string;
  /** Nombre corto en grande («NÁYADE» en single). */
  name: string;
  /** Línea secundaria («Experiences» en single). */
  tagline: string;
  /** Nombre completo para frases («Náyade Experiences» en single). */
  fullName: string;
  /** Pie del panel lateral (dirección); vacío si no hay. */
  location: string;
  /** Descripción del panel de acceso. */
  description: string;
  logoUrl: string | null;
}

export const LEGACY_AUTH_BRAND: AuthBrand = {
  initial: "N",
  name: "NÁYADE",
  tagline: "Experiences",
  fullName: "Náyade Experiences",
  location: "Los Ángeles de San Rafael, Segovia · A 45 min de Madrid",
  description: "Gestiona reservas, experiencias, el hotel y el SPA desde un único lugar.",
  logoUrl: "https://cdn-biz.manus.space/biz-file/c1/AV298FS8t5SaTurBBRqhgQ/1741956872-nayade_logo_azul.jpg",
};

const NEUTRAL_DESCRIPTION = "Gestiona tu negocio desde un único lugar.";

export interface AuthBrandThemeInput {
  neutralSite: boolean;
  brandName: string | null;
  logoUrl: string | null;
  contact?: { address?: string | null } | null;
}

export function authBrand(theme: AuthBrandThemeInput | null | undefined): AuthBrand {
  if (theme && !theme.neutralSite) return LEGACY_AUTH_BRAND;
  const name = (theme?.brandName ?? "").trim();
  return {
    initial: name ? name.charAt(0).toLocaleUpperCase("es") : "",
    name,
    tagline: "",
    fullName: name,
    location: (theme?.contact?.address ?? "").trim(),
    description: NEUTRAL_DESCRIPTION,
    logoUrl: theme?.logoUrl ?? null,
  };
}
