# Elephant Studio: importación de medios y contenidos (épica E-3)

Capacidad reutilizable por cualquier empresa (tenant) para cargar medios y páginas de forma **trazable, idempotente y segura**. Nada de este documento es específico de un cliente.

- Formato: `shared/studioImport.ts` (zod). JSON Schema publicado: [`import-format.schema.json`](import-format.schema.json) (se regenera con `scripts/studio/import.ts schema --out ...`; una prueba comprueba que no se desincroniza).
- Motor: `server/studioImport/` (`engine.ts` con puertos, `download.ts` + `netGuard.ts` para medios, `adapters.ts` reales, `index.ts` = función de servidor `runStudioImport(tenant, documento, opciones)`).
- CLI: `scripts/studio/import.ts`.
- Migración `0067_studio_importacion` (tablas `studio_import_runs`, `studio_import_media`, `studio_import_pages`; aditiva, se aplica por el carril `db/migrations`, nunca al arrancar).

## 1. Formato (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "site": { "defaultLocale": "es" },
  "media": [
    { "id": "portada", "sourceUrl": "https://ejemplo.com/img/portada.jpg", "originalFilename": "portada.jpg",
      "alt": "Texto alternativo", "license": "CC-BY-4.0", "credit": "Autoría", "sourceNote": "De dónde sale" }
  ],
  "pages": [
    { "slug": "quienes-somos", "title": "Quiénes somos", "locale": "es", "status": "draft",
      "seo": { "title": "Título SEO", "description": "Descripción SEO" },
      "blocks": [
        { "type": "hero", "data": { "title": "Hola", "subtitle": "", "imageUrl": "media:portada", "imageAlt": "", "buttonLabel": "", "buttonUrl": "" } }
      ] }
  ],
  "menu": { "header": [ { "pageSlug": "quienes-somos" } ] }
}
```

- `blocks[].type` ∈ tipos de `shared/pageBlocks.ts`; `data` se valida y sanea con el mismo normalizador que el editor (`normalizeBlocks`): lo que el Studio no admite se rechaza o se descarta igual que al editar. Si un bloque no lleva `id`, se le asigna uno determinista (misma página y posición, mismo id), imprescindible para la idempotencia.
- **Referencias a medios**: la cadena completa `media:<id local>` en cualquier campo de un bloque (`imageUrl`, `url`, `images[].url`…). Se sustituye por la ruta pública `/files/<id>/<nombre>`. Si el campo `alt`/`imageAlt` hermano está vacío y el medio trae `alt`, se usa.
- `status`: `draft` (por defecto) o `published`. `published` solo tiene efecto junto con `--publish`.
- `menu`: enlaces a páginas del propio documento (cabecera/pie), con el mecanismo existente `setPageInMenu` (idempotente).
- Límites: 500 medios, 200 páginas, 60 bloques por página, https obligatorio sin credenciales en `sourceUrl`.

### Idioma (alineado con E-1, `docs/architecture/studio-multidioma.md` §11)
- `locale` (BCP 47 **en minúsculas**: `es`, `de`, `pt-br`) es **opcional** en la página y en el bloque. `site.defaultLocale` fija el principal (por defecto `es`).
- Ausente o igual al principal: se importa como hoy, a la página del principal.
- Distinto del principal: la página **debe** indicar `translationOf` (slug de la página del principal). Se escribe **siempre como borrador de traducción** a través del puerto `TranslationGateway` (`savePageTranslationDraft` de E-1); la importación nunca valida ni publica traducciones ni crea idiomas. **Mientras E-1 no esté integrado, esas páginas se OMITEN con un aviso** (nunca se escriben como página del principal). El enganche con `server/i18nService.ts` queda para cuando E-1 se fusione (un adaptador de ~15 líneas).
- `locale` de bloque: se valida y se ignora hoy (reservado para traducción por texto).

## 2. Medios

- Solo **https**, sin credenciales; tipos permitidos: JPEG, PNG, WebP, GIF, AVIF, SVG (solo si supera `isSafeSvg` al guardar) y PDF. Máximo 25 MB, 30 s en total, 3 redirecciones (cada salto se revalida completo).
- **Vídeo y fuentes: no soportados todavía.** El almacén público del Core solo guarda imágenes y PDF (detección de tipo por contenido); ampliarlo es un cambio de producto aparte. Un vídeo/fuente da error claro en el informe.
- **SSRF** (`netGuard.ts`): se bloquean loopback, redes privadas, CGNAT, enlace local (incluido `169.254.169.254`), multicast y reservadas, en IPv4 e IPv6 (incluidas formas mapeadas/NAT64/6to4/Teredo y las notaciones decimal/hex/octal de IPv4), y nombres internos (`localhost`, `*.internal`, `*.local`…). El host se resuelve una vez; **todas** sus direcciones deben ser públicas y la conexión se hace **a esa IP** (sin segunda resolución: no hay ventana de DNS rebinding). Se rechazan respuestas comprimidas (para poder conservar el original).
- **Original byte a byte**: se guardan exactamente los bytes recibidos (`FileService.put` los verifica por SHA-256 tras subirlos). No se recomprimen ni se generan variantes aquí.
- **Manifiesto** (`studio_import_media`): hash SHA-256 (único por tenant), objeto almacenado, URL de origen, nombre original, tipo, tamaño, fecha de captura, importación que lo creó, alt/licencia/crédito/nota de origen.
- **Duplicados**: por hash dentro del tenant (reutiliza el existente) y exactos dentro del lote; se listan en el informe (`duplicates`). Una URL de origen ya importada se reutiliza sin descargar (salvo `--refresh-media`). Limitación: solo se deduplica contra medios traídos por importación, no contra subidas manuales de Multimedia.

## 3. Páginas

- Crea o actualiza **por slug** con la capa existente (`createSitePage`, `updatePageSettings`, `savePageDraft`; `publishPage` solo con `--publish`).
- **Idempotente**: hash del contenido importado (título, SEO, idioma, bloques con cada medio como su SHA-256, no su id de objeto). Resultado por página: `created` / `updated` / `unchanged` / `skipped` / `error`.
- **Nunca publica** salvo `--publish` y `status: "published"` en esa página.
- **No pisa trabajo manual**: una página que ya existe y no creó la importación, o que se editó a mano tras importarla (se compara el hash del estado tras la última escritura), se **omite** salvo `--overwrite`; con `--overwrite` solo se reescribe el **borrador**, nunca se publica por sí solo.
- Si falta un medio de una página (falló su descarga), esa página no se escribe; el resto sigue.

## 4. Cómo ejecutarla

```bash
pnpm exec tsx scripts/studio/import.ts validate documento.json                 # sin red ni BD
pnpm exec tsx scripts/studio/import.ts run documento.json --tenant <empresa>    # ENSAYO (por defecto): descarga y compara, no escribe nada
pnpm exec tsx scripts/studio/import.ts run documento.json --tenant <empresa> --apply \
    --actor "nombre" --report-json informe.json --report-md informe.md
