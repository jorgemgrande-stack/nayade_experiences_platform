# Matriz de integración Elephant Net y Elephant Connect

Documento vivo del programa de industrialización (iniciado el 07/11/2026). Recoge qué capacidades de los repositorios propios **Skicenter** y **Hotel Nayade** se reutilizan en Big Elephant, en qué estado están y cómo avanza su integración.

- Fuentes, consultadas en solo lectura, sin cambios en sus repositorios, bases de datos ni despliegues:
  - `jorgemgrande-stack/hotelnayade` (main `075d6f2`).
  - `jorgemgrande-stack/Skicenter` (main `4e5aa49`).
- Destino: Core multiempresa `integration/elephant-source`, CRM y web.
- Clases:
  - **A**: reutilizable casi directo.
  - **B**: requiere adaptación SaaS.
  - **C**: implementación parcial.
  - **D**: prototipo o referencia.
  - **E**: obsoleto o no aporta.
- Estado de integración:
  - `pendiente`.
  - `en curso (PR #…)`.
  - `fusionado`.
  - `en production`.
  - `bloqueado (motivo)`.

## Diferencia de arquitectura que condiciona todo el portado

Los dos repositorios fuente son aplicaciones de **una sola empresa** con el mismo origen y la misma pila que el Core: Express, tRPC, Drizzle, React y shadcn.

Hotel Nayade separa negocios con `businessUnitId` y `businessEntityId`, y fija en código el id 1, que corresponde a RAPALINA, la empresa de Náyade. El Core usa **una base de datos por empresa** y separa las sedes con `siteId`.

Reglas del portado:
- Todo `businessUnitId` pasa a `site_id`, y en restauración a `restaurant_id`.
- Las migraciones nuevas son aditivas y van en `db/migrations`.
- Los trabajos programados pasan por `runForEachTenant`.
- Las licencias se aplican por capacidad: `hotel-net`, `restaurant-net`, `care-net`, `ski-school`, `ski-rental`, `travel-net`, `life-net`, `social-token-net*`.
- No se importa ningún texto, dominio, credencial ni dato de cliente de las fuentes.

## Hotel Nayade → Hotel Net, Restaurant Net y Care Net

| Capacidad | Destino | Clase | ¿En el Core? | Prio. | Integración |
|---|---|---|---|---|---|
| Habitaciones físicas y estado operativo con historial | Hotel | B | No (solo tipologías con `totalUnits`) | 1 | en production |
| Asignación manual y automática, rack y planning | Hotel | B | No | 1 | en production |
| Recepción: check-in, check-out, no-show y panel | Hotel | B | No | 1 | en production |
| Restricciones de estancia (mín./máx., CTA/CTD) | Hotel | A | No | 2 | en production |
| Folio: cargos, pagos y cierre con factura del Core | Hotel | B | No | 1 | en production |
| Auditoría nocturna, ocupación, ADR y RevPAR | Hotel | B | No | 2 | en production |
| Housekeeping: tareas, inspección e incidencias | Hotel | B | No (requiere resolver `employees`) | 2 | en production (0038) |
| Planes de tarifa (BAR, no reembolsable, desayuno) | Hotel | B | Parcial (temporadas y tarifas) | 3 | pendiente |
| Check-in online: huéspedes, firma, textos legales, campos | Hotel | B | No | 2 | pendiente (E5, requiere evaluación RGPD) |
| OCR del documento de identidad | Hotel / Connect | A | No (el Core tiene proveedor de IA) | 2 | pendiente (E5) |
| Parte de viajeros SES Hospedajes | Hotel / Connect | C | No | 3 | pendiente (sin conector real) |
| Cerraduras inteligentes | Hotel / Connect | D | No | 5 | descartado por ahora (sin hardware real) |
| Salas de reuniones y eventos | Hotel | B | No | 4 | pendiente |
| Salas, mesas y plano (unir mesas) | Restaurant | B | No | 1 | en production |
| Carta con alérgenos | Restaurant | B | No | 1 | en production |
| Carta digital QR y pedido desde la mesa | Restaurant | B | No | 3 | en production (0046) |
| Comandas y TPV de restauración con cobro en el TPV del Core | Restaurant | B | No | 1 | en production |
| Reservas enlazadas a mesas (sentar, no-show) | Restaurant | B | Parcial | 2 | en production |
| KDS: cocina, partidas, enrutado, incidencias y métricas | Restaurant | B | No | 2 | en production |
| Comandero móvil con PIN | Restaurant | C | No | 2 | pendiente (E4, rehacer la sesión) |
| Escandallo y stock de cocina | Restaurant | C | Choque con el inventario del Core | 4 | pendiente |
| Reparto y para llevar | Restaurant | C | No | 5 | pendiente |
| Agregadores (Glovo, Uber Eats) | Connect | D | No | 5 | descartado por ahora |
| SPA en el TPV (franja, terapeuta y cabina por línea) | Care | C | No | 3 | pendiente (sobre los holds del Core) |
| Listado y calendario de reservas de SPA | Care | B | No | 3 | pendiente |
| Bonos y paquetes de sesiones | Care | — | No existe en ningún repo | — | desarrollo nuevo |
| Agenda y horarios por profesional | Care | — | No existe en ningún repo | — | desarrollo nuevo |
| GHL, Redsys, Brevo, Vapi, Meta CAPI | Connect | E | Sí (más evolucionados en el Core) | — | no portar |

