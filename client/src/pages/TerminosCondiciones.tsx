import { Link } from "wouter";
import { ChevronRight, FileText } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";

export default function TerminosCondiciones() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Términos y Condiciones</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <FileText className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">Términos y Condiciones</h1>
              <p className="text-white/55 text-sm mt-1">Última actualización: marzo 2026</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="bg-[oklch(0.11_0.02_240)] py-16">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10">

            <LegalSection number="1" title="Identificación del titular">
              <p>
                En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y
                Comercio Electrónico (LSSI-CE), se informa que el presente sitio web es titularidad de:
              </p>
              <InfoTable rows={[
                ["Denominación social", "Iron Elephant Consulting S.L."],
                ["CIF", "B26987875"],
                ["Domicilio", "C/ Corazón de María 57, 1º D · 28002 Madrid"],
                ["Teléfono", "+34 911 67 51 89"],
                ["Email", "administracion@nayadeexperiences.es"],
                ["Sitio web", "www.nayadeexperiences.es"],
              ]} />
            </LegalSection>

            <LegalSection number="2" title="Objeto y ámbito de aplicación">
              <p>
                Las presentes Condiciones Generales regulan el acceso y uso del sitio web <strong>www.nayadeexperiences.es</strong>,
                así como la contratación de los servicios ofrecidos por Nayade Experiences: actividades acuáticas y de aventura,
                packs de experiencias, alojamiento en Hotel Náyade, servicios de SPA y reservas en restaurantes.
              </p>
              <p>
                El acceso al sitio web implica la aceptación plena y sin reservas de las presentes condiciones. Si el usuario
                no está de acuerdo con alguna de ellas, deberá abstenerse de utilizar el sitio web y sus servicios.
              </p>
            </LegalSection>

            <LegalSection number="3" title="Contratación de servicios">
              <p>
                La contratación de cualquier servicio a través del sitio web se formaliza mediante los siguientes pasos:
              </p>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Selección del servicio o pack deseado y configuración de opciones (fecha, número de personas, extras).</li>
                <li>Revisión del resumen del pedido y precio total.</li>
                <li>Cumplimentación de los datos personales del titular de la reserva.</li>
                <li>Pago seguro mediante la pasarela Redsys (tarjeta de crédito/débito).</li>
                <li>Recepción de confirmación por correo electrónico con el localizador de reserva.</li>
              </ol>
              <p>
                El contrato se perfecciona en el momento en que Nayade Experiences confirma la reserva mediante correo
                electrónico. Hasta ese momento, la reserva tendrá carácter provisional.
              </p>
            </LegalSection>

            <LegalSection number="4" title="Precios y forma de pago">
              <p>
                Todos los precios publicados en el sitio web incluyen el IVA vigente y están expresados en euros (€).
                Nayade Experiences se reserva el derecho a modificar los precios en cualquier momento, si bien los cambios
                no afectarán a las reservas ya confirmadas.
              </p>
              <p>
                El pago se realiza íntegramente en el momento de la reserva a través de la pasarela de pago segura Redsys.
                Nayade Experiences no almacena datos de tarjetas bancarias; toda la información de pago es gestionada
                directamente por la entidad bancaria.
              </p>
            </LegalSection>

            <LegalSection number="5" title="Política de cancelación y anulaciones">
              <p>
                Las condiciones de cancelación varían según el tipo de servicio contratado:
              </p>
              <InfoTable rows={[
                ["Actividades acuáticas y packs", "Cancelación gratuita hasta 72 h antes de la actividad. Cancelaciones posteriores: sin reembolso."],
                ["Hotel Náyade", "Cancelación gratuita hasta 48 h antes del check-in. Cancelaciones posteriores: cargo de 1 noche."],
                ["SPA & Wellness", "Cancelación gratuita hasta 24 h antes del tratamiento. Cancelaciones posteriores: sin reembolso."],
                ["Restaurantes", "Cancelación gratuita hasta 24 h antes de la reserva. Cancelaciones posteriores: sin reembolso."],
              ]} />
              <p>
                Para solicitar una cancelación, el usuario deberá utilizar el formulario disponible en{" "}
                <Link href="/solicitar-anulacion">
                  <span className="text-accent hover:underline cursor-pointer">Solicitar Anulación</span>
                </Link>{" "}
                o contactar directamente con reservas@nayadeexperiences.es indicando el localizador de reserva.
              </p>
              <p>
                En caso de cancelación por causas de fuerza mayor debidamente acreditadas (enfermedad grave, fallecimiento
                de familiar directo, catástrofe natural), Nayade Experiences estudiará cada caso de forma individualizada
                y podrá ofrecer un bono compensatorio o la devolución total del importe.
              </p>
            </LegalSection>

            <LegalSection number="6" title="Condiciones meteorológicas">
              <p>
                Las actividades acuáticas y al aire libre están sujetas a condiciones meteorológicas. En caso de que
                Nayade Experiences cancele una actividad por causas meteorológicas o de seguridad, el cliente tendrá
                derecho a:
              </p>
              <ul>
                <li>Reprogramar la actividad en otra fecha disponible sin coste adicional.</li>
                <li>Recibir un bono por el importe íntegro, válido durante la temporada en curso.</li>
                <li>Solicitar el reembolso total del importe abonado.</li>
              </ul>
            </LegalSection>

            <LegalSection number="7" title="Responsabilidad y seguridad">
              <p>
                La participación en actividades acuáticas y de aventura implica riesgos inherentes. Nayade Experiences
                dispone de los seguros de responsabilidad civil y accidentes exigidos por la normativa vigente, y cuenta
                con personal cualificado y titulado para la dirección de todas las actividades.
              </p>
              <p>
                El participante declara estar en condiciones físicas adecuadas para la práctica de la actividad
                contratada y asume la responsabilidad de comunicar cualquier condición médica relevante antes del inicio
                de la actividad. Nayade Experiences podrá denegar la participación a cualquier persona que, a juicio del
                monitor responsable, no reúna las condiciones de seguridad necesarias.
              </p>
            </LegalSection>

            <LegalSection number="8" title="Menores de edad">
              <p>
                Los menores de 18 años deberán contar con la autorización expresa de sus padres o tutores legales para
                participar en las actividades. Para menores de 14 años, será imprescindible la presencia de un adulto
                responsable durante la actividad. Las edades mínimas específicas de cada actividad se indican en la
                ficha del producto.
              </p>
            </LegalSection>

            <LegalSection number="9" title="Propiedad intelectual">
              <p>
                Todos los contenidos del sitio web (textos, imágenes, logotipos, diseños, código fuente) son propiedad
                de Nayade Experiences o de sus proveedores de contenido, y están protegidos por la legislación española
                e internacional sobre propiedad intelectual e industrial. Queda prohibida su reproducción, distribución,
                comunicación pública o transformación sin autorización expresa y por escrito.
              </p>
            </LegalSection>

            <LegalSection number="10" title="Legislación aplicable y jurisdicción">
              <p>
                Las presentes condiciones se rigen por la legislación española. Para la resolución de cualquier
                controversia derivada del uso del sitio web o de la contratación de servicios, las partes se someten
                a los Juzgados y Tribunales de Segovia, con renuncia expresa a cualquier otro fuero que pudiera
                corresponderles.
              </p>
              <p>
                En caso de conflicto con consumidores y usuarios, se estará a lo dispuesto en el Real Decreto
                Legislativo 1/2007 (TRLGDCU) y demás normativa de protección al consumidor aplicable.
              </p>
            </LegalSection>

            <LegalSection number="11" title="Contacto">
              <p>
                Para cualquier consulta relacionada con las presentes condiciones, puede contactar con nosotros en:
              </p>
              <InfoTable rows={[
                ["Email", "administracion@nayadeexperiences.es"],
                ["Teléfono", "+34 911 67 51 89"],
                ["Horario de atención", "Lun–Dom · 10:00–20:00 (Temporada Abril–Octubre)"],
              ]} />
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
