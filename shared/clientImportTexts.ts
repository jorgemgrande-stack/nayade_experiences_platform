/**
 * Textos del diálogo «Importar clientes» con el singular y el plural correctos («1 alta», «2 altas»).
 */
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface ImportTotals {
  create: number;
  update: number;
  unchanged: number;
  review: number;
  error: number;
}

/** Resumen de la vista previa: qué pasará con las filas del fichero. */
export function importPreviewSummary(t: ImportTotals): string {
  return `${n(t.create, "alta nueva", "altas nuevas")}, ${n(t.update, "cliente a completar", "clientes a completar")}, `
    + `${n(t.unchanged, "fila sin cambios", "filas sin cambios")}, ${n(t.review, "fila para revisar a mano", "filas para revisar a mano")} `
    + `y ${n(t.error, "fila que no se importa", "filas que no se importan")}.`;
}

/** Aviso al terminar. */
export function importDoneToast(created: number, updated: number): string {
  return `Importación terminada: ${n(created, "alta", "altas")} y ${n(updated, "cliente completado", "clientes completados")}`;
}

/** Resultado final. */
export function importResultSentence(created: number, updated: number): string {
  const alta = created === 0 ? "No se ha dado de alta ningún cliente" : created === 1 ? "Se ha dado de alta 1 cliente" : `Se han dado de alta ${created} clientes`;
  const filled = updated === 0 ? "no se ha completado ningún cliente existente" : updated === 1 ? "se han completado los datos de 1 cliente existente" : `se han completado los datos de ${updated} clientes existentes`;
  return `${alta} y ${filled}.`;
}

/** Botón de confirmar. */
export function importButtonLabel(count: number): string {
  return count === 0 ? "Nada que importar" : `Importar ${n(count, "cliente", "clientes")}`;
}
