import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ChevronRight, Home } from "lucide-react";

// ─── Block Renderers ──────────────────────────────────────────────────────────
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
            <Button size="lg" className="bg-[#F97316] hover:bg-[#EA6C0A] text-white px-8">
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
              <Button className="bg-[#F97316] hover:bg-[#EA6C0A] text-white mt-2">
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
    orange: "bg-[#F97316]",
    blue: "bg-[#1E3A5F]",
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
  return <div style={{ height: `${data.height as number || 40}px` }} />;
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DynamicPage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: page, isLoading: pageLoading } = trpc.public.getPublicPage.useQuery(
    { slug: slug! },
    { enabled: !!slug }
  );

  const { data: blocks, isLoading: blocksLoading } = trpc.public.getPublicPageBlocks.useQuery(
    { slug: slug! },
    { enabled: !!slug }
  );

  if (pageLoading || blocksLoading) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </PublicLayout>
    );
  }

  if (!page) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-6">
          <h1 className="text-4xl font-bold">404</h1>
          <p className="text-muted-foreground">Esta página no existe o ha sido eliminada.</p>
          <Link href="/">
            <Button><Home size={16} className="mr-2" />Volver al inicio</Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  const hasBlocks = blocks && blocks.length > 0;

  return (
    <PublicLayout>
      {/* Breadcrumb */}
      <div className="bg-slate-50 border-b border-border px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Inicio</Link>
          <ChevronRight size={14} />
          <span className="text-foreground font-medium">{page.title}</span>
        </div>
      </div>

      {/* Blocks */}
      {hasBlocks ? (
        <div>
          {blocks.map(block => renderBlock(block as any))}
        </div>
      ) : (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-6 py-20">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-2">
            <Home size={24} className="text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <p className="text-muted-foreground max-w-md">Esta página está en construcción. Vuelve pronto.</p>
          <Link href="/">
            <Button variant="outline"><Home size={16} className="mr-2" />Volver al inicio</Button>
          </Link>
        </div>
      )}
    </PublicLayout>
  );
}
