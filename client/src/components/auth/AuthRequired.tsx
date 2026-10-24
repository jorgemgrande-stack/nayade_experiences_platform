/**
 * Sin sesión en una pantalla del panel: con el acceso local se va directamente al inicio de sesión de la empresa
 * (mismo armazón y misma identidad que el resto del acceso) y se vuelve aquí al entrar. Sin pantallas intermedias
 * con otro aspecto. Con el acceso antiguo (OAuth), un aviso con los colores del sistema.
 */
import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { getLoginUrl, isLocalAuth } from "@/const";

export function PanelSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Cargando">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function AuthRequired({ returnTo }: { returnTo: string }) {
  const local = isLocalAuth();
  useEffect(() => {
    if (local) window.location.replace(getLoginUrl(returnTo));
  }, [local, returnTo]);
  if (local) return <PanelSpinner />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-sm px-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Inicia sesión para continuar</h2>
        <p className="text-muted-foreground mb-6">Necesitas una sesión para entrar en el panel de administración.</p>
        <button className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-8 py-3 rounded-xl w-full transition-colors" onClick={() => (window.location.href = getLoginUrl(returnTo))}>
          Iniciar sesión
        </button>
      </div>
    </div>
  );
}
