import { useRef } from "react";
import { Navigation, Car, Train, Clock, MapPin, Phone, Mail } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { MapView } from "@/components/Map";

// Coordenadas exactas de Náyade Experiences / Skicenter Los Ángeles de San Rafael
const NAYADE_LOCATION = { lat: 40.8189, lng: -4.0047 };

export default function Locations() {
  const mapRef = useRef<google.maps.Map | null>(null);

  function handleMapReady(map: google.maps.Map) {
    mapRef.current = map;
    // Marcador con etiqueta personalizada
    new window.google.maps.marker.AdvancedMarkerElement({
      map,
      position: NAYADE_LOCATION,
      title: "Náyade Experiences · Skicenter",
    });
  }

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/start_245b3bb4.png"
          alt="Los Ángeles de San Rafael"
          className="w-full h-full object-cover object-center"
        />
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

      {/* Mapa interactivo */}
      <section className="py-12 bg-background">
        <div className="container">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-heading font-bold text-foreground mb-2">
              Encuéntranos en el <span className="text-accent">Embalse de Los Ángeles</span>
            </h2>
            <p className="text-muted-foreground font-display max-w-xl mx-auto">
              Carretera de Los Ángeles de San Rafael, Segovia. Aparcamiento gratuito en las instalaciones.
            </p>
          </div>
          <div className="rounded-2xl overflow-hidden border border-border/50 shadow-lg">
            <MapView
              initialCenter={NAYADE_LOCATION}
              initialZoom={14}
              onMapReady={handleMapReady}
              className="h-[480px]"
            />
          </div>
          {/* Botón Google Maps */}
          <div className="mt-4 flex justify-center">
            <a
              href="https://maps.google.com/?q=Skicenter+Los+Angeles+San+Rafael+Segovia"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-display font-semibold px-6 py-2.5 rounded-full transition-colors shadow-md shadow-accent/20"
            >
              <Navigation className="w-4 h-4" />
              Abrir en Google Maps
            </a>
          </div>
        </div>
      </section>

      {/* Cómo llegar */}
      <section className="py-14 bg-muted/30 border-t border-border/30">
        <div className="container">
          <h2 className="text-2xl font-heading font-bold text-foreground mb-8 text-center">
            Cómo Llegar
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {/* En coche */}
            <div className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                <Car className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground mb-2">En Coche</h3>
              <ul className="space-y-2 text-sm text-muted-foreground font-display">
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  Desde Madrid: A-6 dirección La Coruña, salida Guadarrama, N-603 hasta Los Ángeles de San Rafael. <strong className="text-foreground">~45 min</strong>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  Desde Segovia: N-603 dirección Madrid. <strong className="text-foreground">~30 min</strong>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  Aparcamiento gratuito en las instalaciones.
                </li>
              </ul>
            </div>

            {/* En tren */}
            <div className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                <Train className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground mb-2">En Tren + Bus</h3>
              <ul className="space-y-2 text-sm text-muted-foreground font-display">
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  Tren Cercanías C-8 Madrid-Cercedilla (45 min).
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  Bus desde Cercedilla hasta Los Ángeles de San Rafael (~20 min).
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  También bus directo desde Segovia.
                </li>
              </ul>
            </div>

            {/* Horarios */}
            <div className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground mb-2">Horarios</h3>
              <ul className="space-y-2 text-sm text-muted-foreground font-display">
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  <span><strong className="text-foreground">Temporada:</strong> Abril – Octubre 2026</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  <span><strong className="text-foreground">Deportes acuáticos:</strong> 10:00 – 20:00</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  <span><strong className="text-foreground">Restaurantes:</strong> 10:00 – 23:00</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent font-bold shrink-0">·</span>
                  <span><strong className="text-foreground">SPA & Hotel:</strong> Todo el año</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Contacto rápido */}
      <section className="py-12 bg-background border-t border-border/30">
        <div className="container">
          <div className="grid md:grid-cols-3 gap-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Dirección</h3>
              <p className="text-muted-foreground font-display text-sm">
                Carretera de Los Ángeles de San Rafael<br />
                Los Ángeles de San Rafael, Segovia
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Phone className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Teléfono</h3>
              <a href="tel:+34930347791" className="text-accent font-display font-semibold hover:underline">
                +34 930 34 77 91
              </a>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-bold text-foreground">Email</h3>
              <a href="mailto:reservas@nayadeexperiences.es" className="text-accent font-display font-semibold hover:underline text-sm">
                reservas@nayadeexperiences.es
              </a>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
