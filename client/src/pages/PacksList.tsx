import { useParams, Link } from "wouter";
import { useState } from "react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Check,
  Clock,
  Users,
  Star,
  Bed,
  ShoppingCart,
  MessageCircle,
  Sun,
  GraduationCap,
  Building2,
} from "lucide-react";
import BookingModal from "@/components/BookingModal";

const CATEGORY_META: Record<string, {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  color: string;
  bg: string;
  border: string;
  text: string;
  image: string;
  breadcrumb: string;
}> = {
  dia: {
    title: "Packs de Día",
    subtitle: "Experiencias completas en el lago",
    description:
      "Combina actividades acuáticas, almuerzo y acceso al club en un solo pack. Reserva online al instante.",
    icon: Sun,
    gradient: "from-sky-600 to-blue-800",
    color: "sky",
    bg: "bg-sky-50",
    border: "border-sky-200",
    text: "text-sky-700",
    image: "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=70",
    breadcrumb: "Packs de Día",
  },
  escolar: {
    title: "Packs Escolares",
    subtitle: "Excursiones y viajes para colegios",
    description:
      "Programas adaptados por edades con monitores titulados y protocolo de seguridad certificado.",
    icon: GraduationCap,
    gradient: "from-emerald-600 to-teal-800",
    color: "emerald",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600&q=70",
    breadcrumb: "Packs Escolares",
  },
  empresa: {
    title: "Packs Empresas",
    subtitle: "Team building y eventos corporativos",
    description:
      "Gymkhanas acuáticas personalizadas, catering premium y espacio para reuniones. Hasta 200 personas.",
    icon: Building2,
    gradient: "from-violet-600 to-purple-800",
    color: "violet",
    bg: "bg-violet-50",
    border: "border-violet-200",
    text: "text-violet-700",
    image: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=70",
    breadcrumb: "Packs Empresas",
  },
};

