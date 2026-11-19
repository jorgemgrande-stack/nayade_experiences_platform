/**
 * Límites de almacenamiento efectivos de la empresa en curso, separados por ámbito:
 *
 *  - Tamaño máximo por imagen (CMS → Multimedia): 10 MB para todos; una condición negociada (excepción comercial de la
 *    métrica `media_file_mb`, que concede el operador) lo sube para esa empresa. Nunca supera el techo técnico de la
 *    plataforma (`STORAGE_MAX_BYTES`, 25 MB por defecto), que es el que de verdad protege al servidor.
 *  - Almacenamiento general: `storage_gb` (plan + ampliaciones, o excepción vigente). No incluye Elephant Learning.
 *  - Almacenamiento Learning: `learning_storage_gb`. Por defecto 0: sin concesión expresa no se sube contenido educativo.
 *
 * Todo se calcula de lo que hay almacenado (stored_objects) y de la política efectiva: no hay contadores propios.
 */
import { currentBusinessLimit } from "../../businessQuotas";

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const DEFAULT_IMAGE_MAX_MB = 10;

/** Techo técnico por fichero subido por un usuario (variable de entorno; 25 MB por defecto). */
export function storageCeilingBytes(): number {
  const n = Number(process.env.STORAGE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 25 * MB;
}

/**
 * Máximo en bytes de una imagen para la empresa en curso. Si la política no se puede leer (o no aplica), se usa el
 * valor general de 10 MB: un fallo nunca da más de lo habitual.
 */
export async function imageMaxBytes(): Promise<number> {
  let mb = DEFAULT_IMAGE_MAX_MB;
  try {
    const eff = await currentBusinessLimit("media_file_mb");
    if (eff && typeof eff.limit === "number" && eff.limit > 0) mb = eff.limit;
  } catch {
    mb = DEFAULT_IMAGE_MAX_MB;
  }
  return Math.min(Math.floor(mb * MB), storageCeilingBytes());
}

export interface LearningStorageLimit {
  /** null = sin tope (empresa sin plan en instalación única o antigua: como el resto de cuotas de negocio). */
  limitGb: number | null;
  source: string;
  enforcement: "hard" | "soft" | "none";
}

/** Cuota de almacenamiento Learning de la empresa en curso. `null` si no se aplica ninguna. */
export async function learningStorageLimit(): Promise<LearningStorageLimit | null> {
  try {
    const eff = await currentBusinessLimit("learning_storage_gb");
    if (!eff) return null;
    return { limitGb: eff.limit, source: eff.source, enforcement: eff.enforcement };
  } catch {
    return null;
  }
}
