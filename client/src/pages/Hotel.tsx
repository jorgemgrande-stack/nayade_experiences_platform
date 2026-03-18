import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Star, Wifi, Coffee, Car, Waves, Utensils, Dumbbell } from "lucide-react";

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

export default function Hotel() {
  return (
    <PublicLayout>
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
    </PublicLayout>
  );
}
