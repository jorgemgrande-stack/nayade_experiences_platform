/**
 * Revisión de la disponibilidad comercial del catálogo (25/10/2026), contrastada con el código, las pruebas y las
 * verificaciones de las cuatro fases nocturnas. Cada cambio indica el estado del que parte (`from`): si en la BD ya
 * es otro (alguien lo cambió desde el CRM), NO se toca y se informa. Ver docs/runbooks/CATALOGO_ESTADOS_COMERCIALES.md.
 *
 * Criterio (server/web/schemas.ts):
 *  - Disponible: completo, comprobado y preparado para ofrecerse (ninguno todavía: exige estado técnico «available»).
 *  - Implantación acompañada (on_request): operativo; el equipo lo implanta con el cliente.
 *  - En preparación: hay código, pero falta desarrollo o validación para implantarlo.
 *  - Próximamente: previsto, sin código que se pueda implantar.
 */
import type { CommercialStatus } from "../web/schemas";

export interface StatusChange {
  key: string;
  from: CommercialStatus;
  to: CommercialStatus;
  /** Por qué (queda en el historial del producto y en las notas internas). */
  evidence: string;
  /** Nota interna nueva (sustituye a una desfasada), o undefined para conservar la actual. */
  notes?: string | null;
}

export const REVIEW_ID = "revision-catalogo-2026-10-25";

export const STATUS_REVIEW_2026_10_25: readonly StatusChange[] = [
  // ── Planes y complementos sin código operativo (técnico «planned») ──
  { key: "enterprise", from: "on_request", to: "in_preparation", evidence: "Estado técnico «planned»: multi-entidad fiscal y API propia sin código (capabilities.ts:80-81)." },
  { key: "addon-site-business", from: "on_request", to: "in_preparation", evidence: "Estado técnico «planned»: la capacidad de varias sedes no tiene código." },
  // ── Elephant Net con código operativo y probado ──
  {
    key: "hotel-net-pms",
    from: "coming_soon",
    to: "on_request",
    evidence: "Módulo de licencia «hotel»: server/routers/hotel.ts, server/hotelDb.ts (la disponibilidad ya descuenta reservas, retención atómica de plazas), HotelManager.tsx; pruebas hotelRates, inventoryHolds(.mysql) y e2e reserva-hotel.",
    notes: "Reutilizable (módulo hotel). La disponibilidad descuenta reservas y ocupación (retención atómica de plazas). Lo implanta el equipo.",
  },
  { key: "hotel-net-booking-engine", from: "coming_soon", to: "on_request", evidence: "Reserva pública de habitaciones (Hotel.tsx, HotelRoom.tsx) sobre el módulo hotel; e2e reserva-hotel. El cobro en línea usa la pasarela propia de cada empresa (se configura en la implantación)." },
  { key: "hotel-net-complete", from: "coming_soon", to: "in_preparation", evidence: "Incluye Channel Manager y Housekeeping, sin código." },
  {
    key: "care-net-agenda",
    from: "coming_soon",
    to: "on_request",
    evidence: "Módulo de licencia «spa»: server/routers/spa.ts, server/spaDb.ts (el aforo se actualiza al reservar: UPDATE condicional de bookedCount en inventoryHoldsDb y reconciliación), SpaManager.tsx; prueba spaSlots.",
    notes: "Reutilizable (módulo spa). El aforo de las franjas se actualiza al reservar. Lo implanta el equipo.",
  },
  { key: "care-net-treatments", from: "coming_soon", to: "in_preparation", evidence: "Tratamientos en el módulo spa; los bonos no tienen código propio." },
  { key: "care-net-complete", from: "coming_soon", to: "in_preparation", evidence: "Incluye la gestión clínica, sin código." },
  { key: "restaurant-net-complete", from: "coming_soon", to: "in_preparation", evidence: "Incluye sala y comandas y KDS, sin código." },
  { key: "travel-net-agency", from: "coming_soon", to: "in_preparation", evidence: "REAV operativo (server/routers.ts reav, ReavManager.tsx, prueba reav); falta la gestión de agencia completa." },
  { key: "ski-net-rental", from: "coming_soon", to: "in_preparation", evidence: "Módulo ski_rental con servicio y pruebas (server/skiRental/*, skiRental(.mysql).test.ts), solo administración y sin pantallas." },
  // ── Elephant Connect con código parcial ──
  { key: "connect-whatsapp-ai", from: "coming_soon", to: "in_preparation", evidence: "Bandeja de WhatsApp vía GoHighLevel (ghlInbox, pruebas ghl*); sin IA ni API directa." },
  { key: "connect-automations", from: "coming_soon", to: "in_preparation", evidence: "Motor de automatizaciones de correo (server/emailAutomationJob.ts) apagado por defecto y sin pruebas propias." },
  { key: "connect-pack-communications", from: "coming_soon", to: "in_preparation", evidence: "Incluye WhatsApp AI (en preparación) y Reception AI (sin código)." },
  { key: "connect-pack-ai", from: "coming_soon", to: "in_preparation", evidence: "Incluye Automatizaciones avanzadas (en preparación) y Copilot avanzado (sin código)." },
];

