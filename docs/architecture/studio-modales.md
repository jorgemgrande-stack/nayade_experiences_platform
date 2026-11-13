# Elephant Studio: ventanas emergentes (modales)

Módulo `modal` del constructor de la web. Sirve para cualquier empresa: no hay textos, identificadores ni lógica de ningún cliente. No necesita migración: es un bloque más del JSON de la página (`page_blocks.data`).

## Qué hace
- **Un bloque de primer nivel** («Ventana emergente», familia Estructura) con título, imagen opcional, tamaño (pequeño, medio, grande), alineación, cierres configurables y **módulos de dentro**: texto, imagen, botón, tarjetas, columnas, formulario a medida, formulario de contacto, secciones con columnas… Se editan en el lienzo como las columnas de una sección (arrastrar, duplicar, deshacer).
- **Sin recursión**: una ventana solo va a nivel de página (`NOT_NESTABLE`); nunca dentro de columnas ni de otra ventana, y no admite cabeceras ni presentaciones de ancho completo. El servidor lo rechaza y el editor no lo permite.
- **El formulario de dentro es el bloque `form` / `contact_form` de siempre** (misma validación, antispam y envío al CRM). No se duplica lógica; las mejoras de formularios (E-7) llegan solas.

## Cómo se abre (activadores, sin código)
1. **Botón, tarjeta, CTA, cabecera o enlace del texto**: en «A dónde lleva» se elige «Abrir la ventana “Nombre”» (el selector lista las ventanas de la página por su título). Por debajo es la dirección `#modal-<identificador>`: no hace falta ningún campo nuevo en cada módulo.
2. **Enlace directo**: `https://tu-web/pagina#modal-<identificador>` abre la ventana al cargar. «Atrás» la cierra. Al cerrarla se quita la dirección.
3. **Apertura automática (desactivada por defecto)**: «Al cargar la página» (tras 3-30 s) o «Al intentar salir» (solo con ratón; no existe en móvil). Reglas anti-abuso, no configurables: una sola vez por visita (sessionStorage), solo cuando la persona ya ha decidido sobre las cookies (nunca tapa ni se apila con el aviso), nunca encima de otra ventana, nunca en el editor ni en la vista previa, y el botón de cerrar es siempre accesible. «No volver a mostrar» (casilla opcional) se guarda en `localStorage` **solo si la persona la marca**, durante 7-365 días.

## Accesibilidad
Diálogo de Radix (`role="dialog"`, `aria-modal`, `aria-labelledby` con el título, foco atrapado y devuelto al disparador, Esc, resto de la página oculto a lectores de pantalla, fondo sin scroll). Animación solo si no hay `prefers-reduced-motion`. Botón de cerrar de 44 px. Una ventana nunca queda sin salida: si no se cierra al pulsar fuera, el botón de cerrar se mantiene aunque se desactive (`modalClosing`). Pulsar el aviso de cookies no la cierra.

## SEO e indexado (decisión)
La web de Studio es una SPA: el servidor solo inyecta metadatos y el contenido lo pinta el navegador. Decisión: **el contenido de la ventana solo está en el DOM mientras está abierta** (no se cargan vídeos ni formularios ocultos, no hay formularios duplicados ni terceros antes de tiempo), y **su texto sí va en el resumen HTML de la página** (`blocksToHtml`, columna `static_pages.content`) para buscadores internos, mapa del sitio y búsqueda del panel. Un rastreador que ejecute JS verá la página sin el contenido de la ventana cerrada; no hay URL propia por ventana (el `#modal-…` no se indexa). Si hace falta contenido indexable, ponerlo en la página y enlazarlo desde la ventana.

## Seguridad
Sin HTML crudo ni scripts: todos los campos pasan por el esquema (`normalizeBySchema`), el texto con formato por la lista blanca (`sanitizeRichHtml`), los enlaces por `safeLink` y las imágenes por `safeImage`. El identificador es `^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$` y único por página (el servidor corrige duplicados con `-2`, `-3`…). Sin analítica ni scripts de terceros.

## Traducción (E-1)
Todos los textos (título, texto de cerrar, «no volver a mostrar», módulos de dentro) son campos del bloque; ninguna cadena visible está en el código del componente. E-1 puede traducirlos como el resto de campos de texto. El identificador del enlace no se traduce.

## Límites conocidos
Las ventanas de otra página no aparecen en el selector (se enlaza con `/pagina#modal-id` a mano). Los módulos de dentro cuentan para el límite de 60 bloques por página. Sin apertura al hacer scroll ni por tiempo de inactividad (a propósito).

## Ficheros
`shared/studio/modal.ts` (reglas), `shared/pageBlocks.ts` (tipo, plantilla «Fichas en ventana»), `shared/studio/modules.ts` (esquema), `server/_core/pageBlocks.ts` (saneado), `client/src/components/site/ModalBlock.tsx` y `PageBlocksView.tsx` (pintado), `client/src/pages/admin/studio/StudioPage.tsx` (selector del disparador). Pruebas: `server/studioModal.test.ts`, `server/studioModal.render.test.ts`.
