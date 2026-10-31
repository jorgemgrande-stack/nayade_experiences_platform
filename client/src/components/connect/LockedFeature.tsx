/**
 * Candado discreto para una función que la empresa no tiene: nombre, una línea de descripción y enlace a su ficha
 * en Elephant Connect (/admin/ampliar/:clave). Sin ventanas emergentes ni avisos invasivos.
 *
 *   <LockedFeature capability="people-hr" />            → candado si la capacidad no está activa
 *   <LockedFeature capability="people-hr">…</LockedFeature> → muestra el contenido si está activa
 *   <LockedFeature product="connect-people" />           → por clave del catálogo
 *
 * Solo presentación: la autorización real sigue en el servidor.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONNECT_STATE_LABELS } from "@shared/connectMarketplace";
import { useConnectCatalog, type ConnectCatalogItem } from "./useConnect";

export const AMPLIAR_PATH = "/admin/ampliar";
export const fichaPath = (key: string) => `${AMPLIAR_PATH}/${encodeURIComponent(key)}`;

/** Producto del catálogo que concede una capacidad (el más específico: menos capacidades, módulo antes que paquete). */
export function productForCapability<T extends Pick<ConnectCatalogItem, "capabilities" | "kind" | "family">>(items: T[], capability: string): T | null {
  const hits = items.filter((i) => i.kind === "module" && i.capabilities.includes(capability));
  hits.sort((a, b) => Number(a.family.endsWith("bundle")) - Number(b.family.endsWith("bundle")) || a.capabilities.length - b.capabilities.length);
  return hits[0] ?? null;
}

export function LockedFeature({ capability, product, children, className, compact = false }: { capability?: string; product?: string; children?: ReactNode; className?: string; compact?: boolean }) {
  const { items, isLoading } = useConnectCatalog();
  const item = product ? (items.find((i) => i.key === product) ?? null) : capability ? productForCapability(items, capability) : null;
  if (isLoading) return null;
  if (item?.state === "active") return <>{children ?? null}</>;
  const href = item ? fichaPath(item.key) : AMPLIAR_PATH;
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Lock className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground truncate">{item?.name ?? "No incluido en tu plan"}</span>
        {!compact && (
          <span className="block text-xs text-muted-foreground truncate">
            {item ? `${CONNECT_STATE_LABELS[item.state]}${item.tagline ? ` · ${item.tagline}` : ""}` : "Descubre cómo ampliar tu plataforma"}
          </span>
        )}
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
      <span className="sr-only">Ver la ficha</span>
    </Link>
  );
}

export default LockedFeature;
