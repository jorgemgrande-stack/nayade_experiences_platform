/**
 * Marcadores de datos de la empresa en sus páginas (`{{telefono}}`, `{{nif}}`…), tal y como se ven en el editor: un
 * distintivo legible («Teléfono de tu empresa»). Lo que se guarda sigue siendo el marcador, y la web pública lo
 * sustituye por el dato al servir la página. Solo presentación.
 */
export const SITE_TOKEN_LABELS: Record<string, string> = {
  nombre: "Nombre de tu empresa",
  razon_social: "Razón social de tu empresa",
  nif: "NIF de tu empresa",
  domicilio: "Domicilio fiscal de tu empresa",
  email: "Correo de tu empresa",
  telefono: "Teléfono de tu empresa",
  direccion: "Dirección de tu empresa",
};

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;
const BADGE = /<span\b[^>]*\bdata-token="([a-z_]+)"[^>]*>[\s\S]*?<\/span>/g;

/** Clases del distintivo dentro del texto con formato (no editable por dentro: se borra entero). */
export const TOKEN_BADGE_CLASS = "mx-0.5 inline-block rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[0.85em] font-medium text-primary align-baseline";

/** HTML guardado → HTML del editor: cada marcador conocido pasa a un distintivo. */
export function tokensToBadges(html: string): string {
  return String(html ?? "").replace(TOKEN, (m, key: string) => {
    const label = SITE_TOKEN_LABELS[key];
    return label ? `<span data-token="${key}" contenteditable="false" class="${TOKEN_BADGE_CLASS}">${label}</span>` : m;
  });
}

/** HTML del editor → HTML que se guarda: cada distintivo vuelve a ser su marcador. */
export function badgesToTokens(html: string): string {
  return String(html ?? "").replace(BADGE, (m, key: string) => (SITE_TOKEN_LABELS[key] ? `{{${key}}}` : m));
}

export type TokenPart = { text: string } | { token: string; label: string };

/** Texto sin formato partido en trozos y distintivos (para mostrar cómo se verá un campo de una línea). */
export function splitTokens(text: string): TokenPart[] {
  const out: TokenPart[] = [];
  let last = 0;
  for (const m of Array.from(String(text ?? "").matchAll(TOKEN))) {
    const label = SITE_TOKEN_LABELS[m[1]];
    if (!label) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ token: m[1], label });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** true si el texto usa algún marcador conocido. */
export function hasSiteTokens(text: string): boolean {
  return splitTokens(String(text ?? "")).some((p) => "token" in p);
}
