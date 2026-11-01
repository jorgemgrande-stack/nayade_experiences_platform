/**
 * Piezas del marketplace: carrusel de diapositivas del canal comercial, cabecera neutra de reserva y accesos a las
 * líneas (Elephant Connect, Elephant Net, Paquetes y Mis módulos).
 *
 * Carrusel accesible: región con `aria-roledescription="carrusel"`, botones con etiqueta, flechas del teclado,
 * indicadores, botón de pausa, rotación automática que se detiene al pasar el ratón, al enfocar o al tocar, y que no
 * existe con «reducir movimiento». Ningún texto comercial vive aquí: títulos, imágenes y llamadas salen del canal.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, Layers, Package, PackagePlus, Pause, Play, Plug, SquareCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResolvedCta, ResolvedSlide, SlideNav } from "@shared/connectShowcase";
import { focalStyle } from "./ConnectParts";
import { fichaPath } from "./LockedFeature";
import { trackConnect } from "./useConnectTracking";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Botón o enlace de una llamada del carrusel: solo navega (la compra la decide la ficha). */
function SlideCtaButton({ cta, slideId, primary, onNav }: { cta: ResolvedCta; slideId: string; primary: boolean; onNav: (nav: SlideNav) => void }) {
  const click = () => trackConnect("slide_click", { slideId, ...(cta.nav.kind === "product" ? { productKey: cta.nav.productKey } : {}) });
  const variant = primary ? "default" : "outline";
  const cls = cn("h-11 rounded-xl px-5 text-base", !primary && "bg-background/40 backdrop-blur");
  if (cta.nav.kind === "product") {
    return (
      <Button asChild variant={variant} className={cls}>
        <Link href={fichaPath(cta.nav.productKey)} onClick={click}>
          {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  if (cta.nav.kind === "url") {
    return (
      <Button asChild variant={variant} className={cls}>
        <a href={cta.nav.url} target="_blank" rel="noopener noreferrer" onClick={click}>
          {cta.label} <ExternalLink className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </Button>
    );
  }
  const nav = cta.nav;
  return (
    <Button
      type="button"
      variant={variant}
      className={cls}
      onClick={() => {
        click();
        onNav(nav);
      }}
    >
      {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function SlideView({ slide, active, index, total, eager, onNav }: { slide: ResolvedSlide; active: boolean; index: number; total: number; eager: boolean; onNav: (nav: SlideNav) => void }) {
  const bg = slide.background;
  const overlay = slide.overlay ?? 0.55;
  return (
    <div
      role="group"
      aria-roledescription="diapositiva"
      aria-label={`${index + 1} de ${total}: ${slide.title}`}
      aria-hidden={!active}
      inert={!active ? true : undefined}
      className={cn("absolute inset-0 transition-opacity duration-700", active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0")}
    >
      {bg ? (
        <picture>
          {bg.mobileSrc && <source media="(max-width: 767px)" srcSet={bg.mobileSrc} />}
          <img
            src={bg.src}
            srcSet={bg.srcset ?? undefined}
            sizes={bg.srcset ? "(min-width: 1024px) 70vw, 100vw" : undefined}
            width={bg.width ?? undefined}
            height={bg.height ?? undefined}
            alt={bg.alt}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            style={bg.position ? { objectPosition: bg.position } : focalStyle(bg)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>
      ) : (
        <div aria-hidden="true" className="cx-placeholder absolute inset-0">
          <div className="cx-placeholder-grid absolute inset-0" />
        </div>
      )}
      {/* Oscurecido para que el texto se lea siempre (más intenso a la izquierda, donde va el texto) */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: `linear-gradient(90deg, rgba(10,6,8,${Math.min(0.92, overlay + 0.3)}) 0%, rgba(10,6,8,${overlay}) 45%, rgba(10,6,8,${overlay * 0.35}) 100%)` }} />
      <div className="relative z-10 grid h-full items-center gap-6 px-6 py-8 sm:px-14 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:px-16">
        <div className="max-w-xl space-y-3">
          {slide.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Etiquetas">
              {slide.tags.map((t) => (
                <li key={t} className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {t}
                </li>
              ))}
            </ul>
          )}
          <h2 className="break-words text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">{slide.title}</h2>
          {slide.subtitle && <p className="text-lg font-semibold text-foreground sm:text-xl">{slide.subtitle}</p>}
          {slide.description && <p className="max-w-lg text-sm text-foreground/85 sm:text-base">{slide.description}</p>}
          {(slide.primaryCta || slide.secondaryCta) && (
            <div className="flex flex-wrap gap-2 pt-2">
              {slide.primaryCta && <SlideCtaButton cta={slide.primaryCta} slideId={slide.id} primary onNav={onNav} />}
              {slide.secondaryCta && <SlideCtaButton cta={slide.secondaryCta} slideId={slide.id} primary={false} onNav={onNav} />}
            </div>
          )}
        </div>
        {slide.visual && (
          <div className="hidden h-full max-h-72 items-center justify-center md:flex">
            <img
              src={slide.visual.src}
              srcSet={slide.visual.srcset ?? undefined}
              sizes={slide.visual.srcset ? "35vw" : undefined}
              width={slide.visual.width ?? undefined}
              height={slide.visual.height ?? undefined}
              alt={slide.visual.alt}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              className="max-h-72 w-auto max-w-full object-contain drop-shadow-2xl"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Carrusel de diapositivas del canal comercial. */
export function ShowcaseCarousel({ slides, autoplayMs, onNav }: { slides: ResolvedSlide[]; autoplayMs: number; onNav: (nav: SlideNav) => void }) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const total = slides.length;
  const autoplay = total > 1 && autoplayMs > 0 && !reduced;
  const playing = autoplay && !stopped && !hover && !focus && visible;
  const go = useCallback((i: number) => setIndex(((i % total) + total) % total), [total]);

  useEffect(() => {
    if (index >= total) setIndex(0);
  }, [index, total]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => go(index + 1), autoplayMs);
    return () => clearTimeout(t);
  }, [playing, index, autoplayMs, go]);
  const current = slides[Math.min(index, total - 1)];
  useEffect(() => {
    if (visible && current) trackConnect("slide_view", { slideId: current.id });
  }, [visible, current]);

  if (total === 0 || !current) return null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    }
  };
  return (
    <section
      ref={ref}
      aria-roledescription="carrusel"
      aria-label="Destacados del marketplace"
      className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-2xl shadow-black/40"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onTouchStart={() => setStopped(true)}
      onKeyDown={onKey}
    >
      <div className="relative h-[26rem] sm:h-[22rem] lg:h-[20rem]" aria-live={playing ? "off" : "polite"}>
        {slides.map((s, i) => (
          <SlideView key={s.id} slide={s} active={i === index} index={i} total={total} eager={i === 0} onNav={onNav} />
        ))}
      </div>
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Diapositiva anterior"
            className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/70 text-foreground backdrop-blur hover:bg-background sm:inline-flex"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Diapositiva siguiente"
            className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/70 text-foreground backdrop-blur hover:bg-background sm:inline-flex"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/70 px-2 py-1 backdrop-blur">
            {/* En móvil, anterior y siguiente van junto a los indicadores (tamaño táctil) */}
            <button type="button" onClick={() => go(index - 1)} aria-label="Diapositiva anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground sm:hidden">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Ir a la diapositiva ${i + 1}: ${s.title}`}
                aria-current={i === index ? "true" : undefined}
                className="inline-flex h-8 w-6 items-center justify-center rounded-full"
              >
                <span aria-hidden="true" className={cn("block h-2 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-2 bg-foreground/50")} />
              </button>
            ))}
            <button type="button" onClick={() => go(index + 1)} aria-label="Diapositiva siguiente" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground sm:hidden">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            {autoplay && (
              <button
                type="button"
                onClick={() => setStopped((v) => !v)}
                aria-label={stopped ? "Reanudar el pase automático" : "Detener el pase automático"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground"
              >
                {stopped ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Cabecera de reserva cuando el canal no publica diapositivas: solo el título y la descripción de la página, sin
 * ningún texto comercial.
 */
export function NeutralHero({ title, description }: { title: string; description: string }) {
  return (
    <header className="cx-glow relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-8 sm:px-10">
      <div aria-hidden="true" className="cx-placeholder-grid absolute inset-0" />
      <div className="relative flex items-center gap-4">
        <span aria-hidden="true" className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-black/40">
          <PackagePlus className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>
        </div>
      </div>
    </header>
  );
}

export type AccessId = "connect" | "net" | "bundles" | "mine";

const ACCESS_ICONS: Record<AccessId, ReactNode> = {
  connect: <Plug className="h-6 w-6" />,
  net: <Layers className="h-6 w-6" />,
  bundles: <Package className="h-6 w-6" />,
  mine: <SquareCheckBig className="h-6 w-6" />,
};

/** Accesos a las líneas del marketplace (navegación, sin textos comerciales: nombre y número de productos). */
export function AccessTiles({ tiles, active, onSelect }: { tiles: Array<{ id: AccessId; title: string; count: number }>; active: AccessId | null; onSelect: (id: AccessId) => void }) {
  return (
    <nav aria-label="Líneas del marketplace">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const on = active === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(t.id)}
                className={cn(
                  "flex h-full w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                  on ? "cx-tile-active shadow-lg shadow-black/40" : "border-border bg-card text-foreground hover:border-primary/60 hover:bg-muted",
                )}
              >
                <span aria-hidden="true" className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", on ? "bg-background/20" : "bg-muted cx-red-text")}>
                  {ACCESS_ICONS[t.id]}
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-semibold leading-tight">{t.title}</span>
                  <span className={cn("block text-sm", on ? "text-primary-foreground/90" : "text-muted-foreground")}>{t.count === 1 ? "1 producto" : `${t.count} productos`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
