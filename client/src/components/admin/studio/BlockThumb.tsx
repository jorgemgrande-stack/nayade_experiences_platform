/**
 * Elephant Studio: miniatura esquemática de uno o varios bloques para la biblioteca (módulos, secciones prediseñadas,
 * plantillas y «Mis bloques»). No pinta la web real: dibuja su estructura (columnas, número de elementos, fondo,
 * botones) con colores fijos, para que se lea igual con el editor en modo claro u oscuro.
 */
import type { CSSProperties, ReactNode } from "react";
import { DEFAULT_BLOCK_STYLE, sectionColumnCount, type BlockStyle, type PageBlock } from "@shared/pageBlocks";
import { cn } from "@/lib/utils";

const C = {
  page: "#ffffff",
  line: "#cbd5e1",
  soft: "#f1f5f9",
  card: "#ffffff",
  border: "#e2e8f0",
  media: "#dbe3ee",
  accent: "#5b5bf6",
  dark: "#1e293b",
};

/** Peso de cada módulo en la altura de la miniatura de una página */
const WEIGHT: Partial<Record<PageBlock["type"], number>> = { hero: 3, slideshow: 3, separator: 0.4, button: 0.8, heading: 1.4, logos: 1, stats: 1.4 };

function Bar({ w, h = 3, color = C.line, className }: { w: string; h?: number; color?: string; className?: string }) {
  return <i className={cn("block shrink-0 rounded-full", className)} style={{ width: w, height: h, background: color }} />;
}

function Box({ className, style, children }: { className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <span className={cn("block rounded-[3px]", className)} style={{ background: C.card, border: `1px solid ${C.border}`, ...style }}>
      {children}
    </span>
  );
}

const Media = ({ className }: { className?: string }) => <span className={cn("block rounded-[2px]", className)} style={{ background: C.media }} />;
const Pill = ({ light }: { light?: boolean }) => <Bar w="22%" h={5} color={light ? "#ffffff" : C.accent} className="mt-1 max-w-8" />;

function times<T>(n: number, f: (i: number) => T): T[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => f(i));
}

/** Fondo de la banda según el diseño del bloque */
function bandStyle(s: BlockStyle | undefined): { style: CSSProperties; light: boolean } {
  switch (s?.background) {
    case "soft":
      return { style: { background: C.soft }, light: false };
    case "brand":
      return { style: { background: C.accent }, light: true };
    case "dark":
      return { style: { background: C.dark }, light: true };
    case "gradient":
      return { style: { background: `linear-gradient(135deg, ${C.accent}, #a855f7)` }, light: true };
    case "image":
      return { style: { background: "linear-gradient(135deg, #64748b, #334155)" }, light: true };
    default:
      return { style: {}, light: false };
  }
}

function count(b: PageBlock): number {
  const d = b.data as Record<string, unknown>;
  const list = d.items ?? d.plans ?? d.images ?? d.slides;
  return Array.isArray(list) ? list.length : 0;
}

function Grid({ n, max = 4, children }: { n: number; max?: number; children: (i: number) => ReactNode }) {
  const cols = Math.min(Math.max(n, 1), max);
  return (
    <span className="grid w-full gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {times(Math.min(Math.max(n, 1), max), children)}
    </span>
  );
}

