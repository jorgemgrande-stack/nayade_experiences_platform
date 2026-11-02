/**
 * Pinta los bloques de una página de la web de la empresa. Es el MISMO componente en la web pública, en la vista
 * previa del panel (con `preview`, los enlaces no navegan y el formulario no envía nada) y en el lienzo de Elephant
 * Studio (con `StudioEditContext`: selección, edición de textos sobre la página, arrastrar y soltar).
 *
 * El texto con formato llega ya saneado del servidor (lista blanca, server/_core/pageBlocks.ts). Sin contexto de
 * edición, un bloque sin diseño propio se pinta exactamente igual que antes de Elephant Studio.
 */
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, Copy, EyeOff, GripVertical, Play, Quote, ShoppingBag, Star, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { RICH_TEXT_CLASS } from "@/components/site/richText";
import { FEATURE_ICON_COMPONENTS } from "@/components/site/featureIcons";
import { Carousel, prefersReducedMotion } from "@/components/site/Carousel";
import { Slideshow } from "@/components/site/Slideshow";
import { Lightbox } from "@/components/site/Lightbox";
import { blockLabel, DEFAULT_BLOCK_STYLE, type BlockOf, type BlockStyle, type Device, type GalleryImage, type PageBlock } from "@shared/pageBlocks";
import { formatEuros, productPath } from "@shared/storefront";
import { isPurchasable } from "@shared/shopOrders";

// ─── Contexto de edición (lienzo de Elephant Studio) ──────────────────────────

export type StudioBlockAction = "duplicate" | "delete" | "up" | "down";

export interface StudioEdit {
  selectedId: string | null;
  device: Device;
  readOnly: boolean;
  /** Bloques tal y como se guardan (con los marcadores {{…}} sin sustituir), para editarlos sobre la página */
  raw: Map<string, PageBlock>;
  onSelect: (id: string | null) => void;
  onText: (id: string, key: string, value: string) => void;
  onAction: (id: string, action: StudioBlockAction) => void;
  onDrop: (payload: string, index: number) => void;
  /** Si lo que se arrastra es de Elephant Studio (según los tipos del arrastre) */
  dragTypes: (types: readonly string[]) => boolean;
  /** Lo que se suelta (módulo, sección o bloque), o vacío */
  readDrop: (dt: DataTransfer) => string;
}

export const StudioEditContext = createContext<StudioEdit | null>(null);
const BlockCtx = createContext<PageBlock | null>(null);

/** Color de la interfaz del editor sobre la página (independiente de los colores de la empresa). */
const STUDIO_ACCENT = "#5b5bf6";

const isExternal = (u: string) => /^(https?:|mailto:|tel:)/i.test(u);

