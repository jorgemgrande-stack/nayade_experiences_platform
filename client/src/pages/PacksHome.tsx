import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sun, GraduationCap, Building2, Check, Star } from "lucide-react";

const CATEGORIES = [
  {
    key: "dia",
    href: "/packs/dia",
    icon: Sun,
    badge: "Reserva Online",
    badgeColor: "bg-orange-500 text-white",
    title: "Packs de Día",
    subtitle: "Experiencias completas para disfrutar en el lago",
    description:
      "Desde el Day Pass más popular hasta el Pack Adrenalina más extremo. Todos incluyen actividades acuáticas, acceso al club y almuerzo. Compra online al instante.",
    highlights: [
      "6 packs disponibles",
      "Desde 45€ por persona",
      "Reserva online inmediata",
      "Con y sin estancia",
    ],
    cta: "Ver packs de día",
    gradient: "from-sky-600 to-blue-800",
    bgAccent: "bg-sky-50",
    borderAccent: "border-sky-200",
    textAccent: "text-sky-700",
    image:
      "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=800&q=80",
    featured: ["Day Pass Náyade", "Pack Aventura", "Pack Adrenalina"],
  },
  {
    key: "escolar",
    href: "/packs/escolar",
    icon: GraduationCap,
    badge: "Solicitar Presupuesto",
    badgeColor: "bg-emerald-600 text-white",
    title: "Packs Escolares",
    subtitle: "Excursiones y viajes para colegios e institutos",
    description:
      "Programas adaptados por edades con monitores titulados, protocolo de seguridad certificado y toda la documentación necesaria. Excursiones de día y viajes con estancia.",
    highlights: [
      "7 programas escolares",
      "Desde 18€ por alumno",
      "Monitores titulados",
      "Excursiones y estancias",
    ],
    cta: "Ver packs escolares",
    gradient: "from-emerald-600 to-teal-800",
    bgAccent: "bg-emerald-50",
    borderAccent: "border-emerald-200",
    textAccent: "text-emerald-700",
    image:
      "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80",
    featured: ["Pack Escolar Básico", "Pack Multiaventura", "Estancia Activa"],
  },
  {
    key: "empresa",
    href: "/packs/empresa",
    icon: Building2,
    badge: "A Medida",
    badgeColor: "bg-violet-600 text-white",
    title: "Packs Empresas",
    subtitle: "Team building y eventos corporativos en el lago",
    description:
      "Fortalece la cohesión de tu equipo en un entorno natural único. Gymkhanas acuáticas personalizadas, catering premium y espacio para reuniones. Programas 100% a medida.",
    highlights: [
      "2 programas corporativos",
      "Desde 55€ por persona",
      "100% personalizable",
      "Hasta 200 personas",
    ],
    cta: "Ver packs empresas",
    gradient: "from-violet-600 to-purple-800",
    bgAccent: "bg-violet-50",
    borderAccent: "border-violet-200",
    textAccent: "text-violet-700",
    image:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
    featured: ["Team Building Básico", "Team Building Premium"],
  },
];

export default function PacksHome() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <img
            src="https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=60"
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative container max-w-4xl text-center">
          <Badge className="mb-4 bg-orange-500 text-white border-0 text-sm px-4 py-1">
            Temporada Abril – Octubre 2026
          </Badge>
          <h1 className="text-5xl font-black mb-4 leading-tight">
            Nuestros{" "}
            <span className="text-orange-400">Packs</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-8">
            Experiencias completas diseñadas para cada tipo de cliente. Elige tu
            pack, reserva online y vívelo en el embalse de Los Ángeles de San
            Rafael.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-orange-400" /> Reserva online
              inmediata
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-orange-400" /> Cancelación
              gratuita 48h antes
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-orange-400" /> Material incluido
            </span>
          </div>
        </div>
      </section>

      {/* 3 categorías */}
      <section className="py-16 bg-slate-50">
        <div className="container max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <div
                  key={cat.key}
                  className={`rounded-2xl border-2 ${cat.borderAccent} bg-white overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col`}
                >
                  {/* Imagen */}
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={cat.image}
                      alt={cat.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div
                      className={`absolute inset-0 bg-gradient-to-t ${cat.gradient} opacity-60`}
                    />
                    <div className="absolute top-4 left-4">
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full ${cat.badgeColor}`}
                      >
                        {cat.badge}
                      </span>
                    </div>
                    <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white">
                      <Icon className="w-6 h-6" />
                      <span className="font-black text-xl">{cat.title}</span>
                    </div>
                  </div>

                  {/* Contenido */}
                  <div className="p-6 flex flex-col flex-1">
                    <p className={`text-sm font-semibold ${cat.textAccent} mb-2`}>
                      {cat.subtitle}
                    </p>
                    <p className="text-slate-600 text-sm leading-relaxed mb-4">
                      {cat.description}
                    </p>

                    {/* Highlights */}
                    <ul className="space-y-1.5 mb-4">
                      {cat.highlights.map((h) => (
                        <li key={h} className="flex items-center gap-2 text-sm text-slate-700">
                          <Check className={`w-4 h-4 flex-shrink-0 ${cat.textAccent}`} />
                          {h}
                        </li>
                      ))}
                    </ul>

                    {/* Packs destacados */}
                    <div className={`${cat.bgAccent} rounded-lg p-3 mb-5`}>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        Incluye
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {cat.featured.map((f) => (
                          <span
                            key={f}
                            className={`text-xs px-2 py-0.5 rounded-full border ${cat.borderAccent} ${cat.textAccent} font-medium`}
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-auto">
                      <Link href={cat.href}>
                        <Button
                          className={`w-full bg-gradient-to-r ${cat.gradient} text-white hover:opacity-90 font-bold`}
                        >
                          {cat.cta}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-14 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-center">
        <div className="container max-w-2xl">
          <Star className="w-10 h-10 mx-auto mb-4 text-orange-200" />
          <h2 className="text-3xl font-black mb-3">
            ¿No sabes qué pack elegir?
          </h2>
          <p className="text-orange-100 mb-6 text-lg">
            Cuéntanos qué buscas y te preparamos un presupuesto personalizado
            sin compromiso.
          </p>
          <Link href="/contacto">
            <Button
              size="lg"
              className="bg-white text-orange-600 hover:bg-orange-50 font-bold px-8"
            >
              Solicitar Presupuesto Personalizado
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
