import { Link } from "wouter";
import PublicLayout from "@/components/PublicLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Sun, GraduationCap, Building2, Check, Star, Layers } from "lucide-react";

const CATEGORIES = [
  {
    key: "dia",
    href: "/lego-packs/dia",
    icon: Sun,
    badge: "Reserva Online",
    badgeColor: "bg-orange-500 text-white",
    title: "Lego Packs de Día",
    subtitle: "Experiencias completas personalizadas para el lago",
    description:
      "Combina actividades acuáticas, acceso al club, almuerzo y extras a tu medida. Cada Lego Pack de Día es una experiencia completa diseñada para disfrutar en familia o con amigos.",
    highlights: [
      "Actividades acuáticas incluidas",
      "Desde 45€ por persona",
      "Reserva online inmediata",
      "Con y sin estancia",
    ],
    cta: "Ver Lego Packs de Día",
    gradient: "from-sky-600 to-blue-800",
    bgAccent: "bg-sky-50",
    borderAccent: "border-sky-200",
    textAccent: "text-sky-700",
    image:
      "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=800&q=80",
    featured: ["Day Pass Náyade", "Pack Aventura Completo", "Pack Adrenalina Total"],
  },
  {
    key: "escolar",
    href: "/lego-packs/escolar",
    icon: GraduationCap,
    badge: "Solicitar Presupuesto",
    badgeColor: "bg-emerald-600 text-white",
    title: "Lego Packs Escolares",
    subtitle: "Excursiones y viajes a medida para colegios",
    description:
      "Programas adaptados por edades con monitores titulados, protocolo de seguridad certificado y toda la documentación necesaria. Diseña el programa perfecto para tu centro educativo.",
    highlights: [
      "Programas escolares personalizados",
      "Desde 18€ por alumno",
      "Monitores titulados",
      "Excursiones y estancias",
    ],
    cta: "Ver Lego Packs Escolares",
    gradient: "from-emerald-600 to-teal-800",
    bgAccent: "bg-emerald-50",
    borderAccent: "border-emerald-200",
    textAccent: "text-emerald-700",
    image:
      "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80",
    featured: ["Excursión Activa", "Multiaventura Escolar", "Estancia Educativa"],
  },
  {
    key: "empresa",
    href: "/lego-packs/empresa",
    icon: Building2,
    badge: "A Medida",
    badgeColor: "bg-violet-600 text-white",
    title: "Lego Packs Empresas",
    subtitle: "Team building y eventos corporativos personalizados",
    description:
      "Diseña el evento corporativo perfecto combinando actividades acuáticas, catering premium y espacios para reuniones. Programas 100% a medida para hasta 200 personas.",
    highlights: [
      "Programas corporativos a medida",
      "Desde 55€ por persona",
      "100% personalizable",
      "Hasta 200 personas",
    ],
    cta: "Ver Lego Packs Empresas",
    gradient: "from-violet-600 to-purple-800",
    bgAccent: "bg-violet-50",
    borderAccent: "border-violet-200",
    textAccent: "text-violet-700",
    image:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
    featured: ["Team Building Básico", "Team Building Premium", "Evento Corporativo"],
  },
];

export default function LegoPacksHome() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white py-20 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <img
            src="https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=60"
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative container max-w-4xl text-center">
          <Badge className="mb-4 bg-indigo-500 text-white border-0 text-sm px-4 py-1">
            Temporada Abril – Octubre 2026
          </Badge>
          <div className="flex items-center justify-center gap-3 mb-4">
            <Layers className="w-10 h-10 text-indigo-400" />
            <h1 className="text-5xl font-black leading-tight">
              Lego{" "}
              <span className="text-indigo-400">Packs</span>
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-6">
            Experiencias compuestas y personalizables. Combina actividades, servicios y extras
            para crear la experiencia perfecta en el embalse de Los Ángeles de San Rafael.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-indigo-400" /> Composición modular
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-indigo-400" /> Precio transparente por línea
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-indigo-400" /> A medida o predefinido
            </span>
          </div>
        </div>
      </section>

      {/* 3 categorías */}
      <section className="py-16 bg-slate-50">
        <div className="container">
          <div className="grid gap-8 lg:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <div
                  key={cat.key}
                  className={`rounded-2xl border-2 ${cat.borderAccent} bg-white overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col`}
                >
                  {/* Imagen */}
                  <div className="relative aspect-[16/10] overflow-hidden">
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

      {/* ¿Qué es un Lego Pack? */}
      <section className="py-16 bg-white">
        <div className="container max-w-3xl text-center">
          <Layers className="w-12 h-12 mx-auto mb-4 text-indigo-500" />
          <h2 className="text-3xl font-black mb-4 text-slate-900">
            ¿Qué es un <span className="text-indigo-600">Lego Pack</span>?
          </h2>
          <p className="text-slate-600 text-lg leading-relaxed mb-6">
            Un Lego Pack es una experiencia compuesta por varias actividades y servicios que puedes
            combinar a tu medida. Como si fuera un juego de Lego, cada "pieza" es un servicio
            independiente (actividad acuática, almuerzo, SPA, alojamiento…) que juntas forman
            una experiencia completa y personalizada.
          </p>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-2xl font-black text-indigo-600 mb-1">Modular</p>
              <p className="text-sm text-slate-600">Cada línea es un servicio independiente</p>
            </div>
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-2xl font-black text-indigo-600 mb-1">Transparente</p>
              <p className="text-sm text-slate-600">Precio desglosado por cada componente</p>
            </div>
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-2xl font-black text-indigo-600 mb-1">Flexible</p>
              <p className="text-sm text-slate-600">Activa o desactiva líneas opcionales</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-14 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-center">
        <div className="container max-w-2xl">
          <Star className="w-10 h-10 mx-auto mb-4 text-indigo-200" />
          <h2 className="text-3xl font-black mb-3">
            ¿No sabes qué Lego Pack elegir?
          </h2>
          <p className="text-indigo-100 mb-6 text-lg">
            Cuéntanos qué buscas y te preparamos un presupuesto personalizado
            sin compromiso.
          </p>
          <Link href="/presupuesto">
            <Button
              size="lg"
              className="bg-white text-indigo-600 hover:bg-indigo-50 font-bold px-8"
            >
              Solicitar Presupuesto Personalizado
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
