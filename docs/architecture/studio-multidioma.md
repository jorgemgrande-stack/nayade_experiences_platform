# Elephant Studio: multidioma nativo (épica E-1)

Estado: diseño (fase 0), publicado antes de implementar para que E-3 (importación) y E-2 (modales) alineen sus campos.
Alcance: reutilizable por cualquier empresa (tenant). Nada de este documento es específico de un cliente.

## 1. Principios

1. **Un solo idioma por defecto = comportamiento actual intacto.** Una empresa sin idiomas adicionales no tiene filas nuevas, sus URLs no cambian y no aparece ningún 404 nuevo. Todo se activa al añadir un idioma.
2. **Nada se traduce solo.** No hay traducción automática. El texto de cada idioma lo escribe o pega una persona.
3. **Nada se publica sin validación humana.** Un idioma (y cada traducción de página) tiene estado `draft | validated`; solo lo `validated` se sirve y se indexa. Validar es una acción explícita de un administrador, con autor y fecha.
4. **Nunca se mezcla en silencio.** Si falta la traducción, la configuración decide entre ocultar la página en ese idioma o mostrar la del idioma principal, y en ese segundo caso la respuesta lo declara (`lang` del principal, `canonical` al original, `noindex`).
5. **Aislamiento.** Todo vive en la base de datos de cada empresa. Ninguna caché ni clave se comparte entre empresas.
6. **Cambios mínimos en lo existente.** Las tablas `static_pages`, `page_blocks`, `menu_items` y las versiones de página no se modifican. Todo lo nuevo es aditivo.

## 2. Decisión de modelo de datos

Opciones evaluadas:

| Opción | Pros | Contras |
|---|---|---|
| A. Columna `locale` en `static_pages` y `page_blocks` | Simple de leer | Rompe el índice único de `slug`, el prefijo `borrador:`/`version:` de `page_blocks.pageSlug`, el historial y todas las consultas existentes. Alto riesgo. |
| B. Campo JSON por idioma dentro de cada fila | Sin tablas nuevas | Filas enormes, sin índices por idioma/slug, sin estado por idioma consultable. |
| **C. Tablas de traducción aparte, claves por entidad (elegida)** | No toca nada existente; índice único `(locale, slug)`; estado por idioma consultable; migración aditiva y reversible | Una consulta más al servir un idioma distinto del principal |

**Elegida: C.** El idioma principal sigue estando en las tablas actuales (`static_pages`, `page_blocks`, `menu_items`, `experiences`, `system_settings`); las traducciones, en tablas nuevas. El principal no se duplica ni se migra.

### 2.1 Tablas (migración aditiva; la numeración final se fija al rebasar, ver §9)

**`site_locales`**: idiomas de la empresa.

| Columna | Tipo | Nota |
|---|---|---|
| `locale` | VARCHAR(35) PK | BCP 47 en minúsculas: `es`, `de`, `en`, `fr`, `pt-br`… |
| `is_default` | TINYINT(1) | Exactamente uno. Tabla vacía = principal implícito `es`, validado. |
| `status` | VARCHAR(16) | `draft` (preparado, no visible) o `validated` (visible en la web pública). |
| `sort_order` | INT | Orden en el selector. |
| `validated_at`, `validated_by` | DATETIME, VARCHAR(190) | Quién y cuándo. |
| `created_at`, `updated_at` | | |

**`page_translations`**: una fila por página y idioma.

| Columna | Tipo | Nota |
|---|---|---|
| `id` | INT PK | |
| `page_id` | INT | `static_pages.id`. Estable al renombrar el slug del principal. |
| `locale` | VARCHAR(35) | |
| `slug` | VARCHAR(190) | Slug localizado (`sobre-nosotros` → `ueber-uns`). Único por idioma. La portada usa slug vacío. |
| `title`, `meta_title`, `meta_description`, `og_image_url` | | Metadatos SEO y OG por idioma. |
| `draft_blocks` | JSON NULL | Lista completa de bloques en edición (misma validación que el principal). |
| `published_blocks` | JSON NULL | Lo que se sirve cuando `status = validated`. |
| `status` | VARCHAR(16) | `draft` o `validated`. |
| `base_hash` | VARCHAR(64) | Huella del contenido publicado del principal al guardar; permite avisar «el principal ha cambiado». |
| `validated_at`, `validated_by`, `created_at`, `updated_at` | | |

Índices únicos: `(page_id, locale)` y `(locale, slug)`.

