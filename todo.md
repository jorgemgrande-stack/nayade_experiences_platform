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