## Skicenter → Ski Net, Travel Net y Elephant Connect

Acoplamientos que se eliminan en el portado:
- `destinationId INT` pasa a `site_id`.
- Los ~200 pools propios `mysql.createPool(DATABASE_URL)` se sustituyen por la BD de la empresa.
- El dominio `www.skicenter.es` por defecto, presente en 76 ficheros, se elimina.
- Los IDs fijos se eliminan: el producto 82 «Beret» y los proveedores 1 (Grandvalira) y 3 (Cetursa).
- Los horarios fijos de 9 a 16 se eliminan.
- Los niveles A–D y las modalidades de esquí pasan a ser configurables.
- No se portan el texto legal ni los backfills de Skicenter.

### Ski Net

| Capacidad | Clase | ¿En el Core? | Prio. | Integración |
|---|---|---|---|---|
| Profesores: ficha, idiomas, modalidades, niveles y documentos | B | Parcial (monitors/HR) | A | en production |
| Disponibilidad, días libres y ausencias | A | No | A | en production |
| Productos docentes (particular, cursillo, escuelita) | A | No | A | en production |
| Sesiones, grupos, niveles y participantes | B | No | A | en production |
| Asignación automática de profesores (puntuación) | B | No | M | pendiente |
| Portal del profesor y app móvil | B | No | A | en production |
| Asistencia y propuestas de cambio | A | No | A | en production |
| Control de horas | A | Parcial (HR) | A | en production |
| Liquidaciones de profesores (hora, %, fijo; PDF) | B | Parcial (monitor_payroll) | A | en production |
| Alumnos, diplomas, consentimiento de fotos, avisos a padres | B/C | No | M | pendiente (datos de menores: RGPD) |
| Motor de tarifas por temporada, edad y duración | B | Parcial (pricing_rules) | A | pendiente |
| Tiendas de alquiler y horarios | A | Parcial (ski_rental_sites) | A | en production |
| Inventario por unidad (QR, tallas, modelos, CSV, etiquetas) | B | Parcial (cantidades, v0.1) | A | en production |
| Entregas, devoluciones, cambios y compatibilidad | B | Parcial | A | en production |
| Contratos digitales y firma por clic | B | No | A | en production |
| Fianzas | — | No existe en ningún repo | M | desarrollo nuevo |
| Incidencias y cargos con enlace de pago | B | No | M | pendiente (Ski E6) |
| Taller y mantenimiento | A | No | M | pendiente |
| Kits, previsión, taquillas, centro de operaciones | B/C | No | B | pendiente |

### Travel Net

