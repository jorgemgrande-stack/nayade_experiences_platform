import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Waves, MapPin, Star, Clock, Users, ChevronRight, ChevronLeft,
  ArrowRight, Phone, Mail, Anchor, Wind, Zap, Heart, Shield, Calendar,
  Send, Sparkles, Plus, X, CheckCircle, Minus, ShoppingCart as ShoppingCartIcon
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import PublicLayout from "@/components/PublicLayout";
import AddToCartModal from "@/components/AddToCartModal";
import { DiscountRibbon } from "@/components/DiscountRibbon";
import HotelSearchBar, { type HotelSearchParams } from "@/components/HotelSearchBar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// ─── Tipos para multi-actividad ───────────────────────────────────────────────
interface HeroActivityEntry {
  experienceId: number;
  experienceTitle: string;
  family: string;
  participants: number;
  details: Record<string, string | number>;
}
interface HeroModalState {
  open: boolean;
  experienceId: number;
  experienceTitle: string;
  family: string;
  slug: string;
}
// Mapeo slug → familia de preguntas
const HERO_FAMILY_MAP: Record<string, string> = {
  "blob-jump": "saltos",
  "banana-ski": "remolcado",
  "cableski": "cableski",
  "canoas": "alquiler",
  "paddle-surf": "alquiler",
  "hidrobicis": "alquiler",
  "minimotos": "alquiler",
  "paseos-barco": "barco",
  "aventura-hinchable": "alquiler",
  "circuito-spa": "spa",
  "donuts-ski": "remolcado",
};
function getHeroFamilyForSlug(slug: string): string {
  for (const [key, fam] of Object.entries(HERO_FAMILY_MAP)) {
    if (slug.includes(key)) return fam;
  }
  return "generico";
}

// CDN images
const CDN = {
  hero1:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg",
  hero2:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg",
  hero3:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg",
  hotel:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/d049863d-3421-411f-a64f-64eb34408da9_145ab8b4.png",
  canoa:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg",
  blob:       "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg",
  banana:     "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/banana-ski_43cb68d6.jpg",
  paddle:     "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/paddle-surf_78ab1b6f.jpg",
  spa1:       "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa4_0e502ffb.png",
  spa2:       "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa2_f1c857bc.png",
  wakeboard:  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/wakeboard_b574701d.jpg",
  hinchable:  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/aventura_hinchable_7c004251.png",
  kayak2:     "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/31bc24b6-13c3-4ea1-a67f-16a927473c61_d7582ff1.png",
  tubing:     "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/060194d5-9574-409c-b5a1-a367eb93bc7f_49e240ae.png",
  barco:      "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/28d8f7b8-1454-4060-b6de-0a399da63a69_4e751661.png",
  panoramica: "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/5f23cf10-be16-424a-a48f-031f5b74e35f_843d3fb3.png",
  cableski2:  "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/Cableski_ce1b5e0c.png",
};

const heroSlides: Array<{ img: string; badge: string; title: string; subtitle: string; desc: string; cta: string; ctaLink: string; reserveUrl: string }> = [
  { img: CDN.hero1, badge: "Temporada Abril — Octubre 2026", title: "El Lago te Espera", subtitle: "A solo 45 minutos de Madrid", desc: "Deportes acuáticos, hotel premium y gastronomía en el embalse de Los Ángeles de San Rafael, Segovia.", cta: "Explorar Experiencias", ctaLink: "/experiencias", reserveUrl: "" },
  { img: CDN.hero2, badge: "Actividad Estrella", title: "Cableski & Wakeboard", subtitle: "Para todos los niveles", desc: "Practica wakeboard y esquí acuático en nuestro sistema de cable aéreo. Material y chaleco incluidos.", cta: "Reservar Ahora", ctaLink: "/experiencias/cableski-wakeboard", reserveUrl: "/experiencias/cableski-wakeboard" },
  { img: CDN.hero3, badge: "Grupos y Familias", title: "Aventura en Grupo", subtitle: "Canoas, Kayaks y más", desc: "Rutas guiadas por el embalse, actividades para todas las edades y packs personalizados para grupos.", cta: "Ver Packs", ctaLink: "/lego-packs", reserveUrl: "" },
];

const actividades = [
  { icon: "🚤", name: "Banana Ski", desc: "La más divertida para grupos", price: "15€/plaza", img: CDN.banana, slug: "banana-ski-donuts", badge: "Más Popular" },
  { icon: "🏄", name: "Cableski", desc: "Wakeboard sin embarcación", price: "35€ media jornada", img: CDN.hero2, slug: "cableski-wakeboard", badge: "Actividad Estrella" },
  { icon: "💥", name: "Blob Jump", desc: "Adrenalina pura en el lago", price: "6,50€/salto", img: CDN.blob, slug: "blob-jump", badge: "" },
  { icon: "🛶", name: "Canoas & Kayaks", desc: "Ruta guiada por el embalse", price: "25€/hora", img: CDN.canoa, slug: "canoas-kayaks", badge: "" },
  { icon: "🏄‍♀️", name: "Paddle Surf", desc: "Equilibrio sobre el agua", price: "20€/hora", img: CDN.paddle, slug: "paddle-surf", badge: "" },
  { icon: "🚢", name: "Paseos en Barco", desc: "Descubre el embalse", price: "Desde 110€/hora", img: CDN.hero1, slug: "paseos-barco", badge: "Premium" },
];

const habitaciones = [
  { tipo: "Doble Estándar", precio: "130€", rango: "110€ – 150€ / noche", iconSvg: "bed", desc: "Confort y vistas al entorno natural" },
  { tipo: "Doble Superior / Vistas Lago", precio: "160€", rango: "140€ – 180€ / noche", iconSvg: "waves", desc: "Vistas directas al embalse" },
  { tipo: "Familiar (3-4 personas)", precio: "195€", rango: "170€ – 220€ / noche", iconSvg: "users", desc: "Espacio para toda la familia" },
  { tipo: "Junior Suite Premium", precio: "235€", rango: "210€ – 260€ / noche", iconSvg: "star", desc: "Máximo confort y exclusividad" },
];

const razones = [
  { icon: <MapPin className="w-6 h-6" />, titulo: "A 45 min de Madrid", desc: "Acceso directo por la AP-6" },
  { icon: <Waves className="w-6 h-6" />, titulo: "+10 Actividades", desc: "El mayor catálogo acuático de la Sierra" },
  { icon: <Heart className="w-6 h-6" />, titulo: "Hotel + SPA + Lago", desc: "Todo en un mismo enclave" },
  { icon: <Wind className="w-6 h-6" />, titulo: "Entorno Natural Único", desc: "Sierra de Guadarrama a 1.200m" },
  { icon: <Users className="w-6 h-6" />, titulo: "Para Todos", desc: "Familias, parejas, grupos y empresas" },
  { icon: <Shield className="w-6 h-6" />, titulo: "Monitores Certificados", desc: "Seguridad y profesionalidad" },
  { icon: <Calendar className="w-6 h-6" />, titulo: "Reserva Online 24h", desc: "Descuento del 10% online" },
  { icon: <Zap className="w-6 h-6" />, titulo: "Packs Personalizados", desc: "A medida para cada grupo" },
];

const testimonios = [
  { texto: "Una experiencia increíble para toda la familia. Los niños no paraban de hablar del Blob Jump durante semanas. El hotel es precioso y el personal muy atento.", autor: "María G.", tipo: "Familia · Madrid", stars: 5 },
  { texto: "Organizamos el team building de empresa aquí y fue un éxito total. Las actividades de cableski y la gymkhana acuática superaron todas las expectativas del equipo.", autor: "Carlos M.", tipo: "Empresa · Barcelona", stars: 5 },
  { texto: "El fin de semana romántico fue perfecto. Actividades de día, spa por la tarde y cena con vistas al lago. No podíamos pedir más. Volveremos sin duda.", autor: "Laura & Javi", tipo: "Pareja · Segovia", stars: 5 },
];

