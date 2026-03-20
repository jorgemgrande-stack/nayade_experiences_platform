import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Clock, Phone, Mail, MapPin } from "lucide-react";

const CDN = {
  lago: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/hotel-lago_f2ec080b.jpg",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  kayak: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  embalse: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
};

const RESTAURANTES: Record<string, {
  badge: string; nombre: string; tipo: string;
  heroImg: string; desc: string; horario: string; reserva: boolean;
  carta: { categoria: string; platos: { nombre: string; desc: string; precio: string }[] }[];
}> = {
  "el-galeon": {
    badge: "Vistas al lago",
    nombre: "El Galeón",
    tipo: "Cocina Tradicional & Parrilla",
    heroImg: CDN.lago,
    desc: "Nuestro restaurante principal con vistas panorámicas al embalse. Especializado en carnes a la parrilla, pescados frescos y cocina tradicional castellana. El lugar perfecto para celebrar ocasiones especiales con familia, amigos o empresa.",
    horario: "13:00–16:00 y 20:00–23:00 · Todos los días en temporada",
    reserva: true,
    carta: [
      {
        categoria: "Entrantes",
        platos: [
          { nombre: "Tabla de ibéricos", desc: "Jamón ibérico, chorizo y lomo con pan de hogaza", precio: "18€" },
          { nombre: "Ensalada de temporada", desc: "Verduras del huerto con vinagreta de mostaza", precio: "9€" },
          { nombre: "Croquetas caseras", desc: "De jamón ibérico o bacalao (6 unidades)", precio: "8€" },
        ],
      },
      {
        categoria: "Principales",
        platos: [
          { nombre: "Chuletón de buey", desc: "1 kg a la parrilla con patatas asadas y pimientos", precio: "38€" },
          { nombre: "Trucha del embalse", desc: "A la plancha con almendras y mantequilla", precio: "18€" },
          { nombre: "Cochinillo asado", desc: "Al horno de leña, crujiente y tierno", precio: "22€" },
        ],
      },
      {
        categoria: "Postres",
        platos: [
          { nombre: "Tarta de queso", desc: "Artesanal con mermelada de frutos rojos", precio: "6€" },
          { nombre: "Coulant de chocolate", desc: "Con helado de vainilla", precio: "7€" },
        ],
      },
    ],
  },
  "la-cabana-del-lago": {
    badge: "Junto al lago",
    nombre: "La Cabaña del Lago",
    tipo: "Cocina de Temporada & Entorno Natural",
    heroImg: CDN.embalse,
    desc: "Un espacio único integrado en la naturaleza, a orillas del lago. Cocina de proximidad, producto local y una atmósfera tranquila e íntima que convierte cada visita en una experiencia sensorial completa.",
    horario: "13:00–16:00 · 20:00–22:30 · Todos los días en temporada",
    reserva: true,
    carta: [
      {
        categoria: "Para comenzar",
        platos: [
          { nombre: "Sopa de trucha ahumada", desc: "Con crema de puerros y aceite de eneldo", precio: "11€" },
          { nombre: "Ensalada del huerto", desc: "Hortalizas de temporada, queso fresco local y vinagreta de miel", precio: "9€" },
          { nombre: "Hongos salteados", desc: "Con ajo, perejil y huevo de corral a baja temperatura", precio: "13€" },
        ],
      },
      {
        categoria: "Platos principales",
        platos: [
          { nombre: "Cordero lechal al horno", desc: "De producción local, con patatas panadera y romero", precio: "24€" },
          { nombre: "Trucha del embalse a la plancha", desc: "Con mantequilla de hierbas y verduras de temporada", precio: "19€" },
          { nombre: "Setas y vegetales de temporada", desc: "Plato vegetal de la semana según mercado", precio: "16€" },
        ],
      },
      {
        categoria: "Postres",
        platos: [
          { nombre: "Tarta de manzana casera", desc: "Con canela y helado de vainilla artesano", precio: "6€" },
          { nombre: "Queso local con miel de la sierra", desc: "Tabla de quesos artesanos de la comarca", precio: "9€" },
        ],
      },
    ],
  },
  "la-cabana": {
    badge: "Especialidad arroces",
    nombre: "Arrocería La Cabaña",
    tipo: "Arroces & Cocina Mediterránea",
    heroImg: CDN.canoa,
    desc: "Nuevo espacio especializado en arroces y cocina mediterránea de autor. Un ambiente íntimo y acogedor junto al lago, perfecto para disfrutar de una gastronomía cuidada con los mejores ingredientes de temporada.",
    horario: "13:00–16:30 · Viernes, sábados y domingos (temporada completa)",
    reserva: true,
    carta: [
      {
        categoria: "Para empezar",
        platos: [
          { nombre: "Gazpacho andaluz", desc: "Tradicional con guarnición de verduras", precio: "7€" },
          { nombre: "Boquerones en vinagre", desc: "Con aceite de oliva virgen extra y ajo", precio: "10€" },
          { nombre: "Pulpo a la gallega", desc: "Con pimentón de la Vera y aceite de oliva", precio: "16€" },
        ],
      },
      {
        categoria: "Arroces",
        platos: [
          { nombre: "Arroz con bogavante", desc: "El rey de nuestra carta. Bogavante fresco del día", precio: "32€/persona" },
          { nombre: "Paella valenciana", desc: "Pollo, conejo y verduras de temporada", precio: "18€/persona" },
          { nombre: "Arroz negro", desc: "Con sepia y alioli casero", precio: "20€/persona" },
        ],
      },
      {
        categoria: "Postres",
        platos: [
          { nombre: "Crema catalana", desc: "Receta tradicional con azúcar caramelizado", precio: "5€" },
          { nombre: "Tiramisú", desc: "Casero con café y amaretto", precio: "6€" },
        ],
      },
    ],
  },
  "nassau-bar": {
    badge: "Música en vivo",
    nombre: "Nassau Bar & Music",
    tipo: "Cócteles, Tapas & Música en Vivo",
    heroImg: CDN.kayak,
    desc: "El punto de encuentro del resort. Cócteles artesanales, tapas creativas y música en vivo los fines de semana. El lugar ideal para el aperitivo, el after-beach o simplemente disfrutar del atardecer sobre el lago.",
    horario: "11:00–02:00 · Fines de semana hasta 03:00 · Música en vivo viernes y sábados desde 21:00",
    reserva: false,
    carta: [
      {
        categoria: "Cócteles Signature",
        platos: [
          { nombre: "Nassau Sunset", desc: "Ron, mango, lima y jengibre. La firma de la casa", precio: "10€" },
          { nombre: "Lago Azul", desc: "Gin, curaçao azul, tónica y pepino", precio: "9€" },
          { nombre: "Mojito Náyade", desc: "Ron blanco, hierbabuena, lima y azúcar moreno", precio: "9€" },
        ],
      },
      {
        categoria: "Tapas & Raciones",
        platos: [
          { nombre: "Patatas bravas", desc: "Con salsa brava casera y alioli", precio: "6€" },
          { nombre: "Tabla de quesos", desc: "Selección de quesos artesanos con mermelada", precio: "14€" },
          { nombre: "Nachos con guacamole", desc: "Guacamole fresco y pico de gallo", precio: "8€" },
        ],
      },
    ],
  },
};

