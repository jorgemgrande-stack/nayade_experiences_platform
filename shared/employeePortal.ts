/**
 * Portal del empleado sin depender de Elephant People para los profesores de Ski Net.
 *
 * El guardián de licencias rechaza una petición HTTP entera si alguna de sus consultas no está contratada. En el portal,
 * `hr.portal.me` (Personal, `people-hr`) y `skiSchool.myClasses` (Ski Net) iban agrupadas: sin People, el 403 de la
 * primera tumbaba también la de las clases y el profesor no veía nada. Por eso el portal envía sus consultas sueltas
 * (`unbatchedTrpcPath`) y, sin People o sin ficha de empleado, un profesor vinculado ve solo «Mis clases».
 */

/** Rutas del cliente cuyas consultas tRPC se envían una a una (no agrupadas): el portal del empleado. */
export function unbatchedTrpcPath(pathname: string): boolean {
  return pathname === "/empleado" || pathname.startsWith("/empleado/");
}

export type EmployeePortalMode =
  /** Portal completo de Personal (más «Mis clases» si es profesor). */
  | "full"
  /** Sin Personal (o sin ficha de empleado) pero profesor vinculado de la escuela: solo «Mis clases». */
  | "teacher_only"
  /** Sin Personal y sin vínculo de profesor. */
  | "unavailable"
  /** Con Personal, pero el usuario no tiene ficha de empleado (y no es profesor). */
  | "not_linked";

/** Qué muestra el portal según la respuesta de `hr.portal.me` y si el usuario es profesor de la escuela. */
export function employeePortalMode(meError: { code?: string; capability?: string } | null | undefined, isTeacher: boolean): EmployeePortalMode {
  const peopleMissing = meError?.capability === "people-hr";
  const notLinked = !peopleMissing && meError?.code === "FORBIDDEN";
  if ((peopleMissing || notLinked) && isTeacher) return "teacher_only";
  if (peopleMissing) return "unavailable";
  if (notLinked) return "not_linked";
  return "full";
}

/** Ruta del portal de un profesor sin Personal. */
export const TEACHER_PORTAL_PATH = "/empleado/clases";
