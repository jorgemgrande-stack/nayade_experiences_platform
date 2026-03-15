import { Link } from "wouter";
import { Mountain, Mail, Phone, MapPin, Instagram, Facebook, Youtube } from "lucide-react";

export default function PublicFooter() {
  return (
    <footer className="bg-[oklch(0.12_0.03_240)] text-white">
      {/* Main Footer */}
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gold-gradient flex items-center justify-center">
                <Mountain className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-display font-bold text-lg tracking-tight text-white">NAYADE</span>
                <span className="text-xs font-medium tracking-widest uppercase text-amber-400">Experiences</span>
              </div>
            </Link>
            <p className="text-sm text-white/60 leading-relaxed mb-6">
              Experiencias de aventura únicas diseñadas para quienes buscan vivir momentos extraordinarios en los mejores destinos de España.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-amber-500/20 hover:text-amber-400 flex items-center justify-center transition-all"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-amber-500/20 hover:text-amber-400 flex items-center justify-center transition-all"
              >
                <Facebook className="w-4 h-4" />
              </a>
              <a
                href="https://youtube.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-amber-500/20 hover:text-amber-400 flex items-center justify-center transition-all"
              >
                <Youtube className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Experiencias */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-widest text-amber-400 mb-5">
              Experiencias
            </h4>
            <ul className="space-y-3">
              {[
                { label: "Nieve & Ski", href: "/experiencias/nieve-ski" },
                { label: "Aventura Acuática", href: "/experiencias/aventura-acuatica" },
                { label: "Multiaventura", href: "/experiencias/multiaventura" },
                { label: "Experiencias Premium", href: "/experiencias/premium" },
                { label: "Eventos Corporativos", href: "/experiencias/corporativos" },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-white/60 hover:text-amber-400 transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Empresa */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-widest text-amber-400 mb-5">
              Empresa
            </h4>
            <ul className="space-y-3">
              {[
                { label: "Sobre Nosotros", href: "/sobre-nosotros" },
                { label: "Ubicaciones", href: "/ubicaciones" },
                { label: "Galería", href: "/galeria" },
                { label: "Blog", href: "/blog" },
                { label: "Trabaja con Nosotros", href: "/trabaja-con-nosotros" },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-white/60 hover:text-amber-400 transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h4 className="font-display font-semibold text-sm uppercase tracking-widest text-amber-400 mb-5">
              Contacto
            </h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-sm text-white/60">
                  Nayade Experiences<br />
                  España
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-amber-400 shrink-0" />
                <a href="tel:+34000000000" className="text-sm text-white/60 hover:text-amber-400 transition-colors">
                  +34 000 000 000
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-amber-400 shrink-0" />
                <a href="mailto:info@nayadeexperiences.es" className="text-sm text-white/60 hover:text-amber-400 transition-colors">
                  info@nayadeexperiences.es
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="container py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} Nayade Experiences. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacidad" className="text-xs text-white/40 hover:text-amber-400 transition-colors">
              Política de Privacidad
            </Link>
            <Link href="/terminos" className="text-xs text-white/40 hover:text-amber-400 transition-colors">
              Términos y Condiciones
            </Link>
            <Link href="/cookies" className="text-xs text-white/40 hover:text-amber-400 transition-colors">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
