import { Link } from "wouter";
import { ChevronRight, Cookie } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";

export default function PoliticaCookies() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Política de Cookies</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <Cookie className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">Política de Cookies</h1>
              <p className="text-white/55 text-sm mt-1">Última actualización: marzo 2026</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="bg-[oklch(0.11_0.02_240)] py-16">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10">

            <LegalSection number="1" title="¿Qué son las cookies?">
              <p>
                Las cookies son pequeños archivos de texto que los sitios web almacenan en el dispositivo del usuario
                cuando este los visita. Permiten que el sitio recuerde las acciones y preferencias del usuario durante
                un período de tiempo, de modo que no tenga que volver a introducirlas cada vez que regrese al sitio o
                navegue de una página a otra.
              </p>
            </LegalSection>

            <LegalSection number="2" title="Cookies utilizadas en este sitio web">
              <p>
                El sitio web <strong>www.nayadeexperiences.es</strong> utiliza los siguientes tipos de cookies:
              </p>

              <h3 className="text-white font-semibold mt-6 mb-3">2.1 Cookies técnicas (necesarias)</h3>
              <p>
                Son imprescindibles para el correcto funcionamiento del sitio web. Permiten la navegación y el uso de
                las funciones básicas, como la gestión de la sesión de usuario y el proceso de reserva. Sin estas
                cookies, el sitio web no puede funcionar correctamente.
              </p>
              <CookieTable rows={[
                ["session_token", "Propia", "Sesión", "Mantiene la sesión del usuario autenticado en el panel de gestión."],
                ["csrf_token", "Propia", "Sesión", "Protección contra ataques CSRF en formularios."],
                ["cart_id", "Propia", "7 días", "Identifica el carrito de compra del usuario."],
              ]} />

              <h3 className="text-white font-semibold mt-6 mb-3">2.2 Cookies analíticas</h3>
              <p>
                Permiten cuantificar el número de usuarios y analizar su comportamiento de navegación para mejorar
                los servicios ofrecidos. Los datos recogidos son anónimos y no permiten identificar al usuario.
              </p>
              <CookieTable rows={[
                ["_ga", "Google Analytics", "2 años", "Distingue usuarios únicos para análisis de tráfico."],
                ["_ga_*", "Google Analytics", "2 años", "Mantiene el estado de la sesión analítica."],
                ["_gid", "Google Analytics", "24 horas", "Distingue usuarios para análisis de tráfico diario."],
              ]} />

              <h3 className="text-white font-semibold mt-6 mb-3">2.3 Cookies de preferencias</h3>
              <p>
                Permiten recordar las preferencias del usuario (como el idioma o la región) para personalizar
                la experiencia de navegación.
              </p>
              <CookieTable rows={[
                ["lang_pref", "Propia", "1 año", "Almacena el idioma preferido del usuario."],
                ["cookie_consent", "Propia", "1 año", "Registra si el usuario ha aceptado el uso de cookies."],
              ]} />
            </LegalSection>

            <LegalSection number="3" title="Cookies de terceros">
              <p>
                Este sitio web puede utilizar servicios de terceros que instalan sus propias cookies. A continuación
                se detallan los principales proveedores:
              </p>
              <InfoTable rows={[
                ["Google Analytics", "Análisis de tráfico web. Política: policies.google.com/privacy"],
                ["Google Maps", "Visualización de mapas e integración de ubicaciones. Política: policies.google.com/privacy"],
                ["Redsys / Banco Sabadell", "Pasarela de pago seguro. No instala cookies propias en el dominio del sitio."],
              ]} />
            </LegalSection>

            <LegalSection number="4" title="Cómo gestionar las cookies">
              <p>
                El usuario puede configurar su navegador para aceptar, rechazar o eliminar las cookies en cualquier
                momento. A continuación se indican los enlaces a las instrucciones de los navegadores más habituales:
              </p>
              <ul>
                <li>
                  <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline">Google Chrome</a>
                </li>
                <li>
                  <a href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias" target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline">Mozilla Firefox</a>
                </li>
                <li>
                  <a href="https://support.apple.com/es-es/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline">Apple Safari</a>
                </li>
                <li>
                  <a href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline">Microsoft Edge</a>
                </li>
              </ul>
              <p>
                Tenga en cuenta que deshabilitar determinadas cookies puede afectar al correcto funcionamiento del
                sitio web y a la disponibilidad de algunos servicios.
              </p>
            </LegalSection>

            <LegalSection number="5" title="Base legal del tratamiento">
              <p>
                El uso de cookies técnicas se basa en el interés legítimo del responsable del tratamiento para
                garantizar el correcto funcionamiento del sitio web (art. 6.1.f RGPD). El uso de cookies analíticas
                y de preferencias se basa en el consentimiento del usuario (art. 6.1.a RGPD), que puede ser retirado
                en cualquier momento sin que ello afecte a la licitud del tratamiento previo.
              </p>
            </LegalSection>

            <LegalSection number="6" title="Transferencias internacionales">
              <p>
                Algunos de los proveedores de cookies mencionados (Google Analytics) pueden transferir datos a
                servidores ubicados fuera del Espacio Económico Europeo. Dichas transferencias están amparadas por
                las cláusulas contractuales tipo aprobadas por la Comisión Europea o por el Marco de Privacidad de
                Datos UE-EE.UU.
              </p>
            </LegalSection>

            <LegalSection number="7" title="Actualizaciones de esta política">
              <p>
                Nayade Experiences podrá modificar la presente Política de Cookies para adaptarla a cambios
                legislativos, técnicos o de los servicios prestados. Se recomienda al usuario revisar periódicamente
                esta política. La fecha de última actualización figura siempre en el encabezado del documento.
              </p>
            </LegalSection>

            <LegalSection number="8" title="Más información">
              <p>
                Para cualquier consulta sobre el uso de cookies, puede contactar con nosotros en{" "}
                <a href="mailto:reservas@nayadeexperiences.es" className="text-accent hover:underline">
                  reservas@nayadeexperiences.es
                </a>. Para más información sobre el tratamiento de sus datos personales, consulte nuestra{" "}
                <Link href="/privacidad">
                  <span className="text-accent hover:underline cursor-pointer">Política de Privacidad</span>
                </Link>.
              </p>
            </LegalSection>

          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function LegalSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-accent/20 text-accent text-sm font-bold flex items-center justify-center flex-shrink-0">
          {number}
        </span>
        {title}
      </h2>
      <div className="text-white/70 leading-relaxed space-y-3 pl-11">
        {children}
      </div>
    </div>
  );
}

function InfoTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
      {rows.map(([label, value], i) => (
        <div key={i} className={`flex gap-4 px-5 py-3 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
          <span className="text-white/50 text-sm font-medium w-48 flex-shrink-0">{label}</span>
          <span className="text-white/80 text-sm">{value}</span>
        </div>
      ))}
    </div>
  );
}

function CookieTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
      <div className="flex gap-4 px-5 py-2 bg-white/10">
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-32 flex-shrink-0">Cookie</span>
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-28 flex-shrink-0">Proveedor</span>
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-24 flex-shrink-0">Duración</span>
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider flex-1">Finalidad</span>
      </div>
      {rows.map(([name, provider, duration, purpose], i) => (
        <div key={i} className={`flex gap-4 px-5 py-3 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
          <span className="text-accent text-sm font-mono w-32 flex-shrink-0">{name}</span>
          <span className="text-white/70 text-sm w-28 flex-shrink-0">{provider}</span>
          <span className="text-white/70 text-sm w-24 flex-shrink-0">{duration}</span>
          <span className="text-white/70 text-sm flex-1">{purpose}</span>
        </div>
      ))}
    </div>
  );
}
