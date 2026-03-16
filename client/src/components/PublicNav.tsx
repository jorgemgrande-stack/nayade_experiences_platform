import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronDown, Anchor, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  {
    label: "Experiencias",
    href: "/experiencias",
    children: [
      { label: "Blob Jump", href: "/experiencias/blob-jump" },
      { label: "Banana Ski & Donuts", href: "/experiencias/banana-ski-donuts" },
      { label: "Cableski & Wakeboard", href: "/experiencias/cableski-wakeboard" },
      { label: "Canoas & Kayaks", href: "/experiencias/canoas-kayaks" },
      { label: "Paddle Surf", href: "/experiencias/paddle-surf" },
      { label: "Hidropedales & Hidrobicis", href: "/experiencias/hidropedales" },
      { label: "Minimotos Eléctricas", href: "/experiencias/minimotos" },
      { label: "Paseos en Barco", href: "/experiencias/paseos-barco" },
      { label: "Aventura Hinchable", href: "/experiencias/aventura-hinchable" },
    ],
  },
  {
    label: "Packs",
    href: "/packs",
    children: [
      { label: "Packs de Día", href: "/packs/dia" },
      { label: "Packs Escolares", href: "/packs/escolares" },
      { label: "Team Building Empresas", href: "/packs/corporativo" },
    ],
  },
  { label: "Hotel", href: "/hotel" },
  { label: "SPA", href: "/spa" },
  {
    label: "Restaurantes",
    href: "/restaurantes",
    children: [
      { label: "El Galeón", href: "/restaurantes/el-galeon" },
      { label: "La Cabaña del Lago", href: "/restaurantes/la-cabana" },
      { label: "Nassau Bar & Music", href: "/restaurantes/nassau-bar" },
    ],
  },
  { label: "Galería", href: "/galeria" },
  { label: "Ubicación", href: "/ubicaciones" },
];

export default function PublicNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setActiveDropdown(null);
  }, [location]);

  const isHome = location === "/";
  // En home sin scroll: overlay oscuro náutico semitransparente para máximo contraste
  // En cualquier otra página o con scroll: fondo blanco sólido
  const transparent = !scrolled && isHome;

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        transparent
          ? "bg-gradient-to-b from-black/55 via-black/30 to-transparent"
          : "bg-white shadow-md border-b border-border/50"
      )}
    >
      {/* ── Barra superior de información ─────────────────────────── */}
      <div
        className={cn(
          "hidden lg:block border-b transition-all duration-300",
          transparent
            ? "border-white/20 bg-black/25"
            : "border-border/40 bg-primary/5"
        )}
      >
        <div className="container flex items-center justify-between py-1.5">
          <div
            className={cn(
              "flex items-center gap-6 text-xs font-display",
              transparent ? "text-white/85" : "text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-1.5">
              <Phone className="w-3 h-3" />
              +34 919 041 947
            </span>
            <span>hola@nayadeexperiences.es</span>
            <span>Los Ángeles de San Rafael, Segovia · A 45 min de Madrid</span>
          </div>
          <div
            className={cn(
              "text-xs font-display font-semibold",
              transparent ? "text-amber-300" : "text-accent"
            )}
          >
            🌊 Temporada Abril — Octubre 2026 · Reserva online con 10% dto.
          </div>
        </div>
      </div>

      {/* ── Barra de navegación principal ─────────────────────────── */}
      <div className="container">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group cursor-pointer">
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300",
                transparent ? "bg-white/25 backdrop-blur-sm" : "bg-primary"
              )}
            >
              <Anchor className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span
                className={cn(
                  "font-heading font-bold text-lg leading-none transition-colors",
                  transparent ? "text-white" : "text-primary"
                )}
              >
                NÁYADE
              </span>
              <span
                className={cn(
                  "font-display text-[10px] uppercase tracking-widest leading-none transition-colors",
                  transparent ? "text-white/70" : "text-muted-foreground"
                )}
              >
                Experiences
              </span>
            </div>
          </Link>

          {/* Navegación desktop */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <div
                key={link.href}
                className="relative"
                onMouseEnter={() => link.children && setActiveDropdown(link.label)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <Link href={link.href}>
                  <button
                    className={cn(
                      "flex items-center gap-1 px-3 py-2 rounded-lg font-display text-sm font-medium transition-all duration-200",
                      transparent
                        ? "text-white hover:text-white hover:bg-white/15 drop-shadow-sm"
                        : "text-foreground hover:text-primary hover:bg-primary/8",
                      location === link.href && !transparent && "text-primary font-semibold"
                    )}
                  >
                    {link.label}
                    {link.children && (
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 opacity-70 transition-transform",
                          activeDropdown === link.label && "rotate-180"
                        )}
                      />
                    )}
                  </button>
                </Link>

                {/* Dropdown */}
                {link.children && activeDropdown === link.label && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-border/50 py-2 z-50 animate-fade-up">
                    {link.children.map((child) => (
                      <Link key={child.href} href={child.href}>
                        <div className="px-4 py-2.5 text-sm font-display text-foreground hover:bg-primary/8 hover:text-primary cursor-pointer transition-colors border-b border-border/20 last:border-0">
                          {child.label}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* CTAs desktop */}
          <div className="hidden lg:flex items-center gap-2">
            <Link href="/contacto">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "font-display font-medium rounded-full",
                  transparent
                    ? "text-white hover:text-white hover:bg-white/15"
                    : "text-foreground hover:text-primary"
                )}
              >
                Contacto
              </Button>
            </Link>
            <Link href="/presupuesto">
              <Button
                size="sm"
                className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-5 shadow-md"
              >
                Solicitar Presupuesto
              </Button>
            </Link>
          </div>

          {/* Botón hamburguesa mobile */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "lg:hidden p-2 rounded-lg transition-colors",
              transparent
                ? "text-white hover:bg-white/20"
                : "text-foreground hover:bg-muted"
            )}
          >
            {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Menú mobile ───────────────────────────────────────────── */}
      {isOpen && (
        <div className="lg:hidden bg-white border-t border-border shadow-xl max-h-[80vh] overflow-y-auto">
          <div className="container py-4 space-y-1">
            {navLinks.map((link) => (
              <div key={link.href}>
                <Link href={link.href}>
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-muted font-display font-medium text-foreground cursor-pointer">
                    {link.label}
                    {link.children && (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </Link>
                {link.children && (
                  <div className="ml-4 space-y-0.5">
                    {link.children.map((child) => (
                      <Link key={child.href} href={child.href}>
                        <div className="px-4 py-2 text-sm font-display text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg cursor-pointer transition-colors">
                          {child.label}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="pt-3 border-t border-border space-y-2">
              <Link href="/contacto">
                <Button
                  variant="outline"
                  className="w-full font-display font-medium rounded-full"
                >
                  Contacto
                </Button>
              </Link>
              <Link href="/presupuesto">
                <Button className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full">
                  Solicitar Presupuesto
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
