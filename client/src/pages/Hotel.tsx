import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Star, Wifi, Coffee, Car, Waves, Utensils, Dumbbell, ChevronRight } from "lucide-react";

// ─── Reutilizamos los mismos renderizadores de DynamicPage ──────────────────

function HeroBlock({ data }: { data: Record<string, unknown> }) {
  const opacity = (data.overlayOpacity as number ?? 50) / 100;
  const title = String(data.title || "");
  const subtitle = String(data.subtitle || "");
  const ctaText = String(data.ctaText || "");
  const ctaUrl = String(data.ctaUrl || "");
  const imageUrl = String(data.imageUrl || "");
  return (
    <section className="relative min-h-[420px] flex items-center justify-center overflow-hidden">
      {imageUrl && (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 bg-black" style={{ opacity }} />
      <div className="relative z-10 text-center text-white px-6 max-w-3xl mx-auto">
        {title && <h1 className="text-4xl md:text-5xl font-bold mb-4">{title}</h1>}
        {subtitle && <p className="text-lg md:text-xl opacity-90 mb-8">{subtitle}</p>}
        {ctaText && ctaUrl && (
          <Link href={ctaUrl}>
            <Button size="lg" className="bg-accent hover:bg-accent/90 text-white px-8">
              {ctaText}
            </Button>
          </Link>
        )}
      </div>
    </section>
  );
}

function TextBlock({ data }: { data: Record<string, unknown> }) {
  const align = String(data.align || "left");
  const alignClass = align === "center" ? "text-center mx-auto" : align === "right" ? "text-right ml-auto" : "";
  const title = String(data.title || "");
  const body = String(data.body || "");
  return (
    <section className="py-12 px-6">
      <div className={`max-w-3xl ${alignClass}`}>
        {title && <h2 className="text-2xl md:text-3xl font-bold mb-4 text-foreground">{title}</h2>}
        {body && (
          <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {body}
          </div>
        )}
      </div>
    </section>
  );
}

function ImageTextBlock({ data }: { data: Record<string, unknown> }) {
  const isRight = data.imagePosition === "right";
  const imageUrl = String(data.imageUrl || "");
  const title = String(data.title || "");
  const body = String(data.body || "");
  const ctaText = String(data.ctaText || "");
  const ctaUrl = String(data.ctaUrl || "");
  return (
    <section className="py-12 px-6">
      <div className={`max-w-5xl mx-auto flex flex-col md:flex-row gap-10 items-center ${isRight ? "md:flex-row-reverse" : ""}`}>
        {imageUrl && (
          <div className="flex-1">
            <img src={imageUrl} alt="" className="w-full rounded-2xl object-cover aspect-[4/3]" />
          </div>
        )}
        <div className="flex-1 space-y-4">
          {title && <h2 className="text-2xl md:text-3xl font-bold text-foreground">{title}</h2>}
          {body && <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{body}</p>}
          {ctaText && ctaUrl && (
            <Link href={ctaUrl}>
              <Button className="bg-accent hover:bg-accent/90 text-white mt-2">
                {ctaText} <ChevronRight size={16} className="ml-1" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function CtaBlock({ data }: { data: Record<string, unknown> }) {
  const bgMap: Record<string, string> = {
    orange: "bg-accent",
    blue: "bg-primary",
    dark: "bg-slate-900",
  };
  const bg = bgMap[String(data.bgColor || "orange")] || bgMap.orange;
  const title = String(data.title || "");
  const subtitle = String(data.subtitle || "");
  const ctaText = String(data.ctaText || "");
  const ctaUrl = String(data.ctaUrl || "");
  return (
    <section className={`py-16 px-6 ${bg} text-white text-center`}>
      {title && <h2 className="text-2xl md:text-3xl font-bold mb-2">{title}</h2>}
      {subtitle && <p className="opacity-80 mb-6">{subtitle}</p>}
      {ctaText && ctaUrl && (
        <Link href={ctaUrl}>
          <Button size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-slate-900 px-8">
            {ctaText}
          </Button>
        </Link>
      )}
    </section>
  );
}

function GalleryBlock({ data }: { data: Record<string, unknown> }) {
  const images = Array.isArray(data.images) ? (data.images as string[]) : [];
  const title = String(data.title || "");
  if (images.length === 0) return null;
  return (
    <section className="py-12 px-6">
      {title && <h2 className="text-2xl font-bold mb-6 text-center">{title}</h2>}
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-4">
        {images.filter(Boolean).map((img, i) => (
          <img key={i} src={String(img)} alt="" className="w-full rounded-xl object-cover aspect-square" />
        ))}
      </div>
    </section>
  );
}

function AccordionBlock({ data }: { data: Record<string, unknown> }) {
  const items = Array.isArray(data.items) ? (data.items as { question: string; answer: string }[]) : [];
  const title = String(data.title || "");
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
  const title = String(data.title || "");
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
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  lago: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
};

const habitaciones = [
  { tipo: "Habitación Doble", precio: "120€", rango: "95€ – 145€ / noche", icono: "🛏️", desc: "Confort y vistas al lago o jardín" },
  { tipo: "Suite Junior", precio: "165€", rango: "140€ – 195€ / noche", icono: "✨", desc: "Espacio amplio con terraza privada" },
  { tipo: "Familiar (3-4 personas)", precio: "195€", rango: "170€ – 220€ / noche", icono: "👨‍👩‍👧‍👦", desc: "Espacio para toda la familia" },
  { tipo: "Suite Premium Lago", precio: "245€", rango: "210€ – 280€ / noche", icono: "🌅", desc: "Vistas directas al embalse, jacuzzi" },
];

const servicios = [
  { icon: <Wifi className="w-5 h-5" />, label: "WiFi gratuito" },
  { icon: <Coffee className="w-5 h-5" />, label: "Desayuno incluido" },
  { icon: <Car className="w-5 h-5" />, label: "Parking gratuito" },
  { icon: <Waves className="w-5 h-5" />, label: "Acceso al lago" },
  { icon: <Utensils className="w-5 h-5" />, label: "Restaurantes en el resort" },
  { icon: <Dumbbell className="w-5 h-5" />, label: "Acceso al SPA" },
];

function StaticHotelContent() {
  return (
    <>
      {/* Hero */}
      <section className="relative h-[60vh] min-h-[420px] overflow-hidden">
        <img src={CDN.hero} alt="Hotel Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <div className="flex items-center gap-1 mb-4">
                {[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />)}
                <span className="ml-2 font-display text-sm text-white/80">Hotel Boutique</span>
              </div>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Hotel Náyade
              </h1>
              <p className="text-xl text-white/85 font-display mb-6">
                Alójate frente al embalse de Los Ángeles de San Rafael. Naturaleza, confort y aventura a la puerta de tu habitación.
              </p>
              <Link href="/presupuesto">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8 shadow-lg">
                  Reservar Habitación <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Servicios */}
      <section className="py-10 bg-primary text-white">
        <div className="container">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {servicios.map((s, i) => (
              <div key={i} className="flex flex-col items-center gap-2 text-center">
                <div className="text-accent">{s.icon}</div>
                <span className="text-xs font-display text-white/85">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Descripción */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-accent font-display font-semibold text-sm uppercase tracking-widest">Tu refugio en la naturaleza</span>
              <h2 className="text-4xl font-heading font-bold text-foreground mt-2 mb-5">
                Un hotel frente al lago, a 45 min de Madrid
              </h2>
              <p className="text-muted-foreground font-display text-lg leading-relaxed mb-5">
                El Hotel Náyade es un hotel boutique situado a orillas del embalse de Los Ángeles de San Rafael, en la Sierra de Guadarrama. Un entorno privilegiado donde la naturaleza y el confort se fusionan para ofrecerte una experiencia única.
              </p>
              <p className="text-muted-foreground font-display leading-relaxed mb-8">
                Todas nuestras habitaciones están diseñadas con materiales naturales y cuentan con vistas al lago o al jardín. Los huéspedes del hotel disfrutan de acceso prioritario a todas las actividades acuáticas del resort y descuentos exclusivos en nuestros restaurantes y SPA.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/presupuesto">
                  <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-7">
                    Consultar disponibilidad
                  </Button>
                </Link>
                <a href="tel:+34930347791">
                  <Button variant="outline" className="font-display font-semibold rounded-full px-7 border-primary/30 text-primary hover:bg-primary/5">
                    +34 930 34 77 91
                  </Button>
                </a>
              </div>
            </div>
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              <img src={CDN.lago} alt="Vistas al lago desde el hotel" className="w-full h-[420px] object-cover" />
            </div>
          </div>
        </div>
      </section>

      {/* Habitaciones */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-heading font-bold text-foreground mb-3">
              Nuestras <span className="text-accent">Habitaciones</span>
            </h2>
            <p className="text-muted-foreground font-display text-lg max-w-xl mx-auto">
              Desde habitaciones dobles hasta suites con vistas al lago. Todas incluyen desayuno y acceso al resort.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {habitaciones.map((hab, i) => (
              <div key={i} className="bg-card rounded-2xl p-6 shadow-md border border-border/40 hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-3">{hab.icono}</div>
                <h3 className="font-heading font-bold text-foreground text-lg mb-1">{hab.tipo}</h3>
                <p className="text-muted-foreground font-display text-sm mb-4">{hab.desc}</p>
                <div className="text-2xl font-heading font-bold text-accent mb-0.5">{hab.precio}</div>
                <div className="text-xs text-muted-foreground font-display">{hab.rango}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/presupuesto">
              <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-10 shadow-lg">
                Reservar Ahora <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary text-white">
        <div className="container text-center">
          <h2 className="text-3xl font-heading font-bold mb-3">¿Buscas una escapada especial?</h2>
          <p className="text-white/80 font-display text-lg mb-8 max-w-xl mx-auto">
            Combina tu estancia en el hotel con actividades acuáticas, cenas en nuestros restaurantes y sesiones de SPA para una experiencia completa.
          </p>
          <Link href="/packs">
            <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-10 shadow-lg">
              Ver Packs de Escapada <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Hotel() {
  const { data: blocks, isLoading } = trpc.public.getPublicPageBlocks.useQuery({ slug: "hotel" });

  const hasBlocks = !isLoading && blocks && blocks.length > 0;

  return (
    <PublicLayout>
      {isLoading ? (
        // Mientras carga, mostramos el contenido estático para evitar flash
        <StaticHotelContent />
      ) : hasBlocks ? (
        // Si hay bloques en el editor visual, los renderizamos
        <div>
          {(blocks as any[]).map(block => renderBlock(block))}
        </div>
      ) : (
        // Fallback: contenido estático original
        <StaticHotelContent />
      )}
    </PublicLayout>
  );
}
