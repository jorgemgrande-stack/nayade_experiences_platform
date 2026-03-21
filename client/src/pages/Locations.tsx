import { Link } from "wouter";
import { ChevronRight, MapPin, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";

const staticLocations = [
  { id: 1, slug: "pirineos", name: "Pirineos", description: "El paraíso del esquí y la nieve en España. Pistas para todos los niveles con vistas espectaculares.", imageUrl: "https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&q=80", experienceCount: 8, region: "Aragón / Cataluña" },
  { id: 2, slug: "costa-brava", name: "Costa Brava", description: "Calas de aguas cristalinas perfectas para el kayak, buceo y deportes acuáticos.", imageUrl: "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&q=80", experienceCount: 6, region: "Cataluña" },
  { id: 3, slug: "sierra-guadarrama", name: "Sierra de Guadarrama", description: "Montañas accesibles desde Madrid ideales para escalada, senderismo y multiaventura.", imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80", experienceCount: 7, region: "Madrid / Segovia" },
  { id: 4, slug: "sierra-nevada", name: "Sierra Nevada", description: "La estación de esquí más meridional de Europa con experiencias únicas todo el año.", imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", experienceCount: 5, region: "Andalucía" },
  { id: 5, slug: "picos-europa", name: "Picos de Europa", description: "Parque Nacional de impresionante belleza para los amantes de la naturaleza y la aventura.", imageUrl: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80", experienceCount: 4, region: "Asturias / Cantabria" },
  { id: 6, slug: "costa-vasca", name: "Costa Vasca", description: "Olas legendarias y paisajes dramáticos para el surf y los deportes de mar.", imageUrl: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&q=80", experienceCount: 3, region: "País Vasco" },
];

export default function Locations() {
  const { data: dbLocations } = trpc.public.getLocations.useQuery();
  const locations = dbLocations?.length ? dbLocations : staticLocations;

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/5f23cf10-be16-424a-a48f-031f5b74e35f_843d3fb3.png" alt="Ubicación Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Cómo Llegar
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Nuestra Ubicación
              </h1>
              <p className="text-xl text-white/85 font-display">
                Los Ángeles de San Rafael, Segovia · A solo 45 minutos de Madrid.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Map Placeholder */}
      <section className="bg-muted/30 py-8">
        <div className="container">
          <div className="rounded-2xl overflow-hidden border border-border/50 bg-muted h-64 flex items-center justify-center">
            <div className="text-center">
              <MapPin className="w-10 h-10 text-accent mx-auto mb-2" />
              <p className="text-muted-foreground font-medium">Mapa interactivo de destinos</p>
              <p className="text-sm text-muted-foreground">Próximamente disponible</p>
            </div>
          </div>
        </div>
      </section>

      {/* Locations Grid */}
      <section className="py-16">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(locations as typeof staticLocations).map((loc) => (
              <Link key={loc.id} href={`/ubicaciones/${loc.slug}`}>
                <div className="group bg-card rounded-2xl overflow-hidden border border-border/50 card-hover cursor-pointer">
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <img
                      src={loc.imageUrl ?? "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80"}
                      alt={loc.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 overlay-dark" />
                    <div className="absolute bottom-4 left-4">
                      <h3 className="font-display font-bold text-xl text-white">{loc.name}</h3>
                      {loc.region && (
                        <div className="flex items-center gap-1 text-white/70 text-sm mt-1">
                          <MapPin className="w-3 h-3" />
                          {loc.region}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-5">
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{loc.description}</p>
                    <div className="flex items-center justify-between">
                      <Badge className="bg-accent/10 text-accent border-accent/20 text-xs">
                        {loc.experienceCount ?? "?"} experiencias
                      </Badge>
                      <Button size="sm" variant="ghost" className="text-accent hover:text-accent hover:bg-accent/10 p-0 h-auto">
                        Ver destino
                        <ArrowRight className="ml-1 w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
