/**
 * Pinta los bloques de una página de la web de la empresa. Es el MISMO componente en la web pública y en la vista
 * previa del panel (con `preview`, los enlaces no navegan y el formulario no envía nada).
 *
 * El texto con formato llega ya saneado del servidor (lista blanca, server/_core/pageBlocks.ts).
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { RICH_TEXT_CLASS } from "@/components/site/richText";
import type { BlockOf, PageBlock } from "@shared/pageBlocks";

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

function Heading({ first, children, className }: { first: boolean; children: ReactNode; className?: string }) {
  return first ? (
    <h1 className={cn("font-heading text-3xl md:text-4xl font-bold leading-tight text-primary", className)}>{children}</h1>
  ) : (
    <h2 className={cn("font-heading text-2xl md:text-3xl font-bold text-foreground", className)}>{children}</h2>
  );
}

function Rich({ html, className }: { html: string; className?: string }) {
  if (!html) return null;
  // HTML saneado en servidor con lista blanca
  return <div className={cn(RICH_TEXT_CLASS, "[&>*:first-child]:mt-0", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

function HeroBlock({ b, first, preview }: { b: BlockOf<"hero">; first: boolean; preview?: boolean }) {
  const d = b.data;
  const TitleTag = first ? "h1" : "h2";
  return (
    <section className={cn("relative overflow-hidden", d.imageUrl ? "min-h-[360px] md:min-h-[460px]" : "bg-primary")}>
      {d.imageUrl && <img src={d.imageUrl} alt={d.imageAlt} className="absolute inset-0 h-full w-full object-cover" />}
      {d.imageUrl && <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/40 to-black/60" />}
      <div className={cn("relative container flex flex-col justify-center gap-4 py-16 md:py-24 text-white", d.imageUrl ? "min-h-[360px] md:min-h-[460px]" : "text-primary-foreground")}>
        {d.title && <TitleTag className="max-w-3xl break-words font-heading text-3xl md:text-5xl font-bold leading-tight">{d.title}</TitleTag>}
        {d.subtitle && <p className="max-w-2xl text-lg md:text-xl opacity-90">{d.subtitle}</p>}
        {d.buttonLabel && d.buttonUrl && (
          <div>
            <Button asChild size="lg" className={d.imageUrl ? undefined : "bg-white text-primary hover:bg-white/90"}>
              <SmartLink href={d.buttonUrl} preview={preview}>
                {d.buttonLabel}
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
        {b.data.title && <Heading first={first} className="mb-4">{b.data.title}</Heading>}
        <Rich html={b.data.html} className={center ? "[&_ul]:inline-block [&_ul]:text-left [&_ol]:inline-block [&_ol]:text-left" : undefined} />
      </div>
    </section>
  );
}

function ImageBlock({ b }: { b: BlockOf<"image"> }) {
  if (!b.data.url) return null;
  return (
    <section className="container py-6">
      <figure className={cn("mx-auto", b.data.size === "wide" ? "max-w-6xl" : "max-w-3xl")}>
        <img src={b.data.url} alt={b.data.alt} className="h-auto w-full rounded-2xl object-cover" loading="lazy" />
        {b.data.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{b.data.caption}</figcaption>}
      </figure>
    </section>
  );
}

function GalleryBlock({ b, first }: { b: BlockOf<"gallery">; first: boolean }) {
  if (!b.data.images.length) return null;
  return (
    <section className="container py-8 md:py-10">
      {b.data.title && <Heading first={first} className="mb-6">{b.data.title}</Heading>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {b.data.images.map((g, i) => (
          <img key={i} src={g.url} alt={g.alt} className="aspect-square w-full rounded-xl object-cover" loading="lazy" />
        ))}
      </div>
    </section>
  );
}

function ButtonBlock({ b, preview }: { b: BlockOf<"button">; preview?: boolean }) {
  if (!b.data.label || !b.data.url) return null;
  return (
    <section className={cn("container py-6", b.data.align === "center" && "text-center")}>
      <Button asChild size="lg" variant={b.data.variant === "outline" ? "outline" : "default"}>
        <SmartLink href={b.data.url} preview={preview}>
          {b.data.label}
        </SmartLink>
      </Button>
    </section>
  );
}

function ColumnsBlock({ b, first, preview }: { b: BlockOf<"columns">; first: boolean; preview?: boolean }) {
  const d = b.data;
  return (
    <section className="container py-8 md:py-12">
      <div className={cn("grid items-center gap-8 md:grid-cols-2 md:gap-12", !d.imageUrl && "md:grid-cols-1 max-w-3xl")}>
        {d.imageUrl && (
          <div className={cn(d.imagePosition === "left" ? "md:order-first" : "md:order-last")}>
            <img src={d.imageUrl} alt={d.imageAlt} className="aspect-[4/3] w-full rounded-2xl object-cover" loading="lazy" />
          </div>
        )}
        <div className="min-w-0 space-y-4">
          {d.title && <Heading first={first}>{d.title}</Heading>}
          <Rich html={d.html} />
          {d.buttonLabel && d.buttonUrl && (
            <Button asChild>
              <SmartLink href={d.buttonUrl} preview={preview}>
                {d.buttonLabel}
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
        {b.data.title && <Heading first={first} className="mb-2">{b.data.title}</Heading>}
        {b.data.intro && <p className="mb-6 text-muted-foreground">{b.data.intro}</p>}
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

/** Si el bloque muestra un título (para que el primero de la página sea el h1). */
function hasTitle(b: PageBlock): boolean {
  return "title" in b.data && !!(b.data as { title?: string }).title;
}

export function PageBlocksView({ blocks, preview, pageTitle }: { blocks: PageBlock[]; preview?: boolean; pageTitle?: string }) {
  const firstTitled = blocks.findIndex(hasTitle);
  return (
    <div className="pb-8">
      {blocks.map((b, i) => {
        const first = i === firstTitled;
        switch (b.type) {
          case "hero":
            return <HeroBlock key={b.id} b={b} first={first} preview={preview} />;
          case "text":
            return <TextBlock key={b.id} b={b} first={first} />;
          case "image":
            return <ImageBlock key={b.id} b={b} />;
          case "gallery":
            return <GalleryBlock key={b.id} b={b} first={first} />;
          case "button":
            return <ButtonBlock key={b.id} b={b} preview={preview} />;
          case "columns":
            return <ColumnsBlock key={b.id} b={b} first={first} preview={preview} />;
          case "contact_form":
            return <ContactFormBlock key={b.id} b={b} first={first} preview={preview} pageTitle={pageTitle} />;
          case "separator":
            return <SeparatorBlock key={b.id} b={b} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
