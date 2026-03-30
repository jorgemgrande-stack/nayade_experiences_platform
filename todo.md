# Nayade Experiences Platform - TODO

## Fase 1: Base de Datos y Configuración
- [x] Diseñar y aplicar esquema completo de base de datos (17 tablas)
- [x] Configurar roles de usuario: admin, monitor, agente

## Fase 2: Diseño Visual y Navegación
- [x] Configurar tema visual elegante (colores, tipografía, variables CSS)
- [x] Diseñar layout del sitio público con header y footer
- [x] Diseñar layout del panel de administración con sidebar

## Fase 3: Sitio Público
- [x] Página Home con slideshow hero, productos destacados y CTAs
- [x] Página de Ubicaciones con lista de destinos
- [x] Página de Categorías de experiencias
- [x] Ficha de Experiencia con galería, descripción, variables y botón de compra
- [x] Página de Galería de imágenes
- [x] Landing de Solicitud de Presupuesto (formulario de leads)
- [x] Página de Contacto
- [x] Navegación responsive (mobile-first)

## Fase 4: Panel Admin - Auth y Módulo 1 CMS
- [x] Sistema de autenticación con roles (admin/monitor/agente)
- [x] Dashboard principal del panel de administración
- [x] Módulo 1: Gestor de slideshow de la home
- [x] Módulo 1: Editor de menús del header
- [x] Módulo 1: Gestor de productos destacados en home
- [x] Módulo 1: Gestor de medios (subida y gestión de imágenes)
- [x] Módulo 1: Editor de páginas estáticas

## Fase 5: Módulo 2 y Módulo 3
- [x] Módulo 2: Gestión de categorías de experiencias
- [x] Módulo 2: Creación/edición de productos con galería, descripción, variables de precio
- [x] Módulo 2: Configuración de botones de compra/reserva
- [x] Módulo 3: Bandeja de entrada de leads
- [x] Módulo 3: Interfaz de agentes para responder leads
- [x] Módulo 3: Creación de presupuestos personalizados con desglose
- [x] Módulo 3: Generación de links de pago únicos
- [x] Módulo 3: Integración GoHighLevel (webhook logs + API key configurable)
- [x] Módulo 3: Seguimiento de estado de presupuestos (borrador/enviado/aceptado/rechazado)

## Fase 6: Módulo 4 y Módulo 5
- [x] Módulo 4: Vista de calendario de actividades contratadas
- [x] Módulo 4: Generación de órdenes del día
- [x] Módulo 4: Asignación de monitores a actividades
- [x] Módulo 4: Notificaciones a monitores
- [x] Módulo 5: Dashboard con métricas clave (ventas, ingresos, experiencias top)
- [x] Módulo 5: Informes de ventas exportables
- [x] Módulo 5: Registro de transacciones y estados de pago
- [x] Módulo 5: Informe de comisiones por agente/monitor

## Fase 7: Testing y Entrega
- [x] Escribir tests Vitest (18 tests pasando: auth, public API, leads, admin, quotes, bookings, accounting)
- [x] Datos de muestra insertados (8 experiencias, 5 ubicaciones, 5 categorías, 3 slides)
- [x] Guardar checkpoint final
- [ ] Configurar integración GoHighLevel API Key

## Rediseño Náutico y Veraniego (v2.0)
- [x] Rediseñar paleta visual: azul lago, turquesa, arena, blanco náutico
- [x] Actualizar tipografía y CSS global con identidad veraniega
- [x] Reconstruir Home con hero lago/embalse, actividades acuáticas reales del dossier
- [x] Actualizar catálogo: actividades simples (Blob Jump, Banana Ski, Canoa, Cableski, etc.)
- [x] Añadir módulo de habitaciones del Hotel Náyade (4 tipos con precios reales)
- [x] Restaurantes con reserva calendarizada (El Galeón, La Cabaña, Nassau Bar, Arrocería)
- [x] SPA con reserva de circuitos y tratamientos
- [x] Packs de día (Day Pass, Discovery, Aventura, Adrenalina, Lago Gourmet, Cableski Experience)
- [x] Packs escolares (Básico, Aventura, Multiaventura + con estancia)
- [x] Packs corporativos (Team Building)
- [ ] Arquitectura de packs compuestos (producto main + productos simples con variables)
- [x] Actualizar base de datos con 31 productos reales del dossier (10 actividades + 4 hotel + 3 SPA + 3 restaurantes + 7 packs + 2 escolares + 2 corporativos)
- [x] Insertar imágenes náuticas y del lago en slideshow y productos (CDN)

## Correcciones UI
- [x] Corregir contraste de colores del header (modo transparente y sólido)
- [x] Aumentar altura del header y aplicar azul agua semitransparente en modo hero
- [x] Corregir pantalla "Acceso Restringido" del admin para mostrar botón de login funcional
- [x] Corregir dashboard de admin: OAuth callback ahora redirige a /admin tras login
- [x] Añadir enlace "Acceso Gestores" discreto en el footer

## Reparación completa del panel de administración
- [x] Auditar rutas App.tsx y procedimientos tRPC del servidor
- [x] Reparar AdminLayout: sidebar con navegación funcional y rutas correctas
- [x] Reparar módulo CMS: Slideshow, Menús, Medios con CRUD real
- [x] Reparar módulo Productos: Experiencias, Categorías, Ubicaciones, Variantes
- [x] Reparar módulo Presupuestos: Leads, listado Presupuestos, Nuevo Presupuesto
- [x] Reparar módulo Operaciones: Calendario, Órdenes del día, Monitores
- [x] Reparar módulo Contabilidad: Dashboard métricas, Transacciones, Informes
- [x] Reparar módulo Usuarios y Configuración

## Subida de fotos al Slideshow
- [x] Endpoint REST de subida de imágenes a S3 en el servidor
- [x] Procedimiento tRPC para CRUD completo de slides con imagen
- [x] SlideshowManager con upload real, previsualización y reordenación

## Correcciones UI (v2.1)
- [x] Corregir botón "Añadir Primer Slide" — solo visible en hover, debe ser siempre visible
- [x] Botón "Añadir Primer Slide" sigue invisible (estado vacío)
- [x] Botón "Crear Slide" no aparece en el modal del formulario

## Unificación Slideshow Admin ↔ Público
- [x] Migrar BD: añadir campos badge, description, reserveUrl a slideshow_items
- [x] Actualizar tRPC getSlideshowItems/create/update con nuevos campos
- [x] Actualizar SlideshowManager (admin) con todos los campos del slideshow público
- [x] Conectar Home pública para leer slides de la BD (eliminar slides hardcodeados)
- [x] Vaciar tabla slideshow_items (slides de prueba actuales)

## Corrección Global Web (v2.2)
- [x] Crear página /packs con listado de packs
- [x] Crear página /packs/packs-dia (ruta /packs/dia)
- [x] Crear página /packs/packs-escolares (ruta /packs/escolares)
- [x] Crear página /packs/team-building (ruta /packs/corporativo)
- [x] Crear página /hotel
- [x] Crear página /spa
- [x] Crear página /restaurantes con listado
- [x] Crear página /restaurantes/el-galeon
- [x] Crear página /restaurantes/la-cabana
- [x] Crear página /restaurantes/nassau-bar
- [x] Corregir menú desplegable: zona de tolerancia hover + delay 420ms + bridge invisible
- [x] Mejorar accesibilidad táctil del menú en móvil (acordeones expandibles)

## Upload de imágenes en Productos y Categorías (v2.3)
- [x] Migrar BD: añadir image2, image3, image4 a experiences y categories
- [x] Actualizar tRPC create/update de experiences y categories con 4 imágenes
- [x] Reescribir ExperiencesManager con 4 zonas de upload real (sin campo URL)
- [x] Reescribir CategoriesManager con upload real de imagen de portada (sin campo URL)
- [x] Conectar ExperienceDetail (carrusel público) para usar image1..4 de la BD

## Corrección de enlaces de submenús (v2.4)
- [x] Auditar hrefs en PublicNav vs rutas en App.tsx
- [x] Corregir todos los submenús (Experiencias, Packs, Restaurantes) para que enlacen correctamente

## Gestión de Módulos de la Home (v2.5)
- [x] Crear tabla home_module_items en BD (moduleKey, experienceId, sortOrder)
- [x] Crear procedimientos tRPC getHomeModule / setHomeModule
- [x] Crear HomeModulesManager en Admin > CMS con selector de productos por módulo
- [x] Conectar módulo "Nuestras Experiencias" en Home para leer selección de BD
- [x] Conectar módulo "Packs de Día Completo" en Home para leer selección de BD
- [x] Usar image1 del producto como imagen en los módulos de la home
- [x] Registrar ruta /admin/cms/modulos en App.tsx y sidebar del admin

## Flujo de Reserva con Pago Redsys (v3.0)
- [x] Solicitar credenciales Redsys (MERCHANT_CODE, MERCHANT_KEY, MERCHANT_TERMINAL)
- [x] Crear tabla reservations en BD con todos los campos requeridos
- [x] Crear helper redsys.ts con generación de firma SHA-256 3DES y validación IPN
- [x] Crear endpoint REST POST /api/redsys/notify para notificación IPN
- [x] Crear procedimiento tRPC reservations.create (pre-reserva, estado draft)
- [x] Crear procedimiento tRPC reservations.initiatePayment (genera parámetros Redsys)
- [x] Crear procedimiento tRPC reservations.getStatus (consulta estado)
- [x] Crear modal BookingModal con selector de fecha, personas, extras y resumen
- [x] Añadir doble CTA (Solicitar presupuesto + Reservar ahora) a tarjetas de producto
- [x] Crear página /reserva/ok (confirmación de pago exitoso)
- [x] Crear página /reserva/error (pago fallido o cancelado)
- [x] Registrar rutas /reserva/ok y /reserva/error en App.tsx
- [x] Añadir logs de transacciones y errores Redsys

## Cierre Integración Redsys Producción (v3.1)
- [x] Doble CTA (Solicitar presupuesto + Reservar ahora) en ExperienceDetail.tsx
- [x] /reserva/ok: consultar estado real en backend (paid/pending/failed)
- [x] /reserva/error: mostrar datos reserva y opción de reintentar
- [x] Panel admin reservas Redsys: listado paginado, filtros, detalle, export CSV
- [x] merchant_order único garantizado en backend
- [x] Logs de notificación IPN Redsys con timestamp
- [x] Guardar respuesta Redsys completa en campo técnico
- [x] Email al cliente al pasar a paid (nodemailer + SMTP real)
- [x] Email interno al equipo de operaciones al pasar a paid (notifyOwner + BCC)
- [x] URLs Redsys construidas dinámicamente desde window.location.origin (no hardcodeadas)
- [x] Preparado para cambio de dominio: no hay cambios de código necesarios

## Producción y Emails (v3.2)
- [x] Integrar nodemailer para envío real de emails via SMTP
- [x] Plantilla HTML de confirmación al cliente (diseño náutico)
- [x] Plantilla HTML de pago fallido al cliente
- [x] Variables SMTP configuradas en Settings > Secrets
- [x] Conexión SMTP verificada (nayadeexperiences-es.correoseguro.dinaserver.com:465)
- [x] Tests Vitest para módulo de emails (5 tests pasando)
- [x] Documento REDSYS_PRODUCCION.md con guía de configuración
- [x] Enlace "Reservas Redsys" en sidebar del admin (Admin > Operaciones)
- [x] TypeScript compila sin errores (0 errors)
- [x] 23 tests Vitest pasando (auth + public API + leads + admin + quotes + bookings + accounting + emails)

## Logos reales (v3.3)
- [x] Subir logo azul (header) al CDN
- [x] Subir logo blanco (footer) al CDN
- [x] Actualizar header con logo azul real
- [x] Actualizar footer con logo blanco real
- [x] Actualizar sidebar del admin con logo azul (circular)

## Reparación módulo Variantes de Precio (v3.4)
- [x] Auditar esquema BD tabla experience_variants (ya existía, estructura correcta)
- [x] Auditar procedimientos tRPC de variantes (no existían, implementados)
- [x] Auditar componente VariantsManager frontend (era placeholder, reescrito)
- [x] Reparar backend: create/update/delete/list variantes por producto (db.ts + routers.ts)
- [x] Reparar frontend: formulario de variante con guardado real (VariantsManager.tsx)
- [x] Conectar BookingModal para usar precio de variante seleccionada
- [x] Backend createAndPay calcula precio correcto según variante (fixed/per_person/percentage)
- [x] Redsys recibe el importe calculado en backend con la variante seleccionada

## Menú de acciones en módulos admin (v3.7)
- [x] Identificar todos los módulos con icono de papelera
- [x] Backend: cloneExperience, hardDeleteExperience, toggleExperienceActive
- [x] Backend: cloneCategory, hardDeleteCategory, toggleCategoryActive
- [x] Backend: cloneLocation, hardDeleteLocation, toggleLocationActive
- [x] Frontend: ExperiencesManager — DropdownMenu (Editar, Activar/Desactivar, Clonar, Borrar)
- [x] Frontend: CategoriesManager — DropdownMenu (Activar/Desactivar, Clonar, Borrar)
- [x] Frontend: LocationsManager — DropdownMenu (Activar/Desactivar, Clonar, Borrar)
- [x] Frontend: VariantsManager — DropdownMenu (Editar, Borrar con confirmación)
- [x] TypeScript 0 errores tras todos los cambios

## Reestructuración PACKS — Arquitectura ecommerce (v3.8)
- [x] Auditar estructura actual de PACKS (estática, hardcodeada, sin BD)
- [x] Esquema BD: tabla packs con categoría (dia/escolar/empresa) + pack_cross_sells
- [x] Datos iniciales: 13 packs insertados (7 de día, 6 escolares)
- [x] Backend: funciones CRUD packs en db.ts + router tRPC packs
- [x] Nivel 1: PacksHome.tsx — 3 categorías visuales con hero y descripción
- [x] Nivel 2: PacksList.tsx — listado tarjetas ecommerce con foto, precio, bullets, CTA
- [x] Nivel 3: PackDetail.tsx — ficha completa con precio dinámico, incluye/excluye, cross-selling
- [x] Rutas App.tsx: /packs, /packs/:category, /packs/:category/:slug
- [x] Header: menú Packs → 3 categorías (slugs correctos: dia, escolar, empresa)
- [x] BookingModal compatible con packs (isOnlinePurchase)
- [x] Cross-selling en ficha de pack
- [x] TypeScript 0 errores

## Imagen en packs + PacksManager admin (v3.9)
- [x] Diagnosticar: imagen no se guardaba porque no existía gestor de packs en admin
- [x] Crear PacksManager en admin (CRUD completo + upload imagen + menú de acciones)
- [x] Registrar ruta /admin/productos/packs en App.tsx
- [x] Añadir enlace Packs en sidebar del admin
- [x] PacksList ya renderiza image1 correctamente (problema era falta de gestor)
- [x] Rediseñar hero PackDetail: foto de fondo + overlay oscuro + banda de color de categoría
- [x] TypeScript 0 errores

## Gestión de usuarios admin (v4.0)
- [x] Auditar esquema tabla users y panel UsersManager actual
- [x] Backend: crear usuario con nombre, email, rol y token set-password
- [x] Backend: cambiar rol de usuario desde UI (sin ir a BD)
- [x] Backend: endpoint público /public.setPassword para establecer contraseña
- [x] Backend: plantilla email de bienvenida con enlace set-password (inviteEmail.ts)
- [x] Frontend: UsersManager con formulario de creación y cambio de rol
- [x] Frontend: menú de acciones en fila de usuario (Cambiar rol, Reenviar invitación, Desactivar, Eliminar)
- [x] Frontend: página pública /establecer-contrasena con formulario de contraseña

## Unificación diseño Packs = Experiencias (v4.1)
- [x] Auditar Experiences.tsx (tarjetas, filtros, estructura)
- [x] Reescribir PacksList.tsx con mismas tarjetas que Experiences (imagen cuadrada, precio, badges, duración, personas, bullets, CTA)
- [x] Añadir filtros a PacksList (búsqueda por texto + filtro por etiqueta/badge)
- [x] Verificar que la estructura gráfica (grid, padding, hero) es idéntica en ambas secciones

## Correcciones layout v4.2
- [x] PacksList: quitar max-w-6xl para que las tarjetas ocupen el ancho completo como en Experiencias
- [x] Experiences: reparar buscador que quedó pequeño y no permite escribir (Input bloqueado)

## Correcciones layout v4.3
- [x] PacksHome (/packs): quitar max-w-6xl del container de tarjetas de categorías para que ocupen el ancho completo
- [x] PacksHome: imagen de tarjetas cambiada de h-48 fijo a aspect-[16/10] proporcional

## Gestor de Menús optimizado v4.4
- [x] Backend: helpers CRUD de menuItems en db.ts
- [x] Backend: procedimientos cms.getMenuItems, cms.createMenuItem, cms.updateMenuItem, cms.deleteMenuItem, cms.reorderMenuItems en routers.ts
- [x] BD: seed inicial con la estructura actual del menú (7 ítems raíz + submenús)
- [x] Frontend: MenusManager con edición inline, añadir/eliminar ítems, reordenación con flechas, toggle visibilidad

## Corrección cloneExperience v4.5
- [x] Corregir cloneExperience en db.ts para usar nombre nuevo y generar slug correcto (no añadir -copy)
- [x] Corregir procedimiento tRPC cloneExperience en routers.ts para aceptar newName
- [x] Actualizar modal de clonación en frontend para pasar el nombre nuevo al backend
- [x] Corregir la experiencia "Donuts Ski" ya creada: slug corregido a 'donuts-ski' en BD

## Reordenación de ítems en gestores admin v4.6
- [ ] Backend: añadir reorderExperiences en db.ts + routers.ts
- [ ] Backend: añadir reorderPacks en db.ts + routers.ts
- [ ] Backend: añadir reorderCategories en db.ts + routers.ts
- [ ] Backend: añadir reorderLocations en db.ts + routers.ts
- [ ] Frontend: flechas arriba/abajo en ExperiencesManager con persistencia en sortOrder
- [ ] Frontend: flechas arriba/abajo en PacksManager con persistencia en sortOrder
- [ ] Frontend: flechas arriba/abajo en CategoriesManager con persistencia en sortOrder
- [ ] Frontend: flechas arriba/abajo en LocationsManager con persistencia en sortOrder
- [ ] Frontend: flechas arriba/abajo en SlideshowManager (si no las tiene)

## Reordenación de ítems en gestores admin (v4.6)
- [x] Backend: helpers reorderExperiences, reorderPacks, reorderCategories, reorderLocations, reorderSlideshowItems en db.ts
- [x] Backend: procedimientos tRPC reorder en products, packs y cms routers
- [x] Frontend: flechas arriba/abajo con número de posición en ExperiencesManager
- [x] Frontend: flechas arriba/abajo en PacksManager
- [x] Frontend: flechas en CategoriesManager (tarjetas grid)
- [x] Frontend: flechas en LocationsManager (lista)
- [x] Frontend: flechas en SlideshowManager (lista de slides)

## Corrección enlaces rotos experiencias (v4.7)
- [x] Corregir 3 enlaces /experiencia/:slug → /experiencias/:slug en Experiences.tsx (botones "Ver detalle")

## Menú público conectado a BD (v4.9)
- [ ] Auditar PublicNav.tsx para identificar la lista hardcodeada de menús
- [ ] Verificar que existe procedimiento public.getMenuItems en routers.ts
- [ ] Conectar PublicNav al endpoint tRPC para leer menús de la BD dinámicamente
- [ ] Verificar que Circuito SPA Hidrotermal aparece en el submenú de Experiencias

## Menú público conectado a BD (v4.9)
- [x] Añadir procedimiento public.getMenuItems en routers.ts (publicProcedure)
- [x] Reescribir PublicNav.tsx para leer menú de la BD via tRPC (con fallback estático)
- [x] Verificar que Circuito SPA Hidrotermal y Donuts Ski aparecen en el menú público

## Editor Visual de Páginas (v5.0)
- [ ] Auditar PagesManager actual y esquema BD
- [ ] BD: tabla page_blocks (pageId, type, sortOrder, data JSON)
- [ ] Backend: procedimientos CRUD de bloques (getBlocks, saveBlocks)
- [ ] Frontend: editor de bloques con tipos: hero, rich_text, image_text, cta, gallery, accordion, divider
- [ ] Frontend: reordenación de bloques con flechas arriba/abajo
- [ ] Frontend: formulario de propiedades por tipo de bloque
- [ ] Frontend: preview en tiempo real del bloque editado
- [ ] Frontend: renderizador público /pagina/:slug que lee bloques de BD
- [ ] Conectar el botón lápiz del PagesManager al nuevo editor

## Editor Visual de Páginas (v5.0)
- [x] BD: tabla page_blocks (id, pageSlug, blockType, sortOrder, data JSON, isActive)
- [x] BD: seed inicial de 10 páginas en static_pages
- [x] Backend: helpers getAllPages, getPageBySlug, upsertPage, getPageBlocks, savePageBlocks en db.ts
- [x] Backend: procedimientos cms.getPages, cms.getPageBlocks, cms.savePageBlocks, cms.upsertPage en routers.ts
- [x] Backend: procedimientos públicos public.getPublicPage, public.getPublicPageBlocks en routers.ts
- [x] Frontend: PagesManager con editor visual de bloques (hero, texto, imagen+texto, CTA, galería, acordeón, features)
- [x] Frontend: DynamicPage.tsx renderizador público de páginas en /pagina/:slug
- [x] Frontend: ruta /pagina/:slug registrada en App.tsx

## Conectar páginas estáticas al editor visual (v5.1)
- [x] Analizar Hotel.tsx y DynamicPage.tsx para entender la arquitectura
- [x] Modificar Hotel.tsx para leer bloques del editor visual y renderizarlos
- [x] Verificar que los cambios en admin/cms/paginas se reflejan en /hotel
- [x] Aplicar el mismo patrón a /spa si es necesario

## Multimedia y subida de imágenes en editor de páginas (v5.2)
- [x] Auditar MultimediaManager y endpoint de subida de imágenes
- [x] Reparar backend de subida de imágenes (endpoint REST + tRPC)
- [x] Reparar MultimediaManager para que la subida funcione correctamente
- [x] Crear componente ImageUploader reutilizable (sube a S3, guarda en Multimedia)
- [x] Reemplazar campos URL de imagen en PagesManager por ImageUploader

## Hotel & SPA — Arquitectura dinámica completa
- [ ] Esquema BD Hotel: room_types, room_rates, room_inventory, room_blocks, room_rate_seasons
- [ ] Esquema BD SPA: spa_treatments, spa_categories, spa_resources, spa_slots, spa_slot_blocks
- [ ] Helpers DB Hotel (CRUD + disponibilidad + calendario)
- [ ] Helpers DB SPA (CRUD + agenda + slots)
- [ ] tRPC Hotel: getPublicRoomTypes, searchAvailability, getRoomCalendar, admin CRUD
- [ ] tRPC SPA: getPublicTreatments, getSpaSlots, admin CRUD
- [ ] Frontend /hotel: buscador + tarjetas dinámicas + detalle con calendario de precios
- [ ] Frontend /spa: buscador + tarjetas dinámicas + selector de horarios
- [ ] Admin CMS Hotel: CRUD tipologías, tarifas, inventario, calendario channel manager
- [ ] Admin CMS SPA: CRUD tratamientos, recursos, agenda semanal, slots
- [ ] Integrar rutas y navegación admin Hotel/SPA