/** Evidencia de los que NO cambian (para que el CRM no los marque como «sin evidencia»). */
export const EVIDENCE_2026_10_25: Readonly<Record<string, string>> = {
  business: "Implantación acompañada: hereda las 29 capacidades de Essential y 8 de las 15 propias tienen código (embudo avanzado, reglas de precios, reservas y citas, varias webs, facturación recurrente, roles, compras, informes). Las 7 restantes (portal de clientes, suscripciones de clientes, formularios de captación, web multidioma, varias sedes, inventario, Copilot básico) figuran como previstas: server/catalog/capabilities.ts.",
  "addon-user-business": "Cupo de usuarios aplicado (server/_core/limits, planSeats.ts); pruebas contractedLimits(.mysql). Complemento del plan Business.",
  essential: "29 capacidades Essential con código (server/_core/capabilities/routeGuard.ts) y pruebas essential.*.mysql; cliente real en production (Skibox, fase 4). Disponible tras la primera compra controlada (APERTURA_COMERCIAL.md).",
  "restaurant-net-bookings": "Módulo de licencia «restaurants»: server/routers/restaurants.ts, restaurantsDb.ts, RestaurantsManager.tsx; prueba restaurants. Plano de mesas pendiente.",
  "connect-voice": "Integración VAPI (server/routers/vapiCalls.ts) con comprobación real de credenciales (fase 4).",
  "connect-people": "server/routers/hr.ts y 11 pantallas de RR. HH. (fichajes, nóminas, permisos). Sin pruebas propias: se implanta con el equipo.",
  "connect-tax": "server/routers/gestoria.ts y fiscalAudit, con pantallas de gestoría. Sin pruebas funcionales propias: se implanta con el equipo.",
  "connect-partners": "server/routers/partners.ts, suppliers.ts (liquidaciones), supplierPortal.ts; prueba settlementExport.",
  "connect-pos": "server/routers/tpv.ts y cashRegister.ts, 7 pantallas de TPV; prueba tpv.operations.",
  "connect-deals": "server/routers/ticketing.ts, CuponesManager.tsx y canje público; pruebas ticketing(.features).",
  "connect-finance-sync": "bankMovements, cardTerminalOperations y cardTerminalBatches con pantallas de contabilidad; prueba cardTerminalOperations.dedup.",
  "connect-pack-finance": "Sus tres componentes (Tax, Finance Sync y Partners) son de implantación acompañada.",
  "service-hosting-basic": "Servicio gestionado por el equipo (alojamiento de la web de la empresa en la plataforma).",
  "service-hosting-advanced": "Servicio gestionado por el equipo.",
  "service-domain": "Servicio gestionado por el equipo (identidad de dominio de la empresa: server/_core/tenantIdentity.ts).",
  "addon-user-essential": "Cupo de usuarios aplicado (server/_core/limits, planSeats.ts); pruebas contractedLimits(.mysql).",
  "addon-storage-10gb": "Cupo de almacenamiento aplicado (server/_core/files/service.ts); pruebas contractedLimits(.mysql).",
};