export default function PacksList() {
  const { category } = useParams<{ category: string }>();
  const [bookingPack, setBookingPack] = useState<{ id: number; title: string; basePrice: string } | null>(null);

  const meta = CATEGORY_META[category ?? ""] ?? CATEGORY_META["dia"];
  const Icon = meta.icon;

  const { data: packs, isLoading } = trpc.packs.getByCategory.useQuery({
    category: (category as "dia" | "escolar" | "empresa") ?? "dia",
  });

  return (
    <PublicLayout>
      {/* Hero de categoría */}
      <section className="relative text-white py-16 overflow-hidden">
        <div className="absolute inset-0">
          <img src={meta.image} alt={meta.title} className="w-full h-full object-cover" />
          <div className={`absolute inset-0 bg-gradient-to-r ${meta.gradient} opacity-80`} />
        </div>
        <div className="relative container max-w-4xl">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-white/70 mb-6">
            <Link href="/" className="hover:text-white transition-colors">Inicio</Link>
            <span>/</span>
            <Link href="/packs" className="hover:text-white transition-colors">Packs</Link>
            <span>/</span>
            <span className="text-white font-medium">{meta.breadcrumb}</span>
          </nav>

          <div className="flex items-center gap-3 mb-3">
            <Icon className="w-8 h-8 text-white/80" />
            <h1 className="text-4xl font-black">{meta.title}</h1>
          </div>
          <p className="text-xl text-white/90 mb-2">{meta.subtitle}</p>
          <p className="text-white/70 max-w-xl">{meta.description}</p>
        </div>
      </section>

      {/* Listado de packs */}
      <section className="py-14 bg-slate-50">
        <div className="container max-w-6xl">
          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white rounded-2xl overflow-hidden border border-slate-200">
                  <Skeleton className="h-48 w-full" />
                  <div className="p-5 space-y-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-10 w-full mt-4" />
                  </div>
                </div>
              ))}
            </div>
          ) : !packs?.length ? (
            <div className="text-center py-20 text-slate-500">
              <p className="text-lg">No hay packs disponibles en esta categoría.</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {packs.map((pack) => {
                const includes = Array.isArray(pack.includes) ? pack.includes as string[] : [];
                return (
                  <div
                    key={pack.id}
                    className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col"
                  >
                    {/* Imagen */}
                    <div className="relative h-44 overflow-hidden bg-slate-100">
                      {pack.image1 ? (
                        <img
                          src={pack.image1}
                          alt={pack.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className={`w-full h-full bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
                          <Icon className="w-16 h-16 text-white/40" />
                        </div>
                      )}
                      {/* Badges */}
                      <div className="absolute top-3 left-3 flex flex-wrap gap-1">
                        {pack.badge && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white">
                            {pack.badge}
                          </span>
                        )}
                        {pack.hasStay && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white flex items-center gap-1">
                            <Bed className="w-3 h-3" /> Con estancia
                          </span>
                        )}
                        {pack.isFeatured && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-400 text-yellow-900 flex items-center gap-1">
                            <Star className="w-3 h-3" /> Destacado
                          </span>
                        )}
                      </div>
                      {/* Precio */}
                      <div className="absolute bottom-3 right-3 bg-white/95 rounded-lg px-3 py-1 shadow">
                        <span className="text-orange-600 font-black text-lg">
                          {parseFloat(pack.basePrice).toFixed(0)}€
                        </span>
                        <span className="text-slate-500 text-xs ml-1">
                          {pack.priceLabel?.includes("alumno") ? "/alumno" : "/persona"}
                        </span>
                      </div>
                    </div>

                    {/* Contenido */}
                    <div className="p-5 flex flex-col flex-1">
                      <h3 className="font-black text-slate-900 text-lg mb-1">{pack.title}</h3>
                      {pack.subtitle && (
                        <p className={`text-sm font-semibold ${meta.text} mb-2`}>{pack.subtitle}</p>
                      )}
                      <p className="text-slate-600 text-sm leading-relaxed mb-3 line-clamp-2">
                        {pack.shortDescription}
                      </p>

                      {/* Meta info */}
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-3">
                        {pack.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> {pack.duration}
                          </span>
                        )}
                        {pack.minPersons && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {pack.maxPersons ? `${pack.minPersons}–${pack.maxPersons} personas` : `Desde ${pack.minPersons} personas`}
                          </span>
                        )}
                      </div>

                      {/* Includes preview */}
                      {includes.length > 0 && (
                        <ul className="space-y-1 mb-4">
                          {includes.slice(0, 3).map((item: string) => (
                            <li key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                              <Check className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${meta.text}`} />
                              {item}
                            </li>
                          ))}
                          {includes.length > 3 && (
                            <li className="text-xs text-slate-400 pl-5">
                              +{includes.length - 3} más incluidos
                            </li>
                          )}
                        </ul>
                      )}

                      {/* CTAs */}
                      <div className="mt-auto space-y-2">
                        {pack.isOnlinePurchase ? (
                          <Button
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold"
                            onClick={() =>
                              setBookingPack({
                                id: pack.id,
                                title: pack.title,
                                basePrice: pack.basePrice,
                              })
                            }
                          >
                            <ShoppingCart className="w-4 h-4 mr-2" />
                            Reservar Ahora
                          </Button>
                        ) : (
                          <Link href="/contacto">
                            <Button className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold">
                              <MessageCircle className="w-4 h-4 mr-2" />
                              Solicitar Presupuesto
                            </Button>
                          </Link>
                        )}
                        <Link href={`/packs/${category}/${pack.slug}`}>
                          <Button variant="outline" className="w-full font-semibold">
                            Ver detalle
                            <ArrowRight className="w-4 h-4 ml-2" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* CTA final */}
      <section className="py-12 bg-white border-t border-slate-100 text-center">
        <div className="container max-w-xl">
          <h2 className="text-2xl font-black text-slate-900 mb-2">
            ¿Necesitas algo diferente?
          </h2>
          <p className="text-slate-600 mb-5">
            Diseñamos packs a medida para grupos y eventos especiales.
          </p>
          <Link href="/contacto">
            <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-8">
              Solicitar Presupuesto Personalizado
            </Button>
          </Link>
        </div>
      </section>

      {/* BookingModal para packs con compra online */}
      {bookingPack && (
        <BookingModal
          product={{
            id: bookingPack.id,
            title: bookingPack.title,
            basePrice: bookingPack.basePrice,
          }}
          isOpen={!!bookingPack}
          onClose={() => setBookingPack(null)}
        />
      )}
    </PublicLayout>
  );
}
