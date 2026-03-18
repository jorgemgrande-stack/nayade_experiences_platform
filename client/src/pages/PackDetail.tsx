import { useParams, Link } from "wouter";
import { useState } from "react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import BookingModal from "@/components/BookingModal";
import {
  Check, X, Clock, Users, Star, Bed, ShoppingCart,
  MessageCircle, Phone, Calendar, Info, ArrowRight,
  Sun, GraduationCap, Building2,
} from "lucide-react";

const CATEGORY_META: Record<string, {
  label: string; href: string; gradient: string;
  text: string; bg: string; border: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  dia: {
    label: "Packs de Día", href: "/packs/dia",
    gradient: "from-sky-600 to-blue-800",
    text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200",
    icon: Sun,
  },
  escolar: {
    label: "Packs Escolares", href: "/packs/escolar",
    gradient: "from-emerald-600 to-teal-800",
    text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
    icon: GraduationCap,
  },
  empresa: {
    label: "Packs Empresas", href: "/packs/empresa",
    gradient: "from-violet-600 to-purple-800",
    text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200",
    icon: Building2,
  },
};

export default function PackDetail() {
  const { category, slug } = useParams<{ category: string; slug: string }>();
  const [people, setPeople] = useState(1);
  const [bookingOpen, setBookingOpen] = useState(false);

  const { data: pack, isLoading } = trpc.packs.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: !!slug }
  );

  const catKey = category ?? pack?.category ?? "dia";
  const meta = CATEGORY_META[catKey] ?? CATEGORY_META["dia"];
  const Icon = meta.icon;

  const includes = Array.isArray(pack?.includes) ? (pack!.includes as string[]) : [];
  const excludes = Array.isArray(pack?.excludes) ? (pack!.excludes as string[]) : [];
  const crossSells: any[] = (pack as any)?.crossSells ?? [];

  const basePrice = pack ? parseFloat(pack.basePrice) : 0;
  const totalEstimado = basePrice * people;

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="container max-w-6xl py-12 grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div><Skeleton className="h-80 w-full rounded-2xl" /></div>
        </div>
      </PublicLayout>
    );
  }

  if (!pack) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center text-slate-500">
          <p className="text-lg">Pack no encontrado.</p>
          <Link href="/packs">
            <Button className="mt-4">Volver a Packs</Button>
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative text-white overflow-hidden">
        <div className="absolute inset-0 h-72">
          {pack.image1 ? (
            <img src={pack.image1} alt={pack.title} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${meta.gradient}`} />
          )}
          <div className={`absolute inset-0 bg-gradient-to-r ${meta.gradient} opacity-75`} />
        </div>
        <div className="relative container max-w-6xl pt-8 pb-36">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-white/70 mb-6 flex-wrap">
            <Link href="/" className="hover:text-white transition-colors">Inicio</Link>
            <span>/</span>
            <Link href="/packs" className="hover:text-white transition-colors">Packs</Link>
            <span>/</span>
            <Link href={meta.href} className="hover:text-white transition-colors">{meta.label}</Link>
            <span>/</span>
            <span className="text-white font-medium">{pack.title}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {pack.badge && <Badge className="bg-orange-500 text-white border-0">{pack.badge}</Badge>}
            {pack.hasStay && (
              <Badge className="bg-blue-600 text-white border-0 flex items-center gap-1">
                <Bed className="w-3 h-3" /> Con estancia
              </Badge>
            )}
            {pack.isFeatured && (
              <Badge className="bg-yellow-400 text-yellow-900 border-0 flex items-center gap-1">
                <Star className="w-3 h-3" /> Destacado
              </Badge>
            )}
          </div>
          <h1 className="text-4xl lg:text-5xl font-black mb-2">{pack.title}</h1>
          {pack.subtitle && <p className="text-xl text-white/90">{pack.subtitle}</p>}
        </div>
      </section>

      {/* Contenido principal */}
      <section className="relative -mt-20 pb-16">
        <div className="container max-w-6xl grid lg:grid-cols-3 gap-8 items-start">
          {/* Columna izquierda */}
          <div className="lg:col-span-2 space-y-6">
            {/* Descripción */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-xl font-black text-slate-900 mb-3">Descripción</h2>
              <p className="text-slate-600 leading-relaxed">{pack.description || pack.shortDescription}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-slate-100">
                {pack.duration && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Clock className={`w-4 h-4 ${meta.text}`} />
                    <span>{pack.duration}</span>
                  </div>
                )}
                {pack.minPersons && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className={`w-4 h-4 ${meta.text}`} />
                    <span>
                      {pack.maxPersons
                        ? `${pack.minPersons}–${pack.maxPersons} personas`
                        : `Mín. ${pack.minPersons} personas`}
                    </span>
                  </div>
                )}
                {pack.targetAudience && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Star className={`w-4 h-4 ${meta.text}`} />
                    <span>{pack.targetAudience}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Incluye / No incluye */}
            <div className="grid sm:grid-cols-2 gap-4">
              {includes.length > 0 && (
                <div className={`${meta.bg} border ${meta.border} rounded-2xl p-5`}>
                  <h3 className="font-black text-slate-900 mb-3 flex items-center gap-2">
                    <Check className={`w-5 h-5 ${meta.text}`} /> Qué incluye
                  </h3>
                  <ul className="space-y-2">
                    {includes.map((item: string) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                        <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${meta.text}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {excludes.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                  <h3 className="font-black text-slate-900 mb-3 flex items-center gap-2">
                    <X className="w-5 h-5 text-slate-400" /> No incluye
                  </h3>
                  <ul className="space-y-2">
                    {excludes.map((item: string) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-slate-500">
                        <X className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />{item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Horarios */}
            {pack.schedule && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-black text-slate-900 mb-2 flex items-center gap-2">
                  <Calendar className={`w-5 h-5 ${meta.text}`} /> Disponibilidad y horarios
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed">{pack.schedule}</p>
              </div>
            )}

            {/* Nota */}
            {pack.note && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-amber-800 text-sm">{pack.note}</p>
              </div>
            )}
          </div>

          {/* Widget de precio */}
          <div className="sticky top-28">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6">
              <div className="mb-5">
                <p className="text-sm text-slate-500 mb-1">
                  {pack.priceLabel || "Precio por persona desde"}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-slate-900">{basePrice.toFixed(0)}€</span>
                  <span className="text-slate-500 text-sm">
                    {pack.priceLabel?.includes("alumno") ? "/alumno" : "/persona"}
                  </span>
                </div>
              </div>

              {pack.isOnlinePurchase && (
                <div className="mb-4">
                  <label className="text-sm font-semibold text-slate-700 block mb-2">
                    Número de personas
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPeople(Math.max(pack.minPersons ?? 1, people - 1))}
                      className="w-9 h-9 rounded-full border border-slate-300 flex items-center justify-center text-lg font-bold hover:bg-slate-100 transition-colors"
                    >−</button>
                    <span className="text-xl font-black w-8 text-center">{people}</span>
                    <button
                      onClick={() => setPeople(pack.maxPersons ? Math.min(pack.maxPersons, people + 1) : people + 1)}
                      className="w-9 h-9 rounded-full border border-slate-300 flex items-center justify-center text-lg font-bold hover:bg-slate-100 transition-colors"
                    >+</button>
                  </div>
                </div>
              )}

              {pack.isOnlinePurchase && (
                <div className="bg-slate-50 rounded-xl p-3 mb-5 text-sm">
                  <div className="flex justify-between text-slate-600 mb-1">
                    <span>{basePrice.toFixed(0)}€ × {people} personas</span>
                    <span>{totalEstimado.toFixed(0)}€</span>
                  </div>
                  <div className="flex justify-between font-black text-slate-900 text-base border-t border-slate-200 pt-2 mt-2">
                    <span>Total estimado</span>
                    <span className="text-orange-600">{totalEstimado.toFixed(0)}€</span>
                  </div>
                </div>
              )}

              {pack.isOnlinePurchase ? (
                <Button
                  size="lg"
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base mb-3"
                  onClick={() => setBookingOpen(true)}
                >
                  <ShoppingCart className="w-5 h-5 mr-2" /> Reservar Ahora →
                </Button>
              ) : null}

              <Link href="/contacto">
                <Button variant="outline" size="lg" className="w-full font-semibold mb-4">
                  <MessageCircle className="w-4 h-4 mr-2" /> Solicitar Presupuesto
                </Button>
              </Link>

              <div className="border-t border-slate-100 pt-4 space-y-2">
                <a href="tel:+34919041947" className="flex items-center gap-2 text-sm text-slate-600 hover:text-orange-600 transition-colors">
                  <Phone className="w-4 h-4" /> +34 919 041 947
                </a>
                <p className="text-xs text-slate-400">Cancelación gratuita hasta 48h antes</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Cross-selling */}
      {crossSells.length > 0 && (
        <section className="py-12 bg-slate-50 border-t border-slate-100">
          <div className="container max-w-6xl">
            <h2 className="text-2xl font-black text-slate-900 mb-6">También te puede interesar</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {crossSells.map((related: any) => (
                <Link key={related.id} href={`/packs/${related.category}/${related.slug}`}>
                  <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all group flex items-center gap-4">
                    {related.image1 ? (
                      <img src={related.image1} alt={related.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-16 h-16 rounded-lg bg-gradient-to-br ${meta.gradient} flex-shrink-0`} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{related.title}</p>
                      <p className="text-orange-600 font-black text-sm">{parseFloat(related.basePrice).toFixed(0)}€</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-orange-500 transition-colors flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {bookingOpen && (
        <BookingModal
          product={{
            id: pack.id,
            title: pack.title,
            basePrice: pack.basePrice,
            minPersons: pack.minPersons ?? 1,
            maxPersons: pack.maxPersons ?? undefined,
          }}
          isOpen={bookingOpen}
          onClose={() => setBookingOpen(false)}
        />
      )}
    </PublicLayout>
  );
}
