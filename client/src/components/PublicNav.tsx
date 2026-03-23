import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronDown, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import CartIcon from "@/components/CartIcon";
import CartDrawer from "@/components/CartDrawer";

// Fallback estático por si la BD no responde aún
const FALLBACK_NAV = [
  {
    label: "Experiencias", href: "/experiencias",
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
    label: "Packs", href: "/packs",
    children: [
      { label: "Packs de Día", href: "/packs/dia" },
      { label: "Packs Escolares", href: "/packs/escolar" },
      { label: "Team Building Empresas", href: "/packs/empresa" },
    ],
  },
  { label: "Hotel", href: "/hotel" },
  { label: "SPA", href: "/spa" },
  {
    label: "Restaurantes", href: "/restaurantes",
    children: [
      { label: "El Galeón", href: "/restaurantes/el-galeon" },
      { label: "La Cabaña del Lago", href: "/restaurantes/la-cabana-del-lago" },
      { label: "Nassau Bar & Music", href: "/restaurantes/nassau-bar" },
      { label: "Arrocería La Cabaña", href: "/restaurantes/arroceria-la-cabana" },
    ],
  },
  { label: "Galería", href: "/galeria" },
  { label: "Ubicación", href: "/ubicaciones" },
];

interface NavItem {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
}

// ── Dropdown con zona de tolerancia hover ─────────────────────────────────
interface DropdownItem { label: string; href: string }
interface NavDropdownProps {
  label: string;
  href: string;
  children: DropdownItem[];
  isActive: boolean;
}