function SmartLink({ href, preview, className, children }: { href: string; preview?: boolean; className?: string; children: ReactNode }) {
  if (preview) {
    return (
      <a href={href} className={className} onClick={(e) => e.preventDefault()}>
        {children}
      </a>
    );
  }
  if (isExternal(href)) {
    const web = /^https?:/i.test(href);
    return (
      <a href={href} className={className} target={web ? "_blank" : undefined} rel={web ? "noopener noreferrer" : undefined}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function headingClass(first: boolean) {
  return first ? "font-heading text-3xl md:text-4xl font-bold leading-tight text-primary" : "font-heading text-2xl md:text-3xl font-bold text-foreground";
}

// ─── Textos editables sobre la página ─────────────────────────────────────────

type TagName = "h1" | "h2" | "h3" | "p" | "span" | "div" | "figcaption";

/**
 * Un texto del bloque. En la web es un elemento normal; en el lienzo, cuando su bloque está seleccionado, se edita
 * directamente (texto simple, sin formato). Si el texto lleva datos de la empresa ({{telefono}}…), al editarlo se ven
 * los marcadores y, al salir, otra vez los datos.
 */
function Txt({ k, value, as: Tag = "span", className, multiline, placeholder }: { k: string; value: string; as?: TagName; className?: string; multiline?: boolean; placeholder?: string }) {
  const ed = useContext(StudioEditContext);
  const block = useContext(BlockCtx);
  if (!ed || !block) return value ? <Tag className={className}>{value}</Tag> : null;
  return <EditableText ed={ed} block={block} k={k} value={value} as={Tag} className={className} multiline={multiline} placeholder={placeholder} />;
}

const rawField = (ed: StudioEdit, block: PageBlock, k: string, fallback: string) => {
  const v = (ed.raw.get(block.id)?.data as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v : fallback;
};

function EditableText({ ed, block, k, value, as: Tag, className, multiline, placeholder }: { ed: StudioEdit; block: PageBlock; k: string; value: string; as: TagName; className?: string; multiline?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const editable = ed.selectedId === block.id && !ed.readOnly;
  const raw = rawField(ed, block, k, value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.ownerDocument.activeElement !== el && el.textContent !== value) el.textContent = value;
    // `Tag` también: al cambiar de nivel (h2 → h3, o al dejar de ser el primer título) el elemento es otro y llega vacío
  }, [value, editable, Tag]);
  if (!value && !editable) return null;
  const El = Tag as "div";
  return (
    <El
      ref={(el: HTMLElement | null) => {
        ref.current = el;
        if (el && el.ownerDocument.activeElement !== el && el.textContent !== value) el.textContent = value;
      }}
      className={cn(className, editable && "studio-editable")}
      contentEditable={editable || undefined}
      suppressContentEditableWarning
      spellCheck={editable}
      data-placeholder={placeholder || "Escribe aquí"}
      onFocus={(e) => {
        if (raw !== value) e.currentTarget.textContent = raw;
      }}
      onBlur={(e) => {
        const typed = (e.currentTarget.innerText ?? "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
        const next = multiline ? typed : typed.replace(/\s*\n\s*/g, " ");
        if (next !== raw) ed.onText(block.id, k, next);
        else e.currentTarget.textContent = value;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !multiline)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}

/** Texto con formato (HTML saneado). En el lienzo se edita sobre la página, con negrita y cursiva del teclado. */
function Rich({ html, className, k = "html" }: { html: string; className?: string; k?: string }) {
  const ed = useContext(StudioEditContext);
  const block = useContext(BlockCtx);
  const cls = cn(RICH_TEXT_CLASS, "[&>*:first-child]:mt-0", className);
  if (!ed || !block) {
    if (!html) return null;
    // HTML saneado en servidor con lista blanca
    return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <EditableRich ed={ed} block={block} k={k} html={html} className={cls} />;
}

function EditableRich({ ed, block, k, html, className }: { ed: StudioEdit; block: PageBlock; k: string; html: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const editable = ed.selectedId === block.id && !ed.readOnly;
  const raw = rawField(ed, block, k, html);
  useLayoutEffect(() => {
    const el = ref.current;
    // El HTML del documento llega saneado del servidor; lo que se escribe aquí se sanea al guardar el borrador
    if (el && el.ownerDocument.activeElement !== el && el.innerHTML !== html) el.innerHTML = html;
  }, [html, editable]);
  if (!html && !editable) return null;
  return (
    <div
      ref={ref}
      className={cn(className, editable && "studio-editable min-h-[1.5em]")}
      contentEditable={editable || undefined}
      suppressContentEditableWarning
      data-placeholder="Escribe aquí el texto"
      onFocus={(e) => {
        if (raw !== html) e.currentTarget.innerHTML = raw;
      }}
      onBlur={(e) => {
        const next = e.currentTarget.innerHTML;
        if (next !== raw) ed.onText(block.id, k, next);
        else e.currentTarget.innerHTML = html;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}

/** Si se muestra un botón: con texto y destino en la web; en el lienzo, también vacío mientras su bloque está seleccionado. */
function useShowButton(label: string, url: string, blockId: string) {
  const ed = useContext(StudioEditContext);
  return ed ? !!label || ed.selectedId === blockId : !!label && !!url;
}

// ─── Bloques ──────────────────────────────────────────────────────────────────

function HeroBlock({ b, first, preview }: { b: BlockOf<"hero">; first: boolean; preview?: boolean }) {
  const d = b.data;
  const showButton = useShowButton(d.buttonLabel, d.buttonUrl, b.id);
  return (
    <section className={cn("relative overflow-hidden", d.imageUrl ? "min-h-[360px] md:min-h-[460px]" : "bg-primary")}>
      {d.imageUrl && <img src={d.imageUrl} alt={d.imageAlt} className="absolute inset-0 h-full w-full object-cover" />}
      {d.imageUrl && <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/40 to-black/60" />}
      <div className={cn("relative container flex flex-col justify-center gap-4 py-16 md:py-24 text-white", d.imageUrl ? "min-h-[360px] md:min-h-[460px]" : "text-primary-foreground")}>
        <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className="max-w-3xl break-words font-heading text-3xl md:text-5xl font-bold leading-tight" placeholder="Tu titular" />
        <Txt k="subtitle" value={d.subtitle} as="p" multiline className="max-w-2xl text-lg md:text-xl opacity-90" placeholder="Subtítulo" />
        {showButton && (
          <div>
            <Button asChild size="lg" className={d.imageUrl ? undefined : "bg-white text-primary hover:bg-white/90"}>
              <SmartLink href={d.buttonUrl || "#"} preview={preview}>
                <Txt k="buttonLabel" value={d.buttonLabel} placeholder="Texto del botón" />
              </SmartLink>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function TextBlock({ b, first }: { b: BlockOf<"text">; first: boolean }) {
  const center = b.data.align === "center";
  return (
    <section className="container py-8 md:py-10">
      <div className={cn("max-w-3xl", center && "mx-auto text-center")}>
        <Txt k="title" value={b.data.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-4")} placeholder="Título de la sección (opcional)" />
        <Rich html={b.data.html} className={center ? "[&_ul]:inline-block [&_ul]:text-left [&_ol]:inline-block [&_ol]:text-left" : undefined} />
      </div>
    </section>
  );
}

/** Hueco de una imagen o vídeo que falta: solo en el lienzo (en la web no se muestra nada). */
function EmptyMedia({ children }: { children: ReactNode }) {
  return (
    <div className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/50 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ImageBlock({ b }: { b: BlockOf<"image"> }) {
  const ed = useContext(StudioEditContext);
  const [broken, setBroken] = useState<string | null>(null);
  if (!b.data.url && !ed) return null;
  const showBroken = !!ed && broken === b.data.url;
  return (
    <section className="container py-6">
      <figure className={cn("mx-auto", b.data.size === "wide" ? "max-w-6xl" : "max-w-3xl")}>
        {!b.data.url ? (
          <EmptyMedia>Elige la imagen en el panel de la derecha</EmptyMedia>
        ) : showBroken ? (
          <EmptyMedia>No se puede mostrar la imagen elegida. Elige otra en el panel de la derecha.</EmptyMedia>
        ) : (
          <img src={b.data.url} alt={b.data.alt} className="h-auto w-full rounded-2xl object-cover" loading="lazy" onError={() => setBroken(b.data.url)} />
        )}
        <Txt k="caption" value={b.data.caption} as="figcaption" className="mt-2 block text-center text-sm text-muted-foreground" placeholder="Pie de foto (opcional)" />
      </figure>
    </section>
  );
}

/** Imagen de galería: si se puede ampliar, es un botón que abre el visor (en el editor solo se selecciona). */
function GalleryThumb({ g, className, onOpen }: { g: GalleryImage; className: string; onOpen?: () => void }) {
  const img = <img src={g.url} alt={g.alt} className={className} loading="lazy" decoding="async" />;
  if (!onOpen) return img;
  return (
    <button type="button" onClick={onOpen} className="group block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={g.alt ? `Ampliar: ${g.alt}` : "Ampliar imagen"}>
      {img}
    </button>
  );
}

function GalleryBlock({ b, first }: { b: BlockOf<"gallery">; first: boolean }) {
  const ed = useContext(StudioEditContext);
  const [open, setOpen] = useState<number | null>(null);
  const { images, layout } = b.data;
  if (!images.length && !ed) return null;
  const zoom = b.data.lightbox === "on" && !ed;
  const thumb = (g: GalleryImage, i: number, cls: string) => <GalleryThumb key={i} g={g} className={cls} onOpen={zoom ? () => setOpen(i) : undefined} />;
  return (
    <section className="container py-8 md:py-10">
      <Txt k="title" value={b.data.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-6 block")} placeholder="Título de la galería (opcional)" />
      {!images.length ? (
        <EmptyMedia>Añade las imágenes en el panel de la derecha</EmptyMedia>
      ) : layout === "masonry" ? (
        <div className="columns-2 gap-3 md:columns-3 md:gap-4 [&>*]:mb-3 md:[&>*]:mb-4">
          {images.map((g, i) => (
            <div key={i} className="break-inside-avoid">
              {thumb(g, i, "h-auto w-full rounded-xl object-cover transition duration-300 group-hover:scale-[1.03]")}
            </div>
          ))}
        </div>
      ) : layout === "carousel" ? (
        <Carousel perView={{ mobile: 1, tablet: 2, desktop: 3 }} label={b.data.title || "Galería"}>
          {images.map((g, i) => thumb(g, i, "aspect-[4/3] w-full rounded-xl object-cover transition duration-300 group-hover:scale-[1.03]"))}
        </Carousel>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
          {images.map((g, i) => thumb(g, i, "aspect-square w-full rounded-xl object-cover transition duration-300 group-hover:scale-[1.03]"))}
        </div>
      )}
      {zoom && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Carrusel de imágenes con visor a pantalla completa opcional. */
function CarouselBlock({ b, first }: { b: BlockOf<"carousel">; first: boolean }) {
  const ed = useContext(StudioEditContext);
  const [open, setOpen] = useState<number | null>(null);
  const d = b.data;
  if (!d.images.length && !ed) return null;
  const zoom = d.lightbox === "on" && !ed;
  const per = Number(d.perView) || 3;
  return (
    <section className="container py-8 md:py-12">
      <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-6 block")} placeholder="Título (opcional)" />
      {d.images.length ? (
        <Carousel perView={{ mobile: 1, tablet: Math.min(2, per), desktop: per }} label={d.title || "Carrusel de imágenes"} autoplay={d.autoplay === "on" && !ed}>
          {d.images.map((g, i) => (
            <GalleryThumb key={i} g={g} className="aspect-[4/3] w-full rounded-xl object-cover transition duration-300 group-hover:scale-[1.03]" onOpen={zoom ? () => setOpen(i) : undefined} />
          ))}
        </Carousel>
      ) : (
        <EmptyMedia>Añade las imágenes en el panel de la derecha</EmptyMedia>
      )}
      {zoom && <Lightbox images={d.images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Presentación de diapositivas: el contenido de cada una se pinta aquí (enlaces seguros como en el resto). */
function SlideshowBlock({ b, first, preview }: { b: BlockOf<"slideshow">; first: boolean; preview?: boolean }) {
  const ed = useContext(StudioEditContext);
  const d = b.data;
  if (!d.slides.length) {
    return ed ? <EmptyMedia>Añade diapositivas en el panel de la derecha</EmptyMedia> : null;
  }
  return (
    <Slideshow
      slides={d.slides}
      height={d.height}
      transition={d.transition}
      autoplay={d.autoplay === "on"}
      intervalMs={(Number(d.interval) || 6) * 1000}
      arrows={d.arrows === "on"}
      dots={d.dots === "on"}
      overlay={d.overlay}
      editing={!!ed}
      renderContent={(s, i) => {
        const Title = first && i === 0 ? "h1" : "h2";
        return (
          <>
            {s.eyebrow && <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/85">{s.eyebrow}</p>}
            {s.title && <Title className="break-words font-heading text-3xl font-bold leading-tight md:text-5xl lg:text-6xl">{s.title}</Title>}
            {s.text && <p className="whitespace-pre-line text-lg text-white/90 md:text-xl">{s.text}</p>}
            {((s.buttonLabel && s.buttonUrl) || (s.button2Label && s.button2Url)) && (
              <div className="mt-2 flex flex-wrap gap-3">
                {s.buttonLabel && s.buttonUrl && (
                  <Button asChild size="lg">
                    <SmartLink href={s.buttonUrl} preview={preview}>
                      {s.buttonLabel}
                    </SmartLink>
                  </Button>
                )}
                {s.button2Label && s.button2Url && (
                  <Button asChild size="lg" variant="outline" className="border-white/70 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white">
                    <SmartLink href={s.button2Url} preview={preview}>
                      {s.button2Label}
                    </SmartLink>
                  </Button>
                )}
              </div>
            )}
          </>
        );
      }}
    />
  );
}

const CARD_COLS: Record<string, string> = { "2": "sm:grid-cols-2", "3": "sm:grid-cols-2 lg:grid-cols-3", "4": "sm:grid-cols-2 lg:grid-cols-4" };

function CardsBlock({ b, first, preview }: { b: BlockOf<"cards">; first: boolean; preview?: boolean }) {
  const ed = useContext(StudioEditContext);
  const d = b.data;
  const cards = d.items.map((c, i) => (
    <article key={i} className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm transition hover:shadow-md">
      {c.imageUrl ? <img src={c.imageUrl} alt={c.imageAlt} className="aspect-[4/3] w-full object-cover" loading="lazy" decoding="async" /> : <div className="aspect-[4/3] w-full bg-gradient-to-br from-primary/15 to-primary/5" aria-hidden />}
      <div className="flex flex-1 flex-col gap-2 p-5">
        {c.title && <h3 className="font-heading text-lg font-semibold text-foreground">{c.title}</h3>}
        {c.text && <p className="flex-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{c.text}</p>}
        {c.buttonLabel && c.buttonUrl && (
          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <SmartLink href={c.buttonUrl} preview={preview}>
                {c.buttonLabel}
              </SmartLink>
            </Button>
          </div>
        )}
      </div>
    </article>
  ));
  const per = Number(d.columns) || 3;
  return (
    <section className="container py-10 md:py-14">
      {(d.title || d.intro || ed) && (
        <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
          <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={headingClass(first)} placeholder="Título" />
          <Txt k="intro" value={d.intro} as="p" multiline className="mt-3 text-muted-foreground" placeholder="Introducción (opcional)" />
        </div>
      )}
      {d.layout === "carousel" ? (
        <Carousel perView={{ mobile: 1, tablet: Math.min(2, per), desktop: per }} label={d.title || "Tarjetas"}>
          {cards}
        </Carousel>
      ) : (
        <div className={cn("grid gap-5 md:gap-6", CARD_COLS[d.columns] ?? CARD_COLS["3"])}>{cards}</div>
      )}
    </section>
  );
}

function ButtonBlock({ b, preview }: { b: BlockOf<"button">; preview?: boolean }) {
  const show = useShowButton(b.data.label, b.data.url, b.id);
  const ed = useContext(StudioEditContext);
  if (!show && !ed) return null;
  return (
    <section className={cn("container py-6", b.data.align === "center" && "text-center")}>
      <Button asChild size="lg" variant={b.data.variant === "outline" ? "outline" : "default"}>
        <SmartLink href={b.data.url || "#"} preview={preview}>
          <Txt k="label" value={b.data.label || (ed && !show ? "Botón" : "")} placeholder="Texto del botón" />
        </SmartLink>
      </Button>
    </section>
  );
}

function ColumnsBlock({ b, first, preview }: { b: BlockOf<"columns">; first: boolean; preview?: boolean }) {
  const d = b.data;
  const showButton = useShowButton(d.buttonLabel, d.buttonUrl, b.id);
  return (
    <section className="container py-8 md:py-12">
      <div className={cn("grid items-center gap-8 md:grid-cols-2 md:gap-12", !d.imageUrl && "md:grid-cols-1 max-w-3xl")}>
        {d.imageUrl && (
          <div className={cn(d.imagePosition === "left" ? "md:order-first" : "md:order-last")}>
            <img src={d.imageUrl} alt={d.imageAlt} className="aspect-[4/3] w-full rounded-2xl object-cover" loading="lazy" />
          </div>
        )}
        <div className="min-w-0 space-y-4">
          <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={headingClass(first)} placeholder="Título de la sección" />
          <Rich html={d.html} />
          {showButton && (
            <Button asChild>
              <SmartLink href={d.buttonUrl || "#"} preview={preview}>
                <Txt k="buttonLabel" value={d.buttonLabel} placeholder="Texto del botón (opcional)" />
              </SmartLink>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Formulario de contacto: cada envío entra en el CRM de la empresa como oportunidad y cliente (public.submitLead). */
function ContactFormBlock({ b, first, preview, pageTitle }: { b: BlockOf<"contact_form">; first: boolean; preview?: boolean; pageTitle?: string }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [accepted, setAccepted] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = trpc.public.submitLead.useMutation({
    onSuccess: () => setSent(true),
    onError: () => setError("No hemos podido enviar tu mensaje. Inténtalo de nuevo en unos minutos."),
  });
  const id = `cf-${b.id}`;
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.name.trim().length < 2) return setError("Escribe tu nombre.");
    if (!EMAIL_RE.test(form.email.trim())) return setError("Escribe un correo electrónico válido.");
    if (!accepted) return setError("Para enviarnos tu mensaje, acepta la política de privacidad.");
    if (preview) {
      toast.info("Es la vista previa: el mensaje no se envía.");
      return;
    }
    submit.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      // Como el formulario de contacto de siempre: el origen del mensaje encabeza el texto
      message: [pageTitle ? `Página: ${pageTitle}` : "", form.message.trim()].filter(Boolean).join("\n\n") || undefined,
      source: "web_contacto",
    });
  };
  return (
    <section className="container py-8 md:py-12">
      <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm md:p-8">
        <Txt k="title" value={b.data.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-2")} placeholder="Título" />
        <Txt k="intro" value={b.data.intro} as="p" multiline className="mb-6 text-muted-foreground" placeholder="Texto de introducción" />
        {sent ? (
          <p role="status" className="rounded-lg bg-primary/10 px-4 py-3 text-foreground">
            ¡Gracias! Hemos recibido tu mensaje y te responderemos lo antes posible.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>Nombre</Label>
                <Input id={`${id}-name`} autoComplete="name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-email`}>Correo electrónico</Label>
                <Input id={`${id}-email`} type="email" autoComplete="email" value={form.email} maxLength={200} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-phone`}>Teléfono (opcional)</Label>
              <Input id={`${id}-phone`} type="tel" autoComplete="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-msg`}>Mensaje</Label>
              <Textarea id={`${id}-msg`} rows={5} value={form.message} maxLength={4000} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id={`${id}-ok`} checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <Label htmlFor={`${id}-ok`} className="block text-sm font-normal leading-snug">
                <span>
                  He leído y acepto la{" "}
                  <SmartLink href="/privacidad" preview={preview} className="underline decoration-primary underline-offset-4">
                    política de privacidad
                  </SmartLink>
                  .
                </span>
              </Label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={submit.isPending}>
              {submit.isPending ? "Enviando…" : b.data.buttonLabel || "Enviar mensaje"}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function SeparatorBlock({ b }: { b: BlockOf<"separator"> }) {
  if (b.data.kind === "space") return <div className="h-10 md:h-16" aria-hidden />;
  return (
    <div className="container py-4" aria-hidden>
      <hr className="border-border" />
    </div>
  );
}

const HEADING_SIZE: Record<BlockOf<"heading">["data"]["level"], string> = { h1: "text-4xl md:text-5xl", h2: "text-3xl md:text-4xl", h3: "text-xl md:text-2xl" };

function HeadingBlock({ b }: { b: BlockOf<"heading"> }) {
  const d = b.data;
  const center = d.align === "center";
  return (
    <section className="container py-8 md:py-12">
      <div className={cn("max-w-3xl space-y-3", center && "mx-auto text-center")}>
        <Txt k="eyebrow" value={d.eyebrow} as="p" className="text-sm font-semibold uppercase tracking-[0.14em] text-primary" placeholder="Antetítulo (opcional)" />
        <Txt k="title" value={d.title} as={d.level} className={cn("break-words font-heading font-bold leading-tight text-foreground", HEADING_SIZE[d.level])} placeholder="Tu titular" />
        <Txt k="subtitle" value={d.subtitle} as="p" multiline className="text-lg text-muted-foreground" placeholder="Subtítulo (opcional)" />
      </div>
    </section>
  );
}

const FEATURE_COLS: Record<string, string> = { "2": "sm:grid-cols-2", "3": "sm:grid-cols-2 lg:grid-cols-3", "4": "sm:grid-cols-2 lg:grid-cols-4" };

function FeaturesBlock({ b, first }: { b: BlockOf<"features">; first: boolean }) {
  const d = b.data;
  const ed = useContext(StudioEditContext);
  return (
    <section className="container py-10 md:py-14">
      {(d.title || d.intro || ed) && (
        <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
          <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={headingClass(first)} placeholder="Título" />
          <Txt k="intro" value={d.intro} as="p" multiline className="mt-3 text-muted-foreground" placeholder="Introducción (opcional)" />
        </div>
      )}
      <div className={cn("grid gap-5 md:gap-6", FEATURE_COLS[d.columns] ?? FEATURE_COLS["3"])}>
        {d.items.map((it, i) => {
          const Icon = FEATURE_ICON_COMPONENTS[it.icon] ?? FEATURE_ICON_COMPONENTS.check;
          return (
            <div key={i} className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
              <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              {it.title && <h3 className="font-heading text-lg font-semibold text-foreground">{it.title}</h3>}
              {it.text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{it.text}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TestimonialsBlock({ b, first }: { b: BlockOf<"testimonials">; first: boolean }) {
  const d = b.data;
  const cards = d.items.map((it, i) => {
    const stars = Number(it.rating) || 0;
    return (
      <figure key={i} className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        {stars > 0 ? (
          <p className="mb-3 flex gap-0.5 text-amber-500" role="img" aria-label={`Valoración: ${stars} de 5`}>
            {Array.from({ length: 5 }, (_, s) => (
              <Star key={s} className={cn("h-4 w-4", s < stars ? "fill-current" : "opacity-30")} aria-hidden />
            ))}
          </p>
        ) : (
          <Quote className="mb-3 h-6 w-6 text-primary/60" aria-hidden />
        )}
        <blockquote className="flex-1 whitespace-pre-line text-base leading-relaxed text-foreground">{it.quote}</blockquote>
        {(it.author || it.role) && (
          <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4 text-sm">
            {it.photoUrl && <img src={it.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />}
            <span>
              {it.author && <span className="block font-semibold text-foreground">{it.author}</span>}
              {it.role && <span className="block text-muted-foreground">{it.role}</span>}
            </span>
          </figcaption>
        )}
      </figure>
    );
  });
  return (
    <section className="container py-10 md:py-14">
      <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-8 block text-center")} placeholder="Título" />
      {d.layout === "carousel" ? (
        <Carousel perView={{ mobile: 1, tablet: 2, desktop: 3 }} label={d.title || "Opiniones"}>
          {cards}
        </Carousel>
      ) : (
        <div className={cn("grid gap-5", d.items.length > 1 && "md:grid-cols-2", d.items.length > 2 && "lg:grid-cols-3")}>{cards}</div>
      )}
    </section>
  );
}

function FaqBlock({ b, first }: { b: BlockOf<"faq">; first: boolean }) {
  const d = b.data;
  const ed = useContext(StudioEditContext);
  return (
    <section className="container py-10 md:py-14">
      <div className="mx-auto max-w-3xl">
        <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-6 block")} placeholder="Título" />
        <div className="divide-y divide-border rounded-2xl border border-border bg-card text-card-foreground">
          {d.items.map((it, i) => (
            <details key={i} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden" open={!!ed && i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground">
                <span>{it.question}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 whitespace-pre-line text-muted-foreground">{it.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBlock({ b, first, preview }: { b: BlockOf<"cta">; first: boolean; preview?: boolean }) {
  const d = b.data;
  const showMain = useShowButton(d.buttonLabel, d.buttonUrl, b.id);
  const showSecondary = useShowButton(d.secondaryLabel, d.secondaryUrl, b.id);
  return (
    <section className="container py-12 md:py-16">
      <div className="mx-auto max-w-3xl text-center">
        <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className="font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl" placeholder="Título" />
        <Txt k="text" value={d.text} as="p" multiline className="mt-4 text-lg text-muted-foreground" placeholder="Texto" />
        {(showMain || showSecondary) && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {showMain && (
              <Button asChild size="lg">
                <SmartLink href={d.buttonUrl || "#"} preview={preview}>
                  <Txt k="buttonLabel" value={d.buttonLabel} placeholder="Texto del botón" />
                </SmartLink>
              </Button>
            )}
            {showSecondary && (
              <Button asChild size="lg" variant="outline" className="bg-transparent">
                <SmartLink href={d.secondaryUrl || "#"} preview={preview}>
                  <Txt k="secondaryLabel" value={d.secondaryLabel} placeholder="Segundo botón (opcional)" />
                </SmartLink>
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Reproductor de YouTube (sin cookies) o Vimeo a partir del enlace que pega la empresa; otro enlace, nada. */
export function videoEmbedUrl(url: string): string | null {
  const yt = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = /^https:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function VideoBlock({ b, first }: { b: BlockOf<"video">; first: boolean }) {
  const ed = useContext(StudioEditContext);
  const src = videoEmbedUrl(b.data.url);
  if (!src && !ed) return null;
  return (
    <section className="container py-8 md:py-10">
      <div className="mx-auto max-w-4xl">
        <Txt k="title" value={b.data.title} as={first ? "h1" : "h2"} className={cn(headingClass(first), "mb-5 block")} placeholder="Título (opcional)" />
        {src ? (
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-sm">
            <iframe
              src={src}
              title={b.data.title || "Vídeo"}
              className={cn("absolute inset-0 h-full w-full", ed && "pointer-events-none")}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <EmptyMedia>
            <Play className="h-8 w-8" aria-hidden />
            Pega el enlace de YouTube o Vimeo en el panel de la derecha
          </EmptyMedia>
        )}
        <Txt k="caption" value={b.data.caption} as="p" className="mt-3 block text-center text-sm text-muted-foreground" placeholder="Texto bajo el vídeo (opcional)" />
      </div>
    </section>
  );
}

type ShopItem = { id: number; slug: string; title: string; categoryId?: number | null; shortDescription?: string | null; image1?: string | null; coverImageUrl?: string | null; basePrice?: string | null; isActive?: boolean | null; isPublished?: boolean | null };

/** Productos reales de la tienda de la empresa (public.getExperiences): nada se copia en la página. */
function ProductsBlock({ b, first, preview }: { b: BlockOf<"products">; first: boolean; preview?: boolean }) {
  const d = b.data;
  const ed = useContext(StudioEditContext);
  const products = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 }, { staleTime: 60_000 });
  const categories = trpc.public.getCategories.useQuery(undefined, { staleTime: 300_000, enabled: !!d.categorySlug });
  const limit = Number(d.limit) || 4;
  const items = useMemo(() => {
    const list = (products.data ?? []) as ShopItem[];
    if (!d.categorySlug) return list.slice(0, limit);
    const cat = (categories.data as Array<{ id: number; slug: string }> | undefined)?.find((c) => c.slug === d.categorySlug);
    return cat ? list.filter((p) => p.categoryId === cat.id).slice(0, limit) : [];
  }, [products.data, categories.data, d.categorySlug, limit]);
  const showButton = !!d.buttonLabel || (!!ed && ed.selectedId === b.id);
  if (!products.isLoading && !items.length && !ed) return null;
  return (
    <section className="container py-10 md:py-14">
      {(d.title || d.intro || ed) && (
        <div className="mb-8 max-w-2xl">
          <Txt k="title" value={d.title} as={first ? "h1" : "h2"} className={headingClass(first)} placeholder="Título" />
          <Txt k="intro" value={d.intro} as="p" multiline className="mt-3 text-muted-foreground" placeholder="Introducción (opcional)" />
        </div>
      )}
      {products.isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: Math.min(limit, 4) }, (_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : !items.length ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/50 px-6 py-12 text-center text-sm text-muted-foreground">
          <ShoppingBag className="h-7 w-7" aria-hidden />
          Aquí aparecerán tus productos publicados en la tienda. Ahora mismo no hay ninguno {d.categorySlug ? "en esta categoría" : "publicado"}.
        </div>
      ) : (
        (() => {
          const tiles = items.map((p) => {
            const img = p.image1 || p.coverImageUrl;
            const price = Number(p.basePrice) > 0 ? formatEuros(p.basePrice) : null;
            const soldOut = !isPurchasable(p);
            return (
              <SmartLink key={p.id} href={productPath(p.slug)} preview={preview} className="group block h-full overflow-hidden rounded-2xl border border-border/50 bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md">
                <div className="relative">
                  {img ? <img src={img} alt={p.title} className={cn("h-44 w-full object-cover", soldOut && "opacity-60")} loading="lazy" /> : <div className="h-44 w-full bg-muted" aria-hidden="true" />}
                  {soldOut && <span className="absolute left-3 top-3 rounded-full bg-foreground/80 px-2.5 py-1 text-xs font-semibold text-background">Agotado</span>}
                </div>
                <div className="space-y-1 p-4">
                  <h3 className="break-words font-heading font-semibold group-hover:text-primary">{p.title}</h3>
                  {p.shortDescription && <p className="line-clamp-2 text-sm text-muted-foreground">{p.shortDescription}</p>}
                  {price && <p className={cn("text-sm font-semibold", soldOut && "text-muted-foreground")}>{price}</p>}
                </div>
              </SmartLink>
            );
          });
          return d.layout === "carousel" ? (
            <Carousel perView={{ mobile: 1, tablet: 2, desktop: 4 }} label={d.title || "Productos"}>
              {tiles}
            </Carousel>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">{tiles}</div>
          );
        })()
      )}
      {showButton && (
        <div className="mt-8 text-center">
          <Button asChild variant="outline" size="lg">
            <SmartLink href="/tienda" preview={preview}>
              <Txt k="buttonLabel" value={d.buttonLabel} placeholder="Botón a la tienda (opcional)" />
            </SmartLink>
          </Button>
        </div>
      )}
    </section>
  );
}

// ─── Diseño del bloque ────────────────────────────────────────────────────────

const PAD_TOP: Record<BlockStyle["padTop"], string> = { "0": "", s: "pt-4", m: "pt-10", l: "pt-20" };
const PAD_BOTTOM: Record<BlockStyle["padBottom"], string> = { "0": "", s: "pb-4", m: "pb-10", l: "pb-20" };

/**
 * Fondo de color de marca u oscuro: el bloque redefine los colores de su interior (texto, tarjetas, bordes y botones)
 * para que se lean bien, sin tocar el resto de la web. El color de marca se captura en el contenedor exterior antes de
 * redefinirlo en el interior.
 */
const BRAND_OUTER = { "--studio-brand": "var(--primary)", background: "var(--studio-brand)" } as CSSProperties;
const BRAND_INNER = {
  "--primary": "#ffffff", "--primary-foreground": "var(--studio-brand)", "--foreground": "#ffffff", "--muted-foreground": "rgba(255,255,255,0.82)",
  "--card": "rgba(255,255,255,0.08)", "--card-foreground": "#ffffff", "--border": "rgba(255,255,255,0.22)", "--muted": "rgba(255,255,255,0.12)",
  "--input": "rgba(255,255,255,0.35)", color: "#ffffff",
} as CSSProperties;
const DARK_OUTER = { background: "#0f172a" } as CSSProperties;
const DARK_INNER = {
  "--foreground": "#f8fafc", "--muted-foreground": "rgba(248,250,252,0.74)", "--card": "rgba(255,255,255,0.05)", "--card-foreground": "#f8fafc",
  "--border": "rgba(255,255,255,0.14)", "--muted": "rgba(255,255,255,0.08)", "--input": "rgba(255,255,255,0.25)", color: "#f8fafc",
} as CSSProperties;

function hiddenClasses(s: BlockStyle): string {
  return cn(s.hideOn.includes("mobile") && "max-md:hidden", s.hideOn.includes("tablet") && "md:max-lg:hidden", s.hideOn.includes("desktop") && "lg:hidden");
}

function StyleFrame({ style, edit, children }: { style?: BlockStyle; edit: boolean; children: ReactNode }) {
  if (!style) return <>{children}</>;
  const s = { ...DEFAULT_BLOCK_STYLE, ...style };
  const outer = s.background === "brand" ? BRAND_OUTER : s.background === "dark" ? DARK_OUTER : undefined;
  const inner = s.background === "brand" ? BRAND_INNER : s.background === "dark" ? DARK_INNER : undefined;
  return (
    <div id={s.anchor || undefined} className={cn("scroll-mt-24", s.background === "soft" && "bg-muted/60", PAD_TOP[s.padTop], PAD_BOTTOM[s.padBottom], !edit && hiddenClasses(s))} style={outer}>
      <AnimateIn kind={edit ? "none" : s.animation}>{inner ? <div style={inner}>{children}</div> : children}</AnimateIn>
    </div>
  );
}

const ANIM_FROM: Record<string, string> = { fade: "opacity-0", up: "opacity-0 translate-y-8", zoom: "opacity-0 scale-95" };

/**
 * Animación al aparecer en pantalla: el bloque entra una sola vez al hacerse visible. Sin animación si la persona
 * prefiere menos movimiento, en el editor o si el navegador no sabe detectar la visibilidad (se muestra tal cual).
 */
function AnimateIn({ kind, children }: { kind: BlockStyle["animation"]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const active = kind !== "none";
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return setShown(true);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  if (!active) return <>{children}</>;
  return (
    <div ref={ref} data-animate={kind} className={cn("transition-all duration-700 ease-out motion-reduce:transition-none", shown ? "translate-y-0 scale-100 opacity-100" : ANIM_FROM[kind])}>
      {children}
    </div>
  );
}

// ─── Marco de edición de cada bloque (lienzo) ─────────────────────────────────

const DEVICE_LABEL: Record<Device, string> = { desktop: "ordenador", tablet: "tableta", mobile: "móvil" };

function EditFrame({ ed, b, index, count, children }: { ed: StudioEdit; b: PageBlock; index: number; count: number; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [drop, setDrop] = useState<"before" | "after" | null>(null);
  const selected = ed.selectedId === b.id;
  const hiddenHere = !!b.style?.hideOn.includes(ed.device);
  const act = (a: StudioBlockAction) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ed.onAction(b.id, a);
  };
  return (
    <div
      data-studio-block={b.id}
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        if (ed.readOnly) return;
        e.stopPropagation();
        if (!selected) {
          e.preventDefault();
          ed.onSelect(b.id);
        }
      }}
      onDragOver={(e) => {
        if (ed.readOnly || !ed.dragTypes(e.dataTransfer.types)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDrop(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(e) => {
        if (ed.readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        const payload = ed.readDrop(e.dataTransfer);
        // La posición se calcula con el propio evento (no con el estado del último «dragover», que puede no estar al día)
        const r = e.currentTarget.getBoundingClientRect();
        const at = e.clientY < r.top + r.height / 2 ? index : index + 1;
        setDrop(null);
        if (payload) ed.onDrop(payload, at);
      }}
    >
      <div className={cn(hiddenHere && "opacity-40")}>{children}</div>
      {(selected || hover) && !ed.readOnly && (
        <>
          <div className="pointer-events-none absolute inset-0 z-30" style={{ boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${STUDIO_ACCENT}` }} aria-hidden />
          <span className="pointer-events-none absolute left-0 top-0 z-40 rounded-br-md px-2 py-0.5 font-sans text-[11px] font-semibold text-white" style={{ background: STUDIO_ACCENT }}>
            {blockLabel(b.type)}
          </span>
        </>
      )}
      {hiddenHere && (
        <span className={cn("pointer-events-none absolute z-40 inline-flex items-center gap-1 rounded-md bg-slate-900/85 px-2 py-0.5 font-sans text-[11px] font-medium text-white", selected ? "left-2 top-7" : "right-2 top-2")}>
          <EyeOff className="h-3 w-3" aria-hidden /> Oculto en {DEVICE_LABEL[ed.device]}
        </span>
      )}
      {selected && !ed.readOnly && (
        <div className="absolute right-2 top-2 z-50 flex items-center gap-0.5 rounded-lg p-0.5 font-sans shadow-lg" style={{ background: STUDIO_ACCENT }}>
          <span
            draggable
            role="button"
            tabIndex={-1}
            title="Arrastra para mover"
            aria-label="Arrastra para mover"
            className="cursor-grab rounded-md p-1.5 text-white hover:bg-white/15 active:cursor-grabbing"
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-elephant-studio", `block:${b.id}`);
              e.dataTransfer.setData("text/plain", `block:${b.id}`);
            }}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <ToolButton label="Subir" disabled={index === 0} onClick={act("up")}>
            <ArrowUp className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="Bajar" disabled={index === count - 1} onClick={act("down")}>
            <ArrowDown className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="Duplicar" onClick={act("duplicate")}>
            <Copy className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="Eliminar" onClick={act("delete")}>
            <Trash2 className="h-3.5 w-3.5" />
          </ToolButton>
        </div>
      )}
      {drop && <DropLine at={drop} />}
    </div>
  );
}

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded-md p-1.5 text-white hover:bg-white/15 disabled:opacity-40">
      {children}
    </button>
  );
}

function DropLine({ at }: { at: "before" | "after" }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 z-50 flex items-center", at === "before" ? "-top-[3px]" : "-bottom-[3px]")} aria-hidden>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: STUDIO_ACCENT }} />
      <span className="h-[3px] flex-1" style={{ background: STUDIO_ACCENT }} />
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: STUDIO_ACCENT }} />
    </div>
  );
}

/** Zona para soltar al final de la página (y en la página vacía). */
function EndDropZone({ ed, index, empty }: { ed: StudioEdit; index: number; empty: boolean }) {
  const [over, setOver] = useState(false);
  if (ed.readOnly) return null;
  return (
    <div
      className={cn("container font-sans", empty ? "py-16" : "py-6")}
      onDragOver={(e) => {
        if (!ed.dragTypes(e.dataTransfer.types)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const payload = ed.readDrop(e.dataTransfer);
        if (payload) ed.onDrop(payload, index);
      }}
    >
      <div
        className={cn("rounded-2xl border-2 border-dashed px-6 text-center text-sm transition-colors", empty ? "py-16" : "py-5")}
        style={{ borderColor: over ? STUDIO_ACCENT : "rgba(100,116,139,0.35)", background: over ? "rgba(91,91,246,0.06)" : "transparent", color: over ? STUDIO_ACCENT : "rgb(100,116,139)" }}
      >
        {empty ? "La página está vacía. Arrastra aquí un módulo de la biblioteca o haz clic en uno para añadirlo." : "Suelta aquí para añadirlo al final de la página"}
      </div>
    </div>
  );
}

/** Si el bloque muestra un título (para que el primero de la página sea el h1). */
function hasTitle(b: PageBlock): boolean {
  // La presentación aporta el titular de su primera diapositiva
  if (b.type === "slideshow") return !!b.data.slides[0]?.title;
  return b.type !== "heading" && "title" in b.data && !!(b.data as { title?: string }).title;
}

function renderBlock(b: PageBlock, first: boolean, preview?: boolean, pageTitle?: string) {
  switch (b.type) {
    case "hero":
      return <HeroBlock b={b} first={first} preview={preview} />;
    case "text":
      return <TextBlock b={b} first={first} />;
    case "image":
      return <ImageBlock b={b} />;
    case "gallery":
      return <GalleryBlock b={b} first={first} />;
    case "button":
      return <ButtonBlock b={b} preview={preview} />;
    case "columns":
      return <ColumnsBlock b={b} first={first} preview={preview} />;
    case "contact_form":
      return <ContactFormBlock b={b} first={first} preview={preview} pageTitle={pageTitle} />;
    case "separator":
      return <SeparatorBlock b={b} />;
    case "heading":
      return <HeadingBlock b={b} />;
    case "features":
      return <FeaturesBlock b={b} first={first} />;
    case "testimonials":
      return <TestimonialsBlock b={b} first={first} />;
    case "faq":
      return <FaqBlock b={b} first={first} />;
    case "cta":
      return <CtaBlock b={b} first={first} preview={preview} />;
    case "video":
      return <VideoBlock b={b} first={first} />;
    case "products":
      return <ProductsBlock b={b} first={first} preview={preview} />;
    case "slideshow":
      return <SlideshowBlock b={b} first={first} preview={preview} />;
    case "carousel":
      return <CarouselBlock b={b} first={first} />;
    case "cards":
      return <CardsBlock b={b} first={first} preview={preview} />;
    default:
      return null;
  }
}

export function PageBlocksView({ blocks, preview, pageTitle }: { blocks: PageBlock[]; preview?: boolean; pageTitle?: string }) {
  const ed = useContext(StudioEditContext);
  // La página ya tiene su titular principal si un módulo «Título» lo declara como H1
  const ownH1 = blocks.some((b) => b.type === "heading" && b.data.level === "h1");
  const firstTitled = ownH1 ? -1 : blocks.findIndex(hasTitle);
  return (
    <div className="pb-8">
      {blocks.map((b, i) => {
        const content = (
          <BlockCtx.Provider value={b}>
            <StyleFrame style={b.style} edit={!!ed}>
              {renderBlock(b, i === firstTitled, preview || !!ed, pageTitle)}
            </StyleFrame>
          </BlockCtx.Provider>
        );
        return ed ? (
          <EditFrame key={b.id} ed={ed} b={b} index={i} count={blocks.length}>
            {content}
          </EditFrame>
        ) : (
          <Fragment key={b.id}>{content}</Fragment>
        );
      })}
      {ed && <EndDropZone ed={ed} index={blocks.length} empty={blocks.length === 0} />}
    </div>
  );
}
