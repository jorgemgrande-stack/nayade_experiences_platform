/**
 * Aspecto del portal del empleado a partir del tema público de la empresa (`public.getTheme`). Lógica pura: la usan
 * el portal y las pruebas.
 *
 *  - Fondo claro y texto grafito: el portal se lee igual en cualquier empresa.
 *  - Nombre, logotipo y teléfono: los de la empresa que sirve el dominio. Sin dato, vacío; nunca los de otra empresa.
 *  - Color de realce (pestaña activa, botones, iconos): el color principal de la empresa si se lee sobre blanco
 *    (≥ 4.5:1, texto normal); si no, su color de acento con la misma condición; si ninguno se lee o no hay marca,
 *    el grafito neutro.
 */
import { NEUTRAL_INK, contrastRatio, readableOn } from "./loginBrand";

export interface EmployeePortalThemeInput {
  brandName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  contact?: { phone?: string | null } | null;
}

export interface EmployeePortalLook {
  /** Nombre comercial de la empresa; vacío si no lo ha configurado. */
  name: string;
  logoUrl: string | null;
  /** Inicial para el distintivo cuando no hay logotipo; vacía sin nombre. */
  initial: string;
  phone: string | null;
  /** Enlace `tel:` del teléfono, o null. */
  phoneTel: string | null;
  /** Color de realce y su texto. */
  accent: string;
  accentFg: string;
  /** true si el realce sale de los colores de la empresa (false = aspecto neutro). */
  branded: boolean;
  /** Variables CSS que usan las pantallas del portal. */
  vars: Record<string, string>;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const WHITE = "#ffffff";

function hex6(c: string | null | undefined): string | null {
  const s = (c ?? "").trim();
  if (!HEX.test(s)) return null;
  return s.length === 4 ? "#" + s.slice(1).split("").map((ch) => ch + ch).join("") : s.toLowerCase();
}

const readsOnWhite = (c: string | null): c is string => !!c && (contrastRatio(c, WHITE) ?? 0) >= 4.5;

export function employeePortalLook(theme: EmployeePortalThemeInput | null | undefined): EmployeePortalLook {
  const name = (theme?.brandName ?? "").trim();
  const logoUrl = (theme?.logoUrl ?? "").trim() || null;
  const phone = (theme?.contact?.phone ?? "").trim() || null;
  const primary = hex6(theme?.primaryColor);
  const accentOwn = hex6(theme?.accentColor);
  const own = readsOnWhite(primary) ? primary : readsOnWhite(accentOwn) ? accentOwn : null;
  const accent = own ?? NEUTRAL_INK;
  const accentFg = readableOn(accent);
  return {
    name,
    logoUrl,
    initial: name ? name.charAt(0).toLocaleUpperCase("es") : "",
    phone,
    phoneTel: phone ? "tel:" + phone.replace(/[\s\-()]/g, "") : null,
    accent,
    accentFg,
    branded: own !== null,
    vars: {
      "--portal-accent": accent,
      "--portal-accent-fg": accentFg,
      // Fondos y bordes suaves del mismo color (hex con transparencia)
      "--portal-accent-soft": accent + "14",
      "--portal-accent-line": accent + "4d",
    },
  };
}