function NavDropdown({ label, href, children, isActive }: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [location, setLocation] = useLocation();

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 420);
  }, [cancelClose]);

  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const navigate = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  return (
    <div className="relative" onPointerEnter={() => { cancelClose(); setOpen(true); }} onPointerLeave={scheduleClose}>
      <Link href={href}>
        <button className={cn(
          "flex items-center gap-1 px-3 py-2 rounded-lg font-display text-sm font-medium transition-all duration-200",
          "text-foreground hover:text-primary hover:bg-primary/8",
          isActive && "text-primary font-semibold"
        )}>
          {label}
          <ChevronDown className={cn("w-3.5 h-3.5 opacity-70 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </Link>
      {/* Bridge invisible para evitar el gap entre botón y dropdown */}
      {open && <div className="absolute top-full left-0 w-full h-3 z-40" onPointerEnter={cancelClose} />}
      <div
        className={cn(
          "absolute top-[calc(100%+0.5rem)] left-0 w-56 bg-white rounded-xl shadow-2xl border border-border/50 py-2 z-50",
          "transition-all duration-200 origin-top",
          open ? "opacity-100 scale-y-100 translate-y-0 pointer-events-auto" : "opacity-0 scale-y-95 -translate-y-1 pointer-events-none"
        )}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
      >
        <div className="absolute -top-1.5 left-5 w-3 h-3 bg-white border-l border-t border-border/50 rotate-45" />
        {children.map((child) => (
          <button
            key={child.href}
            onClick={() => navigate(child.href)}
            className="w-full text-left px-4 py-2.5 text-sm font-display text-foreground hover:bg-primary/8 hover:text-primary cursor-pointer transition-colors border-b border-border/20 last:border-0 block"
          >
            {child.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PublicNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedMobile, setExpandedMobile] = useState<string | null>(null);
  const [location, setLocation] = useLocation();

  // Cargar menú desde la BD
  const { data: menuData } = trpc.public.getMenuItems.useQuery(
    { zone: "header" },
    { staleTime: 5 * 60 * 1000 } // 5 min cache
  );

  // Construir estructura de navegación a partir de los datos de BD
  const navLinks: NavItem[] = (() => {
    if (!menuData || menuData.length === 0) return FALLBACK_NAV;

    // Ítems raíz (sin parentId), activos, ordenados
    const roots = menuData
      .filter((item: any) => !item.parentId && item.isActive)
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    return roots.map((root: any) => {
      const children = menuData
        .filter((item: any) => item.parentId === root.id && item.isActive)
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
        .map((child: any) => ({ label: child.label, href: child.url ?? "/" }));

      return {
        label: root.label,
        href: root.url ?? "/",
        ...(children.length > 0 ? { children } : {}),
      };
    });
  })();

  useEffect(() => {
    setIsOpen(false);
    setExpandedMobile(null);
  }, [location]);

  const mobileNavigate = (to: string) => {
    setIsOpen(false);
    setExpandedMobile(null);
    setLocation(to);
  };

  return (
    <>
    <header className="fixed top-0 left-0 right-0 z-50 bg-white shadow-md border-b border-border/50">
      {/* ── Barra superior de información ─────────────────────────── */}
      <div className="hidden lg:block border-b border-border/40 bg-primary/5">
        <div className="container flex items-center justify-between py-1.5">
          <div className="flex items-center gap-6 text-xs font-display text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Phone className="w-3 h-3" />
              +34 930 34 77 91
            </span>
            <span>reservas@nayadeexperiences.es</span>
            <span>Los Ángeles de San Rafael, Segovia · A 45 min de Madrid</span>
          </div>
          <div className="text-xs font-display font-semibold text-accent">
            🌊 Temporada Abril — Octubre 2026 · Reserva online con 10% dto.
          </div>
        </div>
      </div>

      {/* ── Barra de navegación principal ─────────────────────────── */}
      <div className="container">
        <div className="flex items-center justify-between h-20">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 cursor-pointer">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png"
              alt="Náyade Experiences"
              className="h-14 w-auto object-contain"
            />
            <div className="flex flex-col leading-none">
              <span className="font-heading font-bold text-lg leading-none text-primary">
                NÁYADE
              </span>
              <span className="font-display text-[10px] uppercase tracking-widest leading-none text-muted-foreground">
                Experiences
              </span>
            </div>
          </Link>

          {/* Navegación desktop */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {navLinks.map((link) =>
              link.children ? (
                <NavDropdown
                  key={link.href}
                  label={link.label}
                  href={link.href}
                  children={link.children}
                  isActive={location.startsWith(link.href)}
                />
              ) : (
                <Link key={link.href} href={link.href}>
                  <button className={cn(
                    "flex items-center gap-1 px-3 py-2 rounded-lg font-display text-sm font-medium transition-all duration-200",
                    "text-foreground hover:text-primary hover:bg-primary/8",
                    location === link.href && "text-primary font-semibold"
                  )}>
                    {link.label}
                  </button>
                </Link>
              )
            )}
          </nav>

          {/* CTAs desktop */}
          <div className="hidden lg:flex items-center gap-2">
            <Link href="/contacto">
              <Button variant="ghost" size="sm" className="font-display font-medium rounded-full text-foreground hover:text-primary">
                Contacto
              </Button>
            </Link>
            <Link href="/presupuesto">
              <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full px-5 shadow-md">
                Solicitar Presupuesto
              </Button>
            </Link>
            <CartIcon />
          </div>
          {/* Botón hamburguesa mobile */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden p-2 rounded-lg transition-colors text-foreground hover:bg-muted"
          >
            {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Menú mobile ───────────────────────────────────────────── */}
      <div className={cn(
        "lg:hidden bg-white border-t border-border shadow-xl overflow-hidden transition-all duration-300",
        isOpen ? "max-h-[80vh] overflow-y-auto" : "max-h-0"
      )}>
        <div className="container py-4 space-y-1">
          {navLinks.map((link) => (
            <div key={link.href}>
              <div className="flex items-center justify-between">
                {/* El label siempre navega a la ruta principal del ítem */}
                <button
                  className="flex-1 text-left px-4 py-3 rounded-xl hover:bg-muted font-display font-medium text-foreground cursor-pointer"
                  onClick={() => mobileNavigate(link.href)}
                >
                  {link.label}
                </button>
                {/* Si tiene hijos, el chevron expande/colapsa el submenú */}
                {link.children && (
                  <button
                    className="p-3 text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMobile(expandedMobile === link.label ? null : link.label);
                    }}
                  >
                    <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", expandedMobile === link.label && "rotate-180")} />
                  </button>
                )}
              </div>
              {link.children && expandedMobile === link.label && (
                <div className="ml-4 space-y-0.5 pb-2">
                  {link.children.map((child) => (
                    <button
                      key={child.href}
                      onClick={() => mobileNavigate(child.href)}
                      className="w-full text-left px-4 py-2.5 text-sm font-display text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg cursor-pointer transition-colors block"
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pt-3 border-t border-border space-y-2">
            <Button variant="outline" className="w-full font-display font-medium rounded-full" onClick={() => mobileNavigate("/contacto")}>
              Contacto
            </Button>
            <Button className="w-full bg-accent hover:bg-accent/90 text-white font-display font-semibold rounded-full" onClick={() => mobileNavigate("/presupuesto")}>
              Solicitar Presupuesto
            </Button>
          </div>
        </div>
      </div>
    </header>
    {/* CartDrawer: fuera del header para no quedar cortado por overflow:hidden */}
    <CartDrawer />
    </>
  );
}
