import { Link, useParams } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Users, Clock, CheckCircle, Phone, Mail } from "lucide-react";

const CDN = {
  hero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  cableski: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg",
  blob: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg",
  canoa: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  banana: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/banana-ski_43cb68d6.jpg",
};

const PACKS: Record<string, {
  badge: string; title: string; subtitle: string; heroImg: string;
  price: string; duration: string; group: string; desc: string;
  includes: string[]; schedule: string; note: string;
}> = {
  dia: {
    badge: "Más Popular",
    title: "Pack de Día Completo",
    subtitle: "La experiencia completa en el lago",
    heroImg: CDN.hero,
    price: "Desde 45€/persona",
    duration: "Día completo (10:00–20:00)",
    group: "Mínimo 2 personas",
    desc: "Vive un día completo en el embalse de Los Ángeles de San Rafael. Combina las mejores actividades acuáticas con acceso al club, almuerzo y todo lo que necesitas para una jornada inolvidable a solo 45 minutos de Madrid.",
    includes: [
      "Acceso al club y zona de playa del lago",
      "2 actividades acuáticas a elegir (Blob Jump, Banana Ski, Canoa, Paddle Surf…)",
      "Almuerzo en El Galeón o La Cabaña del Lago",
      "Material completo y chaleco de seguridad",
      "Monitor especializado durante las actividades",
      "Aparcamiento gratuito",
    ],
    schedule: "Disponible de lunes a domingo de abril a octubre. Reserva con 48h de antelación.",
    note: "Precio variable según actividades seleccionadas y número de personas. Consulta disponibilidad.",
  },
  "packs-dia": {
    badge: "Más Popular",
    title: "Pack de Día Completo",
    subtitle: "La experiencia completa en el lago",
    heroImg: CDN.hero,
    price: "Desde 45€/persona",
    duration: "Día completo (10:00–20:00)",
    group: "Mínimo 2 personas",
    desc: "Vive un día completo en el embalse de Los Ángeles de San Rafael. Combina las mejores actividades acuáticas con acceso al club, almuerzo y todo lo que necesitas para una jornada inolvidable a solo 45 minutos de Madrid.",
    includes: [
      "Acceso al club y zona de playa del lago",
      "2 actividades acuáticas a elegir (Blob Jump, Banana Ski, Canoa, Paddle Surf…)",
      "Almuerzo en El Galeón o La Cabaña del Lago",
      "Material completo y chaleco de seguridad",
      "Monitor especializado durante las actividades",
      "Aparcamiento gratuito",
    ],
    schedule: "Disponible de lunes a domingo de abril a octubre. Reserva con 48h de antelación.",
    note: "Precio variable según actividades seleccionadas y número de personas. Consulta disponibilidad.",
  },
  escolares: {
    badge: "Educativo",
    title: "Packs Escolares",
    subtitle: "Aventura y aprendizaje para grupos escolares",
    heroImg: CDN.canoa,
    price: "Desde 18€/alumno",
    duration: "Media jornada o jornada completa",
    group: "Grupos de 15 a 60 alumnos",
    desc: "Programas diseñados específicamente para colegios e institutos con actividades adaptadas por edades, monitores especializados y protocolos de seguridad certificados. Una experiencia educativa y divertida en plena naturaleza.",
    includes: [
      "Actividades acuáticas adaptadas por edad y nivel",
      "Monitores titulados con experiencia en grupos escolares",
      "Protocolo de seguridad certificado y seguros incluidos",
      "Almuerzo escolar opcional (menú adaptado)",
      "Transporte coordinable desde el centro escolar",
      "Informe de actividad para el centro",
    ],
    schedule: "Disponible de lunes a viernes en temporada escolar (septiembre–junio). Reserva con 2 semanas de antelación.",
    note: "Precios especiales para grupos de más de 40 alumnos. Solicita presupuesto personalizado.",
  },
  "packs-escolares": {
    badge: "Educativo",
    title: "Packs Escolares",
    subtitle: "Aventura y aprendizaje para grupos escolares",
    heroImg: CDN.canoa,
    price: "Desde 18€/alumno",
    duration: "Media jornada o jornada completa",
    group: "Grupos de 15 a 60 alumnos",
    desc: "Programas diseñados específicamente para colegios e institutos con actividades adaptadas por edades, monitores especializados y protocolos de seguridad certificados. Una experiencia educativa y divertida en plena naturaleza.",
    includes: [
      "Actividades acuáticas adaptadas por edad y nivel",
      "Monitores titulados con experiencia en grupos escolares",
      "Protocolo de seguridad certificado y seguros incluidos",
      "Almuerzo escolar opcional (menú adaptado)",
      "Transporte coordinable desde el centro escolar",
      "Informe de actividad para el centro",
    ],
    schedule: "Disponible de lunes a viernes en temporada escolar (septiembre–junio). Reserva con 2 semanas de antelación.",
    note: "Precios especiales para grupos de más de 40 alumnos. Solicita presupuesto personalizado.",
  },
  corporativo: {
    badge: "Team Building",
    title: "Team Building Empresas",
    subtitle: "Fortalece tu equipo en el lago",
    heroImg: CDN.blob,
    price: "Desde 55€/persona",
    duration: "Medio día o día completo",
    group: "Grupos de 10 a 200 personas",
    desc: "Programas de team building diseñados para empresas que quieren fortalecer la cohesión de sus equipos en un entorno natural único. Gymkhanas acuáticas, retos en equipo, actividades de cohesión y espacios para reuniones o eventos corporativos.",
    includes: [
      "Gymkhana acuática personalizada para tu empresa",
      "Actividades de cohesión y retos en equipo",
      "Catering y coffee break incluidos",
      "Espacio para reuniones o presentaciones",
      "Coordinador de evento exclusivo",
      "Fotografía y vídeo del evento (opcional)",
    ],
    schedule: "Disponible todo el año. Temporada alta: abril–octubre. Reserva con 1 semana de antelación.",
    note: "Programa 100% personalizable. Incluimos actividades indoor para días de lluvia.",
  },
  "team-building": {
    badge: "Team Building",
    title: "Team Building Empresas",
    subtitle: "Fortalece tu equipo en el lago",
    heroImg: CDN.blob,
    price: "Desde 55€/persona",
    duration: "Medio día o día completo",
    group: "Grupos de 10 a 200 personas",
    desc: "Programas de team building diseñados para empresas que quieren fortalecer la cohesión de sus equipos en un entorno natural único. Gymkhanas acuáticas, retos en equipo, actividades de cohesión y espacios para reuniones o eventos corporativos.",
    includes: [
      "Gymkhana acuática personalizada para tu empresa",
      "Actividades de cohesión y retos en equipo",
      "Catering y coffee break incluidos",
      "Espacio para reuniones o presentaciones",
      "Coordinador de evento exclusivo",
      "Fotografía y vídeo del evento (opcional)",
    ],
    schedule: "Disponible todo el año. Temporada alta: abril–octubre. Reserva con 1 semana de antelación.",
    note: "Programa 100% personalizable. Incluimos actividades indoor para días de lluvia.",
  },
};

