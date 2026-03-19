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