| Capacidad | Clase | ¿En el Core? | Prio. | Integración |
|---|---|---|---|---|
| Proveedores externos (contactos, contratos, comisiones) | B | Parcial (suppliers, partners) | A | en production |
| Operaciones con proveedor (estados, localizador, bono, auditoría) | A/B | No | A | en production |
| Liquidaciones a proveedores | B | Parcial (supplier_settlements) | M | pendiente |
| Capa común de proveedores de alojamiento y proveedor manual | A/B | No | A | en curso (Veturis #697) |
| Reservas de alojamiento (checkout, revalidación, bono, cancelación) | B | No | A | en curso (Veturis #697) |
| Márgenes y recargos (global, sede, alojamiento; simulador) | A | No | A | en curso (Veturis #697) |
| Catálogo de alojamientos con enriquecimiento IA | B/C | No | M | pendiente |
| Combinados alojamiento + forfait + alquiler + clases | C | Parcial (lego_packs) | B | pendiente (interoperabilidad) |
| Presupuestos con alojamiento | C | Parcial (proposals) | M | pendiente |
| Área del viajero | B | No | M | pendiente |
| Ofertas dinámicas | C | No | B | pendiente |

### Elephant Connect

En el Core, cada empresa guarda sus credenciales en una bóveda (`server/_core/credentials/catalog.ts`) y el código las lee con `integrationEnv`. Hoy la bóveda tiene 7 proveedores: GHL, Vapi, Redsys, Meta CAPI, dos IMAP y SMTP. Cada conector nuevo necesita lo mismo:
- Su `ProviderDef` en esa bóveda.
- Leer la credencial en cada llamada.
- Un probador de conexión.
- Trabajos que recorran las empresas.
- Un webhook dirigido a la empresa que corresponde.

| Conector | Fuente | Clase | Estado | Siguiente paso / bloqueo |
|---|---|---|---|---|
| Meta CAPI + Pixel | Core / Skicenter `metaCapi/` | A | corregido el fallo por empresa (PR #674) | portar reintentos y salud de `metaCapi/` |
| Redsys con varios TPV | Skicenter | A | pendiente | tablas `redsys_tpvs` y log por empresa |
| Veturis (hoteles XML) | Skicenter | A/B | pendiente | credenciales de cada agencia; confirmar si exige IP en lista blanca |
| WhatsApp Cloud API | Skicenter | B | en curso (Elephant WhatsApp AI, migración 0062) | app y número PROPIOS de cada empresa en su bóveda (`whatsapp_cloud`); webhook en su dominio con firma de su App Secret y filtro por `phone_number_id`. Bloqueo externo: verificación de la empresa y de la app en Meta y número aprobado |
| Meta Lead Ads | Skicenter | B | pendiente | suscripción de página por empresa |
| Brevo marketing (contactos, listas, campañas) | Skicenter | B | pendiente | separar del Brevo de correo de la plataforma |
| Google Ads | Skicenter | B | pendiente | token de desarrollador de la plataforma y OAuth por empresa |
| GA4 (Admin, Data, Measurement Protocol) | Skicenter | B | pendiente | cuenta de servicio por empresa |
| Google Business Profile | Skicenter | B | pendiente | OAuth con redirección de Big Elephant |
| CheckYeti (reservas por correo) | Skicenter | B | pendiente | patrón IMAP ya existente en la bóveda |
| Grandvalira (forfaits SOAP) | Skicenter | B | bloqueado | IP de salida fija (relé de plataforma) y contrato por empresa |
| Netelip (telefonía) | Skicenter | C | bloqueado | IP de salida fija y centralita propia |
| Cetursa (precio de forfait) | Skicenter | C | pendiente | solo consulta |
| WebBeds / DOTW | Skicenter | D | bloqueado | en certificación con el proveedor |
| Messenger e Instagram | Skicenter | C | pendiente | OAuth |
| TikTok, LinkedIn, YouTube, Tripadvisor, DeepL… | Skicenter | D/C | descartado por ahora | — |
| Vapi | Core | A | ya en el Core | — |

## Progreso de entregas (07/11/2026)

| Entrega | PR | Estado |
|---|---|---|
| Unificación comercial de Elephant Net (7 productos) | Core #673, CRM #151, web #49 | en production |
| Meta CAPI por empresa (corrección) | #674 | en production |
| Ski Net · Escuela (profesores, disponibilidad, productos, sesiones, planning) | #675 | en production (0031) |
| Hotel Net · núcleo PMS (habitaciones, asignación, planning, recepción, restricciones) | #677 | en production (0032) |
| Restaurant Net · sala, carta, comandas y cobro con el TPV | #676 (tanda #682) | en production (0033) |
| Hotel Net · folio con factura, cierre del día, ADR/RevPAR | #678 (tanda #682) | en production (0034) |
| Restaurant Net · cocina (KDS), estados y camareros | #679 (tanda #682) | en production (0035) |
| Ski Net · alquiler por unidad, contratos con firma en mostrador, taller | #680 (tanda #682) | en production (0036) |
| Care Net · bonos, sesiones y reservas de SPA | #684 (tanda #685) | en production (0037) |
| Hotel Net · housekeeping | #681 (tanda #685) | en production (0038) |
| Ski Net · asistencia, horas, liquidaciones y portal del profesor | #683 (tanda #685) | en production (0039) |
| Travel Net · expedientes, márgenes, presupuesto CRM, reserva, operaciones y bonos | #687 (tanda #694) | en production (0040) |
| Cargo a habitación (Restaurant y Care → folio de Hotel) | #688 (tanda #694) | en production (0041) |
| Connect · Brevo marketing (clave de cada empresa) | rehecho en tanda #694 | en production (0042), pendiente de comercialización |
| Hotel Net · ficha de huésped y planes de tarifa | #691 (tanda #694) | en production (0043) |
| Fidelización por sector (Social Token Net) y grupos por niveles (Ski) | #692 (tanda #694) | en production (0044) |
| Revisión visual a 1366/390 px, claro y oscuro | #693 (tanda #694) | en production |
| Informes sectoriales (Restaurant, Care, Ski, Travel) | #696 | fusionado |
| Connect · Veturis en Travel Net (reserva real apagada) | #697 | en curso |
| Estados «Disponible» en las fichas | #686 y esta PR | — |
| Activación del marketplace · tanda A: venta directa de Partners, Deals y Tax (revisión `review20261108connect.ts`) | #714 | fusionado; espera el Price de Stripe Live |
| Finance Sync · extractos de cualquier banco | #716 | fusionado |
| GEO Control funcional | #717 | fusionado |
| Contratos y firma electrónica simple | #718 | fusionado |
| Tanda B: fichas de GEO, Contratos y Finance Sync; «Gestionar» abre el módulo | #719 | en production |
| Hotel Net · sincronización iCal (exportación e importación con protección SSRF) | #722 | fusionado (0050) |
| Care Net · recordatorios de cita por correo | #720 | fusionado (0051) |
| Ski Net · fianzas del alquiler y cargos por daños | #721 | en curso (0052) |
| Tanda C: fichas de Care, Ski, Restaurant y Travel Net al día (Hotel Net bloqueado por el borrador ajeno v10) | esta PR | en curso |
| Elephant WhatsApp AI · WhatsApp Cloud API por empresa, bandeja con ventana de 24 h y plantillas, IA (sugerencias y automática con tope) y revisión `review20261109whatsapp.ts` | PR de esta entrega | en curso (0062) |

## Activación del marketplace (encargo del 08/11/2026)

Inventario accionable de lo que se vende en `/admin/ampliar`. Estado público de partida: el de `https://admin.bigelephant.es/cp/v1/public/site` del 08/11/2026 a las 12:30.

**Circuito común** (los diez puntos que comparten todos los productos):
- **Licencia y permisos (4).** Por capacidad: `TRPC_ROUTER_CAPABILITIES` y el menú (`shared/adminNav.ts`).
- **Contratación (8).**
  - En línea solo con:
    - estado «Disponible» y técnico `available`;
    - un precio mensual aprobado;
    - el **Price de Stripe Live enlazado** (`stripe_prices`);
    - un plan Essential o Business con suscripción activa en Stripe (`server/stripe/purchases.ts`).
  - La licencia se concede cuando se cobra la factura de prorrateo.
  - El menú se desbloquea en unos 60 s.
  - La tarjeta pasa a «Gestionar».
- **Implantación acompañada.**
  - «Solicitar información» crea una solicitud web en el CRM (`panelRequests.ts`) y avisa al equipo (`leadNotices`).
  - El equipo crea y aprueba el pedido en el CRM, y eso concede la licencia por el circuito normal.
- **Stripe Live (7).** El 08/11/2026 solo tienen Price Essential, Business, People y los tres de Social Token. Lo crea una persona:
  1. `GET /cp/v1/stripe/catalog/plan`.
  2. Crear el Product y el Price.
  3. `POST /cp/v1/stripe/catalog/sync`.
- **Configuración (5).** No hay asistente propio por módulo: «Gestionar» lleva a la pantalla principal.

| Producto (capacidad) | Operativo hoy (2) | Integración externa (6) | Estado (9) | Trabajo exacto para venderlo (10) |
|---|---|---|---|---|
| People (`people-hr`) | Completo | — | Disponible | — |
| Partners (`supplier-settlements`) | Proveedores, liquidaciones con PDF y portales | — | Implantación acompañada | **Tanda A.** Crear el Price mensual en Stripe Live y sincronizar; la revisión lo pasa a «Disponible». |
| Deals (`deals-coupons`) | Formulario de canje, reserva y conciliación | — (canje manual) | Implantación acompañada | **Tanda A.** Igual que Partners. |
| Tax (`tax-filings`) | Estimación de los modelos 303, 390, 111, 190, 200 y 202; calendario con avisos, expedientes y portal de la gestoría | — | Implantación acompañada | **Tanda A.** Igual que Partners. La presentación la hace la gestoría. |
| Finance Sync (`bank-import-pos`, `bank-reconciliation`) | Extractos de **cualquier banco** (Norma 43, Excel o CSV, #716), operaciones y remesas del datáfono, conciliación | Buzón IMAP de la empresa (tickets del datáfono) | Implantación acompañada (ficha actualizada en la tanda B) | Asistente del buzón del datáfono en el panel; después, venta directa. |
| Voice (`voice-ai`) | Llamadas Vapi, leads y coste | Cuenta Vapi de la empresa (bóveda) | Implantación acompañada | Asistente de alta de Vapi. Netelip: IP de salida fija. |
| POS (`pos-advanced`) | El TPV avanzado existe, pero lo licencia `bill-cash` (Essential) | — | Implantación acompañada | Frontera entre la caja básica y la avanzada. Es una decisión de negocio: hoy la tienen los clientes de Essential. |
| WhatsApp AI (`whatsapp-ai`) | WhatsApp Cloud API con el número de la empresa: webhook firmado e idempotente, estados de entrega, bandeja con ventana de 24 h y plantillas aprobadas, sugerencias de IA y respuesta automática opcional con horario, tope diario y traspaso a persona (migración 0062). La bandeja de GHL sigue para quien la usa | App de Meta, negocio y número verificados y aprobados de la empresa (bóveda `whatsapp_cloud`); plantillas aprobadas por Meta | En preparación → implantación acompañada con `review20261109whatsapp.ts` (preparada, sin lanzar) | Bloqueo externo: verificación de la empresa y la app en Meta y número aprobado. Las conversaciones las factura Meta. |
| Campaigns (`email-campaigns`) | Sincronización de clientes con consentimiento a la lista de Brevo de la empresa | Cuenta Brevo de la empresa | Próximamente | Envío de campañas desde el Core. Brevo no es un producto de correo nuevo. |
| Automatizaciones (`automations-advanced`) | Recordatorios por correo (`emailAutomationJob`) | — | En preparación | Motor de reglas y flujos licenciado. |
| Copilot avanzado (`copilot-advanced`) | Proveedor de IA central | IA de la plataforma | Próximamente | Hay un borrador ajeno (v6): bloqueo. |
| GEO Control (`geo-control`) | Consultas, observaciones por asistente de IA, presencia y citación, cambios, competidores y oportunidades (#717, migración 0048) | IA central (opcional) | Implantación acompañada (tanda B) | Venta directa con su Price de Stripe Live. |
| Reception AI, Ads Manager, SEO Control | Sin código en el Core (base en Skicenter) | Vapi o Meta; Meta/Google Ads; Google Business Profile | Próximamente | Portar desde Skicenter. |
| Contratos y firma (`contracts-esign`) | Plantillas, contratos, firma simple por enlace `/contrato/<token>` o en el panel, evidencias y PDF (#718, migración 0049) | — | Implantación acompañada (tanda B) | Venta directa con su Price de Stripe Live (`stripePrepared`). |
| Venta multicanal, Contabilidad general | Sin código genérico | Canales | Próximamente | Desarrollo nuevo. |

**Paquetes (sección 5).**
- **Finance:** sus componentes son reales salvo `bank-reconciliation`. Seguirá en implantación acompañada hasta que Tax y Finance Sync estén a la venta.
- **Communications, Marketing y AI:** incluyen capacidades sin función (`reception-ai`, `ads-manager`, `seo-control`, `geo-control`, `copilot-advanced`, `automations-advanced`). No se abren a la venta.

**Net.**
- **Hotel Net:** pendiente de que el operador publique su borrador v10; no se toca.
- **Mejoras pequeñas por sector:**
  - Hotel: exportación iCal.
  - Restaurant: clientes y preferencias.
  - Care: recordatorios de cita.
  - Ski: fianzas.
  - Travel: consulta de alojamientos con Veturis.

## Bloqueos y decisiones pendientes

- **Verificación funcional en production con Elephant Demo.** Exige iniciar sesión en el CRM (admin.bigelephant.es) para concederle las licencias. Es una acción humana: Jorge.
- **Superficies públicas.** Carta QR y pedido desde la mesa, check-in online, firma del contrato de alquiler fuera del mostrador y webhook de bajas de Brevo necesitan rutas públicas en `server/authGuard.ts`. Eso hace extraordinaria la publicación y exige la aprobación de Jorge en production.
- **Life Net.** Hay que decidir el modelo comercial (hogar con Essential o producto personal sin Core) antes de programar.
- **Conectores con requisitos externos:**
  - Veturis: credenciales, certificación e IP en lista blanca.
  - WhatsApp Cloud API: cada empresa con su app de Meta, su negocio verificado y su número aprobado (ya no depende de una app de Big Elephant).
  - Grandvalira y Netelip: IP de salida fija.
  - WebBeds: certificación.
  - Google Ads, GA4 y Business Profile: OAuth y token de la plataforma.
- **Venta de los productos Net.** Siguen en su estado comercial del CRM («Próximamente» o «Bajo solicitud»). Pasarlos a «Disponible» para la venta es una decisión comercial (Price y condiciones).

## Life Net: alcance técnico (sin implementación)

Estado verificado el 07/11/2026:
- No hay código ni definición en Skicenter, en Hotel Nayade ni en el Core.
- La ficha oficial (`server/catalog/commercial/specs.ts`) indica «Definición funcional antes de comprometer plazos».
- Las funciones aprobadas en la unificación son estas siete: organización personal, gestión familiar, calendario y agenda, tareas y recordatorios, actividades compartidas, miembros del hogar y seguimiento de actividades y compromisos.
- Hoy todas figuran como «Próximamente».

**Decisión de negocio previa a programar.** Life Net es un producto personal de 9 € y la plataforma se organiza por empresas: cada empresa tiene su base de datos, su plan Core y sus licencias. Hay que decidir entre dos opciones:
- **(a) Hogar con Essential.** Cada hogar es una «empresa» con plan Essential y Life Net como licencia. Hoy es técnicamente posible, pero comercialmente encarece el producto.
- **(b) Producto personal sin Core.** Exige un alta y un cobro de consumidor nuevos: un plan «Personal» sin Essential, en el control plane y en Stripe.

**Reutilización posible en el Core**, cuando se decida:
- Usuarios y roles de la empresa, para los miembros del hogar.
- Calendario de reservas y agenda.
- Avisos por correo de la plataforma.
- Portal de cliente.

**Propuesta de primera entrega**, una vez decidida la opción:
- Módulo SDK `lifeNet` con la capacidad `life-net`.
- Tablas `life_members`, `life_events`, `life_tasks` y `life_reminders`.
- Agenda compartida con tareas y recordatorios, más un job de recordatorios por empresa.
- Menú propio en la sección «Life Net», que ya existe con su «Panel general».