// ─── Colores de chip por familia (hero modal) ───────────────────────────────
const HERO_CHIP_COLORS: Record<string, { active: string; hover: string }> = {
  saltos:    { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  cableski:  { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",          hover: "hover:border-sky-500/30 hover:text-white/80" },
  remolcado: { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  alquiler:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
  barco:     { active: "bg-sky-500/20 text-sky-300 border-sky-500/50",          hover: "hover:border-sky-500/30 hover:text-white/80" },
  spa:       { active: "bg-violet-500/20 text-violet-300 border-violet-500/50", hover: "hover:border-violet-500/30 hover:text-white/80" },
  generico:  { active: "bg-amber-500/20 text-amber-300 border-amber-500/50",    hover: "hover:border-amber-500/30 hover:text-white/80" },
};

function HeroActivityModal({
  modalState,
  participants,
  details,
  onParticipantsChange,
  onDetailsChange,
  onClose,
  onConfirm,
}: {
  modalState: HeroModalState;
  participants: number;
  details: Record<string, string | number>;
  onParticipantsChange: React.Dispatch<React.SetStateAction<number>>;
  onDetailsChange: React.Dispatch<React.SetStateAction<Record<string, string | number>>>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Cargar variantes reales del CRM para esta experiencia
  const { data: variants, isLoading: variantsLoading } = trpc.public.getVariantsByExperience.useQuery(
    { experienceId: modalState.experienceId },
    { enabled: modalState.open && modalState.experienceId > 0 }
  );

  const chipColors = HERO_CHIP_COLORS[modalState.family] ?? HERO_CHIP_COLORS.generico;

  const setDetail = (key: string, value: string | number) => {
    onDetailsChange((prev) => ({ ...prev, [key]: value }));
  };

  const renderContent = () => {
    if (variantsLoading) {
      return (
        <div className="flex items-center gap-2 text-white/40 text-xs py-2">
          <div className="w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          Cargando opciones…
        </div>
      );
    }

    if (variants && variants.length > 0) {
      return (
        <div className="space-y-4">
          <div>
            <Label className="text-white/60 text-xs mb-2 block">¿Qué formato prefieres?</Label>
            <div className="flex flex-wrap gap-1.5">
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDetail("variante", v.name)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                    details.variante === v.name
                      ? chipColors.active
                      : `border-white/10 text-white/50 bg-white/[0.03] ${chipColors.hover}`
                  }`}
                  title={v.description ?? undefined}
                >
                  {v.name}
                  {v.priceModifier && Number(v.priceModifier) > 0 && (
                    <span className="ml-1.5 opacity-60">
                      {v.priceType === "per_person" ? `${v.priceModifier}€/pax` : `${v.priceModifier}€`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
            <input
              type="text"
              value={(details.notes as string) || ""}
              onChange={(e) => setDetail("notes", e.target.value)}
              className="w-full h-9 bg-white/[0.07] border border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm px-3"
              placeholder="Preferencias, restricciones, nivel…"
            />
          </div>
        </div>
      );
    }

    // Fallback por familia cuando no hay variantes
    const chipCls = (key: string, val: string) =>
      `px-3 py-1.5 rounded-full text-xs border transition-all ${
        (details[key] as string) === val
          ? chipColors.active
          : `border-white/10 text-white/50 bg-white/[0.03] ${chipColors.hover}`
      }`;

    return (
      <div className="space-y-4">
        {(modalState.family === "cableski" || modalState.family === "alquiler") && (
          <div>
            <Label className="text-white/60 text-xs mb-2 block flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Duración</Label>
            <div className="flex flex-wrap gap-1.5">
              {(modalState.family === "cableski"
                ? ["30 minutos", "1 hora", "2 horas", "Media jornada", "Jornada completa"]
                : ["1 hora", "2 horas", "Media jornada", "Jornada completa"]
              ).map((d) => (
                <button key={d} type="button" onClick={() => setDetail("duration", d)} className={chipCls("duration", d)}>{d}</button>
              ))}
            </div>
          </div>
        )}
        {modalState.family === "saltos" && (
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Número de saltos (total del grupo)</Label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setDetail("jumps", Math.max(1, ((details.jumps as number) || 1) - 1))}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-white font-semibold text-lg w-8 text-center">{(details.jumps as number) || 1}</span>
              <button type="button" onClick={() => setDetail("jumps", ((details.jumps as number) || 1) + 1)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {modalState.family === "remolcado" && (
          <div>
            <Label className="text-white/60 text-xs mb-2 block">Duración del paseo</Label>
            <div className="flex flex-wrap gap-1.5">
              {["15 minutos", "30 minutos", "1 hora"].map((d) => (
                <button key={d} type="button" onClick={() => setDetail("duration", d)} className={chipCls("duration", d)}>{d}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <Label className="text-white/60 text-xs mb-2 block">Notas adicionales (opcional)</Label>
          <input
            type="text"
            value={(details.notes as string) || ""}
            onChange={(e) => setDetail("notes", e.target.value)}
            className="w-full h-9 bg-white/[0.07] border border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm px-3"
            placeholder="Nivel, preferencias, alergias…"
          />
        </div>
      </div>
    );
  };

  return (
    <Dialog open={modalState.open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#0d1b2e] border border-white/10 text-white max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-white text-base font-semibold">{modalState.experienceTitle}</DialogTitle>
          <p className="text-white/40 text-xs mt-0.5">Configura esta actividad</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Participantes — siempre fijo */}
          <div>
            <Label className="text-white/60 text-xs mb-2 block flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Participantes</Label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => onParticipantsChange((p) => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-white font-semibold text-lg w-8 text-center">{participants}</span>
              <button type="button" onClick={() => onParticipantsChange((p) => Math.min(200, p + 1))}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Opciones dinámicas del CRM o fallback */}
          {renderContent()}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}
            className="border-white/15 text-white/60 hover:text-white bg-transparent">
            Cancelar
          </Button>
          <Button size="sm" onClick={onConfirm}
            className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white border-0">
            <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Añadir actividad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const [, navigate] = useLocation();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [addToCartProduct, setAddToCartProduct] = useState<{ id: number; title: string; basePrice: string | number; image1?: string; discountPercent?: number | null; discountExpiresAt?: string | Date | null } | null>(null);
  function todayStr() { return new Date().toISOString().split("T")[0]; }
  function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; }

  const [hotelSearch, setHotelSearch] = useState<HotelSearchParams>({
    checkIn: todayStr(),
    checkOut: tomorrowStr(),
    adults: 2,
    children: 0,
    childrenAges: [],
  });

  function handleHotelSearch() {
    const { checkIn, checkOut, adults, children, childrenAges } = hotelSearch;
    navigate(`/hotel?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=${children}&childrenAges=${childrenAges.join(",")}`);
  }

  const { data: slideshowItemsRaw } = trpc.public.getSlideshowItems.useQuery();
  const { data: homeExperiences } = trpc.homeModules.getModule.useQuery({ moduleKey: "experiences_featured" });
  const restaurantsQuery = trpc.restaurants.getAll.useQuery();

  function isRestaurantOpenNow(shifts: Array<{ startTime: string; endTime: string; daysOfWeek?: number[] }> | undefined): boolean {
    if (!shifts || shifts.length === 0) return false;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return shifts.some((shift) => {
      const days = shift.daysOfWeek ?? [0,1,2,3,4,5,6];
      if (!days.includes(dayOfWeek)) return false;
      const [sh, sm] = shift.startTime.split(":").map(Number);
      const [eh, em] = shift.endTime.split(":").map(Number);
      return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em;
    });
  }

  function getNextShift(shifts: Array<{ name: string; startTime: string; endTime: string }> | undefined): string {
    if (!shifts || shifts.length === 0) return "";
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = shifts
      .map((s) => { const [h, m] = s.startTime.split(":").map(Number); return { ...s, startMin: h * 60 + m }; })
      .filter((s) => s.startMin > currentMinutes)
      .sort((a, b) => a.startMin - b.startMin);
    return upcoming.length > 0 ? `Abre a las ${upcoming[0].startTime}` : "";
  }

  const activeSlides = slideshowItemsRaw && slideshowItemsRaw.length > 0
    ? slideshowItemsRaw.map((s: any) => ({
        img: s.imageUrl, badge: s.badge ?? "", title: s.title ?? "",
        subtitle: s.subtitle ?? "", desc: s.description ?? "",
        cta: s.ctaText ?? "", ctaLink: s.ctaUrl ?? "/experiencias", reserveUrl: s.reserveUrl ?? "",
      }))
    : heroSlides;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % activeSlides.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [activeSlides.length]);

  const slide = activeSlides[Math.min(currentSlide, activeSlides.length - 1)];

  // ── Estado formulario hero ─────────────────────────────────────────
  const HERO_CATEGORIES = [
    { id: "Experiencias", label: "Acuáticas", icon: "🌊" },
    { id: "LegoPacks", label: "Lego Packs", icon: "🧩" },
    { id: "Hotel", label: "Hotel", icon: "🏨" },
    { id: "Spa", label: "SPA", icon: "🧖" },
    { id: "Pack colegios", label: "Colegios", icon: "🎒" },
    { id: "Pack teambuilding", label: "Empresas", icon: "🤝" },
  ];
  const HERO_STATIC_PRODUCTS: Record<string, string[]> = {
    Hotel: ["Habitación Estándar", "Habitación Superior", "Suite Lago", "Suite Premium"],
    Spa: ["Circuito SPA", "Masaje Relajante", "Tratamiento Facial", "Pack Pareja SPA"],
    "Pack colegios": ["Pack Escolar Básico", "Pack Escolar Aventura", "Pack Escolar Náutico"],
    "Pack teambuilding": ["Teambuilding Básico", "Teambuilding Premium", "Jornada Corporativa Completa"],
  };
  const SPECIAL_OPTION = "__special__";
  const [heroFormSubmitted, setHeroFormSubmitted] = useState(false);
  const [heroCategory, setHeroCategory] = useState("");
  const [heroProduct, setHeroProduct] = useState("");
  const [heroForm, setHeroForm] = useState({ name: "", email: "", phone: "", arrivalDate: "", adults: "2", children: "0", comments: "", honeypot: "" });
  const [heroErrors, setHeroErrors] = useState<Record<string, string>>({});

  // ─── Estado multi-actividad (solo para categoría Experiencias) ─────────────────────
  const [heroSelectedActivities, setHeroSelectedActivities] = useState<HeroActivityEntry[]>([]);
  const [heroModalState, setHeroModalState] = useState<HeroModalState>({ open: false, experienceId: 0, experienceTitle: "", family: "", slug: "" });
  const [heroModalParticipants, setHeroModalParticipants] = useState(2);
  const [heroModalDetails, setHeroModalDetails] = useState<Record<string, string | number>>({});

  const openHeroActivityModal = useCallback((exp: { id: number; title: string; slug: string }) => {
    const family = getHeroFamilyForSlug(exp.slug);
    const existing = heroSelectedActivities.find((a) => a.experienceId === exp.id);
    setHeroModalParticipants(existing?.participants ?? (parseInt(heroForm.adults, 10) || 2));
    setHeroModalDetails(existing?.details ?? {});
    setHeroModalState({ open: true, experienceId: exp.id, experienceTitle: exp.title, family, slug: exp.slug });
  }, [heroSelectedActivities, heroForm.adults]);

  const saveHeroActivity = useCallback(() => {
    const entry: HeroActivityEntry = {
      experienceId: heroModalState.experienceId,
      experienceTitle: heroModalState.experienceTitle,
      family: heroModalState.family,
      participants: heroModalParticipants,
      details: heroModalDetails,
    };
    setHeroSelectedActivities((prev) => {
      const filtered = prev.filter((a) => a.experienceId !== entry.experienceId);
      return [...filtered, entry];
    });
    setHeroModalState((s) => ({ ...s, open: false }));
    setHeroErrors((e) => ({ ...e, product: "" }));
  }, [heroModalState, heroModalParticipants, heroModalDetails]);

  const removeHeroActivity = useCallback((id: number) => {
    setHeroSelectedActivities((prev) => prev.filter((a) => a.experienceId !== id));
  }, []);

  const { data: heroExperiencesList } = trpc.public.getExperiences.useQuery(
    { limit: 50 }, { enabled: heroCategory === "Experiencias" }
  );
  const { data: heroLegoPacksList } = trpc.legoPacks.listPublic.useQuery(
    undefined, { enabled: heroCategory === "LegoPacks" }
  );
  const { data: heroEscolarPacksList } = trpc.packs.getTitlesByCategory.useQuery(
    { category: "escolar" }, { enabled: heroCategory === "Pack colegios" }
  );
  const { data: heroEmpresaPacksList } = trpc.packs.getTitlesByCategory.useQuery(
    { category: "empresa" }, { enabled: heroCategory === "Pack teambuilding" }
  );
  // Lego Packs de día para la sección 3 de la Home
  const { data: homeLegoPacks } = trpc.legoPacks.listPublicByCategory.useQuery(
    { category: "dia" },
    { staleTime: 5 * 60 * 1000 }
  );
  const heroProducts = useMemo(() => {
    if (heroCategory === "Experiencias" && heroExperiencesList) return heroExperiencesList.map((e: any) => e.title);
    if (heroCategory === "LegoPacks" && heroLegoPacksList) return heroLegoPacksList.map((p: any) => p.title);
    if (heroCategory === "Pack colegios" && heroEscolarPacksList) return heroEscolarPacksList.map((p: any) => p.title);
    if (heroCategory === "Pack teambuilding" && heroEmpresaPacksList) return heroEmpresaPacksList.map((p: any) => p.title);
    return HERO_STATIC_PRODUCTS[heroCategory] ?? [];
  }, [heroCategory, heroExperiencesList, heroLegoPacksList, heroEscolarPacksList, heroEmpresaPacksList]);

  const submitHeroBudget = trpc.public.submitBudget.useMutation({
    onSuccess: () => setHeroFormSubmitted(true),
    onError: () => toast.error("Error al enviar. Por favor, inténtalo de nuevo."),
  });

  const validateHeroForm = () => {
    const e: Record<string, string> = {};
    if (!heroForm.name.trim() || heroForm.name.trim().length < 2) e.name = "Introduce tu nombre";
    if (!heroForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(heroForm.email)) e.email = "Email no válido";
    if (!heroForm.phone.trim() || heroForm.phone.trim().length < 6) e.phone = "Teléfono no válido";
    if (!heroForm.arrivalDate) e.arrivalDate = "Selecciona una fecha";
    if (!heroCategory) e.category = "Selecciona una categoría";
    if (heroCategory === "Experiencias") {
      if (heroSelectedActivities.length === 0) e.product = "Selecciona al menos una actividad";
    } else {
      if (!heroProduct) e.product = "Selecciona una experiencia";
    }
    setHeroErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleHeroSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validateHeroForm()) return;
    const selectedProduct = heroCategory === "Experiencias"
      ? heroSelectedActivities.map((a) => a.experienceTitle).join(", ")
      : (heroProduct === SPECIAL_OPTION ? "Petición especial / Propuesta personalizada" : heroProduct);
    const activitiesJson = heroCategory === "Experiencias" && heroSelectedActivities.length > 0
      ? heroSelectedActivities
      : undefined;
    await submitHeroBudget.mutateAsync({
      name: heroForm.name.trim(), email: heroForm.email.trim(), phone: heroForm.phone.trim(),
      arrivalDate: heroForm.arrivalDate,
      adults: parseInt(heroForm.adults) || 1, children: parseInt(heroForm.children) || 0,
      selectedCategory: heroCategory,
      selectedProduct,
      comments: heroForm.comments.trim() || undefined,
      honeypot: heroForm.honeypot || undefined,
      activitiesJson,
    });
  };

  const svgIcons: Record<string, React.ReactNode> = {
    bed:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M2 12V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
    waves: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/></svg>,
    users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    star:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  };

  return (
    <PublicLayout>

      {/* ══════════════════════════════════════════════════════════════════
          1. HERO SPLIT — foto de fondo + claim izquierda + formulario derecha
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen overflow-hidden flex items-stretch">
        {/* Fondo slideshow */}
        {activeSlides.map((s, i) => (
          <div key={i} className={`absolute inset-0 transition-opacity duration-1000 ${i === currentSlide ? "opacity-100" : "opacity-0"}`}>
            <img src={s.img} alt={s.title} className="w-full h-full object-cover" />
          </div>
        ))}
        {/* Overlay degradado: más oscuro a la izquierda, algo más claro a la derecha */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(5,15,35,0.88) 0%, rgba(5,15,35,0.72) 55%, rgba(5,15,35,0.60) 100%)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(5,15,35,0.55) 0%, transparent 40%)" }} />

        {/* Contenido split */}
        <div className="relative z-10 container flex flex-col lg:flex-row items-center gap-8 lg:gap-10 py-28 lg:py-0 min-h-screen">

          {/* ── Columna izquierda: Claim + CTAs ─────────────────────────── */}
          <div className="flex-1 text-white lg:py-28">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/90 text-white text-xs font-display font-bold uppercase tracking-widest mb-5">
              <Anchor className="w-3 h-3" /> {slide.badge}
            </span>
            <h1 className="text-4xl md:text-5xl xl:text-6xl font-heading font-bold text-white leading-tight mb-3">{slide.title}</h1>
            <p className="text-xl md:text-2xl text-white/80 font-display font-medium mb-3">{slide.subtitle}</p>
            <p className="text-base md:text-lg text-white/65 mb-8 max-w-lg leading-relaxed">{slide.desc}</p>
            <div className="flex flex-wrap gap-3 mb-8">
              {slide.reserveUrl && (
                <Link href={slide.reserveUrl}>
                  <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-8 text-base shadow-lg">
                    Reservar Ahora <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              )}
              {slide.cta && slide.ctaLink && (
                <Link href={slide.ctaLink}>
                  <Button size="lg" className={slide.reserveUrl ? "border-white/50 text-white hover:bg-white/15 font-display font-semibold rounded-full px-8 text-base bg-transparent border" : "bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-8 text-base shadow-lg"}>
                    {slide.cta} <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              )}
            </div>
            {/* Trust pills */}
            <div className="flex flex-col gap-2">
              {[
                { icon: Zap, text: "Respuesta en menos de 24h" },
                { icon: Star, text: "Propuesta 100% personalizada" },
                { icon: Shield, text: "Sin compromiso" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm text-white/50">
                  <Icon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  {text}
                </div>
              ))}
            </div>
            {/* Controles slideshow */}
            <div className="flex items-center gap-3 mt-8">
              <button onClick={() => setCurrentSlide((p) => (p - 1 + activeSlides.length) % activeSlides.length)} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {activeSlides.map((_, i) => (
                <button key={i} onClick={() => setCurrentSlide(i)} className={`rounded-full transition-all duration-300 ${i === currentSlide ? "w-8 h-2.5 bg-orange-500" : "w-2.5 h-2.5 bg-white/40 hover:bg-white/70"}`} />
              ))}
              <button onClick={() => setCurrentSlide((p) => (p + 1) % activeSlides.length)} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Columna derecha: Formulario glass ───────────────────────── */}
          <div className="w-full lg:w-[460px] xl:w-[500px] shrink-0 lg:py-10">
            {heroFormSubmitted ? (
              /* Pantalla de éxito inline */
              <div
                className="rounded-3xl overflow-hidden shadow-2xl text-center px-8 py-12"
                style={{ background: "rgba(10,20,40,0.85)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mx-auto mb-6">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-10 h-10 text-emerald-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <h3 className="text-2xl font-heading font-bold text-white mb-3">¡Perfecto!</h3>
                <p className="text-white/65 mb-6">Tu solicitud ha sido enviada. Recibirás tu propuesta personalizada en <strong className="text-orange-400">menos de 24 horas</strong>.</p>
                <Button onClick={() => { setHeroFormSubmitted(false); setHeroCategory(""); setHeroProduct(""); setHeroForm({ name: "", email: "", phone: "", arrivalDate: "", adults: "2", children: "0", comments: "", honeypot: "" }); }}
                  className="bg-orange-500 hover:bg-orange-600 text-white rounded-full px-6">
                  Nueva solicitud
                </Button>
              </div>
            ) : (
              <div
                className="rounded-3xl overflow-hidden shadow-2xl"
                style={{ background: "rgba(10,20,40,0.52)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "0 32px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08) inset" }}
              >
                {/* Barra superior */}
                <div className="h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500" />

                {/* Encabezado */}
                <div className="px-6 pt-5 pb-4 border-b border-white/[0.07]">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-orange-400" />
                    <h2 className="text-white font-heading font-bold text-lg">Solicita tu Propuesta</h2>
                  </div>
                  <p className="text-white/40 text-xs">Recibirás tu propuesta en menos de 24h</p>
                </div>

                {/* Formulario sin scroll */}
                <div>
                  <form onSubmit={handleHeroSubmit} className="px-6 py-5 space-y-4">
                    <input type="text" name="website" value={heroForm.honeypot} onChange={(e) => setHeroForm({ ...heroForm, honeypot: e.target.value })} style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

                    {/* Nombre + Email */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Nombre <span className="text-orange-400">*</span></Label>
                        <Input value={heroForm.name} onChange={(e) => { setHeroForm({ ...heroForm, name: e.target.value }); setHeroErrors({ ...heroErrors, name: "" }); }}
                          className={`h-9 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-orange-500/50 ${heroErrors.name ? "border-red-400/60" : ""}`}
                          placeholder="Tu nombre" />
                        {heroErrors.name && <p className="text-red-400 text-xs mt-1">{heroErrors.name}</p>}
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Email <span className="text-orange-400">*</span></Label>
                        <Input type="email" value={heroForm.email} onChange={(e) => { setHeroForm({ ...heroForm, email: e.target.value }); setHeroErrors({ ...heroErrors, email: "" }); }}
                          className={`h-9 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-orange-500/50 ${heroErrors.email ? "border-red-400/60" : ""}`}
                          placeholder="tu@email.com" />
                        {heroErrors.email && <p className="text-red-400 text-xs mt-1">{heroErrors.email}</p>}
                      </div>
                    </div>

                    {/* Teléfono + Fecha */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Teléfono <span className="text-orange-400">*</span></Label>
                        <Input type="tel" value={heroForm.phone} onChange={(e) => { setHeroForm({ ...heroForm, phone: e.target.value }); setHeroErrors({ ...heroErrors, phone: "" }); }}
                          className={`h-9 bg-white/[0.07] border-white/10 text-white placeholder:text-white/25 rounded-xl text-sm focus:border-orange-500/50 ${heroErrors.phone ? "border-red-400/60" : ""}`}
                          placeholder="+34 600 000 000" />
                        {heroErrors.phone && <p className="text-red-400 text-xs mt-1">{heroErrors.phone}</p>}
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block">Fecha llegada <span className="text-orange-400">*</span></Label>
                        <Input type="date" value={heroForm.arrivalDate} min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => { setHeroForm({ ...heroForm, arrivalDate: e.target.value }); setHeroErrors({ ...heroErrors, arrivalDate: "" }); }}
                          className={`h-9 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-orange-500/50 ${heroErrors.arrivalDate ? "border-red-400/60" : ""}`}
                          style={{ colorScheme: "dark" }} />
                        {heroErrors.arrivalDate && <p className="text-red-400 text-xs mt-1">{heroErrors.arrivalDate}</p>}
                      </div>
                    </div>

                    {/* Adultos + Niños */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1"><Users className="w-3 h-3" /> Adultos</Label>
                        <Input type="number" min="1" max="200" value={heroForm.adults} onChange={(e) => setHeroForm({ ...heroForm, adults: e.target.value })}
                          className="h-9 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-orange-500/50" style={{ colorScheme: "dark" }} />
                      </div>
                      <div>
                        <Label className="text-white/50 text-xs mb-1.5 block flex items-center gap-1"><Users className="w-3 h-3" /> Niños</Label>
                        <Input type="number" min="0" max="200" value={heroForm.children} onChange={(e) => setHeroForm({ ...heroForm, children: e.target.value })}
                          className="h-9 bg-white/[0.07] border-white/10 text-white rounded-xl text-sm focus:border-orange-500/50" style={{ colorScheme: "dark" }} />
                      </div>
                    </div>

                    {/* Categoría */}
                    <div>
                      <Label className="text-white/50 text-xs mb-2 block">¿Qué quieres vivir? <span className="text-orange-400">*</span></Label>
                      <div className="flex flex-wrap gap-1.5">
                        {HERO_CATEGORIES.map((cat) => (
                          <button key={cat.id} type="button"
                            onClick={() => { setHeroCategory(cat.id); setHeroProduct(""); setHeroSelectedActivities([]); setHeroErrors({ ...heroErrors, category: "", product: "" }); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                              heroCategory === cat.id
                                ? "bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-500/20"
                                : "border-white/15 text-white/55 hover:border-orange-500/40 hover:text-white bg-white/[0.05]"
                            }`}
                          >
                            <span>{cat.icon}</span> {cat.label}
                          </button>
                        ))}
                      </div>
                      {heroErrors.category && <p className="text-red-400 text-xs mt-1.5">{heroErrors.category}</p>}
                    </div>

                    {/* Producto */}
                    {heroCategory && (
                      <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-2xl">
                        <p className="text-white/40 text-xs mb-2 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3 text-orange-400" />
                          {heroCategory === "Experiencias" ? "Selecciona actividades" : "Experiencia"} <span className="text-orange-400">*</span>
                        </p>

                        {/* ── Selector múltiple de experiencias reales ── */}
                        {heroCategory === "Experiencias" ? (
                          <div className="space-y-2">
                            {/* Grid de experiencias */}
                            <div className="flex flex-wrap gap-1.5">
                              {heroExperiencesList ? heroExperiencesList.map((exp: any) => {
                                const isSelected = heroSelectedActivities.some((a) => a.experienceId === exp.id);
                                return (
                                  <button key={exp.id} type="button"
                                    onClick={() => openHeroActivityModal({ id: exp.id, title: exp.title, slug: exp.slug ?? "" })}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
                                      isSelected
                                        ? "bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm shadow-sky-500/10"
                                        : "border-white/10 text-white/50 hover:border-sky-500/30 hover:text-white/80 bg-white/[0.03]"
                                    }`}
                                  >
                                    {isSelected && <CheckCircle className="w-3 h-3 text-sky-400" />}
                                    {!isSelected && <Plus className="w-3 h-3 opacity-50" />}
                                    {exp.title}
                                  </button>
                                );
                              }) : (
                                <span className="text-white/30 text-xs">Cargando experiencias…</span>
                              )}
                            </div>
                            {/* Resumen de actividades seleccionadas */}
                            {heroSelectedActivities.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                <p className="text-white/40 text-xs">Actividades seleccionadas:</p>
                                {heroSelectedActivities.map((act) => (
                                  <div key={act.experienceId} className="flex items-center justify-between bg-sky-500/10 border border-sky-500/20 rounded-xl px-3 py-1.5">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                                      <div>
                                        <span className="text-white/85 text-xs font-medium">{act.experienceTitle}</span>
                                        <span className="text-white/40 text-xs ml-2">{act.participants} pers.</span>
                                        {act.details.duration && <span className="text-white/35 text-xs ml-1">· {act.details.duration}</span>}
                                        {act.details.jumps && <span className="text-white/35 text-xs ml-1">· {act.details.jumps} saltos</span>}
                                      </div>
                                    </div>
                                    <button type="button" onClick={() => removeHeroActivity(act.experienceId)}
                                      className="text-white/30 hover:text-red-400 transition-colors ml-2">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            {heroErrors.product && <p className="text-red-400 text-xs mt-1">{heroErrors.product}</p>}
                          </div>
                        ) : (
                          /* ── Selector simple para otras categorías ── */
                          <div className="flex flex-wrap gap-1.5">
                            {heroProducts.map((product: string) => (
                              <button key={product} type="button"
                                onClick={() => { setHeroProduct(product); setHeroErrors({ ...heroErrors, product: "" }); }}
                                className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                                  heroProduct === product
                                    ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                    : "border-white/10 text-white/45 hover:border-sky-500/30 hover:text-white/75 bg-white/[0.03]"
                                }`}
                              >
                                {product}
                              </button>
                            ))}
                            <button type="button"
                              onClick={() => { setHeroProduct(SPECIAL_OPTION); setHeroErrors({ ...heroErrors, product: "" }); }}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                                heroProduct === SPECIAL_OPTION
                                  ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                                  : "border-orange-500/20 text-orange-400/60 hover:border-orange-500/40 bg-white/[0.03]"
                              }`}
                            >
                              <Star className="w-2.5 h-2.5" /> Propuesta personalizada
                            </button>
                            {heroErrors.product && <p className="text-red-400 text-xs mt-1.5">{heroErrors.product}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Comentarios */}
                    <div>
                      <Label className="text-white/50 text-xs mb-1.5 block">Comentarios (opcional)</Label>
                      <Textarea value={heroForm.comments} onChange={(e) => setHeroForm({ ...heroForm, comments: e.target.value })}
                        className="bg-white/[0.07] border-white/10 text-white placeholder:text-white/20 rounded-xl text-sm resize-none focus:border-orange-500/50"
                        rows={2} placeholder="Ocasión especial, preferencias, grupo grande…" />
                    </div>

                    {/* CTA */}
                    <div className="pb-1">
                      <Button type="submit" disabled={submitHeroBudget.isPending}
                        className="w-full h-11 text-sm font-bold rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white border-0 shadow-lg shadow-orange-500/20 transition-all duration-300"
                      >
                        {submitHeroBudget.isPending ? (
                          <span className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Preparando tu propuesta…
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Send className="w-4 h-4" />
                            Quiero mi propuesta personalizada
                          </span>
                        )}
                      </Button>
                      <p className="text-white/25 text-xs text-center mt-2">
                        Sin compromiso · Respuesta en &lt;24h
                      </p>
                    </div>
                  </form>
                </div>

                {/* Footer contacto */}
                <div className="px-6 py-3 border-t border-white/[0.07] flex flex-col sm:flex-row items-center justify-center gap-3 text-white/30 text-xs">
                  <a href="tel:+34930347791" className="flex items-center gap-1.5 hover:text-orange-400 transition-colors">
                    <Phone className="w-3.5 h-3.5" /> +34 930 34 77 91
                  </a>
                  <span className="hidden sm:block text-white/15">·</span>
                  <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-1.5 hover:text-orange-400 transition-colors">
                    <Mail className="w-3.5 h-3.5" /> reservas@nayadeexperiences.es
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Info rápida — barra inferior */}
        <div className="absolute bottom-0 left-0 right-0 z-10">
          <div className="container">
            <div className="grid grid-cols-3 gap-px bg-white/10 rounded-t-2xl overflow-hidden backdrop-blur-sm">
              {[
                { icon: <MapPin className="w-4 h-4" />, label: "Los Ángeles de San Rafael, Segovia" },
                { icon: <Clock className="w-4 h-4" />, label: "Abierto Lun–Dom · 10:00–20:00" },
                { icon: <Phone className="w-4 h-4" />, label: "+34 930 34 77 91" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-3 bg-white/10 text-white/90 text-sm">
                  <span className="text-orange-400">{item.icon}</span>
                  <span className="hidden sm:inline font-display text-xs">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          2. EXPERIENCIAS — fondo blanco, tarjetas con sombra
          ══════════════════════════════════════════════════════════════════ */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs font-display font-bold uppercase tracking-widest mb-4">
              <Waves className="w-3 h-3" /> Temporada 2026
            </span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-gray-900 mb-4">
              Nuestras <span className="text-sky-600">Experiencias</span>
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Más de 10 actividades acuáticas diseñadas para todos los públicos en el embalse de Los Ángeles de San Rafael
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(homeExperiences && homeExperiences.length > 0 ? homeExperiences : actividades.map((a) => ({
              experienceId: 0, slug: a.slug, title: a.name, shortDescription: a.desc,
              basePrice: a.price, currency: "", image1: a.img, difficulty: null, isFeatured: false, isActive: true,
            }))).map((act: any) => (
              <div key={act.slug} className="group bg-white rounded-2xl overflow-hidden shadow-md border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <Link href={`/experiencias/${act.slug}`}>
                  <div className="relative h-52 overflow-hidden cursor-pointer">
                    <img src={act.image1 || CDN.hero1} alt={act.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    {act.isFeatured && (
                      <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-display font-bold">Destacado</span>
                    )}
                  </div>
                </Link>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-display font-bold text-lg text-gray-900">{act.title}</h3>
                    <span className="text-orange-500 font-display font-bold text-sm whitespace-nowrap ml-2">
                      {act.currency ? `${act.basePrice}€` : act.basePrice}
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm mb-4">{act.shortDescription}</p>
                  <div className="flex items-center gap-3">
                    <Link href={`/experiencias/${act.slug}`}>
                      <span className="flex items-center text-sky-600 text-sm font-display font-medium hover:gap-2 transition-all cursor-pointer">
                        Ver detalles <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </span>
                    </Link>
                    {act.basePrice && (
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => setAddToCartProduct({ id: act.experienceId || 0, title: act.title, basePrice: act.basePrice, image1: act.image1, discountPercent: (act as any).discountPercent, discountExpiresAt: (act as any).discountExpiresAt })}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-display font-bold bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                        >
                          <ShoppingCartIcon className="w-3.5 h-3.5" /> Añadir al carrito
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link href="/experiencias">
              <Button size="lg" className="bg-sky-700 hover:bg-sky-800 text-white font-display font-semibold rounded-full px-10">
                Ver Todas las Experiencias <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          3. PACKS — foto de fondo panorámica + overlay semitransparente
             (no sólido — se ve la foto a través del overlay)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        {/* Foto de fondo visible */}
        <div className="absolute inset-0">
          <img src={CDN.panoramica} alt="" className="w-full h-full object-cover" />
          {/* Overlay semitransparente: se ve la foto pero con suficiente contraste */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(10,22,40,0.88) 0%, rgba(10,22,40,0.75) 50%, rgba(10,22,40,0.88) 100%)" }} />
        </div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />

        <div className="relative z-10 container">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/20 border border-orange-400/40 text-orange-300 text-xs font-display font-bold uppercase tracking-widest mb-4">
              <Anchor className="w-3 h-3" /> Visita de Día · Abril — Octubre
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              Packs de <span className="text-orange-400">Día Completo</span>
            </h2>
            <p className="text-white/65 text-lg max-w-xl mx-auto">
              Elige tu combinación perfecta. Reserva online y obtén un{" "}
              <span className="text-orange-400 font-bold">10% de descuento</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(homeLegoPacks ?? []).map((pack: any, idx: number) => {
              const packImgs = [CDN.wakeboard, CDN.kayak2, CDN.hinchable, CDN.tubing, CDN.barco, CDN.banana];
              const bg = pack.coverImageUrl ?? packImgs[idx % packImgs.length];
              const packSlug = pack.slug ?? "";
              const packName = pack.title;
              const packPrice = pack.priceLabel ?? "Consultar";
              const isFeatured = pack.isFeatured;
              const detailHref = `/lego-packs/detalle/${packSlug}`;
              return (
                <div key={packSlug || idx} className={`group relative rounded-3xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${isFeatured ? "ring-2 ring-orange-400 shadow-orange-500/20 shadow-xl" : "shadow-lg"}`} style={{ minHeight: 400 }}>
                  <img src={bg} alt={packName} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(5,15,35,0.96) 45%, rgba(5,15,35,0.20) 100%)" }} />
                  {isFeatured && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-orange-500 text-white text-xs font-display font-bold uppercase tracking-widest whitespace-nowrap">
                      ★ Más Popular
                    </div>
                  )}
                  {pack.badge && !isFeatured && (
                    <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-sky-500/90 text-white text-xs font-display font-bold">
                      {pack.badge}
                    </div>
                  )}
                  <DiscountRibbon
                    discountPercent={pack.discountPercent}
                    discountExpiresAt={pack.discountExpiresAt}
                    variant="card"
                  />
                  <div className="relative z-10 flex flex-col justify-end h-full p-6" style={{ minHeight: 400 }}>
                    <div className="mb-3">
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-4xl font-display font-extrabold text-white">{packPrice}</span>
  
                      </div>
                      <h3 className="font-heading font-bold text-xl text-white mb-3">{packName}</h3>
                      {pack.subtitle && (
                        <p className="text-white/65 text-sm mb-2">{pack.subtitle}</p>
                      )}
                    </div>
                    {pack.shortDescription && (
                      <p className="text-white/65 text-sm mb-5 line-clamp-3">{pack.shortDescription}</p>
                    )}
                    <div className="flex items-center justify-between pt-4 border-t border-white/15">
                      <Link href={detailHref}>
                        <span className="font-display font-semibold text-sm text-white/70 hover:text-white transition-colors cursor-pointer">Ver detalles</span>
                      </Link>
                      <button
                        onClick={() => setAddToCartProduct({ id: pack.id, title: packName, basePrice: 0, image1: pack.coverImageUrl })}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-display font-bold transition-all"
                      >
                        <ShoppingCartIcon className="w-3.5 h-3.5" /> Añadir al carrito
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-center mt-12">
            <Link href="/lego-packs/dia">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-10 shadow-lg">
                Ver Todos los Packs <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          4. HOTEL — split foto/blanco (módulo claro, respira)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden py-0 bg-white">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[640px]">
          {/* Columna imagen */}
          <div className="relative overflow-hidden" style={{ minHeight: 400 }}>
            <img src={CDN.hotel} alt="Hotel Náyade" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 55%, rgba(255,255,255,1) 100%)" }} />
            <div className="absolute bottom-8 left-8 bg-white rounded-2xl px-5 py-4 shadow-xl border border-gray-100">
              <div className="text-2xl font-heading font-bold text-amber-500">★★★</div>
              <div className="font-display text-sm font-semibold text-gray-800">Hotel Náyade</div>
              <div className="font-display text-xs text-gray-500">117 habitaciones</div>
            </div>
          </div>
          {/* Columna contenido — blanco puro */}
          <div className="flex flex-col justify-center px-8 py-16 lg:px-14 bg-white">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs font-display font-bold uppercase tracking-widest mb-5 w-fit">
              Alojamiento Premium
            </span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-gray-900 mb-4">
              Hotel <span className="text-sky-600">Náyade</span>
            </h2>
            <p className="text-gray-500 text-lg mb-8 leading-relaxed">
              Ubicado frente al embalse en Los Ángeles de San Rafael. Un refugio de confort diseñado para descansar tras un día de aventura, combinando servicios de calidad con un entorno natural inigualable.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {habitaciones.map((hab) => (
                <div key={hab.tipo} className="rounded-2xl p-4 border border-gray-100 hover:border-sky-200 hover:shadow-md transition-all bg-gray-50">
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl mb-2 bg-sky-50 text-sky-600">
                    {svgIcons[hab.iconSvg]}
                  </div>
                  <div className="font-display font-bold text-sm text-gray-800 mb-0.5">{hab.tipo}</div>
                  <div className="text-sky-600 font-display font-bold text-lg">{hab.precio}</div>
                  <div className="text-gray-400 text-xs">{hab.rango}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mb-6 flex-wrap">
              <Link href="/hotel">
                <Button size="lg" className="bg-sky-700 hover:bg-sky-800 text-white font-display font-semibold rounded-full px-8 shadow-md">
                  Ver Habitaciones <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link href="/presupuesto">
                <Button size="lg" variant="outline" className="border-sky-200 text-sky-700 hover:bg-sky-50 font-display font-semibold rounded-full px-8 bg-white">
                  Solicitar Precio
                </Button>
              </Link>
            </div>
            <HotelSearchBar params={hotelSearch} onChange={setHotelSearch} onSearch={handleHotelSearch} buttonLabel="Ver disponibilidad" />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          5. SPA — foto de fondo con overlay verde oscuro semitransparente
             (foto visible, atmósfera de bienestar)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[620px]">
          {/* Columna contenido sobre foto */}
          <div className="relative flex flex-col justify-center px-8 py-16 lg:px-14 order-2 lg:order-1 overflow-hidden">
            {/* Foto de fondo con overlay */}
            <div className="absolute inset-0">
              <img src={CDN.spa2} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(8,30,22,0.92) 0%, rgba(8,30,22,0.82) 100%)" }} />
            </div>
            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/80 text-xs font-display font-bold uppercase tracking-widest mb-5 w-fit">
                Bienestar & Relax
              </span>
              <h2 className="text-4xl md:text-5xl font-heading font-bold text-white mb-4">
                SPA <span className="text-orange-400">Náyade</span>
              </h2>
              <p className="text-white/70 text-lg mb-8 leading-relaxed">
                Un santuario de paz donde el cuerpo recupera su equilibrio. Disfruta de nuestras instalaciones termales y tratamientos exclusivos con vistas al lago.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-8">
                {[
                  { label: "Circuito SPA", precio: "25€/persona", desc: "Piscinas termales + chorros" },
                  { label: "Pack Pareja", precio: "40€/2 pax", desc: "Experiencia romántica" },
                  { label: "Huéspedes Hotel", precio: "20€/persona", desc: "Precio especial hotel" },
                  { label: "Niños (<12 años)", precio: "10€", desc: "Diversión en familia" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl p-4 border border-white/10 hover:border-orange-400/40 transition-colors" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="font-display font-bold text-white text-sm mb-0.5">{item.label}</div>
                    <div className="text-orange-400 font-display font-bold text-xl">{item.precio}</div>
                    <div className="text-white/50 text-xs">{item.desc}</div>
                  </div>
                ))}
              </div>
              <Link href="/spa">
                <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-8 w-fit">
                  Reservar SPA <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
          {/* Columna imagen doble — fotos reales del spa */}
          <div className="relative order-1 lg:order-2 grid grid-rows-2 gap-0 overflow-hidden" style={{ minHeight: 400 }}>
            <div className="relative overflow-hidden">
              <img src={CDN.spa1} alt="SPA Náyade tratamientos" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30" />
            </div>
            <div className="relative overflow-hidden">
              <img src={CDN.spa2} alt="SPA Náyade noche" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-transparent to-black/30" />
              <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2">
                {[
                  { titulo: "Circuito Hidrotermal" },
                  { titulo: "Masajes Terapéuticos" },
                  { titulo: "Sauna & Baño Turco" },
                  { titulo: "Clinic SPA" },
                ].map((item) => (
                  <div key={item.titulo} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(10,22,40,0.75)", backdropFilter: "blur(8px)" }}>
                    <span className="text-orange-400 text-xs">✦</span>
                    <span className="text-white text-xs font-display font-semibold">{item.titulo}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          6. RESTAURANTES — fondo arena/crema claro (respira entre oscuros)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #faf7f2 0%, #f5ede0 50%, #faf7f2 100%)" }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-300/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-300/60 to-transparent" />
        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-100 border border-orange-200 text-orange-700 text-xs font-display font-bold uppercase tracking-widest mb-4">
              Gastronomía
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-gray-900 mb-4">
              Sabores del <span className="text-orange-500">Lago</span>
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              Desde desayunos con vistas hasta cenas temáticas. Cocina internacional y sabores locales en espacios únicos
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {(restaurantsQuery.data ?? []).map((rest) => {
              const heroImg = rest.heroImage && !rest.heroImage.includes("unsplash") ? rest.heroImage : CDN.barco;
              const isOpen = isRestaurantOpenNow((rest as any).shifts);
              const nextShift = getNextShift((rest as any).shifts);
              return (
                <Link key={rest.slug} href={`/restaurantes/${rest.slug}`}>
                  <div className="group relative rounded-3xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl shadow-md" style={{ minHeight: 360 }}>
                    <img src={heroImg} alt={rest.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(15,8,2,0.95) 40%, rgba(15,8,2,0.10) 100%)" }} />
                    <div className="absolute top-4 right-4 z-20">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-white text-xs font-display font-bold shadow-lg">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Abierto
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700/80 text-white/70 text-xs font-display font-bold backdrop-blur-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/40" /> Cerrado
                        </span>
                      )}
                    </div>
                    <div className="relative z-10 flex flex-col justify-end h-full p-6" style={{ minHeight: 360 }}>
                      {rest.badge && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-xs font-display font-semibold mb-2 w-fit">{rest.badge}</span>
                      )}
                      <h3 className="font-heading font-bold text-lg text-white mb-1">{rest.name}</h3>
                      <p className="text-orange-300 font-display text-xs font-semibold uppercase tracking-wide mb-2">{rest.cuisine}</p>
                      <p className="text-white/65 text-sm leading-relaxed mb-3 line-clamp-2">{rest.shortDesc}</p>
                      {!isOpen && nextShift && (
                        <div className="flex items-center gap-1.5 text-white/50 text-xs mb-3">
                          <Clock className="w-3 h-3" /> {nextShift}
                        </div>
                      )}
                      {rest.acceptsOnlineBooking ? (
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-orange-500 text-white text-xs font-display font-bold transition-all group-hover:gap-2.5 w-fit">
                          <Calendar className="w-3.5 h-3.5" /> Reservar Mesa
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/10 text-white/50 text-xs font-display border border-white/10">Próximamente</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            {restaurantsQuery.isLoading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-3xl bg-orange-100/50 animate-pulse" style={{ minHeight: 360 }} />
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/restaurantes">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-10 shadow-lg">
                Ver Todos los Restaurantes <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          7. 10 RAZONES — foto del lago de fondo + overlay azul marino
             (foto visible a través del overlay, sensación de inmersión)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-24 overflow-hidden">
        {/* Foto de fondo */}
        <div className="absolute inset-0">
          <img src={CDN.hero1} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(10,22,40,0.87) 0%, rgba(14,34,64,0.82) 50%, rgba(10,22,40,0.87) 100%)" }} />
          {/* Radial glow decorativo */}
          <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(14,165,233,0.18) 0%, transparent 55%), radial-gradient(circle at 80% 20%, rgba(249,115,22,0.12) 0%, transparent 45%)" }} />
        </div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />

        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-400/15 border border-sky-400/30 text-sky-300 text-xs font-display font-bold uppercase tracking-widest mb-5">
              ¿Por qué Náyade?
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
              10 Razones para <span className="text-orange-400">Elegirnos</span>
            </h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              Un destino único donde la naturaleza, el deporte y el bienestar se fusionan a solo 45 minutos de Madrid.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
            {razones.map((r, i) => (
              <div
                key={i}
                className="group relative text-center p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-default"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(8px)" }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-orange-400 rounded-full transition-all duration-300 group-hover:w-3/4" />
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 transition-all duration-300 group-hover:scale-110" style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.25)" }}>
                  <span className="text-orange-400">{r.icon}</span>
                </div>
                <h4 className="font-display font-bold text-sm text-white mb-1.5">{r.titulo}</h4>
                <p className="text-white/55 text-xs leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/presupuesto">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-10 shadow-lg shadow-orange-500/20">
                Diseña tu Experiencia <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          8. TESTIMONIOS — fondo blanco/gris muy claro (respira, contrasta)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #f8fafc 0%, #eef2f7 100%)" }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent" />
        <div className="container relative z-10">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-display font-bold uppercase tracking-widest mb-4">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> Opiniones Verificadas
            </span>
            <h2 className="text-4xl md:text-6xl font-heading font-bold text-gray-900 mb-4">
              Lo que Dicen <span className="text-sky-600">Nuestros Clientes</span>
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              Más de 10.000 experiencias vividas. Estas son algunas de sus historias.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonios.map((t, i) => (
              <div
                key={i}
                className="group bg-white rounded-3xl overflow-hidden shadow-md border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                {/* Línea de acento superior */}
                <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-orange-400 to-sky-400 opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="p-8">
                  <div className="flex gap-1 mb-5">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-600 text-base leading-relaxed mb-6 italic">
                    "{t.texto}"
                  </p>
                  <div className="flex items-center gap-3 pt-5 border-t border-gray-100">
                    <div className="w-10 h-10 rounded-full bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-700 font-display font-bold text-sm flex-shrink-0">
                      {t.autor.charAt(0)}
                    </div>
                    <div>
                      <div className="font-display font-bold text-gray-900 text-sm">{t.autor}</div>
                      <div className="text-gray-400 text-xs">{t.tipo}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Métricas de confianza */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { num: "10.000+", label: "Clientes satisfechos" },
              { num: "4.8★", label: "Valoración media" },
              { num: "15+", label: "Años de experiencia" },
              { num: "10", label: "Actividades acuáticas" },
            ].map((stat) => (
              <div key={stat.label} className="text-center py-6 px-4 rounded-2xl bg-white border border-gray-100 shadow-sm">
                <div className="text-3xl font-heading font-bold text-sky-600 mb-1">{stat.num}</div>
                <div className="text-gray-500 text-sm font-display">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          9. CANJEA TU CUPÓN — módulo informativo aspiracional
             (Groupon · Wonderbox · El Corte Inglés · LetsBonus)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-20 overflow-hidden">
        {/* Fondo: foto del lago con overlay azul oscuro profundo */}
        <div className="absolute inset-0">
          <img src={CDN.hero1} alt="" className="w-full h-full object-cover scale-105" style={{ objectPosition: "center 40%" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(8,18,38,0.93) 0%, rgba(14,32,64,0.88) 50%, rgba(8,18,38,0.93) 100%)" }} />
          {/* Textura de puntos decorativa */}
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        </div>

        <div className="relative z-10 container">
          {/* Layout split: texto izquierda + tarjeta derecha */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* ── Columna izquierda: Claim aspiracional ─────────────────── */}
            <div>
              {/* Badge plataformas */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-orange-400/40 bg-orange-500/10 text-orange-300 text-xs font-display font-bold uppercase tracking-widest mb-6">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M20 12V22H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                Groupon · Wonderbox · El Corte Inglés · LetsBonus
              </div>

              <h2 className="text-4xl md:text-5xl font-heading font-bold text-white leading-tight mb-5">
                ¿Tienes un Cupón<br />
                <span className="text-orange-400">Regalo</span> o{" "}
                <span className="text-sky-400">Voucher</span>?
              </h2>

              <p className="text-white/70 text-lg leading-relaxed mb-8 max-w-lg">
                Canjea tu experiencia en Náyade de forma rápida y sencilla.
                Rellena el formulario online, adjunta tu cupón y nuestro equipo
                se pondrá en contacto contigo en menos de 24 horas para
                confirmar fecha y detalles.
              </p>

              {/* Pasos del proceso */}
              <div className="space-y-4 mb-8">
                {[
                  { step: "01", title: "Envía tu cupón", desc: "Rellena el formulario y adjunta la foto o PDF de tu cupón.", color: "text-orange-400", border: "border-orange-400/30", bg: "bg-orange-500/10" },
                  { step: "02", title: "Validamos en 24h", desc: "Nuestro equipo verifica el cupón y te confirma disponibilidad.", color: "text-sky-400", border: "border-sky-400/30", bg: "bg-sky-500/10" },
                  { step: "03", title: "¡A disfrutar!", desc: "Ven en la fecha acordada y vive tu experiencia en el lago.", color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-500/10" },
                ].map((item) => (
                  <div key={item.step} className={`flex items-start gap-4 p-4 rounded-2xl border ${item.border} ${item.bg}`}>
                    <div className={`text-2xl font-heading font-black ${item.color} leading-none flex-shrink-0 w-10`}>{item.step}</div>
                    <div>
                      <div className="font-display font-bold text-white text-sm mb-0.5">{item.title}</div>
                      <div className="text-white/55 text-sm leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Plataformas aceptadas */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-white/40 text-xs font-display uppercase tracking-wider">Aceptamos cupones de:</span>
                {["Groupon", "Wonderbox", "El Corte Inglés", "LetsBonus", "Smartbox"].map((p) => (
                  <span key={p} className="px-3 py-1 rounded-full bg-white/8 border border-white/15 text-white/70 text-xs font-display font-medium">{p}</span>
                ))}
              </div>
            </div>

            {/* ── Columna derecha: Tarjeta CTA ──────────────────────────── */}
            <div className="flex justify-center lg:justify-end">
              <div className="w-full max-w-sm">
                {/* Tarjeta glass */}
                <div className="relative rounded-3xl overflow-hidden border border-white/15 shadow-2xl" style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
                  {/* Banda superior naranja */}
                  <div className="h-1.5 w-full bg-gradient-to-r from-orange-400 via-amber-400 to-orange-500" />

                  <div className="p-8">
                    {/* Icono central */}
                    <div className="flex justify-center mb-6">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.25) 0%, rgba(14,165,233,0.20) 100%)", border: "1.5px solid rgba(249,115,22,0.35)" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-9 h-9 text-orange-400"><path d="M20 12V22H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                      </div>
                    </div>

                    <h3 className="text-2xl font-heading font-bold text-white text-center mb-2">
                      Canjea tu Cupón
                    </h3>
                    <p className="text-white/55 text-sm text-center leading-relaxed mb-8">
                      Proceso 100% online. Sin esperas.<br />Respuesta garantizada en menos de 24h.
                    </p>

                    {/* Beneficios */}
                    <div className="space-y-3 mb-8">
                      {[
                        { icon: "✓", text: "Sin coste adicional — solo tu cupón" },
                        { icon: "✓", text: "Todas las actividades disponibles" },
                        { icon: "✓", text: "Fechas flexibles según disponibilidad" },
                        { icon: "✓", text: "Atención personalizada por nuestro equipo" },
                      ].map((b) => (
                        <div key={b.text} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 text-xs font-bold flex-shrink-0 mt-0.5">{b.icon}</span>
                          <span className="text-white/70 text-sm leading-relaxed">{b.text}</span>
                        </div>
                      ))}
                    </div>

                    {/* CTA principal */}
                    <Link href="/canjear-cupon">
                      <button className="w-full py-4 rounded-2xl font-display font-bold text-white text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg" style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)", boxShadow: "0 8px 24px rgba(249,115,22,0.35)" }}>
                        Canjear mi Cupón Ahora
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 ml-2 inline-block"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      </button>
                    </Link>

                    {/* Enlace secundario */}
                    <p className="text-center mt-4 text-white/35 text-xs">
                      ¿Dudas? Llámanos al{" "}
                      <a href="tel:+34930347791" className="text-sky-400 hover:text-sky-300 transition-colors">+34 930 34 77 91</a>
                    </p>
                  </div>
                </div>

                {/* Nota de confianza bajo la tarjeta */}
                <div className="mt-4 flex items-center justify-center gap-2 text-white/35 text-xs">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-emerald-400"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  Proceso seguro y verificado por nuestro equipo
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          10. CTA FINAL — foto impactante del lago + overlay fuerte
             (cierre potente, llamada a la acción)
          ══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-28 overflow-hidden">
        <div className="absolute inset-0">
          <img src={CDN.hero3} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(10,22,40,0.90) 0%, rgba(10,22,40,0.80) 100%)" }} />
        </div>
        <div className="relative z-10 container text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/20 border border-orange-400/40 mb-6">
            <Anchor className="w-8 h-8 text-orange-400" />
          </div>
          <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-4">
            ¿Listo para Vivir<br />la <span className="text-orange-400">Aventura</span>?
          </h2>
          <p className="text-white/70 text-xl mb-10 max-w-xl mx-auto">
            Reserva online con un 10% de descuento. Temporada Abril — Octubre 2026.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/experiencias">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-display font-semibold rounded-full px-10 text-base shadow-lg">
                Explorar Experiencias <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link href="/presupuesto">
              <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/15 font-display font-semibold rounded-full px-10 text-base bg-transparent">
                Solicitar Presupuesto
              </Button>
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-8 text-white/60 text-sm font-display">
            <span className="flex items-center gap-2"><Phone className="w-4 h-4 text-orange-400" /> +34 930 34 77 91</span>
            <span className="flex items-center gap-2"><Mail className="w-4 h-4 text-orange-400" /> reservas@nayadeexperiences.es</span>
            <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-orange-400" /> Los Ángeles de San Rafael, Segovia</span>
          </div>
        </div>
      </section>

      {/* AddToCartModal — actividades */}
      {addToCartProduct && (
        <AddToCartModal
          isOpen={!!addToCartProduct}
          onClose={() => setAddToCartProduct(null)}
          product={addToCartProduct}
        />
      )}

      {/* ── Modal contextual de actividad (dinámico — variantes del CRM) ── */}
      <HeroActivityModal
        modalState={heroModalState}
        participants={heroModalParticipants}
        details={heroModalDetails}
        onParticipantsChange={setHeroModalParticipants}
        onDetailsChange={setHeroModalDetails}
        onClose={() => setHeroModalState((s) => ({ ...s, open: false }))}
        onConfirm={saveHeroActivity}
      />
    </PublicLayout>
  );
}
