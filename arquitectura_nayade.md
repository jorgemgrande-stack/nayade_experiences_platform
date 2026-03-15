# Documento de Arquitectura y Especificaciones: Plataforma Nayade Experiences

**Autor:** Manus AI
**Fecha:** 15 de marzo de 2026
**Versión:** 0.1 (Borrador Inicial)

---

## 1. Resumen Ejecutivo

Este documento define la arquitectura técnica y las especificaciones funcionales para el desarrollo de la nueva plataforma digital de **Nayade Experiences**. El proyecto tiene como objetivo consolidar la presencia online de la marca, comenzando con un sitio web público de alto impacto visual (`www.nayadeexperiences.es`) y soportado por un robusto panel de administración interno que abarca la gestión integral del negocio: contenidos, productos de ecommerce, presupuestos, operaciones y contabilidad. 

La solución propuesta se basa en un stack tecnológico moderno (Vite, React, TypeScript, TailwindCSS) y se integrará con **GoHighLevel** para potenciar los flujos de trabajo de automatización y CRM. La arquitectura está diseñada para ser modular, escalable y fácil de gestionar por el equipo de Nayade Experiences.

## 2. Arquitectura Tecnológica (Stack Propuesto)

Para cumplir con los requisitos de un portal de ecommerce dinámico, gestión de usuarios (administradores, monitores) y una base de datos centralizada, se propone la utilización de un andamiaje de aplicación web completa.

| Componente          | Tecnología Propuesta        | Justificación                                                                 |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| **Frontend**        | Vite + React + TypeScript   | Desarrollo rápido, alto rendimiento y seguridad de tipos para el código.      |
| **Estilos CSS**     | TailwindCSS                 | Framework utility-first para un diseño visual rápido, consistente y adaptable. |
| **Backend**         | Node.js con Drizzle ORM     | Ecosistema JavaScript unificado, con un ORM moderno para la interacción con la BD. |
| **Base de Datos**   | MySQL / TiDB                | Solución de base de datos relacional, robusta y estándar en la industria.     |
| **Autenticación**   | Manus-Oauth (integrado)     | Gestión segura de usuarios y roles para el panel de administración.           |
| **Automatización**  | GoHighLevel (integración)   | Conexión vía API para workflows de CRM, envío de correos y seguimiento de leads. |

## 3. Arquitectura de la Información (Frontend Público)

La navegación principal del sitio público seguirá la visión del cliente para un descubrimiento de experiencias claro e intuitivo.

### 3.1. Mapa del Sitio

- **/ (Home):** Página de inicio con slideshow, productos destacados y CTAs principales.
- **/ubicacion/{slug}:** Página de destino para una ubicación específica, mostrando las categorías de experiencias disponibles allí.
- **/experiencias/{categoria-slug}:** Listado de todas las experiencias dentro de una categoría.
- **/experiencia/{producto-slug}:** Ficha de detalle de una experiencia específica, con descripción, fotos, variables y botón de compra.
- **/presupuesto:** Formulario para solicitar presupuestos a medida.
- **/contacto:** Información de contacto y formulario general.
- **/galeria:** Mosaico visual de imágenes de las experiencias.

## 4. Especificaciones Funcionales (Panel de Administración)

El backend se estructurará en los cinco módulos funcionales clave solicitados.

### 4.1. Módulo 1: Gestor de Contenidos Web (CMS)
- Gestión del slideshow de la home (subir, ordenar, eliminar imágenes).
- Editor de menús y submenús del header y footer.
- Selección y ordenación de productos destacados en la home.
- Gestor de medios para subir y administrar imágenes y videos.
- Edición de páginas estáticas (ej. 'Sobre nosotros', 'Política de privacidad').

### 4.2. Módulo 2: Gestor de Productos (E-commerce)
- Creación y edición de categorías de experiencias.
- Creación y edición de productos (experiencias) con:
  - Título, descripción, galería de imágenes/videos.
  - Definición de variables (ej. 'Duración', 'Nº de personas') con impacto en el precio.
  - Asignación de precios base y por variables.
  - Botones de compra / reserva.

### 4.3. Módulo 3: Módulo de Presupuestos
- Recepción de leads desde el formulario público.
- Interfaz para que los agentes respondan a los leads.
- Creación de presupuestos personalizados con desglose de servicios.
- Generación de enlaces de pago únicos para cada presupuesto.
- Integración con GoHighLevel para el envío automatizado de correos con los presupuestos y recordatorios.

### 4.4. Módulo 4: Módulo de Calendarización y Operaciones
- Vista de calendario con todas las actividades contratadas.
- Generación automática de "Órdenes del Día" para el equipo de operaciones.
- Capacidad de asignar monitores o guías específicos a cada actividad programada.
- Notificaciones automáticas a los monitores sobre sus asignaciones.

### 4.5. Módulo 5: Módulo de Contabilidad e Informes
- Dashboard con métricas clave: ventas totales, experiencias más vendidas, ingresos por período.
- Generación de informes de ventas (diario, semanal, mensual) en formato exportable (CSV, Excel).
- Informe de comisiones por monitor o agente (si aplica).
- Registro de transacciones y estados de pago.

## 5. Próximos Pasos

1.  **Inicialización del Proyecto:** Creación de la estructura de carpetas y configuración inicial del entorno de desarrollo con el andamiaje `web-db-user`.
2.  **Diseño de la Base de Datos:** Modelado de las tablas necesarias para soportar los módulos descritos.
3.  **Desarrollo del Frontend:** Maquetación de las principales páginas públicas.
4.  **Desarrollo del Backend:** Implementación de la API y la lógica de negocio para cada módulo.

---

*Este es un documento vivo y se actualizará a medida que el proyecto evolucione.*
