/**
 * Elephant Studio: vista previa REAL de uno o varios bloques para la biblioteca. Pinta los bloques con el mismo
 * componente que la web publicada (PageBlocksView, en modo vista previa: los enlaces no navegan y los formularios no
 * envían), con los colores, la tipografía y los datos de la empresa (productos, entradas del blog, {{telefono}}…), a
 * ancho de ordenador y reducida a la miniatura. Solo se monta la que se está mirando.
 *
 * Si el bloque no pinta nada en la web todavía (una imagen sin elegir, una galería vacía), se muestra su miniatura
 * esquemática en su lugar.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageBlocksView } from "@/components/site/PageBlocksView";
import { useTenantTheme } from "@/components/TenantTheme";
import { brandTokens } from "@shared/loginBrand";
import type { PageBlock } from "@shared/pageBlocks";
import { renderTokens, type SiteTokens } from "./tokens";
import { BlockThumb } from "./BlockThumb";

/** Ancho al que se pinta la página antes de reducirla (diseño de ordenador) */
const DESKTOP = 1200;

export function RealPreview({ blocks, width, maxHeight }: { blocks: PageBlock[]; width: number; maxHeight: number }) {
  const { theme } = useTenantTheme();
  const brand = theme?.neutralSite ? brandTokens(theme) : null;
  const tokens = trpc.cms.studioTokens.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const shown = useMemo(() => renderTokens(blocks, (tokens.data ?? {}) as SiteTokens), [blocks, tokens.data]);
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const scale = width / DESKTOP;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sin contenido visible (solo el margen inferior de la página): la miniatura esquemática
  const empty = height !== null && height < 60;
  const shownHeight = height === null ? Math.round(width * 0.6) : Math.min(Math.round(height * scale), maxHeight);
  return (
    <div className="relative">
      {empty && <BlockThumb blocks={blocks} width={width} ratio={16 / 10} />}
      <div
        aria-hidden
        className="pointer-events-none relative select-none overflow-hidden rounded-md border border-border"
        style={empty ? { position: "absolute", visibility: "hidden", width, height: 0 } : { width, height: shownHeight }}
      >
        <div
          ref={inner}
          inert
          className="force-light bg-background text-foreground"
          style={{ ...(brand ?? {}), width: DESKTOP, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <PageBlocksView blocks={shown} preview />
        </div>
        {height !== null && height * scale > maxHeight && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />}
      </div>
    </div>
  );
}
