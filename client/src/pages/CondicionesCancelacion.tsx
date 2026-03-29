import { Link } from "wouter";
import { ChevronRight, AlertTriangle } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";

export default function CondicionesCancelacion() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="bg-[oklch(0.14_0.03_240)] py-16">
        <div className="container">
          <div className="flex items-center gap-2 text-white/50 text-sm mb-4">
            <Link href="/" className="hover:text-amber-400 transition-colors">Inicio</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-white/80">Condiciones de Cancelación</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white">Condiciones de Cancelación</h1>
              <p className="text-white/55 text-sm mt-1">Última actualización: marzo 2026</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="bg-[oklch(0.11_0.02_240)] py-16">
        <div className="container max-w-4xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10">

            {/* Intro */}
            <div className="rounded-xl border border-accent/30 bg-accent/5 px-6 py-5">
              <p className="text-white/80 leading-relaxed">
                En todo momento el usuario o consumidor puede desistir de los servicios solicitados o contratados,
                teniendo derecho a la devolución de las cantidades que hubiera abonado, tanto si se trata del precio
                total como del anticipo previsto, pero deberá indemnizar a Nayade Experiences por los conceptos que
                a continuación se indican.
              </p>
            </div>

            <LegalSection number="1" title="Ejercicio del derecho de cancelación">
              <p>
                Para ejercer su derecho de cancelación, el cliente deberá remitir una solicitud escrita a través del
                formulario habilitado en{" "}
                <Link href="/solicitar-anulacion">
                  <span className="text-accent hover:underline cursor-pointer">Solicitar Anulación</span>
                </Link>{" "}
                o mediante correo electrónico a{" "}
                <a href="mailto:reservas@nayadeexperiences.es" className="text-accent hover:underline">
                  reservas@nayadeexperiences.es
                </a>{" "}
                indicando el localizador de reserva.
              </p>
              <AlertBox>
                <strong>Importante:</strong> No se aceptan cancelaciones o cambios por teléfono. Todas las
                cancelaciones o cambios deben realizarse por escrito, ya sea a través del formulario online o
                mediante correo electrónico.
              </AlertBox>
            </LegalSection>

            <LegalSection number="2" title="Plazos y gastos de cancelación">
              <p>
                Los plazos y condiciones de cancelación varían según el tipo de servicio contratado:
              </p>
              <CancellationTable rows={[
                ["Actividades acuáticas y de aventura", "Más de 72 h antes", "Cancelación gratuita. Bono por el importe total."],
                ["Actividades acuáticas y de aventura", "Menos de 72 h antes", "Cargo del 100% del importe. Sin reembolso."],
                ["Hotel Náyade", "Más de 48 h antes del check-in", "Cancelación gratuita. Bono por el importe total."],
                ["Hotel Náyade", "Menos de 48 h antes del check-in", "Cargo equivalente a 1 noche de alojamiento."],
                ["SPA & Wellness", "Más de 24 h antes", "Cancelación gratuita. Bono por el importe total."],
                ["SPA & Wellness", "Menos de 24 h antes", "Cargo del 100% del importe. Sin reembolso."],
                ["Restaurantes", "Más de 24 h antes", "Cancelación gratuita."],
                ["Restaurantes", "Menos de 24 h antes", "Cargo del 100% del importe. Sin reembolso."],
              ]} />
              <p>
                La referencia a la política de cancelación con devolución conforme a la Ley General para la Defensa
                de los Consumidores y Usuarios es dentro de los 14 días que marca el texto legal.
              </p>
            </LegalSection>

            <LegalSection number="3" title="Periodos de no cancelación">
              <p>
                Durante los siguientes periodos de alta temporada <strong>no se admiten cambios, anulaciones,
                devoluciones ni modificaciones de fechas</strong>. En estos casos se aplicará el cargo del 100%
                del total de la reserva:
              </p>
              <InfoTable rows={[
                ["Navidad y Año Nuevo", "Del 22 de diciembre al 6 de enero"],
                ["Temporada de invierno", "Del 1 al 28 de febrero"],
              ]} />
            </LegalSection>

            <LegalSection number="4" title="Pago fraccionado y compromisos de pago">
              <p>
                En los casos donde Nayade Experiences ofrezca el pago fraccionado con compromiso de pago, el cliente
                recibirá en el comprobante de compra los hitos de los pagos a realizar. Además, nuestro sistema le
                enviará un recordatorio de pago próximo a la fecha de vencimiento.
              </p>
              <p>
                Si el cliente no cumple con su compromiso de pago de los diferentes recibos acordados en un plazo
                de <strong>48 horas</strong> tras el envío del recordatorio, Nayade Experiences se reserva el
                derecho a la cancelación completa de la reserva, sin que el cliente tenga derecho a reclamación
                ni a reembolso de cantidad alguna.
              </p>
              <AlertBox>
                Rogamos esté pendiente de los pagos a realizar para evitar la cancelación automática de su reserva.
              </AlertBox>
            </LegalSection>

            <LegalSection number="5" title="Garantía de precio">
              <p>
                Debido a la fluctuación de precios en el sector turístico, Nayade Experiences solo puede garantizar
                el precio de los alojamientos durante un máximo de <strong>12 horas</strong> desde la solicitud.
                Si la confirmación se produce pasado este plazo y los precios se han modificado, Nayade Experiences
                se reserva el derecho a cobrar la diferencia o, en su defecto, a cancelar la reserva de inmediato
                y proceder a la devolución íntegra del importe pagado.
              </p>
            </LegalSection>

            <LegalSection number="6" title="No presentación y salida anticipada">
              <p>
                En caso de salida anticipada o no presentación al servicio contratado, se aplicará el cargo del
                <strong> 100% del importe</strong> de la estancia y los servicios reservados, sin derecho a
                devolución ni compensación.
              </p>
              <p>
                Es responsabilidad del cliente llegar a la hora marcada para los servicios contratados. Nayade
                Experiences no se hace responsable de los perjuicios derivados de la impuntualidad del cliente.
              </p>
            </LegalSection>

            <LegalSection number="7" title="Cancelación por causas meteorológicas o de seguridad">
              <p>
                Las actividades acuáticas y al aire libre están sujetas a condiciones meteorológicas. En caso de
                que Nayade Experiences cancele una actividad por causas meteorológicas o de seguridad, el cliente
                tendrá derecho a:
              </p>
              <ul>
                <li>Reprogramar la actividad en otra fecha disponible sin coste adicional.</li>
                <li>Recibir un bono por el importe íntegro, válido durante la temporada en curso.</li>
                <li>Solicitar el reembolso total del importe abonado.</li>
              </ul>
              <p>
                En caso de cierre de instalaciones por causas ajenas a Nayade Experiences, se procederá a la
                emisión de un bono canjeable en la misma temporada o a la devolución del importe, a excepción
                de las reservas con alojamiento, que tienen su propia política de cancelación.
              </p>
            </LegalSection>

            <LegalSection number="8" title="Cancelación por fuerza mayor y causas COVID">
              <p>
                Tal y como recoge el artículo 103 del Real Decreto Legislativo 1/2007, de 16 de noviembre, por
                el que se aprueba el texto refundido de la Ley General para la Defensa de los Consumidores y
                Usuarios, <strong>no será válido el derecho de desistimiento</strong> de la actividad contratada
                al tratarse de una actividad de esparcimiento con fecha de ejecución específica.
              </p>
              <p>
                En relación con cancelaciones por restricciones sanitarias o de movilidad:
              </p>
              <ul>
                <li>
                  Cancelaciones con <strong>más de 10 días antes de la llegada</strong>: cancelación gratuita
                  con emisión de bono por el importe total.
                </li>
                <li>
                  Cancelaciones con <strong>menos de 10 días antes de la llegada</strong>: cargo completo,
                  excepto si existe prohibición oficial de abandonar la provincia de origen, debidamente
                  acreditada con hoja de empadronamiento y certificado gubernamental de la prohibición, en
                  cuyo caso se emitirá un bono por el importe íntegro.
                </li>
              </ul>
              <AlertBox>
                Es responsabilidad del cliente conocer y revisar las restricciones vigentes en el destino en
                el momento de realizar la reserva. Las condiciones de cancelación por restricciones no serán
                aplicables si, en la fecha de la reserva, la restricción ya estaba publicada aunque el cliente
                no fuese conocedor de ella. Esta cláusula es extensible a todos los integrantes beneficiarios
                del bono.
              </AlertBox>
            </LegalSection>

            <LegalSection number="9" title="Cursillos y actividades grupales">
              <p>
                En el caso de cursillos y actividades grupales, Nayade Experiences se reserva el derecho a
                cancelar en cualquier momento por nivel bajo de participantes. En ese caso, se devolverá el
                importe de la reserva íntegramente, sin que ello dé lugar a ningún otro tipo de reclamación
                por parte del cliente.
              </p>
            </LegalSection>

            <LegalSection number="10" title="Compras a través de plataformas de terceros">
              <p>
                Las compras realizadas a través de plataformas de cupones o descuento de terceros quedan
                exentas de esta política. Una vez confirmadas, no podrán ser anuladas bajo ningún concepto.
                Para cualquier incidencia relacionada con estas compras, el cliente deberá contactar
                directamente con la plataforma de origen.
              </p>
            </LegalSection>

            <LegalSection number="11" title="Responsabilidad del cliente">
              <p>
                Es responsabilidad del viajero la comprobación de los servicios contratados, debiendo
                reconfirmar los mismos con anterioridad al inicio de la actividad o estancia. El comprobante
                de reserva es un documento personal que el cliente deberá conservar durante toda su visita.
              </p>
              <p>
                Nayade Experiences no se hace responsable de los perjuicios derivados del desconocimiento
                por parte del cliente de las condiciones y restricciones aplicables en el momento de la
                contratación.
              </p>
            </LegalSection>

            <LegalSection number="12" title="Seguro de cancelación">
              <p>
                Dado que no se aceptan cancelaciones bajo ningún concepto por causas de fuerza mayor no
                contempladas expresamente en esta política, <strong>se recomienda encarecidamente contratar
                un seguro de cancelación de viajes</strong> que cubra las contingencias que pudieran
                impedir la asistencia al servicio contratado.
              </p>
            </LegalSection>

            <LegalSection number="13" title="Contacto para cancelaciones">
              <p>
                Para gestionar cualquier cancelación o modificación de reserva, utilice exclusivamente
                los canales escritos:
              </p>
              <InfoTable rows={[
                ["Formulario online", "nayadeexperiences.es/solicitar-anulacion"],
                ["Email", "reservas@nayadeexperiences.es"],
                ["Horario de atención", "Lun–Dom · 10:00–20:00 (Temporada Abril–Octubre)"],
              ]} />
              <p>
                Para más información sobre el proceso de anulación, consulte también nuestra{" "}
                <Link href="/terminos">
                  <span className="text-accent hover:underline cursor-pointer">Términos y Condiciones</span>
                </Link>{" "}
                y la{" "}
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

function AlertBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-amber-200/80 text-sm leading-relaxed">
      {children}
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

function CancellationTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 overflow-hidden">
      <div className="flex gap-4 px-5 py-2 bg-white/10">
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-52 flex-shrink-0">Servicio</span>
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider w-44 flex-shrink-0">Plazo</span>
        <span className="text-white/50 text-xs font-semibold uppercase tracking-wider flex-1">Condición</span>
      </div>
      {rows.map(([service, timing, condition], i) => (
        <div key={i} className={`flex gap-4 px-5 py-3 ${i % 2 === 0 ? "bg-white/5" : "bg-transparent"}`}>
          <span className="text-white/70 text-sm w-52 flex-shrink-0">{service}</span>
          <span className="text-accent text-sm w-44 flex-shrink-0">{timing}</span>
          <span className="text-white/70 text-sm flex-1">{condition}</span>
        </div>
      ))}
    </div>
  );
}
