/**
 * Subida de imágenes a Multimedia (`POST /api/upload/image`): los formatos y el tamaño que admite el servidor
 * (server/uploadRoutes.ts y la categoría `media` de server/_core/files/categories.ts) y los mensajes para la persona.
 */

export const IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif"] as const;
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Fichero público del Core con dirección absoluta (`https://<dominio>/files/<id>/<nombre>`). */
const OWN_PUBLIC_FILE_RE = /^https?:\/\/[^/\s]+(\/files\/[0-9a-z]{26}(?:\/[^\s?#]*)?)$/;

/**
 * Un fichero público de la empresa como ruta de su propia web (`/files/<id>/<nombre>`): se carga desde el dominio en
 * el que se esté (el de la plataforma, el propio de la empresa, la vista previa), no desde el que se usó al subirlo.
 * Cualquier otra dirección se devuelve tal cual.
 */
export function siteRelativeFileUrl(url: string): string {
  const m = OWN_PUBLIC_FILE_RE.exec(url.trim());
  return m ? m[1] : url;
}

/** Por qué no se puede subir un fichero (texto para la persona), o null si se puede. */
export function imageUploadProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) return "Ese formato no se admite. Sube una imagen JPG, PNG, WebP, GIF, SVG o AVIF.";
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return `La imagen pesa más de ${IMAGE_UPLOAD_MAX_BYTES / 1024 / 1024} MB. Redúcela e inténtalo de nuevo.`;
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

/** Mensaje de una subida rechazada, según la respuesta del servidor. */
export function uploadErrorMessage(status: number, serverMessage?: string | null): string {
  if (serverMessage) return serverMessage;
  if (status === 413) return `La imagen pesa más de ${IMAGE_UPLOAD_MAX_BYTES / 1024 / 1024} MB. Redúcela e inténtalo de nuevo.`;
  if (status === 401 || status === 403) return "Tu sesión ha caducado o no tienes permiso para subir imágenes. Vuelve a iniciar sesión.";
  if (status === 507 || status === 429) return "Has alcanzado el límite de almacenamiento de tu plan.";
  if (status >= 500) return "El servidor no ha podido guardar la imagen. Inténtalo de nuevo en unos minutos.";
  return "No se ha podido subir la imagen.";
}
