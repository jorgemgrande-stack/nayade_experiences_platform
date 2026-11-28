/**
 * Rejilla dinámica de tarjetas (productos y convocatorias de la web pública): las clases de Tailwind del contenedor y
 * de cada tarjeta según cuántas hay, para que una o dos fichas no queden pegadas a la izquierda y la última fila de
 * cinco, seis o siete quede centrada sin huecos a la derecha. Función pura, sin React.
 */
const HALF = "sm:w-[calc(50%-0.75rem)]";
const THIRD = "lg:w-[calc(33.333%-1rem)]";
const QUARTER = "lg:w-[calc(25%-1.125rem)]";

export function cardGridClasses(count: number, maxCols: 2 | 3 | 4): { wrap: string; item: string } {
  const wrap = "flex flex-wrap justify-center gap-6";
  if (count <= 1) return { wrap, item: "w-full max-w-md" };
  if (count === 2 || maxCols === 2) return { wrap: `${wrap} mx-auto max-w-4xl`, item: `w-full ${HALF}` };
  if (count === 3 || maxCols === 3) return { wrap, item: `w-full ${HALF} ${THIRD}` };
  return { wrap, item: `w-full ${HALF} ${QUARTER}` };
}
