/**
 * Candados de Elephant Connect en los lugares de trabajo (CRM, comunicaciones, administración): lo que la empresa
 * podría añadir en ESA sección, con el nombre, el lema y el estado real del catálogo (igual que la ficha). Cada uno
 * abre su ficha en /admin/ampliar/:clave. Lo contratado y activo no aparece; si el catálogo no está disponible
 * (instalación de una sola empresa, sin canal o sin permiso), no se muestra nada. Sin ventanas ni avisos.
 *
 * Solo capacidades reales del catálogo (server/catalog/capabilities.ts) con su producto de Elephant Connect.
 */
import { LockedFeature, productForCapability } from "./LockedFeature";
import { useConnectCatalog, type ConnectCatalogItem } from "./useConnect";

export const WORKPLACE_LOCKS = {
  /** CRM y seguimiento comercial: automatizaciones, bandeja de WhatsApp con IA y asistente de IA. */
  crm: ["automations-advanced", "whatsapp-ai", "copilot-advanced"],
  /** Comunicaciones: llamadas con IA, bandeja de WhatsApp y respuestas automáticas (recepcionista virtual). */
  comms: ["voice-ai", "whatsapp-ai", "reception-ai"],
  /** Administración: empleados y fichajes, bancos y TPV, impuestos con la gestoría. */
  admin: ["people-hr", "bank-import-pos", "tax-filings"],
} as const satisfies Record<string, readonly string[]>;

export type WorkplaceLockPlace = keyof typeof WORKPLACE_LOCKS;

/** Productos del catálogo que se muestran como candado: los que conceden esas capacidades y no están activos. */
export function workplaceLockItems<T extends Pick<ConnectCatalogItem, "key" | "capabilities" | "kind" | "family" | "state">>(items: T[], capabilities: readonly string[]): T[] {
  const out: T[] = [];
  for (const cap of capabilities) {
    const item = productForCapability(items, cap);
    if (!item || item.state === "active" || out.some((o) => o.key === item.key)) continue;
    out.push(item);
  }
  return out;
}

export function WorkplaceLocks({ place, className }: { place: WorkplaceLockPlace; className?: string }) {
  const { items, isLoading } = useConnectCatalog();
  if (isLoading) return null;
  const locked = workplaceLockItems(items, WORKPLACE_LOCKS[place]);
  if (locked.length === 0) return null;
  return (
    <section aria-label="Amplía tu empresa" className={className}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Amplía tu empresa</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {locked.map((i) => (
          <LockedFeature key={i.key} product={i.key} />
        ))}
      </div>
    </section>
  );
}

export default WorkplaceLocks;
