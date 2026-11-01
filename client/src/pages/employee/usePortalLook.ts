/**
 * Identidad de la empresa en el portal del empleado: nombre, logotipo, teléfono y color de realce, desde su tema
 * público. Sin marca configurada (o mientras carga), aspecto neutro: nunca la de otra empresa.
 *
 * El portal es siempre claro: mientras está montado se retira el modo oscuro del panel de <html> (como la web
 * pública con `forcePublicLight`) y se restablece al salir.
 */
import { useEffect, type CSSProperties } from "react";
import { trpc } from "@/lib/trpc";
import { employeePortalLook, type EmployeePortalLook } from "@shared/employeePortalBrand";

export function usePortalLook(): EmployeePortalLook & { style: CSSProperties } {
  const { data } = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, []);
  const look = employeePortalLook(data ?? null);
  return { ...look, style: look.vars as CSSProperties };
}