**`content_translations`**: traducciones genéricas de campos de otras entidades (menús, ajustes globales, formularios, productos).

| Columna | Tipo | Nota |
|---|---|---|
| `entity_type` | VARCHAR(24) | `menu_item`, `setting`, `form`, `product` (ampliable). |
| `entity_key` | VARCHAR(190) | `menu_items.id`, clave de `system_settings`, `<pageId>:<blockId>` de un formulario, `experiences.id`… |
| `locale` | VARCHAR(35) | |
| `fields` | JSON | Solo campos de la lista blanca de cada tipo (ver §6.3). Texto plano. |
| `slug` | VARCHAR(190) NULL | Solo productos (URL localizada). Único por `(entity_type, locale, slug)`. |
| `status`, `validated_at`, `validated_by`, `created_at`, `updated_at` | | |

Índice único `(entity_type, entity_key, locale)`.

**Configuración** (en `system_settings`, sin columnas nuevas):

| Clave | Valores | Defecto | Efecto |
|---|---|---|---|
| `i18n_default_prefix` | `0` / `1` | `0` | `0`: el principal va sin prefijo (URLs actuales). `1`: el principal también lleva prefijo (`/es/…`) y la URL sin prefijo redirige 301. |
| `i18n_fallback` | `hide` / `default` | `hide` | Sin traducción validada: 404 en ese idioma, o mostrar el principal declarándolo. |
| `i18n_negotiate` | `0` / `1` | `0` | Sugerir/redirigir por `Accept-Language` solo si está activado. |

### 2.2 Por qué bloques completos por idioma (y no solo campos)

La traducción guarda la **lista de bloques completa** del idioma, no un parche campo a campo sobre el principal:
- las versiones de página existentes y el editor de bloques se reutilizan tal cual (misma normalización y saneado que el principal);
- un idioma puede reorganizar bloques (una sección que solo existe en alemán) sin romper el principal;
- «copiar desde el principal» clona los bloques con los **mismos `id`**; eso permite calcular qué campos de texto siguen idénticos al principal (= «sin traducir») sin traducir nada.

Coste: si el principal cambia de estructura, la traducción no sigue sola; por eso `base_hash` y el aviso «el principal ha cambiado desde esta traducción». Es una decisión consciente: ningún cambio del principal altera lo que se sirve en otro idioma sin que una persona lo revise.

### 2.3 Qué queda fuera del esquema de página

El historial de versiones de las traducciones **no** se implementa en esta épica (solo `draft_blocks` y `published_blocks`). Se documenta como mejora posterior; el principal conserva su historial de 30 versiones.

## 3. Estados

```
Idioma (site_locales.status):         draft  ──validar──▶  validated  ──retirar──▶  draft
Traducción de página (page_translations.status): igual, por página e idioma
```

- Se sirve una página en `/<locale>/…` solo si **el idioma está `validated` y la traducción de esa página está `validated`**. Dos candados.
- Editar una traducción ya validada escribe en `draft_blocks`; lo publicado sigue sirviéndose hasta que una persona vuelve a validar (que copia `draft_blocks` a `published_blocks`).
- Retirar una traducción la pasa a `draft` sin borrar contenido.
- El idioma principal siempre se publica con el flujo actual de Studio (borrador/publicar); no usa estos estados.
- Quién puede validar: administradores de la empresa (mismo permiso que publicar una página).
- Importación (E-3): cualquier contenido importado con `locale` entra **siempre como `draft`**; E-3 nunca valida.

## 4. URLs

- Prefijo por idioma: `/<locale>/<slug-localizado>`. Portada: `/<locale>`.
- Idioma principal **sin prefijo por defecto** (`i18n_default_prefix = 0`): las URLs actuales no cambian. Con `1`, el principal lleva `/es/` y la ruta sin prefijo responde 301 al prefijo (opción para sitios nuevos; en sitios existentes es un cambio de URLs que la empresa decide).
- Con prefijo por defecto, `/es/pagina` (prefijo del principal) responde 301 a `/pagina` para tener una única URL canónica.
- Slugs traducibles por idioma, únicos dentro del idioma. Si el slug localizado está vacío al guardar, se usa el del principal.
- Se reconoce un prefijo solo si es un idioma **configurado** de la empresa; si no, la ruta se trata como hoy (`/de/x` en una empresa sin alemán es un 404 igual que ahora). Así un slug existente con la forma de un código de idioma (`/en` como página propia) no se rompe: gana la página existente mientras no se active ese idioma, y al activarlo la herramienta avisa del conflicto y lo rechaza.
- Rutas que NO se localizan: `/admin…`, `/api…`, `/login`, `/checkout`, `/reserva…`, recursos estáticos, `/sitemap.xml`, `/robots.txt`. Las rutas de aplicación (tienda, blog, hotel…) se localizan en la fase de contenido comercial; hasta entonces solo se localizan las páginas del constructor.
- Sin negociación forzada: **no** se redirige por `Accept-Language` salvo `i18n_negotiate = 1`; incluso así solo en la primera visita a `/` y nunca a un idioma no validado.