# opciones: --publish  --overwrite  --refresh-media
```
Código de salida: 0 correcto, 1 con errores en el informe, 2 uso incorrecto. Con `--apply` queda un registro de auditoría (`studio_import_runs`: operador, opciones, resumen e informe) y el informe se escribe en los ficheros indicados. El ensayo no escribe nada, tampoco el registro.

### Contra un tenant en producción (carril administrativo; **no se hace desde el desarrollo**)
1. La migración `0067` ya aplicada por el carril de migraciones (`db/migrations/README.md`: `verify`, copia verificada, `up` en dry-run y luego `--apply --confirm-database`).
2. Entorno del operador con `REGISTRY_ADMIN_DATABASE_URL`, `REGISTRY_KEYS`, `REGISTRY_ACTIVE_KEY_ID` (como el resto de `scripts/tenants/cli.ts`) y la configuración de almacenamiento de objetos del Core (la misma que usa el servidor: `STORAGE_*`). La BD del tenant sale del registro; los DSN no se imprimen.
3. `validate`, después **ensayo** (`run` sin `--apply`) y revisar el informe (duplicados, omitidas, errores). Con la web aún no publicada, mantener `site_noindex = 1`.
4. `run ... --apply` sin `--publish`. Revisar los borradores en el Studio y publicar desde el panel (o repetir con `--publish` y `status: "published"` en las páginas elegidas).
5. Repetir el mismo comando es seguro (idempotente): todo `unchanged`.

## 5. Aislamiento y seguridad

- Todo se ejecuta dentro de `withTenantDb(tenant)`: BD, almacén (`objectRoot()`) y tablas `studio_import_*` son las del tenant indicado; el motor solo escribe a través de puertos ligados a ese tenant y no tiene estado global. Las pruebas ejecutan dos tenants (también en paralelo) y comprueban que no se mezclan.
- Sin credenciales ni URLs reales en fixtures (dominios `example.*` y servidor HTTP local).
- Modo de pruebas de la descarga (`unsafeTestMode`: http y loopback) **no** está expuesto en la CLI ni en `realImportDeps()`.

## 6. Reversión
`0067_studio_importacion.down.sql` elimina las tres tablas (no toca páginas ni ficheros ya importados). Las páginas importadas son borradores normales del Studio: se descartan o eliminan desde el panel. Los ficheros quedan en el almacén con propietario `studio-import/<runId>`.

## 7. Alcance pendiente (decisión del 14/11/2026)
- **Vídeo y tipografías no se importan todavía.** El almacén público del Core solo admite imágenes y PDF (categoría `import-asset`); el informe da un error claro por elemento. Ampliarlo exige tipos MIME, límites de tamaño y servido seguro nuevos en `FileService`, y para las fuentes además aviso de licencia y autoalojado: se aborda como épica propia (E-9 «Tipografías personalizadas» y «Vídeo en el almacén público»), no como parte de E-3, para no retrasar su despliegue.
- La deduplicación es solo contra medios importados, no contra subidas manuales.
- Las traducciones (`locale` + `translationOf`) se omiten con aviso hasta que el adaptador de E-1 (`savePageTranslationDraft`) esté fusionado.
