import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronDown, Mountain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Inicio", href: "/" },
  {
    label: "Experiencias",
    href: "/experiencias",
    children: [
      { label: "Nieve & Ski", href: "/experiencias/nieve-ski" },
      { label: "Aventura Acuática", href: "/experiencias/aventura-acuatica" },
      { label: "Multiaventura", href: "/experiencias/multiaventura" },
      { label: "Experiencias Premium", href: "/experiencias/premium" },
    ],
  },
  { label: "Ubicaciones", href: "/ubicaciones" },
  { label: "Galería", href: "/galeria" },
  { label: "Contacto", href: "/contacto" },
];

export default function PublicNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setActiveDropdown(null);
  }, [location]);

  const isHome = location === "/";

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
        scrolled || !isHome
          ? "bg-white/95 backdrop-blur-md shadow-sm border-b border-border/50"
          : "bg-transparent"
      )}
    >
      <div className="container">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
              <Mountain className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span
                className={cn(
                  "font-display font-bold text-lg tracking-tight transition-colors",
                  scrolled || !isHome ? "text-foreground" : "text-white"
                )}
              >
                NAYADE
              </span>
              <span
                className={cn(
                  "text-xs font-medium tracking-widest uppercase transition-colors",
                  scrolled || !isHome ? "text-accent" : "text-white/80"
                )}
              >
                Experiences
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <div
                key={link.href}
                className="relative"
                onMouseEnter={() => link.children && setActiveDropdown(link.label)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <Link
                  href={link.href}
                  className={cn(
                    "flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                    scrolled || !isHome
                      ? "text-foreground hover:text-accent hover:bg-accent/10"
                      : "text-white/90 hover:text-white hover:bg-white/10",
                    location === link.href && (scrolled || !isHome) && "text-accent"
                  )}
                >
                  {link.label}
                  {link.children && (
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 transition-transform",
                        activeDropdown === link.label && "rotate-180"
                      )}
                    />
                  )}
                </Link>

                {/* Dropdown */}
                {link.children && activeDropdown === link.label && (
                  <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-border/50 overflow-hidden animate-fade-up">
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="block px-4 py-3 text-sm text-foreground hover:bg-accent/10 hover:text-accent transition-colors border-b border-border/30 last:border-0"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* CTA Button */}
          <div className="hidden lg:flex items-center gap-3">
            <Button
              asChild
              className="bg-gold-gradient text-white hover:opacity-90 shadow-md font-semibold px-6"
            >
              <Link href="/presupuesto">Solicitar Presupuesto</Link>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "lg:hidden p-2 rounded-lg transition-colors",
              scrolled || !isHome
                ? "text-foreground hover:bg-muted"
                : "text-white hover:bg-white/10"
            )}
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="lg:hidden bg-white border-t border-border/50 shadow-lg">
          <div className="container py-4 space-y-1">
            {navLinks.map((link) => (
              <div key={link.href}>
                <Link
                  href={link.href}
                  className="block px-4 py-3 rounded-lg text-sm font-medium text-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                >
                  {link.label}
                </Link>
                {link.children && (
                  <div className="ml-4 space-y-1 mt-1">
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="block px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="pt-3 border-t border-border/50">
              <Button
                asChild
                className="w-full bg-gold-gradient text-white hover:opacity-90 font-semibold"
              >
                <Link href="/presupuesto">Solicitar Presupuesto</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
