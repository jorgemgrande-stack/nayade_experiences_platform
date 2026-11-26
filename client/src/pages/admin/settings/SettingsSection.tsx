/**
 * Sección de un formulario de Configuración: título, descripción breve y los campos. Solo presentación
 * (local de esta carpeta; no sustituye a ningún componente compartido).
 */
import type { ReactNode } from "react";

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <header className="space-y-0.5">
        <h3 className="text-sm font-semibold font-display text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}
