import { Link } from "wouter";
import { Anchor, Mail, Phone, MapPin, Instagram, Facebook, Youtube, Clock } from "lucide-react";

const colExperiencias = [
  { label: "Blob Jump", href: "/experiencias/blob-jump" },
  { label: "Banana Ski & Donuts", href: "/experiencias/banana-ski-donuts" },
  { label: "Cableski & Wakeboard", href: "/experiencias/cableski-wakeboard" },
  { label: "Canoas & Kayaks", href: "/experiencias/canoas-kayaks" },
  { label: "Paddle Surf", href: "/experiencias/paddle-surf" },
  { label: "Paseos en Barco", href: "/experiencias/paseos-barco" },
  { label: "Minimotos Eléctricas", href: "/experiencias/minimotos" },
  { label: "Aventura Hinchable", href: "/experiencias/aventura-hinchable" },
];

const colPacks = [
  { label: "Day Pass Náyade", href: "/packs/day-pass-nayade" },
  { label: "Pack Discovery", href: "/packs/pack-discovery" },
  { label: "Pack Aventura", href: "/packs/pack-aventura" },
  { label: "Pack Adrenalina", href: "/packs/pack-adrenalina" },
  { label: "Pack Lago Gourmet", href: "/packs/pack-lago-gourmet" },
  { label: "Packs Escolares", href: "/packs/escolares" },
  { label: "Team Building", href: "/packs/corporativo" },
];

const colServicios = [
  { label: "Hotel Náyade ★★★", href: "/hotel" },
  { label: "SPA & Wellness", href: "/spa" },
  { label: "El Galeón", href: "/restaurantes/el-galeon" },
  { label: "La Cabaña del Lago", href: "/restaurantes/la-cabana" },
  { label: "Nassau Bar & Music", href: "/restaurantes/nassau-bar" },
  { label: "Galería de Fotos", href: "/galeria" },
  { label: "Ubicación", href: "/ubicacion" },
  { label: "Solicitar Presupuesto", href: "/presupuesto" },
];

export default function PublicFooter() {
  return (
    <footer className="bg-lago-dark text-white">
      {/* Main footer */}
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <Link href="/" className="inline-block mb-5 cursor-pointer">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade-blanco_3dc99989.png"
                alt="Náyade Experiences"
                className="h-20 w-auto object-contain"
              />
            </Link>
            <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-xs">
              El destino de aventuras acuáticas y bienestar en el embalse de Los Ángeles de San Rafael, Segovia. A solo 45 minutos de Madrid.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                <span className="text-white/65">Complejo Los Ángeles de San Rafael<br />40420 Segovia, España</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-accent flex-shrink-0" />
                <a href="tel:+34919041947" className="text-white/65 hover:text-accent transition-colors">+34 919 041 947</a>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-accent flex-shrink-0" />
                <a href="mailto:hola@nayadeexperiences.es" className="text-white/65 hover:text-accent transition-colors">hola@nayadeexperiences.es</a>
              </div>
              <div className="flex items-start gap-3 text-sm">
                <Clock className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                <span className="text-white/65">Lun–Dom · 10:00 – 20:00<br />Temporada Abril — Octubre</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <a href="https://instagram.com/nayadeexperiences" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-accent flex items-center justify-center transition-colors">
                <Instagram className="w-4 h-4 text-white" />
              </a>
              <a href="https://facebook.com/nayadeexperiences" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-accent flex items-center justify-center transition-colors">
                <Facebook className="w-4 h-4 text-white" />
              </a>
              <a href="https://youtube.com/@nayadeexperiences" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-accent flex items-center justify-center transition-colors">
                <Youtube className="w-4 h-4 text-white" />
              </a>
            </div>
          </div>

          {/* Experiencias */}
          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4 text-accent">Experiencias</h4>
            <ul className="space-y-2">
              {colExperiencias.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <span className="text-white/55 hover:text-accent text-sm font-display transition-colors cursor-pointer">{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Packs */}
          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4 text-accent">Packs</h4>
            <ul className="space-y-2">
              {colPacks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <span className="text-white/55 hover:text-accent text-sm font-display transition-colors cursor-pointer">{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Servicios */}
          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4 text-accent">Servicios</h4>
            <ul className="space-y-2">
              {colServicios.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>
                    <span className="text-white/55 hover:text-accent text-sm font-display transition-colors cursor-pointer">{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="container py-5 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-white/40 text-xs font-display text-center md:text-left">
            © {new Date().getFullYear()} Náyade Experiences · Todos los derechos reservados · Los Ángeles de San Rafael, Segovia
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacidad">
              <span className="text-white/40 hover:text-white/70 text-xs font-display transition-colors cursor-pointer">Privacidad</span>
            </Link>
            <Link href="/terminos">
              <span className="text-white/40 hover:text-white/70 text-xs font-display transition-colors cursor-pointer">Términos</span>
            </Link>
            <Link href="/cookies">
              <span className="text-white/40 hover:text-white/70 text-xs font-display transition-colors cursor-pointer">Cookies</span>
            </Link>
            <span className="text-white/20">·</span>
            <Link href="/admin">
              <span className="text-white/25 hover:text-white/60 text-xs font-display transition-colors cursor-pointer flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Acceso Gestores
              </span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