## Hotel y SPA — Arquitectura dinámica completa (v5.3)
- [x] Esquema BD Hotel: room_types, rate_seasons, room_rates, room_blocks (9 tablas nuevas)
- [x] Esquema BD SPA: spa_categories, spa_treatments, spa_resources, spa_slots, spa_schedule_templates
- [x] Migración SQL aplicada correctamente
- [x] Helpers de BD: hotelDb.ts y spaDb.ts con CRUD completo
- [x] Procedimientos tRPC hotel.* (getRoomTypes, searchAvailability, adminGetRoomTypes, adminCreateRoomType, adminUpdateRoomType, adminDeleteRoomType, adminToggleRoomTypeActive, adminGetRateSeasons, adminCreateRateSeason, adminDeleteRateSeason, adminGetRates, adminCreateRate, adminUpdateRate, adminDeleteRate, adminGetBlocks, adminUpsertBlock, adminDeleteBlock, adminGetCalendar)
- [x] Procedimientos tRPC spa.* (getCategories, getTreatments, getTreatmentBySlug, getAvailableSlots, adminGetCategories, adminCreateCategory, adminDeleteCategory, adminGetTreatments, adminCreateTreatment, adminUpdateTreatment, adminDeleteTreatment, adminToggleTreatmentActive, adminGetResources, adminCreateResource, adminUpdateResource, adminDeleteResource, adminGetSlots, adminCreateSlot, adminUpdateSlot, adminDeleteSlot, adminGetTemplates, adminCreateTemplate, adminUpdateTemplate, adminDeleteTemplate, adminGenerateSlots)
- [x] Frontend público Hotel.tsx dinámico: buscador de disponibilidad, tarjetas por tipología, fallback a contenido estático
- [x] Frontend público HotelRoom.tsx: detalle de habitación con galería, amenities, calendario de precios y formulario de reserva
- [x] Frontend público Spa.tsx dinámico: buscador, filtro por categorías, tarjetas de tratamientos, selector de horarios
- [x] Admin HotelManager.tsx: CRUD tipologías con ImageUploader, calendario de inventario tipo channel manager, temporadas de precio
- [x] Admin SpaManager.tsx: CRUD tratamientos con categorías, plantillas de horario semanal, calendario de slots, generación automática de slots
- [x] Rutas /hotel/:slug y /admin/hotel y /admin/spa registradas en App.tsx
- [x] Hotel y SPA añadidos al menú lateral del admin (BedDouble y Sparkles icons)
- [x] 0 errores TypeScript en todo el proyecto

## Integración de layout Hotel y SPA (v5.4)
- [x] Envolver Hotel.tsx en PublicLayout (header + footer)
- [x] Envolver HotelRoom.tsx en PublicLayout (header + footer)
- [x] Envolver Spa.tsx en PublicLayout (header + footer)
- [x] Envolver HotelManager.tsx en AdminLayout (sidebar + cabecera admin)
- [x] Envolver SpaManager.tsx en AdminLayout (sidebar + cabecera admin)

## Seed Hotel — Temporada 2026 (v5.5)
- [x] Insertar 4 tipologías: Doble Estándar, Doble Superior Vistas Lago, Familiar, Junior Suite Premium
- [x] Insertar temporada de precio: Temporada Alta 2026 (01/03/2026 - 30/09/2026)
- [x] Insertar tarifas por tipología (precios reales del dossier)
- [x] Insertar inventario de habitaciones disponibles (room_blocks abiertos)

## Seed SPA Náyade — Temporada 2026 (v5.6)
- [x] Insertar 4 categorías: Circuito Hidrotermal, Zona Wellness, Masajes, Clinic Spa
- [x] Insertar tratamientos con precios reales del dossier
- [x] Insertar plantillas de horario (Viernes 15-22h, Sábados 10-22h, Domingos 10-17:30h)
- [x] Generar slots de disponibilidad Mar-Sep 2026

## Bugs (v5.7)
- [x] Hotel.tsx: falta margen/padding-top bajo el header (contenido queda pegado al nav)
- [x] Spa.tsx: botones Reservar generan URLs rotas — redirigen a /contacto con parámetros del tratamiento

## SpaDetail — Página de detalle de tratamiento (v5.8)
- [x] Añadir procedimiento getTreatmentBySlug en spa.ts
- [x] Crear SpaDetail.tsx con galería, descripción, beneficios y calendario de reservas
- [x] Registrar ruta /spa/:slug en App.tsx
- [x] Actualizar botones Reservar en Spa.tsx para apuntar a /spa/:slug

## HotelRoom — Mejoras (v5.9)
- [ ] Corregir espacio bajo el header en la ficha de habitación
- [ ] Añadir selector de fechas check-in/check-out con cálculo de noches
- [ ] Añadir selector de número de adultos y niños
- [ ] Calcular precio total automáticamente (precio/noche × noches × personas)
- [ ] Conectar botón Reservar al flujo de pago Redsys
- [ ] Crear procedimiento tRPC createHotelBooking en hotel.ts

## HotelRoom — Reserva con Redsys (v5.9)
- [x] HotelRoom.tsx: añadir padding-top correcto bajo el header fijo (h-28/h-32)
- [x] HotelRoom.tsx: añadir botón Reservar con selector de fechas y personas
- [x] HotelRoom.tsx: cálculo de precio total por noches en backend (precio_noche × noches)
- [x] HotelRoom.tsx: pago vía Redsys con modal de confirmación (nombre, email, teléfono, notas)
- [x] hotel.ts: procedimiento createHotelBooking con lógica de precio por temporada
- [x] hotel.ts: buscar precio correcto según temporada (rate_seasons + room_rates)

## SpaDetail — Reserva con Redsys (v6.0)
- [ ] spa.ts: procedimiento createSpaBooking con lógica de precio y pago Redsys
- [ ] SpaDetail.tsx: selector de fecha/hora desde slots disponibles
- [ ] SpaDetail.tsx: contador de personas con validación de capacidad
- [ ] SpaDetail.tsx: cálculo de precio total en backend
- [ ] SpaDetail.tsx: modal de confirmación con formulario de datos del cliente
- [ ] SpaDetail.tsx: pago vía Redsys (mismo patrón que HotelRoom)

## SpaDetail — Reserva con Redsys (v6.0)
- [x] Crear procedimiento createSpaBooking en spa.ts con lógica de precio y Redsys
- [x] Reemplazar BookingPanel en SpaDetail.tsx con modal de confirmación y pago Redsys

## SpaDetail — Rediseño visual (v6.1)
- [x] Cambiar fondo blanco/gris a fondo oscuro premium con gradientes teal para mejor legibilidad

## Sistema de Opiniones y Valoraciones (v6.2)
- [x] BD: tabla reviews (entityType hotel/spa, entityId, authorName, authorEmail, rating 1-5, title, body, status pending/approved/rejected, adminReply, createdAt)
- [x] Schema Drizzle: añadir tabla reviews + tipos TypeScript
- [x] Migración SQL aplicada en BD
- [x] Backend: helpers reviewsDb.ts (getReviews, createReview, approveReview, rejectReview, deleteReview, getStats)
- [x] Backend: procedimientos tRPC reviews.* (getPublicReviews, submitReview, adminGetReviews, adminApprove, adminReject, adminDelete, adminReply)
- [x] Frontend: componente ReviewSection.tsx (sección completa: estrellas interactivas, stats, listado paginado, formulario)
- [x] Frontend: integrar ReviewSection en HotelRoom.tsx
- [x] Frontend: integrar ReviewSection en SpaDetail.tsx
- [x] Admin: ReviewsManager.tsx con listado, filtros, moderación y respuesta
- [x] Admin: ruta /admin/operaciones/resenas + enlace en sidebar
- [x] Tests Vitest para reviews (14 tests pasando: validación inputs, cálculo estadísticas, moderación)
- [x] 0 errores TypeScript

## Selector de Niños con Edades en Hotel (v6.3)
- [x] Hotel.tsx: añadir selector de nº de niños en el buscador principal con edades individuales
- [x] HotelRoom.tsx: añadir selector de nº de niños con edades individuales en el panel lateral de reserva
- [x] Pasar childrenAges al backend para que lo incluya en la reserva

## Fix Selector Edades Niños (v6.4)
- [x] HotelRoom.tsx: reemplazar select nativo por selector custom con botones +/- (texto siempre visible, sin dropdown nativo)
- [x] Hotel.tsx: aplicar el mismo selector custom en el buscador principal

## Exportación Local Independiente de Manus (v7.0)
- [x] Auditoría completa de dependencias Manus en código fuente
- [x] Auth local: login/registro con email+password + JWT (reemplaza Manus OAuth)
- [x] Stub LLM: wrapper configurable (OpenAI-compatible o mock)
- [x] Stub Storage: S3 estándar (AWS/MinIO) o almacenamiento local
- [x] Stub Notificaciones: email SMTP o log en consola
- [x] Stub Mapas: Google Maps API key propia
- [x] Stub Generación de imágenes: OpenAI DALL-E o mock
- [x] env.example.txt completo y documentado para entorno local
- [x] docker-compose.yml con MySQL + MinIO + servidor Node
- [x] Dockerfile multi-stage para producción
- [x] README-LOCAL.md con instrucciones de arranque paso a paso
- [x] Script scripts/create-admin.mjs para crear el primer usuario admin
- [x] Verificar 0 errores TypeScript tras todos los cambios

## Login Local + Setup MinIO (v7.1)
- [x] Página /login con formulario email+contraseña (diseño coherente con la plataforma)
- [x] Lógica de sesión local: POST /api/auth/login, cookie JWT, redirección post-login
- [x] App.tsx: ruta /login registrada, redirección desde rutas protegidas
- [x] useAuth / contexto: detectar modo LOCAL_AUTH, ocultar botón Manus OAuth
- [x] Botón "Cerrar sesión" funcional en modo local (llama a /api/auth/logout)
- [x] Script scripts/setup-minio.mjs: crea bucket + política pública + carpetas base
- [x] vite.config.ts: inyecta VITE_LOCAL_AUTH desde LOCAL_AUTH del .env
- [x] README-LOCAL.md actualizado con los nuevos pasos
- [x] 0 errores TypeScript

## Recuperación de Contraseña + Middleware Auth + GitHub (v7.2)
- [x] BD: tabla password_reset_tokens (userId, token, expiresAt, usedAt)
- [x] Backend: POST /api/auth/forgot-password — genera token, envía email con enlace
- [x] Backend: POST /api/auth/reset-password — valida token, actualiza contraseña
- [x] Backend: GET /api/auth/validate-reset-token — verifica validez sin consumir
- [x] Frontend: página /recuperar-contrasena con formulario de email y estado de confirmación
- [x] Frontend: página /nueva-contrasena?token=xxx con indicador de fortaleza y coincidencia
- [x] Frontend: enlace "¿Olvidaste tu contraseña?" en /login
- [x] Middleware Express: server/authGuard.ts verifica sesión en rutas /api/trpc protegidas
- [x] Middleware devuelve 401 con formato tRPC si no hay sesión válida
- [x] README-LOCAL.md actualizado con flujo de recuperación y sección de middleware
- [x] 0 errores TypeScript

## Documentación del Proyecto (v7.3)
- [x] CLAUDE.md — guía de contexto para Claude en VS Code
- [x] PROGRESS.md — historial de versiones y estado de funcionalidades
- [x] ARCHITECTURE.md — arquitectura técnica completa
- [x] Sincronizar en GitHub via checkpoint

## Script de Seed de Datos (v7.4)
- [x] Exportar datos actuales de BD a scripts/seed-data.mjs (80 KB, 126 registros en 17 tablas)
- [x] Tablas: categories, locations, site_settings, menu_items, slideshow_items, static_pages, page_blocks, home_module_items, experiences, experience_variants, packs, pack_cross_sells, room_types, room_rate_seasons, room_rates, spa_categories, spa_treatments
- [x] Respetar orden de inserción por foreign keys (SET FOREIGN_KEY_CHECKS=0)
- [x] DELETE FROM antes de insertar para evitar duplicados
- [x] Resumen final de registros insertados por tabla
- [x] Verificado: ejecuta limpio con node scripts/seed-data.mjs (126 registros insertados)
- [x] Script auxiliar scripts/export-to-seed.mjs para regenerar el seed desde la BD actual

## Seed: Añadir Reseñas (v7.5)
- [x] Añadir tabla reviews a export-to-seed.mjs
- [x] Regenerar seed-data.mjs con las 102 reseñas incluidas (140 KB, 228 registros totales)
- [x] Verificado: seed ejecuta limpio con 18 tablas y 228 registros insertados

## Catálogo Tipologías Hotel + Inventario Real (v7.6)
- [x] Inspeccionar room_types actuales en BD (4 tipologías existentes)
- [x] Comparar con planos y detectar tipologías faltantes (5 detectadas)
- [x] Crear tipologías faltantes: Triple, Cuádruple, Suite, Personal, Habitación Grande
- [x] Actualizar totalUnits de las 4 tipologías existentes con inventario real
- [x] Añadir campo internalTags JSON en BD y schema Drizzle para marcas G, P, *
- [x] Regenerar seed-data.mjs con las 9 tipologías (146 KB, 237 registros)
- [x] Preparar prompt para Claude en VS Code

