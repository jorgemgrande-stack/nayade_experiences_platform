import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Leaf, Droplets, Sparkles, ChevronRight } from "lucide-react";

// ─── Block Renderers (mismo patrón que Hotel.tsx) ────────────────────────────

function HeroBlock({ data }: { data: Record<string, unknown> }) {
  const opacity = (data.overlayOpacity as number ?? 50) / 100;
  const title = String(data.title || "");
  const subtitle = String(data.subtitle || "");
  const ctaText = String(data.ctaText || "");
  const ctaUrl = String(data.ctaUrl || "");
  const imageUrl = String(data.imageUrl || "");
  return (
    <section className="relative min-h-[420px] flex items-center justify-center overflow-hidden">
      {imageUrl && <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 bg-black" style={{ opacity }} />
      <div className="relative z-10 text-center text-white px-6 max-w-3xl mx-auto">
        {title && <h1 className="text-4xl md:text-5xl font-bold mb-4">{title}</h1>}
        {subtitle && <p className="text-lg md:text-xl opacity-90 mb-8">{subtitle}</p>}
        {ctaText && ctaUrl && (
          <Link href={ctaUrl}><Button size="lg" className="bg-accent hover:bg-accent/90 text-white px-8">{ctaText}</Button></Link>
        )}
      </div>
    </section>
  );
}

function TextBlock({ data }: { data: Record<string, unknown> }) {
  const align = String(data.align || "left");
  const alignClass = align === "center" ? "text-center mx-auto" : align === "right" ? "text-right ml-auto" : "";
  const title = String(data.title ?? "");
  const body = String(data.body ?? "");
  return (
    <section className="py-12 px-6">
      <div className={`max-w-3xl ${alignClass}`}>
        {title && <h2 className="text-2xl md:text-3xl font-bold mb-4 text-foreground">{title}</h2>}
        {body && <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{body}</div>}
      </div>
    </section>
  );
}

function ImageTextBlock({ data }: { data: Record<string, unknown> }) {
  const isRight = data.imagePosition === "right";
  const imageUrl = String(data.imageUrl || "");
  const title = String(data.title ?? "");
  const body = String(data.body ?? "");
  const ctaText = String(data.ctaText ?? "");
  const ctaUrl = String(data.ctaUrl ?? "");
  return (
    <section className="py-12 px-6">
      <div className={`max-w-5xl mx-auto flex flex-col md:flex-row gap-10 items-center ${isRight ? "md:flex-row-reverse" : ""}`}>
        {imageUrl && <div className="flex-1"><img src={imageUrl} alt="" className="w-full rounded-2xl object-cover aspect-[4/3]" /></div>}
        <div className="flex-1 space-y-4">
          {title && <h2 className="text-2xl md:text-3xl font-bold text-foreground">{title}</h2>}
          {body && <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{body}</p>}
          {ctaText && ctaUrl && (
            <Link href={ctaUrl}><Button className="bg-accent hover:bg-accent/90 text-white mt-2">{ctaText} <ChevronRight size={16} className="ml-1" /></Button></Link>
          )}
        </div>
      </div>
    </section>
  );
}

function CtaBlock({ data }: { data: Record<string, unknown> }) {
  const bgMap: Record<string, string> = { orange: "bg-accent", blue: "bg-primary", dark: "bg-slate-900" };
  const bg = bgMap[String(data.bgColor || "orange")] || bgMap.orange;
  const title = String(data.title ?? "");
  const subtitle = String(data.subtitle ?? "");
  const ctaText = String(data.ctaText ?? "");
  const ctaUrl = String(data.ctaUrl ?? "");
  return (
    <section className={`py-16 px-6 ${bg} text-white text-center`}>
      {title && <h2 className="text-2xl md:text-3xl font-bold mb-2">{title}</h2>}
      {subtitle && <p className="opacity-80 mb-6">{subtitle}</p>}
      {ctaText && ctaUrl && (
        <Link href={ctaUrl}><Button size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-slate-900 px-8">{ctaText}</Button></Link>
      )}
    </section>
  );
}

function GalleryBlock({ data }: { data: Record<string, unknown> }) {
  const images = Array.isArray(data.images) ? (data.images as string[]) : [];
  const title = String(data.title ?? "");
  if (images.length === 0) return null;
  return (
    <section className="py-12 px-6">
      {title && <h2 className="text-2xl font-bold mb-6 text-center">{title}</h2>}
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-4">
        {images.filter(Boolean).map((img, i) => <img key={i} src={String(img)} alt="" className="w-full rounded-xl object-cover aspect-square" />)}
      </div>
    </section>
  );
}

function AccordionBlock({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? (data.items as { question: string; answer: string }[]) : [];
  const title = String(data.title ?? "");
  return (
    <section className="py-12 px-6">
      <div className="max-w-3xl mx-auto">
        {title && <h2 className="text-2xl font-bold mb-6 text-center">{title}</h2>}
        <div className="space-y-3">
          {items.map((item, i) => (
            <details key={i} className="group border border-border rounded-xl overflow-hidden">
              <summary className="flex items-center justify-between px-5 py-4 cursor-pointer font-medium text-foreground hover:bg-slate-50 list-none">
                {String(item.question || "")}
                <ChevronRight size={16} className="text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-5 pb-4 text-muted-foreground leading-relaxed">{String(item.answer || "")}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesBlock({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? (data.items as { icon: string; title: string; description: string }[]) : [];
  const title = String(data.title ?? "");
  return (
    <section className="py-12 px-6 bg-slate-50">
      <div className="max-w-5xl mx-auto">
        {title && <h2 className="text-2xl font-bold mb-8 text-center">{title}</h2>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {items.map((item, i) => (
            <div key={i} className="bg-background rounded-xl p-6 text-center shadow-sm border border-border">
              <div className="text-4xl mb-3">{String(item.icon || "")}</div>
              <h3 className="font-semibold text-foreground mb-2">{String(item.title || "")}</h3>
              <p className="text-sm text-muted-foreground">{String(item.description || "")}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SpacerBlock({ data }: { data: Record<string, unknown> }) {
  return <div style={{ height: `${(data.height as number) || 40}px` }} />;
}

function renderBlock(block: { id: number; blockType: string; data: unknown; isVisible: boolean }) {
  if (!block.isVisible) return null;
  const data = (block.data as Record<string, unknown>) || {};
  switch (block.blockType) {
    case "hero": return <HeroBlock key={block.id} data={data} />;
    case "text": return <TextBlock key={block.id} data={data} />;
    case "image_text": return <ImageTextBlock key={block.id} data={data} />;
    case "cta": return <CtaBlock key={block.id} data={data} />;
    case "gallery": return <GalleryBlock key={block.id} data={data} />;
    case "accordion": return <AccordionBlock key={block.id} data={data} />;
    case "features": return <FeaturesBlock key={block.id} data={data} />;
    case "spacer": return <SpacerBlock key={block.id} data={data} />;
    default: return null;
  }
}

// ─── Contenido estático de fallback ─────────────────────────────────────────

const CDN = {
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  lago: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
};

const tratamientos = [
  { icon: <Droplets className="w-6 h-6" />, nombre: "Circuito de Aguas", desc: "Jacuzzi, piscina de contrastes, sauna finlandesa y baño turco. Relax total en 90 minutos.", precio: "35€/persona", duracion: "90 min" },
  { icon: <Leaf className="w-6 h-6" />, nombre: "Masaje Relajante", desc: "Masaje de cuerpo completo con aceites esenciales naturales. Libera tensiones y recarga energía.", precio: "55€", duracion: "60 min" },
  { icon: <Sparkles className="w-6 h-6" />, nombre: "Ritual Náyade", desc: "Exfoliación corporal + envoltura de barro + masaje relajante. La experiencia SPA completa.", precio: "95€", duracion: "120 min" },
  { icon: <Droplets className="w-6 h-6" />, nombre: "Masaje de Piedras Calientes", desc: "Técnica de termoterapia con piedras volcánicas. Profunda relajación muscular y mental.", precio: "70€", duracion: "75 min" },
  { icon: <Leaf className="w-6 h-6" />, nombre: "Facial Revitalizante", desc: "Tratamiento facial personalizado con productos naturales. Piel luminosa y revitalizada.", precio: "50€", duracion: "50 min" },
  { icon: <Sparkles className="w-6 h-6" />, nombre: "Pack Pareja", desc: "Circuito de aguas + masaje en pareja + copa de cava. La escapada romántica perfecta.", precio: "150€/pareja", duracion: "150 min" },
];

function StaticSpaContent() {
  return (
    <>
      {/* Hero */}
      <section className="relative h-[60vh] min-h-[420px] overflow-hidden">
        <img src={CDN.hero} alt="SPA Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">Bienestar & Relax</span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">SPA Náyade</h1>
              <p className="text-xl text-white/85 font-display mb-6">Un oasis de bienestar frente al lago. Circuito de aguas, masajes y tratamientos para reconectar contigo mismo.</p>
              <Link href="/presupuesto">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8 shadow-lg">
                  Reservar Tratamiento <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              <img src={CDN.lago} alt="SPA con vistas al lago" className="w-full h-[420px] object-cover" />
            </div>
            <div>
              <span className="text-accent font-display font-semibold text-sm uppercase tracking-widest">Tu momento de paz</span>
              <h2 className="text-4xl font-heading font-bold text-foreground mt-2 mb-5">Bienestar en plena naturaleza</h2>
              <p className="text-muted-foreground font-display text-lg leading-relaxed mb-5">
                El SPA Náyade es un espacio de bienestar diseñado para ofrecerte la máxima relajación en un entorno natural único. Situado a orillas del embalse de Los Ángeles de San Rafael, combina las propiedades terapéuticas del agua con tratamientos de belleza y bienestar de primer nivel.
              </p>
              <p className="text-muted-foreground font-display leading-relaxed mb-8">
                Nuestro equipo de terapeutas especializados te guiará en una experiencia personalizada, adaptada a tus necesidades.
              </p>
              <div className="grid grid-cols-3 gap-4 mb-8">
                {[{ label: "Jacuzzi", icon: "🌊" }, { label: "Sauna", icon: "🔥" }, { label: "Baño turco", icon: "💨" }, { label: "Piscina fría", icon: "❄️" }, { label: "Sala relax", icon: "🧘" }, { label: "Vestuarios", icon: "✨" }].map((item, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 bg-muted/50 rounded-xl p-3 text-center">
                    <span className="text-2xl">{item.icon}</span>
                    <span className="text-xs font-display text-foreground/70">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tratamientos */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-heading font-bold text-foreground mb-3">Nuestros <span className="text-accent">Tratamientos</span></h2>
            <p className="text-muted-foreground font-display text-lg max-w-xl mx-auto">Desde el circuito de aguas hasta rituales completos. Todos nuestros tratamientos utilizan productos naturales de primera calidad.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tratamientos.map((t, i) => (
              <div key={i} className="bg-card rounded-2xl p-6 shadow-md border border-border/40 hover:shadow-lg transition-all hover:-translate-y-0.5 duration-300">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent mb-4">{t.icon}</div>
                <h3 className="font-heading font-bold text-foreground text-lg mb-2">{t.nombre}</h3>
                <p className="text-muted-foreground font-display text-sm leading-relaxed mb-4">{t.desc}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xl font-heading font-bold text-accent">{t.precio}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground font-display mt-0.5"><Clock className="w-3.5 h-3.5" />{t.duracion}</div>
                  </div>
                  <Link href="/presupuesto"><Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-4">Reservar</Button></Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary text-white">
        <div className="container text-center">
          <h2 className="text-3xl font-heading font-bold mb-3">Regala bienestar</h2>
          <p className="text-white/80 font-display text-lg mb-8 max-w-xl mx-auto">Los bonos regalo del SPA Náyade son el detalle perfecto para cualquier ocasión.</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/presupuesto"><Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-10 shadow-lg">Reservar Tratamiento <ArrowRight className="w-4 h-4 ml-2" /></Button></Link>
            <a href="tel:+34930347791"><Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 font-display font-semibold rounded-full px-10 bg-transparent">+34 930 34 77 91</Button></a>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Spa() {
  const { data: blocks, isLoading } = trpc.public.getPublicPageBlocks.useQuery({ slug: "spa" });

  const hasBlocks = !isLoading && blocks && blocks.length > 0;

  return (
    <PublicLayout>
      {isLoading ? (
        <StaticSpaContent />
      ) : hasBlocks ? (
        <div>
          {(blocks as any[]).map(block => renderBlock(block))}
        </div>
      ) : (
        <StaticSpaContent />
      )}
    </PublicLayout>
  );
}