export default function PackDetail() {
  const { slug } = useParams<{ slug: string }>();
  const pack = PACKS[slug ?? ""];

  if (!pack) {
    return (
      <PublicLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="text-3xl font-heading font-bold text-foreground mb-4">Pack no encontrado</h1>
          <p className="text-muted-foreground font-display mb-8">El pack que buscas no existe o ha sido retirado.</p>
          <Link href="/packs">
            <Button className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-8">
              <ArrowLeft className="w-4 h-4 mr-2" /> Ver todos los packs
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
        <img src={pack.heroImg} alt={pack.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/75" />
        <div className="absolute inset-0 flex items-center">
          <div className="container">
            <Link href="/packs">
              <button className="flex items-center gap-1.5 text-white/80 hover:text-white font-display text-sm mb-6 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Todos los packs
              </button>
            </Link>
            <span className="inline-block bg-accent/90 text-white text-xs font-display font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4">
              {pack.badge}
            </span>
            <h1 className="text-5xl md:text-6xl font-heading font-bold text-white leading-tight mb-3">
              {pack.title}
            </h1>
            <p className="text-xl text-white/85 font-display">{pack.subtitle}</p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-20 bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-8">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground mb-4">Descripción</h2>
                <p className="text-muted-foreground font-display text-lg leading-relaxed">{pack.desc}</p>
              </div>
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground mb-4">¿Qué incluye?</h2>
                <ul className="space-y-3">
                  {pack.includes.map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-foreground/85 font-display">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/50 rounded-2xl p-6 border border-border/40">
                <h3 className="font-heading font-bold text-foreground mb-2">Horarios y disponibilidad</h3>
                <p className="text-muted-foreground font-display text-sm">{pack.schedule}</p>
                <p className="text-muted-foreground font-display text-sm mt-2 italic">{pack.note}</p>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <div className="bg-card rounded-2xl shadow-lg border border-border/40 p-6 sticky top-24">
                <div className="text-3xl font-heading font-bold text-foreground mb-1">{pack.price}</div>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground font-display mb-6">
                  <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-accent" />{pack.duration}</span>
                  <span className="flex items-center gap-2"><Users className="w-4 h-4 text-accent" />{pack.group}</span>
                </div>
                <Link href="/presupuesto">
                  <Button className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full py-3 text-base shadow-md mb-3">
                    Solicitar Presupuesto <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <a href="tel:+34919041947">
                  <Button variant="outline" className="w-full font-display font-semibold rounded-full py-3 text-base border-primary/30 text-primary hover:bg-primary/5">
                    <Phone className="w-4 h-4 mr-2" /> +34 919 041 947
                  </Button>
                </a>
                <div className="mt-4 pt-4 border-t border-border/40 text-center">
                  <a href="mailto:hola@nayadeexperiences.es" className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-accent font-display transition-colors">
                    <Mail className="w-4 h-4" /> hola@nayadeexperiences.es
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