export default function RestauranteDetail() {
  const { slug } = useParams<{ slug: string }>();
  const r = RESTAURANTES[slug ?? ""];

  if (!r) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="text-3xl font-heading font-bold text-foreground mb-4">Restaurante no encontrado</h1>
          <p className="text-muted-foreground font-display mb-8">El restaurante que buscas no existe.</p>
          <Link href="/restaurantes">
            <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8">
              <ArrowLeft className="w-4 h-4 mr-2" /> Ver todos los restaurantes
            </Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[55vh] min-h-[400px] overflow-hidden">
        <img src={r.heroImg} alt={r.nombre} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/35 to-black/75" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <Link href="/restaurantes">
              <button className="flex items-center gap-1.5 text-white/80 hover:text-white font-display text-sm mb-6 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Todos los restaurantes
              </button>
            </Link>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full">
                {r.badge}
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-heading font-bold text-white leading-tight mb-3">
              {r.nombre}
            </h1>
            <p className="text-xl text-white/85 font-display">{r.tipo}</p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Carta */}
            <div className="lg:col-span-2 space-y-10">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Sobre nosotros</h2>
                <p className="text-muted-foreground font-display text-lg leading-relaxed">{r.desc}</p>
              </div>
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground mb-6">Nuestra Carta</h2>
                <div className="space-y-8">
                  {r.carta.map((seccion, i) => (
                    <div key={i}>
                      <h3 className="text-lg font-heading font-bold text-accent mb-4 pb-2 border-b border-border/40">
                        {seccion.categoria}
                      </h3>
                      <div className="space-y-4">
                        {seccion.platos.map((plato, j) => (
                          <div key={j} className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="font-display font-semibold text-foreground">{plato.nombre}</div>
                              <div className="text-sm text-muted-foreground font-display mt-0.5">{plato.desc}</div>
                            </div>
                            <div className="text-accent font-heading font-bold text-lg shrink-0">{plato.precio}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-display mt-6 italic">
                  * Carta sujeta a disponibilidad de producto de temporada. Precios con IVA incluido.
                </p>
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <div className="bg-card rounded-2xl shadow-lg border border-border/40 p-6 sticky top-24 space-y-5">
                <div>
                  <h3 className="font-heading font-bold text-foreground mb-2">Horario</h3>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground font-display">
                    <Clock className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <span>{r.horario}</span>
                  </div>
                </div>
                <div className="border-t border-border/40 pt-5">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground font-display mb-3">
                    <MapPin className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <span>Los Ángeles de San Rafael, Segovia</span>
                  </div>
                </div>
                {r.reserva && (
                  <Link href="/presupuesto">
                    <Button className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full py-3 text-base shadow-md mb-2">
                      Reservar Mesa <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}
                <a href="tel:+34930347791">
                  <Button variant="outline" className="w-full font-display font-semibold rounded-full py-3 text-base border-primary/30 text-primary hover:bg-primary/5">
                    <Phone className="w-4 h-4 mr-2" /> +34 930 34 77 91
                  </Button>
                </a>
                <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-accent font-display transition-colors pt-2">
                  <Mail className="w-4 h-4" /> reservas@nayadeexperiences.es
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
