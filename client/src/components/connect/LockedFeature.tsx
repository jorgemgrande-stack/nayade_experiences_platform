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
import type { ConnectState } from "@shared/connectMarketplace";
import { localizeConnectText } from "@shared/i18n/connectCatalogDe";
import { useI18n } from "@/i18n/I18nProvider";
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
  const { t, locale } = useI18n();
  const { items, isLoading } = useConnectCatalog();
  const item = product ? (items.find((i) => i.key === product) ?? null) : capability ? productForCapability(items, capability) : null;
  if (isLoading) return null;
  const stateLabel = (s: ConnectState) => {
    switch (s) {
      case "available": return t("connectStrip.states.available");
      case "active": return t("connectStrip.states.active");
      case "pending_setup": return t("connectStrip.states.pending_setup");
      case "activating": return t("connectStrip.states.activating");
      case "not_eligible": return t("connectStrip.states.not_eligible");
      case "on_request": return t("connectStrip.states.on_request");
      case "coming_soon": return t("connectStrip.states.coming_soon");
      case "incident": return t("connectStrip.states.incident");
    }
  };
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
        <span className="block font-medium text-foreground truncate">{item ? localizeConnectText(item.name, locale) : t("connectStrip.notIncluded")}</span>
        {!compact && (
          <span className="block text-xs text-muted-foreground truncate">
            {item ? `${stateLabel(item.state)}${item.tagline ? ` · ${localizeConnectText(item.tagline, locale)}` : ""}` : t("connectStrip.discover")}
          </span>
        )}
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
      <span className="sr-only">{t("connectStrip.viewSheet")}</span>
    </Link>
  );
}

export default LockedFeature;
