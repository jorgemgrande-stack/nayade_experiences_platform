/**
 * Sedes de la empresa (capacidad Business `multi-site`): lógica pura, sin BD ni React (la usan el plano de control,
 * el Core y el panel).
 *
 *  - La fuente de verdad de las sedes es el registro del plano de control (`tenant_sites`). El Core no guarda otra
 *    lista: solo etiqueta sus datos (cajas, sesiones de caja, ventas del TPV y usuarios) con el id de la sede.
 *  - Sede principal: la primera sede activa del registro (por fecha de alta). Si la empresa aún no tiene ninguna,
 *    existe igualmente una principal implícita (`PRIMARY_SITE_ID`), que se crea en el registro la primera vez que se
 *    edita o que se añade otra sede.
 *  - En el Core, `site_id` NULL = sede principal: todo lo anterior a las sedes queda en la principal sin migrar datos.
 */

export const MULTI_SITE_CAPABILITY = "multi-site";
/** Id de la sede principal implícita (empresa sin sedes en el registro). */
export const PRIMARY_SITE_ID = "principal";
export const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface PanelSite {
  siteId: string;
  name: string;
  status: "active" | "archived";
  isPrimary: boolean;
  /** true: principal implícita (aún no está en el registro). */
  virtual: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
  createdAt: number | null;
}

export interface PanelSites {
  sites: PanelSite[];
  primarySiteId: string;
  /** Sedes activas permitidas por el plan (null = por contrato, sin tope técnico). */
  limit: number | null;
  /** Sedes activas (la principal implícita cuenta como una). */
  used: number;
  canAdd: boolean;
}

export interface SiteFormInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Errores de validación del formulario de sede (vacío = correcto). */
export function validateSiteForm(f: SiteFormInput): Partial<Record<keyof SiteFormInput, string>> {
  const out: Partial<Record<keyof SiteFormInput, string>> = {};
  const name = f.name.trim();
  if (name.length < 2) out.name = "Escribe el nombre de la sede (al menos 2 caracteres).";
  else if (name.length > 160) out.name = "El nombre no puede superar 160 caracteres.";
  if ((f.address ?? "").trim().length > 300) out.address = "La dirección no puede superar 300 caracteres.";
  const phone = (f.phone ?? "").trim();
  if (phone && !/^[+0-9 ()-]{6,40}$/.test(phone)) out.phone = "Escribe un teléfono válido (solo números, espacios, +, guiones y paréntesis).";
  const email = (f.email ?? "").trim();
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) out.email = "Escribe un correo electrónico válido.";
  return out;
}

/** Id estable a partir del nombre (minúsculas, sin acentos, guiones), sin chocar con los ya usados. */
export function siteIdFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "sede";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
}

/** Valor que se guarda en el Core para una sede: NULL si es la principal (lo existente ya está en NULL). */
export function storedSiteId(siteId: string | null | undefined, primarySiteId: string): string | null {
  if (!siteId || siteId === primarySiteId) return null;
  return siteId;
}

/** Sede de un dato del Core (NULL = principal). */
export function siteOfStored(stored: string | null | undefined, primarySiteId: string): string {
  return stored || primarySiteId;
}

/**
 * ¿Puede un usuario trabajar en esa sede? Sin sedes asignadas trabaja en todas (lo de siempre); con sedes asignadas,
 * solo en ellas. `siteId` es la sede efectiva (la principal si el dato está en NULL).
 */
export function userWorksAtSite(assigned: readonly string[], siteId: string): boolean {
  return assigned.length === 0 || assigned.includes(siteId);
}
