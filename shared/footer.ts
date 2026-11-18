/**
 * Pie de la web de cada empresa: redes sociales y agrupación del menú de pie en columnas. Lógica pura (la usan el
 * servidor, para validar lo que se guarda, y la web pública, para pintarlo).
 *
 * Redes: lista cerrada. Cada enlace es https, de un dominio de ESA red (no se puede poner un icono de una red con un
 * enlace a otro sitio), sin usuario ni contraseña en la dirección. Nada de scripts ni incrustaciones externas: solo
 * un enlace.
 */

export const SOCIAL_NETWORKS = ["instagram", "facebook", "youtube", "telegram", "x", "linkedin"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

export const SOCIAL_MAX = 8;
export const SOCIAL_URL_MAX = 300;

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  telegram: "Telegram",
  x: "X",
  linkedin: "LinkedIn",
};

/** Dominios (y sus subdominios) que admite cada red. */
const SOCIAL_HOSTS: Record<SocialNetwork, string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  youtube: ["youtube.com", "youtu.be"],
  telegram: ["t.me", "telegram.me", "telegram.org"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
};

const isNetwork = (v: unknown): v is SocialNetwork => typeof v === "string" && (SOCIAL_NETWORKS as readonly string[]).includes(v);

/** Dirección https válida de una red, o un mensaje de error en español. */
export function checkSocialUrl(network: SocialNetwork, raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, error: "Falta la dirección." };
  if (s.length > SOCIAL_URL_MAX || /\s/.test(s)) return { ok: false, error: "La dirección no es válida." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "La dirección no es válida (empieza por https://)." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Usa una dirección https://." };
  if (u.username || u.password) return { ok: false, error: "La dirección no puede llevar usuario ni contraseña." };
  const host = u.hostname.toLowerCase();
  if (!SOCIAL_HOSTS[network].some((d) => host === d || host.endsWith(`.${d}`))) {
    return { ok: false, error: `La dirección no es de ${SOCIAL_LABELS[network]}.` };
  }
  return { ok: true, url: u.toString() };
}

/** Lee lo guardado (JSON); lo que no sea válido se descarta, nunca rompe la web. */
export function parseFooterSocial(raw: string | null | undefined): SocialLink[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const it of data) {
    if (out.length >= SOCIAL_MAX) break;
    const network = (it as { network?: unknown })?.network;
    if (!isNetwork(network) || seen.has(network)) continue;
    const r = checkSocialUrl(network, (it as { url?: unknown }).url);
    if (!r.ok) continue;
    seen.add(network);
    out.push({ network, url: r.url });
  }
  return out;
}

/** Valida lo que envía el panel (con errores en español) y devuelve el JSON que se guarda. */
export function validateFooterSocial(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  let data: unknown = input;
  if (typeof input === "string") {
    if (!input.trim()) return { ok: true, value: "[]" };
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, error: "Redes sociales: formato no válido." };
    }
  }
  if (!Array.isArray(data)) return { ok: false, error: "Redes sociales: formato no válido." };
  if (data.length > SOCIAL_MAX) return { ok: false, error: `Como máximo ${SOCIAL_MAX} redes sociales.` };
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const it of data) {
    const network = (it as { network?: unknown })?.network;
    if (!isNetwork(network)) return { ok: false, error: "Red social no admitida." };
    if (seen.has(network)) return { ok: false, error: `${SOCIAL_LABELS[network]} está repetida.` };
    const r = checkSocialUrl(network, (it as { url?: unknown }).url);
    if (!r.ok) return { ok: false, error: `${SOCIAL_LABELS[network]}: ${r.error}` };
    seen.add(network);
    out.push({ network, url: r.url });
  }
  return { ok: true, value: JSON.stringify(out) };
}

// ─── Columnas del pie a partir del menú «pie» ─────────────────────────────────

export interface FooterMenuItem {
  id: number;
  parentId?: number | null;
  label: string;
  url?: string | null;
  target?: string | null;
  sortOrder: number;
  isActive?: boolean | null;
}

export interface FooterColumn {
  id: number;
  title: string;
  links: FooterMenuItem[];
}

export const FOOTER_COLUMNS_MAX = 4;

/**
 * Del menú de pie: las columnas son los elementos de primer nivel SIN enlace que tienen elementos activos dentro
 * (el título de la columna y sus enlaces); el resto de primer nivel, con enlace, es la franja inferior (legales).
 * Una empresa sin columnas conserva su pie de siempre.
 */
export function footerLayout(items: FooterMenuItem[]): { columns: FooterColumn[]; bottom: FooterMenuItem[] } {
  const active = items.filter((i) => i.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const top = active.filter((i) => !i.parentId);
  const columns: FooterColumn[] = [];
  for (const t of top) {
    if (t.url) continue;
    const links = active.filter((c) => c.parentId === t.id && !!c.url);
    if (links.length && columns.length < FOOTER_COLUMNS_MAX) columns.push({ id: t.id, title: t.label, links });
  }
  return { columns, bottom: top.filter((t) => !!t.url) };
}
