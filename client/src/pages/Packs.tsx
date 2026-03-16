import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Users, Clock, Star, CheckCircle } from "lucide-react";

const CDN = {
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  cableski: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg",
  blob: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
};

const packs = [
  {
    slug: "dia",
    badge: "Más Popular",
    title: "Packs de Día",
    subtitle: "La experiencia completa en el lago",
    desc: "Combina las mejores actividades acuáticas con acceso al club, almuerzo y todo lo que necesitas para un día inolvidable en el embalse de Los Ángeles de San Rafael.",
    img: CDN.hero,
    price: "Desde 45€/persona",
    duration: "Día completo",
    group: "Mínimo 2 personas",
    items: ["Acceso al club y zona de playa", "2 actividades acuáticas a elegir", "Almuerzo en El Galeón o La Cabaña", "Material y chaleco incluidos", "Monitor especializado"],
    color: "from-blue-600 to-cyan-500",
  },
  {
    slug: "escolares",
    badge: "Educativo",
    title: "Packs Escolares",
    subtitle: "Aventura y aprendizaje para grupos escolares",
    desc: "Programas diseñados para colegios e institutos con actividades adaptadas por edades, monitores especializados y protocolos de seguridad certificados.",
    img: CDN.canoa,
    price: "Desde 18€/alumno",
    duration: "Media o jornada completa",
    group: "Grupos de 15 a 60 alumnos",
    items: ["Actividades adaptadas por edad", "Monitores titulados y seguros", "Protocolo de seguridad certificado", "Almuerzo opcional", "Transporte coordinable"],
    color: "from-green-600 to-emerald-500",
  },
  {
    slug: "corporativo",
    badge: "Team Building",
    title: "Team Building Empresas",
    subtitle: "Fortalece tu equipo en el lago",
    desc: "Programas de team building diseñados para empresas: gymkhanas acuáticas, retos en equipo, actividades de cohesión y espacios para reuniones o eventos corporativos.",
    img: CDN.blob,
    price: "Desde 55€/persona",
    duration: "Medio día o día completo",
    group: "Grupos de 10 a 200 personas",
    items: ["Gymkhana acuática personalizada", "Actividades de cohesión en equipo", "Catering y coffee break", "Espacio para reuniones o presentaciones", "Coordinador de evento exclusivo"],
    color: "from-orange-500 to-amber-400",
  },
];

export default function Packs() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[380px] overflow-hidden">
        <img src={CDN.hero} alt="Packs Náyade" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <div className="max-w-2xl text-white">
              <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
                Packs & Experiencias Completas
              </span>
              <h1 className="text-5xl md:text-6xl font-heading font-bold leading-tight mb-4">
                Packs para Cada Ocasión
              </h1>
              <p className="text-xl text-white/85 font-display">
                Días completos, grupos escolares y team building empresarial en el embalse de Los Ángeles de San Rafael.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pack cards */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-heading font-bold text-foreground mb-3">
              Elige tu <span className="text-accent">Pack Perfecto</span>
            </h2>
            <p className="text-muted-foreground font-display text-lg max-w-xl mx-auto">
              Todos nuestros packs incluyen material, monitores titulados y los mejores momentos en el lago.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {packs.map((pack) => (
              <div key={pack.slug} className="group rounded-2xl overflow-hidden shadow-lg border border-border/40 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 flex flex-col bg-card">
                <div className="relative h-52 overflow-hidden">
                  <img src={pack.img} alt={pack.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className={`absolute inset-0 bg-gradient-to-t ${pack.color} opacity-40`} />
                  <span className="absolute top-4 left-4 bg-white/90 text-primary text-xs font-display font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                    {pack.badge}
                  </span>
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="text-xl font-heading font-bold text-foreground mb-1">{pack.title}</h3>
                  <p className="text-accent font-display font-semibold text-sm mb-3">{pack.subtitle}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">{pack.desc}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground font-display mb-4">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-accent" />{pack.duration}</span>
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-accent" />{pack.group}</span>
                  </div>
                  <ul className="space-y-1.5 mb-6">
                    {pack.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground/80 font-display">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-lg font-heading font-bold text-foreground">{pack.price}</span>
                    <Link href={`/packs/${pack.slug}`}>
                      <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-5">
                        Ver Pack <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary text-white">
        <div className="container text-center">
          <h2 className="text-3xl font-heading font-bold mb-3">¿No encuentras lo que buscas?</h2>
          <p className="text-white/80 font-display text-lg mb-8 max-w-xl mx-auto">
            Diseñamos packs personalizados para grupos, eventos especiales y celebraciones. Cuéntanos qué necesitas.
          </p>
          <Link href="/presupuesto">
            <Button size="lg" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-10 shadow-lg">
              Solicitar Pack Personalizado <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
