# Diseño: idioma principal configurable por empresa (16/11/2026)

Estado: **diseño, sin implementar**. Depende de las redirecciones 301 (PR #849, ya implementadas) y de una prueba contra MySQL real que no se puede hacer a ciegas.

## Situación actual (verificada en el código y en Quantum Soulrise)

- El idioma principal es la fila `site_locales.is_default = 1`. Hoy solo se crea al añadir el primer idioma extra (`server/i18nService.ts`, `addLocale`) y **siempre es `es`**. No existe ninguna operación para cambiarlo.
- El contenido base no tiene columna de idioma. Vive en `static_pages` (título, meta, slug), en los bloques de página (`pageBlocks`, con claves de borrador y de versión), en `menu_items` y en ajustes. Las traducciones cuelgan aparte: `page_translations` (borrador y publicado, `base_hash`) y `content_translations` (menús, ajustes, formularios, productos).
- Quantum Soulrise: principal `es` validado; `de` y `en` en borrador. Las 18 páginas base están en español; existe al menos una traducción `de` en borrador (`inicio` → `startseite`). Los productos del catálogo ya están escritos en alemán como contenido base.
- El enrutado, `hreflang`, `x-default`, el sitemap y los prefijos leen `defaultLocale` de la configuración: no hay un `es` literal ahí. Sí hay `es` fijo en: `DEFAULT_LOCALE` (shared/i18n.ts), `<html lang="es">` (client/index.html), el respaldo de `useSiteLocale.ts`, `TenantTheme.tsx` (un aviso), el importador de Studio y las plantillas de correo.

## Por qué no basta con cambiar `is_default`

Cambiar solo esa fila haría que el contenido en español se sirviera como alemán: `lang`, `hreflang` y canónicas incorrectos, traducciones desalineadas (`base_hash`) y slugs en el idioma equivocado. El cambio real es un **intercambio de papeles** entre el contenido base y la traducción del nuevo principal.

## Operación propuesta: `cms.i18nSetDefaultLocale`

Dos pasos, siempre explícitos y con vuelta atrás.

1. **Plan (solo lectura)**: para el idioma destino calcula y muestra, por página y por entidad, qué se intercambiaría y qué lo impide. Condiciones para poder aplicar:
   - el idioma destino existe y está **validado** (lo valida una persona, nunca automático);
   - **toda** página publicada tiene traducción **validada** en el idioma destino (si falta una, se lista y no se aplica);
   - los menús y los ajustes traducibles tienen traducción validada (o se acepta explícitamente el respaldo);
   - no hay colisiones de slug entre el base actual y las traducciones del destino.
2. **Aplicar (transacción única + copia previa)**:
   - para cada página: se intercambian título, metadatos, slug y bloques (borrador y publicado) entre `static_pages`/`pageBlocks` y la fila `page_translations` del destino; el principal anterior queda como traducción validada y `base_hash` se recalcula;
   - igual para `menu_items` y `content_translations` (menú, ajustes, formularios, productos);
   - `site_locales`: el destino pasa a `is_default = 1` y el anterior a idioma extra validado;
   - cada slug que cambia crea su **301** con el gestor de redirecciones (`redirectOnRename`), sin cadenas;
   - se invalidan las cachés de i18n, de redirecciones y de sitemap;
   - se registra en la auditoría quién y cuándo.
3. **Vuelta atrás**: la operación inversa (intercambio simétrico) más la copia previa de las filas afectadas.

Además, antes o junto con la operación: quitar el `es` literal de `<html lang>`, del respaldo del cliente y del importador, y dejar que cada empresa elija su idioma base **al crearla** (sin intercambio, porque aún no tiene contenido que mover).

## Pruebas necesarias (MySQL real, CI)

Intercambio ida y vuelta sin pérdida; empresa A y B aisladas; páginas sin traducción validada bloquean la aplicación; `hreflang`/`x-default`/sitemap/canónicas tras el cambio; 301 de cada slug anterior; formularios y catálogo intactos; empresas monolingües sin ningún cambio.

## Quantum Soulrise

El alemán solo puede ser principal cuando estén **validadas por una persona** las traducciones alemanas de todas las páginas publicadas (hoy hay un borrador). No se publica ninguna traducción pendiente de validación. Español e inglés quedarían como secundarios y el francés, desactivado.

## Lo que no entra en esta función

Los textos de interfaz embebidos en español (carrito, reservas) y las plantillas de correo no tienen capa de idioma: un principal no español no los traduce. Es un trabajo aparte y mayor.
