/**
 * Validación de destinos de redirección: solo rutas relativas del propio sitio.
 * Rechaza URL absolutas, `//host`, `/\host`, esquemas (`javascript:`), barras invertidas y
 * caracteres de control.
 */
export function safeReturnPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return fallback;
  }
  return value;
}
