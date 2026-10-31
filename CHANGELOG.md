# Registro de cambios de Elephant Core

Todos los cambios relevantes de Elephant Core se anotan aquí, con el formato
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## Reglas de versión

- La versión publicada vive en un único sitio: `shared/version.ts` (`CORE_VERSION` y
  `CORE_RELEASED_AT`). `package.json` no es la fuente.
- **PATCH** (`1.0.x`): correcciones sin funciones nuevas ni cambios de base de datos.
- **MINOR** (`1.x.0`): funciones nuevas o migraciones aditivas (tablas o columnas nuevas que no rompen
  nada de lo existente).
- **MAJOR** (`x.0.0`): una migración no aditiva (borrar o cambiar columnas o datos existentes) o un
  cambio que rompe el `coreRange` de los módulos (un módulo que declara `^1.0.0` deja de ser compatible).
- Cada versión publicada se etiqueta como `core-vX.Y.Z` sobre el commit desplegado, con
  `node scripts/release/etiquetar-core.mjs <sha>`, que comprueba que este fichero tiene la sección de esa
  versión con la misma fecha que `CORE_RELEASED_AT`.
- Mientras se trabaja, los cambios se anotan en `[Sin publicar]`; al publicar, esa sección pasa a ser la
  de la nueva versión.

## [Sin publicar]

### Añadido

- Versión de Elephant Core visible en el panel de la empresa (Centro de ayuda → «Acerca de Elephant
  Core»), con su fecha; los administradores ven además el commit desplegado.
- Etiquetado de versiones `core-vX.Y.Z` con comprobación del registro de cambios.

### Cambiado

- La web pública de cada empresa sirve su nombre y descripción como título de la portada.
- El mapa del sitio de cada empresa solo incluye lo que tiene publicado y contratado: portada,
  contacto, sus páginas, su blog y, con su módulo, las secciones sectoriales.

### Corregido

- Las direcciones que no existen en la web pública responden «no encontrada» (404) en lugar de 200.

### Migraciones

- Ninguna.

### Compatibilidad de módulos

- Sin cambios: los módulos que declaran `coreRange ^1.0.0` siguen siendo compatibles.

## [1.0.0] - 2026-10-31

Primera versión estable de Elephant Core (commit `af76033c`).

- Plataforma multiempresa: cada empresa con su base de datos, su dominio y sus licencias por capacidad.
- Panel de la empresa con CRM, catálogo, pedidos, facturación, caja, CMS con blog y web pública.
- Módulos con manifiesto y `coreRange` (`cms`, `commerce`, `tpv`, `hotel`, `spa`, `restaurants` y
  `ski_rental`).
- Migraciones de empresa `0001` a `0017` sobre la baseline.
