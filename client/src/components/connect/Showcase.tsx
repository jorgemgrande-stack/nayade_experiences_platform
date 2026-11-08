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
import { ACCESS_TONES, type MarketTone } from "@shared/marketplaceVisual";
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
  const cls = cn("h-12 rounded-full px-6 text-base font-semibold", primary ? "cx-cta border-0 shadow-lg shadow-black/30" : "border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white");
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

/** Tonos de respaldo de las diapositivas sin fondo publicado (cada una distinta). */
const SLIDE_TONES: MarketTone[] = ["electric", "violet", "turquoise", "magenta", "emerald", "amber"];

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
        <div aria-hidden="true" data-tone={SLIDE_TONES[index % SLIDE_TONES.length]} className="cx-tone-fallback absolute inset-0" />
      )}
      {/* Oscurecido azul noche para que el texto se lea siempre: lateral en escritorio (texto a la izquierda, sujeto a la
          derecha) y desde abajo en móvil (el texto va abajo) */}
      <div aria-hidden="true" className="absolute inset-0 hidden md:block" style={{ background: `linear-gradient(90deg, rgba(5,9,26,${Math.min(0.94, overlay + 0.32)}) 0%, rgba(5,9,26,${Math.min(0.85, overlay + 0.12)}) 34%, rgba(5,9,26,${overlay * 0.4}) 62%, rgba(5,9,26,0) 100%)` }} />
      <div aria-hidden="true" className="absolute inset-0 md:hidden" style={{ background: `linear-gradient(0deg, rgba(5,9,26,0.96) 0%, rgba(5,9,26,${Math.min(0.88, overlay + 0.25)}) 48%, rgba(5,9,26,${overlay * 0.3}) 100%)` }} />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[rgba(5,9,26,0.6)] to-transparent" />
      <div className="relative z-10 grid h-full items-end gap-6 px-5 pb-20 pt-8 sm:px-14 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:px-20 md:pb-14 lg:px-24">
        <div className="max-w-xl space-y-3 text-white">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full cx-brand-dot" />
            Big Elephant
          </p>
          {slide.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Etiquetas">
              {slide.tags.map((t) => (
                <li key={t} className="rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur">
                  {t}
                </li>
              ))}
            </ul>
          )}
          <h2 className="break-words text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl xl:text-6xl">{slide.title}</h2>
          {slide.subtitle && <p className="text-lg font-semibold text-white sm:text-2xl">{slide.subtitle}</p>}
          {slide.description && <p className="line-clamp-3 max-w-lg text-sm text-white/85 sm:text-base">{slide.description}</p>}
          {(slide.primaryCta || slide.secondaryCta) && (
            <div className="flex flex-wrap gap-2 pt-3">
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
      className="cx-on-image relative overflow-hidden rounded-3xl border border-white/10 cx-night-bg shadow-2xl shadow-[rgba(20,30,90,0.25)] dark:shadow-black/50"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onTouchStart={() => setStopped(true)}
      onKeyDown={onKey}
    >
      <div className="relative h-[30rem] sm:h-[24rem] lg:h-[26rem] 2xl:h-[28rem]" aria-live={playing ? "off" : "polite"}>
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
            className="cx-rail-arrow absolute left-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full sm:inline-flex"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Diapositiva siguiente"
            className="cx-rail-arrow absolute right-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full sm:inline-flex"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-[rgba(6,10,26,0.6)] px-2 py-1 text-white backdrop-blur md:left-20 md:translate-x-0 lg:left-24">
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
                <span aria-hidden="true" className={cn("block h-1.5 rounded-full transition-all", i === index ? "w-6 cx-dot-on" : "w-2 cx-dot-off")} />
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
    <header data-tone="electric" className="cx-on-image cx-tone-fallback relative overflow-hidden rounded-3xl border border-white/10 px-6 py-10 sm:px-12 sm:py-14">
      <div className="relative flex items-center gap-4">
        <span aria-hidden="true" className="cx-cta inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/40">
          <PackagePlus className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-extrabold tracking-tight text-white sm:text-4xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/85 sm:text-base">{description}</p>
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
                  "cx-access flex h-full min-h-[5rem] w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left shadow-lg shadow-black/15 transition-[transform,filter] hover:brightness-110 motion-safe:hover:-translate-y-0.5 sm:min-h-[5.5rem] sm:gap-4 sm:px-5 sm:py-4",
                  `cx-access-${ACCESS_TONES[t.id].join("-")}`,
                )}
              >
                <span aria-hidden="true" className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 [&_svg]:h-5 [&_svg]:w-5 sm:h-12 sm:w-12 sm:[&_svg]:h-6 sm:[&_svg]:w-6">
                  {ACCESS_ICONS[t.id]}
                </span>
                <span className="relative min-w-0">
                  <span className="block break-words text-sm font-bold leading-tight sm:text-lg">{t.title}</span>
                  <span className="block text-sm text-white/85">{t.count === 1 ? "1 producto" : `${t.count} productos`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
