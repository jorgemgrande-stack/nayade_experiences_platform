import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * «Conciliación TPV» es ahora la cabecera «Estado de la conciliación» de Remesas TPV. La ruta antigua sigue
 * respondiendo: redirige a Remesas conservando la consulta (?…) y el ancla (#…) por si traen contexto.
 */
export const REMESAS_TPV_PATH = "/admin/contabilidad/remesas-tpv";

export default function CardTerminalConciliationDashboard() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(`${REMESAS_TPV_PATH}${window.location.search}${window.location.hash}`, { replace: true });
  }, [navigate]);
  return null;
}