function Content({ b, light }: { b: PageBlock; light: boolean }) {
  const text = light ? "rgba(255,255,255,.85)" : C.line;
  const title = light ? "#ffffff" : "#94a3b8";
  switch (b.type) {
    case "hero":
    case "slideshow":
      return (
        <span className="flex flex-col justify-center gap-[3px] px-[6%]">
          <Bar w="55%" h={5} color="#ffffff" />
          <Bar w="40%" color="rgba(255,255,255,.7)" />
          <Pill />
          {b.type === "slideshow" && (
            <span className="mt-1 flex justify-center gap-[3px]">
              <Bar w="8px" h={3} color="#ffffff" />
              <Bar w="3px" h={3} color="rgba(255,255,255,.5)" />
            </span>
          )}
        </span>
      );
    case "heading":
      return (
        <span className="flex flex-col items-center gap-[3px]">
          <Bar w="20%" h={2} color={C.accent} />
          <Bar w="55%" h={5} color={title} />
          <Bar w="40%" color={text} />
        </span>
      );
    case "text":
      return (
        <span className="flex flex-col gap-[3px]">
          <Bar w="40%" h={4} color={title} />
          <Bar w="95%" color={text} />
          <Bar w="88%" color={text} />
          <Bar w="70%" color={text} />
        </span>
      );
    case "image":
    case "video":
      return (
        <span className="relative mx-auto flex aspect-[16/7] w-[80%] items-center justify-center rounded-[2px]" style={{ background: b.type === "video" ? C.dark : C.media }}>
          {b.type === "video" && <span className="h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-white" />}
        </span>
      );
    case "gallery":
    case "carousel":
      return (
        <span className="flex flex-col gap-[3px]">
          <Grid n={b.type === "carousel" ? 3 : Math.min(count(b) || 6, 6)} max={3}>
            {(i) => <Media key={i} className="aspect-[4/3]" />}
          </Grid>
        </span>
      );
    case "button":
      return (
        <span className="flex justify-center">
          <Bar w="28%" h={6} color={light ? "#ffffff" : C.accent} />
        </span>
      );
    case "separator":
      return <Bar w="100%" h={1} color={C.border} />;
    case "columns":
      return (
        <span className="grid grid-cols-2 items-center gap-[6px]">
          <span className="flex flex-col gap-[3px]">
            <Bar w="70%" h={4} color={title} />
            <Bar w="95%" color={text} />
            <Bar w="80%" color={text} />
            <Pill light={light} />
          </span>
          <Media className="aspect-[4/3]" />
        </span>
      );
    case "contact_form":
    case "form":
      return (
        <span className="mx-auto flex w-[70%] flex-col gap-[3px]">
          <Bar w="45%" h={4} color={title} />
          {times(3, (i) => (
            <Box key={i} className="h-[6px]" />
          ))}
          <Pill light={light} />
        </span>
      );
    case "cta":
      return (
        <span className="flex flex-col items-center gap-[3px]">
          <Bar w="50%" h={5} color={title} />
          <Bar w="35%" color={text} />
          <Pill light={light} />
        </span>
      );
    case "features":
    case "testimonials":
    case "cards":
    case "products":
    case "blog_posts":
      return (
        <span className="flex flex-col items-center gap-[4px]">
          <Bar w="35%" h={4} color={title} />
          <Grid n={count(b) || 3} max={b.type === "testimonials" || b.type === "blog_posts" ? 3 : 4}>
            {(i) => (
              <Box key={i} className="flex flex-col gap-[2px] p-[3px]">
                {b.type === "features" && <span className="block h-[5px] w-[5px] rounded-[1px]" style={{ background: C.accent, opacity: 0.6 }} />}
                {(b.type === "cards" || b.type === "products") && <Media className="aspect-[4/3] w-full" />}
                {b.type === "blog_posts" && <Media className="aspect-[16/9] w-full" />}
                {b.type === "blog_posts" && <Bar w="30%" h={2} color={C.accent} />}
                {b.type === "testimonials" && <Bar w="20%" h={3} color={C.accent} />}
                <Bar w="80%" h={2} />
                <Bar w="60%" h={2} />
              </Box>
            )}
          </Grid>
        </span>
      );
    case "pricing":
      return (
        <span className="flex flex-col items-center gap-[4px]">
          <Bar w="35%" h={4} color={title} />
          <Grid n={count(b) || 3} max={4}>
            {(i) => (
              <Box key={i} className="flex flex-col gap-[2px] p-[3px]" style={i === 1 ? { borderColor: C.accent } : undefined}>
                <Bar w="50%" h={2} />
                <Bar w="40%" h={4} color="#94a3b8" />
                <Bar w="70%" h={2} />
                <Bar w="100%" h={4} color={i === 1 ? C.accent : C.border} />
              </Box>
            )}
          </Grid>
        </span>
      );
    case "stats":
      return (
        <Grid n={count(b) || 3} max={4}>
          {(i) => (
            <Box key={i} className="flex flex-col items-center gap-[2px] py-[3px]">
              <Bar w="40%" h={5} color={C.accent} />
              <Bar w="60%" h={2} />
            </Box>
          )}
        </Grid>
      );
    case "logos":
      return (
        <span className="flex justify-center gap-[4px]">
          {times(5, (i) => (
            <Bar key={i} w="12%" h={5} color={C.media} />
          ))}
        </span>
      );
    case "faq":
      return (
        <span className="mx-auto flex w-[75%] flex-col gap-[3px]">
          <Bar w="40%" h={4} color={title} />
          {times(Math.min(count(b) || 3, 4), (i) => (
            <Box key={i} className="flex items-center justify-between px-[3px] py-[2px]">
              <Bar w="60%" h={2} />
              <Bar w="4px" h={2} color="#94a3b8" />
            </Box>
          ))}
        </span>
      );
    case "section": {
      const n = sectionColumnCount(b.data.layout);
      const weights = b.data.layout.split("-").map(Number);
      return (
        <span className="grid gap-[4px]" style={{ gridTemplateColumns: weights.map((w) => `${w}fr`).join(" ") }}>
          {times(n, (i) => {
            const inner = b.data.columns[i]?.blocks ?? [];
            return inner.length ? (
              <span key={i} className="flex flex-col gap-[4px] overflow-hidden">
                {inner.slice(0, 3).map((ib) => (
                  <Content key={ib.id} b={ib} light={light} />
                ))}
              </span>
            ) : (
              <span key={i} className="block h-[18px] rounded-[2px] border border-dashed" style={{ borderColor: light ? "rgba(255,255,255,.5)" : C.line }} />
            );
          })}
        </span>
      );
    }
    case "modal":
      return (
        <span className="mx-auto flex w-[70%] flex-col gap-[3px] rounded-[3px] border px-[4px] py-[4px] shadow-sm" style={{ borderColor: light ? "rgba(255,255,255,.6)" : C.line }}>
          <Bar w="50%" h={4} color={title} />
          <Bar w="90%" h={2} />
          <Bar w="70%" h={2} />
        </span>
      );
    default:
      return <Bar w="60%" />;
  }
}

