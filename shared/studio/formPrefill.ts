/**
 * Formulario ya rellenado desde un enlace: `#solicitud?experiencia=Viaje del Alma` (el enlace de una tarjeta, un botón…).
 * Cada pareja `nombre=valor` rellena el campo cuya pregunta se llama así (sin tildes ni mayúsculas, con guiones: «Experiencia»
 * → `experiencia`, «Tipo de viaje» → `tipo-de-viaje`) SOLO si es un selector o botones de opción y el valor coincide con
 * una de sus opciones (sin distinguir tildes ni mayúsculas). El parámetro puede ser el nombre completo de la pregunta o una
 * de sus palabras si identifica un solo campo («¿Qué experiencia te interesa?» → `experiencia`). Nada se escribe en campos de texto: un enlace no puede meter texto
 * libre en el formulario de otra persona.
 */
export interface PrefillField {
  kind: string;
  label: string;
  options?: string;
}

const plain = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Nombre del parámetro de un campo, a partir de su pregunta. */
export function fieldParam(label: string): string {
  return plain(label).replace(/ /g, "-").slice(0, 40);
}

/** Lo que va tras «?» en un ancla (`#solicitud?experiencia=X` → `experiencia=X`); vacío si no hay. */
export function hashQuery(hash: string): string {
  const i = hash.indexOf("?");
  return i >= 0 ? hash.slice(i + 1) : "";
}

/** Valores por posición de campo (`f0`, `f1`…) que el enlace deja elegidos. */
export function formPrefill(fields: PrefillField[], query: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    return out;
  }
  const slugs = fields.map((f) => fieldParam(f.label));
  // Campo al que apunta un parámetro: el de nombre idéntico o, si no hay, el único con esa palabra en su nombre
  const target = (name: string): number => {
    const exact = slugs.indexOf(name);
    if (exact >= 0) return exact;
    const hits = slugs.flatMap((sl, i) => (sl.split("-").includes(name) ? [i] : []));
    return hits.length === 1 ? hits[0] : -1;
  };
  const wanted = new Map<number, string>();
  params.forEach((value, name) => {
    const i = target(plain(name).replace(/ /g, "-"));
    if (i >= 0 && !wanted.has(i)) wanted.set(i, value);
  });
  fields.forEach((f, i) => {
    if (f.kind !== "select" && f.kind !== "radio") return;
    const want = wanted.get(i);
    if (!want) return;
    const options = (f.options ?? "").split(/\r?\n/).map((o) => o.trim()).filter(Boolean);
    const hit = options.find((o) => plain(o) === plain(want));
    if (hit) out[`f${i}`] = hit;
  });
  return out;
}
