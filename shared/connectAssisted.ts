/**
 * Elephant Connect con contratación asistida (decisión de Jorge del 12/11/2026: «todos los módulos Connect vigentes se
 * contratan desde el Marketplace, aunque tengan funcionalidades pendientes; misma estrategia que Elephant Net»).
 *
 * Registro de lo que hoy funciona de punta a punta («Disponible desde la puesta en marcha») y de lo que está en
 * implantación, para la tarjeta, la ficha, el contrato (compromisos de implantación) y la checklist del expediente.
 * Regla de honestidad: lo que necesita credenciales, certificación o autorización de un proveedor que aún no existe va
 * a «en implantación» con su motivo; lo que funciona con la cuenta propia del cliente se dice así en la etiqueta.
 *
 * Los Connect de contratación directa (People, Tax, Partners, Deals, Finance Sync, GEO Control: disponibles, con
 * Checkout) NO están aquí: siguen con «Contratar ahora» y sus cobros de siempre.
 *
 * Mismo formato que shared/netProducts.ts (áreas con funcionalidades `available` / `coming_soon`). Lógica pura.
 */
import type { NetArea, NetFeature } from "./netProducts";

export interface ConnectAssistedProduct {
  key: string;
  name: string;
  segment: "business";
  areas: NetArea[];
  /** Componentes de un paquete (los mismos que el catálogo, `catalog.bundleOf`). */
  bundleOf?: string[];
  /** Condición propia (costes de terceros, cuentas del cliente…). */
  note?: string;
}

const A = (label: string): NetFeature => ({ label, status: "available" });
const S = (label: string): NetFeature => ({ label, status: "coming_soon" });
const area = (title: string, ...features: NetFeature[]): NetArea => ({ title, features });

const WHATSAPP: NetArea[] = [
  area(
    "WhatsApp con IA",
    A("Bandeja de WhatsApp con tu propio número (cuenta propia de Meta)"),
    A("Estado de entrega de cada mensaje"),
    A("Respuesta libre dentro de la ventana de 24 h"),
    A("Plantillas aprobadas fuera de la ventana"),
    A("Sugerencias de respuesta con IA"),
    A("Respuesta automática con horario y tope diario"),
    A("Paso de la conversación a una persona"),
    S("Verificación del negocio, el número y las plantillas en Meta (la hace Meta con la cuenta del cliente)"),
    S("Campañas masivas por WhatsApp"),
    S("Ver fotos y documentos recibidos en el panel"),
  ),
];
const VOICE: NetArea[] = [
  area(
    "Centralita con IA",
    A("Puesta en marcha guiada con tu cuenta de Vapi"),
    A("Llamadas atendidas por tu asistente de IA"),
    A("Registro de llamadas con transcripción"),
    A("Lead y presupuesto borrador desde cada llamada"),
    A("Estadísticas y revisión de llamadas"),
    S("Telefonía y centralita propias con Netelip (pendiente del conector y de la autorización del proveedor)"),
    S("Grabaciones de la centralita Netelip"),
  ),
];
const RECEPTION: NetArea[] = [
  area(
    "Recepción con IA",
    A("Chat de recepción en tu web"),
    A("Respuestas con la información de tu negocio"),
    A("Disponibilidad orientativa con tu catálogo y horarios"),
    A("Cada solicitud llega a tu CRM"),
    A("Registro de llamadas y chats con su resultado"),
    A("Recepcionista por teléfono (cuenta propia de Vapi)"),
    S("Confirmar reservas en firme desde la conversación"),
    S("Atención por WhatsApp desde la recepción"),
  ),
];
const POS: NetArea[] = [
  area(
    "TPV Advanced",
    A("Arqueos y conciliaciones de caja avanzados"),
    A("Turnos y entrega de caja entre operadores"),
    A("Autorizaciones especiales de operaciones"),
    A("Auditoría de operaciones y correcciones"),
    A("Informes avanzados con exportación CSV"),
    S("Datáfono integrado (la conciliación bancaria es Finance Sync)"),
  ),
];
const COPILOT: NetArea[] = [
  area(
    "Copilot avanzado",
    A("Preguntas sobre ventas, reservas, ocupación y clientes"),
    A("Datos según los permisos de cada usuario"),
    A("Borradores: respuesta a cliente, descripción de producto y resumen de cliente"),
    A("Historial de conversaciones"),
    S("Acciones que escriben en el CRM"),
    S("Límite mensual propio de consumo de IA"),
  ),
];
const ADS: NetArea[] = [
  area(
    "Ads Manager",
    A("Importación de informes CSV de Meta y Google"),
    A("ROAS y coste por venta con tus ventas reales"),
    A("Ventas relacionadas con campañas (etiquetas y UTM)"),
    A("Presupuestos y avisos de gasto"),
    A("Estado de la medición (píxel, CAPI y GA4)"),
    S("Sincronización automática con Google Ads (requiere la aprobación de Google)"),
    S("Sincronización automática con Meta Ads (requiere el acceso de Meta)"),
    S("Crear, pausar o editar campañas desde el panel"),
  ),
];
const CAMPAIGNS: NetArea[] = [
  area(
    "Campañas de correo",
    A("Campañas con bloques y tu marca (cuenta propia de Brevo)"),
    A("Segmentos por etiquetas del CRM"),
    A("Solo a clientes con consentimiento comercial; bajas respetadas"),
    A("Envío de prueba, lanzamiento o programación"),
    A("Aperturas, clics y bajas en tu panel"),
    S("Pruebas A/B y envío a la mejor hora"),
    S("Segmentos de más de 5.000 destinatarios"),
  ),
];
const SEO: NetArea[] = [
  area(
    "SEO Control",
    A("Palabras clave con su posición"),
    A("Auditoría de las páginas de tu web"),
    A("Avisos de caídas y de páginas que dejan de indexarse"),
    A("Clics e impresiones de Search Console (cuenta propia de Google)"),
    S("Reseñas de Google Business Profile (requiere la aprobación de Google)"),
    S("Reseñas de TripAdvisor (requiere la clave del proveedor)"),
    S("Responder reseñas o editar tu ficha de Google"),
  ),
];
const GEO: NetArea[] = [area("GEO Control", A("Control de presencia en buscadores con IA (GEO)"))];
const AUTOMATIONS: NetArea[] = [
  area(
    "Automatizaciones avanzadas",
    A("Disparadores: oportunidad nueva, presupuesto sin respuesta, reserva y factura sin cobrar"),
    A("Condiciones y hasta cinco pasos con retardo"),
    A("Correo al cliente con tu marca"),
    A("Tareas, avisos al equipo, etapa y etiqueta del CRM"),
    A("Plantillas listas y modo de prueba sin envíos"),
    A("Historial, topes diarios y reintentos"),
    S("Acciones por WhatsApp y SMS"),
    S("Disparadores y acciones a medida"),
  ),
];
const FINANCE: NetArea[] = [
  area("Elephant Tax", A("Estimación de los modelos 303, 390, 111, 190, 200 y 202"), A("Calendario de obligaciones con avisos y portal de la gestoría")),
  area("Finance Sync", A("Importación bancaria y conciliación"), A("Asistente de configuración")),
  area("Elephant Partners", A("Proveedores, colaboradores y liquidaciones con PDF"), A("Portales de proveedores y colaboradores")),
];