## Catálogo Hotelero Limpio según Planos Reales (v7.6)
- [x] Contabilizado inventario real por tipología (Bloque Principal + Bloque F) desde planos
- [x] Eliminadas tipologías incorrectas (IDs 60001-60005)
- [x] Actualizadas tipologías existentes (IDs 1-4) con inventario real
- [x] Creadas tipologías faltantes: Triple (12u), Cuádruple (8u), Habitación Grande (70u), Suite (2u), Personal (6u, no pública)
- [x] Junior Suite Premium renombrada a Junior (2u, hab 138+218 Bloque F)
- [x] internalTags con desglose por bloque, marcas G/P/* guardadas como metadata interna
- [x] Regenerado seed-data.mjs con 9 tipologías y 237 registros totales
- [x] 0 errores TypeScript

## Módulo Completo de Restaurantes (v8.0)

### BD y Backend
- [x] Tablas: restaurants, restaurant_shifts, restaurant_closures, restaurant_bookings, restaurant_booking_logs, restaurant_staff
- [x] Columna `role` extendida con valor `adminrest` en tabla users
- [x] Helpers BD: restaurantsDb.ts con CRUD completo
- [x] Router tRPC: restaurants.ts con procedimientos públicos y de admin
- [x] Disponibilidad en tiempo real por turno y franja
- [x] Generación de localizador único por reserva (NR-XXXXXX)
- [x] Corregir authGuard: rutas públicas de restaurantes (bug barra inicial en req.url)

### Frontend Público
- [x] Página /restaurantes — listado dinámico desde BD con cards premium
- [x] Ficha /restaurantes/:slug — hero, descripción, horarios, galería, CTA reservar (datos reales BD)
- [x] Flujo de reserva wizard 3 pasos (fecha/turno → datos → confirmación)
- [ ] Integración pago Redsys para depósito de restaurante
- [ ] Página /restaurantes/reserva-ok — confirmación tras pago
- [ ] Página /restaurantes/reserva-ko — error de pago

### Backoffice Admin
- [x] Sección Restaurantes en sidebar del admin (icono UtensilsCrossed)
- [x] Ruta /admin/restaurantes en App.tsx
- [x] RestaurantsManager: listado de reservas con filtros, búsqueda y paginación
- [x] Procedimientos admin: adminGetBookings, adminGetCalendar, adminAddNote, adminUpdateConfig, adminDeleteBooking
- [ ] Calendario operativo visual (vistas día/semana)
- [ ] Configuración de turnos y horarios desde el admin
- [ ] Rol adminrest con acceso restringido a su/s restaurante/s

### Seed y Datos Iniciales
- [x] Seed de los 4 restaurantes: El Galeón, Nassau Bar & Music, La Cabaña del Lago, Arrocería La Cabaña
- [x] Configuración inicial de turnos y horarios por restaurante (9 turnos)
- [x] Script scripts/seed-restaurants.mjs idempotente (no duplica si ya existe)

### Calidad
- [x] 0 errores TypeScript
- [x] 28 tests Vitest para restaurantes (localizador, depósito, disponibilidad, validación, datos)
- [x] 72 tests totales pasando (todos los módulos)

## Rol adminrest — Acceso exclusivo al gestor de restaurantes (v8.1)

### Backend
- [x] Crear `adminrestProcedure` en trpc.ts (acepta admin + adminrest)
- [x] Extender `createUser` y `changeUserRole` para incluir rol `adminrest`
- [x] Añadir procedimiento `adminGetStaff` para listar staff asignado a un restaurante
- [x] Proteger todos los procedimientos admin de restaurantes con `adminrestProcedure`

### Frontend
- [x] Guard de rutas `/admin/restaurantes/*`: redirigir a login si no autenticado, a `/admin` si rol no permitido
- [x] AdminLayout: redirect automático del rol `adminrest` a `/admin/restaurantes` (no a `/admin`)
- [x] AdminDashboard: mostrar vista reducida o redirect para rol `adminrest`
- [x] UsersManager: añadir rol `adminrest` en selector de roles con badge naranja
- [x] Sección "Asignar Restaurantes" en el panel de gestión de usuarios (solo para usuarios adminrest)
- [x] RestaurantsManager: mostrar solo los restaurantes asignados al usuario adminrest

### Calidad
- [x] 0 errores TypeScript
- [x] 28 tests para el middleware adminrest (100 tests totales)

## Mejoras Backoffice Restaurantes v8.2

### Creación de reservas desde admin (punto 1)
- [x] Botón "Nueva Reserva" en RestaurantsManager que abre modal de creación
- [x] Formulario completo: restaurante, turno, fecha, hora, comensales, datos cliente
- [x] Selector "¿Requiere pago de depósito?" (sí/no) — por defecto sí (5€/comensal)
- [x] Si pago=sí: generar link de pago Redsys y enviarlo por email al cliente
- [x] Si pago=no: crear reserva directamente como "confirmed" sin pago
- [x] Procedimiento tRPC `adminCreateBooking` extendido con requiresPayment + sendPaymentEmail
- [x] Plantilla de email con link de pago para reservas de restaurante

### Configuración del admin (punto 2)
- [x] Página /admin/configuracion funcional con persistencia en BD (tabla site_settings)
- [x] Sección: Datos generales del sitio (nombre, email, teléfono, dirección, web, SEO)
- [x] Sección: Horarios de apertura (temporada alta/baja, días)
- [x] Sección: Parámetros de pagos (IVA, moneda, validez presupuesto, depósito restaurante)
- [x] Sección: Notificaciones (emails de alertas por tipo de reserva)
- [x] Sección: Integraciones GHL (informativa, apunta a Secrets del panel)
- [x] Procedimientos cms.getSiteSettings y cms.updateSiteSettings en el router

### Calendario global de restaurantes (punto 3)
- [x] Nuevo ítem en sidebar admin: "Calendario Global" bajo Restaurantes
- [x] Ruta /admin/restaurantes/calendario → GlobalCalendar.tsx
- [x] Vista mensual con puntos de color por restaurante y contador de reservas por día
- [x] Filtro por restaurante (selector + botones de leyenda con colores)
- [x] Click en día: panel lateral con timing ordenado por hora
- [x] Cada reserva muestra: hora, nombre cliente, teléfono, restaurante, icono de pago
- [x] Resumen mensual: total reservas, confirmadas, pendientes, comensales
- [x] Procedimiento tRPC `adminGetGlobalCalendar` en el router de restaurantes
- [x] 100 tests pasando (sin regresiones)

## Mejoras v8.3 — Emails, Turnos y Notificaciones

### Email de confirmación automático al reservar online
- [x] Función `sendRestaurantConfirmEmail` en el router de restaurantes
- [x] Plantilla HTML de confirmación con localizador, restaurante, fecha, turno y comensales
- [x] Llamada en `createBooking` público: enviar email automático al cliente
- [x] Fallback gracioso: si SMTP no configurado, la reserva se crea igualmente

### CRUD de turnos desde el admin
- [x] Procedimientos tRPC ya existentes: adminGetShifts, adminCreateShift, adminUpdateShift, adminDeleteShift
- [x] Componente `ShiftFormRow` reutilizable para crear/editar turnos
- [x] Vista Config. del RestaurantsManager expandida con sección "Turnos de servicio"
- [x] Formulario de turno: nombre, horario inicio/fin, aforo, días de la semana, activo/inactivo
- [x] Edición inline y eliminación con confirmación
- [x] Indicador visual de estado (punto verde/gris)

### Notificación push al adminrest
- [x] Función `notifyRestaurantStaff(restaurantId, title, content)` en el router
- [x] Al crear reserva online, notifica al adminrest asignado al restaurante
- [x] Fallback: si no hay adminrest asignado, notifica al admin general
- [x] 100 tests pasando (sin regresiones)

## Mejoras v8.4 — Tarjeta de reserva mejorada

- [x] Toggle manual Show/No-show en la tarjeta de reserva (check visual que alterna entre Show/No-show)
- [x] Badge visual de estado de pago: verde “Pagado” / naranja “Sin pagar” / gris “Sin depósito”
- [x] Teléfono del cliente clickable con `tel:` en la tarjeta de reserva (RestaurantsManager)
- [x] Teléfono clickable también en el panel lateral del GlobalCalendar
- [x] 0 errores TypeScript, 100 tests pasando

### Mejoras v8.5 — Páginas de confirmación de reserva de restaurante
- [x] Página /restaurantes/reserva-ok — confirmación de pago exitoso con datos de la reserva
- [x] Página /restaurantes/reserva-ko — error de pago con opción de reintentar
- [x] Procedimiento tRPC `restaurants.getBookingByLocator` para consultar estado real
- [x] Conectar las URLs de retorno Redsys del flujo de restaurante a las nuevas páginas
- [x] Registrar rutas en App.tsx
- [x] 0 errores TypeScript reales (tsc --noEmit), 100 tests pasando

## Mejoras v8.6 — Endpoint IPN Redsys para restaurantes
- [x] Función `getBookingByMerchantOrder` en restaurantsDb.ts
- [x] Endpoint POST /api/redsys/restaurant-notification en redsysRoutes.ts
- [x] Actualiza paymentStatus/status de la reserva de restaurante al recibir IPN
- [x] Notificación al owner cuando se confirma un pago de restaurante
- [x] Páginas /restaurantes/reserva-ok y /restaurantes/reserva-ko registradas en App.tsx
- [x] 0 errores TypeScript reales (tsc --noEmit)

## Bugs móvil (iPhone 15) — v8.7
- [x] Productos no cargan en móvil: Experiencias, Packs, Hotel, SPA (en PC sí cargan)
- [x] Menú móvil: categorías principales (Experiencias, Packs, Hotel, SPA, etc.) no son clickables
- [x] Causa raíz: authGuard bloqueaba con 401 todos los procedimientos no listados (sin cookie de sesión en móvil)
- [x] Corregir authGuard.ts: añadidos todos los procedimientos públicos reales del frontend
- [x] Corregir menú móvil PublicNav.tsx: label navega directamente, chevron expande submenú

## Bug lógica depósito en reservas admin — v8.8
- [x] Bug: al crear reserva sin marcar "cobrar depósito", el listado mostraba icono de pagado
- [x] Causa raíz: servidor guardaba depositAmount del restaurante aunque requiresPayment=false
- [x] Fix servidor: cuando requiresPayment=false, depositAmount se guarda como "0"
- [x] Fix frontend RestaurantsManager: badge distingue paid+depositAmount>0 (verde) vs paid+depositAmount=0 (gris)
- [x] Fix frontend GlobalCalendar: mismo fix en el panel lateral del calendario
- [x] 0 errores TypeScript reales (tsc --noEmit), 100 tests pasando

## Rediseño plantillas email corporativas — v8.10
- [x] Subir logo Náyade al CDN (https://d2xsxph8kpxj0f.cloudfront.net/...)
- [x] Inventariar todas las plantillas de email existentes (6 plantillas)
- [x] Crear módulo emailTemplates.ts con plantilla base HTML corporativa (azul marino #1e3a6e, naranja #f97316, logo, datos contacto)
- [x] Rediseñar: email confirmación reserva restaurante (cliente) — buildRestaurantConfirmHtml
- [x] Rediseñar: email link de pago depósito restaurante (cliente) — buildRestaurantPaymentLinkHtml
- [x] Rediseñar: email confirmación reserva experiencia/pack (cliente) — buildReservationConfirmHtml
- [x] Rediseñar: email pago fallido experiencia/pack (cliente) — buildReservationFailedHtml
- [x] Rediseñar: email invitación/activación de cuenta — buildInviteHtml
- [x] Rediseñar: email recuperación de contraseña — buildPasswordResetHtml
- [x] Enviar 6 plantillas de prueba a jgrande@skicenter.es — todas entregadas con éxito

## Configuración real de restaurantes — v8.11
- [x] Schema BD: campo slotMinutes añadido a restaurant_shifts (default 30 min)
- [x] Migración SQL aplicada via webdev_execute_sql
- [x] Router: adminUpdateConfig ampliado con todos los campos de la ficha (phone, email, location, description, longDescription, cuisine, badge, heroImage, galleryImages, cancellationPolicy, minAdvanceHours, maxAdvanceDays, depositPerGuest, maxGroupSize, acceptsOnlineBooking)
- [x] Router: adminCreateShift y adminUpdateShift con campo slotMinutes
- [x] Router: getAvailability devuelve slotMinutes por turno
- [x] Admin: panel Configuración reemplaza duplicidad con 3 tabs: Ficha / Operativa / Turnos
- [x] Admin: tab Ficha — nombre, descripción corta/larga, cocina, badge, teléfono, email, ubicación, política cancelación
- [x] Admin: tab Operativa — booking on/off, depósito, grupo máximo, antelación mín/máx, subida hero + galería
- [x] Admin: tab Turnos — CRUD con nombre, horario inicio/fin, días, capacidad, slotMinutes
- [x] Admin: creación de nuevo restaurante desde botón + formulario completo
- [x] Formulario público: selector de hora concreta dentro del turno (slots cada slotMinutes)
- [x] Formulario público: aviso levantamiento de mesa (30 min antes del siguiente turno)
- [x] Formulario público: botón Continuar requiere hora seleccionada además de turno
- [x] Email confirmación: incluye hora exacta elegida por el cliente
- [x] Landing pública: muestra teléfono, email, ubicación y horarios desde la ficha
- [x] 0 errores TypeScript (tsc --noEmit), 100 tests pasando

## Bug slugs restaurantes — v8.12
- [x] Landing de restaurantes no encontrada: slug en URL no coincide con slug en BD
- [x] Causa raíz: menú/footer usaban /la-cabana y /nassau en lugar de /la-cabana-del-lago y /nassau-bar
- [x] Corregir PublicNav.tsx: slugs correctos + añadida Arrocería La Cabaña
- [x] Corregir PublicFooter.tsx: slugs correctos + añadida Arrocería La Cabaña
- [x] Corregir menu_items en BD: UPDATE slugs + INSERT Arrocería La Cabaña
- [x] Corregir orden de rutas en App.tsx: rutas fijas /reserva-ok y /reserva-ko antes de /:slug

## Headers uniformizados al estilo Packs — v8.15
- [x] Restaurantes: foto hero cambiada a imagen de terraza junto al lago (Cableski.png), altura 50vh/380px
- [x] Experiencias: header plano reemplazado por hero con imagen (wakeboard) y estilo Packs
- [x] Galería: header plano reemplazado por hero con imagen (panorámica embalse) y estilo Packs
- [x] Ubicación: header plano reemplazado por hero con imagen (panorámica embalse) y estilo Packs
- [x] Presupuesto: header plano reemplazado por hero con imagen (kayak) y estilo Packs
- [x] Hotel y SPA: sin cambios (respetado según instrucciones)
- [x] 0 errores TypeScript

## Gestor de Galería en admin — v8.13
- [x] Auditar galería pública actual (fotos hardcodeadas vs BD)
- [x] Schema BD: tabla gallery_items (id, imageUrl, fileKey, title, category, sortOrder, isActive, createdAt)
- [x] Migración SQL aplicada
- [x] tRPC: gallery.getItems (público), gallery.getCategories (público), gallery.adminCreate/adminUpdate/adminDelete/adminReorder (admin)
- [x] Admin: gestor de galería con subida de fotos a S3, categorías, orden drag-and-drop
- [x] Admin: registrar ruta /admin/cms/galeria en sidebar bajo CMS
- [x] Página pública /galeria: conectar a BD en lugar de fotos hardcodeadas
- [x] Filtros de categoría en la galería pública funcionan con datos reales
- [x] gallery.getItems y gallery.getCategories añadidos a whitelist authGuard (acceso móvil sin sesión)
- [x] 0 errores TypeScript, 100 tests pasando

## Rediseño Landing Solicitar Presupuesto — v8.17
- [x] Auditar BudgetRequest.tsx, routers y schema de leads actuales
- [x] Schema BD: añadir campos selectedCategory, selectedProduct, numberOfAdults, numberOfChildren a leads
- [x] Backend: procedimiento public.submitBudget con campos nuevos, emails automáticos (usuario + admin reservas@hotelnayade.es)
- [x] Frontend: hero comercial con claim potente + subtítulo orientado a conversión
- [x] Frontend: formulario simplificado (nombre, email, teléfono, día llegada, adultos, niños, experiencia, comentarios)
- [x] Frontend: selector jerárquico Categoría → Producto (carga dinámica desde BD para Experiencias y Packs)
- [x] Frontend: opción "Petición especial / Propuesta personalizada" siempre visible
- [x] Frontend: honeypot anti-spam + validaciones email/teléfono/fecha
- [x] Frontend: pantalla de confirmación post-envío visual y sin redirección rota
- [x] Backend: origen del lead guardado como "landing_presupuesto"
- [x] Backend: si email falla, lead se guarda igualmente (try/catch)
- [x] public.submitBudget añadido a whitelist authGuard
- [x] 0 errores TypeScript, 100 tests pasando

## Rediseño Visual Premium Landing Presupuesto — v8.18
- [x] Hero a pantalla completa con foto aspiracional + overlay degradado elegante + zoom lento animado
- [x] Claim emocional grande ("Diseñamos tu experiencia perfecta") + subclaim comercial
- [x] Formulario premium en card flotante dark glass con barra degradada, sombras y bordes redondeados
- [x] Inputs grandes con estilo dark, botón CTA protagonista degradado naranja
- [x] Bloque de iconos experienciales (agua, aventura, parejas, familias, relax, empresas)
- [x] Frases de confianza: 24h, personalizado, sin compromiso, parejas/familias/empresas
- [x] Separadores visuales suaves + animaciones fade-in al scroll con IntersectionObserver
- [x] Strip de miniaturas de fotos reales en hero y sección beneficios
- [x] Copy publicitario en todo el formulario (pasos numerados, preguntas experienciales)
- [x] Pantalla de éxito inmersiva sobre fondo de foto
- [x] Lógica funcional (leads, emails, validaciones, honeypot) intacta
- [x] 0 errores TypeScript, 100 tests pasando

## Ajuste UX — Formulario integrado en Hero (split layout) — v8.19
- [x] Hero a pantalla completa con layout split: claim izquierda + formulario glass derecha
- [x] Formulario visible sin scroll en desktop (card con scroll interno si el selector se expande)
- [x] Card flotante glass: rgba(10,20,40,0.82) + blur(20px) + sombra premium + borde sutil
- [x] Bloque oscuro secundario eliminado
- [x] Bloque de beneficios ligero (4 iconos) mantenido debajo del hero
- [x] Lógica funcional intacta (leads, emails, validaciones, honeypot)
- [x] 0 errores TypeScript, 100 tests pasando

## Fix emails formulario presupuesto — v8.21
- [x] Diagnosticado: lead sí llega a BD, SMTP funciona, el problema era email admin hardcodeado a reservas@hotelnayade.es (dominio inexistente) y un solo try/catch que cortaba el flujo
- [x] Corregido: email admin usa ADMIN_EMAIL env var (fallback reservas@nayadeexperiences.es)
- [x] Corregido: try/catch independientes para email usuario y email admin (uno no bloquea al otro)
- [x] Verificado: email de prueba enviado a reservas@nayadeexperiences.es con éxito (messageId confirmado)
- [x] 0 errores TypeScript

## Rediseño bloques Home — v8.22
- [x] Bloque Packs Día Completo: tarjetas foto-fondo aspiracionales, fondo dark navy, overlay degradado, badge ★ Más Popular
- [x] Bloque Hotel Náyade: layout split imagen izquierda + contenido dark navy derecha, badge flotante ★★★, grid de habitaciones con precios
- [x] Bloque SPA: layout split contenido dark verde + doble imagen derecha con servicios overlay glass
- [x] Bloque Sabores del Lago (Restaurantes): tarjetas foto-fondo con emoji, tipo y CTA, fondo dark marrón cálido
- [x] Bloque Testimonios: cards glass dark con avatar inicial, línea acento, métricas de confianza (10.000+ clientes, 4.8★)
- [x] 0 errores TypeScript

## Mejoras bloques Home — v8.23
- [x] Hotel Náyade: nueva foto (puente/lago), fondo blanco→gris claro (#f8fafc→#e8eef5), iconos SVG vectoriales (cama, olas, usuarios, estrella)
- [x] 10 Razones: fondo dark navy con radial-gradient, tarjetas glass con línea acento animada, CTA "Diseña tu Experiencia"
- [x] Sabores del Lago: vinculado a trpc.restaurants.getAll (fotos reales, banda Abierto/Cerrado, próximo turno, skeleton loading)
- [x] 0 errores TypeScript

## Logos nuevos + Plantillas Email Premium — v8.24
- [x] Subir nayade_blue.png (logo circular azul) al CDN con fondo transparente
- [x] Subir nayade_White.png (logo circular blanco) al CDN con fondo transparente
- [x] Actualizar header público con logo azul (sin recuadro blanco)
- [x] Actualizar footer con logo blanco (sin recuadro blanco)
- [x] Actualizar sidebar admin con logo azul
- [x] Rediseñar plantilla email confirmación reserva: estilo premium dark navy + naranja, wave SVG, logo circular, iconos SVG inline
- [x] Rediseñar plantilla email pago fallido: estilo moderno aspiracional
- [x] Rediseñar plantilla email restaurante confirmación: estilo resort premium
- [x] Rediseñar plantilla email restaurante link de pago: estilo resort premium
- [x] Rediseñar plantilla email invitación de cuenta: estilo corporativo premium
- [x] Rediseñar plantilla email recuperación de contraseña: estilo moderno
- [x] Rediseñar plantilla email solicitud presupuesto (usuario): estilo resort premium
- [x] Rediseñar plantilla email solicitud presupuesto (admin): estilo operacional moderno con CTA mailto
- [x] Enviar 8 plantillas de prueba a administracion@nayadeexperiences.es
- [x] 0 errores TypeScript, tests pasando

## Ritmo Visual Home — v8.25
- [x] Auditar todos los módulos de la home (9 secciones, todas dark navy = monótono)
- [x] Sección Experiencias: fondo blanco puro, tarjetas con sombra suave, texto gris oscuro
- [x] Sección Packs: foto panorámica de fondo visible + overlay semitransparente (no sólido)
- [x] Sección Hotel: split foto/blanco puro, tarjetas habitaciones en gris claro, iconos azul cielo
- [x] Sección SPA: foto de fondo visible en columna contenido + overlay verde oscuro semitransparente
- [x] Sección Restaurantes: fondo arena/crema cálido (#faf7f2→#f5ede0), tarjetas foto-fondo
- [x] Sección 10 Razones: foto del lago de fondo + overlay azul marino semitransparente + radial glow
- [x] Sección Testimonios: fondo blanco/gris muy claro (#f8fafc→#eef2f7), cards blancas con sombra
- [x] Sección CTA Final: foto kayak de fondo + overlay oscuro fuerte, botón naranja impactante
- [x] Ritmo alternado: oscuro→claro→foto→claro→foto→claro→foto→claro→foto
- [x] 0 errores TypeScript

## Formulario Presupuesto en Hero Home — v8.26
- [x] Revisar formulario de la página /presupuesto
- [x] Layout hero split: texto+CTAs izquierda / formulario derecha (glass card)
- [x] Formulario con los mismos campos que /presupuesto (nombre, email, teléfono, tipo, fecha, personas, mensaje)
- [x] Envío conectado al mismo tRPC public.submitBudget
- [x] Pantalla de éxito inline con botón de nueva solicitud
- [x] 0 errores TypeScript

## CRM Comercial Completo — v9.0

### Base de Datos
- [x] Ampliar tabla leads: opportunity_status, priority, internal_notes, last_contact_at, lost_reason
- [x] Ampliar tabla quotes: lead_id, quote_number, subtotal, tax, total, conditions, valid_until, sent_at, viewed_at
- [x] Crear tabla crm_activity_log: entity_type, entity_id, action, actor_id, details, created_at
- [x] Crear tabla invoices: quote_id, invoice_number, client_name, client_email, items_json, subtotal, tax, total, pdf_url, issued_at

### Backend tRPC (crm router)
- [x] leads.list con filtros (opportunityStatus, search) + paginación
- [x] leads.counters (nueva/enviada/ganada/perdida/total)
- [x] leads.get (ficha completa con actividad, quotes asociados)
- [x] leads.update (cambiar opportunityStatus, priority)
- [x] leads.addNote (notas internas con autor y timestamp)
- [x] leads.markLost (acción manual)
- [x] leads.convertToQuote (crea quote con datos del lead, genera quote_number)
- [x] quotes.list con filtros + paginación
- [x] quotes.counters KPI (borrador/enviado/aceptado/rechazado/total)
- [x] quotes.get (ficha completa con items, lead y facturas)
- [x] quotes.send (envía email al cliente con link de pago, cambia status)
- [x] quotes.resend (reenvío rápido)
- [x] quotes.duplicate (duplicar presupuesto con nuevo número)
- [x] quotes.markLost (acción manual)
- [x] quotes.confirmPayment (confirma pago, genera factura, crea reserva, envía email)
- [x] reservations.list con filtros + paginación
- [x] reservations.counters (confirmadas/hoy/ingresos)

### Frontend CRM — Panel unificado /admin/crm
- [x] 8 contadores clickables en strip superior (leads nueva/enviada/ganada/perdida + presup. borrador/enviado + reservas hoy + ingresos)
- [x] Tabs: Leads / Presupuestos / Reservas con badges de conteo
- [x] Búsqueda en tiempo real + filtro por estado activo
- [x] Tabla Leads: prioridad, nombre/email, producto, fecha, estado, acciones
- [x] Modal ficha de lead: datos, presupuestos asociados, notas internas, cambio de estado, marcar perdido, crear presupuesto
- [x] Modal editor de presupuesto: título, líneas (descripción/cantidad/precio/total), IVA, condiciones, validez, totales
- [x] Tabla Presupuestos: referencia, título, estado, total, fecha, acciones
- [x] Modal ficha de presupuesto: tabla de items, facturas asociadas, botones enviar/reenviar/confirmar pago/duplicar/perdido
- [x] Tabla Reservas: cliente, producto, estado, importe, fecha
- [x] Acceso al CRM desde AdminDashboard (acciones rápidas + módulos)

### Facturación
- [x] Numeración correlativa de facturas (FAC-YYYY-NNNN)
- [x] Generación de factura HTML al confirmar pago
- [x] Email automático al cliente con número de factura
- [ ] PDF de factura (roadmap: pdfkit o puppeteer)
- [ ] Descarga de factura PDF desde admin (roadmap)

### Tests
- [x] 114 tests Vitest pasando (7 test files, incluyendo crm.test.ts)
- [x] 0 errores TypeScript

## Badges Notificación Sidebar Admin — v9.1
- [x] Badge rojo con contador de leads nuevos en item Presupuestos del sidebar (icono colapsado + pill inline expandido)
- [x] Badge naranja con contador de presupuestos enviados pendientes en item Presupuestos
- [x] Campana del topbar con contador total (leads nuevos + presupuestos pendientes) y tooltip descriptivo
- [x] Polling automático cada 60s con refetchInterval (solo para admin y agente)
- [x] Badge desaparece cuando el contador llega a 0
- [x] 0 errores TypeScript

## Copia email a reservas@hotelnayade.es — v9.2
- [x] Auditar todos los puntos de envío de email al usuario (6 archivos, 8 puntos de envío)
- [x] BCC reservas@hotelnayade.es en email de confirmación de reserva Redsys
- [x] BCC reservas@hotelnayade.es en email de pago fallido Redsys
- [x] BCC reservas@hotelnayade.es en email de confirmación de reserva restaurante
- [x] BCC reservas@hotelnayade.es en email de link de pago restaurante
- [x] BCC reservas@hotelnayade.es en email de solicitud de presupuesto (usuario)
- [x] BCC reservas@hotelnayade.es en email de presupuesto enviado desde CRM (sendEmail helper)
- [x] BCC reservas@hotelnayade.es en email de confirmación de pago desde CRM (sendEmail helper)
- [x] 0 errores TypeScript

## CRM Controladores Completos + Fix Hero — v9.3

### Fix Hero
- [x] Eliminado scroll innecesario del formulario del hero

### Backend tRPC
- [x] leads.delete (borrar lead con confirmación)
- [x] leads.update completo (editar todos los campos del lead)
- [x] quotes.delete (borrar presupuesto)
- [x] quotes.update completo (editar presupuesto con items)
- [x] Lógica de estados compartidos: lead.opportunityStatus se actualiza automáticamente al cambiar el estado del presupuesto vinculado

### Frontend CRM — Leads
- [x] Tabla leads: botones Ver (blanco) / Editar (azul) / Convertir en presupuesto (naranja) / Borrar (rojo)
- [x] Modal Ver lead: ficha completa con historial de actividad y notas
- [x] Modal Editar lead: formulario con todos los campos editables + estado de oportunidad (4 etapas)
- [x] Modal Borrar lead: dialog de confirmación con advertencia irreversible
- [x] Modal Convertir en presupuesto: crea presupuesto y cambia estado a "enviada"
- [x] Estado compartido: 4 etapas (Nueva / Enviada / Ganada / Perdida) en leads y presupuestos

### Frontend CRM — Presupuestos
- [x] Tabla presupuestos: botones Ver (blanco) / Editar (azul) / Enviar (naranja, solo borrador) / Borrar (rojo)
- [x] Modal Ver presupuesto: ficha completa con items, estado, historial y facturas
- [x] Modal Editar presupuesto: editor completo con líneas, IVA, condiciones, validez
- [x] Modal Borrar presupuesto: dialog de confirmación con advertencia irreversible
- [x] Botón Enviar: envía email al cliente y cambia estado a "enviado" + actualiza lead a "enviada"

- [x] 0 errores TypeScript

## Contadores CRM Visuales — v9.4
- [x] CounterCard rediseñado: tarjetas grandes p-5, número 4xl/bold, gradiente de fondo profundo, borde luminoso activo con glow shadow
- [x] Blob de glow en esquina superior derecha con hover intensificado
- [x] Icono en caja con fondo y borde del mismo color
- [x] Barra inferior activa (h-0.5) al seleccionar un contador
- [x] Animación count-up (hook useCountUp) al cargar los datos numéricos
- [x] Separación visual en dos grupos: "Pipeline de Oportunidades" (azul) y "Presupuestos & Ingresos" (naranja)
- [x] Subtitulo descriptivo en cada tarjeta
- [x] Color orange añadido al sistema de colores (Ingresos Totales)
- [x] 0 errores TypeScript

## Barra Conversión + Leads No Leídos — v9.5
- [x] Backend: leads.get ya actualiza seenAt al abrir la ficha (existente)
- [x] Backend: leads.list devuelve seenAt para detectar no leídos
- [x] Backend: leads.counters incluye campo "sinLeer" (isNull(leads.seenAt))
- [x] Frontend: barra de progreso segmentada (verde=ganadas, ámbar=enviadas, azul=nuevas) con porcentaje en tiempo real
- [x] Frontend: leyenda de colores debajo de la barra con contadores
- [x] Frontend: indicador "X sin leer" con punto pulse azul en el header de la barra
- [x] Frontend: punto pulse azul animado en filas de leads con seenAt NULL
- [x] Frontend: etiqueta "NUEVO" en pill azul junto al nombre del lead no leído
- [x] Frontend: fondo azul muy suave en filas de leads no leídos
- [x] Frontend: al abrir la ficha del lead, seenAt se actualiza (leads.get ya lo hace)
- [x] 0 errores TypeScript

## CRM Presupuestos Mejorado + Clientes — v9.7

### Backend
- [x] Tabla `clients`: id, name, email, phone, company, nif, address, notes, created_at
- [x] Migrar BD con nueva tabla clients
- [x] tRPC clients.list / clients.create / clients.update / clients.delete
- [x] tRPC crm.products.searchForQuote (búsqueda de experiencias/packs para líneas)
- [x] quotes.convertFromLead: asunto automático "Presupuesto Nayade Experiences - @Nombre"

### Frontend CRM — Modal Presupuesto mejorado
- [x] Asunto automático al convertir lead: "Presupuesto Nayade Experiences - @NombreCliente"
- [x] Nombre del cliente prellenado automáticamente desde el lead vinculado
- [x] Líneas de concepto con buscador de productos (autocompletado con experiencias/packs)
- [x] Botón "Crear y Enviar" visible en el modal de creación
- [x] Al crear presupuesto nuevo: búsqueda de cliente existente o crear nuevo inline

### Frontend CRM — Módulo Clientes
- [x] Página /admin/crm/clientes con tabla de clientes
- [x] CRUD completo: crear, editar, borrar clientes
- [x] Búsqueda en tiempo real por nombre/email/empresa
- [x] Modal ficha de cliente con todos los campos
- [x] Item "Clientes" en el submenu CRM del sidebar

- [x] 0 errores TypeScript

## Estandarización Plantillas Email — v9.22

### Objetivo
Unificar el estilo visual de todos los emails enviados por el sistema CRM al mismo estándar que el email de solicitud recibida: fondo blanco, logo Náyade centrado con borde naranja, gradiente azul marino, wave SVG, footer azul.

### Backend — emailTemplates.ts
- [x] Añadir `buildQuoteHtml()` (Plantilla 8): email de presupuesto enviado al cliente con estilo blanco/naranja
- [x] Añadir `buildConfirmationHtml()` (Plantilla 9): email de confirmación de reserva con pago confirmado
- [x] Añadir `buildQuotePdfHtml()` (Plantilla 10): HTML para generación de PDF de presupuesto con mismo estilo

### Backend — crm.ts
- [x] Reemplazar `sendQuoteEmail()`: eliminado HTML inline oscuro (#0a0f1e), ahora usa `buildQuoteHtml()` de emailTemplates.ts
- [x] Reemplazar `sendConfirmationEmail()`: eliminado HTML inline oscuro, ahora usa `buildConfirmationHtml()` de emailTemplates.ts
- [x] Reemplazar HTML inline del `generatePdf`: ahora usa `buildQuotePdfHtml()` de emailTemplates.ts
- [x] 0 errores TypeScript

## Presupuesto Directo sin Lead — v9.23

- [x] Backend: procedimiento `quotes.createDirect` que crea un lead temporal y un presupuesto en un solo paso
- [x] Backend: el lead creado por `createDirect` tiene `source: "presupuesto_directo"` para distinguirlo
- [x] Frontend: botón "Nuevo Presupuesto" en la cabecera de la tabla de presupuestos del CRM
- [x] Frontend: modal de creación directa con búsqueda de cliente existente (por nombre/email) o creación inline
- [x] Frontend: mismo formulario de líneas de concepto con buscador de productos
- [x] Frontend: opción de enviar inmediatamente o guardar como borrador
- [x] 0 errores TypeScript

## Bug: Lead no crea cliente automáticamente — v9.24

- [x] Investigar caso "bollo polo" en BD (lead sin cliente)
- [x] Auditar todos los puntos de entrada de leads (web, admin, createDirect, GHL webhook)
- [x] Identificar por qué createLead no creó el cliente
- [x] Solución robusta: upsert de cliente en TODOS los puntos de entrada
- [x] Backfill: crear clientes para leads existentes sin cliente
- [x] 0 errores TypeScript · 114 tests pasando

## Rate Limiting — v9.26
- [x] Instalar express-rate-limit (ya estaba instalado v8.3.1)
- [x] Limitar submitLead y submitBudget: 10 req/min por IP
- [x] Limitar auth/login y forgot-password: 5 req/min por IP
- [x] Limitar endpoints de pago Redsys: 30 req/min por IP
- [x] Limitar subida de archivos: 20 req/min por IP
- [x] Test unitario que verifica configuración de rate limiters (12 tests)
- [x] 126 tests pasando · 0 errores TypeScript

## Aceptación de Presupuesto — v9.27 [COMPLETADO]
- [x] Auditar schema quotes, quoteItems, estados actuales y checkout
- [x] Reutilizar paymentLinkToken como token de aceptación (ya existe, 128 chars, único)
- [x] Migración BD: nuevos estados (visualizado, convertido_carrito, rechazado), acceptedAt, redsysOrderId
- [x] Backend: procedimiento quotes.getByToken (público, sin auth, marca visualizado)
- [x] Backend: procedimiento quotes.payWithToken (genera form Redsys con precios congelados)
- [x] Backend: procedimiento quotes.rejectByToken (rechaza con razón opcional)
- [x] Backend: procedimiento quotes.send actualizado para generar token y URL automáticamente
- [x] IPN Redsys: detecta pago de presupuesto y ejecuta confirmPayment automático
- [x] Frontend: página /presupuesto/:token con diseño azul marino + naranja
- [x] Frontend: precios congelados del presupuesto (no recalculados)
- [x] Frontend: botón "Aceptar y pagar" + botón "Rechazar" con formulario de motivo
- [x] Frontend: estados visuales para presupuesto pagado, rechazado, expirado
- [x] 126 tests pasando · 0 errores TypeScript

## 3 Funcionalidades Imprescindibles — v9.28 [COMPLETADO]
- [x] Email de confirmación al cliente con factura PDF tras pago del presupuesto (IPN Redsys)
- [x] Badge "Visto" en la tabla de presupuestos del CRM con icono de ojo (azul) y timestamp
- [x] Badge "No visto" en presupuestos enviados sin abrir
- [x] Job programado de reenvío automático de presupuestos no abiertos en 48h (node-cron, cada hora)
- [x] Máximo 2 reenvíos automáticos por presupuesto (campo reminderCount en BD)
- [x] Notificación al agente en CRM cuando se reenvía automáticamente (notifyOwner)
- [x] 126 tests pasando · 0 errores TypeScript

## Timeline de Actividad en Ficha de Presupuesto — v9.29 [COMPLETADO]
- [x] Backend: procedimiento `crm.timeline.get(quoteId)` que sintetiza campos del quote + crmActivityLog
- [x] 10 tipos de evento: created, sent, viewed, reminder, accepted, rejected, paid, lost, expired, activity
- [x] Ordenación cronológica · deduplicación de eventos sintéticos vs logs manuales
- [x] Frontend: componente `QuoteTimeline` con línea vertical, iconos coloreados por tipo y timestamp
- [x] Frontend: botón colapsable "Ver historial de actividad" en el QuoteDetailModal
- [x] 126 tests pasando · 0 errores TypeScript

## Fix Bug "Enlace no válido" en /presupuesto/:token — v9.31 [COMPLETADO]
- [x] Diagnóstico: el middleware `authGuard.ts` bloqueaba las rutas `crm.quotes.getByToken/rejectByToken/payWithToken` con 401 porque no estaban en la lista blanca de rutas públicas
- [x] Fix: añadir las 3 rutas públicas de presupuesto por token a `PUBLIC_TRPC_ROUTES` en `server/authGuard.ts`
- [x] Verificado: endpoint responde correctamente con datos del presupuesto de Cristina Battistelli
- [x] 126 tests pasando · 0 errores TypeScript

## Limpieza de Routers Legacy — v9.32 [COMPLETADO]
- [x] Auditar procedimientos leads.* y quotes.* en server/routers.ts
- [x] Verificar que ningún componente frontend los consume (grep en client/src)
- [x] Eliminar los procedimientos legacy de routers.ts (65 líneas eliminadas)
- [x] Eliminar archivos frontend muertos: LeadsManager.tsx, QuoteBuilder.tsx, QuotesList.tsx + carpeta admin/quotes/
- [x] Limpiar entradas obsoletas de authGuard.ts (leads.create, quotes.getByPaymentToken, quotes.createPaymentLink)
- [x] Actualizar tests nayade.test.ts para usar crm.leads.list y crm.quotes.list
- [x] 126 tests pasando · 0 errores TypeScript

## Fix payWithToken + URLs producción Redsys — v9.33 [COMPLETADO]
- [x] Causa raíz: columna quote_id faltaba en la tabla reservations de la BD
- [x] Aplicada migración: ALTER TABLE reservations ADD COLUMN quote_id INT NULL
- [x] Corregido schema Drizzle: quoteSource mapea a nombre real de columna en BD
- [x] URLs de Redsys ya son dinámicas (window.location.origin) — no requieren cambio de código
- [x] Actualizado fallback de dominio: skicenter.es y manus.space → www.nayadeexperiences.es
- [x] 126 tests pasando · 0 errores TypeScript

## Email confirmación de pago al cliente — v9.34 [COMPLETADO]
- [x] Auditado handler IPN: email ya existía pero con BCC incorrecto y email duplicado
- [x] Mejorada plantilla buildConfirmationHtml: subtotal, IVA, fecha actividad, número presupuesto
- [x] Corregido BCC: ahora siempre va a reservas@nayadeexperiences.es
- [x] Eliminado email duplicado: sendReservationPaidNotifications solo para reservas directas
- [x] 11 tests nuevos en confirmationEmail.test.ts
- [x] 138 tests pasando · 0 errores TypeScript

## Verificación y mejora de /reserva/ok — v9.35 [COMPLETADO]
- [x] Auditado ReservaOk.tsx: página ya tenía polling, todos los estados y datos básicos
- [x] Ampliado procedimiento getStatus: devuelve amountPaid, quoteSource, notes
- [x] Mejorado resumen: muestra importe real pagado (amountPaid), oculta personas para presupuestos
- [x] Mensajes diferenciados: «Presupuesto pagado» vs «Reserva confirmada» según quoteSource
- [x] Bloque «Qué pasa ahora» adaptado: factura automática para presupuestos, cancelación para directas
- [x] 138 tests pasando · 0 errores TypeScript

## Panel desplegable de notificaciones (campana) — v9.36 [COMPLETADO]
- [x] El icono de campana en AdminLayout no tenía onClick — ahora abre un Popover
- [x] Implementado panel desplegable (Popover) con leads nuevos y presupuestos pendientes
- [x] Sección leads nuevos: nombre, email, navegación al CRM al hacer clic
- [x] Sección presupuestos pendientes: nombre cliente, importe, número y fecha de envío
- [x] Botón "Ver todos en el CRM" en el footer del panel
- [x] Estado vacío cuando no hay notificaciones
- [x] Datos cargados bajo demanda (solo cuando el panel está abierto)
- [x] 138 tests pasando · 0 errores TypeScript

## Formulario leads multi-actividad con modales contextuales — v9.37 [COMPLETADO]
- [x] Añadida columna activitiesJson (TEXT/JSON) a la tabla leads en BD
- [x] Actualizado procedimiento submitBudget para aceptar y guardar activitiesJson
- [x] Construido selector múltiple de experiencias reales (cargadas desde BD)
- [x] Implementado ActivityModal genérico con 6 familias: tiempo/saltos/nivel/tipo/personas/libre
- [x] Gestor de flujo: encadena modales por cada experiencia seleccionada
- [x] Resumen visual de actividades seleccionadas antes de enviar
- [x] Actualizado CRM para mostrar activitiesJson enriquecido en el detalle del lead
- [x] Packs, Hotel, Restaurantes y SPA excluidos del flujo de enriquecimiento
- [x] 138 tests pasando · 0 errores TypeScript

## Fix formulario Home.tsx multi-actividad — v9.38 [COMPLETADO]
- [x] Detectado que Home.tsx tenía su propia implementación separada de BudgetRequest.tsx
- [x] Añadidos imports: Dialog, Minus, Clock, CheckCircle, X, Plus, ActivityEntry, getHeroFamilyForSlug
- [x] Añadido estado multi-actividad: heroSelectedActivities, heroModalState, heroModalParticipants, heroModalDetails
- [x] Añadidos handlers: openHeroActivityModal, saveHeroActivity, removeHeroActivity
- [x] Query heroExperiencesList cargada bajo demanda cuando heroCategory === "Experiencias"
- [x] Selector múltiple de experiencias reales reemplaza los chips genéricos para "Acuáticas"
- [x] Resumen visual de actividades seleccionadas con botón de eliminar
- [x] Modal contextual completo con participantes, duración, saltos, notas según familia
- [x] Validación y submit actualizados para enviar activitiesJson como array (no JSON.stringify)
- [x] 138 tests pasando · 0 errores TypeScript

## Mostrar activitiesJson enriquecido en CRM y email — v9.39 [COMPLETADO]

- [x] Auditado: el CRM tenía código para mostrar activitiesJson pero usaba JSON.parse innecesario que fallaba silenciosamente
- [x] Corregido CRMDashboard.tsx: usa Array.isArray() directamente (Drizzle ya devuelve JSON parseado)
- [x] Mejorado detalle del lead: chips de color sky-blue para cada detalle contextual (Duración, Saltos, Nivel, Tipo, Notas)
- [x] Actualizada columna "Producto" en la lista de leads: muestra nombre + pax de cada actividad (hasta 2, con "+N más")
- [x] Corregido error de Babel en Home.tsx: parseInt con radix explícito
- [x] Corregidas keys duplicadas en sidebar del admin (subitems CRM con mismo href)
- [x] Añadida función buildActivitiesBlock() en emailTemplates.ts: bloque HTML premium con chips azules por detalle
- [x] Actualizado BudgetRequestEmailData: campo activitiesJson opcional
- [x] Email al usuario: muestra sección "Actividades solicitadas" cuando hay activitiesJson
- [x] Email al admin: también muestra sección de actividades enriquecidas
- [x] submitBudget en routers.ts: pasa activitiesJson al emailData
- [x] 138 tests pasando · 0 errores TypeScript

## Bug: Botón "Aceptar presupuesto" desaparece del email — v9.40 [COMPLETADO]

- [x] Auditado: el bug estaba en createDirect con sendNow=true — no generaba token ni paymentLinkUrl antes de enviar el email
- [x] Corregido: createDirect ahora genera token + acceptUrl y los guarda en BD antes de llamar a sendQuoteEmail
- [x] Añadido campo origin al input de createDirect para construir la URL correcta del entorno
- [x] Corregidas 2 llamadas de sendQuoteMutation en el frontend que no pasaban origin
- [x] Añadido server/quoteEmail.test.ts con 7 tests de protección para buildQuoteHtml
- [x] 145 tests pasando (7 nuevos) · 0 errores TypeScript

## Sincronización dinámica de variantes en formularios — v9.41 [COMPLETADO]

- [x] Auditadas variantes reales en BD: Blob Jump (2), Banana Ski (1), Cableski (1), resto sin variantes
- [x] Auditados modales en Home.tsx y BudgetRequest.tsx: opciones hardcodeadas por familia
- [x] Endpoint trpc.public.getVariantsByExperience ya existía en routers.ts (línea 169)
- [x] BudgetRequest.tsx: ActivityModal reescrito con renderVariantFields() + renderFamilyFallback()
- [x] Home.tsx: modal inline extraído a componente HeroActivityModal con misma lógica dinámica
- [x] Si hay variantes en CRM → chips con nombre real + precio opcional + notas libres
- [x] Si no hay variantes → fallback por familia (duración, saltos, tipo, notas)
- [x] Colores de chip por familia: amber (alquiler/saltos/remolcado), sky (cableski/barco), violet (spa)
- [x] Participantes siempre fijo e independiente de variantes
- [x] 145 tests pasando · 0 errores TypeScript

## Botón "Generar presupuesto" desde lead — v9.42 [COMPLETADO]

- [x] Auditada estructura: quotes.items es JSON con {description, quantity, unitPrice, total}[]
- [x] Auditada lógica de precios: per_person=modifier×pax, fixed=modifier, percentage=base×(1+mod/100)
- [x] Creado procedimiento crm.leads.generateFromLead en server/routers/crm.ts
- [x] Resuelve precios: carga experiencia base + variantes, aplica la variante seleccionada (o única)
- [x] Añade detalles contextuales a la descripción (duración, saltos, notas)
- [x] Calcula subtotal + IVA 21% + total, crea presupuesto en estado borrador con 15 días de validez
- [x] Botón verde esmeralda con icono Sparkles en DialogFooter del LeadDetailModal
- [x] Solo visible si el lead tiene actividades (activitiesJson.length > 0)
- [x] Toast de éxito con número de presupuesto, líneas y total
- [x] Navega automáticamente al presupuesto generado en /admin/crm?tab=quotes
- [x] 145 tests pasando · 0 errores TypeScript

## Indicador visual presupuestos auto-generados vs manuales — v9.43 [COMPLETADO]

- [x] Auditado: no existía campo para marcar origen en la tabla quotes
- [x] Añadido campo isAutoGenerated BOOLEAN DEFAULT FALSE a la tabla quotes en schema.ts
- [x] Migrado con ALTER TABLE quotes ADD COLUMN isAutoGenerated BOOLEAN NOT NULL DEFAULT FALSE
- [x] generateFromLead ahora guarda isAutoGenerated: true al crear el presupuesto
- [x] Badge violeta "Auto-IA" con icono Sparkles en la columna Estado de la lista de presupuestos
- [x] Badge violeta "Generado con IA" más grande en el header del modal de detalle del presupuesto
- [x] Tooltip descriptivo en ambos badges explicando el origen automático
- [x] 145 tests pasando · 0 errores TypeScript

## Bug: Botón CTA invisible en email de presupuesto — v9.44 [COMPLETADO]

- [x] Causa: gradiente CSS no renderizado en Outlook → fondo blanco + texto blanco = invisible
- [x] Corregido ctaButton: fondo sólido #E85D04 con borde #c94d00, texto blanco, font-size 18px, padding 22px 60px
- [x] Añadido bloque contenedor naranja claro (#fff7ed) con borde #fed7aa alrededor del botón
- [x] Texto de apoyo: "🔒 Tu reserva está a un clic" + "Haz clic para confirmar y pagar de forma segura"
- [x] Botón con icono ▶ y letra-espaciado para mayor impacto visual
- [x] 145 tests pasando · 0 errores TypeScript

## Módulo Facturas + Conversión Presupuesto→Reserva→Factura — v9.45 [COMPLETADO]

- [x] Auditado: tabla invoices ya existía con estructura base; ampliada con 12 campos nuevos de trazabilidad
- [x] Schema invoices ampliado: paymentMethod, paymentValidatedBy, paymentValidatedAt, transferProofUrl, transferProofKey, isAutomatic, invoiceType, creditNoteId, creditNoteReason, clientPhone, clientAddress, clientNif
- [x] Schema reservations ampliado: invoiceId, invoiceNumber, paymentMethod, paymentValidatedBy, paymentValidatedAt, transferProofUrl, channel
- [x] Migrado BD: ALTER TABLE invoices + ALTER TABLE reservations en un solo paso
- [x] Corregido error isAutoGenerated en quotes: columna añadida a BD
- [x] Procedimiento crm.invoices.listAll: listado con filtros (status, invoiceType, paymentMethod, search)
- [x] Procedimiento crm.invoices.confirmManualPayment: confirma pago + actualiza reserva + quote + envía email
- [x] Procedimiento crm.invoices.createCreditNote: genera factura de abono ABO-YYYY-MM-XXXX con líneas negadas
- [x] Procedimiento crm.invoices.resend: reenvía email de factura al cliente
- [x] Procedimiento crm.invoices.void: anula factura con motivo obligatorio
- [x] Módulo Facturas en CRM: tab "Facturas" con contador en sidebar
- [x] Tabla de facturas: número, cliente, tipo, estado, método pago, total, fecha, acciones
- [x] Filtros: estado, tipo (factura/abono), método pago, búsqueda por número/nombre/email
- [x] Acciones: descargar PDF, reenviar email, confirmar pago manual, generar abono, anular
- [x] Modal confirmar pago manual: selector método + upload justificante opcional + notas
- [x] Modal generar abono: motivo obligatorio, importe parcial opcional
- [x] Modal anular factura: motivo obligatorio
- [x] Módulo Reservas mejorado: columna Factura con enlace directo, método pago, ref reserva, fecha llegada
- [x] Reservas: botón descargar PDF de factura si existe
- [x] Email confirmación manual: sendConfirmationEmail() también se llama desde confirmManualPayment
- [x] 145 tests pasando · 0 errores TypeScript

## Filtro por rango de fechas en Facturas — v9.46 [COMPLETADO]

- [x] Procedimiento listAll ampliado con dateFrom y dateTo opcionales (gte/lte sobre createdAt)
- [x] listAll ahora devuelve summary: { subtotal, tax, grandTotal } calculado en BD con SUM()
- [x] UI: barra de filtros de fecha con inputs tipo date (color-scheme:dark para Chromium)
- [x] Accesos rápidos: Hoy, Esta semana, Este mes, T1, T2, T3, T4, Este año
- [x] Botón ✕ para limpiar el rango de fechas activo
- [x] Panel de resumen del período: nº facturas, base imponible, total IVA incluido
- [x] 145 tests pasando · 0 errores TypeScript

## Rediseño Dashboard bienvenida con estilo oscuro CRM — v9.47 [COMPLETADO]

- [x] Auditados tokens exactos del CRM: fondo #080e1c, gradientes from-*-950/90 via-*-900/40 to-[#080e1c]
- [x] Auditado AdminDashboard.tsx: 267 líneas con bg-card (claro), badges de color plano, sin glows
- [x] Header bienvenida: gradiente 135deg #0d1526 → #080e1c → #0d1a10, glows ambientales azul+verde, indicador de sistema activo
- [x] KPI cards: mismo patrón CounterCard del CRM (gradientes, glow blob, número con count-up, barra inferior)
- [x] 4 colores KPI: emerald (ingresos), blue (reservas), violet (leads), amber (presupuestos)
- [x] Acciones rápidas: tarjetas con bg-*-500/10 border-*-500/30, hover con brillo, iconos de color
- [x] Módulos del sistema: lista con dots de color, hover sutil, flechas de navegación
- [x] Actividad reciente: iconos en tarjetas con border de color, timestamps en blanco/30
- [x] Actividades de hoy: fondo bg-white/[0.03], hora en font-black, estado con dot de color
- [x] Tipografía: font-black para títulos, uppercase tracking-widest para labels, tabular-nums para números
- [x] 145 tests pasando · 0 errores TypeScript

## Confirmación manual de pago por transferencia bancaria
- [x] BD: añadir columna transfer_proof_url y transfer_proof_key en tabla quotes
- [x] Backend: procedimiento tRPC quotes.confirmTransfer con upload de justificante (JPG/PNG/PDF) a S3
- [x] Backend: al confirmar transferencia → cambiar quote a ganada, crear reserva, crear factura, log auditoría
- [x] Frontend: botón 'Confirmar Transferencia' visible en presupuestos (borrador/enviado/convertido_carrito)
- [x] Frontend: modal con upload obligatorio de justificante y botón de confirmación bloqueado hasta adjuntar archivo


## Badges de método de pago en facturas (v5.x)
- [x] Badge visual de método de pago en lista de facturas (Redsys, Transferencia+justificante, Efectivo, Otro)
- [x] Corregir paymentMethod en confirmTransfer: debe guardar "transferencia" en lugar de "redsys"

## Email de confirmación de pago por transferencia (v5.1)
- [x] Plantilla HTML del email de confirmación de transferencia bancaria al cliente
- [x] Conectar el envío del email al procedimiento quotes.confirmTransfer
- [x] Tests Vitest para el nuevo email de confirmación de transferencia

## Interconexión y limpieza de módulos de reservas (v5.2)
- [x] Auditoría completa de flujos y dependencias entre módulos
- [x] Puente automático reservations→bookings al confirmar pago (Redsys + transferencia + efectivo)
- [x] Eliminar módulo redundante "Reservas Redsys" de Operaciones (redirige a CRM → Reservas)
- [x] Renombrar "Reservas" a "Actividades" en Operaciones y reconectar navegación
- [x] Añadir campos reservationId y sourceChannel a tabla bookings (migración aplicada)
- [x] Añadir invoiceNumber al filtro de búsqueda de crm.reservations.list
- [x] Actualizar links del sidebar CRM para usar ?tab= query params
- [x] Añadir columna Origen en BookingsList con badge de canal de pago y enlace al CRM
- [x] 159 tests pasando · 0 errores TypeScript

## Dashboard de Administración — Datos reales y visión global (v5.3)
- [x] Auditar datos hardcodeados en AdminDashboard.tsx
- [x] Crear procedimiento tRPC accounting.getOverview con todos los datos del dashboard en una sola llamada
- [x] KPIs reales: ingresos del mes vs mes anterior, actividades, leads nuevos, facturas pendientes
- [x] Panel de actividades de hoy y próximas 7 días (datos reales de bookings)
- [x] Embudo de ventas CRM con tasas de conversión (leads → presupuestos → reservas → facturas)
- [x] Top experiencias del mes con nº reservas e ingresos
- [x] Actividad reciente real (crmActivityLog con iconos por tipo)
- [x] Alertas urgentes: transferencias sin validar, presupuestos por vencer, facturas vencidas +30d
- [x] Acciones rápidas con links funcionales a los flujos reales del sistema
- [x] Auto-refresh cada 60 segundos
- [x] 159 tests pasando · 0 errores TypeScript

## Corrección diseño Dashboard (v5.3.1)
- [x] Corregir fondo blanco del dashboard: usar bg-[#080e1c] igual que el resto del CRM
- [x] Corregir textos invisibles: usar text-white con opacidades correctas (text-white/80, text-white/40, etc.)
- [x] Tarjetas KPI: gradientes idénticos al CRM (from-*-950/80 via-*-900/30 to-[#080e1c])
- [x] Paneles de sección: fondo rgba(255,255,255,0.03) con border-white/8 igual que CRM
- [x] Acciones rápidas: botones con fondo oscuro y hover coherente con el sistema de diseño
- [x] 0 errores TypeScript

## Dashboard — Datos reales desde BD (v5.3.2)
- [x] Auditar BD: 53 entradas en crmActivityLog, 1 factura cobrada, 1 reserva paid, 4 leads, 1 presupuesto
- [x] Corregir getDashboardOverview: timestamps bigint (reservations.created_at) vs timestamp (invoices.issuedAt)
- [x] Corregir topExperiences: usar reservations.paid como fuente (bookings vacío), amountTotal ÷ 100
- [x] Corregir transferencias pendientes: buscar en reservations.paymentMethod='transferencia' AND status='pending_payment'
- [x] Corregir funnel: reservations.paid + bookings.completado
- [x] Corregir actividad reciente: usar campo details (no description que no existe)
- [x] Traducir códigos de action a texto legible en español en el frontend
- [x] Filtrar lead_deleted del panel de actividad reciente (45 entradas de prueba)
- [x] 0 errores TypeScript · servidor limpio sin errores

## Menú de acciones en filas de Reservas CRM (v5.4)
- [ ] Añadir columna Acciones con dropdown en tabla de Reservas del CRM
- [ ] Acción "Ver detalles": abrir modal de detalle de reserva
- [ ] Acción "Editar": modal de edición de reserva (estado, notas, fecha)
- [ ] Acción "Reenviar al cliente": reenviar email de confirmación al email del cliente
- [ ] Acción "Descargar reserva en PDF": generar y descargar PDF de la reserva
- [ ] Acción "Eliminar": confirmación y eliminación de la reserva
- [ ] Procedimiento tRPC crm.reservations.resendConfirmation
- [ ] Procedimiento tRPC crm.reservations.delete
- [ ] Procedimiento tRPC crm.reservations.update (editar estado/notas)
- [ ] Generación de PDF de reserva en el servidor

## Menú de acciones en filas de Reservas del CRM (v5.4)
- [x] Dropdown con 5 acciones: Ver detalles, Editar, Reenviar al cliente, Descargar PDF, Eliminar
- [x] Procedimiento crm.reservations.update (editar estado y notas)
- [x] Procedimiento crm.reservations.resendConfirmation (reenviar email al cliente)
- [x] Procedimiento crm.reservations.delete (eliminar reserva)
- [x] Modal de edición de reserva con selector de estado y notas internas
- [x] Modal de confirmación de eliminación
- [x] 0 errores TypeScript

## v5.4.2: Modal de detalle completo de reserva (botón Eye)
- [x] Implementar modal/panel lateral de detalle de reserva con: datos del cliente, producto, método de pago, estado, historial de actividad, justificante de transferencia y enlace a factura
- [x] Conectar el botón Eye al nuevo modal (reemplazar toast "próximamente")

## v5.5: Rediseño visual global de plantillas de email (resort aventura premium)
- [ ] Rediseñar cabecera hero: imagen aérea del lago en full-width, overlay azul oscuro, logo centrado, titular emocional
- [ ] Rediseñar footer: fondo beige arena, datos de contacto, claim de marca
- [ ] Rediseñar botón CTA: naranja degradado energético, ancho, centrado
- [ ] Aplicar rediseño a TODAS las plantillas (11 en emailTemplates.ts + reservationEmails)
- [ ] Enviar emails de prueba de todas las plantillas a reservas@hotelnayade.es

## v5.5: Rediseño visual global de plantillas de email
- [x] Auditar todas las plantillas de email existentes (10 plantillas identificadas)
- [x] Diseñar sistema de componentes HTML reutilizables (emailHeader, statusBlock, detailsTable, itemsTable, ctaButton, footer)
- [x] Rediseñar buildBudgetRequestUserHtml — solicitud de presupuesto al cliente
- [x] Rediseñar buildBudgetRequestAdminHtml — solicitud de presupuesto al admin
- [x] Rediseñar buildReservationConfirmHtml — reserva confirmada (Redsys OK)
- [x] Rediseñar buildReservationFailedHtml — pago fallido (Redsys KO)
- [x] Rediseñar buildRestaurantConfirmHtml — reserva de restaurante confirmada
- [x] Rediseñar buildRestaurantPaymentLinkHtml — link de pago depósito restaurante
- [x] Rediseñar buildPasswordResetHtml — recuperar contraseña
- [x] Rediseñar buildQuoteHtml — presupuesto enviado al cliente
- [x] Rediseñar buildConfirmationHtml — reserva confirmada (CRM admin)
- [x] Rediseñar buildTransferConfirmationHtml — pago por transferencia validado
- [x] Añadir procedimiento admin.sendEmailPreview al router del servidor
- [x] Añadir sección "Prueba de plantillas de email" en el panel de Configuración
- [x] Actualizar tests para entidades HTML del nuevo diseño (159/159 pasando)

## v5.6: Carrito de la compra multi-experiencia
- [x] CartContext con persistencia en localStorage y lógica multi-experiencia
- [x] CartDrawer (panel lateral deslizante con lista de artículos, subtotal y botón pago)
- [x] CartIcon con badge numérico en el navbar público (zona superior derecha)
- [x] Integrar CartProvider en main.tsx y CartIcon en el navbar
- [x] Procedimiento cart.checkout en servidor (crea reservas + genera pago Redsys unificado)
- [x] Conectar botones "Añadir al carrito" en páginas de producto/experiencia

## v5.7: Integración carrito en todos los puntos de compra
- [x] Listado /experiencias: botón "Añadir al carrito" con mini-modal fecha+personas + botón secundario "Comprar ahora"
- [x] Ficha /experiencias/[slug]: ya implementado (v5.6) — verificado correcto
- [x] Listado /packs: botón "Añadir al carrito" + botón secundario "Comprar ahora"
- [x] Ficha /packs/[slug]: botón principal "Añadir al carrito" + botón secundario "Comprar ahora"
- [x] Crear componente AddToCartModal reutilizable (mini-modal fecha+personas)
- [x] Hotel, SPA, Restaurantes: sin cambios

## v5.8: Página de checkout dedicada + Home con carrito
- [x] Página /checkout con resumen de pedido, formulario de datos del cliente y botón pago Redsys
- [x] CartDrawer simplificado: botón "Finalizar compra" redirige a /checkout
- [x] Módulo de actividades de la Home: botón "Añadir" (carrito) + botón "Ya" (compra directa)

## v5.9: Flujo de compra unificado — un solo camino por el carrito
- [x] ExperienceDetail: eliminar botón "Reservar Ahora", dejar solo "Añadir al carrito" que abre el drawer
- [x] PackDetail: eliminar botón "Reservar Ahora", dejar solo "Añadir al carrito" que abre el drawer
- [x] Experiences (listado): eliminar botón "Ya", dejar solo "Añadir al carrito"
- [x] PacksList (listado): eliminar botón "Ya", dejar solo "Añadir al carrito"
- [x] Home (módulo actividades): eliminar botón "Ya", dejar solo "Añadir al carrito"
- [ ] CartDrawer: permitir editar número de personas de cada artículo desde el drawer
- [x] Eliminar BookingModal de todos los puntos de entrada (ya no se usa para compra directa)

## v5.9.1: Módulo Packs de Día Completo conectado al carrito
- [x] Módulo "Packs de Día Completo" en Home: botón "Añadir al carrito" con AddToCartModal (eliminar botón "Reservar" estático)
- [x] Array packs actualizado con IDs y precios reales de BD (45€–150€)
- [x] Tarjeta de pack: "Ver detalles" navega a la ficha, botón naranja abre AddToCartModal

## v5.10: Controles de edición en el carrito (personas + variantes)
- [x] CartDrawer: controles +/- para editar número de personas por artículo
- [x] CartDrawer: selector de variante de precio por artículo (adulto, niño, grupo, etc.)
- [x] AddToCartModal: mostrar selector de variantes disponibles antes de añadir
- [x] CartContext: función updatePeople y recalcular estimatedTotal al cambiar personas/variante
- [x] tRPC: procedimiento para obtener variantes por productId (ya existía: trpc.public.getVariantsByExperience)

## v5.11: Variantes en ficha de producto (precio desde + lista informativa + selector)
- [x] ExperienceDetail: precio "desde" = mínimo de priceModifier entre variantes (si existen)
- [x] ExperienceDetail: lista informativa de variantes con precios dentro de la caja lateral
- [x] ExperienceDetail: selector de variante activo que actualiza el precio y el total estimado
- [x] PackDetail: misma lógica si el pack tiene variantes en BD

## v5.12: Datos de contacto reales + botón Solicitar Presupuesto → /presupuesto
- [x] ExperienceDetail: botón "Solicitar Presupuesto" → /presupuesto (en lugar de abrir modal)
- [x] PackDetail: botón "Solicitar Presupuesto" → /presupuesto
- [x] Experiences (listado): botón "Presupuesto" → /presupuesto (antes apuntaba a /contacto)
- [x] Reemplazar +34 000 000 000 por +34 930 34 77 91 en ExperienceDetail y Contact.tsx
- [x] Verificar que el topbar, footer, Home, BudgetRequest, Locations y servidor usan los datos reales

## v5.13: Gestión de Incluye/No incluye en admin de experiencias
- [x] ExpForm: añadidos campos includes y excludes (string[])
- [x] openEdit: mapea includes/excludes de BD al formulario al editar
- [x] handleSubmit: envía includes/excludes al procedimiento tRPC
- [x] UI: listas editables con botón + y X por item en el modal de experiencias
- [x] PacksManager: revisado (packs no tienen campos includes/excludes en BD, se puede añadir en el futuro)

## v5.13.1: Bug fix — includes/excludes no se guardan en BD
- [x] Diagnosticado: el schema Zod de products.update no incluía los campos includes/excludes (los descartaba)
- [x] Corregido: añadidos includes, excludes, slug, minPersons y maxPersons al schema Zod de products.update en routers.ts

## v5.14: Sistema de descuentos en productos
- [x] Migración BD: columnas discountPercent (decimal) y discountExpiresAt (timestamp) en experiences y packs
- [x] Drizzle schema: actualizar experiences y packs con los nuevos campos
- [x] ExperiencesManager: campos % descuento y fecha caducidad en el formulario
- [x] PacksManager: mismos campos de descuento
- [x] Schema Zod products.update y packs.update: añadir discountPercent y discountExpiresAt
- [x] db.ts: incluir discountPercent y discountExpiresAt en createExperience y updateExperience
- [x] Ribbon de promo en ExperienceDetail (ficha), Experiences (listado), PackDetail (ficha), PacksList (listado), Home (módulos)
- [x] Ribbon muestra: "X% dto · N días" o "X% dto · Hoy" si queda menos de 1 día
- [x] Precio tachado (precio original) + precio con descuento en ficha y listado

## v5.14.1: Bug fix — discountExpiresAt toISOString error
- [x] Diagnosticado: Drizzle espera Date para columna timestamp, pero el input date HTML envía string
- [x] Corregido: conversión new Date(string) en products.update y packs.update antes de llamar a updateExperience/updatePack
- [x] Corregido también discountPercent: parseFloat() para columna decimal

## v5.14.2: Rediseño DiscountRibbon
- [x] Ribbon más grande (100×100), porcentaje con tipografía grande y llamativa (18px bold), color verde semáforo (#16a34a → #22c55e)

## v5.14.3: Ribbon — fecha real de caducidad
- [x] Texto del ribbon cambiado a "Hasta DD/MM" (fecha real de caducidad)
- [x] Ribbon ampliado a 110×110px para que quepa el texto cómodamente
- [x] Variante detail también actualizada: "Hasta DD/MM" o "¡Termina hoy!" si caduca hoy

## v6.0: Módulo Fiscal REAV

### Fase 1 — Estructura de datos
- [x] Campo fiscalRegime (reav | general) en tabla experiences y packs
- [x] Campo providerPercent, agencyMarginPercent, productType en experiences y packs
- [x] Tabla reav_expedients: nº expediente, reservaId, facturaId, clienteId, estado fiscal, márgenes
- [x] Tabla reav_documents: expedientId, tipo (cliente | proveedor), nombre, url S3
- [x] Tabla reav_costs: expedientId, tipo coste, proveedor, importe, pagado
- [ ] Campo fiscalRegime heredado en invoice_lines (herencia silenciosa desde producto)
- [x] Migración SQL aplicada

### Fase 2 — Herencia fiscal silenciosa
- [ ] Al crear presupuesto/reserva: heredar fiscalRegime del producto internamente (sin cambiar UX)
- [ ] Al crear línea de factura: heredar fiscalRegime desde producto → invoice_line.fiscalRegime
- [x] Admin ExperiencesManager/PacksManager: campo régimen fiscal + modelo económico en ficha

### Fase 3 — Facturación mixta por líneas
- [x] InvoiceDetail: calcular IVA solo en líneas régimen general (21%)
- [x] Líneas REAV: mostrar sin IVA, con nota "REAV - Margen no sujeto a IVA"
- [x] Totales separados: subtotal REAV + subtotal general + IVA general + total factura
- [ ] Al generar factura con líneas REAV → crear expediente REAV automáticamente

### Fase 4 — Expediente REAV (6 bloques)
- [x] Bloque 1: info general del expediente (nº, reserva, factura, cliente, productos REAV, márgenes)
- [x] Bloque 2: documentación cliente (historial, URL, eliminar)
- [x] Bloque 3: documentación proveedor (historial, URL, eliminar)
- [x] Bloque 4: control económico interno (costes previstos/reales, recalcular márgenes)
- [x] Bloque 5: estado fiscal (REAV provisional/definitivo, expediente completo)
- [x] Bloque 6: acciones admin (ZIP, exportar, abrir reserva/factura, cerrar expediente)

### Fase 5 — Automatizaciones
- [ ] Crear expediente REAV automáticamente al generar factura con líneas REAV
- [x] Recalcular márgenes al introducir costes reales
- [ ] Semáforo visual: verde/amarillo/rojo según estado del expediente
- [ ] Permitir cierre fiscal solo cuando expediente esté completo y validado

## v6.1: Descuentos en carrito
- [x] CartItem: campos originalPricePerPerson y discountPercent
- [x] AddToCartModal: calcular precio con descuento activo, mostrar precio tachado + badge -%
- [x] CartDrawer: mostrar precio original tachado + badge descuento por artículo
- [x] Home.tsx y Experiences.tsx: pasar discountPercent/discountExpiresAt al AddToCartModal

## v6.2: Facturación mixta REAV (Fase 3)
- [x] Campo fiscalRegime en tipo JSON de items (quotes e invoices) — sin migración BD necesaria
- [x] Backend generateFromLead/previewFromLead: heredar fiscalRegime del producto al construir items
- [x] Backend confirmPayment/confirmTransfer: calcular IVA solo sobre líneas general_21
- [x] generateInvoicePdf: separar líneas REAV/general, subtotales separados, nota REAV
- [x] Admin CRMDashboard QuoteDetail: badge REAV por línea, subtotales separados
- [x] Admin CRMDashboard CreateDirectQuoteModal: selector régimen fiscal por línea, recalcular IVA
- [x] Admin CRMDashboard QuoteBuilderModal: selector régimen fiscal por línea, recalcular IVA
- [x] Admin CRMDashboard QuoteEditModal: selector régimen fiscal por línea, recalcular IVA

## v6.3: Automatizaciones REAV (Fase 5)
- [ ] Backend confirmPayment: crear expediente REAV automáticamente si hay líneas reav en la factura
- [ ] Backend confirmTransfer: crear expediente REAV automáticamente si hay líneas reav en la factura
- [ ] Semáforo visual en listado de expedientes REAV (verde/amarillo/rojo según estado documentación)
- [ ] Exportación ZIP del expediente REAV con todos los documentos adjuntos desde ReavManager

## v6.3: Sidebar AdminLayout — Fiscal REAV
- [x] AdminLayout.tsx: añadir ítem "Fiscal REAV" (con icono Receipt) entre Contabilidad y Hotel en el sidebar con grupos colapsables

## v7.0: Módulo Liquidaciones Proveedores

### BD — Tablas nuevas
- [ ] Tabla `suppliers`: datos fiscales, comerciales, IBAN, forma de pago, estado (activo/inactivo/bloqueado)
- [ ] Tabla `supplier_settlements`: número único, proveedor, periodo, estado workflow, totales
- [ ] Tabla `settlement_lines`: reserva, producto, importe cobrado, comisión, importe neto proveedor
- [ ] Tabla `settlement_documents`: adjuntos de la liquidación (facturas recibidas, contratos, justificantes)
- [ ] Tabla `settlement_status_log`: historial de cambios de estado con usuario y fecha
- [ ] Columnas en `experiences` y `packs`: supplierId, commissionPercent, costType, settlementFrequency, isSettlable
- [ ] Migración SQL aplicada

### Backend — Router suppliers
- [ ] suppliers.list (con filtros estado, búsqueda)
- [ ] suppliers.get (ficha completa)
- [ ] suppliers.create
- [ ] suppliers.update
- [ ] suppliers.delete (soft delete)

### Backend — Router settlements
- [ ] settlements.list (filtros: proveedor, producto, estado, fechas)
- [ ] settlements.get (con líneas, documentos, log)
- [ ] settlements.calculate (motor: reservas facturadas+cobradas → líneas de liquidación)
- [ ] settlements.create (genera liquidación desde líneas calculadas)
- [ ] settlements.updateStatus (workflow: emitida → pendiente_abono → abonada → incidencia → recalculada)
- [ ] settlements.addDocument / deleteDocument
- [ ] settlements.generatePdf (HTML → PDF, subido a S3)
- [ ] settlements.sendEmail (envío automático al proveedor)
- [ ] settlements.exportExcel (XLSX con líneas de liquidación)

### UI — SuppliersManager
- [ ] Listado de proveedores con búsqueda, filtro estado, badges de color
- [ ] Ficha completa: datos fiscales, operativos, IBAN, forma de pago, observaciones
- [ ] Crear / editar / desactivar proveedor

### UI — SettlementsManager
- [ ] Panel filtrado avanzado (proveedor, producto, estado, fechas, toggle pendientes)
- [ ] Tabla de reservas liquidables con selección múltiple (acciones masivas)
- [ ] Motor de cálculo: botón "Calcular liquidación" → preview de importes
- [ ] Botón "Generar liquidación proveedor" → crea documento con número único
- [ ] Vista detalle liquidación: líneas, totales, workflow de estados, documentos adjuntos
- [ ] Acciones: descargar PDF, descargar Excel, enviar por email

### UI — Dashboard financiero Liquidaciones
- [ ] KPI: total pendiente proveedores, total liquidado mes, margen bruto generado
- [ ] Ranking proveedores por coste
- [ ] Gráfico evolución mensual (Chart.js)

### Productos — Bloque proveedor
- [ ] ExperiencesManager: bloque "Datos proveedor producto" con selector, comisión, tipo coste, frecuencia, toggle liquidable
- [ ] PacksManager: mismo bloque

### Sidebar AdminLayout
- [ ] Ítem "Proveedores" bajo Contabilidad
- [ ] Ítem "Liquidaciones" bajo Contabilidad

## v7.0: Módulo Liquidaciones Proveedores — COMPLETADO

### BD — Tablas nuevas
- [x] Tabla `suppliers`: datos fiscales, comerciales, IBAN, forma de pago, estado (activo/inactivo/bloqueado)
- [x] Tabla `supplier_settlements`: número único, proveedor, periodo, estado workflow, totales
- [x] Tabla `settlement_lines`: reserva, producto, importe cobrado, comisión, importe neto proveedor
- [x] Tabla `settlement_documents`: adjuntos de la liquidación (facturas recibidas, contratos, justificantes)
- [x] Tabla `settlement_status_log`: historial de cambios de estado con usuario y fecha
- [x] Columnas en `experiences` y `packs`: supplierId, commissionPercent, costType, settlementFrequency, isSettlable
- [x] Migración SQL aplicada

### Backend — Router suppliers
- [x] suppliers.list (con filtros estado, búsqueda)
- [x] suppliers.get (ficha completa)
- [x] suppliers.create
- [x] suppliers.update
- [x] suppliers.delete (soft delete)

### Backend — Router settlements
- [x] settlements.list (filtros: proveedor, producto, estado, fechas)
- [x] settlements.get (con líneas, documentos, log)
- [x] settlements.calculate (motor: reservas facturadas+cobradas → líneas de liquidación)
- [x] settlements.create (genera liquidación desde líneas calculadas)
- [x] settlements.updateStatus (workflow: emitida → pendiente_abono → abonada → incidencia → recalculada)
- [x] settlements.addDocument / deleteDocument
- [x] settlements.generatePdf (HTML → PDF, subido a S3)
- [x] settlements.sendEmail (envío automático al proveedor)
- [ ] settlements.exportExcel (XLSX con líneas de liquidación) — pendiente

### UI — SuppliersManager
- [x] Listado de proveedores con búsqueda, filtro estado, badges de color
- [x] Ficha completa: datos fiscales, operativos, IBAN, forma de pago, observaciones
- [x] Crear / editar / desactivar proveedor

### UI — SettlementsManager
- [x] Panel filtrado avanzado (proveedor, producto, estado, fechas, toggle pendientes)
- [x] Motor de cálculo: botón "Calcular liquidación" → preview de importes
- [x] Botón "Generar liquidación proveedor" → crea documento con número único
- [x] Vista detalle liquidación: líneas, totales, workflow de estados, documentos adjuntos
- [x] Botón "Generar PDF" → genera HTML/PDF y lo sube a S3, abre en nueva pestaña
- [x] Botón "Descargar PDF" → descarga el PDF ya generado
- [x] Botón "Enviar email" → envía liquidación al proveedor con enlace al PDF

### UI — Dashboard financiero Liquidaciones
- [x] KPI: total pendiente proveedores, total liquidado mes, margen bruto generado
- [x] Ranking proveedores por coste
- [x] Gráfico evolución mensual (Chart.js)

### Productos — Bloque proveedor
- [x] ExperiencesManager: bloque "Proveedor y Liquidaciones" con selector, comisión, tipo coste, frecuencia, toggle liquidable
- [x] PacksManager: mismo bloque "Proveedor y Liquidaciones"

### Sidebar AdminLayout
- [x] Ítem "Proveedores" bajo Contabilidad
- [x] Ítem "Liquidaciones" bajo Contabilidad

## v7.1: Exportación Excel de Liquidaciones
- [x] Instalar dependencia xlsx en el servidor
- [x] Endpoint REST GET /api/settlements/:id/export-excel en settlementExportRoutes.ts
- [x] Generar XLSX con hoja de cabecera y hoja de líneas de liquidación
- [x] Botón "Exportar Excel" en SettlementsManager con descarga directa
- [x] Tests del generador XLSX (13 tests pasando)

## v7.2: Corrección Sidebar — Proveedores y Liquidaciones
- [x] Verificar AdminLayout: ítems Proveedores y Liquidaciones bajo Contabilidad
- [x] Añadir sección "Proveedores" con icono Truck en el sidebar (entre Contabilidad y Fiscal REAV)
- [x] Añadir rutas /admin/suppliers y /admin/settlements en App.tsx con lazy imports

## v7.3: Hotel y SPA — Descuento, Régimen Fiscal y Proveedor
- [x] Auditar schema DB: campos actuales de hotel_rooms y spa_services
- [x] Migración DB: añadir discountPercent, discountLabel, fiscalRegime, supplierId, supplierCommissionPercent, supplierCostType, settlementFrequency, isSettlable a room_types y spa_treatments
- [x] Backend hotel: actualizar schemas Zod y procedimientos create/update en hotel.ts
- [x] Backend spa: actualizar schemas Zod y procedimientos create/update en spa.ts
- [x] HotelManager: añadir bloques Descuento, Régimen Fiscal y Proveedor al formulario de tipología
- [x] SpaManager: añadir bloques Descuento, Régimen Fiscal y Proveedor al formulario de tratamiento
- [x] SupplierSelect: actualizar para aceptar number|null|string y devolver number|null

## v8.0: Módulo TPV Presencial (Terminal Punto de Venta)

### BD — Nuevas tablas
- [ ] cash_registers: cajas físicas (nombre, ubicación, activa)
- [ ] cash_sessions: turnos de caja (apertura, cierre, fondo inicial, cajero, estado)
- [ ] cash_movements: movimientos de caja (venta, salida manual, entrada manual)
- [ ] tpv_sales: ventas TPV (sesión, reserva vinculada, total, estado, cliente opcional)
- [ ] tpv_sale_items: líneas de venta (producto, cantidad, precio, subtotal)
- [ ] tpv_sale_payments: subpagos (venta, método, importe, pagador, estado)
- [ ] Campo isPresentialSale en products/room_types/spa_treatments (toggle vendible en TPV)

### Backend — Router tpv
- [ ] tpv.getCatalog: productos activos + vendibles presencial (experiencias, packs, spa, hotel, extras)
- [x] tpv.openSession: apertura de caja con fondo inicial
- [x] tpv.closeSession: cierre con arqueo y cálculo de descuadre
- [x] tpv.addCashMovement: salida/entrada manual de efectivo
- [x] tpv.createSale: confirmar venta → crear reserva + movimiento caja
- [x] tpv.getSessionSummary: resumen de sesión activa
- [x] tpv.getBackoffice: historial cajas, ventas por sesión
- [x] tpv.sendTicketEmail: envío de ticket por email

### Frontend — Pantalla TPV Kiosk
- [x] Ruta /admin/tpv con pantalla kiosk de fondo negro
- [x] Diseño negro premium resort (fondo oscuro, violeta para CTAs)
- [x] Zona 1: Catálogo gráfico con grid de productos (foto, nombre, precio, color por tipo)
- [x] Filtros rápidos: Todos / Experiencias / Packs / SPA / Hotel
- [x] Zona 2: Carrito TPV (lista productos, cantidades +/-, subtotal, total grande)
- [x] Zona 3: Botones de pago grandes (Tarjeta / Efectivo / Bizum / Mixto)
- [x] Botón "Confirmar venta" prominente

### Frontend — Gestión de Caja
- [x] Modal apertura de caja (TpvOpenSession)
- [x] Modal cierre de caja con arqueo (TpvCloseSession)
- [x] Modal salida/entrada manual de efectivo (TpvCashMovement)

### Frontend — División de Cuenta
- [x] Modal dividir en partes iguales (TpvSplitPayment)
- [x] Modal dividir por importes libres
- [x] Pago mixto: cada parte con su método de pago

### Frontend — Ticket Térmico 80mm
- [x] Componente TpvTicket optimizado para 80mm (CSS @media print)
- [x] Cabecera: logo Nayade, datos fiscales, punto de venta
- [x] Cuerpo: líneas de venta, descuentos, totales, desglose de pagos
- [x] Opciones post-venta: Imprimir ticket / Enviar email

### Frontend — Backoffice Cajas TPV
- [x] Ruta /admin/tpv/cajas con historial de sesiones
- [x] Historial de aperturas y cierres con resumen económico
- [x] Ventas y movimientos por sesión
- [x] Ítems TPV en sidebar AdminLayout (icono Monitor)

## v8.1: Fix crash TPV al confirmar venta
- [x] Corregir TypeError en TpvScreen al hacer .map() sobre resultado de createSale
- [x] Corregir TpvSplitPayment: misma normalización para pago mixto/dividido
- [x] Verificado: 0 errores TypeScript, 172/172 tests pasando

## v8.2: Fix crash TPV — .map() inseguro en render
- [x] Endurecer allProducts: usar catalog?.experiences ?? [] en lugar de catalog ? [...catalog.experiences] : []
- [x] TpvTicket: proteger s.items y s.payments con ?? [] antes de .map()
- [x] Verificado: 0 errores TypeScript, 172/172 tests pasando

## v8.3: Toggle "Vendible en TPV" (isPresentialSale)
- [x] Migrar BD: añadir isPresentialSale (boolean, default false) a experiences, packs, room_types, spa_treatments
- [x] Actualizar schema Drizzle: 4 tablas
- [x] Backend routers.ts: añadir isPresentialSale a schemas Zod create/update de experiences y packs
- [x] Backend hotel.ts: añadir isPresentialSale a schemas Zod create/update
- [x] Backend spa.ts: añadir isPresentialSale a schemas Zod create/update
- [x] ExperiencesManager: toggle "Vendible en TPV" (violeta) junto a Destacado y Activo
- [x] PacksManager: toggle "Vendible en TPV" (violeta) junto a Destacado y Activo
- [x] HotelManager: toggle "Vendible en TPV" (violeta) junto a Destacado y Activo
- [x] SpaManager: toggle "Vendible en TPV" (violeta) junto a Destacado y Activo
- [x] tpv.getCatalog: filtrar por isPresentialSale = true (y isActive = true)

## v8.4: Optimización de Rendimiento — TPV, Transacciones y Admin
- [ ] Diagnosticar queries lentas en TPV y Transacciones
- [ ] Añadir índices DB en tablas más consultadas
- [ ] Optimizar queries backend: paginación, límites y selects selectivos
- [ ] Añadir skeletons de carga inmediatos en TPV y Transacciones
- [ ] Lazy loading mejorado en AdminLayout

## Empresa Facturadora NEXTAIR S.L. (v9.0)
- [x] Insertar en BD los campos de empresa facturadora como claves en siteSettings
- [x] Añadir bloque "Empresa Facturadora / Datos Fiscales" en Settings.tsx con todos los campos
- [x] Vincular datos de empresa facturadora al PDF de facturas (cabecera emisor)
- [x] Vincular datos de empresa facturadora al ticket TPV (cabecera)
- [x] Vincular datos de empresa facturadora al PDF de presupuestos (cabecera emisor)

## Evolución Estructural TPV v10.0
- [x] Migrar BD: campos fiscales en tpv_sales y tpv_sale_items (fiscalRegime, taxBase, taxAmount, reavMargin, reavCost, reavTax)
- [x] Migrar BD: ampliar tabla transactions (canal, vendedor, estación, fiscalidad, refs TPV/reserva/factura)
- [x] Backend: generar reserva automática (channel=tpv) al crear venta TPV
- [x] Backend: cálculo fiscal IVA/REAV en createSale TPV
- [x] Backend: registrar transacción unificada al crear venta TPV
- [x] Backend: nuevos procedimientos getTransactions con filtros avanzados y getReports BI
- [x] Frontend TPV: pestaña "Reservas TPV del día"
- [x] Frontend: botón "Emitir factura" en ficha de reserva TPV
- [x] Frontend: nuevo ticket 80mm con desglose fiscal y QR
- [x] Frontend: módulo Transacciones rediseñado con tabla completa y buscador avanzado
- [x] Frontend: módulo Informes BI con gráficas operativas

## Mejoras TPV v11.0
- [ ] TPV: formulario de cliente (nombre, email, teléfono) al iniciar nueva venta
- [ ] createSale: pasar datos de cliente a la reserva generada en CRM
- [ ] CRM Reservas: mostrar reservas canal TPV con etiqueta visual "TPV"
- [ ] Restaurar pestaña "Ventas TPV del día" en backoffice + enlace rápido desde TPV frontend
- [ ] Email post-venta TPV: enviar a cliente (si hay email) y siempre a reservas@nayadeexperiences.es

## Módulo Códigos de Descuento (v12.0)
- [ ] BD: tabla discount_codes (código, descripción, porcentaje, caducidad, estado, usos, límite, observaciones)
- [ ] BD: campos discountCode, discountPercent, discountAmount, originalAmount en tpv_sales y reservations
- [ ] Backend: CRUD códigos (crear, editar, activar/desactivar, duplicar)
- [ ] Backend: procedimiento validateDiscountCode (validar código, retornar porcentaje)
- [ ] Backend: registro de uso en discount_code_uses (trazabilidad completa)
- [ ] Back office: módulo /admin/marketing/codigos-descuento con listado, filtros y formulario
- [ ] TPV: campo "Código promocional" con validación, desglose en ticket y registro
- [ ] Carrito online: campo de código de descuento en checkout con validación visual
- [ ] Venta delegada CRM: campo de código en presupuestos/reservas manuales
- [ ] Transacciones: columnas discountCode, discountPercent, discountAmount, originalAmount
- [ ] Ticket TPV: mostrar subtotal original, código, descuento y total final

## Módulo Códigos de Descuento (v5.x)
- [x] Migrar BD: tabla discount_codes (código, tipo, porcentaje, límites, expiración, contadores)
- [x] Migrar BD: tabla discount_code_uses (trazabilidad de usos por contexto)
- [x] Backend: procedimientos CRUD (list, get, create, update, toggle, delete)
- [x] Backend: procedimiento validate (mutation) con validación completa
- [x] Back office: página Gestión de Códigos de Descuento (/admin/marketing/descuentos)
- [x] Back office: sección "Marketing" en sidebar con enlace a Códigos de Descuento
- [x] TPV: campo "Código promocional" con validación, desglose y registro en transacción
- [x] Carrito online (Checkout): campo de código de descuento con validación visual
- [x] CRM (QuoteBuilderModal): campo de código de descuento en presupuestos desde lead
- [x] CRM (DirectQuoteModal): campo de código de descuento en presupuestos directos
- [x] cartCheckout backend: aplica descuento al total Redsys cuando se proporciona código
- [x] Tests Vitest: 19 tests para lógica de descuento (cálculo, expiración, límites, validación)
- [x] 191 tests pasando en total (sin regresiones)

## Bug: Expedientes REAV no se crean desde el TPV
- [x] Analizar flujo createSale en tpv.ts y creación de expedientes REAV en fiscal.ts
- [x] Corregir: al finalizar una venta TPV con productos de régimen REAV, crear automáticamente expediente REAV
- [x] Tests y checkpoint

## Enriquecimiento Automático de Expedientes REAV
- [x] Auditar schema reavExpedients y createReavExpedient para identificar campos faltantes
- [x] Migrar BD: añadir campos clientName, clientEmail, clientPhone, clientDni, clientAddress, channel, sourceRef a reav_expedients
- [x] Actualizar createReavExpedient en db.ts para aceptar y persistir todos los nuevos campos
- [x] Añadir helper attachReavDocument en db.ts para adjuntar documentos al expediente
- [x] TPV: pasar nombre, email, teléfono del cliente y adjuntar ticket como documento al crear expediente REAV
- [x] CRM (pago Redsys): pasar datos del cliente (nombre, email, teléfono, DNI) y adjuntar factura+presupuesto PDF al crear expediente REAV
- [x] CRM (transferencia): igual que pago Redsys, con datos completos del cliente y documentos
- [x] Checkout online (IPN Redsys): crear expediente REAV con datos del cliente y adjuntar confirmación
- [x] Vista expediente REAV: bloque "Datos del Cliente", badge de canal de origen, notas en documentos auto-adjuntados
- [x] 196 tests pasando (sin regresiones)

## Ventas TPV visibles en CRM Reservas (v13.0)
- [x] Auditar tabla reservations y createSale TPV: campo channel ya existe, reserva ya se crea con channel='tpv'
- [x] Enriquecer reserva TPV: extrasJson con todos los ítems, people suma todos los participantes, notes con ticket, cliente y productos
- [x] CRM Reservas: badges de canal para todos los canales (TPV Presencial, CRM Delegado, Online, Teléfono)
- [x] CRM Reservas: filtro por canal en la barra de búsqueda (selector dropdown)
- [x] CRM Reservas: bloque info TPV en el detalle de la reserva (número de ticket, datos del cliente)
- [x] Backend: añadir parámetro channel al procedimiento crm.reservations.list
- [x] 196 tests pasando (sin regresiones)

## Bug: TPV carrito sin scroll (v14.0)
- [x] Panel carrito TPV: lista de ítems con scroll interno, total y botón cobrar siempre visibles

## Generar factura desde reserva TPV (v15.0)
- [x] Auditar esquema invoices y procedimiento de generación existente
- [x] Crear procedimiento crm.reservations.generateInvoice: genera factura desde reserva TPV, adjunta al REAV existente sin duplicar
- [x] Botón "Generar factura" en acciones del listado de Reservas CRM para reservas TPV sin invoiceId
- [x] Tests y checkpoint (202 tests pasando)

## Bug: Error al crear código de descuento (v16.0)
- [x] Diagnosticar error INSERT en tabla discount_codes (columna faltante o tipo incorrecto)
- [x] Corregir el procedimiento de creación de descuentos en el backend (schema Drizzle: status_dc → status)
- [x] Verificar que la creación funciona correctamente (202 tests pasando)

## Bug: Liquidaciones de proveedor sin líneas (v17.0)
- [x] Auditar lógica de generación de líneas en el backend (settlements)
- [x] Identificar por qué las reservas facturadas del periodo no se vinculan al proveedor (solo buscaba en invoices, no en reservations TPV)
- [x] Corregir el filtrado/join: preview y recalculate ahora incluyen reservas TPV pagadas con productos del proveedor
- [x] Añadir procedimiento recalculate + botón Recalcular en UI
- [x] Verificar con datos reales en BD y checkpoint (202 tests pasando)

## Módulo Lego Packs (v18.0)
- [x] Esquema BD: tablas lego_packs y lego_pack_lines con migración SQL
- [x] Backend tRPC: CRUD lego_packs (list, get, create, update, delete)
- [x] Backend tRPC: CRUD lego_pack_lines (add, update, remove, reorder)
- [x] Backend tRPC: calcularPrecio (suma líneas activas con descuentos)
- [x] Backoffice: página /admin/productos/lego-packs con listado y gestor
- [x] Backoffice: constructor de líneas (configuración por línea, precio calculado)
- [ ] Ficha pública del Lego Pack (pendiente)
- [x] Integración TPV: tipo legoPack en catálogo, filtro y carrito
- [x] Integración presupuestos/CRM: búsqueda de Lego Packs en selector de productos
- [ ] Integración facturas/REAV: descomposición fiscal por líneas (pendiente)
- [ ] Integración liquidaciones: trazabilidad parent_lego_pack_id por línea (pendiente)
- [ ] Informes: métricas de ventas por Lego Pack (pendiente)
- [x] Tests unitarios: 202 tests pasando, 0 errores TypeScript

## Bug: Slug vacío al crear Lego Pack (v18.1)
- [x] Corregir auto-generación de slug desde el título en el formulario de Lego Packs
- [x] Verificar que el campo slug tiene valor real antes de enviar al backend

## Mejoras editor Lego Packs (v18.2)
- [x] Constructor de líneas: buscador de productos del catálogo (experiencias, SPA, hotel, restaurante)
- [x] Líneas con checkbox de disponibilidad (isActive por línea, toggle instantáneo)
- [x] Imágenes: cargador real (upload a S3) en lugar de campos URL
- [x] Descuento con porcentaje y fecha de caducidad (igual que packs simples)
- [x] 202 tests pasando, 0 errores TypeScript

## Bug: Editor Lego Packs - modal y constructor de líneas (v18.3)
- [x] Corregir pestaña por defecto del modal (debe abrir en "General", no "Configuración")
- [x] Integrar constructor de líneas como pestaña "Líneas" dentro del modal de edición
- [x] Buscador de productos del catálogo funcional dentro del modal
- [x] Flujo completo: crear pack → añadir líneas → guardar, todo en un solo modal

## Editor Lego Packs v2 + Formularios de Leads (v18.4)
- [x] Corregir editor: pestaña "Líneas" integrada en el modal de edición (no panel separado)
- [x] Corregir pestaña por defecto del modal (siempre abre en "General")
- [x] Buscador de catálogo funcional dentro del modal de edición
- [x] Añadir Lego Packs dinámicamente al formulario de leads de la Home (¿Qué quieres vivir?)
- [x] Añadir Lego Packs dinámicamente al formulario de Solicita tu Presupuesto
- [x] Los Lego Packs publicados aparecen automáticamente según se crean (trpc.legoPacks.listPublic)

## Estructura Pública Lego Packs (v19.0)
- [x] Campo category en lego_packs (dia/escolar/empresa) + migración BD
- [x] Backend: listPublicByCategory, getBySlug para Lego Packs
- [x] Página /lego-packs: listado de categorías (igual que /packs)
- [x] Página /lego-packs/dia: Lego Packs de Día
- [x] Página /lego-packs/escolar: Lego Packs Escolares
- [x] Página /lego-packs/empresa: Lego Packs para Empresas
- [x] Página /lego-packs/detalle/:slug: ficha de detalle del Lego Pack
- [x] Menú header: submenú Lego Packs con 3 categorías
- [x] Footer: columna Lego Packs con enlaces a las 3 categorías
- [x] Editor backoffice: selector de categoría en formulario de Lego Pack
- [x] 202 tests pasando, 0 errores TypeScript

## Rediseño Ficha Pública Lego Pack (v20.0)
- [x] Reescribir LegoPackDetail.tsx con diseño idéntico a PackDetail.tsx
- [x] Hero section con imagen de fondo, overlay oscuro y banda de color por categoría
- [x] Breadcrumb en el hero (Inicio / Lego Packs / Categoría / Título)
- [x] Badges: badge personalizado, Destacado, Lego Pack
- [x] Sección "Qué incluye": líneas del Lego Pack con nombre, cantidad, precio y descuento
- [x] Indicador "No disponible actualmente" para líneas inactivas
- [x] Indicador "Opcional" para líneas opcionales
- [x] Ahorro total cuando hay descuento en líneas
- [x] Sección Descripción con duración, personas y audiencia objetivo
- [x] Widget lateral de precio (sticky): precio por persona, selector de personas, total estimado
- [x] Descuento activo con DiscountRibbon (igual que PackDetail)
- [x] Botón "Añadir al carrito" con misma lógica que PackDetail (addItem + openCart + toast)
- [x] Botón "Solicitar Presupuesto" con enlace a /presupuesto?legoPack=slug
- [x] Galería de imágenes adicionales
- [x] 202 tests pasando, 0 errores TypeScript

## Selector de fecha en Packs y Lego Packs (v20.1)
- [x] Añadir selector de fecha preferida en widget de precio de PackDetail.tsx
- [x] Validar que la fecha es obligatoria antes de añadir al carrito en PackDetail
- [x] Pasar bookingDate al addItem en PackDetail
- [x] Añadir selector de fecha preferida en widget de precio de LegoPackDetail.tsx
- [x] Validar que la fecha es obligatoria antes de añadir al carrito en LegoPackDetail
- [x] Pasar bookingDate al addItem en LegoPackDetail

## Mejoras admin Lego Packs (v20.2)
- [x] Ficha pública LegoPackDetail: botón "Añadir al carrito" ya correcto (isOnlineSale, misma lógica que PackDetail)
- [x] Admin líneas: openEditLine pre-rellena el buscador con el nombre del producto seleccionado
- [x] Admin líneas: botones Editar (lápiz) y Borrar (papelera) ya visibles y funcionales en la tabla
- [x] Admin config: corregir superposición "Modo disponibilidad" y "Orden" → layout en columna con descripción contextual
- [x] Admin config: Select de disponibilidad ocupa ancho completo, Input de orden tiene ancho fijo w-32
- [x] 202 tests pasando, 0 errores TypeScript

## v20.5 — Categorías en admin Lego Packs
- [x] Añadir campo `category` al tipo PackForm y emptyForm en LegoPacksManager
- [x] Selector visual de categoría (Día/Escolar/Empresa) con tarjetas en pestaña General
- [x] Badge de categoría visible en cada tarjeta del listado admin
- [x] Filtro por categoría en la barra superior del listado admin
- [x] Sincronización de categoría al abrir un pack para edición (openEdit)
- [x] La parte pública ya filtraba por category — confirmado funciona con el campo DB

## v21.0 — Módulo Financiero: Gastos + Cuenta de Resultados
- [ ] Tablas BD: expense_categories, expense_suppliers, cost_centers, expenses, recurring_expenses, expense_files
- [ ] Datos iniciales: 6 centros de coste + categorías de gasto base
- [ ] Router tRPC: expenses (CRUD + filtros + adjuntos)
- [ ] Router tRPC: expenseCategories, expenseSuppliers, costCenters
- [ ] Router tRPC: recurringExpenses (CRUD + trigger manual)
- [ ] Router tRPC: profitLoss (cuenta de resultados con lógica REAV + cancelaciones)
- [ ] UI: ExpensesManager (listado, nuevo gasto, filtros, adjuntos drag&drop)
- [ ] UI: ExpenseCategoriesManager
- [ ] UI: ExpenseSuppliersManager
- [ ] UI: RecurringExpensesManager
- [ ] UI: ProfitLossReport (KPIs + tabs por producto/categoría/centro coste/canal + export CSV)
- [ ] Sidebar: añadir subsecciones Gastos y Cuenta de Resultados en Contabilidad
- [ ] App.tsx: registrar todas las rutas nuevas
- [ ] TPV: gasto rápido desde cierre de caja
- [ ] Cron diario para gastos recurrentes
- [ ] Tests Vitest para el módulo financiero

## v21.0 — Módulo Financiero (Gastos + Cuenta de Resultados)
- [x] Tablas BD: expense_categories, expense_suppliers, cost_centers, expenses, expense_files, recurring_expenses
- [x] Router tRPC: financial.categories, financial.suppliers, financial.costCenters, financial.expenses, financial.recurring, financial.profitLoss
- [x] Admin: ExpensesManager — listado, filtros, nuevo/editar gasto con adjuntos drag&drop
- [x] Admin: ExpenseCategoriesManager — CRUD categorías de gastos
- [x] Admin: ExpenseSuppliersManager — CRUD proveedores de gastos (con NIF, IBAN, email)
- [x] Admin: RecurringExpensesManager — CRUD gastos recurrentes + botón generar ahora
- [x] Admin: ProfitLossReport — KPIs, evolución mensual, ingresos por canal/producto, gastos por categoría/centro coste, exportación CSV
- [x] Sidebar: sección Contabilidad expandible con submenú (Dashboard, Gastos, Recurrentes, Categorías, Proveedores, Cuenta Resultados)
- [x] Rutas App.tsx: /admin/contabilidad/gastos, /categorias, /proveedores, /recurrentes, /cuenta-resultados

## v21.0 — Módulo Financiero (Gastos + Cuenta de Resultados)
- [x] Tablas BD: expense_categories, expense_suppliers, cost_centers, expenses, expense_files, recurring_expenses
- [x] Router tRPC: financial.categories, financial.suppliers, financial.costCenters, financial.expenses, financial.recurring, financial.profitLoss
- [x] Admin: ExpensesManager — listado, filtros, nuevo/editar gasto con adjuntos drag&drop
- [x] Admin: ExpenseCategoriesManager — CRUD categorías de gastos
- [x] Admin: ExpenseSuppliersManager — CRUD proveedores de gastos (con NIF, IBAN, email)
- [x] Admin: RecurringExpensesManager — CRUD gastos recurrentes + botón generar ahora
- [x] Admin: ProfitLossReport — KPIs, evolución mensual, ingresos por canal/producto, gastos por categoría/centro coste, exportación CSV
- [x] Sidebar: sección Contabilidad expandible con submenú (Dashboard, Gastos, Recurrentes, Categorías, Proveedores, Cuenta Resultados)
- [x] Rutas App.tsx: /admin/contabilidad/gastos, /categorias, /proveedores, /recurrentes, /cuenta-resultados

## v21.5 — Rediseño encabezado PDFs (logo 90px coherente)
- [x] Plantilla Factura (crm.ts): encabezado azul oscuro + logo circular 90px + banda naranja
- [x] Plantilla Presupuesto (emailTemplates.ts): mismo diseño coherente con banda naranja
- [x] Plantilla Liquidación (suppliers.ts): mismo diseño con banda violeta para documentos internos
- [x] PDFs de muestra regenerados y enviados a reservas@nayadeexperiences.es

## v22.0 — Módulo Canje de Cupones Groupon (Ticketing)
- [x] BD: tabla ticketing_products (catálogo de productos Groupon ocultos)
- [x] BD: tabla coupon_redemptions (solicitudes de canje con estados operativo + financiero)
- [x] Backend tRPC: ticketing.products (CRUD admin, no visible en frontend normal)
- [x] Backend tRPC: ticketing.redemptions (create, list, get, update, validate, convertToReservation)
- [x] Backend: motor de validación (duplicidad dura/blanda, estados)
- [x] Backend: motor OCR asistido (extracción texto PDF/imagen, scoring 0-100)
- [x] Frontend público: página /canjear-cupon (replica diseño /presupuesto)
- [x] Admin Marketing > Cupones: listado con filtros, detalle con comparativa OCR
- [x] Admin Marketing > Incidencias Ticketing: bandeja de revisión
- [x] Admin Contabilidad > Ticketing/Groupon: liquidaciones, métricas, justificantes
- [x] Admin Marketing > Productos Ticketing: CRUD catálogo Groupon
- [x] Sidebar admin: sección Marketing con subsecciones Cupones, Incidencias, Productos Ticketing
- [x] Rutas App.tsx: /admin/marketing/cupones, /incidencias, /productos-ticketing, /liquidaciones-ticketing
- [x] Tests Vitest: ticketing module (create, validate, duplicate detection, OCR scoring)

## v22.1 — Fix: sección Marketing no visible en sidebar
- [x] Auditar todos los archivos de sidebar/navegación para encontrar cuál se usa realmente en producción
- [x] Corregir el archivo correcto añadiendo la sección Marketing

## v22.2 — Fix visual CuponesManager + bug sidebar activo
- [x] Corregir bug sidebar: estado activo se aplica a todos los ítems al hacer clic
- [x] Reescribir CuponesManager con estilo claro del dashboard (igual que CRM/Contabilidad)

## v22.3 — Ampliación sistema de canje de cupones (multi-cupón + alta manual + emails + conciliación)
- [ ] BD: añadir submission_id, origin_source, channel_entry, created_by_admin_id a coupon_redemptions
- [ ] BD: añadir tabla coupon_email_config (flags auto_send_received, auto_send_validated, auto_send_internal, email_mode)
- [ ] Backend: createSubmission (multi-cupón, un envío = N registros con mismo submission_id)
- [ ] Backend: createManualRedemption (alta manual admin, origin_source=admin_manual_entry)
- [ ] Backend: emails automáticos (recepción, validación, alerta interna) con config flags
- [ ] Backend: listSubmissions (agrupado por submission_id)
- [ ] Backend: conciliación (marcar canje, marcar cobro, importe real, justificante)
- [ ] Frontend /canjear-cupon: bloque multi-cupón dinámico (+ Añadir otro cupón / eliminar)
- [ ] Admin CuponesManager: botón "Nuevo canje manual" con formulario completo
- [ ] Admin CuponesManager: vista agrupada por submission_id
- [ ] Admin CuponesManager: acciones completas (validar, duplicar, subir adjunto, relanzar OCR, marcar incidencia)
- [ ] Admin Contabilidad: módulo Ticketing/Conciliación (filtros, marcar canje/cobro, justificante)
- [ ] Tests Vitest: multi-cupón, alta manual, emails, conciliación

## v22.3 — Ampliación multi-cupón y alta manual (completado)
- [x] BD: añadir submission_id, origin_source, channel_entry, created_by_admin_id a coupon_redemptions
- [x] BD: nueva tabla coupon_email_config para configuración de emails automáticos
- [x] Backend: createSubmission (multi-cupón desde web con emails automáticos)
- [x] Backend: createManualRedemption (alta manual desde admin)
- [x] Backend: listSubmissions (vista agrupada por submission_id)
- [x] Backend: getEmailConfig / updateEmailConfig (configuración de emails)
- [x] Backend: updateSettlement (conciliación financiera)
- [x] Frontend /canjear-cupon: soporte multi-cupón dinámico (añadir/quitar cupones)
- [x] Panel Admin: tab "Envíos" con vista agrupada por submission_id expandible
- [x] Panel Admin: botón "Alta manual" con modal completo
- [x] Panel Admin: tab "Config. emails" con toggles y modo de envío
- [x] Panel Admin: KPIs en cabecera (total, incidencias, pdte. canje, cobrados)
- [x] Fix TypeScript: 0 errores tras reescritura completa de CuponesManager

## v22.4 — Reservas Groupon en CRM (completado)
- [x] BD: añadir channel, origin_source, redemption_id a tabla reservations
- [x] Backend: convertToReservation crea reserva con channel=groupon, origin_source=coupon_redemption, redemption_id
- [x] Backend: listReservations filtra/expone campo channel y redemption_id
- [x] CRM listado: badge "Groupon / No facturable" en filas con channel=groupon
- [x] CRM listado: filtro por canal (Todos / Directo / Groupon / Otro)
- [x] CRM detalle: ocultar/desactivar botón "Facturar" si channel=groupon
- [x] CRM detalle: bloquear conversión a factura en backend (adminProcedure con guard)
- [x] CRM detalle: enlace al canje original (redemption_id → /admin/marketing/cupones)
- [x] CRM detalle: sección informativa "Reserva procedente de canje Groupon"
- [x] Calendario operaciones: mostrar badge Groupon en eventos de este canal
- [x] Tests Vitest: convertToReservation, guard anti-facturación Groupon

## v22.5 — Módulo "Canjea tu cupón" en Home
- [x] Auditar estructura Home.tsx para elegir posición óptima del módulo
- [x] Diseñar e implementar módulo aspiracional con look & feel coherente con la web
- [x] Módulo posicionado estratégicamente (entre Testimonios y CTA Final — sección 9)

## v22.6 — Enlace "Canjear Cupón" en menú de navegación
- [x] Añadir enlace "Canjear Cupón" en el header público junto a "Contacto" (desktop + mobile)

## v22.7 — Sección "Pack de Día Completo" apunta a Lego Packs
- [x] Cambiar query/categoría de la sección Pack de Día en Home.tsx de packs a lego-packs
- [x] Actualizar rutas de ficha de producto y botón añadir al carrito hacia lego-packs

## v22.8 / v23.0 — Eliminación completa del sistema de Packs (mantener Lego Packs)
- [x] Auditoría: mapear todas las referencias a packs en rutas, componentes, sidebar, menú, carrito y BD
- [x] Eliminar páginas públicas: /packs, /packs/dia, /packs/escolares, /packs/corporativo y sus rutas (PacksList.tsx, PackDetail.tsx, PacksHome.tsx eliminados)
- [x] Eliminar entradas de packs del menú público (PublicNav.tsx) y del sidebar admin (AdminLayout.tsx ya sólo tiene Lego Packs)
- [x] Eliminar referencias a packs en Home.tsx (categoría Packs del hero form, ctaLink /packs → /lego-packs)
- [x] Eliminar procedimientos tRPC públicos de packs (getByCategory, getBySlug) — admin procedures preservados para TPV y liquidaciones
- [x] Eliminar categoría "Packs" de BudgetRequest.tsx y query packsList
- [x] TypeScript: 0 errores. Tests: 222 pasando.

## v22.9 — Mejora de buscadores CRM (Leads, Presupuestos, Reservas, Facturas)
- [x] Auditar queries de búsqueda actuales en crm.ts (listLeads, listQuotes, listReservations, listInvoices)
- [x] Leads: buscar por nombre, email, teléfono, empresa, producto, categoría, mensaje, origen
- [x] Presupuestos: buscar por número, título, notas + nombre/email/teléfono/empresa/producto del lead (JOIN)
- [x] Reservas: buscar por nombre, email, teléfono, merchant_order, número factura, producto, fecha reserva, notas
- [x] Facturas: buscar por número factura, nombre, email, teléfono, NIF, dirección
- [x] TypeScript: 0 errores. Tests: 222 pasando.

## v23.0 — Limpieza técnica completa (auditoría v22.9)

### Sprint 1 — Alta prioridad
- [ ] A1: Eliminar 4 entradas obsoletas de packs en authGuard.ts (líneas 67-70)
- [ ] A3: Eliminar PacksManager.tsx huérfano (814 líneas, no enrutado)
- [ ] A4: Eliminar ComponentShowcase.tsx huérfano (1.437 líneas, no enrutado)
- [ ] A5: Eliminar 9 funciones muertas de db.ts (getAllLeads, updateLeadStatus, createQuote, getAllQuotes, updateQuoteStatus, getPublicPacks, getPackBySlug, getPackCrossSells, generateExpedientNumber)

### Sprint 2 — Alta prioridad
- [ ] A2: Crear server/dbPool.ts singleton y reemplazar los 4 pools independientes (crm.ts, legoPacks.ts, tpv.ts, suppliers.ts)

### Sprint 3 — Media prioridad
- [ ] M1: Migrar 7 archivos que reimplementan sendEmail para usar mailer.ts
- [ ] M2: Centralizar adminProcedure y staffProcedure en _core/trpc.ts, eliminar definiciones locales

### Sprint 4 — Media prioridad
- [ ] M3/B7: Cambiar rutas /admin/suppliers → /admin/proveedores y /admin/settlements → /admin/liquidaciones en App.tsx y AdminLayout.tsx
- [ ] M4: Eliminar 6 pares de rutas alias sin documentar en App.tsx
- [ ] M5: Reemplazar 5 rutas legacy window.location.replace por Redirect de wouter
- [ ] M8: Unificar validación customerName a min(2) en hotel.ts, spa.ts, tpv.ts, ticketing.ts

### Sprint 5 — Baja prioridad
- [ ] B1: Mover DiscountCodesManager.tsx a admin/marketing/ y actualizar import en App.tsx
- [ ] B2: Definir DEFAULT_PAGE_SIZE=50 en shared/const.ts y usar en todos los routers
- [ ] B3: Eliminar/reducir 25 console.log en código de servidor de producción
- [ ] B4/B5/B6/M6: Eliminar imports ghlWebhookLogs, dailyOrders, packCrossSells de db.ts
- [ ] B8: Corregir comentario engañoso en crm.ts sobre pool compartida
- [ ] M9: Añadir convención de nomenclatura en schema.ts

## v23.1 — Refactor completo módulo Cupones & Ticketing (pipeline tipo CRM)

### Fase 1 — BD
- [x] Simplificar statusOperational: recibido | pendiente | reserva_generada
- [x] Simplificar statusFinancial: pendiente_canjear | canjeado | incidencia
- [x] Añadir tabla platforms (nombre, logo, activa, frecuencia_liquidacion, comision, url)
- [x] Añadir tabla platform_products (platformId, experienceId, externalLink, activo)
- [x] Añadir tabla platform_settlements (platformId, periodo, estado, importe, cupones_ids)
- [x] Ejecutar migración SQL

### Fase 2 — Backend
- [x] Nuevos procedimientos: listCoupons (con filtros), updateCouponStatus, convertToReservation
- [x] Procedimiento postponeCoupon (cambia estado + envía email automático)
- [x] Procedimiento markIncidence
- [x] CRUD plataformas (createPlatform, updatePlatform, togglePlatform, deletePlatform)
- [x] CRUD platform_products
- [x] CRUD liquidaciones de plataformas
- [x] Procedimiento getDashboardStats (métricas pipeline)
- [x] authGuard actualizado con procedimientos públicos

### Fase 3 — Frontend CuponesManager
- [x] Dashboard superior con 4 cards pipeline (Recibidos, Pendientes, Reserva generada, Incidencias)
- [x] Métricas secundarias (total, % conversión, valor €, pendientes)
- [x] Tabs: Cupones | Reservas generadas | Pendientes | Incidencias | Liquidaciones
- [x] Tabla de cupones con acciones rápidas (Ver, Convertir, Posponer, Incidencia)
- [x] Modal "Convertir en reserva" con selector de fecha/producto
- [x] Modal "Ver detalle" completo del cupón
- [x] Filtro por proveedor (Groupon, Smartbox, CheckYeti, Atrapalo, Jumping, Alpine Resort, Civitatis)
- [x] Badges de proveedor en cada fila
- [x] Look & feel idéntico al CRM (fondo negro, degradados, tipografía)

### Fase 4 — PlatformsManager
- [x] Crear PlatformsManager.tsx con 3 sub-tabs: Configuración | Productos | Liquidaciones
- [x] Formulario de plataforma con logo, frecuencia, comisión, URL
- [x] Tabla de productos publicados por plataforma
- [x] Módulo de liquidaciones con estados pendiente_cobro / cobrado
- [x] Registrar ruta /admin/marketing/plataformas en App.tsx y sidebar

### Fase 5 — Integración CRM
- [x] Reservas generadas desde cupón aparecen en CRM con origen "Plataforma"
- [x] Badge de proveedor visible en reserva del CRM
- [x] Trazabilidad: campo couponId en reservations

## v23.2 — Plataformas: productos con PVP/neto/URL/caducidad + liquidaciones periódicas [COMPLETADO]

### BD
- [x] Añadir pvpPrice, netPrice, expiresAt, updatedAt a platform_products
- [x] Mejorar platform_settlements: añadir notes, invoiceRef, paidAt, emittedAt, couponIds, netTotal, estado emitida
- [x] Añadir platformProductId y settlementId a coupon_redemptions
- [x] Ejecutar migración SQL

### Backend
- [x] CRUD platform_products con nuevos campos (pvpPrice, netPrice, externalLink, expiresAt)
- [x] Procedimiento listPlatformProducts con filtro por plataforma (para selector en "Convertir en Reserva")
- [x] Procedimiento generateSettlement (crea liquidación con cupones canjeados del periodo)
- [x] Procedimiento listSettlementCoupons (cupones incluidos en una liquidación)
- [x] Lógica de periodicidad: calcular periodo según frecuencia (quincenal/mensual/trimestral)

### Frontend PlatformsManager
- [x] Tabla de productos con columnas: Producto, PVP, Precio neto, URL externa, Caducidad, Estado
- [x] Formulario de producto ampliado con pvpPrice, netPrice, externalLink, expiresAt
- [x] Indicador visual de productos caducados (badge rojo) y próximos a caducar (badge ámbar)

### Frontend CuponesManager
- [x] Modal "Convertir en Reserva": selector de plataforma → carga productos activos de esa plataforma
- [x] Mostrar PVP y precio neto del producto seleccionado en el modal
- [x] Resumen de importes (PVP total × pax, neto total) en el modal

### Frontend Liquidaciones
- [x] Tab Liquidaciones en PlatformsManager: listado por plataforma con periodo y estado
- [x] Botón "Generar liquidación" que agrupa cupones canjeados del periodo automáticamente
- [x] Estados: Pendiente / Emitida / Pagada con acciones de transición
- [x] Detalle de liquidación: lista de cupones incluidos, importe total, precio neto total
- [x] TypeScript: 0 errores. Tests: 222 pasando.

## v23.3 — Transiciones directas de estado en liquidaciones + email al convertir cupón [COMPLETADO]

- [x] Botones de transición directa en tabla de liquidaciones (Pendiente→Emitida→Pagada)
- [x] Procedimiento advanceSettlementStatus en router ticketing (con timestamps automáticos emittedAt/paidAt)
- [x] Email automático de confirmación al cliente al convertir cupón en reserva
- [x] Reutilizar plantilla HTML buildReservationConfirmHtml con datos del producto de plataforma
- [x] Copia BCC automática a reservas@nayadeexperiences.es
- [x] TypeScript: 0 errores. Tests: 222 pasando.

## v23.4 — Mejoras módulo cupones y CRM [COMPLETADO]
- [x] CRM Reservas: badge de plataforma (Groupon, Smartbox…) en reservas con origen "Plataforma" (campo platformName en BD + badge naranja dinámico)
- [x] CuponesManager: modal lateral "Marcar como canjeado" con subida de comprobante (PDF/imagen) — RedeemModal con drag&drop
- [x] Backend: procedimiento markAsRedeemed con upload de comprobante a S3, actualiza statusFinancial→canjeado y guarda settlementJustificantUrl
- [x] PlatformsManager: columnas estadísticas por producto (cupones recibidos/canjeados/aparcados/anulados/PVP generado/neto obtenido)
- [x] Backend: procedimiento getProductStats que agrega cupones por platformProductId
- [x] Tests Vitest: 235 tests pasando (13 nuevos para markAsRedeemed, getProductStats, RedeemModal, badge CRM)

## v23.5 — Bug estadísticas productos + cliente automático desde cupón [COMPLETADO]
- [x] Bug fix: getProductStats usaba INNER JOIN + alias SQL roto (pp.pvpPrice) → ahora usa lógica JS-side con fallback por provider
- [x] Bug fix: estadísticas ahora cuentan cupónes legacy (sin platformProductId) buscando por nombre de plataforma en campo provider
- [x] Bug fix: si la plataforma tiene un solo producto, todos sus cupones se asignan automáticamente a ese producto
- [x] Feature: upsert automático de cliente en tabla clients al registrar cupón desde web pública (createSubmission)
- [x] Feature: upsert automático de cliente en tabla clients al dar de alta manual un cupón (createManualRedemption)
- [x] Feature: upsert automático de cliente en tabla clients al registrar cupón desde /canjear-cupon (createRedemption)
- [x] Todos los upserts usan source="cupon" y el patrón onDuplicateKeyUpdate robusto (no sobreescribe datos existentes)
- [x] 235 tests pasando (0 errores TypeScript)

## v23.6 — Botón borrar cupón con modal de confirmación [COMPLETADO]
- [x] Backend: procedimiento deleteRedemption (solo admin, elimina registro de coupon_redemptions)
- [x] Frontend: botón papelera Trash2 en cada fila del listado de cupones (CuponesManager)
- [x] Frontend: modal de confirmación con datos del cupón antes de borrar (icono alerta rojo, nombre cliente, código, proveedor, estado)
- [x] 235 tests pasando (0 errores TypeScript)

## v23.7 — Badge "Lead Cupón" en listado de clientes CRM
- [ ] CRM Clientes: columna Estado muestra "Lead Cupón" (badge diferenciado) cuando source="cupon", en lugar de "Lead" genérico

## v23.7 — Badge "Lead Cupón" en ClientsManager + Columna Clientes en PlatformsManager [COMPLETADO]
- [x] ClientsManager: badge violeta "Lead Cupón" (icono Ticket) cuando source="cupon", diferenciado del "Lead" naranja
- [x] PlatformsManager: columna "Clientes" en tabla de productos que muestra nombres de clientes (máx. 3 visibles + contador +N)
- [x] Backend: getProductStats devuelve customerNames[] por producto (deduplicados)
- [x] 235 tests pasando (0 errores TypeScript)

## v23.8 — Fix visibilidad columna Clientes en PlatformsManager [COMPLETADO]
- [x] Diagnóstico: el contenedor usaba overflow-hidden que cortaba las columnas extra
- [x] Fix: cambiado a overflow-x-auto + min-w-[1100px] en la tabla para habilitar scroll horizontal y mostrar todas las columnas
- [x] 235 tests pasando (0 errores TypeScript)

## v24 — Módulo Solicitud de Anulaciones (CRM completo) [COMPLETADO]
- [x] Schema Drizzle: tablas cancellation_requests, cancellation_logs, compensation_vouchers
- [x] Migración SQL aplicada a BD (3 tablas con enums, foreign keys e índices)
- [x] Backend: router cancellations.ts con 11 procedimientos tRPC completos
- [x] Landing pública /solicitar-anulacion con formulario validado (5 motivos, adjuntos, localizador)
- [x] Email acuse de recibo al enviar formulario (plantilla HTML con ID de expediente)
- [x] Módulo CRM CancellationsManager: 10 KPIs, tabla con 3 badges de estado, filtros múltiples
- [x] Navegación sidebar: items "Clientes" y "Anulaciones" bajo CRM con indent
- [x] Modal de detalle CancellationDetailModal: Datos, Estado, Timeline, Notas, Acciones operativas
- [x] Acción Rechazar: email al cliente + cambio de estados + entrada en timeline
- [x] Acción Aceptar total: flujo devolución económica o bono + estados + email
- [x] Acción Aceptar parcial: mismo flujo que total con estado parcial + email
- [x] Acción Solicitar documentación: email al cliente + estado + timeline
- [x] Acción Marcar incidencia: estado + timeline
- [x] Acción Cerrar expediente: validación de condiciones + timeline
- [x] Generación de bonos PDF con ID único (BON-XXXXXX), diseño de marca, descarga desde expediente
- [x] Emails automáticos: 7 plantillas HTML (acuse, rechazo, aceptación total/parcial devolución/bono, solicitud docs, incidencia)
- [x] 235 tests pasando (0 errores TypeScript)

## v25 — Páginas Legales (4 páginas)
- [ ] Scrappear estructura legal de Skicenter (Privacidad + Aviso Legal)
- [ ] Página /politica-de-privacidad adaptada a Nayade Experiences
- [ ] Página /aviso-legal adaptada a Nayade Experiences
- [ ] Página /politica-de-cookies (nueva, RGPD + LSSI)
- [ ] Página /condiciones-de-cancelacion (con texto base proporcionado)
- [ ] Integrar rutas en App.tsx
- [ ] Actualizar footer con enlaces a las 4 páginas legales

## v25.1 — Integrar Anulaciones en CRMDashboard (coherencia visual y sidebar) [COMPLETADO]
- [x] Añadir pestaña "Anulaciones" en CRMDashboard (junto a Leads/Presupuestos/Reservas/Facturas)
- [x] KPIs de anulaciones visibles en el dashboard principal del CRM (Grupo 3 en sidebar + KPIs en tab)
- [x] Contenido del pipeline de anulaciones integrado como tab dentro del CRMDashboard
- [x] Sidebar link actualizado a /admin/crm?tab=anulaciones (mantiene AdminLayout siempre visible)
- [x] Ruta separada /admin/crm/anulaciones eliminada (ya no necesaria)
- [x] Tests de integración escritos y pasando (6/6)

## v25.2 — Enlace Solicitar Anulación en footer
- [x] Añadir enlace "Solicitar Anulación" → /solicitar-anulacion en columna Servicios del footer público

## v25.3 — Páginas legales completas [COMPLETADO]
- [x] Revisar/completar PoliticaPrivacidad.tsx (ruta /privacidad)
- [x] Crear TerminosCondiciones.tsx (ruta /terminos) — 11 secciones con política de cancelación, menores, seguridad, jurisdicción
- [x] Crear PoliticaCookies.tsx (ruta /cookies) — 8 secciones con tablas de cookies técnicas/analíticas/preferencias
- [x] Registrar las 3 rutas en App.tsx

## v25.4 — Página Condiciones de Cancelación [COMPLETADO]
- [x] Crear CondicionesCancelacion.tsx con contenido adaptado a Náyade Experiences (13 secciones)
- [x] Registrar ruta /condiciones-cancelacion en App.tsx
- [x] Añadir enlace "Cancelación" en la barra legal del footer

## v25.4 — Página Condiciones de Cancelación
- [ ] Crear CondicionesCancelacion.tsx con contenido adaptado a Náyade Experiences
- [ ] Registrar ruta /condiciones-cancelacion en App.tsx
- [ ] Añadir enlace en el footer (columna legal)

## v25.5 — Sistema de Plantillas Centralizado + Normalización
- [ ] Auditar y listar todas las plantillas de email y PDF existentes (12 email + 2 PDF)
- [ ] Normalizar plantillas de email en ficheros separados (tpv, cancellations, restaurants, ticketing) al diseño base de emailTemplates.ts
- [ ] Crear tabla email_templates en BD (id, key, name, type, trigger, subject, htmlBody, updatedAt)
- [ ] Crear procedimientos tRPC: templates.list, templates.get, templates.update, templates.preview, templates.sendTest
- [ ] Crear TemplatesManager.tsx en Admin > CRM con listado, editor HTML, preview desktop/mobile, envío de test
- [ ] Registrar ruta /admin/crm/plantillas en App.tsx y sidebar del CRM
- [ ] Cargar todas las plantillas existentes en la BD al arrancar (seed)
- [ ] Enviar todas las plantillas de prueba a reservas@nayadeexperiences.es

## v25.6 — Editor completo de Plantillas Email y PDF [COMPLETADO]
- [x] Tabla `email_templates` en BD para plantillas editables (asunto, cuerpo HTML, imagen cabecera, variables)
- [x] Tabla `pdf_templates` en BD para plantillas PDF editables
- [x] Procedimientos tRPC: getTemplate, saveTemplate, createTemplate, deleteTemplate (email y PDF)
- [x] EmailTemplatesManager: panel de edición de asunto, textos del cuerpo e imagen de cabecera
- [x] EmailTemplatesManager: botón "Nueva plantilla" con formulario de creación
- [x] PdfTemplatesManager: módulo equivalente para facturas, presupuestos, tickets y bonos
- [x] Sidebar: añadir "Plantillas PDF" bajo Configuración junto a "Plantillas Email"

## v25.7 — Banner de Consentimiento de Cookies RGPD [COMPLETADO]
- [x] Crear componente CookieBanner con diseño Náyade (fondo oscuro azul marino, botón naranja)
- [x] Opciones: Aceptar todas / Solo necesarias / Configurar (panel expandible por categoría)
- [x] Guardar preferencia en localStorage (nayade_cookie_consent)
- [x] Integrar en layout público (App.tsx) visible en todas las páginas públicas
- [x] Enlace directo a /cookies desde el banner

## v25.8 — Módulos de Operaciones completos (Monitores, Actividades, Órdenes) [COMPLETADO]
- [x] MonitorsManager.tsx: reescrito alineado con schema real del backend (contractType, sin specialty)
- [x] DailyActivities.tsx: corregido assignMonitor (eliminar campo date no existente en el procedimiento)
- [x] DailyOrders.tsx: corregido tipo de datos (activities + restaurants combinados) y añadido reservationType en updateOperational
- [x] App.tsx: añadidas rutas /admin/operaciones/actividades y /admin/operaciones/monitores
- [x] AdminLayout.tsx: corregido enlace "Actividades del Día" → /admin/operaciones/actividades
- [x] 0 errores TypeScript tras todas las correcciones

## v25.9 — Subida de documentos en Monitores [COMPLETADO]
- [x] Backend: endpoint REST POST /api/upload/monitor-doc (20 MB, PDF/img/Word/Excel)
- [x] Backend: procedimiento tRPC monitors.addDocument (guarda metadata en monitor_documents)
- [x] Backend: procedimiento tRPC monitors.deleteDocument (elimina de BD)
- [x] Frontend: zona de clic/drop para seleccionar archivo en pestaña Documentos
- [x] Frontend: campos nombre y tipo de documento antes de subir
- [x] Frontend: listado con nombre, tipo, fecha y botones Ver/Eliminar
- [x] Frontend: spinner de carga durante la subida
- [x] 0 errores TypeScript

## v25.10 — Foto de perfil en ficha de Monitor [COMPLETADO]
- [x] Backend: endpoint REST POST /api/upload/monitor-photo (imagen JPG/PNG/WebP, 5 MB)
- [x] Backend: photoUrl y photoKey añadidos en create y update procedures del router
- [x] Frontend: avatar con foto en la tarjeta del listado (reemplaza iniciales cuando hay foto)
- [x] Frontend: bloque de subida de foto en el formulario crear/editar con preview inmediata
- [x] Frontend: botón Quitar foto para limpiar la selección
- [x] 0 errores TypeScript

## BUG v25.11 — Reserva Simo Blanquez no aparece en Calendario/Actividades [RESUELTO]
- [x] Diagnosticar: las consultas SQL usaban columnas inexistentes (scheduled_date, experience_id, number_of_persons)
- [x] Corregir: reemplazado por booking_date (DATE), product_id, people; filtro status cambiado a 'cancelled','failed'
- [x] Calendario, Actividades del Día y Órdenes del Día ahora muestran TODAS las reservas (incluyendo presupuestos con product_id=0)

## BUG v25.12 — Reserva Simo Blanquez no aparece en Calendario ni Órdenes del Día [RESUELTO]
- [x] Diagnosticar: booking_date es DATE string "YYYY-MM-DD"; el frontend lo trataba como timestamp numérico
- [x] Corregir Calendario: añadida función parseEventDate() que parsea DATE strings como hora local (T09:00:00)
- [x] Corregir Órdenes del Día: actualizada formatTime() para manejar DATE strings de MySQL
- [x] eventsByDay ahora usa sd.slice(0,10) directamente para el key de fecha (sin conversión UTC)

## v25.13 — Correcciones Operaciones [COMPLETADO]
- [x] Backend: al crear registro en reservation_operational, auto-marcar clientConfirmed=true si la reserva tiene status='paid'
- [x] BD: actualizada reserva de Simo Blanquez (id=420001) a clientConfirmed=1
- [x] Backend: todas las consultas de fechas usan input.slice(0,10) en lugar de new Date().toISOString() para evitar desplazamiento UTC-4
- [x] Calendario getEvents: usa input.from.slice(0,10) y input.to.slice(0,10)
- [x] Ordenes del Día getForDate: usa input.date.slice(0,10)
- [x] Actividades del Día getForDate: usa input.date.slice(0,10)
- [x] getDashboardStats: usa input.date.slice(0,10)
- [x] 0 errores TypeScript, servidor limpio

## v25.14 — opStatus auto-confirmado para reservas pagadas [COMPLETADO]
- [x] BD: actualizada reserva de Simo Blanquez (id=420001) a opStatus='confirmado'
- [x] Backend: al crear nuevo registro operativo para reserva paid, opStatus='confirmado' por defecto
- [x] Frontend: la etiqueta de estado refleja el opStatus de la BD directamente

## v25.15 — Consistencia UI + Reconstrucción Dashboard
- [ ] FASE 1: Auditar todas las rutas y detectar pantallas sin AdminLayout
- [ ] FASE 1: Unificar layout — envolver pantallas aisladas bajo AdminLayout
- [ ] FASE 2 Bloque 1: Acciones críticas (leads sin gestionar, presupuestos sin enviar/respuesta, reservas pendientes, anulaciones, incidencias, cupones, órdenes sin confirmar, actividades sin monitor)
- [ ] FASE 2 Bloque 2: Métricas reales (ingresos día/mes, reservas hoy, ocupación, pendiente cobro, conversión)
- [ ] FASE 2 Bloque 3: Actividad reciente con trazabilidad (qué, quién, cuándo, enlace)
- [ ] FASE 2 Bloque 4: Actividades de hoy conectadas a módulo de operaciones
- [ ] FASE 2 Bloque 5: Inteligencia del sistema (alertas automáticas)
- [ ] FASE 3: Validación — todas las pantallas usan el mismo layout

## v25.15 — Consistencia UI + Dashboard rediseño [COMPLETADO]
- [x] Auditoría de layout: detectadas 7 pantallas sin AdminLayout
- [x] ReavManager: envuelto con AdminLayout (eliminado min-h-screen bg-slate-50)
- [x] SettlementsManager: envuelto con AdminLayout
- [x] SuppliersManager: envuelto con AdminLayout
- [x] GalleryManager: envuelto con AdminLayout (corregido AdminLayout closing tag)
- [x] CancellationsManager: envuelto con AdminLayout
- [x] EmailTemplatesManager: envuelto con AdminLayout
- [x] PdfTemplatesManager: envuelto con AdminLayout
- [x] Dashboard: bloque "Actividades de hoy" ahora usa trpc.operations.activities.getForDate (tabla reservations real)
- [x] Dashboard: muestra nombre de actividad, cliente, pax, monitor asignado y estado operativo
- [x] Dashboard: icono de monitor asignado (azul) vs sin monitor (ámbar) para identificación rápida
- [x] 0 errores TypeScript

## BUG v25.18 — Error al confirmar pago por transferencia en presupuesto [RESUELTO]
- [x] Causa raíz: generateInvoiceNumber() usaba COUNT(*); si ya existía FAC-2026-0002 de operación anterior, MySQL lanzaba Duplicate entry en el UNIQUE constraint
- [x] Corregido: generateInvoiceNumber() ahora usa MAX(invoiceNumber) para obtener el número más alto y sumar 1
- [x] Mismo fix aplicado a generateQuoteNumber() de forma preventiva
- [x] Verificado: flujo completo funciona — FAC-2026-0003 generada, reserva creada, ingresos +14.52€, dashboard actualizado

## BUG v25.17 — Layout incorrecto en pantallas de Contabilidad [RESUELTO]
- [x] /admin/contabilidad/gastos: unificado con AdminLayout estándar
- [x] /admin/contabilidad/gastos/recurrentes: unificado con AdminLayout estándar
- [x] /admin/contabilidad/gastos/categorias: unificado con AdminLayout estándar
- [x] /admin/contabilidad/gastos/proveedores: unificado con AdminLayout estándar
- [x] /admin/contabilidad/cuenta-resultados: unificado con AdminLayout estándar

## BUG v25.16 — Reserva Simo Blanquez sigue sin aparecer en Calendario y Órdenes del Día [RESUELTO]
- [x] Diagnóstico completo: BD + SQL + frontend
- [x] Causa raíz: formatDate() en DailyOrders.tsx y DailyActivities.tsx usaba toISOString() que convierte a UTC, causando desfase de -1 día en España (UTC+2)
- [x] Corregido: formatDate() en DailyOrders.tsx y DailyActivities.tsx ahora usa getFullYear/getMonth/getDate (hora local)
- [x] Verificado: simulación Node.js confirma que la clave del evento "2026-03-29" coincide con la clave del mapa de la semana
- [x] CalendarView.tsx ya tenía el fix aplicado desde v25.12; DailyOrders y DailyActivities ahora también corregidos

## BUG v25.19 — Carlos Calin no aparece como cliente tras crear reserva manual [RESUELTO]
- [x] Diagnóstico: reserva existe en BD pero ningún flujo de creación de reservas llamaba a upsert de clientes
- [x] Causa raíz: TPV, Redsys IPN y conversiones de presupuesto no tenían lógica de upsert de cliente
- [x] Corregido: nuevo helper centralizado upsertClientFromReservation() en db.ts
- [x] Integrado en: TPV createSale, Redsys IPN (pago autorizado), CRM confirmPayment, CRM convertToReservation, CRM confirmTransfer
- [x] Carlos Calin creado manualmente en la BD (retroactivo)
- [x] Verificado: servidor corriendo sin errores TypeScript

## TAREA v25.20 — Investigar contabilidad con datos de prueba y resetear transacciones [RESUELTO]
- [x] Verificado: NO es un bug. Las transacciones son registros contables permanentes por diseño (no se borran en cascada con las operaciones)
- [x] Diagnosticado: 10 transacciones de ventas TPV del 24-25 marzo sumaban 558.72€
- [x] Reset completo: transactions, tpv_sales, tpv_sale_items, tpv_sale_payments, reservations, invoices, bookings, booking_monitors, daily_orders, crm_activity_log, quotes, leads, clients, reav_expedients, reav_documents, reav_costs, cash_movements
- [x] Verificado: todas las tablas a 0 registros

## BUG v25.21 — Info contextual del formulario de presupuesto no se guarda en el lead [RESUELTO]
- [x] Diagnosticado: ExperienceDetail.tsx no envíaba selectedCategory ni selectedProduct en submitLead
- [x] Corregido ExperienceDetail.tsx: ahora envía selectedCategory="Experiencias" y selectedProduct=exp.title
- [x] submitLead en routers.ts: añadidos selectedCategory y selectedProduct al schema Zod y al createLead
- [x] BudgetRequest.tsx (/presupuesto): colegios y empresas ahora cargan packs dinámicamente desde la BD
- [x] Home.tsx (hero form): colegios y empresas ahora cargan packs dinámicamente desde la BD
- [x] Añadido endpoint público packs.getTitlesByCategory para cargar títulos de packs por categoría
- [x] Verificado: servidor corriendo sin errores, HMR aplicado correctamente

## BUG v25.22 — Autogenerador de presupuesto falla con leads de Lego Packs/Packs (sin activitiesJson) [RESUELTO]
- [x] Diagnosticado: activitiesJson solo se rellena para Experiencias acuáticas; Packs/LegoPacks/Hotel/SPA/Colegios/Empresas lo dejan NULL
- [x] selectedProduct sí se guardaba correctamente en el lead (columna existe en BD)
- [x] Corregido generateFromLead: cuando activitiesJson está vacío, busca por selectedProduct en packs → legoPacks → experiences (en ese orden)
- [x] Corregido previewFromLead: misma lógica de fallback para la previsualización
- [x] Importada tabla packs en crm.ts
- [x] Verificado en vivo: Day Pass Náyade — Un día completo en el lago, 1 pax, 45.00€, IVA 21%, TOTAL 54.45€ generado correctamente

## BUG v25.23 — Scroll/Anclaje global: navegación posiciona vista en footer en lugar del header
- [x] Auditoría: revisar router (wouter), efectos de navegación, CSS global y JS que fuerce scroll
- [x] Identificar causa raíz exacta (anclas #, scrollIntoView, overflow CSS, efectos post-route)
- [x] Implementar solución global limpia de scroll-to-top en la SPA
- [x] Validar: menú, navegación interna, módulos, parámetros, anclas explícitas

## BUG v25.24 — Auditoría forense: flujos CRM→Operaciones, Contabilidad y REAV rotos
- [x] Auditoría forense completa: revisar confirmPayment, confirmTransfer, TPV, Redsys IPN
- [x] Trazabilidad caso "Rata Maravillada": identificar qué se guardó y qué faltó
- [x] BUG #1: confirmPayment usa now() como bookingDate en lugar de lead.preferredDate
- [x] BUG #2: confirmPayment no llama a createBookingFromReservation (booking operativo ausente)
- [x] BUG #3: confirmPayment y confirmTransfer no crean transacción contable en tabla transactions
- [ ] Implementar postConfirmOperation() helper en db.ts (booking + transaction + log)
- [ ] Corregir confirmPayment: usar preferredDate + llamar postConfirmOperation
- [ ] Corregir confirmTransfer: usar preferredDate + llamar postConfirmOperation
- [ ] Corregir Redsys IPN: verificar que usa bookingDate correcto + crea transaction
- [ ] Corregir cupón→reserva: verificar que llama postConfirmOperation
- [ ] Reparar datos de "Rata Maravillada": crear booking y transacción retroactivos
- [ ] Validar todos los flujos con tests Vitest

## BUG v25.24 — Auditoría forense flujos CRM → Operaciones → Contabilidad

- [x] BUG #1: confirmPayment no usaba lead.preferredDate como bookingDate (usaba today)
- [x] BUG #2: confirmPayment no creaba booking operativo en tabla bookings
- [x] BUG #3: confirmPayment no creaba transacción contable en tabla transactions
- [x] BUG #4: confirmTransfer tampoco usaba lead.preferredDate como bookingDate
- [x] BUG #5: confirmManualPayment no creaba transacción contable
- [x] BUG #6: Redsys IPN no creaba transacción contable (solo booking)
- [x] BUG #7: coupon convertToReservation no creaba booking ni transacción
- [x] Implementar helper centralizado postConfirmOperation() en db.ts (idempotente)
- [x] Reparar datos retroactivos de Rata Maravillada: booking BK-RETRO-RATA-2026 + transacción TX-RETRO-RATA-2026 + fecha 2026-07-01
- [x] 22 tests Vitest para postConfirmOperation — 270 tests totales pasando

## BUG v25.25 — Reserva Cañón Colorado: 3 bugs estructurales

- [x] BUG #1: Cliente no creado en CRM tras reserva online (upsertClientFromReservation no llamado en postConfirmOperation)
- [x] BUG #2: Booking creado en estado 'pendiente' en lugar de 'confirmado' (debe confirmarse al garantizarse el pago)
- [x] BUG #3: Calendario y Órdenes del Día no muestran bookings 'confirmado' (filtros incorrectos)
- [x] Reparar datos retroactivos de Cañón Colorado (cliente + booking status)

## FEATURE v25.26 — Date picker en módulos de Operaciones

- [x] Añadir date picker con calendario desplegable en Actividades del Día
- [x] Añadir date picker con calendario desplegable en Órdenes del Día
- [x] Añadir date picker con calendario desplegable en Calendario

## REAV Global v25.29 — Reestructuración completa

- [x] Crear helper centralizado calcularREAV() en server/reav.ts con fórmulas correctas y validación
- [x] Corregir CRM confirmPayment: reemplazar porcentajes hardcodeados por calcularREAV() con datos del producto
- [x] Corregir CRM confirmTransfer: misma corrección
- [x] Corregir CRM confirmManualPayment: misma corrección
- [x] Integrar REAV en TPV createSale: detectar líneas REAV y crear expediente
- [x] Integrar REAV en canal Online (Redsys IPN): detectar producto REAV y crear expediente
- [ ] Rehacer panel económico REAV con totales basados en margen calculado
- [ ] Tests Vitest: caso online, TPV y CRM

## Liquidaciones v25.30 — Auditoría y corrección
- [x] BUG: LIQ-2026-0001 muestra 0 líneas — la operación de Leo Grande en Wakeboardcenter no aparece
- [x] Auditar lógica de cálculo de líneas de liquidación y su conexión con bookings/reservas
- [x] Auditar coherencia del flujo CRM completo desde comisión de venta hasta liquidación
- [x] Corregir error TypeScript en suppliers.ts: import inArray faltante
- [x] Ampliar recalculate() para incluir reservas CRM (SOURCE 3) y facturas generadas/enviadas con paymentValidatedAt
- [x] Reparar datos retroactivos de Leo Grande (FAC-2026-0004): productId=30003, reservationId=480001, status=cobrada
- [x] Reparar datos retroactivos de reserva 480001: product_id=30003, invoiceId=300001
- [x] Sección "Líneas del pedido" en modal de detalle de reserva ya existía — ahora funciona al estar la factura vinculada
- [x] 284 tests Vitest pasando — 0 errores TypeScript

## Auditoría estructural v25.31 — Trazabilidad completa ventas → liquidaciones

- [x] Auditar flujo CRM confirmPayment: factura sin reservationId y productId:0 en reserva
- [x] Auditar flujo CRM confirmTransfer: mismo bug
- [x] Auditar flujo TPV createSale: correcto, productId del item principal en reserva + extrasJson
- [x] Auditar flujo Online Redsys IPN: factura sin reservationId y status generada en lugar de cobrada
- [x] Corregir flujo CRM confirmPayment: factura vinculada a reserva (reservationId), reserva vinculada a factura (invoiceId+invoiceNumber), productId correcto desde presupuesto
- [x] Corregir flujo CRM confirmTransfer: mismas correcciones
- [x] Corregir flujo Redsys IPN: factura con reservationId desde el inicio, status=cobrada, reserva actualizada con invoiceId+invoiceNumber+productId
- [x] Corregir packs y legoPacks en presupuestos: añadir productId en itemsJson (ambos bloques de generación)
- [x] Corregir postConfirmOperation en confirmPayment y confirmTransfer: usar mainProductId en lugar de lead.experienceId
- [x] Tests Vitest: 17 nuevos tests de trazabilidad en traceability.test.ts
- [x] 301 tests Vitest pasando — 0 errores TypeScript

## Numeración correlativa centralizada v25.32

- [x] Auditar funciones generateXxxNumber() en crm.ts, tpv.ts, redsysRoutes.ts, suppliers.ts
- [x] Crear tablas document_counters y document_number_logs en schema.ts + migración SQL
- [x] Sembrar contadores con valores reales actuales (FAC=4, LIQ=1, PRES=1)
- [x] Crear helper centralizado generateDocumentNumber() en server/documentNumbers.ts con mutex por tipo/año
- [x] Reemplazar generateInvoiceNumber/generateQuoteNumber en crm.ts
- [x] Reemplazar generateSettlementNumber en suppliers.ts
- [x] Reemplazar generateTicketNumber/generateReservationRef en tpv.ts (ahora async)
- [x] Reemplazar ad-hoc FAC-date-rand en redsysRoutes.ts
- [x] Añadir router documentNumbers en routers.ts (getCounters, updatePrefix, resetCounter, getLogs)
- [x] Crear panel admin /admin/numeracion con tabla de contadores, edición de prefijos y reset manual
- [x] Añadir enlace 'Series Numer.' en sidebar DashboardLayout
- [x] 16 tests Vitest para el sistema de numeración en documentNumbers.test.ts
- [x] 317 tests Vitest pasando — 0 errores TypeScript

## Fase 1 — Propagación completa de anulaciones v25.33

- [ ] approveRefund: actualizar reservations.status a "cancelled"
- [ ] approveRefund: crear transacción de devolución en transactions (importe negativo)
- [ ] approveRefund: actualizar reservation_operational.opStatus a "anulado"
- [ ] approveRefund: cerrar expediente REAV si existe (fiscalStatus="anulado")
- [ ] approveRefund: generar número ANU- y guardarlo en cancellationRequests
- [ ] approveVoucher: mismos pasos de cancelación/operaciones/REAV (bono no es devolución monetaria)
- [ ] approveVoucher: registrar bono en coupon_redemptions para que sea canjeable
- [ ] Tests Vitest para propagación de anulaciones

## Fase 1 — Propagación completa de anulaciones (Crítico) v25.33

- [x] Auditar cancellations.ts, schema y módulos relacionados
- [x] Añadir 'anulado' al enum opStatus de reservation_operational (migración aplicada)
- [x] Añadir columna cancellationNumber a cancellation_requests (migración aplicada)
- [x] Implementar propagateCancellation() en cancellations.ts: cancela reserva, actualiza opStatus, cierra REAV, crea transacción devolución, genera número ANU-
- [x] Integrar propagación en acceptRequest (devolución y bono) — ambas ramas cubiertas
- [x] Añadir procedure getImpact para preview antes de aprobar
- [x] 18 nuevos tests Vitest en cancellations.propagation.test.ts
- [x] 335 tests Vitest pasando — 0 errores TypeScript

## Fase 4 — confirmManualPayment: REAV y PDF (paridad de canales) v25.34

- [x] Auditar confirmPayment y confirmTransfer: PDF + REAV + adjuntar documentos + postConfirmOperation
- [x] Auditar confirmManualPayment: faltaban PDF y REAV; postConfirmOperation ya existía pero sin fiscalRegime
- [x] Implementar generateInvoicePdf en confirmManualPayment (solo si no existe ya, evita regeneración)
- [x] Implementar createReavExpedient en confirmManualPayment (solo si no existe ya, evita duplicados)
- [x] Adjuntar factura PDF y presupuesto PDF al expediente REAV
- [x] Corregir postConfirmOperation: añadir taxBase, taxAmount, reavMargin y fiscalRegime correctos
- [x] 14 nuevos tests Vitest en confirmManualPayment.parity.test.ts
- [x] 348 tests Vitest pasando — 0 errores TypeScript

## Fase 2 — TPV en Operaciones (Crítico) v25.35

- [x] Auditar createSale en tpv.ts: datos disponibles, estructura de items y fecha de actividad
- [x] Añadir import postConfirmOperation a tpv.ts
- [x] Implementar postConfirmOperation en createSale (paso 8b, entre REAV y email, envuelto en try/catch)
- [x] Mapeo correcto de paymentMethod: cash → efectivo, card/bizum/other → otro
- [x] Mapeo correcto de fiscalRegime: iva_only → general_21, reav_only → reav, mixed → mixed
- [x] serviceDate = mainItem.eventDate ?? hoy (igual que bloque REAV)
- [x] people = suma de participants de todos los items
- [x] 18 nuevos tests Vitest en tpv.operations.test.ts
- [x] 366 tests Vitest pasando — 0 errores TypeScript

## Fase 5 — Bono compensatorio canjeable v25.36

- [x] Auditar schema discount_codes: solo tenía discountPercent, faltaba soporte para importe fijo
- [x] Añadir columnas discountType, discountAmount, origin, compensationVoucherId, clientEmail, clientName a discount_codes
- [x] Migración SQL aplicada (0031_familiar_dorian_gray.sql)
- [x] Implementar creación de discount_code tipo 'fixed' al aprobar bono compensatorio
- [x] Mismo código BONO-XXXX-XXXX en compensation_vouchers y discount_codes (uso único, maxUses=1)
- [x] Email al cliente ya existía y ya incluye el código canjeable
- [x] 20 nuevos tests Vitest en voucher.discountcode.test.ts
- [x] 386 tests Vitest pasando — 0 errores TypeScript

## Fase 6 — PDF en producción (reemplazar execSync) v25.37

- [x] Auditar: 3 puntos con execSync(manus-md-to-pdf) en crm.ts (facturas + presupuestos) y suppliers.ts (liquidaciones)
- [x] Instalar puppeteer-core + verificar Chromium del sistema (/usr/bin/chromium-browser v128)
- [x] Crear helper centralizado htmlToPdf() en server/pdfGenerator.ts con singleton de browser y reutilización
- [x] Reemplazar execSync en generateInvoicePdf() en crm.ts
- [x] Reemplazar execSync en bloque de generación de presupuesto PDF en crm.ts
- [x] Reemplazar execSync en generateSettlementPdfAndUpload() en suppliers.ts
- [x] 0 usos de execSync/manus-md-to-pdf restantes en el proyecto
- [x] 29 nuevos tests Vitest en pdfGenerator.test.ts
- [x] 415 tests Vitest pasando — 0 errores TypeScript

## Fase 7 — Plataformas externas en liquidaciones (SOURCE 4) v25.38

- [x] Auditar schema platform_settlements, couponRedemptions, platformProducts y recalculate()
- [x] Añadir imports platformSettlements, platforms, platformProducts, couponRedemptions a suppliers.ts
- [x] Implementar SOURCE 4 dentro del bloque if(productIds.length>0): busca liquidaciones pagadas en periodo
- [x] Resolución de productId: productRealId directo o via platformProductId.experienceId
- [x] Importe: realAmount del cupón o netPrice del platform_product como fallback
- [x] Nombre de línea: '[Cupón Groupon GRP-ABC123] Nombre producto'
- [x] 12 nuevos tests Vitest en suppliers.source4.test.ts
- [x] 428 tests Vitest pasando — 0 errores TypeScript

## Fase 8 — Limpieza tabla bookings v25.39

- [ ] Auditar schema bookings y reservation_operational: columnas, tipos, índices
- [ ] Auditar escritores: qué funciones insertan en bookings vs reservation_operational
- [ ] Auditar lectores: qué queries/procedures leen de bookings vs reservation_operational
- [ ] Decidir y documentar: fuente de verdad o eliminación
- [ ] Ejecutar la limpieza según la decisión
- [ ] Tests Vitest y checkpoint

## Fase 8 — Limpieza tabla bookings v25.39

- [x] Auditar: bookings tiene 4 filas, reservation_operational tiene 4 filas, 3 con datos reales
- [x] Auditar escritores: createBookingFromReservation importado pero NUNCA llamado; postConfirmOperation es el único escritor activo de reservation_operational
- [x] Auditar lectores: calendar/dailyOrders usan reservation_operational; BookingsList.tsx y KPIs del dashboard usan bookings
- [x] Decisión: reservation_operational es la fuente de verdad; bookings es legacy sin escritores activos
- [x] Migrar KPIs del dashboard (bookingsThisMonth, bookingsPending, bookingsConfirmed) a reservations
- [x] Migrar funnel (fBookingsCompleted) a reservationOperational
- [x] Migrar todayBookings y upcomingBookings a reservations (con merchantOrder como bookingNumber)
- [x] Migrar bookings.getAll procedure a reservations + reservation_operational (con mapeo de status legacy)
- [x] Tabla bookings mantenida en BD (datos históricos) pero sin escritores activos
- [x] 428 tests Vitest pasando — 0 errores TypeScript

## Suite de Tests de Regresión Integral v25.40

- [x] Auditar cobertura actual: mapear flujos críticos con tests vs sin tests
- [x] Tests postConfirmOperation canal CRM confirmPayment: booking + transacción + cliente + reservation_operational
- [x] Tests postConfirmOperation canal CRM confirmTransfer: mismos 4 artefactos
- [x] Tests postConfirmOperation canal Redsys IPN: mismos 4 artefactos
- [x] Tests postConfirmOperation canal Ticketing convertToReservation: mismos 4 artefactos
- [x] Tests recalculate canal CRM (facturas vinculadas a reservas): líneas correctas con importes
- [x] Tests recalculate canal TPV (tpv_sales): líneas correctas con importes
- [x] Tests recalculate canal online (platform_settlements): líneas correctas con importes
- [x] Tests módulo anulaciones: reserva cancelada no aparece en calendar/liquidaciones, transacción devolución signo negativo
- [x] Tests emailTemplates: confirmación reserva, presupuesto, ticket TPV, canje cupón, anulación
- [x] Tests documentNumbers mutex: no duplicados bajo concurrencia paralela
- [x] Tests schema reservations/invoices: flujos confirmación 4 canales con datos correctos
- [x] Ejecutar suite completa: 565 tests pasando (30 archivos)
- [x] Checkpoint v25.40

## Autocomplete de Productos en Editar Presupuesto (v25.46)
- [x] Procedimiento tRPC crm.catalog.search que busca en experiences, packs y legoPacks
- [x] Componente ProductAutocompleteInput con dropdown de resultados en tiempo real
- [x] Al seleccionar producto: rellena automáticamente descripción, precio unitario y régimen fiscal
- [x] Etiquetas de tipo (Actividad / Pack / Lego Pack) con colores diferenciados en el dropdown
- [x] Cierre del dropdown al hacer clic fuera del campo
