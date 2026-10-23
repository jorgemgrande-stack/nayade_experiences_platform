/**
 * «Ubicaciones» en la web de cada empresa: su texto de presentación (página «ubicaciones» del CMS, si la ha publicado)
 * y sus propios lugares de servicio (Productos → Lugares de servicio) con mapa y contacto. Nada de otra empresa: sin
 * página ni lugares, «no encontrada».
 */
import { Link, useParams } from "wouter";
import { MapPin, Navigation, Phone, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import PublicLayout from "@/components/PublicLayout";
import NotFound from "@/pages/NotFound";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { mapEmbedUrl, mapLinkUrl } from "@shared/locationMap";

type Location = {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  address?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

function LocationCard({ loc, detail }: { loc: Location; detail: boolean }) {
  const embed = mapEmbedUrl(loc);
  const link = mapLinkUrl(loc);
  return (
    <article className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
      {loc.imageUrl && <img src={loc.imageUrl} alt={loc.name} className="w-full h-56 object-cover" loading="lazy" />}
      <div className="p-6 space-y-3">
        <h2 className="text-2xl font-heading font-bold text-foreground">
          {detail ? loc.name : <Link href={`/ubicaciones/${loc.slug}`}>{loc.name}</Link>}
        </h2>
        {loc.address && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
            <span>{loc.address}</span>
          </p>
        )}
        {loc.description && <p className="text-muted-foreground whitespace-pre-line">{loc.description}</p>}
        {embed && (
          <div className="rounded-xl overflow-hidden border border-border/50">
            <iframe src={embed} width="100%" height={detail ? 420 : 260} style={{ border: 0, display: "block" }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title={`Mapa de ${loc.name}`} />
          </div>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-accent font-semibold hover:underline">
            <Navigation className="w-4 h-4" /> Cómo llegar
          </a>
        )}
      </div>
    </article>
  );
}

export default function TenantLocations() {
  const params = useParams<{ slug?: string }>();
  const locations = trpc.public.getLocations.useQuery(undefined, { retry: false });
  const intro = trpc.public.getTenantPage.useQuery({ slug: "ubicaciones" }, { retry: false });
  const contact = usePublicContact();

  if (locations.isLoading || intro.isLoading) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </PublicLayout>
    );
  }

  const all = (locations.data ?? []) as Location[];
  const selected = params.slug ? all.filter((l) => l.slug === params.slug) : all;
  if (params.slug && selected.length === 0) return <NotFound />;
  if (!params.slug && all.length === 0 && !intro.data) return <NotFound />;

  return (
    <PublicLayout>
      <div className="container py-12 space-y-10">
        {!params.slug &&
          (intro.data ? (
            <article className="prose max-w-3xl">
              {/* HTML saneado en servidor con lista blanca (server/_core/htmlSanitize.ts) */}
              <div dangerouslySetInnerHTML={{ __html: intro.data.html }} />
            </article>
          ) : (
            <h1 className="text-4xl font-heading font-bold text-foreground">Dónde estamos</h1>
          ))}
        {params.slug && (
          <Link href="/ubicaciones" className="text-sm text-muted-foreground hover:text-foreground">
            ← Todas las ubicaciones
          </Link>
        )}
        {selected.length > 0 && (
          <div className={selected.length > 1 ? "grid gap-6 md:grid-cols-2" : "max-w-4xl"}>
            {selected.map((l) => (
              <LocationCard key={l.id} loc={l} detail={!!params.slug} />
            ))}
          </div>
        )}
        {(contact.phoneTel || contact.email) && (
          <section className="flex flex-wrap gap-6 text-sm border-t border-border/40 pt-6">
            {contact.phoneTel && (
              <a href={contact.phoneTel} className="inline-flex items-center gap-2 text-accent font-semibold hover:underline">
                <Phone className="w-4 h-4" /> {contact.phone}
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 text-accent font-semibold hover:underline">
                <Mail className="w-4 h-4" /> {contact.email}
              </a>
            )}
          </section>
        )}
      </div>
    </PublicLayout>
  );
}