export const CONNECT_ASSISTED: readonly ConnectAssistedProduct[] = [
  { key: "connect-whatsapp-ai", name: "Elephant WhatsApp AI", segment: "business", areas: WHATSAPP, note: "Requiere la cuenta de WhatsApp Business de la empresa en Meta (número y negocio verificados por Meta). Los costes de Meta se pagan aparte." },
  { key: "connect-voice", name: "Elephant Voice", segment: "business", areas: VOICE, note: "Los minutos de telefonía y el consumo de IA se facturan aparte según uso (cuenta propia del proveedor de voz)." },
  { key: "connect-reception-ai", name: "Elephant Reception AI", segment: "business", areas: RECEPTION },
  { key: "connect-pos", name: "TPV Advanced", segment: "business", areas: POS },
  { key: "connect-copilot", name: "Elephant Copilot avanzado", segment: "business", areas: COPILOT },
  { key: "connect-ads-manager", name: "Elephant Ads Manager", segment: "business", areas: ADS, note: "La inversión publicitaria se paga directamente a cada plataforma." },
  { key: "connect-campaigns", name: "Elephant Campaigns", segment: "business", areas: CAMPAIGNS, note: "Los envíos salen por la cuenta de Brevo de la empresa, con su remitente verificado." },
  { key: "connect-seo-control", name: "Elephant SEO Control", segment: "business", areas: SEO },
  { key: "connect-automations", name: "Automatizaciones avanzadas", segment: "business", areas: AUTOMATIONS },
  { key: "connect-pack-communications", name: "Paquete Communications", segment: "business", bundleOf: ["connect-whatsapp-ai", "connect-voice", "connect-reception-ai"], areas: [...WHATSAPP, ...VOICE, ...RECEPTION], note: "Incluye Elephant WhatsApp AI, Elephant Voice y Elephant Reception AI. Los costes de Meta, telefonía e IA de voz se pagan aparte." },
  { key: "connect-pack-marketing", name: "Paquete Marketing", segment: "business", bundleOf: ["connect-ads-manager", "connect-campaigns", "connect-seo-control", "connect-geo-control"], areas: [...ADS, ...CAMPAIGNS, ...SEO, ...GEO], note: "Incluye Ads Manager, Campaigns, SEO Control y GEO Control." },
  { key: "connect-pack-finance", name: "Paquete Finance", segment: "business", bundleOf: ["connect-tax", "connect-finance-sync", "connect-partners"], areas: FINANCE, note: "Incluye Elephant Tax, Finance Sync y Elephant Partners. La presentación oficial de los modelos la hace la gestoría." },
  { key: "connect-pack-ai", name: "Paquete AI Suite", segment: "business", bundleOf: ["connect-copilot", "connect-automations"], areas: [...COPILOT, ...AUTOMATIONS], note: "Incluye Copilot avanzado y Automatizaciones avanzadas." },
];

const BY_KEY = new Map(CONNECT_ASSISTED.map((p) => [p.key, p]));
/** Producto Connect de contratación asistida; null si no lo es (los de contratación directa, Net, extras…). */
export function connectAssistedOf(key: string): ConnectAssistedProduct | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * ¿Se solapan dos productos Connect (uno es un paquete que incluye al otro, o comparten componentes)? Para no contratar
 * dos veces lo mismo: un paquete sobre un componente que ya se paga, o un componente sobre su paquete. Pura.
 */
export function connectOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = BY_KEY.get(a)?.bundleOf ?? [];
  const cb = BY_KEY.get(b)?.bundleOf ?? [];
  return ca.includes(b) || cb.includes(a) || ca.some((k) => cb.includes(k));
}