## 5. SEO

- `<html lang>`: el idioma servido (hoy fijo `es`).
- `canonical`: URL absoluta del idioma servido (autorreferente). En el fallback `default`, apunta a la URL del principal.
- `hreflang`: un `<link rel="alternate" hreflang="…">` por cada versión validada de **esa** página, más el propio, más `x-default` apuntando a la versión del principal. Solo se emiten alternates recíprocos (si A enlaza a B, B enlaza a A).
- `<title>`, descripción, `og:*` y `twitter:*` por idioma (`meta_title`, `meta_description`, `og_image_url`; con `og:locale` y `og:locale:alternate`).
- `noindex` si el idioma o la traducción no están validados (en la vista previa del editor y en el fallback `default`).
- `sitemap.xml`: una entrada por URL validada, con `<xhtml:link rel="alternate" hreflang>` hacia todas sus versiones (incluida ella misma y `x-default`). Idiomas o traducciones sin validar no aparecen. Sin idiomas adicionales, el sitemap es idéntico al actual byte a byte.
- Con `site_noindex = 1` (web oculta) sigue mandando: sitemap vacío y noindex.

## 6. Contenido

### 6.1 Páginas y bloques
`page_translations` (arriba). Lectura pública: `public.getTenantPage({ slug, locale? })`; sin `locale` devuelve exactamente lo de hoy.

### 6.2 Menús, cabecera, pie, cookies y mensajes
- Menú: `content_translations` con `entity_type = menu_item`, campos `label` y `url`. Si el enlace apunta a una página propia, la URL se **deriva** del slug localizado de esa página; `url` solo se usa para enlaces externos o a rutas de aplicación.
- Un elemento de menú sin traducción validada se oculta (`hide`) o se muestra con la etiqueta del principal (`default`), según `i18n_fallback`.
- Ajustes globales (textos de cabecera/pie, aviso de cookies, mensajes del sitio): `entity_type = setting`, `entity_key = <clave de system_settings>`, campo `value`.

### 6.3 Formularios (alineado con E-7)
E-7 deja las cadenas del formulario en campos separados del bloque (título, introducción, etiquetas, placeholders, texto del botón, mensajes de éxito y error). Como la traducción de página guarda el bloque completo, **el formulario se traduce dentro de la traducción de su página**: etiquetas, placeholders y mensajes viajan con el bloque. Lo que **no** se traduce y se hereda del principal: tipo de campo, `role`, `required`, reglas de validación, destino y el campo trampa/antiabuso (la traducción no puede cambiar la semántica ni la seguridad; el servidor, al validar el envío, usa siempre la definición del **principal** para campos y reglas y la traducción solo para textos). `content_translations` con `entity_type = form` queda reservado para formularios que existan fuera de una página.

### 6.4 Contenido comercial (productos de la tienda)
`content_translations` con `entity_type = product`, `entity_key = experiences.id`; campos `title`, `shortDescription`, `description`, `metaTitle`, `metaDescription`; `slug` localizado. Precio, impuestos, disponibilidad y variantes **no** se traducen ni se duplican: siempre salen del producto principal. Fase de contenido comercial: ver §8.

### 6.5 Panel y correos
Solo el mecanismo (`locale` resoluble por destinatario y plantilla); el texto del producto no se traduce en esta épica.

## 7. Selector de idioma
Bloque `language_switcher` (y ajuste de cabecera): lista solo idiomas validados **que tienen versión de la página actual**, con enlaces reales (`<a href>` a la URL localizada de esa página, no JS), `lang` y `hreflang` en cada enlace, `aria-label` traducible, etiqueta del idioma en su propio idioma (autónimo, p. ej. «Deutsch»). Accesible por teclado, sin banderas como único identificador. Con un único idioma no se muestra.

## 8. Plan por fases / PR

