/**
 * Identidad de la empresa en el portal del empleado: nombre, logotipo, teléfono y color de realce, desde su tema
 * público. Sin marca configurada (o mientras carga), aspecto neutro: nunca la de otra empresa.
 */
import type { CSSProperties } from "react";
import { trpc } from "@/lib/trpc";
import { employeePortalLook, type EmployeePortalLook } from "@shared/employeePortalBrand";

export function usePortalLook(): EmployeePortalLook & { style: CSSProperties } {
  const { data } = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const look = employeePortalLook(data ?? null);
  return { ...look, style: look.vars as CSSProperties };
}