/** Ancho en el que se dibuja la miniatura; luego se escala al tamaño pedido */
const BASE = 160;

/**
 * Miniatura de una lista de bloques (una página o un solo módulo), de `width` píxeles y proporción `ratio`
 * (ancho / alto). Las bandas se reparten la altura según el tipo de módulo.
 */
export function BlockThumb({ blocks, width, ratio, className }: { blocks: PageBlock[]; width: number; ratio: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 flex-col overflow-hidden rounded-md", className)}
      style={{ background: C.page, border: `1px solid ${C.border}`, width: BASE, height: Math.round(BASE / ratio), zoom: width / BASE }}
    >
      {blocks.slice(0, 8).map((b) => {
        // Cabecera y diapositivas: sobre imagen (oscuro) si no tienen otro fondo
        const band = (b.type === "hero" || b.type === "slideshow") && (!b.style || b.style.background === "none") ? bandStyle({ ...DEFAULT_BLOCK_STYLE, background: "dark" }) : bandStyle(b.style);
        return (
          <span
            key={b.id}
            className="flex min-h-0 flex-col justify-center overflow-hidden px-[6px] py-[4px]"
            style={{ ...band.style, flex: `${WEIGHT[b.type] ?? 1.8} 1 0` }}
          >
            <Content b={b} light={band.light} />
          </span>
        );
      })}
    </span>
  );
}