| Fase | Contenido | PR |
|---|---|---|
| 1 | Modelo + migración + capa de servidor (idiomas, traducción de páginas, estados, validación, copiar desde principal, detección de campos sin traducir, `content_translations`). Resolvedor puro de locale/URL. Pruebas. | PR único de la rama (commits separados) |
| 2 | Render público: `getTenantPage` con `locale`, ruta cliente `/:locale/:slug`, `hreflang`/`canonical`/`lang` en el HTML servido, sitemap con alternates, noindex. | mismo PR |
| 3 | Editor: conmutador de idioma, estado, copiar desde principal, indicador de sin traducir. **API completa en fase 1; interfaz del editor documentada si no hay verificación visual posible.** | mismo PR o seguimiento |
| 4 | Menús y ajustes globales por idioma (lectura con fallback implementada; edición por API). | mismo PR |
| 5 | Formularios: traducción dentro del bloque (ya cubierta por 6.3); coordinación con E-7. | seguimiento |
| 6 | Contenido comercial: migración (la tabla ya sirve), capa de lectura; rutas de tienda localizadas y edición documentadas. | seguimiento |
| 7 | Panel y correos: solo el mecanismo; documentado. | seguimiento |

## 9. Migraciones y numeración
Una migración aditiva (`site_locales`, `page_translations`, `content_translations`) con su `.down.sql`. Reserva original: 0068 (orden E-7 → E-3 → E-1). Mientras E-7 y E-3 no hayan fusionado sus migraciones, la rama lleva el siguiente número libre (para no dejar huecos en CI) y se **renumera al rebasar** sobre `integration/elephant-source`. No se aplica nunca al arrancar.

## 10. Impacto en empresas existentes
- Sin filas en `site_locales`: principal implícito `es`; `getTenantPage`, sitemap, SEO y menús devuelven exactamente lo de hoy (hay pruebas de regresión que lo comprueban).
- Instalación de una sola empresa (`TENANT_MODE=single`, páginas escritas a mano): la épica solo actúa sobre la web neutra del constructor (multiempresa); no cambia nada allí.
- Ningún borrado ni renombrado de columnas; reversión: `down` elimina las tres tablas nuevas (con sus traducciones) y las claves `i18n_*`.

## 11. Acuerdo con E-3 (importación)
- Campo opcional `locale` (código BCP 47 en minúsculas). Ausente o igual al principal: se importa como hoy, al principal.
- Con `locale` distinto del principal: el elemento debe **referirse a una página existente del principal** por su slug (`translationOf`) y se escribe como **borrador** de la traducción (`savePageTranslationDraft`); nunca se valida ni se publica desde la importación.
- Si el idioma no está dado de alta en la empresa, la importación lo rechaza con mensaje claro (no lo crea sola).
- API estable para E-3: `server/i18nService.ts` → `savePageTranslationDraft(pageId, locale, input)`, `getI18nConfig()`.
- Mismos campos por idioma: `slug`, `title`, `metaTitle`, `metaDescription`, `ogImageUrl`, `blocks`.

## 12. Riesgos
| Riesgo | Mitigación |
|---|---|
| Conflicto entre un slug existente y un código de idioma | Al añadir un idioma se comprueba que no exista una página con ese slug; se rechaza. |
| Duplicación de contenido indexable | `canonical` autorreferente por idioma, `hreflang` recíproco, `noindex` en no validado y en fallback. |
| Traducción obsoleta cuando el principal cambia | `base_hash` + aviso; no se actualiza sola. |
| Fuga entre empresas | Tablas en la BD de cada empresa, sin caché compartida; pruebas de aislamiento. |
| Colisión con E-2 y E-7 en `shared/pageBlocks.ts` | Solo se añade (aditivo) el tipo `language_switcher` al final; sin reordenar `BLOCK_TYPES`. |
| Inyección vía textos traducidos | Mismo saneado de bloques que el principal; metadatos escapados con `escapeHtml`; URLs con `safeUrl`. |
| Rendimiento: consulta extra por petición | Solo si la empresa tiene idiomas adicionales; sin idiomas, no hay consulta (lectura de `site_locales` omitida si la configuración está vacía en una sola consulta ligera). |

## 13. Pruebas previstas
Resolvedor de locale/URL (prefijos, principal con y sin prefijo, slug reservado), `hreflang`/`canonical`/`x-default`, fallback (`hide` y `default`), estados y dos candados, validación de entrada, aislamiento entre empresas, regresión de rutas actuales (`classifyPublicPath` sin cambios), sitemap sin idiomas idéntico al actual.
