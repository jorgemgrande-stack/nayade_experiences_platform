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
